"""Private GPU export transaction; unsupported timelines retain the reference renderer."""
from __future__ import annotations

import logging
import functools
import os
import tempfile
from pathlib import Path

from app.services.job_service import JobCancelled

logger = logging.getLogger(__name__)


def try_render(timeline, media, audio_asset, target, on_progress, should_cancel, prepared, masks, voices, hardware, ffmpeg):
    from app.services import gpu_render, timeline_service as reference
    from app.services.gpu_audio import compile_audio
    media = functools.cache(media)
    if not hardware or os.environ.get('KANAA_GPU_RENDER') == '0':
        return False
    try:
        if not reference._hardware_h264(ffmpeg):
            return False
        timeline = reference.playing_timeline(timeline)
        if gpu_render.unsupported(timeline, media):
            return False
    except Exception:
        logger.exception('GPU capability check failed; falling back to FFmpeg')
        return False
    try:
        with tempfile.TemporaryDirectory(prefix='.gpu-export-', dir=target.parent) as directory:
            folder = Path(directory)
            if should_cancel():
                raise JobCancelled()
            compiled = compile_audio(timeline, media, audio_asset, folder, prepared, masks, voices)
            sound = None
            if compiled.has_audio:
                sound = reference.mix_audio(ffmpeg, compiled, folder, should_cancel)
                if compiled.normalize_audio:
                    sound = reference.normalize_loudness(ffmpeg, compiled, sound, folder, should_cancel)
            on_progress(3)
            logger.info('Exporting on the GPU')
            silent = folder / 'silent.mp4'
            short = min(timeline.format.width, timeline.format.height)
            bitrate = {720: 9, 1080: 16, 1440: 28}.get(short, 50 if short >= 2160 else round(short * .015)) * 1_000_000
            gpu_render.render(timeline, media, silent, lambda p: on_progress(min(97, 3 + int(p * .94))), bitrate=bitrate,
                              should_cancel=should_cancel, masks=masks)
            output = folder / 'output.mp4'
            audio_input = ['-i', str(sound)] if sound else []
            audio = ['-map', '1:a', '-c:a', 'aac', '-b:a', '192k'] if sound else ['-an']
            result = reference.run_cancellable([ffmpeg, '-nostdin', '-v', 'error', '-i', str(silent), *audio_input,
                '-map', '0:v', *audio, '-c:v', 'copy', '-t', f'{timeline.duration:.6f}', *reference.BT709_OUTPUT_ARGS,
                '-map_metadata', '-1', '-movflags', '+faststart', '-n', str(output)], should_cancel)
            if should_cancel():
                raise JobCancelled()
            if result.returncode or not output.is_file() or not output.stat().st_size:
                raise RuntimeError('GPU video could not be muxed')
            target.hardlink_to(output)
            on_progress(99)
            return True
    except JobCancelled:
        raise
    except Exception:
        if should_cancel():
            raise JobCancelled()
        logger.exception('GPU export failed; falling back to FFmpeg')
        return False
