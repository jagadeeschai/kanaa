"""A signature title card: the same opening for every song of one poet or channel series, as a label would brand it.

Before the music starts, in silence: a white paper card with the poet's line portrait (ink only, from a real photo,
portrait_sketch.py) and the song's details beside it. The rest of the video moves later to make room, so nothing over
it changes. A signature is saved once (`save`) and used for every song after (`add_card`)."""
from __future__ import annotations

import json
from pathlib import Path

PAPER = '#fbf8f2'
INK, MAROON, GREY = '#1f1b16', '#6b1d1d', '#8a8178'
FONT = {'font': 'Gill Sans', 'tamil_font': 'Arima'}
SECONDS = 6.0
LAYERS = ('signature-words', 'signature-portrait')  # Prefixes: each line has its own layer.


def store(data_dir: Path) -> Path:
    return data_dir / 'signatures.json'


def save(data_dir: Path, name: str, signature: dict) -> None:
    """signature: {'lyricist', 'portrait' (media id, ink only), 'paper' (media id of the white card picture),
    'presented_by', 'roles': [[Tamil, English, name]...] that stay the same song to song}."""
    path = store(data_dir)
    saved = json.loads(path.read_text(encoding='utf-8')) if path.is_file() else {}
    saved[name] = signature
    path.write_text(json.dumps(saved, ensure_ascii=False, indent=2), encoding='utf-8')


def load(data_dir: Path, name: str) -> dict | None:
    path = store(data_dir)
    return json.loads(path.read_text(encoding='utf-8')).get(name) if path.is_file() else None


def _length(item: dict) -> float:
    return item['length'] if 'length' in item else (item['out'] - item['in']) / item.get('speed', 1)


def _words(id_: str, start: float, length: float, text: str, x: float, y: float, size: int, color: str, subtitle: str | None = None, extra: dict | None = None, above: bool = True) -> dict:
    # On paper: no shadow (it smudges on white). A band in the paper's own colour leaves the letters clean.
    item = {'id': id_, 'start': round(start, 3), 'length': round(length, 3), 'text': text, 'style': 'band', 'band_color': PAPER, 'position': 'center', 'align': 'center', 'color': color, 'size': size,
            **FONT, 'enter': {'preset': 'fade', 'duration': 0.7}, 'exit': {'preset': 'fade', 'duration': 0.6}, 'transform': {'x': x, 'y': y, 'scale': 1, 'opacity': 1, 'rotation': 0}}
    if subtitle:
        item.update(subtitle=subtitle, subtitle_size=max(9, round(size * 0.5)), subtitle_color=GREY, subtitle_above=above, subtitle_spacing=0)
    return {**item, **(extra or {})}


def add_card(timeline: dict, title: str, english: str, signature: dict, roles: list[list[str]], at: float | None = None, seconds: float = SECONDS) -> float:
    """Opens the song with the signature card, `seconds` long, at `at` (after the brand intro by default): everything
    from there on moves later by `seconds`, so the card plays in silence. Returns where it starts."""
    main = timeline['layers'][0]['items']
    if at is None:
        at = max((clip['start'] + _length(clip) for clip in main if clip['id'].startswith('brand-intro')), default=0.0)
    for layer in [layer for layer in timeline['layers'] if (layer.get('id') or '').startswith(LAYERS)]:
        timeline['layers'].remove(layer)
    if any(clip['id'] == 'signature-paper' for clip in main):
        timeline['layers'][0]['items'] = main = [clip for clip in main if clip['id'] != 'signature-paper']  # Replaced: no double shift.
        for layer in timeline['layers']:
            for item in layer['items']:
                if item['start'] >= at + seconds - 1e-6:
                    item['start'] = round(item['start'] - seconds, 3)
    for layer in timeline['layers']:
        for item in layer['items']:
            if item['start'] >= at - 1e-6:
                item['start'] = round(item['start'] + seconds, 3)
    # With a drawn card (the portrait drawing itself, made once per song length), it is the background itself.
    drawn = (signature.get('cards') or {}).get(str(round(seconds, 1)))
    paper = {'id': 'signature-paper', 'media_id': drawn or signature['paper'], 'start': round(at, 3), 'in': 0, 'out': seconds, 'speed': 1, 'volume': 0, 'muted': True,
             'fade_in': 0.4, 'fade_out': 0, 'transform': {'x': 0.5, 'y': 0.5, 'scale': 1, 'opacity': 1, 'rotation': 0},
             'adjust': {'rotation': 0, 'flip_horizontal': False, 'flip_vertical': False, 'brightness': 1, 'contrast': 1, 'saturation': 1}}
    main.append(paper)
    main.sort(key=lambda clip: clip['start'])
    nxt = next((clip for clip in main if clip['start'] >= at + seconds - 1e-6), None)
    if nxt is not None:
        nxt['transition_in'] = {'kind': 'crossfade', 'duration': 0.8}
    # The portrait on the left, the song on the right: title in maroon ink, then each role, Tamil label above the name.
    portrait = {'id': 'signature-portrait-1', 'media_id': signature['portrait'], 'start': round(at + 0.3, 3), 'in': 0, 'out': round(seconds - 0.7, 3), 'speed': 1,
                'volume': 0, 'muted': True, 'fade_in': 0.8, 'fade_out': 0.6, 'adjust': dict(paper['adjust']),
                'transform': {'x': 0.3, 'y': 0.46, 'scale': 0.6, 'opacity': 1, 'rotation': 0}}
    lyricist = signature.get('lyricist')
    words = [_words('signature-title', at + 0.6, seconds - 1.0, title, 0.66, 0.27, 40, MAROON, subtitle=english.upper(), above=False)]
    for n, (tamil, english_role, name) in enumerate(roles[:4]):
        words.append(_words(f'signature-role-{n + 1}', at + 1.2 + 0.15 * n, seconds - 1.6 - 0.15 * n, name, 0.66, 0.47 + 0.12 * n, 20, INK, subtitle=f'{tamil} · {english_role.upper()}'))
    if lyricist:  # Their name beneath the portrait, as under a picture on a wall.
        words.append(_words('signature-name', at + 2.6, seconds - 3.0, lyricist, 0.3, 0.86, 22, MAROON))  # Once the portrait is drawn.
    if not drawn:
        timeline['layers'].insert(1, {'id': 'signature-portrait', 'kind': 'video', 'name': 'Signature portrait', 'items': [portrait]})
    timeline['layers'] += [{'id': f'signature-words-{n + 1}', 'kind': 'text', 'name': f'Signature card {n + 1}', 'items': [item]} for n, item in enumerate(words)]
    return at
