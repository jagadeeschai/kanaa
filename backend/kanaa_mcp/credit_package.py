"""Credits the way music labels present a lyric video (advice from a music producer and a label, Nov 2026):

- an opening card over the intro, gone before the singing: the song in Tamil (gold) and English (small spaced capitals),
  then each role, Tamil label over the name;
- a slow ticker along the bottom three times (after the opening, at the instrumental break, in the last chorus), never
  on the lyrics;
- an end card in the left part of the frame, keeping the right side and bottom free for YouTube's end-screen buttons.

No boxes behind text (soft shadows only), one font family, gold for the title alone, off-white for the rest, gentle
fades. A person can be credited with a small line portrait (portrait_sketch.py) beside their name."""
from __future__ import annotations

FONT = {'font': 'Gill Sans', 'tamil_font': 'Arima'}
GOLD, WHITE, SOFT = '#f2c46d', '#f5efe6', '#d9cfbf'
LAYERS = ('credits-opening', 'credits-ticker', 'credits-end')
PORTRAIT_LAYER = 'credits-portraits'
fade = lambda seconds: {'preset': 'fade', 'duration': seconds}


def _text(id_: str, start: float, length: float, text: str, y: float, size: int, color: str = WHITE, x: float = 0.5, subtitle: str | None = None, extra: dict | None = None) -> dict:
    item = {'id': id_, 'start': round(start, 3), 'length': round(length, 3), 'text': text, 'style': 'shadow', 'position': 'center', 'align': 'center', 'color': color,
            'size': size, **FONT, 'enter': fade(0.6), 'exit': fade(0.6), 'transform': {'x': x, 'y': y, 'scale': 1, 'opacity': 1, 'rotation': 0}}
    if subtitle:
        item.update(subtitle=subtitle, subtitle_size=max(9, round(size * 0.5)), subtitle_color=SOFT, subtitle_above=True, subtitle_spacing=0)
    return {**item, **(extra or {})}


def _sung(timeline: dict) -> list[dict]:
    return sorted((item for layer in timeline['layers'] if layer['kind'] == 'text' for item in layer['items'] if item['id'].startswith('lyric-line')), key=lambda item: item['start'])


def add(timeline: dict, title: str, english: str, roles: list[tuple[str, str, str]], ticker: str, rights: str | None = None,
        portrait: tuple[int, int] | None = None, opening: tuple[float, float] | None = None) -> dict:
    """roles: (Tamil label, English label, name), most important first. portrait: (media id, index of the role it goes
    beside). opening: when the opening card shows; by default the intro before the first sung line. Returns when each
    part shows."""
    sung = _sung(timeline)
    if not sung:
        return {}
    for layer in [layer for layer in timeline['layers'] if (layer.get('id') or '').startswith(LAYERS + (PORTRAIT_LAYER,))]:
        timeline['layers'].remove(layer)
    end = max(item['start'] + item.get('length', (item.get('out', 0) - item.get('in', 0))) for layer in timeline['layers'] for item in layer['items'])
    first, last = sung[0]['start'], sung[-1]['start'] + sung[-1]['length']
    # The intro, between the brand intro and the song's title card (or the first sung line).
    intro = max((clip['start'] + (clip['out'] - clip['in']) / clip.get('speed', 1) for clip in timeline['layers'][0]['items'] if clip['id'].startswith('brand-intro')), default=0.0)
    title_card = min((item['start'] for layer in timeline['layers'] if layer['kind'] == 'text' for item in layer['items'] if item['id'] == 'house-title'), default=first)
    finish = min(first, title_card) - 0.8
    start, finish = opening or (max(intro + 0.8, finish - 7.0), finish)
    pictures = []
    # Opening card: centred, a gentle column.
    card = [_text('credit-open-title', start, finish - start, title, 0.34, 64, GOLD),
            _text('credit-open-english', start + 0.15, finish - start - 0.15, english.upper(), 0.43, 18, SOFT, extra={'spacing': 6})]
    shown = roles[:3]
    for n, (tamil, english_role, name) in enumerate(shown):
        card.append(_text(f'credit-open-{n + 1}', start + 0.3 + 0.15 * n, finish - start - 0.3 - 0.15 * n, name, 0.55 + 0.1 * n, 22, WHITE, subtitle=f'{tamil} · {english_role.upper()}'))
    if portrait and portrait[1] < len(shown):
        pictures.append((portrait[0], start + 0.3, finish - start - 0.3, 0.5 - 0.2, 0.55 + 0.1 * portrait[1] - 0.012))
    # Ticker: after the opening, at the longest break between lines, and in the last stretch of singing.
    gaps = sorted(((b['start'] - (a['start'] + a['length']), b['start']) for a, b in zip(sung, sung[1:])), reverse=True)
    times = [first + 8.0]
    if gaps and gaps[0][0] > 6:
        times.append(gaps[0][1] + 2.0)
    times.append(max(first, last - 30.0))
    run = 22.0  # Slow enough to read Tamil: about a frame width every eleven seconds.
    times = [at for n, at in enumerate(sorted(times)) if at + run < end and all(abs(at - other) > run + 5 for other in sorted(times)[:n])]
    crawl = [_text(f'credit-ticker-{n + 1}', at, run, ticker, 0.94, 20, WHITE, extra={'position': 'center', 'enter': fade(0.5), 'exit': fade(0.5),
             'transform': {'x': 0.5, 'y': 0.94, 'scale': 1, 'opacity': 1, 'rotation': 0, 'keyframes': {'x': [{'t': 0, 'v': 1.25, 'ease': 'linear'}, {'t': run, 'v': -0.25, 'ease': 'linear'}]}}})
             for n, at in enumerate(times)]
    # End card: the last part, after the singing, in the left 40% of the frame.
    begin = max(last + 0.5, end - 18.0)
    closing = [_text('credit-end-title', begin, end - begin, title, 0.24, 30, GOLD, x=0.24)]
    for n, (tamil, english_role, name) in enumerate(roles[:4]):
        closing.append(_text(f'credit-end-{n + 1}', begin + 0.2 + 0.12 * n, end - begin - 0.2 - 0.12 * n, name, 0.37 + 0.1 * n, 20, WHITE, x=0.24,
                             subtitle=f'{tamil} · {english_role.upper()}'))
    if rights:
        closing.append(_text('credit-end-rights', begin + 0.8, end - begin - 0.8, '℗', 0.8, 20, SOFT, x=0.24, extra={'subtitle': rights.removeprefix('℗').strip(), 'subtitle_size': 9, 'subtitle_color': SOFT, 'subtitle_above': False}))
    if portrait and portrait[1] < 4:
        pictures.append((portrait[0], begin + 0.2, end - begin - 0.2, 0.24 - 0.16, 0.37 + 0.1 * portrait[1] - 0.01))
    # Lines shown together each need their own layer: a layer holds one item at a time.
    timeline['layers'] += [{'id': f'credits-opening-{n + 1}', 'kind': 'text', 'name': f'Opening credits {n + 1}', 'items': [item]} for n, item in enumerate(card)]
    timeline['layers'].append({'id': 'credits-ticker', 'kind': 'text', 'name': 'Ticker', 'items': crawl})
    timeline['layers'] += [{'id': f'credits-end-{n + 1}', 'kind': 'text', 'name': f'End credits {n + 1}', 'items': [item]} for n, item in enumerate(closing)]
    if pictures:
        clips = [{'id': f'credit-portrait-{n + 1}', 'media_id': media, 'start': round(at, 3), 'in': 0, 'out': round(length, 3), 'speed': 1, 'volume': 0, 'muted': True,
                  'fade_in': 0.6, 'fade_out': 0.6, 'adjust': {'rotation': 0, 'flip_horizontal': False, 'flip_vertical': False, 'brightness': 1, 'contrast': 1, 'saturation': 1},
                  'transform': {'x': x, 'y': y, 'scale': 0.08, 'opacity': 1, 'rotation': 0}} for n, (media, at, length, x, y) in enumerate(pictures)]
        top = max(index for index, layer in enumerate(timeline['layers']) if layer['kind'] == 'video') + 1
        timeline['layers'].insert(top, {'id': PORTRAIT_LAYER, 'kind': 'video', 'name': 'Credit portraits', 'items': clips})
    return {'opening': (round(start, 2), round(finish, 2)), 'ticker': [round(at, 2) for at in times], 'end': (round(begin, 2), round(end, 2))}
