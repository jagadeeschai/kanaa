"""Match-cut finder: pairs of clips that cut together seamlessly, the way an editor hunts for a match cut. Near the
end of one clip and near the start of another, it compares
- the shape of the picture: where it is bright and dark, and where its edges are (a round sun and a round plate,
  a doorway and a doorway), on small, softened copies so detail doesn't matter, only layout;
- the motion: which way things move (a walk to the left continuing into another walk to the left).
Each suggestion says where to cut out of the first clip and into the second (the frames that match best), how well
they match, and why, with a small picture of each side.
"""
from __future__ import annotations

import base64
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from app.services.job_service import JobCancelled

SIZE = (64, 36)  # The small copy compared: layout, not detail.
REACH = 2.0  # Seconds from a clip's end (cutting out) or start (cutting in) that are tried.
STEP = 0.25  # Seconds between the moments tried.
MOTION_GAP = 0.12  # Seconds between the two frames that show which way things move.
BEST = 6  # Suggestions given.
MOVING = 0.8  # Motion (pixels of a 160-wide copy per MOTION_GAP) below which a picture counts as still.
STIRRING = 0.5  # A pixel moving less than this (same units) is part of the still background.
LEAST = 0.45  # Matches weaker than this are not suggested.


@dataclass
class Moment:
    at: float  # Source seconds.
    layout: np.ndarray  # Brightness, normalised.
    edges: np.ndarray  # Edge strength, normalised.
    motion: np.ndarray  # Mean motion (across, down), small-copy pixels.
    picture: np.ndarray  # The frame, small, for the suggestion's picture.


def _grab(path: Path, at: float, width: int = 320) -> np.ndarray | None:
    height = round(width * 9 / 16 / 2) * 2
    raw = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-ss', f'{max(0.0, at):.3f}', '-i', str(path), '-frames:v', '1',
                          '-vf', f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2',
                          '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(height, width, 3) if len(raw) == width * height * 3 else None


def _normal(values: np.ndarray) -> np.ndarray:
    values = values.astype(np.float32).ravel()
    spread = values.std()
    return (values - values.mean()) / spread if spread > 1e-3 else np.zeros_like(values)


def moment(path: Path, at: float) -> Moment | None:
    import cv2
    first, second = _grab(path, at), _grab(path, at + MOTION_GAP)
    if first is None:
        return None
    small = cv2.GaussianBlur(cv2.resize(cv2.cvtColor(first, cv2.COLOR_BGR2GRAY), SIZE, interpolation=cv2.INTER_AREA).astype(np.float32), (0, 0), 1)
    edges = cv2.magnitude(cv2.Sobel(small, cv2.CV_32F, 1, 0), cv2.Sobel(small, cv2.CV_32F, 0, 1))
    motion = np.zeros(2, np.float32)
    if second is not None:
        a = cv2.resize(cv2.cvtColor(first, cv2.COLOR_BGR2GRAY), (160, 90), interpolation=cv2.INTER_AREA)
        b = cv2.resize(cv2.cvtColor(second, cv2.COLOR_BGR2GRAY), (160, 90), interpolation=cv2.INTER_AREA)
        flow = cv2.calcOpticalFlowFarneback(a, b, None, 0.5, 3, 15, 3, 5, 1.2, 0).reshape(-1, 2)
        # What moves, not the still background around it: the mean of the pixels that move at all.
        moved = flow[np.linalg.norm(flow, axis=1) > STIRRING]
        if len(moved) > flow.shape[0] * 0.01:
            motion = moved.mean(axis=0)
    return Moment(at, _normal(small), _normal(cv2.GaussianBlur(edges, (0, 0), 1)), motion, first)


def score(out: Moment, into: Moment) -> tuple[float, str]:
    """How well cutting from `out` into `into` matches, 0..1, and why in a few words."""
    layout = float(np.dot(out.layout, into.layout) / out.layout.size)  # Correlation, −1..1.
    edges = float(np.dot(out.edges, into.edges) / out.edges.size)
    shape = max(0.0, 0.55 * layout + 0.45 * edges)
    speed_out, speed_in = float(np.linalg.norm(out.motion)), float(np.linalg.norm(into.motion))
    if speed_out > MOVING and speed_in > MOVING:
        direction = float(np.dot(out.motion, into.motion) / (speed_out * speed_in))  # −1..1.
        together = max(0.0, direction) * min(speed_out, speed_in) / max(speed_out, speed_in)  # Same way, at a like speed.
        total = 0.6 * shape + 0.4 * together
        why = 'same shape and the same movement' if shape > 0.5 and together > 0.5 else 'the movement carries on' if together > shape else 'same shape'
    elif speed_out > MOVING or speed_in > MOVING:
        total, why = 0.85 * shape, 'same shape'  # One moves, the other is still: a little less smooth.
    else:
        total, why = shape, 'same shape'
    return max(0.0, min(1.0, total)), why


def _jpeg(picture: np.ndarray) -> str:
    import cv2
    ok, data = cv2.imencode('.jpg', picture, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return 'data:image/jpeg;base64,' + base64.b64encode(data.tobytes()).decode() if ok else ''


def find(clips: list[dict], path_of: Callable[[int], Path | None], on_progress: Callable[[int], None] = lambda _: None,
         should_cancel: Callable[[], bool] = lambda: False) -> list[dict]:
    """clips: [{id, media_id, in, out}] (source seconds). The best cuts from the end of one into the start of another."""
    ends: dict[str, list[Moment]] = {}
    starts: dict[str, list[Moment]] = {}
    for number, clip in enumerate(clips):
        if should_cancel():
            raise JobCancelled()
        path = path_of(int(clip['media_id']))
        if path is None:
            continue
        begin, finish = float(clip['in']), float(clip['out'])
        reach = min(REACH, (finish - begin) / 2)
        # Cutting out: the last moments, leaving room for the motion frame; cutting in: the first moments.
        outs = np.arange(finish - MOTION_GAP - 0.05, finish - MOTION_GAP - 0.05 - reach, -STEP)
        ins = np.arange(begin, begin + reach, STEP)
        ends[clip['id']] = [found for at in outs if (found := moment(path, float(at)))]
        starts[clip['id']] = [found for at in ins if (found := moment(path, float(at)))]
        on_progress(min(90, (number + 1) * 90 // max(1, len(clips))))
    pairs = []
    for first in clips:
        for second in clips:
            if first['id'] == second['id'] or not ends.get(first['id']) or not starts.get(second['id']):
                continue
            best = max(((score(out, into), out, into) for out in ends[first['id']] for into in starts[second['id']]), key=lambda found: found[0][0])
            (value, why), out, into = best
            pairs.append({'from': first['id'], 'to': second['id'], 'from_at': round(out.at, 3), 'to_at': round(into.at, 3), 'score': round(value, 3), 'why': why,
                          '_pictures': (out.picture, into.picture)})
    pairs.sort(key=lambda pair: -pair['score'])
    chosen, used = [], set()
    for pair in pairs:  # Each clip in at most one cut out and one cut in, so the suggestions can all be used.
        if pair['score'] < LEAST:
            break
        if ('out', pair['from']) in used or ('in', pair['to']) in used or ('pair', *sorted((pair['from'], pair['to']))) in used:
            continue
        used |= {('out', pair['from']), ('in', pair['to']), ('pair', *sorted((pair['from'], pair['to'])))}  # A→B, not also B→A.
        out_picture, in_picture = pair.pop('_pictures')
        chosen.append({**pair, 'from_picture': _jpeg(out_picture), 'to_picture': _jpeg(in_picture)})
        if len(chosen) == BEST:
            break
    on_progress(100)
    return chosen
