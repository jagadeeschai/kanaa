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

To make a video from scratch: list_media (and look_at_media to see what each clip shows), best_moments to pick the best
stretch of long clips, create_project, add_clips in the order of the story (each with a transition if wanted), add_title
for an opening or names, list_music and add_music, then look at a few moments and export. Keep it simple: a transition
on some cuts, not every one; 0.5-1 s. Photos show 4 s unless told otherwise.

Workflow for changing a project:
1. list_projects, then get_project to see its clips and titles (with ids, names, times). find_items searches by name or words.
2. look renders a stretch (up to 10 s) and shows you frames: use it before and after changing anything visual.
3. Change things with update_item, set_keyframes, set_animation, add_title and place_in_scene. Each is one undoable step;
   undo puts the last one back. Small steps, then look again.

Coordinates: x and y are shares of the frame (0 left/top, 1 right/bottom); the item's x, y is its middle. scale 1 is the
title's own size. tilt_x leans a title back (top away, degrees), tilt_y turns it (right side away). Times: start and
length are timeline seconds; keyframe t is seconds from the item's own start. Kanaa draws in true perspective, so for a
title on a wall, the ground or the sky prefer place_in_scene over writing tilt keyframes by hand.
Keep the person's style: change what was asked, leave the rest.

Lyric videos: add_song, read_lrc (the bracketed directions tell you the style and singer), plan_lyric_scenes with a
brief, rewrite each scene's prompt to fit its words, make_scene_pictures, look_at_media, build_lyric_video, then look.
Do not export unless asked: the person reviews first.
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

    def upload(self, path: str, file: Path) -> Any:
        with file.open('rb') as handle:
            return self._check(self.http.post(path, files={'file': (file.name, handle)}, timeout=600))

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

    def relay(timeline: dict) -> None:
        """Main-track clips play one after another: each starts where the one before ends (transitions overlap the cut)."""
        main = next(layer for layer in timeline['layers'] if layer['kind'] == 'video')
        at = 0.0
        for clip in main['items']:
            clip['start'] = round(at, 3)
            at += length_of(clip)

    @server.tool(annotations=READ_ONLY)
    def list_media(kind: Literal['video', 'image'] | None = None, query: str = '', folder: str | None = None, limit: int = 100) -> list[dict]:
        """Videos and photos in Kanaa's media library, newest first: id, file name, type, length (s), size and folder.
        query matches file names; folder narrows to one of the library's folders."""
        params = {'limit': max(1, min(500, limit)), 'collection': 'imports'}
        if kind:
            params['media_type'] = kind
        if query:
            params['q'] = query
        if folder:
            params['folder'] = folder
        found = api.http.get('/photos', params=params)
        rows = api._check(found)['photos']
        keys = ('id', 'filename', 'media_type', 'duration', 'width', 'height', 'folder', 'recorded_at', 'created_at')
        return [{key: row.get(key) for key in keys if row.get(key) is not None} for row in rows]

    @server.tool(annotations=READ_ONLY)
    def look_at_media(media_id: int, times: list[float] | None = None, frames: int = 4) -> list[Image]:
        """Pictures from a video in the library (or the photo itself), 480 pixels wide, to see what it shows before
        using it: at `times` (seconds into the file), or `frames` (1-8) evenly spread."""
        item = media(media_id)
        path = item.get('absolute_path')
        if not path or not Path(path).is_file():
            raise ToolError('That file is not on this Mac any more.')
        if item.get('media_type') != 'video':
            times = [0.0]
        elif not times:
            duration = float(item.get('duration') or 1)
            count = max(1, min(8, frames))
            times = [duration * (index + 0.5) / count for index in range(count)]
        pictures = []
        with tempfile.TemporaryDirectory() as folder:
            for index, at in enumerate(times[:8]):
                target = Path(folder) / f'{index}.jpg'
                seek = ['-ss', f'{max(0.0, at):.3f}'] if item.get('media_type') == 'video' else []
                subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', *seek, '-i', path, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', str(target)], check=False)
                if target.is_file():
                    pictures.append(Image(data=target.read_bytes(), format='jpeg'))
        if not pictures:
            raise ToolError('Could not read pictures from that file.')
        return pictures

    @server.tool(annotations=READ_ONLY)
    def best_moments(items: list[dict]) -> list[dict]:
        """The best stretch of each video for a story, as Kanaa's Story templates pick them (steady, sharp, faces,
        movement): items [{"media_id": id, "length": seconds wanted}] in, each with "start" (seconds into the file, or
        null for a photo) out. Takes a while for long videos."""
        status = api.wait(api.post('/best-moments', {'items': items})['job_id'], timeout=1800)
        starts = status.get('starts') or status.get('result', {}).get('starts') or []
        return [{**item, 'start': start} for item, start in zip(items, starts)]

    @server.tool(annotations=CHANGES)
    def create_project(name: str, width: int = 1920, height: int = 1080, fps: int = 30) -> dict:
        """A new, empty edit project: 1920x1080 for YouTube, 1080x1920 for Reels and Shorts, 1080x1080 square. Returns its id."""
        anything = next(iter(list_media(limit=1)), None)
        if anything is None:
            raise ToolError('Kanaa has no media yet: import some videos or photos first.')
        project = api.post('/projects', {'name': name, 'kind': 'edit', 'media_id': anything['id'], 'media_ids': []})
        timeline = {'version': 2, 'format': {'width': width, 'height': height, 'fps': fps}, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': []}]}
        validate(timeline)
        api.put(f"/projects/{project['id']}/recipe", {'recipe': timeline})
        return {'id': project['id'], 'name': name, 'format': timeline['format']}

    @server.tool(annotations=CHANGES)
    def add_clips(project_id: int, clips: list[dict], at: int | None = None) -> list[dict]:
        """Adds videos or photos to the main track, in this order, after the last clip (or before position `at`).
        Each: {"media_id": id, "in": seconds into the file (default 0), "out": where it stops (default its end; for a
        photo, in + 4), "name": what it is for, "transition": {"kind": ..., "duration": 0.6} into this clip}. Transition
        kinds: crossfade, cross-blur, dip, flash, wipe, slide, whip, zoom, cross-zoom, circle-open, circle-close, spin-in,
        spin-out, doorway, mosaic, puzzle-left, puzzle-right, ripple, swap, cube, page-curl-left, page-curl-right. Returns
        the clips added, with ids and start times."""
        before = timeline_of(project_id)
        after = copy.deepcopy(before)
        main = next(layer for layer in after['layers'] if layer['kind'] == 'video')
        made = []
        for entry in clips:
            item = media(int(entry['media_id']))
            photo = item.get('media_type') != 'video'
            start_in = float(entry.get('in', 0))
            out = round(float(entry.get('out', start_in + 4 if photo else float(item.get('duration') or start_in + 4))), 3)
            if not photo and item.get('duration') and out > float(item['duration']) + 1e-3:
                raise ToolError(f"{item.get('filename')} is only {float(item['duration']):.2f} s long.")
            clip = {'id': f'clip-{uuid.uuid4().hex[:8]}', 'media_id': item['id'], 'start': 0, 'in': start_in, 'out': out, 'speed': 1, 'volume': 1, 'muted': False,
                    'fade_in': 0, 'fade_out': 0, 'transform': {'x': 0.5, 'y': 0.5, 'scale': 1, 'opacity': 1, 'rotation': 0}, 'frame_locked': True}
            if entry.get('name'):
                clip['name'] = str(entry['name'])[:80]
            if entry.get('transition'):
                clip['transition_in'] = {'kind': entry['transition']['kind'], 'duration': float(entry['transition'].get('duration', 0.6))}
            made.append(clip)
        if not main['items'] and made:
            made[0].pop('transition_in', None)  # Nothing to come in from.
        position = len(main['items']) if at is None else max(0, min(at, len(main['items'])))
        main['items'][position:position] = made
        relay(after)
        save(project_id, before, after, f'Added {len(made)} clip(s)')
        return [{'id': clip['id'], 'name': clip.get('name') or media(clip['media_id']).get('filename'), 'start': clip['start'], 'length': round(length_of(clip), 3),
                 'transition_in': clip.get('transition_in')} for clip in made]

    @server.tool(annotations=CHANGES)
    def set_transition(project_id: int, clip_id: str, kind: str | None, duration: float = 0.6, direction: Literal['left', 'right', 'up', 'down'] | None = None) -> dict:
        """The transition into a main-track clip from the one before it (kinds as in add_clips), or none (kind null).
        direction is for wipe and slide."""
        before = timeline_of(project_id)
        after = copy.deepcopy(before)
        _, clip = find(after, clip_id)
        clip['transition_in'] = None if kind is None else {'kind': kind, 'duration': duration, **({'direction': direction} if direction and direction != 'left' else {})}
        save(project_id, before, after, f'Transition into {clip_id}: {kind or "none"}')
        return {'id': clip_id, 'transition_in': clip['transition_in']}

    @server.tool(annotations=CHANGES)
    def remove_item(project_id: int, item_id: str) -> dict:
        """Takes a clip, title or sound out of the project (the main track closes up behind a clip). undo brings it back."""
        before = timeline_of(project_id)
        after = copy.deepcopy(before)
        layer, item = find(after, item_id)
        layer['items'].remove(item)
        if layer['kind'] == 'video' and layer is next(entry for entry in after['layers'] if entry['kind'] == 'video'):
            if layer['items']:
                layer['items'][0].pop('transition_in', None)
            relay(after)
        save(project_id, before, after, f'Removed {item_id}')
        return {'removed': item_id}

    @server.tool(annotations=READ_ONLY)
    def list_music(mood: str | None = None) -> list[dict]:
        """Tracks in the person's own music library (the Music app's folder), sorted into moods: id, name, artist,
        length (s) and mood. mood narrows the list (for example calm, happy, energetic, emotional, cinematic)."""
        tracks = api.get('/music-library')['tracks']
        return [{key: track.get(key) for key in ('id', 'name', 'artist', 'seconds', 'mood')} for track in tracks if not mood or track.get('mood') == mood]

    @server.tool(annotations=CHANGES)
    def add_music(project_id: int, track_id: str, start: float = 0, volume: float = 0.6, fade_in: float = 1.0, fade_out: float = 2.0,
                  duck: bool = True, until_end: bool = True) -> dict:
        """A track from list_music under the video, on its own sound layer: from `start` (s), at `volume` (0-2; 0.6
        sits under voices), fading in and out, ducking under people talking. until_end stops it where the video ends."""
        song = api.post(f'/music-library/{track_id}/use')
        before = timeline_of(project_id)
        after = copy.deepcopy(before)
        end = max([item.get('start', 0) + length_of(item) for layer in after['layers'] if layer['kind'] == 'video' for item in layer.get('items', [])] or [0])
        out = float(song['duration'])
        if until_end and end > start:
            out = min(out, end - start)
        if out <= 0:
            raise ToolError('Add clips first: the music would end before it starts.')
        sound = {'id': f'sound-{uuid.uuid4().hex[:8]}', 'asset_id': song['asset_id'], 'start': start, 'in': 0, 'out': round(out, 3), 'speed': 1,
                 'volume': volume, 'muted': False, 'fade_in': fade_in, 'fade_out': min(fade_out, out / 2), 'duck': duck, 'name': song['name'][:120],
                 'source_length': float(song['duration'])}
        after['layers'].append({'id': f'music-{uuid.uuid4().hex[:8]}', 'kind': 'audio', 'name': 'Music', 'volume': 1, 'items': [sound]})
        save(project_id, before, after, f'Added music {song["name"]!r}')
        return {'id': sound['id'], 'name': song['name'], 'start': start, 'length': sound['out']}

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

    # ---- Lyric videos: song, timed lyrics, AI scene pictures, then a finished, dynamic editor project. ----

    def look_up(job: dict, key: str):
        return job.get(key) if job.get(key) is not None else (job.get('result') or {}).get(key)

    @server.tool(annotations=CHANGES)
    def add_song(path: str) -> dict:
        """Adds a song (wav, mp3, m4a...) from this Mac to Kanaa for a lyric video. The file is copied; the original is
        only read. Returns its asset id and length in seconds."""
        file = Path(path).expanduser()
        if not file.is_file():
            raise ToolError(f'There is no file at {path}.')
        made = api.upload('/video-audio', file)
        return {'asset_id': made['asset_id'], 'seconds': made['duration'], 'name': file.stem}

    @server.tool(annotations=READ_ONLY)
    def read_lrc(path: str) -> list[dict]:
        """Timed lyric lines from an LRC file on this Mac: [{"start", "end", "text"}] in seconds. Stage directions in
        brackets ([Chorus], [Soft Rhodes...]) are left out; read them yourself for the song's style and singer."""
        from kanaa_mcp.lyrics import read_lrc as parse
        file = Path(path).expanduser()
        if not file.is_file():
            raise ToolError(f'There is no file at {path}.')
        return parse(file.read_text(encoding='utf-8', errors='replace'))

    @server.tool(annotations=CHANGES)
    def plan_lyric_scenes(name: str, cues: list[dict], count: int = 6, brief: str = '', canvas: Literal['landscape', 'portrait', 'square'] = 'landscape',
                          lyric_project_id: int | None = None) -> dict:
        """Splits the song into `count` scenes (1-8) by its lyrics, each with a picture prompt, in a lyric project (made
        if not given). `brief`: the look of the whole video, in English: style (K-pop MV, moonlit R&B...), colours, who
        sings (male, female, group) and the recurring people. Returns the lyric project, the plan id and each scene's
        id, start, end, lyrics and prompt. Rewrite the prompts to fit each scene's words before make_scene_pictures."""
        if lyric_project_id is None:
            lyric_project_id = api.post('/projects', {'name': name, 'kind': 'lyric', 'media_ids': []})['id']
        plan = api.post(f'/projects/{lyric_project_id}/image-scenes/plan', {'lyrics': '\n'.join(cue['text'] for cue in cues), 'cues': cues, 'count': max(1, min(8, count)),
                                                                          'style': 'cinematic', 'canvas': canvas, 'purpose': 'scenes', 'brief': brief[:1500]})
        return {'lyric_project_id': lyric_project_id, 'plan_id': plan['id'],
                'scenes': [{'id': scene['id'], 'start': scene['start'], 'end': scene['end'], 'lyrics': scene['lyric'], 'prompt': scene['prompt']} for scene in plan['scenes']]}

    @server.tool(annotations=CHANGES)
    def make_scene_pictures(lyric_project_id: int, plan_id: str, scenes: list[dict], quality: Literal['low', 'medium', 'high'] = 'medium') -> list[dict]:
        """Makes each planned scene's picture with Kanaa's image AI (this costs the AI provider credit, a picture each):
        scenes [{"id", "prompt"}]. Waits, then returns [{"id", "media_id", "start", "end"}]. look_at_media shows them.
        To change pictures that are already made, plan again and make the new plan's pictures."""
        job = api.post(f'/projects/{lyric_project_id}/image-scenes/generate', {'batch_id': plan_id, 'scenes': [{'id': s['id'], 'prompt': s['prompt']} for s in scenes], 'quality': quality})['job_id']
        api.wait(job, timeout=1800)
        batch = api.get(f'/projects/{lyric_project_id}/image-scenes')['batch']
        return [{'id': s['id'], 'media_id': s['media_id'], 'start': s['start'], 'end': s['end'], 'status': s['status'], 'error': s.get('error')} for s in batch['scenes']]

    @server.tool(annotations=CHANGES)
    def build_lyric_video(name: str, song_asset_id: str, song_seconds: float, cues: list[dict], scenes: list[dict],
                          look: Literal['energetic', 'romantic', 'calm'] = 'romantic', three_d: bool = True, lyrics_in_scene: bool = True, lights: bool = True,
                          lyric_font: Literal['standard', 'elegant', 'modern', 'playful', 'handwritten'] = 'elegant', lyric_colour: str = '#ffffff', lyric_size: int = 50,
                          canvas: Literal['landscape', 'portrait', 'square'] = 'landscape', presents: str | None = None, song_by: str | None = None,
                          music: str | None = None, presented_by: str | None = None, footer: str | None = None, accent: str = '#e8b04a',
                          logo_media_id: int | None = None, project_id: int | None = None) -> dict:
        """Builds a finished lyric video as an editor project, ready for the person to review (it is not exported):
        - scenes [{"media_id", "start"}]: pictures in order, each from `start` seconds of the song (the first from 0).
        - three_d: each picture becomes a 3D camera glide (push, drift or rise), made once; lyrics_in_scene: what stands up
          in each picture (people, trees, pillars) passes in front of the lyrics.
        - look: lyric entrances and light overlays. energetic (blast, prism, chromatic...; sun rays, flares), romantic
          (lines rising from behind the people, magic form...; fireflies, bokeh, lanterns), calm (soft reveals; dust, fog).
          Every line keeps solid 3D letters; each scene adds a slow pan or zoom.
        - Credits, film style: an 8 s opening (`presents`, "A SONG BY" `song_by`, then the title `name` with `footer`) and a
          closing card (LYRICS `song_by`, MUSIC `music`, PRESENTED BY `presented_by`, `footer`); `accent` colours the roles.
          Leave out what you do not know rather than guess.
        - logo_media_id: a picture with transparency, small in the bottom-right corner and large on the closing card.
        - project_id: update that editor project instead of making a new one (do this when redoing a video).
        Takes a few minutes the first time (3D pictures). Returns the project id; look at it, then the person exports."""
        from kanaa_mcp import lyrics
        if not scenes:
            raise ToolError('Give at least one scene picture.')
        scenes = sorted(scenes, key=lambda scene: float(scene.get('start', 0)))
        starts = [0.0] + [round(float(scene['start']), 3) for scene in scenes[1:]]
        depth: dict[int, int] = {}
        if three_d:
            for index, scene in enumerate(scenes):
                seconds = (starts[index + 1] if index + 1 < len(scenes) else song_seconds) - starts[index]
                made = api.post(f"/photos/{int(scene['media_id'])}/depth-motion", {'seconds': round(min(120, max(0.5, seconds + 0.2)), 2), 'move': ['push', 'drift', 'rise'][index % 3]})
                video = made.get('output_photo_id') if made.get('status') == 'ready' else look_up(api.wait(made['job_id'], timeout=1800), 'output_photo_id')
                depth[int(scene['media_id'])] = int(video)
        handoff = {'name': name, 'backgrounds': [{'id': int(scene['media_id']), 'media_type': 'image'} for scene in scenes], 'backgroundType': 'image', 'duration': song_seconds,
                   'slideStarts': starts, 'song': {'id': song_asset_id, 'duration': song_seconds, 'name': name}, 'cues': [{**cue, 'position': 'bottom'} for cue in cues],
                   'canvas': canvas, 'color': lyric_colour, 'fontSize': lyric_size, 'placement': 'bottom', 'lyricStyle': 'shadow', 'lyricFont': lyric_font, 'lyricAlign': 'center',
                   'lyricBandColor': '#000000', 'lyricAnimation': 'cinematic', 'crossfade': True, 'imageAnimation': '3d' if three_d else 'ken-burns',
                   'depthVideos': depth or None, 'inScene': bool(three_d and lyrics_in_scene)}
        timeline = lyrics.base_timeline(handoff)
        lyrics.lay_out(timeline)
        light_media: dict[str, int] = {}
        if lights:
            for effect in lyrics.LOOKS[look]['light']:
                made = api.post(f'/effects/{effect}', {'width': timeline['format']['width'], 'height': timeline['format']['height']})
                light_media[effect] = made['media']['id'] if made.get('media') else int(look_up(api.wait(made['job_id']), 'media_id'))
        lyrics.dress(timeline, look, light_media)
        logo = None
        if logo_media_id is not None:
            item = media(logo_media_id)
            logo = {'media_id': logo_media_id, 'width': float(item['width']), 'height': float(item['height'])}
        lyrics.credits(timeline, name, presents, song_by, music, presented_by, footer, accent, logo)
        validate(timeline)
        if project_id is None:
            project_id = api.post('/projects', {'name': name, 'kind': 'edit', 'media_ids': [int(scenes[0]['media_id'])]})['id']
            api.put(f'/projects/{project_id}/recipe', {'recipe': timeline})
        else:
            save(project_id, timeline_of(project_id), timeline, 'Rebuilt the lyric video')
        return {'project_id': project_id, 'seconds': round(max(clip['start'] + lyrics.length_of(clip) for clip in timeline['layers'][0]['items']), 2),
                'scenes': len(scenes), 'lines': len(cues), 'three_d': bool(depth), 'note': 'Not exported. Use look to check moments; the person reviews and exports.'}

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
