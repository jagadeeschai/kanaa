"""A still preview of a clip's cinematic looks: one frame, small, through the looks the person is choosing, so they see
the result in a second or two instead of making the whole clip. Each look runs its own per-frame code (the same that
makes the clip on the CPU), in the stack's order, so the preview shows what Apply makes. Motion blur and slow motion
are about movement, so a still can't show them; they are listed as such.
"""
from __future__ import annotations

import base64
import shutil
import subprocess
from typing import Any, Callable

import numpy as np

from app.services import look_tune
from app.services.cutout_service import colour
from app.services.depth_mask_service import make_depth_map
from app.services.media_probe import MediaFacts

WIDTH = 960  # Width of the preview.
ORDER = ['match', 'new_sky', 'night', 'rays', 'atmosphere', 'lens', 'halation']
MOVING = {'slowmo', 'blur', 'shake'}  # Looks a still can't show.
NEEDS_DEPTH = {'new_sky', 'night', 'rays', 'atmosphere', 'lens'}
TUNE_LOOK = {'halation': 'halation', 'match': 'match', 'new_sky': 'sky', 'night': 'night', 'rays': 'rays', 'atmosphere': 'atmosphere', 'lens': 'lens'}


def _grab(path, at: float, size: tuple[int, int], extra: str, pix: str, channels: int) -> np.ndarray | None:
    raw = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-ss', f'{max(0.0, at):.3f}', '-i', str(path), '-frames:v', '1',
                          '-vf', f'{extra}scale={size[0]}:{size[1]}', '-f', 'rawvideo', '-pix_fmt', pix, '-'], capture_output=True).stdout
    count = size[0] * size[1] * channels
    return np.frombuffer(raw[:count], np.uint8).reshape(size[1], size[0], *([channels] if channels > 1 else [])).copy() if len(raw) >= count else None


def jpeg(frame: np.ndarray) -> str:
    import cv2
    ok, data = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return 'data:image/jpeg;base64,' + base64.b64encode(data.tobytes()).decode() if ok else ''


def render(facts: MediaFacts, start: float, end: float, at: float, looks: list[dict], reference: Callable[[int], MediaFacts],
           on_progress: Callable[[int], None] = lambda _: None, should_cancel: Callable[[], bool] = lambda: False) -> dict[str, Any]:
    """The frame `at` seconds into the part start..end, before and after `looks` (each {kind, its choices, tune?})."""
    import cv2
    from app.services import atmosphere_service, film_service, lens_service, match_service, night_service, rays_service, sky_swap_service
    width = WIDTH
    height = max(2, round((facts.height or 1080) * width / (facts.width or 1920) / 2) * 2)
    when = start + min(max(0.0, at), max(0.0, end - start - 0.01))
    original = _grab(facts.path, when, (width, height), f'{colour(facts)},', 'bgr24', 3)
    if original is None:
        raise ValueError('Could not read that moment of the clip.')
    chosen = sorted((look for look in looks if look.get('kind') in ORDER), key=lambda look: ORDER.index(look['kind']))
    near = None
    if any(look['kind'] in NEEDS_DEPTH for look in chosen):
        depth = make_depth_map(facts, lambda value: on_progress(value * 9 // 10), should_cancel)
        grey = _grab(depth, when, (width, height), 'format=gray,', 'gray', 1)
        near = grey.astype(np.float32) / 255 if grey is not None else np.ones((height, width), np.float32)
    frame = original.copy()
    for look in chosen:
        kind = look['kind']
        tune = look_tune.parse(look.get('tune'), TUNE_LOOK[kind])
        if kind == 'match':
            ref = look.get('reference') or {}
            hero = reference(int(ref['media']))
            cube = match_service.build_cube(match_service.sample(hero, float(ref['start']), float(ref['end'])), match_service.sample(facts, start, end), tune)
            frame = match_service.apply_cube(frame, cube)
        elif kind == 'new_sky':
            mask = sky_swap_service.sky_mask(frame, near)
            seen = sky_swap_service.horizon_of(mask)
            margin = sky_swap_service.MARGIN
            horizon = ((seen if seen is not None else 0.5) + margin) / (1 + 2 * margin)
            picture = sky_swap_service.paint_sky(look['sky'], round(width * (1 + 2 * margin)), round(height * (1 + 2 * margin)), horizon)
            frame = sky_swap_service.compose(frame, picture, mask, near, (0.0, 0.0), {**sky_swap_service.SKIES[look['sky']], **tune})
        elif kind == 'night':
            frame = night_service.night_frame(frame, near, {**night_service.settings_for(look.get('mood', 'moonlit')), **tune})
        elif kind == 'rays':
            settings = {**rays_service.PRESETS[look.get('preset', 'soft')], **tune}
            small = (rays_service.SMALL, max(2, round(height * rays_service.SMALL / width)))
            frame_small, near_small = cv2.resize(frame, small, interpolation=cv2.INTER_AREA), cv2.resize(near, small, interpolation=cv2.INTER_AREA)
            light = rays_service.find_light(frame_small, near_small) or (0.5, 0.15)
            frame = rays_service.compose(frame, rays_service.beams(rays_service.light_mask(frame_small, near_small, light), light, settings), settings)
        elif kind == 'atmosphere':
            frame = atmosphere_service.air_frame(frame, near, {**atmosphere_service.settings_for(look.get('preset', 'mist'), look.get('strength', 'medium')), **tune})
        elif kind == 'lens':
            focus, amount, glow = lens_service.plan(look.get('preset', 'portrait'), look.get('strength', 'medium'), end - start)
            amount = tune.get('amount', amount)
            if 'focus' in tune and not str(look.get('preset', '')).startswith('rack'):
                focus = [(0.0, tune['focus'])]
            frame = lens_service.lens_frame(frame, near, lens_service.focus_at(focus, when - start), amount, glow)
        elif kind == 'halation':
            frame = film_service.halation_frame(frame, {**film_service.HALATION[look.get('preset', 'classic')], **tune})
    on_progress(100)
    return {'before': jpeg(original), 'after': jpeg(frame), 'not_shown': sorted({look.get('kind') for look in looks} & MOVING)}
