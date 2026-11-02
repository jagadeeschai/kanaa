"""Compiles a timeline into one ffmpeg graph, and upgrades older project recipes."""
from __future__ import annotations

import logging
import math
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from app.api.schemas import VideoEditRequest
from app.services.job_service import JobCancelled, stop_process_when
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Adjust, Clip, Format, Sound, Text, Timeline, Transform, VideoLayer
from app.services.video_edit_service import (
    BT709_OUTPUT_ARGS, HDR_TO_BT709, LYRIC_FONTS_DIR, STALLED_AFTER_SECONDS, TAG_BT709, TO_BT709, run_cancellable, write_lyrics,
)

logger = logging.getLogger(__name__)
AUDIO_FORMAT = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'
MAX_ATEMPO_STEP = 2.0
MIN_ATEMPO_STEP = 0.5


@dataclass
class Compiled:
    args: list[str]
    graph: str
    duration: float
    audio_args: list[str]
    audio_graph: str

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


def layer_expression(clips: list[Clip], prop: str, fallback: float) -> str:
    """Pick the active clip's curve at the current time. Gaps use the fallback."""
    tail = f'{fallback}'
    for clip in reversed(clips):
        end = clip.start + clip.length
        tail = f'if(between(t,{clip.start},{end}),{property_expression(clip.transform, prop, f"(t-{clip.start})")},{tail})'
    return tail


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
    if adjust.brightness != 1:
        b = adjust.brightness
        filters += [f'format=gbrp,colorchannelmixer=rr={b}:gg={b}:bb={b}']
    if adjust.contrast != 1 or adjust.saturation != 1:
        filters.append(f'eq=contrast={adjust.contrast}:saturation={adjust.saturation}')
    return filters


def color_filter(facts: MediaFacts) -> str:
    if facts.media_type == 'image' or facts.color_space in ('bt470bg', 'smpte170m'):
        return TO_BT709
    return HDR_TO_BT709 if facts.is_hdr else TAG_BT709


def clip_chain(clip: Clip, facts: MediaFacts, fmt: Format, frames: int) -> str:
    """Bring any source to the project's size, rate and color, and exactly `frames` long."""
    W, H = fmt.width, fmt.height
    steps = [color_filter(facts), 'scale=trunc(iw*sar/2)*2:ih', 'setsar=1', *adjust_filters(clip.adjust)]
    if clip.speed != 1:
        steps.append(f'setpts=PTS/{clip.speed}')
    steps += [f'fps={fmt.fps}', f'scale={W}:{H}:force_original_aspect_ratio=decrease:flags=bicubic', 'format=gbrap',
              f'pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black@0', 'setsar=1',
              # Short or variable sources are held on their last frame, so later layers never slip.
              'tpad=stop=-1:stop_mode=clone', f'trim=end_frame={frames}', 'setpts=PTS-STARTPTS']
    return ','.join(steps)


def atempo_chain(speed: float) -> list[str]:
    steps = []
    while speed > MAX_ATEMPO_STEP:
        steps.append(f'atempo={MAX_ATEMPO_STEP}')
        speed /= MAX_ATEMPO_STEP
    while speed < MIN_ATEMPO_STEP:
        steps.append(f'atempo={MIN_ATEMPO_STEP}')
        speed /= MIN_ATEMPO_STEP
    return [*steps, f'atempo={speed}'] if speed != 1 else steps


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

    def add_audio_track(self, path: Path, source_start: float, seconds: float, steps: list[str]) -> None:
        self.audio_args += ['-ss', f'{source_start:.6f}', '-t', f'{seconds:.6f}', '-i', str(path)]
        label = f'a{self.audio_inputs}'
        self.audio_graph.append(f"[{self.audio_inputs}:a]{','.join(steps)}[{label}]")
        self.audio.append(label)
        self.audio_inputs += 1

    def frames(self, seconds: float) -> int:
        return max(1, round(seconds * self.fmt.fps))

    def transparent_gap(self, label: str, frames: int) -> None:
        self.graph.append(f'color=c=black@0:s={self.fmt.width}x{self.fmt.height}:r={self.fmt.fps}:d={frames / self.fmt.fps},format=gbrap,trim=end_frame={frames},setsar=1[{label}]')

    def clip_input(self, clip: Clip, facts: MediaFacts) -> int:
        if facts.media_type == 'image':
            return self.add_input('-loop', '1', '-framerate', str(self.fmt.fps), '-t', f'{(clip.out - clip.in_):.6f}', '-i', str(facts.path))
        return self.add_input('-ss', f'{clip.in_:.6f}', '-t', f'{(clip.out - clip.in_):.6f}', '-i', str(facts.path))

    def add_clip_audio(self, clip: Clip, facts: MediaFacts, layer_muted: bool) -> None:
        if clip.muted or layer_muted or not facts.has_audio or clip.volume == 0:
            return
        steps = [AUDIO_FORMAT, *atempo_chain(clip.speed), f'volume={clip.volume}', f'adelay={round(clip.start * 1000)}:all=1']
        self.add_audio_track(facts.path, clip.in_, clip.out - clip.in_, steps)

    def add_video_layer(self, layer: VideoLayer, position: int, base: str) -> str:
        clips = sorted(layer.items, key=lambda clip: clip.start)
        fps = self.fmt.fps
        segments: list[str] = []
        cursor = 0  # In frames, so rounding can't accumulate down a long timeline.
        for number, clip in enumerate(clips):
            facts = self.media(clip.media_id)
            start = round(clip.start * fps)
            if start > cursor:
                label = f'gap{position}_{number}'
                self.transparent_gap(label, start - cursor)
                segments.append(f'[{label}]')
            frames = self.frames(clip.length)
            index = self.clip_input(clip, facts)
            label = f'c{position}_{number}'
            self.graph.append(f'[{index}:v]{clip_chain(clip, facts, self.fmt, frames)}[{label}]')
            segments.append(f'[{label}]')
            cursor = start + frames
            self.add_clip_audio(clip, facts, layer.muted)
        if cursor < self.total_frames:
            label = f'gap{position}_end'
            self.transparent_gap(label, self.total_frames - cursor)
            segments.append(f'[{label}]')
        joined = f'layer{position}'
        self.graph.append(f"{''.join(segments)}concat=n={len(segments)}:v=1:a=0[{joined}]")
        if all(clip.transform.is_default for clip in clips):
            return self.overlay(base, joined, position, '0', '0')
        W, H = self.fmt.width, self.fmt.height
        scale = layer_expression(clips, 'scale', 1)
        opacity = clips[0].transform.opacity
        posed = f'posed{position}'
        fade = f'colorchannelmixer=aa={opacity},' if opacity != 1 else ''
        self.graph.append(f"[{joined}]{fade}scale=w='{W}*({scale})':h='{H}*({scale})':eval=frame:flags=bilinear[{posed}]")
        x = f"{W}*({layer_expression(clips, 'x', 0.5)})-overlay_w/2"
        y = f"{H}*({layer_expression(clips, 'y', 0.5)})-overlay_h/2"
        return self.overlay(base, posed, position, x, y)

    def overlay(self, base: str, top: str, position: int, x: str, y: str) -> str:
        output = f'v{position}'
        self.graph.append(f"[{base}][{top}]overlay=x='{x}':y='{y}':eval=frame:format=gbrp:eof_action=pass[{output}]")
        return output

    def add_text_layer(self, layer, position: int, base: str) -> str:
        for number, item in enumerate(sorted(layer.items, key=lambda text: text.start)):
            image = self.folder / f'text-{position}-{number}.png'
            render_text_image(item, self.fmt, image)
            index = self.add_input('-loop', '1', '-framerate', str(self.fmt.fps), '-t', f'{self.duration:.6f}', '-i', str(image))
            output = f't{position}_{number}'
            self.graph.append(f"[{base}][{index}:v]overlay=format=gbrp:eof_action=pass:enable='between(t,{item.start},{item.start + item.length})'[{output}]")
            base = output
        return base

    def add_audio_layer(self, layer) -> None:
        if layer.muted:
            return
        for sound in layer.items:
            if sound.media_id is not None:
                facts = self.media(sound.media_id)
                if not facts.has_audio:
                    continue
                path = facts.path
            else:
                path = self.audio_asset(sound.asset_id)
            steps = [AUDIO_FORMAT, f'volume={sound.volume}']
            if sound.fade_in:
                steps.append(f'afade=t=in:st=0:d={sound.fade_in}')
            if sound.fade_out:
                steps.append(f'afade=t=out:st={max(0, sound.length - sound.fade_out)}:d={sound.fade_out}')
            steps.append(f'adelay={round(sound.start * 1000)}:all=1')
            self.add_audio_track(path, sound.in_, sound.length, steps)

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
        if self.audio:
            mixed = ''.join(f'[{label}]' for label in self.audio)
            # normalize=0 keeps each track's level.
            self.audio_graph.append(f'{mixed}amix=inputs={len(self.audio)}:duration=longest:normalize=0,apad,atrim=end={total}[mix]')
        return Compiled(self.args, ';'.join(self.graph), total, self.audio_args, ';'.join(self.audio_graph))


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


def render_timeline(timeline: Timeline, media: Callable[[int], MediaFacts], audio_asset: Callable[[str], Path], target: Path,
                    on_progress: Callable[[int], None], should_cancel: Callable[[], bool] = lambda: False) -> None:
    """Encode into a private folder, then publish a complete file."""
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
            audio_input = ['-i', str(mix)]
            audio = ['-map', f'{video_inputs(compiled)}:a', '-c:a', 'aac', '-b:a', '192k']
        # The graph goes in a file: a long timeline's graph can exceed the command-line limit.
        args = [ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', *compiled.args, *audio_input, '-filter_complex_script', str(folder / 'graph.txt'),
                '-map', '[final]', *audio, '-t', f'{compiled.duration:.6f}', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', *BT709_OUTPUT_ARGS,
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
