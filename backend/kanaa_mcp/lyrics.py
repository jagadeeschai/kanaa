"""Lyric videos for the MCP server: reading LRC files, and dressing the lyric screen's timeline into a finished,
dynamic video (a different entrance each line, light overlays, slow camera moves, film-style credits and a logo).

The base timeline comes from the lyric screen's own code (frontend/scripts/lyric-timeline.mjs), so a lyric video made
by an agent is the same as one made by hand. Everything here only rewrites that timeline; nothing is exported.
"""
from __future__ import annotations

import copy
import json
import re
import subprocess
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[2] / 'frontend'
ADJUST = {'rotation': 0, 'flip_horizontal': False, 'flip_vertical': False, 'brightness': 1, 'contrast': 1, 'saturation': 1}
OPENING = 8.0  # Seconds of film-style opening cards before the song.
CLOSING = 7.0  # Seconds of the closing credits card.
LIGHT_SECONDS = 10.0  # Each scene opens with this much of its light overlay.

# Ready-made looks: lyric entrances (cycled line by line), exits, and light overlays (cycled scene by scene).
LOOKS = {
    'energetic': {'enter': ['blast', 'chromatic', 'prism', 'pop-letters', 'split', 'expand', 'push-through', 'gravity'],
                  'exit': ['magic-vanish', 'blur-sideways', 'fade'],
                  'light': ['sun-rays', 'lens-flare', 'anamorphic', 'light-leak', 'embers', 'prism-leak']},
    'romantic': {'enter': ['rise-behind', 'magic-form', 'rise-behind', 'soft-edge', 'rise-behind', 'particle-form', 'rise-behind', 'reveal'],
                 'exit': ['fade', 'magic-vanish', 'blur'],
                 'light': ['fireflies', 'bokeh', 'sparkles', 'lanterns', 'fog', 'sea-sparkle']},
    'calm': {'enter': ['soft-edge', 'reveal', 'fade', 'line', 'blur-sideways'],
             'exit': ['fade', 'blur'],
             'light': ['dust', 'bokeh', 'fog', 'light-leak']},
}


def read_lrc(text: str, tail: float = 4.0, longest: float = 7.0) -> list[dict]:
    """Timed lines from an LRC file: [mm:ss.xx]words. Stage directions in brackets are left out, a fragment of two
    letters or fewer joins the line before it, and each line lasts until the next (at most `longest` seconds)."""
    lines: list[tuple[float, str]] = []
    for raw in text.splitlines():
        stamps = re.findall(r'\[(\d+):(\d+(?:\.\d+)?)\]', raw)
        words = re.sub(r'\[[^\]]*\]', '', raw).strip()
        if not stamps or not words:
            continue
        for minutes, seconds in stamps:
            at = int(minutes) * 60 + float(seconds)
            if len(words) <= 2 and lines:
                lines[-1] = (lines[-1][0], lines[-1][1] + words)
            else:
                lines.append((at, words))
    lines.sort()
    cues = []
    for index, (at, words) in enumerate(lines):
        after = lines[index + 1][0] if index + 1 < len(lines) else at + tail
        cues.append({'start': round(at, 2), 'end': round(max(at + 0.3, min(after - 0.05, at + longest)), 2), 'text': words})
    return cues


def base_timeline(handoff: dict) -> dict:
    """The lyric screen's timeline for this handoff, from its own code."""
    result = subprocess.run(['node', 'scripts/lyric-timeline.mjs'], input=json.dumps(handoff, ensure_ascii=False), capture_output=True, text=True, cwd=FRONTEND, timeout=60)
    if result.returncode:
        raise RuntimeError(f'Could not build the lyric timeline: {result.stderr.strip()[-400:]}')
    return json.loads(result.stdout)


def length_of(item: dict) -> float:
    return item['length'] if 'length' in item else (item['out'] - item['in']) / item.get('speed', 1)


def lay_out(timeline: dict) -> None:
    """The main track end to end, as the editor's magnetic track lays it out."""
    at = 0.0
    for clip in timeline['layers'][0]['items']:
        clip['start'] = round(at, 3)
        at += length_of(clip)


def dress(timeline: dict, look: str, lights: dict[str, int], camera_moves: bool = True) -> None:
    """A different entrance each line (3D letters kept), a slow pan or zoom per scene on top of its 3D glide (copied to
    the In front layer so it stays lined up), and light overlays (media ids of 5-second effects) over each scene's opening."""
    style = LOOKS[look]
    lines = [item for layer in timeline['layers'] if layer['kind'] == 'text' for item in layer['items'] if item['id'].startswith('lyric-line')]
    for index, line in enumerate(lines):
        preset = style['enter'][index % len(style['enter'])]
        line['enter'] = {'preset': preset, 'duration': round(min(1.2 if preset == 'rise-behind' else 0.8, max(0.3, line['length'] / 3)), 2)}
        line['exit'] = {'preset': style['exit'][index % len(style['exit'])], 'duration': round(min(0.4, line['length'] / 5), 2)}
    scenes = [clip for clip in timeline['layers'][0]['items'] if clip['id'].startswith('lyric-scene-')]
    moves = ['pan-left', 'zoom-in', 'pan-right', 'zoom-out']
    camera = {}
    for index, clip in enumerate(scenes if camera_moves else []):
        length, move = round(length_of(clip), 3), moves[index % len(moves)]
        keys = ({'x': [{'t': 0, 'v': 0.53, 'ease': 'easeInOut'}, {'t': length, 'v': 0.47, 'ease': 'easeInOut'}]} if move == 'pan-left'
                else {'x': [{'t': 0, 'v': 0.47, 'ease': 'easeInOut'}, {'t': length, 'v': 0.53, 'ease': 'easeInOut'}]} if move == 'pan-right'
                else {'scale': [{'t': 0, 'v': 1.0 if move == 'zoom-in' else 1.1, 'ease': 'easeInOut'}, {'t': length, 'v': 1.1 if move == 'zoom-in' else 1.0, 'ease': 'easeInOut'}]})
        clip['transform'] = {**clip['transform'], 'scale': 1.07, 'keyframes': keys}
        camera[clip['id']] = clip['transform']
    front = next((layer for layer in timeline['layers'] if layer.get('name') == 'In front'), None)
    for clip in front['items'] if front else []:
        clip['transform'] = copy.deepcopy(camera[clip['id'].removesuffix('-front')])
    names = [name for name in style['light'] if name in lights]
    if not names:
        return
    pieces = []
    for index, clip in enumerate(scenes):
        at, end = clip['start'], clip['start'] + min(LIGHT_SECONDS, length_of(clip))
        while at < end - 0.1:
            piece = min(5.0, end - at)
            pieces.append({'id': f'light-{len(pieces) + 1}', 'media_id': lights[names[index % len(names)]], 'start': round(at, 3), 'in': 0, 'out': round(piece, 3), 'speed': 1,
                           'volume': 0, 'muted': True, 'fade_in': 0, 'fade_out': 0, 'transform': {'x': 0.5, 'y': 0.5, 'scale': 1, 'opacity': 0.85, 'rotation': 0}, 'adjust': dict(ADJUST)})
            at += piece
    timeline['layers'].insert(1, {'id': 'lyric-light', 'kind': 'video', 'name': 'Effects', 'blend': 'screen', 'items': pieces})


def credits(timeline: dict, title: str, presents: str | None, song_by: str | None, music: str | None, presented_by: str | None,
            footer: str | None, accent: str, logo: dict | None) -> None:
    """Film-style cards: an 8-second opening (who presents, whose song, then the title with a small line), the song
    after it, and a separate closing card (the logo, then each role in small spaced capitals above its name). The logo
    also sits small in the bottom-right corner while the song plays. Letter spacing is used only on English words:
    spacing Tamil splits its letters apart. `logo`: {"media_id", "width", "height"} or None."""
    fmt = timeline['format']
    shift = OPENING - 3.0  # The lyric screen makes a 3-second opening.
    for layer in timeline['layers']:
        for item in layer['items']:
            if item.get('id') == 'credit-opening-bg':
                item['out'] = item['in'] + OPENING
            elif item.get('start', 0) >= 3.0 - 1e-6:
                item['start'] = round(item['start'] + shift, 3)
    main = timeline['layers'][0]['items']
    opening = next(clip for clip in main if clip['id'] == 'credit-opening-bg')
    closing = next(clip for clip in main if clip['id'] == 'credit-closing-bg')
    opening.update(adjust={**ADJUST, **opening.get('adjust', {}), 'brightness': 0.45, 'saturation': 0.8},
                   transform={'x': 0.5, 'y': 0.5, 'scale': 1.05, 'opacity': 1, 'rotation': 0, 'keyframes': {'scale': [{'t': 0, 'v': 1.05, 'ease': 'linear'}, {'t': OPENING, 'v': 1.15, 'ease': 'linear'}]}})
    closing.update(out=closing['in'] + CLOSING, adjust={**ADJUST, **closing.get('adjust', {}), 'brightness': 0.28, 'saturation': 0.55},
                   transform={'x': 0.5, 'y': 0.5, 'scale': 1.12, 'opacity': 1, 'rotation': 0, 'keyframes': {'scale': [{'t': 0, 'v': 1.12, 'ease': 'linear'}, {'t': CLOSING, 'v': 1.04, 'ease': 'linear'}]}})
    end = closing['start']

    def card(card_id, start, length, text, size, y, label=None, delay=0.0, colour='#ffffff', enter='soft-edge'):
        item = {'id': card_id, 'start': round(start + delay, 3), 'length': round(length - delay, 3), 'text': text, 'style': 'shadow', 'position': 'center', 'color': colour,
                'size': size, 'align': 'center', 'font': 'Avenir Next', 'tamil_font': 'Arima', 'enter': {'preset': enter, 'duration': 0.9}, 'exit': {'preset': 'fade', 'duration': 0.6},
                'transform': {'x': 0.5, 'y': y, 'scale': 1, 'opacity': 1, 'rotation': 0}}
        if label:
            item.update(subtitle=label, subtitle_above=True, subtitle_size=15, subtitle_color=accent, subtitle_spacing=6 if label.isascii() else 0)
        return item

    words = next(layer for layer in timeline['layers'] if layer['kind'] == 'text')
    items = [item for item in words['items'] if item['id'] not in ('opening-credit', 'closing-credit')]
    if presents:
        items.append(card('opening-1', 0.3, 2.6, presents, 30, 0.5, colour=accent) | {'subtitle': 'PRESENTS', 'subtitle_above': False, 'subtitle_size': 16, 'subtitle_color': accent,
                                                                                 'subtitle_spacing': 10, 'spacing': 6 if presents.isascii() else 0})
    if song_by:
        items.append(card('opening-2', 3.0, 2.4, song_by, 38, 0.5, label='A SONG BY'))
    items.append(card('opening-3', 5.5, 2.5, title, 72, 0.47, enter='reveal'))
    words['items'] = sorted(items, key=lambda item: item['start'])
    lines = []
    if footer:
        lines.append(card('opening-foot', 5.5, 2.5, footer, 15, 0.62, delay=0.5, colour='#d8d2e6', enter='fade'))
    roles = [(song_by, 'LYRICS', 32), (music, 'MUSIC', 28), (presented_by, 'PRESENTED BY', 28)]
    places = iter([0.47, 0.62, 0.77])
    for number, (name, role, size) in enumerate(roles):
        if name:
            lines.append(card(f'closing-{number + 1}', end, CLOSING, name, size, next(places), label=role, delay=0.6 * (number + 1)))
    if footer:
        lines.append(card('closing-foot', end, CLOSING, footer, 15, 0.93, delay=2.4, colour='#b9b4c6', enter='fade'))
    at = timeline['layers'].index(words) + 1
    for number, line in enumerate(lines):  # Shown together, so each on its own text layer.
        timeline['layers'].insert(at + number, {'id': f'credits-{number + 1}', 'kind': 'text', 'name': f'Credits {number + 1}', 'items': [line]})
    timeline['layers'] = [layer for layer in timeline['layers'] if layer['id'] != 'brand']
    if logo:
        fit = min(fmt['width'] / logo['width'], fmt['height'] / logo['height'])
        w, h, margin = logo['width'] * fit * 0.11, logo['height'] * fit * 0.11, 0.035 * fmt['height']

        def logo_clip(clip_id, start, stop, x, y, scale, opacity):
            return {'id': clip_id, 'media_id': logo['media_id'], 'start': round(start, 3), 'in': 0, 'out': round(stop - start, 3), 'speed': 1, 'volume': 0, 'muted': True,
                    'fade_in': 0, 'fade_out': 0, 'transform': {'x': x, 'y': y, 'scale': scale, 'opacity': opacity, 'rotation': 0}, 'adjust': dict(ADJUST),
                    'enter': {'preset': 'fade', 'duration': 1.0}}
        last_video = max(index for index, layer in enumerate(timeline['layers']) if layer['kind'] == 'video')
        timeline['layers'].insert(last_video + 1, {'id': 'brand', 'kind': 'video', 'name': 'Brand', 'items': [
            logo_clip('brand-logo', OPENING, end, round((fmt['width'] - margin - w / 2) / fmt['width'], 4), round((fmt['height'] - margin - h / 2) / fmt['height'], 4), 0.11, 0.85),
            logo_clip('closing-logo', end + 0.2, end + CLOSING, 0.5, 0.2, 0.26, 1)]})


# ---- "From behind, into the clear": each line starts behind the nearest person, then glides into the clear space. ----

BAND = (0.62, 0.86)  # Where the lyric lines sit, as shares of the picture's height.
LINE_Y = 0.74
GLIDE = (0.4, 1.6)  # Seconds into the line: it waits behind them, then is clear by the second time.
COVER_SECONDS = 1.9  # People pass in front only until the line has moved clear; after that nothing covers it.
CHAR_WIDTH = 0.97  # A Tamil or English letter's width, in units of the text size, measured on Kanaa's titles.


def spaces(mask, band: tuple[float, float] = BAND, min_share: float = 0.05) -> dict:
    """Where people are across the lyric band of a picture (a boolean person mask, source size), and its widest clear
    stretch, all as shares of the picture's width: {"people": [[x0, x1], ...], "clear": [x0, x1]}."""
    import numpy as np
    height, width = mask.shape
    rows = mask[int(height * band[0]):int(height * band[1])]
    taken = rows.mean(axis=0) > min_share
    people, clear, run_start = [], (0, 0), None
    for x, on in enumerate(list(taken) + [False]):
        if on and run_start is None:
            run_start = x
        if not on and run_start is not None:
            people.append([run_start / width, x / width]); run_start = None
    edges = [0.0] + [edge for span in people for edge in span] + [1.0]
    gaps = [(edges[i], edges[i + 1]) for i in range(0, len(edges), 2)]
    clear = max(gaps, key=lambda gap: gap[1] - gap[0]) if gaps else (0.0, 1.0)
    return {'people': [span for span in people if span[1] - span[0] > 0.02], 'clear': [round(clear[0], 4), round(clear[1], 4)]}


def fit_text(text: str, size: int, room: float, frame_width: int) -> tuple[str, int]:
    """The line, split onto two at the space nearest its middle when it is wider than `room` (share of the frame), and a
    smaller size when even that does not fit."""
    width = lambda words, at: len(words) * at * CHAR_WIDTH / 1920  # Title sizes are in 1080p pixels.
    if width(text, size) <= room or ' ' not in text.strip():
        lines = [text]
    else:
        middle = len(text) / 2
        cut = min((i for i, ch in enumerate(text) if ch == ' '), key=lambda i: abs(i - middle))
        lines = [text[:cut].strip(), text[cut + 1:].strip()]
    longest = max(len(line) for line in lines)
    while size > 26 and longest * size * CHAR_WIDTH / 1920 > room:
        size -= 2
    return '\n'.join(lines), size


def into_clear(timeline: dict, scenes: dict[str, dict], still: dict[str, int]) -> None:
    """Moves each lyric line from behind the person nearest the clear space into that space, per scene.
    scenes: main-track clip id -> spaces() of its picture (source shares) plus its "size" [width, height]; still: clip id -> its still video's media id
    (the same picture as a video, so Kanaa can cut the people out of it). The scene clips are set to fill the frame and
    hold still, so where the people are on the frame is exactly where they are in the picture."""
    fmt = timeline['format']
    main = timeline['layers'][0]['items']
    clips = {clip['id']: clip for clip in main if clip['id'] in scenes}
    share = {}
    for clip_id, clip in clips.items():
        w, h = scenes[clip_id]['size']
        fit = min(fmt['width'] / w, fmt['height'] / h)
        fw, fh = w * fit / fmt['width'], h * fit / fmt['height']
        fill = max(1 / fw, 1 / fh)
        clip['transform'] = {'x': 0.5, 'y': 0.5, 'scale': round(fill, 4), 'opacity': 1, 'rotation': 0}
        share[clip_id] = fill * fw  # The picture's width as a share of the frame's.
    cover = []
    for layer in timeline['layers']:
        if layer['kind'] != 'text':
            continue
        for line in layer['items']:
            if not line['id'].startswith('lyric-line'):
                continue
            clip = next((c for c in clips.values() if c['start'] <= line['start'] < c['start'] + length_of(c)), None)
            if clip is None:
                continue
            space = scenes[clip['id']]
            scale_x = share[clip['id']]
            to_frame = lambda sx: 0.5 + (sx - 0.5) * scale_x
            left, right = to_frame(space['clear'][0]), to_frame(space['clear'][1])
            left, right = max(left, 0.04), min(right, 0.96)
            text, size = fit_text(line['text'], line['size'], (right - left) * 0.92, fmt['width'])
            end_x = round((left + right) / 2, 4)
            line.update(text=text, size=size, enter={'preset': 'fade', 'duration': 0.3}, exit={'preset': 'fade', 'duration': round(min(0.4, line['length'] / 5), 2)})
            line.pop('depth', None)
            people = [[to_frame(a), to_frame(b)] for a, b in space['people']]
            if not people:
                line['transform'] = {'x': end_x, 'y': LINE_Y, 'scale': 1, 'opacity': 1, 'rotation': 0}
                continue
            # Start behind the person nearest the clear space, then glide there.
            near = min(people, key=lambda span: abs((span[0] + span[1]) / 2 - end_x))
            start_x = round((near[0] + near[1]) / 2, 4)
            line['transform'] = {'x': start_x, 'y': LINE_Y, 'scale': 1, 'opacity': 1, 'rotation': 0,
                                 'keyframes': {'x': [{'t': 0, 'v': start_x, 'ease': 'linear'}, {'t': GLIDE[0], 'v': start_x, 'ease': 'easeInOut'}, {'t': GLIDE[1], 'v': end_x, 'ease': 'linear'}]}}
            into = round(line['start'] - clip['start'], 3)
            cover.append({'id': f"{line['id']}-front", 'media_id': still[clip['id']], 'start': line['start'], 'in': into, 'out': round(into + min(COVER_SECONDS, line['length']), 3),
                          'speed': 1, 'volume': 0, 'muted': True, 'fade_in': 0, 'fade_out': 0, 'transform': dict(clip['transform']), 'adjust': dict(ADJUST),
                          'cutout': 'remove', 'cutout_pick': None, 'depth_gap': 1})
        break
    timeline['layers'] = [layer for layer in timeline['layers'] if layer.get('name') != 'In front']
    words_at = next(index for index, layer in enumerate(timeline['layers']) if layer['kind'] == 'text')
    timeline['layers'].insert(words_at + 1, {'id': 'lyric-in-front', 'kind': 'video', 'name': 'Person', 'items': cover})


def prepend_intro(timeline: dict, media_id: int, seconds: float = 5.5, cards: float = 5.0) -> None:
    """Opens the video with the brand intro (it says who presents, so that card goes), then the song credit and the
    title in `cards` seconds, then the song. Works on a timeline that credits() has dressed."""
    shift = seconds + cards - OPENING
    adjust = dict(ADJUST)
    for layer in timeline['layers']:
        kept = []
        for item in layer['items']:
            if item.get('id') == 'opening-1':
                continue
            if item.get('id') == 'credit-opening-bg':
                item['out'] = item['in'] + cards
                keys = item.get('transform', {}).get('keyframes', {}).get('scale')
                if keys:
                    keys[-1]['t'] = cards
            elif item.get('id') == 'opening-2':
                item.update(start=seconds + 0.3, length=round(cards * 0.46, 2))
            elif item.get('id') == 'opening-3':
                item.update(start=round(seconds + cards * 0.52, 2), length=round(cards * 0.48, 2))
            elif item.get('id') == 'opening-foot':
                item.update(start=round(seconds + cards * 0.62, 2), length=round(cards * 0.38, 2))
            elif item.get('start', 0) >= OPENING - 1e-6:
                item['start'] = round(item['start'] + shift, 3)
            kept.append(item)
        layer['items'] = kept
    main = timeline['layers'][0]['items']
    main.insert(0, {'id': 'brand-intro', 'name': 'Brand intro', 'media_id': media_id, 'start': 0, 'in': 0, 'out': seconds, 'speed': 1, 'volume': 0, 'muted': True,
                    'fade_in': 0, 'fade_out': 0, 'transform': {'x': 0.5, 'y': 0.5, 'scale': 1, 'opacity': 1, 'rotation': 0}, 'adjust': adjust})
    lay_out(timeline)


def fill_frame(timeline: dict, sizes: dict[int, tuple[float, float]], only: set[str] | None = None) -> None:
    """Pictures of another shape than the video (AI pictures are often 3:2) would show bars at the sides: every
    picture clip on the main track is enlarged just enough to cover the frame, its pan or zoom kept. sizes: media id ->
    (width, height); only: just these clip ids (already-filled clips must not be enlarged twice)."""
    fw, fh = timeline['format']['width'], timeline['format']['height']
    for clip in timeline['layers'][0]['items']:
        if clip['id'].startswith('brand-intro') or clip['media_id'] not in sizes or (only is not None and clip['id'] not in only):
            continue
        w, h = sizes[clip['media_id']]
        fit = min(fw / w, fh / h)
        fill = max(fw / (w * fit), fh / (h * fit))
        if fill <= 1.001:
            continue
        transform = clip.setdefault('transform', {'x': 0.5, 'y': 0.5, 'scale': 1, 'opacity': 1, 'rotation': 0})
        transform['scale'] = round(transform.get('scale', 1) * fill, 4)
        for key in (transform.get('keyframes') or {}).get('scale', []):
            key['v'] = round(key['v'] * fill, 4)
