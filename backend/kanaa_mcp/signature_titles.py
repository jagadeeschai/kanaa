"""A signature's words as titles you can type into: the song's title and credits on the signature card (Plain ink
letters on the paper), the credit during the song (bottom left) and the end card (left block), white with a soft
shadow over the scenes. Each line is one title on its own layer; a person's English name sits on a small line under
their Tamil name. Titles whose ids start signature-song / credit-song carry the song's name, so changing it changes
all of them (the Signature card panel)."""
from __future__ import annotations

MAROON, INK, GREY, WHITE, SOFT = '#6b1d1d', '#1f1b16', '#8a8178', '#ffffff', '#ece3cf'
SONG_IDS = ('signature-song', 'credit-song-lower', 'credit-song-end')  # The titles that name the song.


def _title(id_: str, start: float, length: float, text: str, x: float, y: float, size: int, color: str, font: str, style: str = 'plain', align: str = 'center',
           subtitle: str | None = None, sub_size: int = 10, sub_color: str = GREY, above: bool = False, position: str = 'center', fade: float = 0.6) -> dict:
    item = {'id': id_, 'start': round(start, 3), 'length': round(length, 3), 'text': text, 'style': style, 'position': position, 'align': align, 'color': color,
            'size': size, 'font': font, 'tamil_font': font, 'enter': {'preset': 'fade', 'duration': fade}, 'exit': {'preset': 'fade', 'duration': fade},
            'transform': {'x': x, 'y': y, 'scale': 1, 'opacity': 1, 'rotation': 0}}
    if subtitle:
        item.update(subtitle=subtitle, subtitle_size=sub_size, subtitle_color=sub_color, subtitle_above=above, subtitle_spacing=0)
    return item


def heading(title: str, english: str) -> tuple[str, str]:
    return title, english.upper() if english and english != title else ''


def block(title: str, english: str, roles: list[list[str]], rights: str | None = None) -> str:
    """The credit block as the lines of one title (layout 'credits'): title, its English name, then each credit as
    its label, the name, and the name in English, a blank line between credits."""
    tamil, latin = heading(title, english)
    rows = [tamil] + ([latin] if latin else [])
    for role in roles[:4]:
        rows += ['', f'{role[0]} · {role[1].upper()}', role[2]] + ([role[3]] if len(role) > 3 and role[3] else [])
    if rights:
        rows += ['', rights]
    return '\n'.join(rows)


def _replace(timeline: dict, prefix: str, name: str, items: list[dict]) -> None:
    timeline['layers'] = [layer for layer in timeline['layers'] if not (layer.get('id') or '').startswith(prefix)]
    if items:
        timeline['layers'].append({'id': prefix, 'kind': 'text', 'name': name, 'items': sorted(items, key=lambda item: item['start'])})


def card(timeline: dict, at: float, seconds: float, title: str, english: str, roles: list[list[str]]) -> None:
    """The right-hand column of the signature card: one title, over the card picture (portrait and poet)."""
    item = _title('signature-song', at + 0.9, seconds - 1.5, block(title, english, roles), 0.67, 0.5, 38, MAROON, 'Arima', sub_color=INK)
    item.update(layout='credits', subtitle_color=INK)
    _replace(timeline, 'signature-words', 'Signature card', [item])


def credit_in_song(timeline: dict, times: list[float], title: str, english: str, roles: list[list[str]], channel: str | None, seconds: float = 9.0) -> None:
    """At each time, one title at the bottom left: the song, the lyricist (and his English name), the channel."""
    tamil, latin = heading(title, english)
    lyric = next((role for role in roles if role[1].lower().startswith('lyric')), roles[0])
    rows = [f'{tamil}  |  {latin.title()}' if latin else tamil, f'{lyric[0]} · {lyric[2]}' + (f' ({lyric[3]})' if len(lyric) > 3 and lyric[3] else '')] + ([channel] if channel else [])
    items = []
    for n, at in enumerate(times):
        item = _title(f'credit-song-lower-{n + 1}', at, seconds, '\n'.join(rows), 0.5, 0.85, 26, WHITE, 'Arima', style='shadow', align='left')
        item.update(layout='credits', subtitle_color=SOFT)
        items.append(item)
    timeline['layers'] = [layer for layer in timeline['layers'] if not (layer.get('id') or '').startswith('credit-lower-words')]
    _replace(timeline, 'credit-lower-words', 'Credit in the song', items)


def end_card(timeline: dict, start: float, finish: float, title: str, english: str, roles: list[list[str]], rights: str | None) -> None:
    """After the last lyric: one title at the left, the whole credit block."""
    item = _title('credit-song-end', start, finish - start, block(title, english, roles, rights), 0.5, 0.5, 30, WHITE, 'Arima', style='shadow', align='left')
    item.update(layout='credits', subtitle_color=SOFT)
    _replace(timeline, 'credits-end-words', 'End credits', [item])


def rename(timeline: dict, old: tuple[str, str], new: tuple[str, str]) -> int:
    """The song's name changed: every title that names it follows. Returns how many changed."""
    changed = 0
    for layer in timeline['layers']:
        for item in layer['items'] if layer['kind'] == 'text' else []:
            if item['id'].startswith(SONG_IDS):
                for key in ('text', 'subtitle'):
                    if item.get(key):
                        value = item[key].replace(old[0], new[0]) if old[0] else item[key]
                        if old[1]:
                            value = value.replace(old[1].upper(), new[1].upper()).replace(old[1].title(), new[1].title()).replace(old[1], new[1])
                        if value != item[key]:
                            item[key] = value; changed += 1
    return changed
