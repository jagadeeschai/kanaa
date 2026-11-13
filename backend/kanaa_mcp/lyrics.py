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
import unicodedata
from pathlib import Path

from kanaa_mcp import lyric_touches, scene_motion

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


def without_directions(words: str) -> str:
    """A lyric line without the singing notes a song generator writes into it. Tags in square brackets and English
    notes in round brackets go ("(Backing harmony)", "(Silent 1 second)"); a note with lyrics after a colon keeps the
    lyrics ("(Stereo wide backing: பக்கத்திலே…)"); Tamil (or any non-English) words in brackets are sung, so they
    stay, without the brackets. The lyric screen does the same (withoutDirections in utils/lyrics.ts)."""
    def note(match: re.Match) -> str:
        inside = match.group(1).strip()
        if inside.isascii():
            return ' '
        head, colon, rest = inside.partition(':')
        return ' ' + (rest.strip() if colon and head.isascii() else inside) + ' '
    words = re.sub(r'\[[^\]]*\]', ' ', words)
    words = re.sub(r'\(([^()]*)\)', note, words)
    return re.sub(r'\s+', ' ', words).strip()


STACKED = 0.05  # Lines this close in time were written on one moment.
READABLE = 1.0  # A line shown for less than this cannot be read.


def read_lrc(text: str, tail: float = 4.0, longest: float = 7.0) -> list[dict]:
    """Timed lines from an LRC file: [mm:ss.xx]words, without the singing notes a song generator adds (see
    without_directions); a fragment of two letters or fewer joins the line before it; a line that is only a note
    ("(Silent 1 second)") is left out.

    Song generators often write several lines on one moment: consecutive lead lines, with backing harmonies (lines in
    brackets) stacked on them. At such a moment the lead lines are kept, in the file's order, and spread evenly up to
    the next moment, so every sung line shows and none overlap; backing lines are used only where a moment has no lead
    line, and a line repeated at the same moment shows once. Each line lasts until the next (at most `longest` s)."""
    found: list[tuple[float, int, str, bool]] = []  # time, order in the file, words, a backing line
    waiting = ''
    for order, raw in enumerate(text.splitlines()):
        stamps = re.findall(r'\[(\d+):(\d+(?:\.\d+)?)\]', raw)
        sung = re.sub(r'\[[^\]]*\]', '', raw).strip()
        words = without_directions(sung)
        if not stamps or not words:
            continue
        if re.fullmatch(r'(?i)(silent|instrumental|end|verse|chorus|pre-chorus|post-chorus|outro|intro|bridge|hook|break)\b.*', words) and words.isascii():
            continue
        backing = sung.startswith('(')
        if unicodedata.category(words[0]).startswith('M') and found:
            last = found[-1]  # A word cut across two lines: the second half starts on a vowel sign.
            found[-1] = (last[0], last[1], last[2] + words, last[3])
            continue
        if waiting:
            words, waiting = waiting + ' ' + words, ''
        when = int(stamps[0][0]) * 60 + float(stamps[0][1])
        if len(words) <= 2 and found and 0 < when - found[-1][0] < 1.5 and unicodedata.category(found[-1][2][-1])[0] in 'LM':
            last = found[-1]  # The rest of a word sung straight after its line ("சொல்லுவே" + "னே").
            found[-1] = (last[0], last[1], last[2] + words, last[3])
            continue
        if len(words) <= 2:
            waiting = words  # A one-word lead-in ("நீ") is sung into the next line.
            continue
        for minutes, seconds in stamps:
            found.append((int(minutes) * 60 + float(seconds), order, words, backing))
    found.sort(key=lambda line: (line[0], line[1]))
    moments: list[tuple[float, list[str]]] = []
    index = 0
    while index < len(found):
        at = found[index][0]
        group = []
        while index < len(found) and found[index][0] - at <= STACKED:
            group.append(found[index]); index += 1
        lead = [line for line in group if not line[3]] or group
        words: list[str] = []
        for line in lead:
            if line[2] not in words:
                words.append(line[2])
        moments.append((at, words))
    timed: list[tuple[float, str]] = []
    for number, (at, words) in enumerate(moments):
        until = moments[number + 1][0] if number + 1 < len(moments) else at + tail * len(words)
        step = (until - at) / len(words)
        timed += [(at + share * step, line) for share, line in enumerate(words)]
    cues = []
    for number, (at, words) in enumerate(timed):
        after = timed[number + 1][0] if number + 1 < len(timed) else at + tail
        end = min(after - 0.05, at + longest) if after - at > 0.35 else after - 0.01
        cue = {'start': round(at, 2), 'end': round(max(end, at + 0.05), 2), 'text': words}
        if after - at < READABLE:
            cue['review'] = True  # The file gives this line too little time to read: its real time is not in it.
        cues.append(cue)
    return cues


def crowded(cues: list[dict]) -> list[str]:
    """Where lines were given too little time to read (mm:ss of the first of each run), to tell the person."""
    out: list[str] = []
    for number, cue in enumerate(cues):
        if cue.get('review') and (number == 0 or not cues[number - 1].get('review')):
            out.append(f"{int(cue['start'] // 60)}:{int(cue['start'] % 60):02d}")
    return out


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
        if 'out' in clip and 'in' in clip:
            clip['out'] = round(clip['in'] + round(clip['out'] - clip['in'], 3), 3)
        at = round(at + length_of(clip), 3)


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
    # The bigger moves land on the chorus: scenes in which a line sung more than once starts.
    chorus = scene_motion.chorus_lines([line['text'] for line in lines])
    strong = {index for index, clip in enumerate(scenes) if any(clip['start'] <= line['start'] < clip['start'] + length_of(clip)
                                                               and ' '.join(line['text'].split()).strip(' .,!?…').lower() in chorus for line in lines)}
    camera = {}
    for clip, name in zip(scenes if camera_moves else [], scene_motion.pick(len(scenes), strong)):
        move = scene_motion.shot_move(clip, scene_motion.MOVES[name])
        clip['transform'] = {**clip['transform'], **scene_motion.keys(move, round(length_of(clip), 3))}
        camera[clip['id']] = clip['transform']
    for clip in scenes:
        clip.pop('shot', None); clip.pop('focus', None)
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
                item['start'] = seconds
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


def gentle_moves(timeline: dict, seed: int = 7) -> None:
    """For into_clear: each scene breathes or drifts a few per cent about the centre, so the picture is never frozen
    while the words still land in the space measured on it. The person layer moves with its scene, frame for frame."""
    scenes = [clip for clip in timeline['layers'][0]['items'] if clip['id'].startswith('lyric-scene-')]
    names = scene_motion.pick(len(scenes), moves=scene_motion.GENTLE, seed=seed)
    moves = {}
    for clip, name in zip(scenes, names):
        move = {key: (a * clip['transform']['scale'], b * clip['transform']['scale']) if key == 'scale' else (a, b) for key, (a, b) in scene_motion.GENTLE[name].items()}
        moves[clip['id']] = (clip, move)
        clip['transform'] = {**clip['transform'], **scene_motion.keys(move, round(length_of(clip), 3), ease='linear')}
    person = next((layer for layer in timeline['layers'] if layer.get('id') == 'lyric-in-front'), None)
    for cover in person['items'] if person else []:
        scene, move = next(((clip, move) for clip, move in moves.values() if clip['start'] <= cover['start'] < clip['start'] + length_of(clip)), (None, None))
        if scene is None:
            continue
        whole = length_of(scene)
        begin, end = (cover['start'] - scene['start']) / whole, (cover['start'] + length_of(cover) - scene['start']) / whole
        span = {key: (scene_motion.at(move, begin)[key], scene_motion.at(move, end)[key]) for key in move}
        cover['transform'] = {**cover['transform'], **scene_motion.keys(span, round(length_of(cover), 3), ease='linear')}


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


# The owner's house style: the look they finished by hand on "AI scene 6 still.mp4" (எனைத் தொட்டிழுத்தாள்!), so a
# person (the lyric screen) and an agent (MCP) both start from it. Values are taken from that project.
HOUSE_LINE = {'font': 'Arima', 'tamil_font': 'Arima', 'size': 44, 'color': '#fff7e8', 'style': 'shadow', 'align': 'center', 'band_color': None,
              'enter': {'preset': 'particle-form', 'duration': 0.5}, 'exit': {'preset': 'particle-form', 'duration': 0.4}}
# Odd lines glide from the centre up to the right, even lines to the left, answering each other.
HOUSE_GLIDE = {1: (0.72, 0.32), 0: (0.29, 0.58)}
HOUSE_GLIDE_SECONDS = 0.534
HOUSE_SCENE_TOUCHES = [
    {'dreamy_glow': {'intensity': 0.45, 'softness': 0.5, 'warmth': 0.2}},
    {'beat_pulse': {'strength': 0.6, 'size': 0.04, 'bpm': 120, 'offset': 0}},
    {'enter': {'preset': 'blur', 'duration': 0.5}},
    {'transition_in': {'kind': 'cross-blur', 'duration': 0.6}},
    {'transition_in': {'kind': 'flash', 'duration': 0.6}},
]


def _two_lines(text: str) -> str:
    """A line of more than a few words split near its middle, at a space, as the owner sets lyrics."""
    if '\n' in text or len(text) < 16 or ' ' not in text:
        return text
    middle = len(text) // 2
    spaces = [i for i, ch in enumerate(text) if ch == ' ']
    cut = min(spaces, key=lambda i: abs(i - middle))
    return text[:cut] + '\n' + text[cut + 1:]


def house_style(timeline: dict, title: str, poet: str | None) -> None:
    """Restyles a built lyric video in the owner's house style: lyrics on two answering layers that glide out from the
    centre with particle entrances; the song's title card (credits come from credit_package.py); a different touch on each
    scene and a long fade on the last; the song fading out."""
    layers = timeline['layers']
    lyric_layer = next((layer for layer in layers if layer['kind'] == 'text' and any(item['id'].startswith('lyric-line-') for item in layer['items'])), None)
    if lyric_layer is None:
        return
    lines = sorted((item for item in lyric_layer['items'] if item['id'].startswith('lyric-line-')), key=lambda item: item['start'])
    answer = {'id': 'lyrics-answer', 'kind': 'text', 'name': 'Lyrics (answer)', 'items': []}
    for number, line in enumerate(lines, start=1):
        side = number % 2
        x, y = HOUSE_GLIDE[side]
        line.update(HOUSE_LINE, text=_two_lines(line['text']), position='bottom')
        line['transform'] = {'x': x, 'y': y, 'scale': 0.68, 'opacity': 1, 'rotation': 0,
                             'keyframes': {'x': [{'t': 0, 'v': 0.5, 'ease': 'linear'}, {'t': HOUSE_GLIDE_SECONDS, 'v': x, 'ease': 'linear'}],
                                           'y': [{'t': 0, 'v': 0.5, 'ease': 'linear'}, {'t': HOUSE_GLIDE_SECONDS, 'v': y, 'ease': 'linear'}]}}
        if not side:
            lyric_layer['items'].remove(line)
            answer['items'].append(line)
    # Each lyric layer keeps the look as its style, so a later change on the layer reaches every line.
    for layer, side in ((lyric_layer, 1), (answer, 0)):
        layer['style'] = {key: value for key, value in HOUSE_LINE.items() if value is not None}
    if answer['items']:
        layers.insert(layers.index(lyric_layer) + 1, answer)
    song_start = lines[0]['start'] if lines else 0
    end = max((item['start'] + length_of(item) for layer in layers for item in layer['items'] if 'start' in item), default=song_start)
    # The title card, red at the bottom right, for the ten seconds before the first line.
    card_start = max(0.0, song_start - 10.6)
    card = {'id': 'house-title', 'start': round(card_start, 3), 'length': round(max(2.0, song_start - card_start - 0.05), 3), 'text': title, 'design': 'overlap',
            'font': 'Futura', 'tamil_font': 'Baloo Thambi 2', 'style': 'shadow', 'position': 'center', 'color': '#ef4444', 'size': 34,
            'enter': {'preset': 'particle-form', 'duration': 0.5}, 'exit': {'preset': 'particle-form', 'duration': 0.4},
            'transform': {'x': 0.62, 'y': 0.9, 'scale': 1, 'opacity': 1, 'rotation': 0}}
    layers.append({'id': 'house-title-card', 'kind': 'text', 'name': 'Title', 'items': [card]})
    # No lower third for the whole song: labels show credits a few times instead (credit_package.py's ticker).
    # A different touch on each scene; the last one leaves slowly.
    main = layers[0]
    scenes = [clip for clip in main['items'] if clip['id'].startswith('lyric-scene-')]
    for index, clip in enumerate(scenes[1:-1] if len(scenes) > 2 else []):
        clip.update(HOUSE_SCENE_TOUCHES[index % len(HOUSE_SCENE_TOUCHES)])
    if scenes:
        scenes[-1].update(echo={'mode': 'smear', 'trails': 4, 'decay': 0.6}, exit={'preset': 'fade', 'duration': 3.0})
    for layer in layers:
        if layer['kind'] == 'audio':
            for sound in layer['items']:
                sound['fade_out'] = max(sound.get('fade_out', 0), 2.4)
