"""The GPU render engine's Python side (foundation; not yet used by exports).

native/gpu_render.swift draws each frame with Core Image on the GPU and encodes it in hardware. This module decides
whether a timeline is within what the engine can draw yet (`unsupported`), and turns it into the engine's plan: for
every item, its source and, frame by frame, where it sits, how big and how see-through, worked out with the same
maths as the ffmpeg export (timeline_schema.value_at, shared_fit, OPACITY_SPAN), so the two agree.

What it draws today: pictures and videos on video layers, and titles (drawn by the export's own title renderer, karaoke
included), with moves, size and opacity (keyframed or not), fade entrances and exits, and crossfade, cross-blur, dip
and flash transitions. Anything else is listed by `unsupported` and that export stays with ffmpeg. Coverage grows effect
by effect, each checked frame by frame against the ffmpeg export (tests/test_gpu_render.py).
"""
from __future__ import annotations

import json
import math
import subprocess
import time
from pathlib import Path
from typing import Callable

from app.services.animation import BEAT_SLACK, OPACITY_SPAN
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Timeline, clip_frames, value_at

SOURCE = Path(__file__).resolve().parents[2] / 'native' / 'gpu_render.swift'
FADES = {'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom', 'pop', 'blur', 'bounce', 'ground-rise', 'blast', 'magic-form', 'magic-vanish', 'particle-form', 'fly-through', 'rapid-zoom'}
DEFAULT_ADJUST = {'rotation': 0, 'flip_horizontal': False, 'flip_vertical': False, 'brightness': 1, 'contrast': 1, 'saturation': 1, 'gamma': 1, 'temperature': 1, 'tint': 1, 'fade': 0}
EFFECTS = ('old_film', 'signal_damage', 'lens_surface', 'colour_splash', 'beat_pulse', 'tone_grade', 'mirror', 'zoom_blur', 'tilt_shift', 'echo',
           'chroma', 'freeze', 'reverse', 'ramp', 'cutout', 'shape', 'focus_pull')
TRANSITIONS = {'crossfade', 'cross-blur', 'dip', 'flash', 'light-wipe'}  # Drawn so far: a mix of the two pictures and a fill colour, blurred for cross-blur.


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
                if item.graphic is not None:
                    found.add('explainer graphics')
                if item.keep_clear or item.stay_with:
                    found.add('titles that move with people')
                if title3d.is_3d(item):
                    # Drawn frame by frame by the export's own title renderer (title3d_render), then laid on as pictures;
                    # a pinned title follows the camera through the clip, which only the ffmpeg path does.
                    if item.pin:
                        found.add('pinned titles')
                    continue
                if set(item.transform.keyframes) - {'x', 'y', 'scale', 'opacity'} or item.transform.rotation:
                    found.add('rotation and tilt')
                for move in (item.enter, item.exit):
                    if move and move.preset not in FADES:
                        found.add(f'{move.preset} animation')
            continue
        if layer.kind != 'video':
            found.add(f'{layer.kind} layers')
            continue
        if layer.blend not in ('normal', 'screen', 'add'):
            found.add(f'{layer.blend} blend')
        for clip in layer.items:
            if not clip.enabled:
                continue
            data = clip.model_dump()
            if clip.freeze is not None:
                found.add('freeze')
            found.update(name.replace('_', ' ') for name in EFFECTS if data.get(name) and not (name == 'cutout' and clip.cutout == 'remove') and name not in ('beat_pulse', 'zoom_blur'))
            if clip.stabilise or clip.shape_mask:
                found.add('stabilisation or shape mask')
            if clip.transition_in and clip.transition_in.kind not in TRANSITIONS:
                found.add(f'{clip.transition_in.kind} transition')
            if clip.adjust.rotation or clip.adjust.flip_horizontal or clip.adjust.flip_vertical:
                found.add('turn adjustments')
            if clip.transform.tilt_x or clip.transform.tilt_y or set(clip.transform.keyframes) - {'x', 'y', 'scale', 'opacity', 'rotation'}:
                found.add('rotation and tilt')
            for move in (clip.enter, clip.exit):
                if move and move.preset not in FADES:
                    found.add(f'{move.preset} animation')
            facts = media(clip.media_id)
            if facts.is_hdr:
                found.add('HDR tone mapping')
            if facts.media_type not in ('image', 'video'):
                found.add(f'{facts.media_type} media')
            if getattr(facts, 'rotation', 0):
                found.add('rotated phone video')
    return sorted(found)


from app.services.colour_wheels import vectors as wheel_vectors  # noqa: E402


def colour_constants(adjust, look: str) -> dict:
    """The reference picture_filters constants, rounded at the same filter boundary."""
    from app.services.animation import LOOKS
    r, g, b, contrast, saturation = LOOKS[look]
    rounded = lambda v: round(v, 5)
    return {'tint': [rounded(r * adjust.brightness * adjust.temperature),
                     rounded(g * adjust.brightness * adjust.tint),
                     rounded(b * adjust.brightness * (2 - adjust.temperature))],
            'power': rounded(1 / adjust.gamma), 'fade': rounded(adjust.fade),
            'contrast': rounded(contrast * adjust.contrast), 'saturation': rounded(saturation * adjust.saturation)}


def glow_constants(effect, fit: float = 1.0) -> dict | None:
    """Match dreamy_glow_filters; the preview uses a different screened bloom. The export softens after the picture is
    fitted into its working canvas (clip_chain), but the engine softens the source picture, so the radius is given in
    source pixels: the canvas radius divided by `fit`, the canvas pixels per source pixel."""
    if effect is None or effect.intensity <= 0:
        return None
    return {'radius': round((3 + round(effect.softness * 8)) / 3 / max(fit, 1e-6), 4),
            'amount': round(.25 + effect.intensity * .9, 4),
            'lift': round(effect.intensity * .035, 4), 'saturation': round(1 + effect.intensity * .04, 4),
            'red': round(effect.warmth * effect.intensity * .045, 4),
            'blue': round(-effect.warmth * effect.intensity * .025, 4)}


def _canvas_fit(clip, enter, exit_, facts, fmt) -> float:
    """Canvas pixels per source pixel where the export applies picture effects: the source fitted inside the working
    canvas (clip_chain), whose size comes from supersample()."""
    from app.services.timeline_service import supersample
    if not facts.width or not facts.height:
        return 1.0
    scale = supersample(clip.transform, enter, exit_, facts, fmt)
    canvas_w, canvas_h = round(fmt.width * scale / 2) * 2, round(fmt.height * scale / 2) * 2
    return min(canvas_w / facts.width, canvas_h / facts.height)


def _frames(transform, enter, exit_, length: float, frames: int, fps: int, lead: int = 0) -> dict:
    """Per frame of an item: where it sits, how big and how see-through, as the ffmpeg export's pose() works it out."""
    from app.services.timeline_service import shared_fit
    first, last = shared_fit(enter, exit_, length)
    from app.services.animation import look_at
    first_fade = first * OPACITY_SPAN.get(enter.preset, 0) if enter else 0
    last_fade = last * OPACITY_SPAN.get(exit_.preset, 0) if exit_ else 0
    dx, dy, zoom, blur = [], [], [], []
    xs, ys, sizes, seen = [], [], [], []
    for k in range(frames):
        t = (k - lead) / fps  # A transition's extra frames before the clip's own start come first.
        xs.append(round(value_at(transform, 'x', t), 6))
        ys.append(round(value_at(transform, 'y', t), 6))
        sizes.append(round(value_at(transform, 'scale', t), 6))
        alpha = value_at(transform, 'opacity', t)
        if first_fade:
            alpha *= min(1, t / first_fade)
        if last_fade:
            alpha *= min(1, max(0, (length - t) / last_fade))
        seen.append(round(alpha, 5))
        moves = ([look_at(enter.preset, t / first)] if enter else []) + ([look_at(exit_.preset, (length - t) / last)] if exit_ else [])
        dx.append(sum(m['dx'] for m in moves))
        dy.append(sum(m['dy'] for m in moves))
        zoom.append(math.prod(m['scale'] for m in moves))
        # CI's Gaussian radius differs from ffmpeg's one-step recursive sigma; calibrated on animated glyph edges.
        blur.append(.5 * max([m['blur'] for m in moves] or [0]))
    return {'x': xs, 'y': ys, 'scale': sizes, 'opacity': seen, 'dx': dx, 'dy': dy, 'zoom': zoom, 'blur': blur}


def _title(item, fmt, folder: Path, name: str) -> dict:
    """A title as the export draws it: one full-frame picture, or for karaoke one per word sung so far, shown in turn."""
    from app.services.timeline_service import karaoke_states, render_text_image
    from app.services import title3d
    fps = fmt.fps
    frames = max(1, round(item.length * fps))
    image = folder / f'{name}.png'
    render_text_image(item, fmt, image)
    if title3d.is_3d(item):
        # Depth, tilt and the letter tricks (pop-letters, reveal, line...): the export's own frames, already in place,
        # each different one drawn once (title3d_render.render_title_sequence).
        from app.services.title3d_render import render_title_sequence
        states = None
        if item.karaoke and item.karaoke.words and not item.design:
            states = []
            for number, (start, end, lit) in enumerate(karaoke_states(item)):
                picture = image if lit is None else folder / f'{name}-lit{number}.png'
                if lit is not None:
                    render_text_image(item, fmt, picture, lit=lit)
                states.append((start, end, picture))
        paths, shown = render_title_sequence(item, image, (fmt.width, fmt.height), fps, frames, folder, f'{name}-frame', states=states)
        return {'kind': 'image', 'path': paths[0], 'paths': paths, 'shown': shown, 'start': round(item.start * fps), 'frames': frames, 'source_in': 0, 'speed': 1,
                'x': [0.5] * frames, 'y': [0.5] * frames, 'scale': [1.0] * frames, 'opacity': [1.0] * frames}
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
    from app.services import particle_frames
    if particle_frames.has_particles(item):
        paths = found.get('paths', [str(image)])
        shown = found.get('shown', [0] * frames)
        listing = particle_frames.listing(item, fps, frames, lambda t: Path(paths[shown[min(frames - 1, round(t * fps))]]), folder, name)
        found['paths'] = [str(path) for path, _ in listing]
        found['shown'] = [index for index, (_, count) in enumerate(listing) for _ in range(count)]
    return found


def _halves(clips, fps: int) -> list[int]:
    """Frames either side of each clip's opening cut, as Builder.transition_frames (and transitionHalf in model.ts)."""
    halves = [0] * len(clips)
    for number, (before, clip) in enumerate(zip(clips, clips[1:]), start=1):
        (first, length), (start, own) = clip_frames(before, fps), clip_frames(clip, fps)
        if clip.transition_in and first + length == start:
            halves[number] = min(round(clip.transition_in.duration * fps / 2), length // 2, own // 2)
    return halves


def _smooth(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def _transition(transition, frames: int, height: int) -> dict:
    """How the clip before and this one mix, frame by frame through the transition: weights of the clip before, this
    clip and a fill colour (ffmpeg xfade: fade, and fadeblack/fadewhite or the custom dip of animation.xfade_name),
    and for a cross blur the blur at each frame (Builder.whip_blur)."""
    from app.services.animation import CROSS_BLUR
    kind = transition.kind
    colour = (transition.color or ('#ffffff' if kind == 'flash' else '#000000')).lower()
    weights, blur = [], []
    for i in range(frames):
        p = 1 - i / frames  # xfade's progress: 1 shows the clip before, 0 this one.
        if kind in ('dip', 'flash'):
            before, after = _smooth((p - .8) / .2), _smooth((p - .2) / .8)
            weights.append([round(p * before, 6), round((1 - p) * (1 - after), 6), round(p * (1 - before) + (1 - p) * after, 6)])
        else:
            weights.append([round(p, 6), round(1 - p, 6), 0])
        blur.append(round(CROSS_BLUR * height * math.sin(math.pi * min(1, (i + 0.5) / frames)), 4) if kind == 'cross-blur' else 0)
    return {'kind': kind, 'frames': frames, 'weights': weights, 'blur': blur, 'fill': [int(colour[k:k + 2], 16) / 255 for k in (1, 3, 5)]}


def plan(timeline: Timeline, media: Callable[[int], MediaFacts], output: Path, bitrate: int, folder: Path | None = None, masks=None) -> dict:
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
        clips = sorted((clip for clip in layer.items if clip.enabled), key=lambda clip: clip.start)
        halves = _halves(clips, fps)
        for number, clip in enumerate(clips):
            head, tail = halves[number], halves[number + 1] if number + 1 < len(clips) else 0
            first, base = clip_frames(clip, fps)
            facts = media(clip.media_id)
            # As the export: a transition is centred on the cut. The clip before plays on for half of it and this one
            # starts half of it early (its first frame held where the source has nothing earlier); their entrances and
            # exits give way to it.
            enter, exit_ = None if head else clip.enter, None if tail else clip.exit
            items.append({'kind': facts.media_type, 'path': str(facts.path), 'start': first - head, 'frames': base + head + tail,
                          'source_in': clip.in_ - head * clip.speed / fps, 'speed': clip.speed, 'colour': colour_constants(clip.adjust, clip.look), 'wheels': wheel_vectors(clip.wheels), 'glow': glow_constants(clip.dreamy_glow, _canvas_fit(clip, enter, exit_, facts, timeline.format)),
                          **_frames(clip.transform, enter, exit_, base / fps, base + head + tail, fps, head)})
            from app.services.gpu_masks import resolve
            items[-1]['mask_path'] = resolve(clip, facts, masks)
            items[-1]['blend'] = layer.blend
            if clip.zoom_blur and clip.zoom_blur.intensity > 0:
                effect = clip.zoom_blur
                items[-1]['zoom_blur'] = {'scales': [round(1 + .22 * effect.intensity * k / 7, 6) for k in range(8)],
                                         'x': effect.center_x, 'y': effect.center_y}
            items[-1]['rotation'] = [value_at(clip.transform, 'rotation', (k - head) / fps) for k in range(base + head + tail)]
            if clip.beat_pulse:
                pulse = clip.beat_pulse
                for k in range(base + head + tail):
                    t = (k - head) / fps + BEAT_SLACK
                    phase = max(0, t - pulse.offset) % (60 / pulse.bpm)
                    amount = max(0, 1 - phase / .18) if t >= pulse.offset else 0
                    items[-1]['scale'][k] *= 1 + pulse.size * pulse.strength * amount
            if head:
                items[-1]['transition'] = _transition(clip.transition_in, 2 * head, timeline.format.height)
    return {'width': timeline.format.width, 'height': timeline.format.height, 'fps': fps, 'frames': round(timeline.duration * fps),
            'bitrate': bitrate, 'output': str(output), 'items': items}


def render(timeline: Timeline, media: Callable[[int], MediaFacts], output: Path, on_progress: Callable[[int], None] = lambda _: None,
           bitrate: int = 16_000_000, tool: Path | None = None, masks=None, should_cancel=lambda: False) -> None:
    """A silent video of `timeline` drawn on the GPU. Raises ValueError naming what it cannot draw yet."""
    missing = unsupported(timeline, media)
    if missing:
        raise ValueError('The GPU engine cannot draw these yet: ' + ', '.join(missing))
    if tool is None:
        from app.services.cutout_service import helper
        tool = helper(SOURCE)
    import tempfile
    pictures = tempfile.TemporaryDirectory(prefix='.gpu-titles-', dir=output.parent)
    work = plan(timeline, media, output, bitrate, Path(pictures.name), masks)
    plan_file = output.with_suffix('.plan.json')
    plan_file.write_text(json.dumps(work), encoding='utf-8')
    process = None
    errors = tempfile.TemporaryFile(mode='w+')
    try:
        process = subprocess.Popen([str(tool), str(plan_file)], stdout=subprocess.PIPE, stderr=errors, text=True)
        from app.services.job_service import stop_process_when, JobCancelled
        last_frame = [time.monotonic()]
        stalled = [False]
        def stop():
            stalled[0] = time.monotonic() - last_frame[0] > 180
            return should_cancel() or stalled[0]
        stop_process_when(process, stop)
        assert process.stdout is not None
        for line in process.stdout:
            if line.startswith('frame '):
                last_frame[0] = time.monotonic()
                on_progress(min(99, int(int(line.split()[1]) / max(1, work['frames']) * 100)))
        errors.seek(0)
        error = errors.read()
        process.stdout.close()
        if process.stderr:
            process.stderr.close()
        code = process.wait()
        if should_cancel():
            raise JobCancelled()
        if stalled[0]:
            raise RuntimeError('GPU renderer stopped reporting frames')
        if code or not output.exists():
            raise RuntimeError(f'The GPU engine failed: {error.strip()[-500:]}')
    finally:
        if process is not None and process.poll() is None:
            process.kill()
            process.wait()
        errors.close()
        plan_file.unlink(missing_ok=True)
        pictures.cleanup()
