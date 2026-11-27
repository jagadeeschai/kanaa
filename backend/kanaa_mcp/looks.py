"""The editor's cinematic-look rules, for the MCP tools: the same as frontend/src/timeline/stack.ts (stacking looks),
velocity.ts (speed ramps on the beat), beatsync.ts (beat pulse and shake on the beat) and filmstock.ts (film stocks).
tests/test_mcp_cinematic.py runs both on the same clips and checks they agree, so an agent's edit is the editor's edit."""
from __future__ import annotations

import copy
import math
import statistics

# Looks stack in this order, each made from the one before (stack.ts LOOK_ORDER).
ORDER = ['match', 'new_sky', 'night', 'rays', 'atmosphere', 'lens', 'halation', 'shake', 'weave', 'breathing', 'slowmo', 'blur']
# Each look's link on the clip, its service route and its settings (all but the kind).
FIELD = {'match': 'colour_match', 'new_sky': 'new_sky', 'night': 'night', 'rays': 'rays', 'atmosphere': 'atmosphere', 'lens': 'lens',
         'halation': 'halation', 'shake': 'shake', 'weave': 'weave', 'breathing': 'breathing', 'slowmo': 'slowmo', 'blur': 'motion_blur'}
ROUTE = {'match': 'match', 'new_sky': 'sky', 'night': 'night', 'rays': 'rays', 'atmosphere': 'atmosphere', 'lens': 'lens', 'slowmo': 'slowmo',
         'blur': 'blur', 'halation': 'halation', 'shake': 'shake', 'weave': 'weave', 'breathing': 'breathing'}
CHOICES = {  # Each look's choices; the first is used when switched on without one.
    'new_sky': {'sky': ['sunset', 'night', 'storm', 'blue']}, 'night': {'mood': ['moonlit', 'dark']}, 'rays': {'preset': ['soft', 'strong', 'dusty']},
    'atmosphere': {'preset': ['mist', 'sunset', 'rain', 'low-fog'], 'strength': ['medium', 'light', 'heavy']},
    'lens': {'preset': ['portrait', 'dreamy', 'rack-out', 'rack-in'], 'strength': ['medium', 'soft', 'strong']},
    'halation': {'preset': ['classic', 'subtle', 'dreamy']}, 'shake': {'preset': ['docu', 'float', 'impact', 'beat']},
    'weave': {'preset': ['classic', 'subtle', 'worn']}, 'breathing': {'preset': ['classic', 'subtle', 'deep']},
    'slowmo': {'factor': [2, 4, 8]}, 'blur': {'preset': ['natural', 'dreamy', 'action']}, 'match': {}}
# Film stocks (filmstock.ts): one call sets these kinds, keeping the scene's own looks.
STOCK_KINDS = ['lens', 'halation', 'shake', 'weave', 'breathing', 'blur']
FILM_STOCKS = {
    'classic': [{'kind': 'halation', 'preset': 'classic'}, {'kind': 'weave', 'preset': 'subtle'}],
    'retro': [{'kind': 'halation', 'preset': 'dreamy'}, {'kind': 'weave', 'preset': 'worn'}, {'kind': 'breathing', 'preset': 'subtle'}],
    'docu': [{'kind': 'shake', 'preset': 'docu'}, {'kind': 'breathing', 'preset': 'subtle'}, {'kind': 'blur', 'preset': 'natural'}],
    'dream': [{'kind': 'lens', 'preset': 'dreamy', 'strength': 'medium'}, {'kind': 'halation', 'preset': 'dreamy'}, {'kind': 'shake', 'preset': 'float'}],
    'action': [{'kind': 'shake', 'preset': 'impact'}, {'kind': 'blur', 'preset': 'action'}],
}


def _r(value: float) -> float:
    """To the thousandth, halves up, as the editor's Math.round does (Python's round goes to even)."""
    return math.floor(value * 1000 + 0.5) / 1000


def by_order(looks: list[dict]) -> list[dict]:
    return sorted(looks, key=lambda look: ORDER.index(look['kind']))


def looks_of(clip: dict) -> list[dict]:
    """The looks on a clip, in order (stack.ts looksOf)."""
    found = []
    for kind in ORDER:
        link = clip.get(FIELD[kind])
        if not link:
            continue
        look: dict = {'kind': kind}
        if kind == 'match':
            look['reference'] = {'media': link['reference_media_id'], 'start': link['reference_in'], 'end': link['reference_out']}
        elif kind == 'slowmo':
            look['factor'] = link['factor']
        else:
            for name, options in CHOICES[kind].items():
                look[name] = link.get(name) or options[0]
            if kind == 'shake' and link.get('hits'):
                look['hits'] = link['hits']
        if kind != 'slowmo' and link.get('tune'):
            look['tune'] = link['tune']
        found.append(look)
    return found


def original_part(clip: dict) -> dict:
    """The original part every look on the clip is made from (stack.ts originalPart)."""
    link = next((clip[FIELD[kind]] for kind in ORDER if clip.get(FIELD[kind])), None)
    if link:
        return {'media': link['original_media_id'], 'start': link['original_in'], 'end': link['original_out']}
    return {'media': clip['media_id'], 'start': clip['in'], 'end': clip['out']}


def cannot_look(clip: dict, kind: str) -> str | None:
    """What stops a look from being added (stack.ts cannotLook)."""
    if clip.get('reverse') or clip.get('freeze') is not None or clip.get('freeze3d'):
        return 'These looks work on a clip that plays forwards (not reversed or frozen).'
    if kind == 'slowmo' and not clip.get('slowmo') and clip.get('ramp'):
        return 'Take off the speed ramp first; smooth slow motion makes its own.'
    if kind == 'slowmo' and not clip.get('slowmo') and clip.get('speed', 1) != 1:
        return 'Set the clip to normal speed first; smooth slow motion makes its own.'
    return None


def checked(look: dict) -> dict:
    """A look an agent asked for, kept to what Kanaa can make: a known kind and known choices (else the first)."""
    kind = look.get('kind')
    if kind not in ORDER:
        raise ValueError(f'Unknown look {kind!r}: choose from {", ".join(ORDER)}.')
    out: dict = {'kind': kind}
    if kind == 'match':
        reference = look.get('reference') or {}
        if not {'media', 'start', 'end'} <= set(reference):
            raise ValueError('A colour match needs reference {"media", "start", "end"}: the shot to match.')
        out['reference'] = {'media': int(reference['media']), 'start': float(reference['start']), 'end': float(reference['end'])}
    for name, options in CHOICES[kind].items():
        out[name] = look.get(name) if look.get(name) in options else options[0]
    if kind == 'shake' and look.get('hits'):
        out['hits'] = [float(hit) for hit in look['hits']]
    if kind != 'slowmo' and isinstance(look.get('tune'), dict) and look['tune']:
        out['tune'] = {str(key): float(value) for key, value in look['tune'].items()}
    return out


def with_stock(looks: list[dict], stock: str | None) -> list[dict]:
    """`looks` with film stock `stock` (None: none): its kinds replaced by the stock's, the rest kept (filmstock.ts withStock)."""
    if stock is not None and stock not in FILM_STOCKS:
        raise ValueError(f'Unknown film stock {stock!r}: choose from {", ".join(FILM_STOCKS)}.')
    kept = [look for look in looks if look['kind'] not in STOCK_KINDS]
    return by_order(kept + copy.deepcopy(FILM_STOCKS.get(stock, [])))


def set_looks(clip: dict, part: dict, looks: list[dict], made: dict | None) -> dict:
    """The clip playing `made` (the looks' last copy, {"media", "seconds"}), every look remembering the original part;
    or the original itself when there are no looks (stack.ts setLooks). Returns the changed clip."""
    clip = copy.deepcopy(clip)
    had_slow = bool(clip.get('slowmo'))  # Before: taking slow motion off gives the sound back.
    original = {'original_media_id': part['media'], 'original_in': part['start'], 'original_out': part['end']}
    has = {look['kind']: look for look in looks}
    was_steady = bool(clip.get('stabilise') or (clip.get('shake') or {}).get('steadied') or (clip.get('weave') or {}).get('steadied'))
    wobble, weave, slow = has.get('shake'), has.get('weave'), has.get('slowmo')
    if (wobble or weave) and clip.get('stabilise'):
        clip['stabilise'] = False
        rest = [each for each in clip.get('bypass') or [] if each != 'steady']
        clip['bypass'] = rest or None
    if not wobble and not weave and ((clip.get('shake') or {}).get('steadied') or (clip.get('weave') or {}).get('steadied')):
        clip['stabilise'] = True
    for kind in ORDER:
        look = has.get(kind)
        if not look:
            clip[FIELD[kind]] = None
            continue
        link = dict(original)
        if kind == 'match':
            link.update(reference_media_id=look['reference']['media'], reference_in=look['reference']['start'], reference_out=look['reference']['end'])
        elif kind == 'slowmo':
            link['factor'] = look['factor']
        else:
            for name in CHOICES[kind]:
                link[name] = look[name]
            if kind == 'shake' and look.get('hits'):
                link['hits'] = look['hits']
        if kind != 'slowmo':
            link['tune'] = look.get('tune')
        if kind in ('shake', 'weave') and was_steady:
            link['steadied'] = True
        clip[FIELD[kind]] = link
    if made is None:
        clip.update(media_id=part['media'], **{'in': part['start'], 'out': part['end']})
        if had_slow:
            clip['muted'] = False
        return clip
    clip.update(media_id=made['media'], **{'in': 0, 'out': made['seconds']})
    if slow:
        clip['muted'] = True  # Slow motion's copy has no sound.
    elif had_slow:
        clip['muted'] = False
    return clip


def length_after(seconds: float, look: dict) -> float:
    return seconds * look['factor'] if look['kind'] == 'slowmo' else seconds


# Beats (velocity.ts, beatsync.ts).
VELOCITY = {'smooth': (0.5, 1.6, 0.3), 'punchy': (0.25, 2.6, 0.18), 'dramatic': (0.15, 3.2, 0.32)}  # slow, fast, hold
MIN_RAMP, MAX_RAMP = 0.05, 10.0


def clip_length(clip: dict) -> float:
    return (clip['out'] - clip['in']) / clip.get('speed', 1)


def velocity_ramp(clip: dict, beats: list[float], name: str) -> list[dict] | None:
    """A speed ramp from the song's beats (timeline seconds): slow on each beat, fast between (velocity.ts velocityRamp)."""
    if name not in VELOCITY:
        raise ValueError(f'Choose a velocity: {", ".join(VELOCITY)}.')
    length = clip_length(clip)
    hits = [(beat - clip['start']) / length for beat in sorted(beats) if clip['start'] < beat < clip['start'] + length]
    if len(hits) < 2 or (hits[1] - hits[0]) * length < 0.25:
        return None
    while len(hits) * 3 + 2 > 20:
        hits = [hit for n, hit in enumerate(hits) if n % 2 == 0]
    slow, fast, hold = VELOCITY[name]
    gap = min(b - a for a, b in zip(hits, hits[1:])) if len(hits) > 1 else 1
    half = gap * hold / 2
    points = [{'t': 0, 'v': fast}]
    for n, hit in enumerate(hits):
        wanted = [(hit - half, slow), (hit + half, slow)] + ([((hit + hits[n + 1]) / 2, fast)] if n + 1 < len(hits) else [])
        for t, v in wanted:
            if points[-1]['t'] + 1e-3 < t < 1 - 1e-3:
                points.append({'t': _r(t), 'v': min(MAX_RAMP, max(MIN_RAMP, v))})
    points.append({'t': 1, 'v': fast})
    return [{'t': point['t'], 'v': min(MAX_RAMP, max(MIN_RAMP, point['v']))} for point in points]


def pulse_for(clip: dict, beats: list[float], base: dict) -> dict | None:
    """A beat pulse on the song's tempo, its first beat on the clip's first beat (beatsync.ts pulseFor)."""
    ordered = sorted(beats)
    gaps = sorted(g for g in (b - a for a, b in zip(ordered, ordered[1:])) if 0.15 < g < 2)
    if not gaps:
        return None
    interval = gaps[len(gaps) // 2]
    first = next((beat for beat in ordered if clip['start'] - 1e-6 <= beat < clip['start'] + clip_length(clip)), None)
    if first is None:
        return None
    return {**base, 'bpm': max(30, min(300, _r(60 / interval))), 'offset': _r((first - clip['start']) % interval)}


def _segments(ramp: list[dict]) -> list[tuple]:
    mean = sum((b['t'] - a['t']) * (a['v'] + b['v']) / 2 for a, b in zip(ramp, ramp[1:]))
    out, x = [], 0.0
    for a, b in zip(ramp, ramp[1:]):
        r0, r1 = a['v'] / mean, b['v'] / mean
        out.append((a['t'], b['t'], r0, r1, x)); x += (b['t'] - a['t']) * (r0 + r1) / 2
    return out


def ramp_share(ramp: list[dict], u: float) -> float:
    """The share of the source played after `u` of the clip's time (ramp.ts rampShare)."""
    parts = _segments(ramp)
    if u <= 0:
        return u * parts[0][2]
    t0, t1, r0, r1, x0 = next((part for part in parts if u <= part[1]), parts[-1])
    if u >= 1:
        return 1 + (u - 1) * parts[-1][3]
    d = u - t0
    return x0 + r0 * d + (r1 - r0) / (t1 - t0) * d * d / 2


def source_at(clip: dict, local: float) -> float:
    """Media seconds shown `local` seconds into a clip (ramp.ts sourceAt)."""
    span = clip['out'] - clip['in']
    into = ramp_share(clip['ramp'], local / clip_length(clip)) * span if clip.get('ramp') else local * clip.get('speed', 1)
    return clip['out'] - into if clip.get('reverse') else clip['in'] + into


def hits_for(clip: dict, beats: list[float]) -> list[float]:
    """The beats inside the clip as seconds into the part its looks are made from (beatsync.ts hitsFor)."""
    part = original_part(clip)
    made = part['media'] != clip['media_id']
    slower = (clip.get('slowmo') or {}).get('factor', 1)
    out = []
    for beat in beats:
        if clip['start'] <= beat < clip['start'] + clip_length(clip):
            at = source_at(clip, beat - clip['start'])
            hit = _r(at / slower if made else at - part['start'])
            if 0 <= hit <= part['end'] - part['start']:
                out.append(hit)
    return out


def song_tempo(beats: list[float]) -> float:
    gaps = [b - a for a, b in zip(beats, beats[1:]) if 0.15 < b - a < 2]
    return round(60 / statistics.median(gaps), 2) if gaps else 0.0
