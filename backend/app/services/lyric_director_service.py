"""The lyric video director: the text model reads a song's lyrics (Tamil, English or mixed), finds its sections by
meaning and writes one consistent visual story in English, a scene per section. Image generation then works from that.

The lyrics go only to the text model (AI settings → Text model), to understand them. Image prompts carry only the
English visual descriptions, never lyric words, as before.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Callable

from app.services import text_ai_service

SYSTEM = """You are the director of a lyric music video, often for a Tamil song. Read the lyrics in their own language and understand their meaning, emotion and imagery.
Split the numbered lines into the requested number of scenes: contiguous runs of lines that belong together in meaning (a verse, a chorus, a turn in feeling), covering every line once, in order.
Then write ONE visual story for the whole video, in English: a continuity bible (the same recurring people with their look and clothes, the place, time of day, colour palette, light and camera style), and for each scene what the image shows, in one or two vivid sentences.
Show the feeling with people, places and light, not with words: never put lyric words, letters, captions or signs in the images. Respect the culture of the song (for a Tamil song, Tamil settings, clothes and faces unless the lyrics say otherwise). Keep everyone fully clothed and family friendly.
Reply as {"bible": "...", "scenes": [{"first_line": 1, "last_line": 4, "mood": "a few words", "visual": "..."}]}"""


def english(text: Any, limit: int) -> str:
    """Plain English for an image prompt: accents folded, anything outside ASCII dropped, length capped."""
    folded = unicodedata.normalize('NFKD', str(text or '')).encode('ascii', 'ignore').decode()
    return re.sub(r'\s+', ' ', folded).strip()[:limit]


def direct(lines: list[str], count: int, style: str, canvas: str, wishes: str = '', ask: Callable[[str, str], Any] | None = None) -> dict[str, Any]:
    """{'bible': str, 'scenes': [{'first': int, 'end': int, 'visual': str, 'mood': str}]}, lines as 0-based [first, end)."""
    count = max(1, min(count, len(lines)))
    numbered = '\n'.join(f'{number + 1}. {line}' for number, line in enumerate(lines))
    request = (f'Scenes: {count}. Image style: {style}. Picture shape: {canvas}.\n'
               + (f"The person's wishes for the look (follow them): {wishes.strip()[:1500]}\n" if wishes.strip() else '')
               + f'Lyrics, {len(lines)} lines:\n{numbered}')
    answer = (ask or text_ai_service.ask_json)(SYSTEM, request)
    if not isinstance(answer, dict):
        raise ValueError('The AI did not answer with a scene plan. Try again.')
    bible = english(answer.get('bible'), 1500)
    if len(bible) < 20:
        raise ValueError('The AI did not describe the look of the video. Try again, or try another text model.')
    raw = answer.get('scenes') if isinstance(answer.get('scenes'), list) else []
    scenes, expected = [], 0
    for item in raw:
        try:
            first, last = int(item['first_line']) - 1, int(item['last_line'])
        except (KeyError, TypeError, ValueError):
            continue
        visual = english(item.get('visual'), 600)
        # Scenes must run in order and cover every line; a gap or overlap is joined onto its neighbour.
        if last <= expected or not visual:
            continue
        scenes.append({'first': expected, 'end': min(last, len(lines)), 'visual': visual, 'mood': english(item.get('mood'), 60)})
        expected = scenes[-1]['end']
        if expected >= len(lines):
            break
    if not scenes:
        raise ValueError('The AI did not split the lyrics into scenes. Try again, or try another text model.')
    scenes[-1]['end'] = len(lines)
    return {'bible': bible, 'scenes': scenes[:8]}
