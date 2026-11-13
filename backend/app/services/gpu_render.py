"""The GPU render engine's Python side (foundation; not yet used by exports).

native/gpu_render.swift draws each frame with Core Image on the GPU and encodes it in hardware. This module decides
whether a timeline is within what the engine can draw yet (`unsupported`), and turns it into the engine's plan: for
every item, its source and, frame by frame, where it sits, how big and how see-through, worked out with the same
maths as the ffmpeg export (timeline_schema.value_at, shared_fit, OPACITY_SPAN), so the two agree.

What it draws today: pictures and videos on video layers, and titles (drawn by the export's own title renderer, karaoke
included), with moves, size and opacity (keyframed or not) and fade entrances and exits. Anything else is listed by `unsupported` and that export stays with ffmpeg. Coverage grows effect
by effect, each checked frame by frame against the ffmpeg export (tests/test_gpu_render.py).
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Callable

from app.services.animation import OPACITY_SPAN
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Timeline, value_at

SOURCE = Path(__file__).resolve().parents[2] / 'native' / 'gpu_render.swift'
FADES = {'fade'}  # Entrance and exit presets drawn so far.
DEFAULT_ADJUST = {'rotation': 0, 'flip_horizontal': False, 'flip_vertical': False, 'brightness': 1, 'contrast': 1, 'saturation': 1, 'gamma': 1, 'temperature': 1, 'tint': 1, 'fade': 0}
EFFECTS = ('old_film', 'signal_damage', 'lens_surface', 'colour_splash', 'dreamy_glow', 'beat_pulse', 'tone_grade', 'mirror', 'zoom_blur', 'tilt_shift', 'echo',
           'chroma', 'freeze', 'reverse', 'ramp', 'cutout', 'shape', 'focus_pull', 'transition_in')


def unsupported(timeline: Timeline, media: Callable[[int], MediaFacts]) -> list[str]:
    """What in `timeline` the engine cannot draw yet; empty when it can draw all of it."""
    found: set[str] = set()
    if timeline.finish or timeline.lut:
        found.add('finish or LUT')
    for layer in timeline.layers:
        if layer.hidden or layer.kind == 'audio':
            continue
        if layer.kind == 'text':
            from app.services import title3d
            for item in layer.items:
                if title3d.is_3d(item):
                    found.add('3D, tilted or pinned titles')
                if item.keep_clear or item.stay_with:
                    found.add('titles that move with people')
                if set(item.transform.keyframes) - {'x', 'y', 'scale', 'opacity'} or item.transform.rotation:
                    found.add('rotation and tilt')
                for move in (item.enter, item.exit):
                    if move and move.preset not in FADES:
                        found.add(f'{move.preset} animation')
            continue
        if layer.kind != 'video':
            found.add(f'{layer.kind} layers')
            continue
        if layer.blend != 'normal':
            found.add(f'{layer.blend} blend')
        for clip in layer.items:
            if not clip.enabled:
                continue
            data = clip.model_dump()
            found.update(name.replace('_', ' ') for name in EFFECTS if data.get(name))
            if clip.look != 'none':
                found.add('looks')
            if clip.adjust.model_dump() != DEFAULT_ADJUST:
                found.add('colour and turn adjustments')
            if clip.transform.rotation or clip.transform.tilt_x or clip.transform.tilt_y or set(clip.transform.keyframes) - {'x', 'y', 'scale', 'opacity'}:
                found.add('rotation and tilt')
            for move in (clip.enter, clip.exit):
                if move and move.preset not in FADES:
                    found.add(f'{move.preset} animation')
            facts = media(clip.media_id)
            if facts.media_type not in ('image', 'video'):
                found.add(f'{facts.media_type} media')
            if getattr(facts, 'rotation', 0):
                found.add('rotated phone video')
    return sorted(found)


def _frames(transform, enter, exit_, length: float, frames: int, fps: int) -> dict:
    """Per frame of an item: where it sits, how big and how see-through, as the ffmpeg export's pose() works it out."""
    from app.services.timeline_service import shared_fit
    first, last = shared_fit(enter, exit_, length)
    first_fade = first * OPACITY_SPAN['fade'] if enter else 0
    last_fade = last * OPACITY_SPAN['fade'] if exit_ else 0
    xs, ys, sizes, seen = [], [], [], []
    for k in range(frames):
        t = k / fps
        xs.append(round(value_at(transform, 'x', t), 6))
        ys.append(round(value_at(transform, 'y', t), 6))
        sizes.append(round(value_at(transform, 'scale', t), 6))
        alpha = value_at(transform, 'opacity', t)
        if first_fade:
            alpha *= min(1, t / first_fade)
        if last_fade:
            alpha *= min(1, max(0, (length - t) / last_fade))
        seen.append(round(alpha, 5))
    return {'x': xs, 'y': ys, 'scale': sizes, 'opacity': seen}


def _title(item, fmt, folder: Path, name: str) -> dict:
    """A title as the export draws it: one full-frame picture, or for karaoke one per word sung so far, shown in turn."""
    from app.services.timeline_service import karaoke_states, render_text_image
    fps = fmt.fps
    frames = max(1, round(item.length * fps))
    image = folder / f'{name}.png'
    render_text_image(item, fmt, image)
    found = {'kind': 'image', 'path': str(image), 'start': round(item.start * fps), 'frames': frames, 'source_in': 0, 'speed': 1,
             **_frames(item.transform, item.enter, item.exit, frames / fps, frames, fps)}
    if item.karaoke and item.karaoke.words and not item.design:
        states = karaoke_states(item)
        paths = []
        for number, (_, _, lit) in enumerate(states):
            picture = image if lit is None else folder / f'{name}-lit{number}.png'
            if lit is not None:
                render_text_image(item, fmt, picture, lit=lit)
            paths.append(str(picture))
        # Each frame shows the state its moment falls in, as the concat reader and fps filter pick it.
        found['paths'] = paths
        found['shown'] = [max(n for n, (start, _, _) in enumerate(states) if start <= k / fps + 1e-6) for k in range(frames)]
    return found


def plan(timeline: Timeline, media: Callable[[int], MediaFacts], output: Path, bitrate: int, folder: Path | None = None) -> dict:
    """The engine's plan for a timeline `unsupported` accepts. Title pictures are drawn into `folder`."""
    fps = timeline.format.fps
    items = []
    for position, layer in enumerate(timeline.layers):
        if layer.hidden or layer.kind not in ('video', 'text'):
            continue
        if layer.kind == 'text':
            for number, item in enumerate(sorted(layer.items, key=lambda text: text.start)):
                items.append(_title(item, timeline.format, folder or output.parent, f'title-{position}-{number}'))
            continue
        for clip in layer.items:
            if not clip.enabled:
                continue
            frames = max(1, round(clip.length * fps))
            facts = media(clip.media_id)
            items.append({'kind': facts.media_type, 'path': str(facts.path), 'start': round(clip.start * fps), 'frames': frames, 'source_in': clip.in_, 'speed': clip.speed,
                          **_frames(clip.transform, clip.enter, clip.exit, frames / fps, frames, fps)})
    return {'width': timeline.format.width, 'height': timeline.format.height, 'fps': fps, 'frames': round(timeline.duration * fps),
            'bitrate': bitrate, 'output': str(output), 'items': items}


def render(timeline: Timeline, media: Callable[[int], MediaFacts], output: Path, on_progress: Callable[[int], None] = lambda _: None,
           bitrate: int = 16_000_000, tool: Path | None = None) -> None:
    """A silent video of `timeline` drawn on the GPU. Raises ValueError naming what it cannot draw yet."""
    missing = unsupported(timeline, media)
    if missing:
        raise ValueError('The GPU engine cannot draw these yet: ' + ', '.join(missing))
    if tool is None:
        from app.services.cutout_service import helper
        tool = helper(SOURCE)
    import tempfile
    pictures = tempfile.TemporaryDirectory(prefix='.gpu-titles-', dir=output.parent)
    work = plan(timeline, media, output, bitrate, Path(pictures.name))
    plan_file = output.with_suffix('.plan.json')
    plan_file.write_text(json.dumps(work), encoding='utf-8')
    try:
        process = subprocess.Popen([str(tool), str(plan_file)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert process.stdout is not None
        for line in process.stdout:
            if line.startswith('frame '):
                on_progress(min(99, int(int(line.split()[1]) / max(1, work['frames']) * 100)))
        error = process.stderr.read() if process.stderr else ''
        process.stdout.close()
        if process.stderr:
            process.stderr.close()
        if process.wait() or not output.exists():
            raise RuntimeError(f'The GPU engine failed: {error.strip()[-500:]}')
    finally:
        plan_file.unlink(missing_ok=True)
        pictures.cleanup()
