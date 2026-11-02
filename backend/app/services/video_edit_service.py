from __future__ import annotations

import math
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Callable
import logging

from app.api.schemas import VideoEditRequest
from app.core.config import settings
from app.services.job_service import JobCancelled, stop_process_when
from app.services.video_service import _run_ffprobe


logger = logging.getLogger(__name__)

CANVASES = {"portrait": (720, 1280), "square": (720, 720), "landscape": (1280, 720)}
QUALITY_SCALE = {"720p": 1, "1080p": 1.5, "4k": 3}
# Motion is computed on a larger canvas to avoid subpixel stepping; 1.5x is enough at 4K, where 2x would mean 8K frames.
MOTION_OVERSCAN = {"720p": 2, "1080p": 2, "4k": 1.5}
SLIDE_FPS = 30
CROSSFADE_SECONDS = 0.8
# Ken Burns cycles through these so neighbouring images never move the same way.
KEN_BURNS_MOTIONS = ('zoom-in', 'pan-left', 'zoom-out', 'pan-right')
MIN_SLIDE_SECONDS = 0.2
LYRIC_FONTS_DIR = Path(__file__).resolve().parents[1] / 'assets' / 'fonts'
# libass sizes text by the font's OS/2 win ascent + descent, CSS by the em square. Each scale is
# that sum over units-per-em, read from the font, so an exported line matches its preview.
DEFAULT_LYRIC_FONT = ('Noto Sans', 1.519)
SCRIPT_LYRIC_FONTS = (
    (0x0900, 0x097F, 'Noto Sans Devanagari', 1.906),
    (0x0980, 0x09FF, 'Noto Sans Bengali', 1.403),
    (0x0A00, 0x0A7F, 'Noto Sans Gurmukhi', 1.304),
    (0x0A80, 0x0AFF, 'Noto Sans Gujarati', 1.484),
    (0x0B80, 0x0BFF, 'Noto Sans Tamil', 1.24),
    (0x0C00, 0x0C7F, 'Noto Sans Telugu', 1.478),
    (0x0C80, 0x0CFF, 'Noto Sans Kannada', 1.645),
    (0x0D00, 0x0D7F, 'Noto Sans Malayalam', 1.247),
)
HDR_TRANSFERS = {'arib-std-b67', 'smpte2084'}
SD_COLOR_SPACES = {'bt470bg', 'smpte170m'}
TO_BT709 = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p'
# Tone mapping needs linear light; the result is ordinary 8-bit SDR.
HDR_TO_BT709 = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p'
TAG_BT709 = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709'
BT709_OUTPUT_ARGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']
# Everything else, GPS in particular, stays out of exports unless asked for.
KEPT_METADATA_TAGS = ('creation_time', 'date', 'title')
# An encoder silent for this long has hung, not slowed down.
STALLED_AFTER_SECONDS = 300
# About what a busy 1080p export takes at this CRF, plus working room.
ESTIMATED_BYTES_PER_SECOND = 2_500_000
# Slideshows also keep every image and a joined copy on disk until the final encode.
ESTIMATED_SIZE_FACTOR = {"720p": 1, "1080p": 1, "4k": 5}
DISK_RESERVE_BYTES = 500_000_000


def resolve_audio_asset(asset_id: str) -> Path:
    import re
    if not re.fullmatch(r"[a-f0-9]{32}", asset_id):
        raise ValueError("Invalid song upload")
    path = settings.data_dir / "video_audio" / asset_id
    if not path.is_file():
        raise ValueError("The uploaded song is no longer available. Upload it again.")
    return path


def canvas_size(edit: VideoEditRequest) -> tuple[int, int] | None:
    if edit.canvas not in CANVASES:
        return None
    width, height = CANVASES[edit.canvas]
    scale = QUALITY_SCALE[edit.quality]
    return round(width * scale), round(height * scale)


def media_duration(data: dict) -> float:
    try:
        value = float(data.get('format', {}).get('duration') or next((stream.get('duration') for stream in data.get('streams', []) if stream.get('duration')), 0))
    except (ValueError, TypeError):
        return 0
    return value if math.isfinite(value) else 0


def ass_timestamp(seconds: float) -> str:
    centiseconds = round(seconds * 100)
    hours, rest = divmod(centiseconds, 360000)
    minutes, rest = divmod(rest, 6000)
    whole, fraction = divmod(rest, 100)
    return f"{hours}:{minutes:02}:{whole:02}.{fraction:02}"


def lyric_font_for(text: str) -> tuple[str, float]:
    """Pick the bundled font for the script most of the line is written in."""
    counts: dict[tuple[str, float], int] = {}
    for char in text:
        code = ord(char)
        for first, last, family, scale in SCRIPT_LYRIC_FONTS:
            if first <= code <= last:
                counts[(family, scale)] = counts.get((family, scale), 0) + 1
                break
    return max(counts, key=lambda font: counts[font]) if counts else DEFAULT_LYRIC_FONT


def color_conversion(source: Path, *, is_image: bool) -> str:
    """Filter that brings a source to SDR BT.709, so every export carries honest color tags."""
    if is_image:
        return TO_BT709
    info = _run_ffprobe(source) or {}
    stream = next((s for s in info.get('streams', []) if s.get('codec_type') == 'video'), {})
    if stream.get('color_transfer') in HDR_TRANSFERS:
        return HDR_TO_BT709
    return TO_BT709 if stream.get('color_space') in SD_COLOR_SPACES else TAG_BT709


def metadata_args(source: Path, *, keep_location: bool) -> list[str]:
    if keep_location:
        return ['-map_metadata', '0']
    tags = (_run_ffprobe(source) or {}).get('format', {}).get('tags', {})
    kept = [arg for key in KEPT_METADATA_TAGS if key in tags for arg in ('-metadata', f'{key}={tags[key]}')]
    return ['-map_metadata', '-1', *kept]


def check_disk_space(folder: Path, duration: float, quality: str = '720p') -> None:
    folder.mkdir(parents=True, exist_ok=True)
    needed = duration * ESTIMATED_BYTES_PER_SECOND * ESTIMATED_SIZE_FACTOR[quality] + DISK_RESERVE_BYTES
    free = shutil.disk_usage(folder).free
    if free < needed:
        raise ValueError(f'Not enough disk space: this export needs about {needed / 1e9:.1f} GB and {free / 1e9:.1f} GB is free.')


def write_lyrics(path: Path, edit: VideoEditRequest, source: Path) -> None:
    canvas = canvas_size(edit)
    if canvas:
        width, height = canvas
    else:
        info = _run_ffprobe(source) or {}
        stream = next((s for s in info.get('streams', []) if s.get('codec_type') == 'video'), {})
        width, height = int(stream.get('width', 1280)), int(stream.get('height', 720))
        recorded_rotation = next((s.get('rotation', 0) for s in stream.get('side_data_list', []) if 'rotation' in s), 0)
        if (int(recorded_rotation) + edit.rotation) % 180:
            width, height = height, width
    color = edit.lyric_color.lstrip('#')
    ass_color = f"&H00{color[4:6]}{color[2:4]}{color[0:2]}"
    alignment = {"top": 8, "center": 5, "bottom": 2}[edit.lyric_position]
    font_size = edit.lyric_size * width / 720
    margin = round(height * 0.08)
    side_margin = round(width * 0.055)
    # Borders are drawn at PlayRes scale, so they grow with the canvas like the text does.
    unit = width / 720
    border_style, outline, shadow, outline_color, back_color = {
        'outline': (1, 2 * unit, 1 * unit, '&H00101010', '&H80000000'),
        # libass blurs the outermost layer, so a dark outline takes the blur and letters stay sharp.
        'shadow': (1, 3 * unit, 2 * unit, '&H00000000', '&H40000000'),
        'band': (3, 12 * unit, 0, '&H70000000', '&H70000000'),
    }[edit.lyric_style]
    blur = rf'\blur{3 * unit}' if edit.lyric_style == 'shadow' else ''
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Lyrics,{DEFAULT_LYRIC_FONT[0]},{font_size * DEFAULT_LYRIC_FONT[1]},{ass_color},{ass_color},{outline_color},{back_color},-1,0,0,0,100,100,0,0,{border_style},{outline},{shadow},{alignment},{side_margin},{side_margin},{margin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    for cue in edit.lyrics:
        # Treat pasted lyrics as text, never as ASS override commands.
        text = cue.text.replace('\\', '＼').replace('{', '｛').replace('}', '｝').replace('\r', '').replace('\n', r'\N')
        family, scale = lyric_font_for(cue.text)
        font = rf'{{\fn{family}\fs{font_size * scale}{blur}}}'
        effect = ''
        fade_ms = min(250, max(1, round((cue.end - cue.start) * 1000 / 3)))
        if edit.lyric_animation == 'fade':
            effect = rf'{{\fad({fade_ms},{fade_ms})}}'
        elif edit.lyric_animation == 'slide-up':
            y = margin if edit.lyric_position == 'top' else height / 2 if edit.lyric_position == 'center' else height - margin
            effect = rf'{{\move({width / 2},{y + height * .04},{width / 2},{y},0,{fade_ms})\fad({fade_ms},0)}}'
        lines.append(f"Dialogue: 0,{ass_timestamp(cue.start)},{ass_timestamp(cue.end)},Lyrics,,0,0,0,,{font}{effect}{text}")
    path.write_text(header + '\n'.join(lines) + '\n', encoding='utf-8')


def inspect_editable_video(source: Path, edit: VideoEditRequest, *, background_is_image: bool = False) -> float:
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        raise ValueError('Video editing requires ffmpeg and ffprobe on the server.')
    duration = 0.0
    if not background_is_image:
        data = _run_ffprobe(source)
        if not data or not any(s.get('codec_type') == 'video' for s in data.get('streams', [])):
            raise ValueError('The video could not be read. Check that the file is available and supported.')
        streams = [s for s in data['streams'] if s.get('codec_type') == 'video']
        try:
            duration = float(streams[0].get('duration') or data.get('format', {}).get('duration') or 0)
        except (TypeError, ValueError):
            duration = 0
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError('This video has no readable duration.')
    elif not edit.audio_asset_id:
        raise ValueError('Upload a song to use a photo as the background.')
    if edit.audio_asset_id:
        audio_info = _run_ffprobe(resolve_audio_asset(edit.audio_asset_id)) or {}
        if not any(stream.get('codec_type') == 'audio' for stream in audio_info.get('streams', [])):
            raise ValueError('The uploaded song could not be read.')
        duration = media_duration(audio_info)
        if duration <= 0 or duration > 3600:
            raise ValueError('Choose an audio track up to one hour long.')
    end = edit.trim_end if edit.trim_end is not None else duration
    if edit.trim_start >= duration or end > duration + 0.05 or min(end, duration) - edit.trim_start < 0.1 - 1e-6:
        raise ValueError('Choose a trim range inside the video, at least 0.1 seconds long.')
    output_duration = min(end, duration) - edit.trim_start
    if any(later - earlier < MIN_SLIDE_SECONDS for earlier, later in zip(edit.slide_starts, edit.slide_starts[1:])) or (edit.slide_starts and edit.slide_starts[-1] >= output_duration):
        raise ValueError('Image start times must be in order, at least 0.2 seconds apart, and inside the song.')
    previous_end = 0.0
    for cue in edit.lyrics:
        if cue.start < previous_end - 1e-6 or cue.end > output_duration + 0.01:
            raise ValueError('Lyric lines must be ordered, non-overlapping, and inside the output duration.')
        previous_end = cue.end
    return output_duration


def video_filters(edit: VideoEditRequest, color: str = TAG_BT709) -> str:
    filters = [color, 'scale=trunc(iw*sar/2)*2:trunc(ih/2)*2', 'setsar=1']
    if edit.rotation == 90:
        filters.append('transpose=clock')
    elif edit.rotation == 180:
        filters.extend(['hflip', 'vflip'])
    elif edit.rotation == 270:
        filters.append('transpose=cclock')
    if edit.flip_horizontal:
        filters.append('hflip')
    if edit.flip_vertical:
        filters.append('vflip')
    if edit.brightness != 1:
        # This filter works in RGB; return to BT.709 explicitly so the matrix isn't left to defaults.
        filters += [f'colorchannelmixer=rr={edit.brightness}:gg={edit.brightness}:bb={edit.brightness}', TO_BT709]
    if edit.contrast != 1 or edit.saturation != 1:
        filters.append(f'eq=contrast={edit.contrast}:saturation={edit.saturation}')
    canvas = canvas_size(edit)
    if canvas:
        width, height = canvas
        filters += [f'scale={width}:{height}:force_original_aspect_ratio=increase', f'crop={width}:{height}', 'setsar=1']
    if edit.lyrics:
        # Complex shaping is what joins Indic vowel signs to their consonants.
        filters.append('ass=filename=lyrics.ass:shaping=complex:fontsdir=fonts')
    return ','.join(filters)


def render_video_copy(source: Path, target: Path, edit: VideoEditRequest, duration: float, on_progress: Callable[[int], None], *, background_is_image: bool = False, background_settings: dict | None = None, backgrounds: list[tuple[Path, dict]] | None = None, should_cancel: Callable[[], bool] = lambda: False) -> None:
    """Encode into a private temporary directory, then publish a complete MP4 copy."""
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise ValueError('Video editing requires ffmpeg on the server.')
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.video-export-', dir=target.parent) as folder:
        output = Path(folder) / 'output.mp4'
        if edit.lyrics:
            write_lyrics(Path(folder) / 'lyrics.ass', edit, source)
            (Path(folder) / 'fonts').symlink_to(LYRIC_FONTS_DIR)
        args = [ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error']
        video_source = source
        slideshow = background_is_image and (bool(backgrounds) or edit.image_animation != 'none')
        if slideshow:
            prepare_slideshow(backgrounds or [(source, background_settings or {})], edit, duration, Path(folder), on_progress, should_cancel)
        if background_is_image and not slideshow:
            from app.services.image_service import render_edited_image_to
            video_source = Path(folder) / 'background.png'
            render_edited_image_to(source, source.suffix.lower(), background_settings or {}, video_source)
        audio_source = resolve_audio_asset(edit.audio_asset_id) if edit.audio_asset_id else None
        if audio_source:
            if slideshow:
                args += ['-f', 'concat', '-safe', '0', '-i', str(Path(folder) / 'slides.txt')]
            elif background_is_image:
                args += ['-loop', '1', '-framerate', '30', '-i', str(video_source.resolve())]
            else:
                source_duration = media_duration(_run_ffprobe(source) or {})
                args += ['-stream_loop', '-1', '-ss', str(edit.trim_start % source_duration if source_duration else 0), '-i', str(source.resolve())]
            args += ['-ss', str(edit.trim_start), '-i', str(audio_source.resolve())]
        else:
            args += ['-ss', str(edit.trim_start), '-i', str(source.resolve())]
        args += ['-t', str(duration), '-map', '0:v:0', '-map', '1:a:0' if audio_source else '0:a:0?', '-sn', '-dn', '-vf', video_filters(edit, TAG_BT709 if slideshow else color_conversion(video_source, is_image=background_is_image)),
                 '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', *BT709_OUTPUT_ARGS]
        if edit.mute:
            args += ['-an']
        else:
            args += ['-c:a', 'aac', '-b:a', '192k', '-af', f'volume={edit.volume}']
        args += [*metadata_args(source, keep_location=edit.keep_location), '-metadata:s:v:0', 'rotate=0', '-movflags', '+faststart+use_metadata_tags',
                 '-progress', 'pipe:1', '-nostats', '-n', str(output)]
        # Keep stderr on disk so a verbose encoder cannot block a full pipe.
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
                    if key == 'out_time_us':
                        try:
                            on_progress(min(99, max(0, int(float(value) / (duration * 1_000_000) * (70 if slideshow else 100)) + (30 if slideshow else 0))))
                        except ValueError:
                            pass
                code = process.wait()
                if should_cancel():
                    raise JobCancelled()
                if stalled[0]:
                    raise RuntimeError('Video export failed. The encoder stopped responding.')
                if code != 0 or not output.exists() or output.stat().st_size == 0:
                    errors.seek(0)
                    logger.error('ffmpeg failed for %s: %s', source, errors.read()[-1500:].strip())
                    raise RuntimeError('Video export failed. The encoder could not process this file; see the server log for details.')
                if target.exists():
                    raise RuntimeError('The export destination already exists. Please export again.')
                # A unique target is allocated by the API; never replace a catalog original.
                target.hardlink_to(output)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                if process.stdout is not None:
                    process.stdout.close()


def run_cancellable(args: list[str], should_cancel: Callable[[], bool]) -> subprocess.CompletedProcess:
    process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    stop_process_when(process, should_cancel)
    _, stderr = process.communicate()
    if should_cancel():
        raise JobCancelled()
    return subprocess.CompletedProcess(args, process.returncode, None, stderr)


def slide_motion(animation: str, index: int) -> str:
    return KEN_BURNS_MOTIONS[index % len(KEN_BURNS_MOTIONS)] if animation == 'ken-burns' else animation


def motion_filter(motion: str, frames: int, width: int, height: int, overscan: float = 2) -> str:
    """zoompan expressions; upscaling first avoids visible subpixel stepping."""
    last = max(1, frames - 1)
    zoom = {'zoom-in': f'1+0.12*on/{last}', 'zoom-out': f'1.12-0.12*on/{last}'}.get(motion, '1.12')
    x = {'pan-left': f'(iw-iw/zoom)*on/{last}', 'pan-right': f'(iw-iw/zoom)*(1-on/{last})'}.get(motion, 'iw/2-iw/zoom/2')
    return f",scale={round(width * overscan)}:{round(height * overscan)},zoompan=z='{zoom}':x='{x}':y='ih/2-ih/zoom/2':d={frames}:s={width}x{height}:fps={SLIDE_FPS}"


def slide_boundaries(edit: VideoEditRequest, count: int, total_frames: int) -> list[int]:
    """The frame each image starts on, ending with the final frame."""
    if len(edit.slide_starts) == count:
        starts = [0, *(round(start * SLIDE_FPS) for start in edit.slide_starts[1:])]
    else:
        starts = [total_frames * index // count for index in range(count)]
    return [*starts, total_frames]


def prepare_slideshow(backgrounds: list[tuple[Path, dict]], edit: VideoEditRequest, duration: float, folder: Path, on_progress: Callable[[int], None], should_cancel: Callable[[], bool] = lambda: False) -> None:
    """Render each still independently to bound encoder memory, then join them."""
    from app.services.image_service import render_edited_image_to
    width, height = canvas_size(edit) or (720, 1280)
    total_frames = max(1, math.ceil(duration * SLIDE_FPS))
    if total_frames < len(backgrounds):
        raise ValueError('Use fewer images or a longer song; each image needs at least one frame.')
    boundaries = slide_boundaries(edit, len(backgrounds), total_frames)
    shortest = min(after - before for before, after in zip(boundaries, boundaries[1:]))
    # An incoming image needs its outgoing neighbour on screen for the whole fade.
    overlap = min(round(CROSSFADE_SECONDS * SLIDE_FPS), shortest // 2) if edit.transition == 'crossfade' and len(backgrounds) > 1 else 0
    clips = []
    for index, (path, image_settings) in enumerate(backgrounds):
        frames = boundaries[index + 1] - boundaries[index] + (overlap if index + 1 < len(backgrounds) else 0)
        image = folder / f'image-{index}.png'
        clip = folder / f'slide-{index}.mp4'
        render_edited_image_to(path, path.suffix.lower(), image_settings, image)
        scale = f'{TO_BT709},scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1'
        if edit.image_animation != 'none':
            scale += motion_filter(slide_motion(edit.image_animation, index), frames, width, height, MOTION_OVERSCAN[edit.quality])
        result = run_cancellable([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-loop', '1', '-framerate', str(SLIDE_FPS), '-i', str(image), '-vf', scale,
                                  '-frames:v', str(frames), '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', *BT709_OUTPUT_ARGS, '-y', str(clip)], should_cancel)
        if result.returncode:
            logger.error('ffmpeg failed on slideshow image %s: %s', path, result.stderr[-1000:])
            raise RuntimeError(f'Could not render slideshow image {index + 1}.')
        clips.append(clip)
        on_progress(round((index + 1) / len(backgrounds) * (20 if overlap else 30)))
    if overlap:
        clips = [crossfade_clips(clips, boundaries, overlap, folder, should_cancel)]
        on_progress(30)
    (folder / 'slides.txt').write_text(''.join(f"file '{clip.name}'\n" for clip in clips), encoding='utf-8')


def crossfade_clips(clips: list[Path], boundaries: list[int], overlap: int, folder: Path, should_cancel: Callable[[], bool]) -> Path:
    inputs = [arg for clip in clips for arg in ('-i', str(clip))]
    chain = []
    joined = '[0:v]'
    for index in range(1, len(clips)):
        output = f'[faded{index}]'
        chain.append(f'{joined}[{index}:v]xfade=transition=fade:duration={overlap / SLIDE_FPS}:offset={boundaries[index] / SLIDE_FPS}{output}')
        joined = output
    target = folder / 'crossfaded.mp4'
    result = run_cancellable([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', *inputs, '-filter_complex', ';'.join(chain), '-map', joined,
                              '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-pix_fmt', 'yuv420p', *BT709_OUTPUT_ARGS, '-y', str(target)], should_cancel)
    if result.returncode:
        logger.error('ffmpeg failed joining slideshow: %s', result.stderr[-1000:])
        raise RuntimeError('Could not join the slideshow images.')
    return target
