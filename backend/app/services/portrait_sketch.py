"""A small black-and-white line portrait from a real photograph, to credit a person (a lyricist, a singer) beside
their name: the face found by Apple Vision, drawn as clean ink lines on white, in a round frame with a thin warm rim.
Made from the photo itself, so it is the person's own likeness, never an invented one."""
from __future__ import annotations

from pathlib import Path

import numpy as np

SIDE = 1280


def face_box(photo: Path, image) -> tuple[int, int, int, int]:
    """The largest face as pixels (x, y, w, h); the upper middle when none is found."""
    height, width = image.shape[:2]
    try:
        from app.services.lamp_glow_service import faces_in
        faces = faces_in(photo)
    except Exception:
        faces = []
    if faces:
        x, y, w, h = max(faces, key=lambda face: face[2] * face[3])
        return int(x * width), int(y * height), int(w * width), int(h * height)
    side = min(width, height) // 2
    return (width - side) // 2, height // 5, side, side


def sketch(photo: Path, target: Path, framed: bool = True) -> Path:
    """framed: a white disc with a thin rim (for over pictures); otherwise only the ink lines, see-through around them
    (for a white or paper card)."""
    import cv2
    from PIL import Image, ImageOps
    image = cv2.cvtColor(np.asarray(ImageOps.exif_transpose(Image.open(photo)).convert('RGB')), cv2.COLOR_RGB2BGR)
    x, y, w, h = face_box(photo, image)
    # Head and shoulders: the face a little above the middle, room for hair and collar.
    cx, cy, half = x + w / 2, y + h * 0.62, max(w, h) * 1.55
    height, width = image.shape[:2]
    left, top = int(max(0, cx - half)), int(max(0, cy - half))
    right, bottom = int(min(width, cx + half)), int(min(height, cy + half))
    piece = image[top:bottom, left:right]
    crop = cv2.resize(piece, (SIDE, SIDE), interpolation=cv2.INTER_AREA if piece.shape[0] >= SIDE else cv2.INTER_LANCZOS4)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.fastNlMeansDenoising(gray, None, 7, 7, 21)  # An old print's grain would draw as specks.
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    smooth = cv2.bilateralFilter(gray, 15, 40, 15)
    # Pencil lines (colour dodge of the inverted blur), then cleaned to ink: dark lines, white paper.
    dodge = cv2.divide(smooth, 255 - cv2.GaussianBlur(255 - smooth, (0, 0), 18), scale=256).astype(np.float32)
    ink = np.where(dodge > 225, 255, dodge * 0.55)  # Paper stays clean white; strokes go darker.
    # The darkest parts (hair, glasses, moustache) filled in as solid ink, as an artist would.
    dark = cv2.GaussianBlur((gray < 55).astype(np.float32), (0, 0), 2.4)
    ink = ink * (1 - dark) + 25 * dark
    ink = cv2.GaussianBlur(ink.astype(np.uint8), (0, 0), 1.2)
    if not framed:
        # Only the ink: lines as dark as drawn, the paper see-through, soft at the edges so no square shows.
        yy, xx = np.mgrid[0:SIDE, 0:SIDE].astype(np.float32)
        fade = np.clip((1.0 - np.hypot(xx - SIDE / 2, yy - SIDE / 2) / (SIDE / 2)) * 1.8, 0, 1) ** 1.5  # Sinks softly into the wall.
        darkness = 255 - ink.astype(np.float32)
        alpha = (np.where(darkness < 45, 0, darkness) * fade).clip(0, 255)  # Faint grey from the old photo's paper is dropped.
        out = np.dstack([np.full_like(ink, 22), np.full_like(ink, 20), np.full_like(ink, 18), alpha.astype(np.uint8)]).astype(np.uint8)
        target.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(out, 'RGBA').save(target)
        return target
    # The round frame: white disc, a thin warm rim, see-through outside.
    yy, xx = np.mgrid[0:SIDE, 0:SIDE].astype(np.float32)
    r = np.hypot(xx - SIDE / 2, yy - SIDE / 2) / (SIDE / 2)
    rgb = np.stack([ink] * 3, axis=-1).astype(np.float32)
    rim = (r > 0.93) & (r <= 0.985)
    rgb[rim] = (98, 160, 196)  # Warm gold, as the titles (blue, green, red here).
    alpha = np.clip((0.995 - r) * 200, 0, 1) * 255
    out = np.dstack([rgb[..., 2], rgb[..., 1], rgb[..., 0], alpha]).astype(np.uint8)  # BGR to RGB, with alpha.
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out, 'RGBA').save(target)
    return target


def draw_on_card(photo: Path, paper: Path, target: Path, seconds: float, size: tuple[int, int] = (1920, 1080), place: tuple[float, float] = (0.3, 0.46),
                 height_share: float = 0.62, drawing: float = 2.6, fps: int = 30) -> Path:
    """A white card on which the person's ink portrait draws itself: the ink seeps into the paper stroke by stroke,
    darkest lines first, over `drawing` seconds, then holds. One video, so preview and export are the same."""
    import shutil
    import subprocess
    import tempfile
    import cv2
    from PIL import Image
    width, height = size
    with tempfile.TemporaryDirectory() as folder:
        ink_png = sketch(photo, Path(folder) / 'ink.png', framed=False)
        rgba = np.asarray(Image.open(ink_png).convert('RGBA'), np.float32) / 255
    side = int(height * height_share)
    alpha = cv2.resize(rgba[..., 3], (side, side), interpolation=cv2.INTER_AREA)
    ground = np.asarray(Image.open(paper).convert('RGB').resize((width, height)), np.float32) / 255
    x0, y0 = int(place[0] * width - side / 2), int(place[1] * height - side / 2)
    # When each bit of ink appears: dark strokes first, then lighter shading, broken up by a soft noise like ink
    # finding its way through paper fibres.
    rng = np.random.default_rng(11)
    noise = cv2.GaussianBlur(rng.random((side, side)).astype(np.float32), (0, 0), side / 60)
    noise = (noise - noise.min()) / (np.ptp(noise) or 1)
    order = np.clip(0.55 * (1 - alpha) + 0.45 * noise, 0, 1)
    ink_colour = np.array([0.086, 0.078, 0.07], np.float32)
    frames = max(2, round(seconds * fps))
    target.parent.mkdir(parents=True, exist_ok=True)
    process = subprocess.Popen([shutil.which('ffmpeg') or 'ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{width}x{height}', '-r', str(fps),
                                '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(target)], stdin=subprocess.PIPE)
    try:
        assert process.stdin is not None
        for n in range(frames):
            t = n / fps
            p = min(1.0, max(0.0, (t - 0.3) / drawing))
            front = p * 1.25  # The front of the ink sweeps past every point by the end.
            shown = alpha * np.clip((front - order) / 0.12, 0, 1)
            frame = ground.copy()
            region = frame[y0:y0 + side, x0:x0 + side]
            region[:] = region * (1 - shown[..., None]) + ink_colour * shown[..., None]
            process.stdin.write((frame * 255).astype(np.uint8).tobytes())
        process.stdin.close()
        if process.wait():
            raise RuntimeError('Could not make the signature card.')
    finally:
        if process.poll() is None:
            process.kill()
    return target
