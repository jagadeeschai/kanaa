"""Finds the person in a video with Apple's Vision framework, so their background can be removed or blurred.

A small Swift helper does the finding on this Mac's Neural Engine. It is compiled once, with Apple's command line tools.
Each video gets a person mask, made once and kept with its other prepared files. From it come:
  - a see-through preview copy, for Remove (the export applies the mask to the full video itself);
  - a portrait copy with the background already blurred, for Blur, and its proxy.
"""
from __future__ import annotations

import hashlib
import logging
import shutil
import subprocess
import threading

import numpy as np
from pathlib import Path
from typing import Callable

from app.core.config import settings
from app.services.asset_service import content_key, folder_for, make_proxy
from app.services.job_service import JobCancelled, get_job, stop_process_when, update_job
from app.services.media_probe import MediaFacts, probe_video
from app.services.render_queue_service import BACKGROUND_PRIORITY, enqueue_render
from app.services.reverse_service import lock_for
from app.services.video_edit_service import BT709_OUTPUT_ARGS, HDR_TO_BT709, SD_COLOR_SPACES, TO_BT709, run_cancellable

logger = logging.getLogger(__name__)
SOURCE = Path(__file__).resolve().parents[2] / 'native' / 'person_mask.swift'
# Version 2 masks are steadied over time; older ones are left behind and made again.
MASK = 'person-mask-2.mp4'
SEE_THROUGH = 'person-cut-2.webm'
PORTRAIT = 'portrait-2.mp4'
PORTRAIT_PROXY = 'portrait-proxy-2.mp4'
STEADY_RADIUS = 2  # Frames either side.
FIRM_LOW, FIRM_HIGH = 48, 200  # Below is clear, above is solid, between is the soft edge.
MASK_SIDE = 1280  # The mask's long side. The export scales it to the full frame, softly.
PREVIEW_SIDE = 720
PORTRAIT_BLUR = 0.015  # Of the frame height: a strong portrait-mode look.
BLUR_AMOUNTS = {'subtle': 0.007, 'medium': PORTRAIT_BLUR, 'strong': 0.03}  # Of the frame height.
EDGE_SOFTNESS = 1.5  # Pixels of the mask's own blur, so edges don't shimmer.
INSTALL_TOOLS = 'xcode-select --install'
_build = threading.Lock()
_active: dict[str, str] = {}


def helper(source: Path = SOURCE) -> Path:
    """The compiled helper, rebuilt when its source changes."""
    digest = hashlib.sha256(source.read_bytes()).hexdigest()[:12]
    target = settings.data_dir / 'bin' / f'{source.stem}-{digest}'
    with _build:
        if target.is_file():
            return target
        swiftc = shutil.which('swiftc')
        if not swiftc:
            raise RuntimeError(f"Finding people needs Apple's command line tools. Run {INSTALL_TOOLS} in Terminal, then try again.")
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix('.tmp')
        result = subprocess.run([swiftc, '-O', str(source), '-o', str(temporary)], capture_output=True, text=True, timeout=600)
        if result.returncode:
            logger.error('Could not build the person finder: %s', result.stderr[-1500:])
            raise RuntimeError('Could not set up person finding on this Mac. See the server log for details.')
        temporary.replace(target)
    return target


def colour(facts: MediaFacts) -> str:
    return HDR_TO_BT709 if facts.is_hdr else TO_BT709 if facts.color_space in SD_COLOR_SPACES else 'format=yuv420p'


def mask_size(facts: MediaFacts) -> tuple[int, int]:
    width, height = facts.width or 1920, facts.height or 1080
    shrink = min(1, MASK_SIDE / max(width, height))
    return max(2, round(width * shrink / 2) * 2), max(2, round(height * shrink / 2) * 2)


def files(source: Path) -> dict[str, Path]:
    folder = folder_for(content_key(source))
    return {name: folder / name for name in (MASK, SEE_THROUGH, PORTRAIT, PORTRAIT_PROXY)}


class Steadier:
    """Vision's mask wobbles on real footage: a patch goes see-through or an arm drops out for a frame, and a title
    behind the person shows through for that frame. Each mask frame becomes the middle value of its neighbours, which
    removes one- and two-frame dropouts without lagging, and the inside is firmed up so it can't half-vanish."""

    def __init__(self, radius: int = STEADY_RADIUS):
        self.radius = radius
        self.window: list[np.ndarray] = []
        self.sent = 0
        self.seen = 0

    def firm(self, mask: np.ndarray) -> np.ndarray:
        return np.clip((mask.astype(np.int32) - FIRM_LOW) * 255 // (FIRM_HIGH - FIRM_LOW), 0, 255).astype(np.uint8)

    def middle(self, index: int) -> np.ndarray:
        # The window holds frames from `self.seen - len(window)`; ends repeat the nearest frame.
        first = self.seen - len(self.window)
        picks = [self.window[min(max(index + offset, first), self.seen - 1) - first] for offset in range(-self.radius, self.radius + 1)]
        if all(pick is picks[0] for pick in picks):
            return self.firm(picks[0])  # The same frame throughout, such as an empty one: no middle to find.
        return self.firm(np.median(np.stack(picks), axis=0).astype(np.uint8))

    def push(self, mask: np.ndarray) -> list[np.ndarray]:
        self.window.append(mask)
        self.seen += 1
        out = []
        while self.sent + self.radius < self.seen:
            out.append(self.middle(self.sent))
            self.sent += 1
        while len(self.window) > 2 * self.radius + 1:
            self.window.pop(0)
        return out

    def finish(self) -> list[np.ndarray]:
        out = []
        while self.sent < self.seen:
            out.append(self.middle(self.sent))
            self.sent += 1
        return out


def make_mask(facts: MediaFacts, on_progress: Callable[[int], None], should_cancel: Callable[[], bool], finder: list[str] | None = None) -> None:
    """Every frame, in order, through the finder, at the video's own frame rate so the mask lines up frame for frame."""
    target = files(facts.path)[MASK]
    target.parent.mkdir(parents=True, exist_ok=True)
    width, height = mask_size(facts)
    fps = facts.fps or 30
    total = max(1, round((facts.duration or 1) * fps))
    ffmpeg = shutil.which('ffmpeg')
    temporary = target.with_suffix('.tmp.mp4')
    decode = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-i', str(facts.path), '-an', '-vf', f'{colour(facts)},scale={width}:{height}', '-fps_mode', 'passthrough',
                               '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    find = subprocess.Popen([*(finder or [str(helper())]), str(width), str(height)], stdin=decode.stdout, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    decode.stdout.close()  # The finder owns it now, so the decoder stops if the finder does.
    encode = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', f'{width}x{height}', '-r', f'{fps}', '-i', '-',
                               '-vf', f'gblur=sigma={EDGE_SOFTNESS}', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', str(temporary)],
                              stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    processes = (decode, find, encode)
    for process in processes:
        stop_process_when(process, should_cancel)
    try:
        frame, done = width * height, 0
        steady = Steadier()
        while chunk := find.stdout.read(frame):
            if len(chunk) < frame:
                break
            for ready in steady.push(np.frombuffer(chunk, np.uint8).reshape(height, width)):
                encode.stdin.write(ready.tobytes())
            done += 1
            if done % 10 == 0:
                on_progress(min(95, done * 95 // total))
        for ready in steady.finish():
            encode.stdin.write(ready.tobytes())
        encode.stdin.close()
        codes = [process.wait() for process in processes]
        if should_cancel():
            raise JobCancelled()
        if any(codes) or done == 0:
            logger.error('Person finding failed for %s: %s %s', facts.path, find.stderr.read()[-800:], encode.stderr.read()[-800:])
            raise RuntimeError('Could not find the person in this clip.')
        temporary.replace(target)
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.wait()
        temporary.unlink(missing_ok=True)


def make_see_through(facts: MediaFacts, should_cancel: Callable[[], bool], mask: Path | None = None, target: Path | None = None) -> None:
    """The preview copy for Remove: VP9 keeps the mask as transparency, which the preview can play directly."""
    paths = files(facts.path)
    mask, target = mask or paths[MASK], target or paths[SEE_THROUGH]
    temporary = target.with_suffix('.tmp.webm')
    graph = f"[0:v]{colour(facts)},scale=-2:{PREVIEW_SIDE},fps=30,format=yuva420p[video];[1:v]format=gray[shape];[shape][video]scale2ref[mask][scaled];[scaled][mask]alphamerge"
    result = run_cancellable([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-i', str(facts.path), '-i', str(mask), '-filter_complex', graph, '-an',
                              '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-b:v', '3M', '-auto-alt-ref', '0', '-g', '15', str(temporary)], should_cancel)
    if result.returncode:
        temporary.unlink(missing_ok=True)
        logger.error('See-through copy failed for %s: %s', facts.path, result.stderr[-800:])
        raise RuntimeError('Could not prepare the cut-out preview.')
    temporary.replace(target)


def make_portrait(facts: MediaFacts, should_cancel: Callable[[], bool], mask: Path | None = None, target: Path | None = None, proxy: Path | None = None, amount: str = 'medium') -> None:
    """The person sharp over their own background, blurred. Made at full size, so export and preview share it."""
    paths = files(facts.path)
    mask, target, proxy = mask or paths[MASK], target or paths[PORTRAIT], proxy or paths[PORTRAIT_PROXY]
    temporary = target.with_suffix('.tmp.mp4')
    sigma = BLUR_AMOUNTS[amount] * (facts.height or 1080)
    graph = (f"[0:v]{colour(facts)},format=gbrp,split=2[back][front];[back]gblur=sigma={sigma:.2f}:steps=3[soft];[1:v]format=gray[shape];[shape][front]scale2ref=flags=bicubic[mask][sharp];"
             f"[sharp][mask]alphamerge[person];[soft][person]overlay=format=gbrp,format=yuv420p")
    result = run_cancellable([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-i', str(facts.path), '-i', str(mask), '-filter_complex', graph, '-an',
                              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-fps_mode', 'passthrough', *BT709_OUTPUT_ARGS, str(temporary)], should_cancel)
    if result.returncode:
        temporary.unlink(missing_ok=True)
        logger.error('Portrait copy failed for %s: %s', facts.path, result.stderr[-800:])
        raise RuntimeError('Could not blur the background of this clip.')
    portrait = probe_video(temporary)
    if portrait is None:
        raise RuntimeError('Could not blur the background of this clip.')
    make_proxy(portrait, proxy, should_cancel)
    temporary.replace(target)


def is_ready(source: Path, mode: str) -> bool:
    paths = files(source)
    need = [MASK, SEE_THROUGH] if mode == 'remove' else [MASK, PORTRAIT, PORTRAIT_PROXY]
    return all(paths[name].is_file() for name in need)


def prepare(facts: MediaFacts, mode: str, on_progress: Callable[[int], None], should_cancel: Callable[[], bool], finder: list[str] | None = None) -> None:
    paths = files(facts.path)
    with lock_for(content_key(facts.path)):
        if not paths[MASK].is_file():
            make_mask(facts, on_progress, should_cancel, finder)
        if mode == 'remove' and not paths[SEE_THROUGH].is_file():
            make_see_through(facts, should_cancel)
        if mode == 'blur' and not (paths[PORTRAIT].is_file() and paths[PORTRAIT_PROXY].is_file()):
            make_portrait(facts, should_cancel)


def ensure_mask(facts: MediaFacts, should_cancel: Callable[[], bool] = lambda: False) -> Path:
    """For Remove: the mask the export applies to the full video."""
    prepare(facts, 'remove', lambda _: None, should_cancel)
    return files(facts.path)[MASK]


def request_cutout(facts: MediaFacts, mode: str, label: str) -> dict:
    """Ready, or being made in the background."""
    key = f'{content_key(facts.path)}:{mode}'
    if is_ready(facts.path, mode):
        return {'status': 'ready'}
    active = _active.get(key)
    job = get_job(active) if active else None
    if job and not job.get('done'):
        return {'status': 'preparing', 'job_id': active, 'progress': job.get('progress', 0)}

    def run(should_cancel: Callable[[], bool]) -> dict:
        try:
            prepare(facts, mode, lambda value: update_job(_active.get(key, ''), progress=value), should_cancel)
        finally:
            _active.pop(key, None)
        return {'progress': 100}

    job_id = enqueue_render('cutout', f'Finding the person in {label}', run, priority=BACKGROUND_PRIORITY, total=100, reserve=lambda identifier: _active.__setitem__(key, identifier))
    return {'status': 'preparing', 'job_id': job_id, 'progress': 0}
