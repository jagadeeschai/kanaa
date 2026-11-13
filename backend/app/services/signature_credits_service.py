"""The credit pictures that go with a signature, for one song: the mid-song credit (bottom left), the end card (left
block) and the production close (centred, with radiance), all in gradient white lettering (credit_art_service.py).
Only the song's title changes from song to song; the credits come from the signature."""
from __future__ import annotations

from pathlib import Path

from app.services.credit_art_service import make

TITLE, LABEL, NAME, SMALL = 'Arima-Bold.ttf', 'Pavanam-Regular.ttf', 'Catamaran-Bold.ttf', 'Pavanam-Regular.ttf'


def _named(role: list[str]) -> str:
    return f'{role[2]} | {role[3]}' if len(role) > 3 and role[3] else role[2]


def _heading(title: str, english: str) -> str:
    return f'{title}  |  {english}' if english and english != title else title


def lower(target: Path, title: str, english: str, roles: list[list[str]], channel: str | None) -> Path:
    lyric = next((role for role in roles if role[1].lower().startswith('lyric')), roles[0])
    lines = [(_heading(title, english), TITLE, 46), (f'{lyric[0]} · {_named(lyric)}', NAME, 30)]
    if channel:
        lines.append((channel, SMALL, 27))
    return make(lines, (0.05, 0.76), target)


def end_card(target: Path, title: str, english: str, roles: list[list[str]], rights: str | None) -> Path:
    lines = [(_heading(title, english), TITLE, 50)]
    for role in roles[:4]:
        lines += [(f'{role[0]} · {role[1].upper()}', LABEL, 21), (_named(role), NAME, 32)]
    if rights:
        lines.append((rights, SMALL, 20))
    return make(lines, (0.06, 0.2), target, gap=0.55)


def production(target: Path, channel: str) -> Path:
    return make([(channel, TITLE, 66), ('P R O D U C T I O N', LABEL, 32)], (0.5, 0.42), target, align='centre', radiance=True)
