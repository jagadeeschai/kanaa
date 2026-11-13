"""A short look at one moment of a long timeline, without working through everything before it.

cut() keeps only what shows between `start` and `end` and moves it so `start` is at zero: items that began earlier are
trimmed to their remaining part (a clip from later in its source, a title already entered, its moves and karaoke words
carried on from where they were), items that ended earlier or begin later are left out. ffmpeg then has a handful of
inputs and no frames to work through before the moment, so a look at minute four takes as long as one at the start.

When an item cannot be trimmed exactly (a speed ramp, a tracked or pinned title), the timeline is used whole, as before.
"""
from __future__ import annotations

import copy

from app.services.timeline_schema import Timeline, Transform, value_at

UNSAFE = ('ramp', 'keep_clear', 'pin', 'stay_with', 'focus_pull')  # Times inside these are not simply shifted.


class _Whole(Exception):
    """This timeline is used whole."""


def _length(item: dict) -> float:
    return item['length'] if 'length' in item else (item['out'] - item['in']) / item.get('speed', 1)


def _shift_keys(transform: dict | None, by: float) -> None:
    """Keyframes as seen `by` seconds into the item: the value there becomes the first key."""
    if not transform or not transform.get('keyframes'):
        return
    model = Transform.model_validate(transform)
    for name, keys in list(transform['keyframes'].items()):
        if not keys:
            continue
        later = [{**key, 't': round(key['t'] - by, 6)} for key in keys if key['t'] > by]
        transform['keyframes'][name] = [{'t': 0, 'v': value_at(model, name, by), 'ease': 'linear'}, *later]


def _trim(item: dict, by: float) -> None:
    """Item `item` from `by` seconds into it on, as if it had started there."""
    if any(item.get(key) for key in UNSAFE):
        raise _Whole()
    _shift_keys(item.get('transform'), by)
    if 'enter' in item:
        item['enter'] = None  # It has already come in.
    if 'in' in item:  # A clip or a sound: later in its source.
        item['in'] = round(item['in'] + by * item.get('speed', 1), 6)
        item['fade_in'] = 0
        if 'transition_in' in item:
            item['transition_in'] = None
        if item.get('beat_pulse'):
            pulse = item['beat_pulse']
            pulse['offset'] = round((pulse['offset'] - by) % (60 / pulse['bpm']), 6)
    else:  # A title, caption or blur box: shorter, and what is said in it carries on.
        item['length'] = round(item['length'] - by, 6)
        if item.get('karaoke'):
            item['karaoke']['words'] = [round(max(0.0, at - by), 6) for at in item['karaoke']['words']]
        for word in item.get('words') or []:
            word['s'] = round(max(0.0, word['s'] - by), 6)


def _slice(timeline: Timeline, start: float, end: float) -> Timeline:
    """The part from `start` to `end` moved to start at zero; raises _Whole when something cannot be trimmed exactly."""
    data = timeline.model_dump(by_alias=True, mode='json')
    for layer in data['layers']:
        kept = []
        for item in layer['items']:
            begin, finish = item['start'], item['start'] + _length(item)
            if finish <= start or begin >= end:
                continue
            item = copy.deepcopy(item)
            if begin < start:
                _trim(item, start - begin)
                item['start'] = 0.0
            else:
                item['start'] = round(begin - start, 6)
            kept.append(item)
        layer['items'] = kept
    return Timeline.model_validate(data)


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
