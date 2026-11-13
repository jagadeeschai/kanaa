"""Lays a signature's credit pictures on a song (signature_credits_service.py makes them): the mid-song credit with a
few bubbles rising round it at the ticker's times, the end card after the last lyric, then the production close."""
from __future__ import annotations

ADJUST = {'rotation': 0, 'flip_horizontal': False, 'flip_vertical': False, 'brightness': 1, 'contrast': 1, 'saturation': 1}
CLOSE = 5.0  # The production close's seconds at the very end.


def _clip(id_: str, media: int, start: float, length: float, transform: dict | None = None, fade: float = 0.6) -> dict:
    return {'id': id_, 'media_id': media, 'start': round(start, 3), 'in': 0, 'out': round(length, 3), 'speed': 1, 'volume': 0, 'muted': True,
            'fade_in': fade, 'fade_out': fade, 'adjust': dict(ADJUST), 'transform': transform or {'x': 0.5, 'y': 0.5, 'scale': 1, 'opacity': 1, 'rotation': 0}}


def place(timeline: dict, ticker_times: list[float], last_sung: float, lower: int, end: int, production: int, bubbles: int | None) -> None:
    """Replaces the text credits (credit_package.py's ticker and end card) with the pictures."""
    length = lambda item: item['length'] if 'length' in item else (item['out'] - item['in']) / item.get('speed', 1)
    finish = max(item['start'] + length(item) for layer in timeline['layers'] for item in layer['items'])
    timeline['layers'] = [layer for layer in timeline['layers'] if not (layer.get('id') or '').startswith(('credits-ticker', 'credits-end', 'credits-portraits', 'credit-bubbles'))]
    close = finish - CLOSE
    art = [_clip(f'credit-lower-{n + 1}', lower, at + 1, 9.0) for n, at in enumerate(ticker_times)]
    begin = last_sung + 0.5
    if close - begin > 3:
        art.append(_clip('credit-end-card', end, begin, close - 0.2 - begin, fade=0.7))
    art.append(_clip('credit-production', production, close + 0.2, finish - close - 0.2, fade=0.8))
    top = max(index for index, layer in enumerate(timeline['layers']) if layer['kind'] == 'video') + 1
    timeline['layers'].insert(top, {'id': 'credits-portraits', 'kind': 'video', 'name': 'Credit art', 'items': sorted(art, key=lambda clip: clip['start'])})
    if bubbles is not None:
        corner = {'x': 0.2, 'y': 0.92, 'scale': 0.44, 'opacity': 1.0, 'rotation': 0}  # Low in the corner, under the lyrics.
        fizz = [_clip(f'credit-bubbles-{n + 1}', bubbles, at + 1, 5.0, dict(corner)) for n, at in enumerate(ticker_times)]
        fizz += [_clip(f'credit-bubbles-{n + 1}b', bubbles, at + 6, 4.0, dict(corner)) for n, at in enumerate(ticker_times)]
        timeline['layers'].insert(top, {'id': 'credit-bubbles', 'kind': 'video', 'name': 'Credit bubbles', 'blend': 'screen', 'items': sorted(fizz, key=lambda clip: clip['start'])})
