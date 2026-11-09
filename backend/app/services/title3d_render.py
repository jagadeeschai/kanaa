"""The export of a title in 3D: its picture warped frame by frame through the same corners the preview draws.

title3d.py works out four corners per depth layer; here OpenCV warps the title picture to them, back to front, with
the sides shaded in the depth colour, and the frames are written as a short see-through video. timeline_service then
lays that video over the frame where a flat title's posed picture would go.
"""
from __future__ import annotations

import math
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
from PIL import Image

from app.services import title3d
from app.services.animation import LETTER_PRESETS, LETTER_REST, TRICK_COPIES, TRICK_MARGIN, letter_looks

PinAt = Callable[[float], 'list[list[float]] | None']  # Timeline seconds to the pin matrix, or None.


def alpha_box(alpha: np.ndarray) -> tuple[float, float, float, float] | None:
    """The letters' box as shares of the picture: alpha over ALPHA_EDGE, padded 4 pixels. Same rule as alphaBox in title3d.ts."""
    rows, cols = np.nonzero(alpha > title3d.ALPHA_EDGE)
    if not rows.size:
        return None
    height, width = alpha.shape
    pad = 4
    x0, y0 = max(0, cols.min() - pad), max(0, rows.min() - pad)
    x1, y1 = min(width, cols.max() + 1 + pad), min(height, rows.max() + 1 + pad)
    return x0 / width, y0 / height, x1 / width, y1 / height


COPY_TRICKS = {'chromatic', 'prism', 'echo'}
PRISM_TINTS = {-2: (1, .25, .25), -1: (1, .85, .2), 1: (.2, .9, 1), 2: (.6, .3, 1)}  # Matches TITLE_FRAGMENT in playback.ts.
PRISM_DIRECTION = (0.94, 0.34)


def trick_margins(text, letters: tuple[float, float, float, float]) -> tuple[float, float]:
    """Room needed beside and above/below the letters' box for copies or letters that move out. Same as trickMargins in title3d.ts."""
    w, h = letters[2] - letters[0], letters[3] - letters[1]
    across = along = 0.0
    for animation in (text.enter, text.exit):
        preset = animation.preset if animation else None
        if preset in COPY_TRICKS:
            across, along = max(across, TRICK_MARGIN * h), max(along, TRICK_MARGIN * h)
        elif preset == 'split':
            across = max(across, .62 * w)
        elif preset == 'gravity':
            along = max(along, 1.45 * h)
        elif preset == 'pop-letters':
            across, along = max(across, .15 * h), max(along, .15 * h)
    return across, along


def trick_bounds(text, letters: tuple[float, float, float, float], size: tuple[int, int]) -> tuple[float, float, float, float]:
    """The part of the picture drawn: the letters' box, and room around it for what moves out. Same as trickBounds in title3d.ts."""
    across, along = trick_margins(text, letters)
    if not across and not along:
        return letters
    width, height = size
    mx, my = math.ceil(across), math.ceil(along)
    return max(0, letters[0] - mx), max(0, letters[1] - my), min(width, letters[2] + mx), min(height, letters[3] + my)


def moving_letters(crop: np.ndarray, labels: np.ndarray, boxes, looks, origin: tuple[int, int], letters) -> np.ndarray:
    """Each letter of a premultiplied crop moved, sized about its middle and faded by its look (letterLook in
    animation.ts); pixels of no letter (a band's box) stay. The preview's TITLE_FRAGMENT does the same in pm()."""
    lw, lh = letters[2] - letters[0], letters[3] - letters[1]
    rows, cols = crop.shape[:2]
    out = crop * (labels == 0)[..., None]
    for number, (box, look) in enumerate(zip(boxes, looks), start=1):
        if look['opacity'] <= 0 or box[2] <= box[0]:
            continue
        mine = labels == number
        if not mine.any():
            continue
        cx, cy = (box[0] + box[2]) / 2 - origin[0], (box[1] + box[3]) / 2 - origin[1]
        s = look['scale']
        ox, oy = look['dx'] * lw, look['dy'] * lh
        matrix = np.float32([[s, 0, cx - s * cx + ox], [0, s, cy - s * cy + oy]])
        letter = cv2.warpAffine(crop * mine[..., None] * np.float32(look['opacity']), matrix, (cols, rows), flags=cv2.INTER_LINEAR,
                                borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
        out = letter + out * (1 - letter[..., 3:4])
    return out


def _smoothstep(low: float, high: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def picture_tricks(crop: np.ndarray, look: dict, origin: tuple[int, int], letters, line_colour) -> np.ndarray:
    """The title picture's tricks (PictureLook in animation.ts) on a premultiplied RGBA crop whose top left is `origin`
    in the picture. The preview's TITLE_FRAGMENT does the same per pixel."""
    split, trick = look.get('split', 0), look.get('trick', 0)
    reveal, rise, line = look.get('reveal', 1), look.get('rise', 1), look.get('line', -1)
    if not ((split > 0 and trick) or reveal < 1 or rise < 1 or line >= 0):
        return crop
    rows, cols = crop.shape[:2]
    lx0, ly0, lx1, ly1 = letters
    lw, lh = lx1 - lx0, ly1 - ly0
    out = crop

    def moved(dx: float, dy: float) -> np.ndarray:
        """The crop with its picture moved by (dx, dy): what sampling at p - (dx, dy) gives."""
        return cv2.warpAffine(crop, np.float32([[1, 0, dx], [0, 1, dy]]), (cols, rows), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    if split > 0 and trick:
        d = split * lh
        if trick == 1:  # Chromatic: red to the left, blue to the right.
            red, blue = moved(-d, 0), moved(d, 0)
            out = np.stack([red[..., 0], crop[..., 1], blue[..., 2], np.maximum(np.maximum(red[..., 3], crop[..., 3]), blue[..., 3])], -1)
        elif trick == 2:  # Prism: rainbow copies fanned out on a slant.
            weight = .7 * min(1, split / .05)
            out = crop.copy()
            for k, tint in PRISM_TINTS.items():
                copy = moved(k * d * PRISM_DIRECTION[0], k * d * PRISM_DIRECTION[1])
                out[..., :3] += weight * copy[..., :3] * np.float32(tint)
                out[..., 3] += weight * copy[..., 3]
            out[..., 3] = np.clip(out[..., 3], 0, 1)
            out[..., :3] = np.minimum(out[..., :3], out[..., 3:4])
        else:  # Echo: fading copies below, closing in.
            behind = np.zeros_like(crop)
            for k in range(TRICK_COPIES, 0, -1):
                copy = moved(0, k * d / TRICK_COPIES) * np.float32(.5 ** k)
                behind = copy + behind * (1 - copy[..., 3:4])
            out = crop + behind * (1 - crop[..., 3:4])
    xs = (origin[0] + np.arange(cols, dtype=np.float32) + .5)[None, :]
    ys = (origin[1] + np.arange(rows, dtype=np.float32) + .5)[:, None]
    if reveal < 1:
        soft = max(look.get('soft', 0), .01)
        edge = reveal * (1 + soft)
        out = out * (1 - _smoothstep(edge - soft, edge, (xs - lx0) / lw))[..., None]
    if rise < 1:
        edge = rise * 1.02
        out = out * (1 - _smoothstep(edge - .02, edge, 1 - (ys - ly0) / lh))[..., None]
    if line >= 0:
        thick = max(2.0, .05 * lh)
        across = np.clip(line / 2 * lw - np.abs(xs - (lx0 + lx1) / 2) + .5, 0, 1)
        down = np.clip(np.minimum(ys - (ly1 - thick), ly1 - ys) + .5, 0, 1)
        alpha = (across * down)[..., None]
        out = np.concatenate([np.float32(line_colour) * alpha, alpha], -1) + out * (1 - alpha)
    return out.astype(np.float32)


def text_colour(text) -> tuple[float, float, float]:
    colour = text.color or '#ffffff'
    return tuple(int(colour[at:at + 2], 16) / 255 for at in (1, 3, 5))


def render_title_frames(text, picture: Path, size: tuple[int, int], fps: int, frames: int, target: Path, pin_at: PinAt | None = None,
                        should_cancel: Callable[[], bool] = lambda: False) -> Path:
    """`frames` frames of the title from its start, see-through, at `size`. Returns `target` (an ffv1 video with alpha)."""
    width, height = size
    rgba = np.asarray(Image.open(picture).convert('RGBA').resize((width, height), Image.BILINEAR), np.float32) / 255
    box = alpha_box((rgba[..., 3] * 255).astype(np.uint8))
    premultiplied = rgba.copy()
    premultiplied[..., :3] *= premultiplied[..., 3:4]
    depth = text.depth if text.depth and text.depth.amount > 0 else None
    shares = title3d.layers(depth)
    # Letter by letter: where each letter is, found once (title_letters.py), as the preview fetches it.
    lettered = None
    if box is not None and any(animation and animation.preset in LETTER_PRESETS for animation in (text.enter, text.exit)):
        from app.services.timeline_schema import Format
        from app.services.title_letters import letters_for
        labels, boxes = letters_for(text, Format(width=width, height=height, fps=fps))
        if boxes:
            lettered = (labels, boxes)
    colour = np.array([int(depth.color[at:at + 2], 16) / 255 for at in (1, 3, 5)], np.float32) if depth else None
    target.parent.mkdir(parents=True, exist_ok=True)
    process = subprocess.Popen([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{width}x{height}',
                                '-r', str(fps), '-i', '-', '-c:v', 'ffv1', '-pix_fmt', 'bgra', str(target)], stdin=subprocess.PIPE)
    try:
        assert process.stdin is not None
        for n in range(frames):
            if should_cancel():
                raise RuntimeError('Cancelled.')
            process.stdin.write(frame_at(text, n / fps, premultiplied, box, shares, depth, colour, size, pin_at(text.start + n / fps) if pin_at else None, lettered).tobytes())
        process.stdin.close()
        if process.wait(timeout=600):
            raise RuntimeError('Could not draw this 3D title.')
    except BaseException:
        process.kill()
        target.unlink(missing_ok=True)
        raise
    return target


def frame_at(text, local: float, premultiplied: np.ndarray, box, shares, depth, colour, size: tuple[int, int], pin, lettered=None) -> np.ndarray:
    """One frame of the title, 8-bit straight RGBA, as the preview's drawTitle3d draws it.

    Only the letters' box of the title picture is warped, and only into the part of the frame its corners reach: a
    title rarely covers much of the frame, and this keeps a 1080p frame to a few tens of milliseconds."""
    from app.services.timeline_schema import value_at
    width, height = size
    out = np.zeros((height, width, 4), np.uint8)
    if box is None:
        return out
    pose, look = title3d.pose_at(text, local)
    opacity = look['opacity'] * max(0.0, min(1.0, value_at(text.transform, 'opacity', local)))
    if opacity <= 0:
        return out
    letters = (box[0] * width, box[1] * height, box[2] * width, box[3] * height)
    frame_box = trick_bounds(text, letters, size)
    source = [(frame_box[0], frame_box[1]), (frame_box[2], frame_box[1]), (frame_box[2], frame_box[3]), (frame_box[0], frame_box[3])]
    x0, y0, x1, y1 = (round(v) for v in frame_box)
    crop = np.ascontiguousarray(premultiplied[y0:y1, x0:x1])
    if lettered is not None:
        labels, boxes = lettered
        middle, wide = (letters[0] + letters[2]) / 2, max(1.0, letters[2] - letters[0])
        looks = letter_looks(text.enter, text.exit, local, text.length, [((b[0] + b[2]) / 2 - middle) / wide for b in boxes])
        if any(look != LETTER_REST for look in looks):
            crop = moving_letters(crop, labels[y0:y1, x0:x1], boxes, looks, (x0, y0), letters)
    crop = picture_tricks(crop, look, (x0, y0), letters, text_colour(text))
    shift = np.array([[1, 0, x0], [0, 1, y0], [0, 0, 1]], np.float64)
    placed = []
    for index in range(len(shares) - 1, -1, -1):  # Back to front.
        try:
            target = title3d.corners(pose, frame_box, size, shares[index], depth.amount if depth else 0, pin, depth.angle if depth else title3d.DEFAULT_DEPTH_ANGLE)
            placed.append((index, target, np.array(title3d.homography(source, target), np.float64) @ shift))
        except ValueError:
            continue
    if not placed:
        return out
    blur = look['blur'] * height
    margin = 2 + (int(3 * blur) + 1 if blur > 0 else 0)
    xs = [x for _, target, _ in placed for x, _ in target]
    ys = [y for _, target, _ in placed for _, y in target]
    left, top = max(0, int(min(xs)) - margin), max(0, int(min(ys)) - margin)
    right, bottom = min(width, int(max(xs)) + margin + 1), min(height, int(max(ys)) + margin + 1)
    if right <= left or bottom <= top:
        return out
    region = np.zeros((bottom - top, right - left, 4), np.float32)
    offset = np.array([[1, 0, -left], [0, 1, -top], [0, 0, 1]], np.float64)
    for index, _, matrix in placed:
        layer = cv2.warpPerspective(crop, offset @ matrix, (right - left, bottom - top), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
        if index > 0 and depth is not None:
            # The sides: the letters' shape in the depth colour, darker further back (premultiplied, like the preview's mix).
            layer[..., :3] = layer[..., 3:4] * colour * title3d.layer_shade(depth, shares[index])
        region = layer * opacity + region * (1 - layer[..., 3:4] * opacity)
    if blur > 0:
        region = cv2.GaussianBlur(region, (0, 0), blur)
    alpha = region[..., 3:4]
    straight = np.where(alpha > 1e-4, region[..., :3] / np.maximum(alpha, 1e-4), 0)
    out[top:bottom, left:right] = np.clip(np.concatenate([straight, alpha], -1) * 255 + .5, 0, 255).astype(np.uint8)
    return out
