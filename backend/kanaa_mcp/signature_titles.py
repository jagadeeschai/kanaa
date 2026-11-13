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


def _add(timeline: dict, prefix: str, name: str, items: list[dict]) -> None:
    timeline['layers'] = [layer for layer in timeline['layers'] if not (layer.get('id') or '').startswith(prefix)]
    timeline['layers'] += [{'id': f'{prefix}-{n + 1}', 'kind': 'text', 'name': f'{name} {n + 1}', 'items': [item]} for n, item in enumerate(items)]


def card(timeline: dict, at: float, seconds: float, title: str, english: str, roles: list[list[str]]) -> None:
    """The right-hand column of the signature card, over the card picture (which has the portrait and the poet)."""
    tamil, latin = heading(title, english)
    begin = at + 0.9
    items = [_title('signature-song', begin, seconds - 1.5, tamil, 0.67, 0.26, 38, MAROON, 'Arima', subtitle=latin or None, sub_size=11, sub_color=GREY)]
    y = 0.44
    for n, role in enumerate(roles[:4]):
        tamil_role, english_role, who = role[:3]
        start = begin + 0.5 + 0.18 * n
        items.append(_title(f'signature-role-{n + 1}', start, at + seconds - 0.6 - start, f'{tamil_role}   ·   {english_role.upper()}', 0.67, y, 9, GREY, 'Pavanam'))
        items.append(_title(f'signature-name-{n + 1}', start, at + seconds - 0.6 - start, who, 0.67, y + 0.05, 17, INK, 'Catamaran',
                            subtitle=role[3] if len(role) > 3 and role[3] else None, sub_size=11, sub_color=GREY))
        y += 0.135
    _add(timeline, 'signature-words', 'Signature card', items)


def credit_in_song(timeline: dict, times: list[float], title: str, english: str, roles: list[list[str]], channel: str | None, seconds: float = 9.0) -> None:
    """At each time: the song (with its English name under it), the lyricist, the channel, at the bottom left."""
    tamil, latin = heading(title, english)
    lyric = next((role for role in roles if role[1].lower().startswith('lyric')), roles[0])
    who = f'{lyric[0]} · {lyric[2]}' + (f'  ({lyric[3]})' if len(lyric) > 3 and lyric[3] else '')
    items = []
    for n, at in enumerate(times):
        items.append(_title(f'credit-song-lower-{n + 1}', at, seconds, f'{tamil}  |  {latin.title()}' if latin else tamil, 0.5, 0.79, 17, WHITE, 'Arima', style='shadow', align='left',
                            subtitle=who, sub_size=11, sub_color=SOFT))
        if channel:
            items.append(_title(f'credit-channel-lower-{n + 1}', at + 0.3, seconds - 0.3, channel, 0.5, 0.905, 10, SOFT, 'Catamaran', style='shadow', align='left'))
    # One layer each for the song line and the channel line (they show together); times never overlap within a layer.
    timeline['layers'] = [layer for layer in timeline['layers'] if not (layer.get('id') or '').startswith('credit-lower-words')]
    for kind in ('credit-song-lower', 'credit-channel-lower'):
        mine = [item for item in items if item['id'].startswith(kind)]
        if mine:
            timeline['layers'].append({'id': f'credit-lower-words-{kind}', 'kind': 'text', 'name': 'Credit in the song', 'items': mine})


def end_card(timeline: dict, start: float, finish: float, title: str, english: str, roles: list[list[str]], rights: str | None) -> None:
    """After the last lyric: the song, then each credit (label, name, English name), then the ℗ line, at the left."""
    tamil, latin = heading(title, english)
    length = finish - start
    items = [_title('credit-song-end', start, length, tamil, 0.5, 0.2, 22, WHITE, 'Arima', style='shadow', align='left', subtitle=latin or None, sub_size=10, sub_color=SOFT)]
    y = 0.36
    for n, role in enumerate(roles[:4]):
        items.append(_title(f'credit-end-role-{n + 1}', start + 0.2 + 0.12 * n, length - 0.2 - 0.12 * n, f'{role[0]} · {role[1].upper()}', 0.5, y, 8, SOFT, 'Pavanam', style='shadow', align='left'))
        items.append(_title(f'credit-end-name-{n + 1}', start + 0.2 + 0.12 * n, length - 0.2 - 0.12 * n, role[2], 0.5, y + 0.045, 13, WHITE, 'Catamaran', style='shadow', align='left',
                            subtitle=role[3] if len(role) > 3 and role[3] else None, sub_size=10, sub_color=SOFT))
        y += 0.13
    if rights:
        items.append(_title('credit-end-rights', start + 0.8, length - 0.8, rights, 0.5, y + 0.02, 8, SOFT, 'Pavanam', style='shadow', align='left'))
    _add(timeline, 'credits-end-words', 'End credits', items)


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
