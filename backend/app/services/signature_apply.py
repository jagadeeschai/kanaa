"""A saved signature put into any song from the editor: the same card (the poet's portrait drawing itself, with his
name), the same credits, and only the song's name new. As the agent tools do it for a lyric video (kanaa_mcp
signature.add_card, signature_titles.card and end_card): the card plays in silence after the brand intro, everything
after it moves later, and the credits come back after the last lyric when there is room."""
from __future__ import annotations

import copy
from pathlib import Path

from app.services.timeline_schema import Timeline
from kanaa_mcp import credit_package, signature, signature_titles

END_CARD_ROOM = 4.0  # Seconds after the last lyric needed for the end credits.


def _end(timeline: dict) -> float:
    return max((item['start'] + signature._length(item) for layer in timeline['layers'] for item in layer['items']), default=0.0)


def apply(timeline: dict, data_dir: Path, name: str, title: str, english: str) -> dict:
    """The timeline with signature `name`'s card for song `title` (`english` under it). Raises LookupError when there
    is no such signature, ValueError when it cannot be used."""
    saved = signature.load(data_dir, name)
    if saved is None:
        raise LookupError(name)
    roles = saved.get('roles') or []
    picture = (saved.get('cards') or {}).get('picture')
    if not roles or picture is None:
        raise ValueError('This signature has no card picture or credits saved.')
    work = copy.deepcopy(timeline)
    if not work.get('layers') or work['layers'][0].get('kind') != 'video':
        raise ValueError('Add the song’s pictures first: the card goes on the main track.')
    at = signature.add_card(work, title, english, saved, roles, card=int(picture))
    signature_titles.card(work, at, signature.SECONDS, title, english, roles)
    sung = credit_package._sung(work)
    if sung:
        last = max(item['start'] + item['length'] for item in sung)
        finish = _end(work)
        if finish - last >= END_CARD_ROOM:
            signature_titles.end_card(work, last + 0.3, finish, title, english, roles, saved.get('rights'))
    return Timeline.model_validate(work).model_dump(by_alias=True, mode='json', exclude_none=False)
