"""Finds the sky in every frame, so a title can show only there: land, buildings, trees and people stay in front of it,
even as the camera walks and tilts (a drawn skyline stays put; this follows the horizon).

Sky is smooth, close in colour to the sky at the top of the frame, and joined to the top edge. Clouds and the sun's
glow are islands inside it and count as sky. The result is steadied like the people masks (cutout_service.Steadier:
median, solid, blinks bridged) and written as a land mask: white where the land is, in front of the title.
Runs on this Mac with OpenCV; made once per clip like the other prepared copies.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import numpy as np

from app.services.cutout_service import EDGE_SOFTNESS, Steadier, colour, mask_size
from app.services.job_service import JobCancelled
from app.services.media_probe import MediaFacts

logger = logging.getLogger(__name__)
WORK_WIDTH = 640  # Sky is found at this width, then scaled up to the mask size with a soft edge.
SMOOTH = 6.0  # Blurred gradient (of 255 per pixel) below this is smooth enough to be sky.
LIKE_TOP = 28.0  # Lab distance from the top band's colour within which a pixel can be sky.
TOP_BAND = 1 / 12  # The share of the frame height whose colour the sky is compared to.


def find_sky(bgr: np.ndarray) -> np.ndarray:
    """True where a frame (BGR) is sky."""
    import cv2
    height = bgr.shape[0]
    lab = cv2.cvtColor(cv2.GaussianBlur(bgr, (5, 5), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    grey = lab[..., 0]
    texture = cv2.blur(np.hypot(cv2.Sobel(grey, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(grey, cv2.CV_32F, 0, 1, ksize=3)), (9, 9))
    reference = np.median(lab[:max(1, round(height * TOP_BAND))].reshape(-1, 3), axis=0)
    candidate = (texture < SMOOTH) & (np.linalg.norm(lab - reference, axis=2) < LIKE_TOP)
    _, labels = cv2.connectedComponents(candidate.astype(np.uint8))
    touching_top = [label for label in np.unique(labels[0]) if label]
    sky = cv2.morphologyEx(np.isin(labels, touching_top).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8)).astype(bool)
    # The blurred texture bleeds a few pixels of ground detail up into the sky: grow back to the real edge, through
    # pixels that are themselves smooth and sky-coloured.
    sharp = np.hypot(cv2.Sobel(grey, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(grey, cv2.CV_32F, 0, 1, ksize=3))
    near = (sharp < SMOOTH * 2) & (np.linalg.norm(lab - reference, axis=2) < LIKE_TOP)
    for _ in range(3):
        sky = sky | (cv2.dilate(sky.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & near)
    # Clouds and the sun's glow: what isn't sky but never reaches the bottom of the frame is enclosed by sky.
    _, rest = cv2.connectedComponents((~sky).astype(np.uint8))
    grounded = [label for label in np.unique(rest[-1]) if label]
    return sky | ((rest > 0) & ~np.isin(rest, grounded))


def make_land_mask(facts: MediaFacts, target: Path, on_progress: Callable[[int], None], should_cancel: Callable[[], bool]) -> None:
    """Every frame, in order, at the video's own rate: white where it is not sky."""
    import cv2
    width, height = mask_size(facts)
    work_h = max(2, round(height * WORK_WIDTH / width / 2) * 2)
    fps = facts.fps or 30
    total = max(1, round((facts.duration or 1) * fps))
    ffmpeg = shutil.which('ffmpeg')
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp.mp4')
    decode = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-i', str(facts.path), '-an', '-vf', f'{colour(facts)},scale={WORK_WIDTH}:{work_h}', '-fps_mode', 'passthrough',
                               '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    encode = subprocess.Popen([ffmpeg, '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', f'{width}x{height}', '-r', f'{fps}', '-i', '-',
                               '-vf', f'gblur=sigma={EDGE_SOFTNESS}', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', str(temporary)],
                              stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    steady = Steadier(fps=fps)

    def send(masks):
        for mask in masks:
            encode.stdin.write(cv2.resize(mask, (width, height), interpolation=cv2.INTER_LINEAR).tobytes())
    try:
        done, frame = 0, WORK_WIDTH * work_h * 3
        assert decode.stdout is not None and encode.stdin is not None
        while chunk := decode.stdout.read(frame):
            if should_cancel():
                raise JobCancelled()
            if len(chunk) < frame:
                break
            land = ~find_sky(np.frombuffer(chunk, np.uint8).reshape(work_h, WORK_WIDTH, 3))
            send(steady.push(np.where(land, 255, 0).astype(np.uint8)))
            done += 1
            if done % 10 == 0:
                on_progress(min(95, done * 95 // total))
        send(steady.finish())
        encode.stdin.close()
        if encode.wait() or done == 0:
            logger.error('Finding the sky failed for %s: %s', facts.path, encode.stderr.read()[-800:] if encode.stderr else '')
            raise RuntimeError('Could not find the sky in this clip.')
        temporary.replace(target)
    finally:
        for process in (decode, encode):
            if process.poll() is None:
                process.kill()
                process.wait()
            for stream in (process.stdout, process.stderr):
                if stream:
                    stream.close()
        temporary.unlink(missing_ok=True)
