"""Picture lights on a built lyric video: each picture with a night sky or lamps gets them brought alive (twinkling
stars, a glowing moon, flickering lamps), laid over every shot of it with that shot's own move, so the light stays
on the sky and the flames. Pictures with neither are left alone."""
from __future__ import annotations

import copy

LAYER = 'lyric-picture-lights'


def length_of(clip: dict) -> float:
    return (clip['out'] - clip['in']) / clip.get('speed', 1)


def add(timeline: dict, lights_for) -> list[int]:
    """lights_for(picture media id, seconds) -> the lights video's media id, or None when that picture has nothing to
    light. Returns the media ids made. Run last, once every shot has its final size and move."""
    main = timeline['layers'][0]['items']
    scenes: dict[str, list[dict]] = {}
    for clip in main:
        if clip['id'].startswith('lyric-scene-'):
            scenes.setdefault(clip['id'].split('-')[2], []).append(clip)  # lyric-scene-3, lyric-scene-3-2... are one picture.
    pieces, made = [], []
    for shots in scenes.values():
        picture = shots[0]['media_id']  # The first shot is the picture itself, never a painting.
        start = shots[0]['start']
        seconds = round(max(shot['start'] + length_of(shot) for shot in shots) - start, 3)
        sky = lights_for(picture, seconds)
        if sky is None:
            continue
        made.append(sky)
        for shot in shots:
            into = round(shot['start'] - start, 3)
            pieces.append({'id': f"{shot['id']}-sky", 'media_id': sky, 'start': shot['start'], 'in': into, 'out': round(into + length_of(shot), 3), 'speed': 1,
                           'volume': 0, 'muted': True, 'fade_in': 0, 'fade_out': 0, 'transform': copy.deepcopy(shot['transform']),
                           'adjust': {'rotation': 0, 'flip_horizontal': False, 'flip_vertical': False, 'brightness': 1, 'contrast': 1, 'saturation': 1}})
    if pieces:
        timeline['layers'].insert(1, {'id': LAYER, 'kind': 'video', 'name': 'Picture lights', 'blend': 'screen', 'items': pieces})
    return made
