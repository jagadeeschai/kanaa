"""Colour match for a keyed or cut-out clip: what gains bring it toward the light and colour of what is behind it.

Two one-frame renders through the export itself (so a green screen and an AI cut-out are measured the same way): what
is below the clip's layer on its own, and the same with the clip laid over it. Where they clearly differ is the clip.
"""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from app.services.timeline_schema import Timeline

LIMIT = (0.6, 1.6)


def _frame(timeline: Timeline, at: float, render, folder: Path, name: str) -> np.ndarray:
    target = folder / f'{name}.mp4'
    render(timeline, target, (at, at + 2 / timeline.format.fps))
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(target), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(timeline.format.height, timeline.format.width, 3).astype(float)


def gains(front: np.ndarray, back: np.ndarray) -> tuple[float, float, float]:
    """Half-way toward the background's colour cast, and a third of the way toward its brightness, within LIMIT."""
    f = np.maximum(front.reshape(-1, 3).mean(axis=0), 1); b = np.maximum(back.reshape(-1, 3).mean(axis=0), 1)
    cast = (b / b.mean()) / (f / f.mean()); level = (b.mean() / f.mean()) ** (1 / 3)
    return tuple(float(np.clip(value, *LIMIT)) for value in np.sqrt(cast) * level)


def measure(timeline: Timeline, clip_id: str, at: float, render) -> tuple[float, float, float]:
    """`render(timeline, target, window)` encodes that stretch. Raises ValueError when there is nothing to compare."""
    position = next((index for index, layer in enumerate(timeline.layers) if layer.kind == 'video' and any(clip.id == clip_id for clip in layer.items)), None)
    if position is None:
        raise ValueError('That clip is not on the timeline.')
    if position == next(index for index, layer in enumerate(timeline.layers) if layer.kind == 'video'):
        raise ValueError('Put this clip on a layer above its background first.')
    data = timeline.model_dump(by_alias=True)
    for index, layer in enumerate(data['layers']):
        if index > position or layer['kind'] != 'video':
            layer['hidden'] = True
        for clip in layer.get('items', []):
            if clip.get('id') == clip_id and clip.get('composite'):
                clip['composite'] = {**clip['composite'], 'match': 0, 'wrap': 0}
    together = Timeline.model_validate(data)
    data['layers'][position]['hidden'] = True
    behind = Timeline.model_validate(data)
    with tempfile.TemporaryDirectory() as folder:
        back = _frame(behind, at, render, Path(folder), 'behind'); both = _frame(together, at, render, Path(folder), 'together')
    changed = (np.abs(both - back).sum(axis=2) > 40)
    solid = np.asarray(Image.fromarray((changed * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(7))) > 0
    if solid.sum() < 200:
        raise ValueError('The clip does not show at this moment: move the playhead to where it is on screen.')
    return gains(both[solid], back[~changed])
