"""Ask AI: turns a request in plain words ("a warm wedding reel with captions and confetti at the end") into edits.

The AI may only choose from a fixed list of commands, with ids the editor sends (its themes, looks, effects…). Every
command is checked here, and again in the editor, before the person sees it; they apply it themselves and can undo.
"""
from __future__ import annotations

import re
from typing import Any, Callable

from app.services import text_ai_service

# name → (what it does, its arguments). Kept short: it goes into every request.
COMMANDS: dict[str, tuple[str, dict[str, str]]] = {
    'set_theme': ('Dress the whole video in a theme (look, transitions, titles, music).', {'theme': 'theme id'}),
    'set_look': ('Colour look for clips.', {'look': 'look id', 'clips': '"all" or a list of clip numbers from 1'}),
    'set_transition': ('Transition into clips (never clip 1).', {'transition': 'transition id', 'clips': '"all" or a list of clip numbers from 2'}),
    'add_title': ('A title on screen.', {'text': 'words, any language', 'at': 'seconds from the start', 'style': 'title style id (optional)'}),
    'add_effect': ('A special effect over the video for 5 seconds.', {'effect': 'effect id', 'at': 'seconds from the start'}),
    'cut_to_beat': ('End every clip on the music\'s beat. Needs music.', {}),
    'add_captions': ('Captions from the speech.', {'words': 'words per caption, 1 to 4 (optional)'}),
    'keep_captions_clear': ('Move captions off people\'s faces.', {}),
    'set_format': ('The video\'s shape.', {'format': 'format id'}),
    'make_story': ('Rebuild the video from a story template with the project\'s media, with its theme and music.', {'story': 'story id'}),
    'translate_captions': ('Translate every caption.', {'to': '"ta" (Tamil) or "en" (English)'}),
    # Lyric videos: only when the project has lyric lines (and, where said, a chorus).
    'lyric_layout': ('Where the lyric lines sit. "original" puts back the person\'s own layout.', {'layout': '"original", "two-line" (sung line with the next one dim below), "lower-third" or "big-centre"'}),
    'style_chorus': ('Chorus lines bigger and popping in word by word. Needs a chorus.', {}),
    'word_motion': ('Each word of the lyric lines arrives on its own, as it is sung.', {'preset': '"word-rise", "word-pop", "word-fade" or "none"', 'lines': '"all" or "chorus"'}),
    'sung_glow': ('The sung word glows, brighter where the song is louder. Needs a song.', {'on': 'true or false'}),
    'chorus_light_hits': ('Warm light flashes on the chorus beats. Needs a song and a chorus.', {}),
    'section_lights': ('A light at the start of each part of the song (verse, chorus).', {'kind': '"light-leak" or "lens-flare"'}),
    'mood_grade': ('Each part of the song in its own colour.', {'mood': '"warm-rich", "cool-to-warm", "film" or "none"'}),
    'focus_drift': ('A slow push in on the faces or main subject of every picture.', {}),
    'smart_slice': ('At the end of a clip, slice its picture into pieces that slide away to show the next clip; Kanaa picks how (around the people, beside the subject, or across the scene).', {'clip': 'clip number from 1, not the last'}),
    'make_short': ('Export a 9:16 Short of the first chorus for YouTube Shorts and Reels. Only when asked for a Short or Reel.', {'look': 'true for big lyrics and a slow push on each picture'}),
}
CHOICES = {'layout': ('original', 'two-line', 'lower-third', 'big-centre'), 'preset': ('word-rise', 'word-pop', 'word-fade', 'none'), 'lines': ('all', 'chorus'),
           'kind': ('light-leak', 'lens-flare'), 'mood': ('warm-rich', 'cool-to-warm', 'film', 'none')}
NEEDS_LYRICS = {'lyric_layout', 'word_motion', 'sung_glow', 'section_lights', 'mood_grade'}
NEEDS_CHORUS = {'style_chorus', 'chorus_light_hits', 'make_short'}
OPTION_KINDS = {'theme': 'themes', 'look': 'looks', 'transition': 'transitions', 'effect': 'effects', 'format': 'formats', 'story': 'stories', 'style': 'title_styles'}
MAX_COMMANDS = 12

SYSTEM = """You are the editing assistant inside Kanaa, a video editor for family, travel, celebration and lyric (song) videos, often in Tamil.
Turn the person's request into a short list of commands from the catalogue. Use only these commands and only the ids listed.
Prefer few, high-impact commands. If something asked for is not possible with the catalogue, leave it out and say so in "summary".
Reply as: {"summary": "one or two plain sentences, in the person's language", "commands": [{"name": "...", "args": {...}, "why": "a few words"}]}"""


def catalogue_text(options: dict[str, list[dict[str, str]]]) -> str:
    lines = ['Commands:']
    for name, (about, args) in COMMANDS.items():
        lines.append(f'- {name}({", ".join(f"{key}: {value}" for key, value in args.items())}): {about}')
    for kind, key in OPTION_KINDS.items():
        values = options.get(key) or []
        if values:
            lines.append(f'{kind} ids: ' + ', '.join(f'{item["id"]} ({item.get("label", item["id"])})' for item in values[:40]))
    return '\n'.join(lines)


def _clips(value: Any, count: int, first: int) -> Any:
    if value in (None, 'all'):
        return 'all'
    if not isinstance(value, list) or not value:
        raise ValueError('clips must be "all" or clip numbers')
    numbers = sorted({int(number) for number in value})
    if any(number < first or number > count for number in numbers):
        raise ValueError(f'clip numbers must be {first} to {count}')
    return numbers


def check_command(raw: Any, options: dict[str, list[dict[str, str]]], duration: float, clips: int, lyrics: int = 0, chorus: bool = False) -> dict[str, Any]:
    """The command, cleaned, or ValueError saying why it can't be used."""
    if not isinstance(raw, dict) or raw.get('name') not in COMMANDS:
        raise ValueError(f'unknown command {raw.get("name") if isinstance(raw, dict) else raw!r}')
    name = raw['name']
    args = raw.get('args') or {}
    if not isinstance(args, dict):
        raise ValueError('arguments must be an object')
    ids = {kind: {item['id'] for item in options.get(key) or []} for kind, key in OPTION_KINDS.items()}

    def pick(kind: str, required: bool = True) -> str | None:
        value = args.get(kind)
        if value is None and not required:
            return None
        if value not in ids[kind]:
            raise ValueError(f'{kind} "{value}" is not one of Kanaa\'s')
        return value

    def seconds(value: Any) -> float:
        at = float(value)
        if not 0 <= at <= max(0.0, duration):
            raise ValueError(f'time {at} is outside the video (0 to {duration:.1f} s)')
        return round(at, 2)

    clean: dict[str, Any]
    if name == 'set_theme':
        clean = {'theme': pick('theme')}
    elif name == 'set_look':
        clean = {'look': pick('look'), 'clips': _clips(args.get('clips'), clips, 1)}
    elif name == 'set_transition':
        if clips < 2:
            raise ValueError('a transition needs at least two clips')
        clean = {'transition': pick('transition'), 'clips': _clips(args.get('clips'), clips, 2)}
    elif name == 'add_title':
        text = str(args.get('text') or '').strip()
        if not text:
            raise ValueError('a title needs words')
        clean = {'text': text[:120], 'at': seconds(args.get('at', 0))}
        style = pick('style', required=False)
        if style:
            clean['style'] = style
    elif name == 'add_effect':
        clean = {'effect': pick('effect'), 'at': seconds(args.get('at', 0))}
    elif name == 'add_captions':
        words = int(args.get('words') or 2)
        clean = {'words': min(4, max(1, words))}
    elif name == 'set_format':
        clean = {'format': pick('format')}
    elif name == 'make_story':
        clean = {'story': pick('story')}
    elif name in NEEDS_LYRICS or name in NEEDS_CHORUS or name == 'focus_drift':
        if name in NEEDS_LYRICS and lyrics < 2:
            raise ValueError('this video has no lyric lines')
        if name in NEEDS_CHORUS and not chorus:
            raise ValueError('this video has no chorus (no lyric line is sung twice)')
        if name == 'focus_drift' and clips < 1:
            raise ValueError('focus drift needs pictures on the main track')
        clean = {}
        for key, allowed in CHOICES.items():
            if key in COMMANDS[name][1]:
                if args.get(key) not in allowed:
                    raise ValueError(f'{key} must be one of {", ".join(allowed)}')
                clean[key] = args[key]
        for key in ('on', 'look'):
            if key in COMMANDS[name][1]:
                clean[key] = bool(args.get(key, True))
    elif name == 'smart_slice':
        number = int(args.get('clip') or 0)
        if not 1 <= number < clips:
            raise ValueError(f'slice a clip from 1 to {clips - 1}: the pieces show the clip after it')
        clean = {'clip': number}
    elif name == 'translate_captions':
        if args.get('to') not in ('ta', 'en'):
            raise ValueError('captions can be translated to "ta" or "en"')
        clean = {'to': args['to']}
    else:
        clean = {}
    return {'name': name, 'args': clean, 'why': str(raw.get('why') or '')[:120]}


def plan(request: str, project: dict[str, Any], options: dict[str, list[dict[str, str]]], ask: Callable[[str, str], Any] | None = None) -> dict[str, Any]:
    duration = float(project.get('duration') or 0)
    clips = int(project.get('clip_count') or 0)
    lyrics, chorus = int(project.get('lyric_lines') or 0), bool(project.get('chorus'))
    user = f"{catalogue_text(options)}\n\nThe project:\n{_project_text(project)}\n\nThe request:\n{request.strip()[:1000]}"
    answer = (ask or text_ai_service.ask_json)(SYSTEM, user)
    commands, dropped = [], []
    for raw in (answer.get('commands') or [])[:MAX_COMMANDS] if isinstance(answer, dict) else []:
        try:
            commands.append(check_command(raw, options, duration, clips, lyrics, chorus))
        except (ValueError, TypeError) as problem:
            dropped.append({'command': raw, 'reason': str(problem)})
    summary = str(answer.get('summary') or '').strip()[:500] if isinstance(answer, dict) else ''
    return {'summary': summary, 'commands': commands, 'dropped': dropped}


def _project_text(project: dict[str, Any]) -> str:
    lines = [f"Shape {project.get('format', '?')}, {float(project.get('duration') or 0):.1f} seconds, {project.get('clip_count', 0)} clips on the main track."]
    for number, clip in enumerate((project.get('clips') or [])[:40], start=1):
        lines.append(f"  clip {number}: {clip.get('kind', '?')} '{str(clip.get('name', ''))[:60]}', {float(clip.get('length') or 0):.1f} s from {float(clip.get('start') or 0):.1f} s")
    if project.get('lyric_lines'):
        lines.append(f"A lyric video: {project['lyric_lines']} lyric lines, {'with a chorus' if project.get('chorus') else 'no chorus found'}.")
    for key, label in (('theme', 'Theme'), ('music', 'Music'), ('titles', 'Titles'), ('captions', 'Captions (first lines)'), ('media', 'Other media in the project')):
        value = project.get(key)
        if value:
            lines.append(f'{label}: {value if isinstance(value, str) else "; ".join(str(item)[:80] for item in value[:20])}')
    return '\n'.join(lines)


TRANSLATE_SYSTEM = """Translate video captions for a family or celebration video. Keep each line short, natural and spoken, as people would say it.
Tamil means Tamil script, not transliteration. Keep names as they are. Reply as {"lines": ["...", ...]} with exactly one line per input line, in order."""


def translate(lines: list[str], to: str, ask: Callable[[str, str], Any] | None = None) -> list[str]:
    language = {'ta': 'Tamil', 'en': 'English'}[to]
    numbered = '\n'.join(f'{number + 1}. {line}' for number, line in enumerate(lines))
    answer = (ask or text_ai_service.ask_json)(TRANSLATE_SYSTEM, f'Translate these {len(lines)} lines to {language}:\n{numbered}')
    result = answer.get('lines') if isinstance(answer, dict) else None
    if not isinstance(result, list) or len(result) != len(lines):
        raise ValueError('The AI did not translate every line. Try again.')
    return [re.sub(r'^\s*\d+\.\s*', '', str(line)).strip()[:300] or original for line, original in zip(result, lines)]


DESCRIBE_SYSTEM = """Write the words to post a family, travel or celebration video on Instagram, YouTube or WhatsApp.
Warm and specific, not salesy. Use the language the person asks for ("ta" Tamil script, "en" English, "both" for English with a Tamil line).
Reply as {"title": "under 70 characters", "description": "2 to 4 short sentences", "hashtags": ["#...", up to 10]}"""


def describe(project: dict[str, Any], language: str, ask: Callable[[str, str], Any] | None = None) -> dict[str, Any]:
    answer = (ask or text_ai_service.ask_json)(DESCRIBE_SYSTEM, f'Language: {language}\nThe video:\n{_project_text(project)}')
    if not isinstance(answer, dict) or not answer.get('title'):
        raise ValueError('The AI did not write a title. Try again.')
    tags = [str(tag).strip() for tag in answer.get('hashtags') or [] if str(tag).strip()]
    return {'title': str(answer['title']).strip()[:120], 'description': str(answer.get('description') or '').strip()[:1200],
            'hashtags': [tag if tag.startswith('#') else f'#{tag}' for tag in tags][:10]}

