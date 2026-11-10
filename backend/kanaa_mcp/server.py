"""Kanaa MCP server: an AI agent can find a clip or title in a project, look at it, and animate it.

It talks to a running Kanaa over HTTP (KANAA_API_URL, default http://127.0.0.1:8010/api), so it changes exactly what the
editor would: the project's saved timeline. Every change is checked against Kanaa's own timeline rules before it is
saved, and the timeline as it was is kept first (KANAA_MCP_HISTORY), so `undo` puts it back. An editor with the project
open picks the change up within a few seconds, with its own Undo. Nothing here touches media files: Kanaa's exports go to
its own export folder.

Run: cd backend && .venv/bin/python -m kanaa_mcp
"""
from __future__ import annotations

import copy
import json
import logging
import os
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Literal

import httpx
from mcp.server.mcpserver import Image, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

DEFAULT_API_URL = 'http://127.0.0.1:8010/api'
HISTORY = Path(os.getenv('KANAA_MCP_HISTORY', str(Path.home() / 'Library' / 'Application Support' / 'Kanaa' / 'agent-history')))
KEEP = 50  # Undo steps kept per project.
READ_ONLY = ToolAnnotations(readOnlyHint=True)
CHANGES = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False)

Surface = Literal['floor', 'wall', 'upright', 'sky']
Property = Literal['x', 'y', 'scale', 'rotation', 'opacity', 'tilt_x', 'tilt_y']
Ease = Literal['linear', 'easeOut', 'easeInOut']

INSTRUCTIONS = """\
Kanaa is a video editor. These tools animate titles and clips in a Kanaa project; the person watches the result in Kanaa.

Workflow:
1. list_projects, then get_project to see its clips and titles (with ids, names, times). find_items searches by name or words.
2. look renders a stretch (up to 10 s) and shows you frames: use it before and after changing anything visual.
3. Change things with update_item, set_keyframes, set_animation, add_title and place_in_scene. Each is one undoable step;
   undo puts the last one back. Small steps, then look again.

Coordinates: x and y are shares of the frame (0 left/top, 1 right/bottom); the item's x, y is its middle. scale 1 is the
title's own size. tilt_x leans a title back (top away, degrees), tilt_y turns it (right side away). Times: start and
length are timeline seconds; keyframe t is seconds from the item's own start. Kanaa draws in true perspective, so for a
title on a wall, the ground or the sky prefer place_in_scene over writing tilt keyframes by hand.
Keep the person's style: change what was asked, leave the rest.
"""


class KanaaApi:
    def __init__(self, http: httpx.Client):
        self.http = http

    def _check(self, response: httpx.Response) -> Any:
        if response.status_code >= 400:
            try:
                detail = response.json().get('detail')
            except ValueError:
                detail = response.text
            raise ToolError(f'Kanaa said: {detail or response.status_code}')
        return response.json()

    def get(self, path: str) -> Any:
        return self._check(self.http.get(path))

    def post(self, path: str, body: Any = None) -> Any:
        return self._check(self.http.post(path, json=body))

    def put(self, path: str, body: Any) -> Any:
        return self._check(self.http.put(path, json=body))

    def wait(self, job_id: str, timeout: float = 600) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            status = self.get(f'/jobs/{job_id}/status')
            if status.get('status') in ('done', 'failed', 'cancelled'):
                if status['status'] != 'done':
                    raise ToolError(f"Kanaa could not finish: {status.get('error') or status['status']}")
                return status
            time.sleep(0.5)
        raise ToolError('Kanaa is still working on it; try again in a moment.')


def validate(timeline: dict) -> None:
    """Kanaa's own rules (timeline_schema.py), so a bad change is refused here rather than breaking the project."""
    from pydantic import ValidationError

    from app.services.timeline_schema import Timeline
    try:
        Timeline.model_validate(timeline)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = '.'.join(str(part) for part in first.get('loc', ()))
        raise ToolError(f"That change breaks the timeline ({where}): {str(first.get('msg', 'not valid')).removeprefix('Value error, ')}") from exc


def find(timeline: dict, item_id: str) -> tuple[dict, dict]:
    for layer in timeline.get('layers', []):
        for item in layer.get('items', []):
            if item.get('id') == item_id:
                return layer, item
    raise ToolError(f'No item {item_id!r} in this project. get_project lists them.')


def length_of(item: dict) -> float:
    if 'length' in item:
        return float(item['length'])
    return (float(item.get('out', 0)) - float(item.get('in', 0))) / float(item.get('speed', 1) or 1)


def merge(base: dict, changes: dict) -> dict:
    """Changes into an item: nested objects (transform, adjust...) merge key by key; null removes a setting."""
    out = copy.deepcopy(base)
    for key, value in changes.items():
        if key == 'id':
            continue
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = merge(out[key], value)
        else:
            out[key] = value
    return out


def build_server(api: KanaaApi) -> MCPServer:
    server = MCPServer('kanaa', instructions=INSTRUCTIONS)
    media_cache: dict[int, dict] = {}

    def media(media_id: int) -> dict:
        if media_id not in media_cache:
            media_cache[media_id] = api.get(f'/photos/{media_id}')
        return media_cache[media_id]

    def timeline_of(project_id: int) -> dict:
        timeline = api.get(f'/projects/{project_id}/timeline')
        if not timeline or not timeline.get('layers'):
            raise ToolError('This project has no timeline yet: open it in Kanaa once.')
        return timeline

    def history_file(project_id: int) -> Path:
        return HISTORY / f'{project_id}.json'

    def save(project_id: int, before: dict, after: dict, what: str) -> None:
        """Checks the new timeline, keeps the old one for undo, then saves."""
        validate(after)
        path = history_file(project_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        steps = json.loads(path.read_text()) if path.is_file() else []
        steps.append({'what': what, 'at': time.strftime('%Y-%m-%d %H:%M:%S'), 'timeline': before})
        path.write_text(json.dumps(steps[-KEEP:]))
        api.put(f'/projects/{project_id}/recipe', {'recipe': after})

    def describe(timeline: dict, item: dict, layer: dict) -> dict:
        out: dict[str, Any] = {'id': item['id'], 'layer': layer.get('name') or layer['kind'], 'start': round(item.get('start', 0), 3), 'length': round(length_of(item), 3)}
        if 'media_id' in item:
            facts = media(item['media_id'])
            out.update(kind='clip', name=item.get('name') or facts.get('filename'), file=facts.get('filename'), media=facts.get('media_type'))
            if item.get('enabled') is False:
                out['off'] = True
            if item.get('transition_in'):
                out['transition_in'] = item['transition_in']
        elif 'text' in item:
            out.update(kind='title', text=item['text'], subtitle=item.get('subtitle'), position=item.get('position'), size=item.get('size'))
            if item.get('pin'):
                out['locked_to_scene'] = item['pin']
        else:
            out['kind'] = layer['kind']
        transform = item.get('transform') or {}
        if transform:
            out['transform'] = {key: value for key, value in transform.items() if key != 'keyframes'}
            if transform.get('keyframes'):
                out['keyframes'] = {key: len(keys) for key, keys in transform['keyframes'].items() if keys}
        for key in ('enter', 'exit'):
            if item.get(key):
                out[key] = item[key]
        return out

    @server.tool(annotations=READ_ONLY)
    def list_projects() -> list[dict]:
        """Kanaa's projects, newest first: id, name and when each was last changed."""
        projects = api.get('/projects')
        projects = projects.get('projects', projects) if isinstance(projects, dict) else projects
        return [{key: project.get(key) for key in ('id', 'name', 'kind', 'updated_at')} for project in projects]

    @server.tool(annotations=READ_ONLY)
    def get_project(project_id: int) -> dict:
        """A project's frame (width, height, fps), length, and every clip and title by layer, with ids and times."""
        timeline = timeline_of(project_id)
        layers = [{'id': layer['id'], 'kind': layer['kind'], 'name': layer.get('name'), 'items': [describe(timeline, item, layer) for item in layer.get('items', [])]}
                  for layer in timeline['layers']]
        main = next((layer for layer in timeline['layers'] if layer['kind'] == 'video'), {'items': []})
        end = max([item.get('start', 0) + length_of(item) for layer in timeline['layers'] for item in layer.get('items', [])] or [0])
        return {'format': timeline.get('format'), 'duration': round(end, 3), 'main_layer': main.get('id'), 'layers': layers}

    @server.tool(annotations=READ_ONLY)
    def find_items(project_id: int, query: str) -> list[dict]:
        """Clips and titles whose name, file name or words contain `query` (any case)."""
        timeline = timeline_of(project_id)
        needle = query.lower()
        found = []
        for layer in timeline['layers']:
            for item in layer.get('items', []):
                summary = describe(timeline, item, layer)
                words = ' '.join(str(summary.get(key) or '') for key in ('name', 'file', 'text', 'subtitle')).lower()
                if needle in words:
                    found.append(summary)
        return found

    @server.tool(annotations=READ_ONLY)
    def get_item(project_id: int, item_id: str) -> dict:
        """Everything about one clip or title, as Kanaa stores it (the shape update_item takes)."""
        _, item = find(timeline_of(project_id), item_id)
        return item

    @server.tool(annotations=READ_ONLY)
    def look(project_id: int, start: float, end: float | None = None, frames: int = 3) -> list[Image]:
        """Renders the project from `start` to `end` (timeline seconds, up to 10 s; default 1 s) as it will export, with
        titles and effects, and returns `frames` (1-6) evenly spaced pictures, 640 pixels wide. Takes a few seconds."""
        end = start + 1 if end is None else end
        if not 0 <= start < end or end - start > 10:
            raise ToolError('Look at a stretch of up to 10 seconds, with end after start.')
        frames = max(1, min(6, frames))
        status = api.wait(api.post(f'/projects/{project_id}/look', {'start': start, 'end': end})['job_id'])
        video = Path(status['path'])
        span = end - start
        pictures = []
        with tempfile.TemporaryDirectory() as folder:
            for index in range(frames):
                at = span * (index + 0.5) / frames
                target = Path(folder) / f'{index}.jpg'
                subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-ss', f'{at:.3f}', '-i', str(video), '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', str(target)], check=False)
                if target.is_file():
                    pictures.append(Image(data=target.read_bytes(), format='jpeg'))
        if not pictures:
            raise ToolError('Kanaa rendered nothing for that stretch: is it inside the video?')
        return pictures

    @server.tool(annotations=CHANGES)
    def update_item(project_id: int, item_id: str, changes: dict) -> dict:
        """Changes settings of a clip or title. `changes` merges into the item as get_item shows it: nested objects merge
        key by key, null removes a setting. Examples: {"text": "Hello"}, {"transform": {"y": 0.3, "scale": 1.4}},
        {"start": 2.5, "length": 3}, {"name": "Opening shot"}, {"enabled": false}. Returns the item as saved."""
        before = timeline_of(project_id)
        after = copy.deepcopy(before)
        layer, item = find(after, item_id)
        index = layer['items'].index(item)
        layer['items'][index] = merge(item, changes)
        save(project_id, before, after, f'Changed {item_id}: {", ".join(changes)}')
        return layer['items'][index]

    @server.tool(annotations=CHANGES)
    def set_keyframes(project_id: int, item_id: str, property: Property, keyframes: list[dict]) -> dict:
        """Animates one property of a clip or title over its time: keyframes [{"t": seconds from the item's start,
        "v": value, "ease": "linear" | "easeOut" | "easeInOut"}], replacing that property's keyframes. An empty list
        stops animating it (it keeps its plain value). Values: x, y shares of the frame; scale; rotation, tilt_x, tilt_y
        degrees; opacity 0-1. Between keyframes Kanaa moves smoothly; before the first and after the last it holds."""
        before = timeline_of(project_id)
        after = copy.deepcopy(before)
        layer, item = find(after, item_id)
        length = length_of(item)
        keys = sorted(({'t': round(float(key['t']), 3), 'v': float(key['v']), 'ease': key.get('ease', 'easeInOut')} for key in keyframes), key=lambda key: key['t'])
        if any(not 0 <= key['t'] <= length + 1e-6 for key in keys):
            raise ToolError(f'Keyframe times run from 0 to the item\'s length, {length:.2f} s.')
        transform = item.setdefault('transform', {'x': 0.5, 'y': 0.5, 'scale': 1, 'opacity': 1})
        frames = dict(transform.get('keyframes') or {})
        if keys:
            frames[property] = keys
        else:
            frames.pop(property, None)
        transform['keyframes'] = frames
        save(project_id, before, after, f'Keyframes for {property} of {item_id}')
        return {'id': item_id, 'property': property, 'keyframes': keys}

    @server.tool(annotations=CHANGES)
    def set_animation(project_id: int, item_id: str, enter: dict | None = None, exit: dict | None = None, clear: bool = False) -> dict:
        """How a clip or title comes in and goes out: {"preset": name, "duration": seconds 0.1-3}. Presets: fade,
        slide-up, slide-down, slide-left, slide-right, zoom, pop, blur, bounce; for titles also reveal, soft-edge, line,
        chromatic, prism, echo, pop-letters, gravity, split, expand, blur-sideways, blast, magic-form, magic-vanish,
        particle-form, rise-behind, push-through, ground-rise. clear=true removes both."""
        before = timeline_of(project_id)
        after = copy.deepcopy(before)
        _, item = find(after, item_id)
        if clear:
            item['enter'] = item['exit'] = None
        if enter is not None:
            item['enter'] = enter
        if exit is not None:
            item['exit'] = exit
        save(project_id, before, after, f'Animation of {item_id}')
        return {'id': item_id, 'enter': item.get('enter'), 'exit': item.get('exit')}

    @server.tool(annotations=CHANGES)
    def add_title(project_id: int, text: str, start: float, length: float = 3, subtitle: str | None = None,
                  x: float = 0.5, y: float = 0.5, size: int = 34, color: str = '#ffffff', style: Literal['outline', 'shadow', 'band'] = 'shadow') -> dict:
        """A new title on a text layer with room at that time (a new layer when none has): its words, when, where its middle goes (x, y
        shares of the frame), size (about 20-60 reads well), colour and style. Returns it, with its id."""
        before = timeline_of(project_id)
        after = copy.deepcopy(before)
        # The first text layer with room at that time, else a new one: titles on one layer may not overlap.
        fits = lambda layer: all(start + length <= item['start'] + 1e-6 or item['start'] + length_of(item) <= start + 1e-6 for item in layer['items'])
        layer = next((layer for layer in after['layers'] if layer['kind'] == 'text' and fits(layer)), None)
        if layer is None:
            layer = {'id': f'text-{uuid.uuid4().hex[:8]}', 'kind': 'text', 'items': []}
            after['layers'].append(layer)
        title = {'id': f'title-{uuid.uuid4().hex[:8]}', 'start': start, 'length': length, 'text': text, 'style': style, 'position': 'center',
                 'color': color, 'size': size, 'transform': {'x': x, 'y': y, 'scale': 1, 'opacity': 1}}
        if subtitle:
            title['subtitle'] = subtitle
        layer['items'].append(title)
        save(project_id, before, after, f'Added title {text!r}')
        return title

    @server.tool(annotations=CHANGES)
    def place_in_scene(project_id: int, title_id: str, x: float, y: float, at: float | None = None, surface: Surface | None = None,
                       people_in_front: bool = True) -> dict:
        """Puts a title on the surface at a spot of the video, as Kanaa's Place in scene does: (x, y) shares of the
        frame at time `at` (default the title's start). Kanaa reads the surface there (or uses `surface`: floor, wall,
        upright, sky), tilts the title to lie on it, centres the words on the spot, locks it to that surface as the camera
        moves, and (people_in_front) lets people pass in front. look afterwards: the lock is made when Kanaa first draws it."""
        from types import SimpleNamespace

        from app.services.timeline_schema import Timeline
        from app.services.title3d import clip_placement, source_seconds
        before = timeline_of(project_id)
        after = copy.deepcopy(before)
        layer, title = find(after, title_id)
        if 'text' not in title:
            raise ToolError('place_in_scene is for titles.')
        when = title['start'] if at is None else at
        main = next(layer for layer in after['layers'] if layer['kind'] == 'video')
        clip = next((item for item in main['items'] if item['start'] <= when < item['start'] + length_of(item)), None)
        if clip is None or media(clip['media_id']).get('media_type') != 'video':
            raise ToolError('Place in scene needs a video on the main layer at that time.')
        parsed = Timeline.model_validate(after)
        placed = next(item for item in parsed.layers[after['layers'].index(main)].items if item.id == clip['id'])
        facts = media(clip['media_id'])
        matrix = clip_placement(placed, SimpleNamespace(width=facts.get('width'), height=facts.get('height')), parsed.format, when - clip['start'])
        fx, fy = x * parsed.format.width, y * parsed.format.height
        sx, sy = (fx - matrix[0][2]) / matrix[0][0], (fy - matrix[1][2]) / matrix[1][1]
        if not (0 <= sx <= 1 and 0 <= sy <= 1):
            raise ToolError('That spot is outside the video picture (on the bars around it).')
        pose = api.post(f"/photos/{clip['media_id']}/surface", {'t': source_seconds(placed, when), 'x': sx, 'y': sy, 'kind': surface})
        transform = {**(title.get('transform') or {}), 'x': x, 'y': y, 'rotation': pose['turn'], 'tilt_x': pose['tilt_x'], 'tilt_y': pose['tilt_y']}
        transform.pop('keyframes', None)
        title.update(transform=transform, position='center', keep_clear=None,
                     pin={'clip_id': clip['id'], 'at': when, 'region': [sx, sy], 'surface': pose['kind']})
        if people_in_front and pose['kind'] != 'sky':
            index = after['layers'].index(layer)
            above = after['layers'][index + 1] if index + 1 < len(after['layers']) else None
            if not (above and above['kind'] == 'video' and above.get('name') in ('Person', 'Object', 'Land', 'In front')):
                copy_clip = {**copy.deepcopy(clip), 'id': f'clip-{uuid.uuid4().hex[:8]}', 'cutout': 'remove', 'cutout_pick': None, 'muted': True,
                             'enter': None, 'exit': None, 'transition_in': None, 'fade_in': 0, 'fade_out': 0}
                after['layers'].insert(index + 1, {'id': f'layer-{uuid.uuid4().hex[:8]}', 'kind': 'video', 'name': 'Person', 'items': [copy_clip]})
        save(project_id, before, after, f'Placed {title_id} in the scene ({pose["kind"]})')
        return {'id': title_id, 'surface': pose['kind'], 'read_from_picture': pose['found'], 'tilt_x': pose['tilt_x'], 'tilt_y': pose['tilt_y'], 'turn': pose['turn']}

    @server.tool(annotations=READ_ONLY)
    def history(project_id: int) -> list[dict]:
        """The changes made through these tools to a project that undo can take back, newest last."""
        path = history_file(project_id)
        return [{'what': step['what'], 'at': step['at']} for step in (json.loads(path.read_text()) if path.is_file() else [])]

    @server.tool(annotations=CHANGES)
    def undo(project_id: int) -> dict:
        """Takes back the last change made through these tools to this project: the timeline goes back to how it was."""
        path = history_file(project_id)
        steps = json.loads(path.read_text()) if path.is_file() else []
        if not steps:
            raise ToolError('Nothing to undo from these tools for this project.')
        step = steps.pop()
        api.put(f'/projects/{project_id}/recipe', {'recipe': step['timeline']})
        path.write_text(json.dumps(steps))
        return {'undone': step['what'], 'left': len(steps)}

    @server.tool(annotations=CHANGES)
    def export(project_id: int) -> dict:
        """Exports the project as Kanaa does (full quality) and waits for it: returns where the video is. Can take minutes."""
        status = api.wait(api.post(f'/projects/{project_id}/export', timeline_of(project_id))['job_id'], timeout=3600)
        return {'media_id': status.get('output_photo_id'), 'file': media(status['output_photo_id']).get('absolute_path') if status.get('output_photo_id') else None}

    return server


def main() -> None:
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    # Kanaa's own rules come from the backend package beside this one.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    http = httpx.Client(base_url=os.getenv('KANAA_API_URL', DEFAULT_API_URL), timeout=120)
    build_server(KanaaApi(http)).run('stdio')
