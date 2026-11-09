"""Where each letter of a title is in its picture, for letter-by-letter animations (LETTER_PRESETS in animation.py).

The title is drawn once more, plain, with each letter in its own colour (write_title's letter_ids), so its red value
is three times the letter's number. Every visible pixel of the real picture (outline, shadow and glow too) then belongs to the
nearest numbered pixel, within reach. The result is a map the size of the frame (0: no letter, 1..n: the letter) and
each letter's box. The preview gets the same map from /api/text-letters, so both sides move the same pixels.
A Tamil consonant with its vowel sign or pulli is one letter (letter_clusters). More than MAX_LETTERS letters are
gathered into that many groups, in reading order. A laid-out title (design) has no letters: it stays whole.
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from app.services.timeline_schema import Format, Text

MAX_LETTERS = 64  # Matches MAX_LETTERS in animation.ts: the preview shader's arrays hold this many (and 3 × 64 fits in red).
REACH = 0.3  # Of the title's size, in pixels at 720 wide: how far a glow or shadow pixel may be from its letter.


def _draw(item: Text, fmt: Format, letter_ids: list[int] | None, group=lambda number: number) -> np.ndarray:
    from app.services.timeline_service import render_text_image, write_title
    from app.services.video_edit_service import LYRIC_FONTS_DIR
    with tempfile.TemporaryDirectory() as folder:
        folder = Path(folder)
        if letter_ids is None:
            render_text_image(item, fmt, folder / 'out.png')
        else:
            write_title(folder / 'title.ass', item, fmt, letter_ids=letter_ids, letter_group=group)
            (folder / 'fonts').symlink_to(LYRIC_FONTS_DIR)
            result = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'color=c=black@0:s={fmt.width}x{fmt.height}:r=30:d=0.5,format=rgba',
                                     '-vf', 'ass=filename=title.ass:shaping=complex:fontsdir=fonts:alpha=1', '-frames:v', '1', '-update', '1', 'out.png'],
                                    cwd=folder, capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError('Could not find the letters of this title.')
        return np.asarray(Image.open(folder / 'out.png').convert('RGBA'))


def _fill(picture: np.ndarray, item: Text) -> np.ndarray:
    """Where the real picture shows the letters' own colour (title or subtitle), not their outline or shadow."""
    colours = [item.color, item.subtitle_color or item.color]
    rgb = picture[..., :3].astype(np.int32)
    near = np.zeros(rgb.shape[:2], bool)
    for colour in colours:
        target = np.array([int(colour[at:at + 2], 16) for at in (1, 3, 5)])
        near |= np.abs(rgb - target).max(axis=2) < 48
    return near & (picture[..., 3] > 200)


def _best_shift(marks: np.ndarray, target: np.ndarray, centre: tuple[int, int], reach: int) -> tuple[int, int]:
    best, score = centre, -1
    for dy in range(centre[1] - reach, centre[1] + reach + 1):
        for dx in range(centre[0] - reach, centre[0] + reach + 1):
            overlap = int((np.roll(np.roll(marks, dy, 0), dx, 1) & target).sum())
            if overlap > score:
                best, score = (dx, dy), overlap
    return best


def _lined_up(numbered: np.ndarray, solid: np.ndarray) -> np.ndarray:
    """The numbered drawing moved by the whole pixels that best cover the real picture's letter fill (a plain title's
    writer places its words a few pixels differently). Searched on a shrunk copy first, then exactly nearby."""
    marks = numbered > 0
    if not marks.any() or not solid.any():
        return numbered
    height, width = numbered.shape
    step = max(1, round(width / 720))
    reach = 6 * step  # About six pixels at 720 wide.
    rows, cols = np.nonzero(marks | solid)
    top, left = max(0, rows.min() - reach), max(0, cols.min() - reach)
    bottom, right = min(height, rows.max() + reach + 1), min(width, cols.max() + reach + 1)
    marks, target = marks[top:bottom, left:right], solid[top:bottom, left:right]
    small = _best_shift(marks[::step, ::step], target[::step, ::step], (0, 0), 6 + 1)
    dx, dy = _best_shift(marks, target, (small[0] * step, small[1] * step), step)
    out = np.zeros_like(numbered)
    height, width = numbered.shape
    out[max(0, dy):height + min(0, dy), max(0, dx):width + min(0, dx)] = numbered[max(0, -dy):height - max(0, dy), max(0, -dx):width - max(0, dx)]
    return out


SPECK = 0.04  # A piece of a letter smaller than this share of it is where two letters' edges blend: not a part of it.


def _without_specks(numbered: np.ndarray, count: int) -> np.ndarray:
    """Each letter keeps its real parts (all three of பொ) and loses stray specks where neighbouring letters' edges blend."""
    import cv2
    out = numbered.copy()
    for number in range(1, count + 1):
        mine = (numbered == number).astype(np.uint8)
        total = int(mine.sum())
        if not total:
            continue
        pieces, labels, stats, _ = cv2.connectedComponentsWithStats(mine, connectivity=8)
        for piece in range(1, pieces):
            if stats[piece, cv2.CC_STAT_AREA] < max(4, SPECK * total):
                out[labels == piece] = 0
    return out


def letters_for(item: Text, fmt: Format) -> tuple[np.ndarray, list[tuple[int, int, int, int]]]:
    """The letter map (uint8, the frame's size) and each letter's box (x0, y0, x1, y1, exclusive), in reading order."""
    import cv2
    height, width = fmt.height, fmt.width
    empty = np.zeros((height, width), np.uint8)
    if item.design:
        return empty, []
    from app.services.timeline_service import letter_clusters
    total = sum(1 for line in (item.text, item.subtitle or '') for cluster in letter_clusters(line) if not cluster.isspace())
    if not total:
        return empty, []
    count = min(total, MAX_LETTERS)
    # More letters than can move apart: neighbours share a number, in reading order.
    group = (lambda number: number) if total <= MAX_LETTERS else (lambda number: (number - 1) * MAX_LETTERS // total + 1)
    coloured = _draw(item, fmt, [], group)
    picture = _draw(item, fmt, None)
    # Red is 3 × the number. Soft edges come back darkened by their coverage, so red is divided by alpha first.
    red, alpha = coloured[..., 0].astype(np.float32), coloured[..., 3].astype(np.float32)
    numbered = np.where(alpha >= 128, np.rint(red * 255 / np.maximum(alpha, 1) / 3), 0).astype(np.int32)
    numbered[numbered > count] = 0
    numbered = _without_specks(numbered, count)
    if not numbered.any():
        return empty, []
    numbered = _lined_up(numbered, _fill(picture, item))
    # Each visible pixel takes the number of the nearest numbered pixel, if near enough.
    distance, nearest = cv2.distanceTransformWithLabels((numbered == 0).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    seeds = numbered[numbered > 0]  # In the same row-major order distanceTransformWithLabels numbers them.
    lookup = np.concatenate([[0], seeds])
    reach = max(4.0, REACH * max(20, item.size) * width / 720)
    labels = np.where((picture[..., 3] > 0) & (distance <= reach), lookup[nearest], 0).astype(np.uint8)
    boxes = []
    for number in range(1, count + 1):
        rows, cols = np.nonzero(labels == number)
        boxes.append((int(cols.min()), int(rows.min()), int(cols.max()) + 1, int(rows.max()) + 1) if rows.size else (0, 0, 0, 0))
    return labels, boxes
