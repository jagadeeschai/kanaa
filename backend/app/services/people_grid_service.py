"""Where people are, coarsely, through a clip: for a title that keeps clear of them.

Reads the person mask already made for the cut-out (all people, or the chosen ones), samples it a few times a second
and keeps each sample as a small on/off grid. The editor finds how far a title must move so no one comes within its
gap (timeline/keepClear.ts) and writes that as ordinary move keyframes, so the export needs nothing of this.
Kept with the clip's other prepared files. Runs on this Mac.
"""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
from typing import Callable

import numpy as np

from app.services.asset_service import content_key, folder_for
from app.services.job_service import JobCancelled
from app.services.tracking_service import FPS, frames

GRID_W, GRID_H = 96, 54
SAMPLES_PER_SECOND = 15  # Every other frame of the 30 a second the masks are read at.
ON = 96  # A grid cell counts as a person when its mask average is above this (of 255).
VERSION = 1


def grid_path(source: Path, mask: Path, start: float, end: float) -> Path:
    ident = json.dumps([VERSION, mask.name, round(start * FPS), round(end * FPS)])
    return folder_for(content_key(source)) / f'people-grid-{hashlib.sha256(ident.encode()).hexdigest()[:12]}.json'


def pack(cells: np.ndarray) -> str:
    """A grid of booleans, row by row, as base64 bits (most significant bit first). Read by unpackGrid in keepClear.ts."""
    return base64.b64encode(np.packbits(cells.astype(bool).ravel()).tobytes()).decode()


def people_grid(mask: Path, start: float, end: float, should_cancel: Callable[[], bool] = lambda: False,
                on_progress: Callable[[int], None] = lambda _: None) -> dict:
    """{'fps' (samples a second), 'start' (source seconds of the first), 'w', 'h', 'frames': [packed grids]}."""
    first, count = round(start * FPS), max(1, round((end - start) * FPS) + 1)
    step = max(1, round(FPS / SAMPLES_PER_SECOND))
    # Read at 4x the grid, then average down, so a thin arm still marks its cell.
    out = []
    for index, picture in enumerate(frames(mask, first, count, (GRID_W * 4, GRID_H * 4))):
        if should_cancel():
            raise JobCancelled()
        if index % step:
            continue
        grey = picture[:, :, 1].astype(np.float32).reshape(GRID_H, 4, GRID_W, 4).mean(axis=(1, 3))
        out.append(pack(grey > ON))
        on_progress(min(99, index * 100 // count))
    on_progress(100)
    return {'fps': FPS / step, 'start': first / FPS, 'w': GRID_W, 'h': GRID_H, 'frames': out}


def ensure(source: Path, mask: Path, start: float, end: float, should_cancel: Callable[[], bool] = lambda: False,
           on_progress: Callable[[int], None] = lambda _: None) -> dict:
    target = grid_path(source, mask, start, end)
    if target.is_file():
        return json.loads(target.read_text())
    result = people_grid(mask, start, end, should_cancel, on_progress)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result))
    return result
