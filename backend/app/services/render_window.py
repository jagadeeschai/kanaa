"""A short look at one moment of a long timeline, without working through everything before it.

cut() keeps only what shows between `start` and `end` and moves it so `start` is at zero: items that began earlier are
trimmed to their remaining part (a clip from later in its source, a title already entered, its moves and karaoke words
carried on from where they were), items that ended earlier or begin later are left out. ffmpeg then has a handful of
inputs and no frames to work through before the moment, so a look at minute four takes as long as one at the start.

A speed ramp is cut exactly: the rest of its curve, at the speed that plays the rest of its source over the time left.
When an item cannot be trimmed exactly (a tracked or pinned title), the timeline is used whole, as before.
"""
from __future__ import annotations

import copy

from app.services.timeline_schema import Keyframe, Timeline, Transform, frame_at, value_at

UNSAFE = ('keep_clear', 'pin', 'stay_with', 'focus_pull')  # Times inside these are not simply shifted.


class _Whole(Exception):
    """This timeline is used whole."""


def _length(item: dict) -> float:
    return item['length'] if 'length' in item else (item['out'] - item['in']) / item.get('speed', 1)


def _shift_keys(transform: dict | None, by: float) -> dict[str, list[dict]]:
    """Keyframes as seen `by` seconds into the item. The move under way keeps its own first key, now before zero, so
    an eased move carries on along the same curve (easing again from the cut would draw a different one). Keys can't
    be before zero in a recipe, so those moves get a stand-in here (the value at the cut as the first key) and are
    returned, by property, to be put back once the timeline is built."""
    if not transform or not transform.get('keyframes'):
        return {}
    model = Transform.model_validate(transform)
    early = {}
    for name, keys in list(transform['keyframes'].items()):
        if not keys:
            continue
        later = [{**key, 't': round(key['t'] - by, 6)} for key in keys if key['t'] > by]
        under_way = [key for key in keys if key['t'] <= by]
        if later and under_way:
            exact = [{**under_way[-1], 't': round(under_way[-1]['t'] - by, 6)}, *later]
            if exact[0]['t'] >= 0:
                transform['keyframes'][name] = exact
                continue
            early[name] = exact
        transform['keyframes'][name] = [{'t': 0, 'v': value_at(model, name, by), 'ease': 'linear'}, *later]
    return early


def _trim(item: dict, by: float, gone: float | None = None) -> dict[str, list[dict]]:
    """Item `item` from `by` seconds into its own clock on, as if it had started there; `gone` (default `by`) is how
    much of its length is cut off, so it still ends when it did. Returns _shift_keys's moves to put back."""
    gone = by if gone is None else gone
    if any(item.get(key) for key in UNSAFE):
        raise _Whole()
    early = _shift_keys(item.get('transform'), by)
    if 'enter' in item:
        item['enter'] = None  # It has already come in.
    if 'in' in item and item.get('ramp'):
        # A speed ramp: the rest of its curve, and the speed that plays the rest of the source over the time left.
        from app.services.ramp import ramp_part
        from app.services.timeline_schema import RampPoint
        length = _length(item)
        u0, u1 = by / length, (length - (gone - by)) / length
        if not 0 <= u0 < u1 <= 1:
            raise _Whole()
        ramp = [RampPoint(**point) for point in item['ramp']]
        points, x0, x1 = ramp_part(ramp, u0, u1)
        span = item['out'] - item['in']
        item['in'], item['out'] = round(item['in'] + x0 * span, 6), round(item['in'] + x1 * span, 6)
        item['speed'] = (item['out'] - item['in']) / (length - gone)  # Unrounded: the clip must end exactly where it did.
        item['ramp'] = points
        item['fade_in'] = 0
        if 'transition_in' in item:
            item['transition_in'] = None
        if not 0.05 <= item['speed'] <= 20:
            raise _Whole()
    elif 'in' in item:  # A clip or a sound: later in its source.
        item['in'] = round(item['in'] + by * item.get('speed', 1), 6)
        item['out'] = round(item['out'] - (gone - by) * item.get('speed', 1), 6)
        item['fade_in'] = 0
        if 'transition_in' in item:
            item['transition_in'] = None
        if item.get('beat_pulse'):
            pulse = item['beat_pulse']
            pulse['offset'] = round((pulse['offset'] - by) % (60 / pulse['bpm']), 6)
    else:  # A title, caption, blur box or adjustment: shorter, and what is said in it carries on.
        item['length'] = round(item['length'] - gone, 6)
        if 'fade_in' in item:  # An adjustment span: already faded in, or it can't be cut exactly.
            if by < item['fade_in'] or item['length'] / 2 < item.get('fade_out', 0):
                raise _Whole()
            item['fade_in'] = 0
        if item.get('karaoke'):
            item['karaoke']['words'] = [round(max(0.0, at - by), 6) for at in item['karaoke']['words']]
        for word in item.get('words') or []:
            word['s'] = round(max(0.0, word['s'] - by), 6)
    return early


def _slice(timeline: Timeline, start: float, end: float) -> Timeline:
    """The part from `start` to `end` moved to start at zero; raises _Whole when something cannot be trimmed exactly."""
    data = timeline.model_dump(by_alias=True, mode='json')
    put_back = []  # (layer, item, property, keys): moves whose first key is before zero.
    fps = timeline.format.fps
    for number, layer in enumerate(data['layers']):
        kept = []
        for item in layer['items']:
            begin, finish = item['start'], item['start'] + _length(item)
            if finish <= start or begin >= end:
                continue
            item = copy.deepcopy(item)
            if begin < start:
                # The export starts an item on its rounded frame and runs its clock from there, so its clock is
                # trimmed by whole frames (by the true seconds, its moves and beats would land a fraction of a frame
                # off), while it still ends when it did. (A clip's frame as clip_frames; a title's as its tpad; sound
                # is laid by the second.)
                frame = {'video': lambda s: frame_at(s, fps), 'audio': None}.get(layer['kind'], lambda s: round(s * fps))
                by = (frame(start) - frame(begin)) / fps if frame else start - begin
                put_back += [(number, len(kept), name, keys) for name, keys in _trim(item, by, start - begin).items()]
                item['start'] = 0.0
            else:
                item['start'] = round(begin - start, 6)
            kept.append(item)
        layer['items'] = kept
    result = Timeline.model_validate(data)
    for number, index, name, keys in put_back:
        result.layers[number].items[index].transform.keyframes[name] = [Keyframe.model_construct(**key) for key in keys]
    return result


def cut(timeline: Timeline, start: float, end: float) -> tuple[Timeline, float]:
    """The part of `timeline` from `start` to `end`, moved to start at zero, and how far it moved (0: used whole)."""
    if start <= 0:
        return timeline, 0.0
    try:
        return _slice(timeline, start, end), start
    except Exception:  # Anything not cut exactly: the whole timeline, which is always right, only slower.
        return timeline, 0.0


def cut_exact(timeline: Timeline, start: float, end: float) -> Timeline | None:
    """Like cut(), for a final export's slice: from zero too (later items left out), and None instead of the whole
    timeline when anything cannot be cut exactly, so the caller can choose another way."""
    try:
        return _slice(timeline, max(0.0, start), end)
    except Exception:
        return None
