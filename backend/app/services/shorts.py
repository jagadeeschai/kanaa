"""A vertical Short (9:16, for YouTube Shorts and Reels) of one stretch of a video, usually its chorus.

The stretch is cut with render_window (items already under way carry on, karaoke words and moves included), then the
frame turns portrait: every picture and video fills it, kept on its subject (faces, or the picture's most striking part,
focus_service), and the song fades in and out at the ends. The result is an ordinary timeline, so it exports like any
other, on the GPU first. Nothing in the project changes.
"""
from __future__ import annotations

from typing import Callable

from app.services.media_probe import MediaFacts
from app.services.render_window import cut_exact
from app.services.timeline_schema import Format, Timeline, value_at

WIDTH, HEIGHT = 1080, 1920
SHORTEST, LONGEST = 5.0, 60.0  # YouTube Shorts are up to 60 seconds.
FADE_IN, FADE_OUT = 0.3, 1.5
PUSH = 1.12  # Shorts look: how much closer each picture moves over its time on screen.
EFFECT_LAYER = 'Effects'

Focus = Callable[[MediaFacts, float], 'tuple[float, float] | None']


def _sized(facts: MediaFacts, rotation: int) -> tuple[float, float]:
    width, height = float(facts.width or WIDTH), float(facts.height or HEIGHT)
    return (height, width) if rotation % 180 else (width, height)


def _cover(facts: MediaFacts, rotation: int) -> tuple[float, float, float]:
    """How much more than fitted a picture must be to fill the portrait frame, and its fitted size there (shares of it)."""
    width, height = _sized(facts, rotation)
    fit = min(WIDTH / width, HEIGHT / height)
    cover = max(WIDTH / width, HEIGHT / height)
    return cover / fit, width * fit / WIDTH, height * fit / HEIGHT


def _keys(transform: dict, name: str) -> list[dict]:
    return (transform.get('keyframes') or {}).get(name) or []


def _fill(clip: dict, facts: MediaFacts, focus: tuple[float, float] | None) -> None:
    """The clip fills the portrait frame, its zooms kept, its subject in the middle (as far as the picture's edges allow)."""
    rotation = int((clip.get('adjust') or {}).get('rotation') or 0)
    grow, wide, tall = _cover(facts, rotation)
    transform = clip.setdefault('transform', {})
    keys = transform.setdefault('keyframes', {})
    transform['scale'] = round(float(transform.get('scale', 1)) * grow, 6)
    for key in keys.get('scale') or []:
        key['v'] = round(min(8.0, key['v'] * grow), 6)
    # Sideways moves were made for the wide frame: the subject leads now. The least size it reaches decides how far it may go.
    keys.pop('x', None)
    keys.pop('y', None)
    least = min([transform['scale'], *(key['v'] for key in keys.get('scale') or [])])
    fx, fy = focus or (0.5, 0.5)
    for axis, share, point in (('x', wide, fx), ('y', tall, fy)):
        room = max(0.0, (least * share - 1) / 2)
        transform[axis] = round(min(0.5 + room, max(0.5 - room, 0.5 - (point - 0.5) * share * least)), 6)


def _grades_from(timeline: Timeline, start: float) -> Timeline:
    """Adjustment spans (a mood grade) under way at `start` begin there, at full strength: render_window can't cut one
    inside its fades, and a Short needs only to look right on its own, not to match the long video frame for frame."""
    if not any(layer.kind == 'adjust' for layer in timeline.layers):
        return timeline
    data = timeline.model_dump(by_alias=True, mode='json')
    for layer in data['layers']:
        if layer['kind'] != 'adjust':
            continue
        for item in layer['items']:
            stop = item['start'] + item['length']
            if item['start'] < start < stop:
                item.update(start=start, length=round(stop - start, 6), fade_in=0, fade_out=min(item.get('fade_out', 0), round((stop - start) / 2, 6)))
    return Timeline.model_validate(data)


def short_range(start: float, end: float, total: float) -> tuple[float, float]:
    """The stretch a Short takes: at least SHORTEST seconds and at most LONGEST, inside the video."""
    start = max(0.0, min(start, total))
    end = min(total, max(end, start + SHORTEST), start + LONGEST)
    if end - start < 1:
        raise ValueError('Choose at least a second of the video for a Short.')
    return start, end


def _push(clip: dict) -> None:
    """Shorts look: a slow push in on a picture that has no zoom of its own, about its subject (already in the middle)."""
    transform = clip['transform']
    keys = transform.setdefault('keyframes', {})
    if keys.get('scale'):
        return
    length = (clip['out'] - clip['in']) / clip.get('speed', 1)
    keys['scale'] = [{'t': 0.0, 'v': transform['scale'], 'ease': 'easeInOut'}, {'t': round(length, 6), 'v': round(min(8.0, transform['scale'] * PUSH), 6), 'ease': 'easeInOut'}]


def make_short(timeline: Timeline, start: float, end: float, media: Callable[[int], MediaFacts], focus: Focus, look: bool = False) -> Timeline:
    """`timeline` from `start` to `end` as a portrait Short. `look`: each picture without a zoom gets a slow push in.
    Raises ValueError when the stretch can't be cut exactly."""
    start, end = short_range(start, end, timeline.duration)
    part = cut_exact(_grades_from(timeline, start), start, end)
    if part is None:
        raise ValueError('Part of this stretch (a speed ramp, a pinned or tracked title) can’t be cut for a Short. Choose another stretch.')
    length = end - start
    data = part.model_dump(by_alias=True, mode='json')
    # A move under way at the cut keeps its first key before zero (render_window); a recipe can't, so it starts from where it is.
    for layer, model in zip(data['layers'], part.layers):
        for item, original in zip(layer['items'], model.items):
            keys = (item.get('transform') or {}).get('keyframes') or {}
            for name, values in keys.items():
                if values and values[0]['t'] < 0:
                    keys[name] = [{'t': 0.0, 'v': round(value_at(original.transform, name, 0), 6), 'ease': 'linear'}, *(key for key in values if key['t'] > 0)]
    data['format'] = Format(width=WIDTH, height=HEIGHT, fps=timeline.format.fps).model_dump()
    main = next((layer for layer in data['layers'] if layer['kind'] == 'video'), None)
    placed: dict[str, dict] = {}  # Clip id to its new transform, for a Pop-out's person, which moves with its picture.
    for layer in data['layers']:
        items = []
        for item in layer['items']:
            begin = item['start']
            if begin >= length - 1e-6:
                continue
            over = begin + (item['length'] if 'length' in item else (item['out'] - item['in']) / item.get('speed', 1)) - length
            if over > 1e-6:  # It ran past the end: it stops there.
                if 'length' in item:
                    item['length'] = round(item['length'] - over, 6)
                else:
                    item['out'] = round(item['out'] - over * item.get('speed', 1), 6)
                if 'exit' in item:
                    item['exit'] = None
            if begin < 1e-6 and 'transition_in' in item:
                item['transition_in'] = None  # The clip it came from is not in the Short.
            if layer['kind'] == 'audio':
                item['fade_in'] = max(item.get('fade_in', 0), FADE_IN) if begin < 1e-6 else item.get('fade_in', 0)
                if begin + (item['out'] - item['in']) / item.get('speed', 1) >= length - 1e-3:
                    item['fade_out'] = max(item.get('fade_out', 0), min(FADE_OUT, (item['out'] - item['in']) / item.get('speed', 1) / 2))
            if layer['kind'] == 'video' and (layer is main or layer.get('name') == EFFECT_LAYER):
                facts = media(item['media_id'])
                at = item.get('in', 0) if facts.media_type == 'video' else 0.0
                _fill(item, facts, focus(facts, at) if layer is main else None)
                if look and layer is main:
                    _push(item)
                placed[item['id']] = item['transform']
            items.append(item)
        layer['items'] = items
    for layer in data['layers']:
        if layer['kind'] != 'video' or layer is main:
            continue
        for item in layer['items']:
            owner = next((clip for clip in (main or {'items': []})['items'] if (clip.get('popout') or {}).get('person_clip_id') == item['id']), None)
            if owner is not None:
                item['transform'] = placed[owner['id']]
    return Timeline.model_validate(data)
