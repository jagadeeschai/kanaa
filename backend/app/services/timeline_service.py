"""Compiles a timeline into one ffmpeg graph, and upgrades older project recipes."""
from __future__ import annotations

import logging
import json
import math
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from app.api.schemas import VideoEditRequest
from app.services.animation import LOOKS, OPACITY_SPAN, XFADE_NAMES, look_at, offset_expression, scale_expression
from app.services.job_service import JobCancelled, stop_process_when
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import value_at, Adjust, Animation, Clip, Format, Sound, Text, Timeline, Transform, VideoLayer
from app.services.video_edit_service import (
    BT709_OUTPUT_ARGS, HDR_TO_BT709, LYRIC_FONTS_DIR, SD_COLOR_SPACES, STALLED_AFTER_SECONDS, TAG_BT709, TO_BT709, run_cancellable, write_lyrics,
)

logger = logging.getLogger(__name__)
AUDIO_FORMAT = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'
# Matched by editor/audio.ts. A gentle ratio dips music by about 8 to 14 dB under normal speech.
DUCK_THRESHOLD = 0.02
DUCK_RATIO = 2
DUCK_FILTER = f'sidechaincompress=threshold={DUCK_THRESHOLD}:ratio={DUCK_RATIO}:attack=20:release=400:level_sc=1'
LUMA_RED, LUMA_GREEN, LUMA_BLUE = 0.2126, 0.7152, 0.0722
MAX_SUPERSAMPLE = 4
MIN_WORK_SCALE = 0.1
LOUDNORM = 'loudnorm=I=-14:TP=-1:LRA=11'  # -14 LUFS is what the main social platforms aim for.
MAX_ATEMPO_STEP = 2.0
MIN_ATEMPO_STEP = 0.5


@dataclass
class Compiled:
    args: list[str]
    graph: str
    duration: float
    audio_args: list[str]
    audio_graph: str
    normalize_audio: bool = False

    @property
    def has_audio(self) -> bool:
        return bool(self.audio_graph)


def ease_expression(name: str, p: str) -> str:
    return {'linear': p, 'easeOut': f'(1-pow(1-{p},3))',
            'easeInOut': f'if(lt({p},0.5),4*pow({p},3),1-pow(-2*{p}+2,3)/2)'}[name]


def property_expression(transform: Transform, prop: str, clock: str = 't') -> str:
    """The curve from timeline_schema.value_at as an ffmpeg expression of `clock`."""
    keys = transform.keyframes.get(prop)
    if not keys:
        return f'{getattr(transform, prop)}'
    tail = f'{keys[-1].v}'
    for a, b in reversed(list(zip(keys, keys[1:]))):
        p = f'(({clock}-{a.t})/{b.t - a.t})'
        tail = f'if(lt({clock},{b.t}),{a.v}+({b.v - a.v})*{ease_expression(a.ease, p)},{tail})'
    return f'if(lte({clock},{keys[0].t}),{keys[0].v},{tail})'


def adjust_filters(adjust: Adjust) -> list[str]:
    filters = []
    if adjust.rotation == 90:
        filters.append('transpose=clock')
    elif adjust.rotation == 180:
        filters += ['hflip', 'vflip']
    elif adjust.rotation == 270:
        filters.append('transpose=cclock')
    if adjust.flip_horizontal:
        filters.append('hflip')
    if adjust.flip_vertical:
        filters.append('vflip')
    return filters


def picture_filters(adjust: Adjust, look: str) -> list[str]:
    """The preview shader's steps in its order, on RGB values, so the two can't disagree."""
    red, green, blue, contrast, saturation = LOOKS[look]
    contrast *= adjust.contrast
    saturation *= adjust.saturation
    b = adjust.brightness
    filters = []
    if (red, green, blue, b) != (1, 1, 1, 1):
        filters.append(f'colorchannelmixer=rr={red * b:.5f}:gg={green * b:.5f}:bb={blue * b:.5f}')
    if contrast != 1:
        curve = f'clip((val-127.5)*{contrast:.5f}+127.5,0,255)'
        filters.append(f"lutrgb=r='{curve}':g='{curve}':b='{curve}'")
    if saturation != 1:
        keep = 1 - saturation
        r, g, l = LUMA_RED * keep, LUMA_GREEN * keep, LUMA_BLUE * keep
        filters.append(f'colorchannelmixer=rr={r + saturation:.5f}:rg={g:.5f}:rb={l:.5f}:gr={r:.5f}:gg={g + saturation:.5f}:gb={l:.5f}:br={r:.5f}:bg={g:.5f}:bb={l + saturation:.5f}')
    return ['format=rgba', *filters] if filters else []


def color_filter(facts: MediaFacts) -> str:
    if facts.media_type == 'image':
        return 'format=gbrap'  # Pictures are already RGB, and a logo's transparency must survive.
    if facts.color_space in SD_COLOR_SPACES:
        # scale leaves the old label on the frame, and later steps would convert it a second time.
        return f'{TO_BT709},{TAG_BT709}'
    return HDR_TO_BT709 if facts.is_hdr else TAG_BT709


def clip_chain(clip: Clip, facts: MediaFacts, canvas: tuple[int, int], fps: int, frames: int, held_head: int = 0) -> str:
    """Bring any source to one size, rate and color, and exactly `frames` long. held_head repeats the first frame."""
    W, H = canvas
    steps = [color_filter(facts), 'scale=trunc(iw*sar/2)*2:ih', 'setsar=1', *adjust_filters(clip.adjust), *picture_filters(clip.adjust, clip.look)]
    if clip.speed != 1:
        steps.append(f'setpts=PTS/{clip.speed}')
    steps += [f'fps={fps}', f'scale={W}:{H}:force_original_aspect_ratio=decrease:flags=bicubic', 'format=gbrap',
              f'pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black@0', 'setsar=1']
    if held_head:
        steps.append(f'tpad=start={held_head}:start_mode=clone')
    # Short or variable sources are held on their last frame, so later layers never slip.
    steps += ['tpad=stop=-1:stop_mode=clone', f'trim=end_frame={frames}', 'setpts=PTS-STARTPTS', 'settb=AVTB']
    return ','.join(steps)


def shared_fit(enter: Animation | None, exit_: Animation | None, length: float) -> tuple[float, float]:
    """Overlong animations share the item's length, like fades."""
    first, last = enter.duration if enter else 0, exit_.duration if exit_ else 0
    excess = max(1, (first + last) / length)
    return first / excess, last / excess


def supersample(transform: Transform, enter: Animation | None, exit_: Animation | None, facts: MediaFacts | None, fmt: Format) -> float:
    """Work at the largest size the item reaches, within its source: sharp when zoomed in, cheap when small."""
    if facts is None or not facts.width or not facts.height:
        return 1
    keys = transform.keyframes.get('scale', [])
    largest = max([transform.scale, *(key.v for key in keys)])
    if any(item and item.preset == 'pop' for item in (enter, exit_)):
        largest *= 1.11  # The overshoot.
    if largest < 1:
        return max(largest, MIN_WORK_SCALE)  # A small overlay needs no full-size frames to turn and scale.
    detail = max(facts.width, facts.height) / min(fmt.width, fmt.height)
    return max(1, min(largest, detail, MAX_SUPERSAMPLE))


def atempo_chain(speed: float) -> list[str]:
    steps = []
    while speed > MAX_ATEMPO_STEP:
        steps.append(f'atempo={MAX_ATEMPO_STEP}')
        speed /= MAX_ATEMPO_STEP
    while speed < MIN_ATEMPO_STEP:
        steps.append(f'atempo={MIN_ATEMPO_STEP}')
        speed /= MIN_ATEMPO_STEP
    return [*steps, f'atempo={speed}'] if speed != 1 else steps


def sound_steps(item: Clip | Sound) -> list[str]:
    """Fades are in timeline seconds, so they follow the speed change. Overlong fades share the item's length."""
    length = item.length
    excess = max(1, (item.fade_in + item.fade_out) / length)
    fade_in, fade_out = item.fade_in / excess, item.fade_out / excess
    steps = [AUDIO_FORMAT, *atempo_chain(item.speed), f'volume={item.volume}']
    if fade_in:
        steps.append(f'afade=t=in:st=0:d={fade_in}')
    if fade_out:
        steps.append(f'afade=t=out:st={length - fade_out}:d={fade_out}')
    return [*steps, f'adelay={round(item.start * 1000)}:all=1']


def render_text_image(item: Text, fmt: Format, target: Path) -> None:
    """Text goes through libass once, so preview and export share the same letters."""
    edit = VideoEditRequest(canvas='original', lyric_style=item.style, lyric_size=max(20, item.size), lyric_position=item.position,
                            lyric_color=item.color, lyrics=[{'start': 0, 'end': 1, 'text': item.text}])
    with tempfile.TemporaryDirectory() as folder:
        folder = Path(folder)
        write_lyrics(folder / 'lyrics.ass', edit, Path('/dev/null'), size=(fmt.width, fmt.height))
        (folder / 'fonts').symlink_to(LYRIC_FONTS_DIR)
        result = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'color=c=black@0:s={fmt.width}x{fmt.height}:r=30:d=0.5,format=rgba',
                                 '-vf', 'ass=filename=lyrics.ass:shaping=complex:fontsdir=fonts:alpha=1', '-frames:v', '1', '-update', '1', str(target)],
                                cwd=folder, capture_output=True, text=True)
    if result.returncode:
        logger.error('Text render failed: %s', result.stderr[-800:])
        raise RuntimeError('Could not render the text on this timeline.')


class Builder:
    def __init__(self, timeline: Timeline, media: Callable[[int], MediaFacts], audio_asset: Callable[[str], Path], folder: Path):
        self.timeline, self.media, self.audio_asset, self.folder = timeline, media, audio_asset, folder
        self.fmt = timeline.format
        self.args: list[str] = []
        self.graph: list[str] = []
        self.audio: list[str] = []
        self.ducked: list[str] = []
        self.audio_args: list[str] = []
        self.audio_graph: list[str] = []
        self.audio_inputs = 0
        self.inputs = 0
        self.duration = timeline.duration
        self.total_frames = max(1, round(self.duration * self.fmt.fps))

    def add_input(self, *args: str) -> int:
        self.args += args
        self.inputs += 1
        return self.inputs - 1

    def add_audio_track(self, path: Path, source_start: float, seconds: float, steps: list[str], duck: bool = False) -> None:
        self.audio_args += ['-ss', f'{source_start:.6f}', '-t', f'{seconds:.6f}', '-i', str(path)]
        label = f'a{self.audio_inputs}'
        self.audio_graph.append(f"[{self.audio_inputs}:a]{','.join(steps)}[{label}]")
        (self.ducked if duck else self.audio).append(label)
        self.audio_inputs += 1

    def frames(self, seconds: float) -> int:
        return max(1, round(seconds * self.fmt.fps))

    def transparent_gap(self, label: str, frames: int) -> None:
        self.graph.append(f'color=c=black@0:s={self.fmt.width}x{self.fmt.height}:r={self.fmt.fps}:d={frames / self.fmt.fps:.6f},format=gbrap,settb=AVTB,trim=end_frame={frames},setsar=1[{label}]')

    def clip_input(self, clip: Clip, facts: MediaFacts, source_start: float, seconds: float) -> int:
        if facts.media_type == 'image':
            return self.add_input('-loop', '1', '-framerate', str(self.fmt.fps), '-t', f'{seconds:.6f}', '-i', str(facts.path))
        return self.add_input('-ss', f'{source_start:.6f}', '-t', f'{seconds:.6f}', '-i', str(facts.path))

    def add_clip_audio(self, clip: Clip, facts: MediaFacts, layer_muted: bool) -> None:
        if clip.muted or layer_muted or not facts.has_audio or clip.volume == 0:
            return
        self.add_audio_track(facts.path, clip.in_, clip.out - clip.in_, sound_steps(clip))

    def transition_frames(self, clips: list[Clip]) -> list[int]:
        """For each clip, the frames either side of its opening cut. Matches transitionHalf in model.ts."""
        fps = self.fmt.fps
        halves = [0] * len(clips)
        for number, (before, clip) in enumerate(zip(clips, clips[1:]), start=1):
            if clip.transition_in and round(before.start * fps) + self.frames(before.length) == round(clip.start * fps):
                halves[number] = min(round(clip.transition_in.duration * fps / 2), self.frames(before.length) // 2, self.frames(clip.length) // 2)
        return halves

    def pose(self, label: str, transform: Transform, enter: Animation | None, exit_: Animation | None, length: float, frames: int, canvas_scale: float, lead: float, name: str) -> str:
        """Place one item on a transparent full frame. `lead` is how many seconds of the stream come before the item's own start."""
        if transform.is_default and not enter and not exit_ and canvas_scale == 1:
            return label
        W, H = self.fmt.width, self.fmt.height
        first, last = shared_fit(enter, exit_, length)
        clock = f'(t-{lead:.6f})' if lead else 't'
        filters: list[str] = []
        if 'opacity' in transform.keyframes:
            filters.append(self.opacity_commands(transform, frames, lead, name))
        elif transform.opacity != 1:
            filters.append(f'colorchannelmixer=aa={transform.opacity}')
        moves = []
        if enter:
            moves.append((enter.preset, f'min(1,max(0,{clock}/{first:.6f}))'))
            if span := OPACITY_SPAN.get(enter.preset):
                filters.append(f'fade=t=in:st={lead:.6f}:d={first * span:.6f}:alpha=1')
        if exit_:
            moves.append((exit_.preset, f'min(1,max(0,({length:.6f}-{clock})/{last:.6f}))'))
            if span := OPACITY_SPAN.get(exit_.preset):
                filters.append(f'fade=t=out:st={lead + length - last * span:.6f}:d={last * span:.6f}:alpha=1')
        if blur := self.blur_commands(enter, exit_, first, last, length, frames, lead, name):
            filters.append(blur)
        x, y, scale = property_expression(transform, 'x', clock), property_expression(transform, 'y', clock), property_expression(transform, 'scale', clock)
        sized, back, posed = f'{name}_sized', f'{name}_back', f'{name}_posed'
        spread = 1.0
        if transform.rotation or 'rotation' in transform.keyframes:
            # Turned first, while the size is fixed. The square output holds every angle, and the scale below allows for it.
            canvas_w, canvas_h = round(W * canvas_scale), round(H * canvas_scale)
            side = math.ceil(math.hypot(canvas_w, canvas_h) / 2) * 2
            spread = side / canvas_w
            filters.append(f"rotate=a='({property_expression(transform, 'rotation', clock)})*PI/180':c=black@0:ow={side}:oh={side}:bilinear=1")
        wide, tall = (W * spread, W * spread) if spread != 1 else (W, H)
        self.graph.append(f"[{label}]{''.join(step + ',' for step in filters)}scale=w='max(2,{wide}*({scale}))':h='max(2,{tall}*({scale}))':eval=frame:flags=bicubic[{sized}]")
        self.transparent_gap(back, frames)
        self.graph.append(f"[{back}][{sized}]overlay=x='{W}*({x})-overlay_w/2':y='{H}*({y})-overlay_h/2':eval=frame:format=gbrp[{posed}]")
        # The item is now cropped to the frame. Moves carry that whole frame, so a zoomed-in clip still slides in from outside.
        shift_x = [extra for preset, p in moves if (extra := offset_expression(preset, 'dx', p))]
        shift_y = [extra for preset, p in moves if (extra := offset_expression(preset, 'dy', p))]
        zoom = [extra for preset, p in moves if (extra := scale_expression(preset, p))]
        if not (shift_x or shift_y or zoom):
            return posed
        size = '*'.join(zoom) or '1'
        moved_sized, moved_back, moved = f'{name}_msized', f'{name}_mback', f'{name}_moved'
        self.graph.append(f"[{posed}]scale=w='max(2,{W}*({size}))':h='max(2,{H}*({size}))':eval=frame:flags=bicubic[{moved_sized}]")
        self.transparent_gap(moved_back, frames)
        self.graph.append(f"[{moved_back}][{moved_sized}]overlay=x='{W}*(0.5+{'+'.join(shift_x) or '0'})-overlay_w/2':y='{H}*(0.5+{'+'.join(shift_y) or '0'})-overlay_h/2':eval=frame:format=gbrp[{moved}]")
        return moved

    def opacity_commands(self, transform: Transform, frames: int, lead: float, name: str) -> str:
        """Eased opacity has no linear filter, so each frame gets its exact value."""
        fps = self.fmt.fps
        lines = [f'{frame / fps:.6f} colorchannelmixer@{name}o aa {value_at(transform, "opacity", max(0, frame / fps - lead)):.5f};' for frame in range(frames)]
        (self.folder / f'{name}-o.cmd').write_text('\n'.join(lines), encoding='utf-8')
        return f"sendcmd=f={name}-o.cmd,colorchannelmixer@{name}o=aa={value_at(transform, 'opacity', 0):.5f}"

    def blur_commands(self, enter: Animation | None, exit_: Animation | None, first: float, last: float, length: float, frames: int, lead: float, name: str) -> str | None:
        if not any(item and item.preset == 'blur' for item in (enter, exit_)):
            return None
        fps = self.fmt.fps
        lines = []
        for frame in range(frames):
            local = frame / fps - lead
            amount = 0.0
            if enter and enter.preset == 'blur':
                amount = max(amount, look_at('blur', local / first)['blur'])
            if exit_ and exit_.preset == 'blur':
                amount = max(amount, look_at('blur', (length - local) / last)['blur'])
            lines.append(f'{frame / fps:.6f} gblur@{name} sigma {amount * self.fmt.height:.3f};')
        (self.folder / f'{name}.cmd').write_text('\n'.join(lines), encoding='utf-8')
        return f'sendcmd=f={name}.cmd,gblur@{name}=sigma=0'

    def add_video_layer(self, layer: VideoLayer, position: int, base: str) -> str:
        clips = sorted(layer.items, key=lambda clip: clip.start)
        fps = self.fmt.fps
        halves = self.transition_frames(clips)
        segments: list[str] = []
        cursor = 0  # In frames, so rounding can't accumulate down a long timeline.
        joined_label, joined_frames = None, 0
        for number, clip in enumerate(clips):
            facts = self.media(clip.media_id)
            head, tail = halves[number], halves[number + 1] if number + 1 < len(clips) else 0
            if not head:
                if joined_label:
                    segments.append(f'[{joined_label}]')
                    joined_label = None
                start = round(clip.start * fps)
                if start > cursor:
                    label = f'gap{position}_{number}'
                    self.transparent_gap(label, start - cursor)
                    segments.append(f'[{label}]')
                    cursor = start
            base_frames = self.frames(clip.length)
            frames = base_frames + head + tail
            # The extra frames come from the source when it has them. Otherwise the first or last frame is held.
            wanted = clip.in_ - head * clip.speed / fps
            held = max(0, math.ceil(-wanted * fps / clip.speed)) if facts.media_type != 'image' else 0
            index = self.clip_input(clip, facts, max(0, wanted), (frames - held) * clip.speed / fps)
            enter, exit_ = None if head else clip.enter, None if tail else clip.exit
            scale = supersample(clip.transform, enter, exit_, facts, self.fmt)
            canvas = (round(self.fmt.width * scale / 2) * 2, round(self.fmt.height * scale / 2) * 2)
            label = f'c{position}_{number}'
            self.graph.append(f'[{index}:v]{clip_chain(clip, facts, canvas, fps, frames, held)}[{label}]')
            shown = self.pose(label, clip.transform, enter, exit_, clip.length, frames, scale, head / fps, label)
            if head:
                merged = f'x{position}_{number}'
                self.graph.append(f'[{joined_label}][{shown}]xfade=transition={XFADE_NAMES[clip.transition_in.kind]}:duration={2 * head / fps:.6f}:offset={(joined_frames - 2 * head) / fps:.6f}[{merged}]')
                joined_label, joined_frames = merged, joined_frames + frames - 2 * head
            elif tail:
                joined_label, joined_frames = shown, frames
            else:
                segments.append(f'[{shown}]')
            cursor += base_frames
            self.add_clip_audio(clip, facts, layer.muted)
        if joined_label:
            segments.append(f'[{joined_label}]')
        if cursor < self.total_frames:
            label = f'gap{position}_end'
            self.transparent_gap(label, self.total_frames - cursor)
            segments.append(f'[{label}]')
        joined = f'layer{position}'
        self.graph.append(f"{''.join(segments)}concat=n={len(segments)}:v=1:a=0[{joined}]")
        if layer.blend != 'normal':
            return self.blended(base, joined, position, layer.blend)
        return self.overlay(base, joined, position, '0', '0')

    def blended(self, base: str, top: str, position: int, mode: str) -> str:
        """Blend the color, then let the layer's own alpha decide how much of that shows. Matches the preview shader."""
        n = f'b{position}'
        self.graph += [f'[{top}]split=2[{n}_color][{n}_shape]', f'[{n}_shape]alphaextract[{n}_mask]', f'[{n}_color]format=gbrp[{n}_rgb]',
                       f'[{base}]format=gbrp,split=2[{n}_under][{n}_base]', f'[{n}_under][{n}_rgb]blend=all_mode={mode},format=gbrp[{n}_mixed]',
                       f'[{n}_mixed]format=gbrap[{n}_open]', f'[{n}_open][{n}_mask]alphamerge[{n}_shaped]']
        return self.overlay(f'{n}_base', f'{n}_shaped', position, '0', '0')

    def overlay(self, base: str, top: str, position: int, x: str, y: str) -> str:
        output = f'v{position}'
        self.graph.append(f"[{base}][{top}]overlay=x='{x}':y='{y}':eval=frame:format=gbrp:eof_action=pass[{output}]")
        return output

    def add_text_layer(self, layer, position: int, base: str) -> str:
        fps = self.fmt.fps
        for number, item in enumerate(sorted(layer.items, key=lambda text: text.start)):
            image = self.folder / f'text-{position}-{number}.png'
            render_text_image(item, self.fmt, image)
            frames = self.frames(item.length)
            index = self.add_input('-loop', '1', '-framerate', str(fps), '-t', f'{(frames + 1) / fps:.6f}', '-i', str(image))
            label, output = f'text{position}_{number}', f't{position}_{number}'
            self.graph.append(f'[{index}:v]format=gbrap,trim=end_frame={frames},setpts=PTS-STARTPTS,settb=AVTB[{label}]')
            shown = self.pose(label, Transform(), item.enter, item.exit, item.length, frames, 1, 0, label)
            late = f'{label}_late'
            self.graph.append(f'[{shown}]tpad=start={round(item.start * fps)}:color=black@0[{late}]')
            self.graph.append(f'[{base}][{late}]overlay=format=gbrp:eof_action=pass[{output}]')
            base = output
        return base

    def add_audio_layer(self, layer) -> None:
        if layer.muted:
            return
        for sound in layer.items:
            if sound.muted or sound.volume == 0:
                continue
            if sound.media_id is not None:
                facts = self.media(sound.media_id)
                if not facts.has_audio:
                    continue
                path = facts.path
            else:
                path = self.audio_asset(sound.asset_id)
            self.add_audio_track(path, sound.in_, sound.out - sound.in_, sound_steps(sound), sound.duck)

    def bus(self, labels: list[str], total: float) -> str:
        # normalize=0 keeps each track's level.
        return f"{''.join(f'[{label}]' for label in labels)}amix=inputs={len(labels)}:duration=longest:normalize=0,apad,atrim=end={total}"

    def mix_tracks(self, total: float) -> None:
        if self.audio and self.ducked:
            self.audio_graph += [f'{self.bus(self.audio, total)},asplit=2[key][main]', f'{self.bus(self.ducked, total)}[under]',
                                 f'[under][key]{DUCK_FILTER}[dipped]', '[main][dipped]amix=inputs=2:duration=longest:normalize=0[mix]']
        elif self.audio or self.ducked:
            self.audio_graph.append(f'{self.bus(self.audio or self.ducked, total)}[mix]')

    def build(self) -> Compiled:
        fmt = self.fmt
        self.graph.append(f'color=c=black:s={fmt.width}x{fmt.height}:r={fmt.fps}:d={self.total_frames / fmt.fps},format=gbrp,trim=end_frame={self.total_frames}[canvas]')
        current = 'canvas'
        for position, layer in enumerate(self.timeline.layers):
            if layer.hidden or not layer.items:
                continue
            if layer.kind == 'video':
                current = self.add_video_layer(layer, position, current)
            elif layer.kind == 'text':
                current = self.add_text_layer(layer, position, current)
            else:
                self.add_audio_layer(layer)
        self.graph.append(f'[{current}]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[final]')
        total = self.total_frames / fmt.fps
        self.mix_tracks(total)
        return Compiled(self.args, ';'.join(self.graph), total, self.audio_args, ';'.join(self.audio_graph), self.timeline.normalize_audio)


def compile_timeline(timeline: Timeline, media: Callable[[int], MediaFacts], audio_asset: Callable[[str], Path], folder: Path) -> Compiled:
    if timeline.duration <= 0:
        raise ValueError('Add a clip to the timeline first.')
    return Builder(timeline, media, audio_asset, folder).build()


def video_inputs(compiled: Compiled) -> int:
    return compiled.args.count('-i')


def mix_audio(ffmpeg: str, compiled: Compiled, folder: Path, should_cancel: Callable[[], bool]) -> Path:
    (folder / 'audio-graph.txt').write_text(compiled.audio_graph, encoding='utf-8')
    target = folder / 'mix.wav'
    result = run_cancellable([ffmpeg, '-nostdin', '-v', 'error', '-y', *compiled.audio_args, '-filter_complex_script', str(folder / 'audio-graph.txt'),
                              '-map', '[mix]', '-c:a', 'pcm_f32le', str(target)], should_cancel)
    if result.returncode:
        logger.error('Audio mix failed: %s', result.stderr[-1000:])
        raise RuntimeError('Export failed. The audio could not be mixed.')
    return target


def normalize_loudness(ffmpeg: str, compiled: Compiled, source: Path, folder: Path, should_cancel: Callable[[], bool]) -> Path:
    """Two passes: measure, then apply one steady gain, so quiet and loud moments keep their balance."""
    measure = run_cancellable([ffmpeg, '-nostdin', '-hide_banner', '-y', '-i', str(source), '-af', f'{LOUDNORM}:print_format=json', '-f', 'null', '-'], should_cancel)
    found = re.search(r'\{[^{}]*"input_i"[^{}]*\}', measure.stderr or '')
    if measure.returncode or not found:
        logger.warning('Could not measure loudness: %s', (measure.stderr or '')[-500:])
        return source
    stats = json.loads(found.group())
    if not math.isfinite(float(stats['input_i'])):  # Silence has no loudness to correct.
        return source
    target = folder / 'normalized.wav'
    measured = f"measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}"
    result = run_cancellable([ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', str(source), '-af', f'{LOUDNORM}:{measured}:linear=true,aresample=48000,apad,atrim=end={compiled.duration}',
                              '-c:a', 'pcm_f32le', str(target)], should_cancel)
    if result.returncode:
        logger.warning('Loudness correction failed: %s', result.stderr[-500:])
        return source
    return target


def render_timeline(timeline: Timeline, media: Callable[[int], MediaFacts], audio_asset: Callable[[str], Path], target: Path,
                    on_progress: Callable[[int], None], should_cancel: Callable[[], bool] = lambda: False, draft: bool = False) -> None:
    """Encode into a private folder, then publish a complete file. A draft is for watching in the editor, so speed comes first."""
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise ValueError('Exporting requires ffmpeg on the server.')
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.video-export-', dir=target.parent) as folder:
        folder = Path(folder)
        compiled = compile_timeline(timeline, media, audio_asset, folder)
        (folder / 'graph.txt').write_text(compiled.graph, encoding='utf-8')
        output = folder / 'output.mp4'
        # Audio is mixed in its own pass: sharing a graph with video let ffmpeg lose the end of a clip's sound.
        audio_input, audio = [], ['-an']
        if compiled.has_audio:
            mix = mix_audio(ffmpeg, compiled, folder, should_cancel)
            if compiled.normalize_audio and not draft:
                mix = normalize_loudness(ffmpeg, compiled, mix, folder, should_cancel)
            audio_input = ['-i', str(mix)]
            audio = ['-map', f'{video_inputs(compiled)}:a', '-c:a', 'aac', '-b:a', '192k']
        # The graph goes in a file: a long timeline's graph can exceed the command-line limit.
        args = [ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', *compiled.args, *audio_input, '-filter_complex_script', str(folder / 'graph.txt'),
                '-map', '[final]', *audio, '-t', f'{compiled.duration:.6f}', '-c:v', 'libx264', *(['-preset', 'veryfast', '-crf', '26', '-g', '15'] if draft else ['-preset', 'fast', '-crf', '20']), '-pix_fmt', 'yuv420p', *BT709_OUTPUT_ARGS,
                '-map_metadata', '-1', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', '-n', str(output)]
        with tempfile.TemporaryFile(mode='w+') as errors:
            process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=errors, text=True, cwd=folder)
            last_output = [time.monotonic()]
            stalled = [False]

            def should_stop() -> bool:
                stalled[0] = time.monotonic() - last_output[0] > STALLED_AFTER_SECONDS
                return stalled[0] or should_cancel()

            stop_process_when(process, should_stop)
            try:
                assert process.stdout is not None
                for line in process.stdout:
                    last_output[0] = time.monotonic()
                    key, _, value = line.strip().partition('=')
                    if key == 'out_time_us' and value.lstrip('-').isdigit():
                        on_progress(min(99, max(0, int(int(value) / (compiled.duration * 1_000_000) * 100))))
                code = process.wait()
                if should_cancel():
                    raise JobCancelled()
                if stalled[0]:
                    raise RuntimeError('Export failed. The encoder stopped responding.')
                if code != 0 or not output.exists() or output.stat().st_size == 0:
                    errors.seek(0)
                    logger.error('Timeline export failed: %s', errors.read()[-1500:].strip())
                    raise RuntimeError('Export failed. The encoder could not process this timeline; see the server log for details.')
                if target.exists():
                    raise RuntimeError('The export destination already exists. Please export again.')
                target.hardlink_to(output)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                if process.stdout is not None:
                    process.stdout.close()


def upgrade_edit_recipe(recipe: dict[str, Any] | None, media_id: int, duration: float, width: int | None, height: int | None) -> dict[str, Any]:
    """Version 1 stored one trimmed clip and global settings. Older recipes stay untouched on disk."""
    if recipe and recipe.get('version') == 2:
        return recipe
    clip = (recipe or {}).get('clips', [{}])[0] if (recipe or {}).get('clips') else {}
    settings = (recipe or {}).get('settings', {})
    item: dict[str, Any] = {
        'id': 'clip-1', 'media_id': clip.get('photo_id', media_id), 'start': 0, 'in': clip.get('in', 0), 'out': clip.get('out') or duration,
        'volume': settings.get('volume', 1), 'muted': settings.get('mute', False),
        'adjust': {key: settings[key] for key in ('rotation', 'flip_horizontal', 'flip_vertical', 'brightness', 'contrast', 'saturation') if key in settings},
    }
    w, h = width or 1920, height or 1080
    if settings.get('rotation') in (90, 270):
        w, h = h, w
    longest = max(w, h)
    if longest > 3840:
        w, h = round(w * 3840 / longest), round(h * 3840 / longest)
    return {'version': 2, 'format': {'width': w - w % 2, 'height': h - h % 2, 'fps': 30},
            'layers': [{'id': 'main', 'kind': 'video', 'name': 'Main', 'magnetic': True, 'items': [item]}]}
