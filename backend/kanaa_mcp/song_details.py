"""The song details card music channels show while a song plays: its name, then who wrote, composed, arranged and
sang it, each line in Tamil and English. It slides in when the singing starts and once more after the longest
instrumental break. Lines with no name are left out, never guessed."""
from __future__ import annotations

ROLES = (('lyrics', 'பாடல்', 'Lyrics'), ('music', 'இசை', 'Music'), ('arrangement', 'இசையமைப்பு & பாணி', 'Arrangement & style'),
         ('singers', 'பாடியவர்', 'Singers'), ('label', 'வெளியீடு', 'Label'))
# Classic: a dark panel with gold, at the top left, clear of the lyrics and the lower third.
LOOK = {'font': 'Gill Sans', 'tamil_font': 'Arima', 'style': 'band', 'band_color': '#1a1410', 'align': 'left', 'position': 'top', 'color': '#f2c46d', 'size': 34,
        'subtitle_size': 21, 'subtitle_color': '#f3eee4', 'subtitle_spacing': 1, 'enter': {'preset': 'slide-left', 'duration': 0.6}, 'exit': {'preset': 'fade', 'duration': 0.5}}
FIRST, AGAIN = 7.0, 6.0  # Seconds on screen: when the singing starts, and after the break.
BREAK = 8.0  # A gap between sung lines longer than this is the instrumental break.
LAYER = 'song-details'


def lines(details: dict) -> str:
    return '\n'.join(f'{tamil} / {english} — {details[key].strip()}' for key, tamil, english in ROLES if (details.get(key) or '').strip())


def add(timeline: dict, title: str, details: dict) -> int:
    """Adds the card; returns how many times it shows (0 when no one is named)."""
    subtitle = lines(details)
    if not subtitle:
        return 0
    sung = sorted((item for layer in timeline['layers'] if layer['kind'] == 'text' for item in layer['items'] if item['id'].startswith('lyric-line')), key=lambda item: item['start'])
    if not sung:
        return 0
    times = [(sung[0]['start'], FIRST)]
    gaps = [(b['start'] - (a['start'] + a['length']), b['start']) for a, b in zip(sung, sung[1:])]
    longest = max(gaps, default=(0, 0))
    if longest[0] > BREAK and longest[1] - times[0][0] > FIRST + 20:
        times.append((longest[1], AGAIN))
    items = [{'id': f'song-details-{n + 1}', 'start': round(at, 3), 'length': seconds, 'text': title, 'subtitle': subtitle, **{k: (dict(v) if isinstance(v, dict) else v) for k, v in LOOK.items()}}
             for n, (at, seconds) in enumerate(times)]
    timeline['layers'] = [layer for layer in timeline['layers'] if layer.get('id') != LAYER]
    timeline['layers'].append({'id': LAYER, 'kind': 'text', 'name': 'Song details', 'items': items})
    return len(items)
