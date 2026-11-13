"""Variety for lyric-video pictures, made on this Mac at no cost: slow camera moves that never repeat back to back,
one picture cut into a wide, a medium and a close shot, and painted versions of a picture (watercolour, pencil, oil,
dream) made with image filters instead of an AI. Used by the lyric builder."""
from __future__ import annotations

import random
from pathlib import Path

# Slow camera moves over a scene, as (start, end) of x, y, scale and rotation. Every one starts and ends at rest so a
# scene of any length reads as one smooth glide; "strong" ones are kept for the chorus.
MOVES: dict[str, dict] = {
    'pan-left': {'x': (0.535, 0.465), 'scale': (1.08, 1.08)},
    'pan-right': {'x': (0.465, 0.535), 'scale': (1.08, 1.08)},
    'zoom-in': {'scale': (1.0, 1.12)},
    'zoom-out': {'scale': (1.12, 1.0)},
    'tilt-up': {'y': (0.53, 0.47), 'scale': (1.08, 1.08)},
    'tilt-down': {'y': (0.47, 0.53), 'scale': (1.08, 1.08)},
    'drift-up-left': {'x': (0.53, 0.47), 'y': (0.52, 0.48), 'scale': (1.06, 1.12)},
    'drift-down-right': {'x': (0.47, 0.53), 'y': (0.48, 0.52), 'scale': (1.12, 1.06)},
    'turn-in': {'scale': (1.04, 1.14), 'rotation': (-1.2, 0.6)},
    'turn-out': {'scale': (1.14, 1.04), 'rotation': (0.8, -0.8)},
    'reveal': {'scale': (1.25, 1.02)},
    'push': {'scale': (1.0, 1.2)},
}
STRONG = {'reveal', 'push', 'turn-in', 'turn-out'}
# Moves gentle enough for into_clear, where lyrics sit in a space measured on the still picture: at most a few
# per cent, about the centre, so people stay where the words expect them.
GENTLE: dict[str, dict] = {
    'breathe-in': {'scale': (1.0, 1.045)},
    'breathe-out': {'scale': (1.045, 1.0)},
    'nudge-left': {'x': (0.508, 0.492), 'scale': (1.03, 1.03)},
    'nudge-right': {'x': (0.492, 0.508), 'scale': (1.03, 1.03)},
}


def pick(count: int, strong_at: set[int] = frozenset(), seed: int = 7, moves: dict[str, dict] = MOVES) -> list[str]:
    """`count` move names: none used again within three scenes, strong ones where `strong_at` asks (the chorus)."""
    rng = random.Random(seed)
    names = list(moves)
    chosen: list[str] = []
    for index in range(count):
        recent = set(chosen[-3:])
        wanted = [name for name in names if name not in recent and ((name in STRONG) == (index in strong_at) or moves is not MOVES)]
        chosen.append(rng.choice(wanted or [name for name in names if name not in recent] or names))
    return chosen


def keys(move: dict, length: float, ease: str = 'easeInOut') -> dict:
    """A clip transform doing `move` over `length` seconds."""
    rest = {'x': 0.5, 'y': 0.5, 'scale': 1.0, 'rotation': 0.0}
    frames = {name: [{'t': 0, 'v': round(a, 4), 'ease': ease}, {'t': round(length, 3), 'v': round(b, 4), 'ease': ease}] for name, (a, b) in move.items() if a != b}
    start = {name: move[name][0] if name in move else value for name, value in rest.items()}
    return {**start, 'opacity': 1, 'keyframes': frames}


def at(move: dict, share: float) -> dict:
    """Where a linear `move` is, `share` (0..1) of the way through."""
    return {name: a + (b - a) * share for name, (a, b) in move.items()}


def chorus_lines(texts: list[str]) -> set[str]:
    """Lines sung more than once: the chorus."""
    seen: dict[str, int] = {}
    for text in texts:
        key = ' '.join(text.split()).strip(' .,!?…').lower()
        seen[key] = seen.get(key, 0) + 1
    return {key for key, count in seen.items() if count > 1 and key}


# --- One picture, three shots ---

SHOT_MIN = 7.0  # A scene shorter than this stays one shot; one of 7 s or more becomes two, 12 s or more three.


def focus(picture: Path) -> tuple[float, float]:
    """Where the eye goes in a picture, as shares: the largest face (Apple Vision finds side-on faces too), otherwise
    Vision's most eye-catching region, otherwise the largest face OpenCV finds (on a computer without Vision),
    otherwise the upper-middle, where people's faces and horizons usually are."""
    return focus_points(picture)[0]


def focus_points(picture: Path) -> list[tuple[float, float]]:
    """Every clear face, largest first (up to three), so a long scene's close shots can go from one person to the
    next; one point when there is no face."""
    seen = vision_focus(picture)
    return seen if seen is not None else [opencv_focus(picture)]


def vision_focus(picture: Path) -> list[tuple[float, float]] | None:
    import json
    import subprocess
    try:
        from app.services.cutout_service import helper
        tool = helper(Path(__file__).resolve().parents[1] / 'native' / 'focus_points.swift')
        found = json.loads(subprocess.run([str(tool), str(picture)], capture_output=True, text=True, timeout=60, check=True).stdout)
    except Exception:  # No Vision here (not a Mac, no command line tools): the OpenCV finder takes over.
        return None
    faces = [face for face in found.get('faces') or [] if face[4] >= 0.5 and face[2] * face[3] >= 0.0004]
    if faces:
        largest = sorted(faces, key=lambda face: -face[2] * face[3])
        # A face much smaller than the main one is a passer-by, not a second lead.
        return [(x + w / 2, y + h / 2) for x, y, w, h, _ in largest[:3] if w * h >= largest[0][2] * largest[0][3] * 0.25]
    if found.get('salient'):
        x, y, w, h = found['salient']
        return [(x + w / 2, y + min(h / 2, h * 0.35))]  # Toward the top of what stands out: a head more often than feet.
    return [(0.5, 0.4)]


def opencv_focus(picture: Path) -> tuple[float, float]:
    import cv2
    image = cv2.imread(str(picture), cv2.IMREAD_GRAYSCALE)
    if image is None:
        return 0.5, 0.4
    shrink = 1600 / max(image.shape)
    small = cv2.resize(image, None, fx=shrink, fy=shrink) if shrink < 1 else image
    finder = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    found = finder.detectMultiScale(small, scaleFactor=1.1, minNeighbors=8, minSize=(max(20, small.shape[1] // 60),) * 2)
    # Faces in leaves and bark are found too: keep ones away from the edges, and trust only clear ones.
    height, width = small.shape
    found = [box for box in found if 0.08 * width < box[0] + box[2] / 2 < 0.92 * width and 0.06 * height < box[1] + box[3] / 2 < 0.8 * height]
    if not found:
        return 0.5, 0.4
    x, y, w, h = max(found, key=lambda box: box[2] * box[3])
    return (x + w / 2) / small.shape[1], (y + h / 2) / small.shape[0]


SHOT_LONGEST = 10.0  # A long scene keeps cutting, wide, medium, close, medium, wide..., about this often.
TIERS = (None, 1.35, 1.7, 1.35)  # The zoom of each shot in turn; None is the whole picture.


def shot_lengths(seconds: float) -> list[float]:
    count = 1 if seconds < SHOT_MIN else 2 if seconds < 12 else max(3, round(seconds / SHOT_LONGEST))
    return [seconds / count] * count


def framed(point: tuple[float, float], zoom: float) -> tuple[float, float]:
    """The clip centre that puts `point` (picture shares) as near the frame's middle as a `zoom` allows without edges."""
    # Moving the clip by d shows the picture point 0.5 - d / zoom at the frame centre; the edge stays hidden while
    # |d| <= (zoom - 1) / 2.
    room = (zoom - 1) / 2
    return tuple(round(0.5 + max(-room, min(room, (0.5 - p) * zoom)), 4) for p in point)  # type: ignore[return-value]


VERSE_SHOT = 9.0  # Seconds a shot lasts in a verse: slow, so the words and the picture can be taken in.
CHORUS_SHOT = 5.0  # In the chorus the cuts come quicker.
SHORTEST_SHOT = 3.0
BEAT_REACH = 1.2  # A cut moves at most this far to land on a beat.


def chorus_spans(lines: list[dict], gap: float = 6.0) -> list[tuple[float, float]]:
    """When the chorus is sung: runs of two or more lines that are each sung more than once in the song."""
    chorus = chorus_lines([line['text'] for line in lines])
    spans: list[list[float]] = []
    count = 0
    for line in sorted(lines, key=lambda line: line['start']):
        if ' '.join(line['text'].split()).strip(' .,!?…').lower() not in chorus:
            continue
        end = line['start'] + line.get('length', 0)
        if spans and line['start'] - spans[-1][1] <= gap:
            spans[-1][1] = end; count += 1
        else:
            if spans and count < 2:
                spans.pop()
            spans.append([line['start'], end]); count = 1
    if spans and count < 2:
        spans.pop()
    return [(round(a, 3), round(b, 3)) for a, b in spans]


def cut_lengths(start: float, length: float, beats: list[float] | None = None, chorus: list[tuple[float, float]] | None = None) -> list[float]:
    """Where a scene's shots change: about every VERSE_SHOT seconds, every CHORUS_SHOT in the chorus, each cut moved
    onto the nearest beat when one is close."""
    end = start + length
    if length < SHOT_MIN:
        return [length]
    # A shot that would run into the chorus is already a chorus shot, so the quicker cuts start with it.
    in_chorus = lambda t: any(t < b and a < t + VERSE_SHOT * 0.6 for a, b in chorus or [])
    cuts, at = [], start
    while True:
        target = at + (CHORUS_SHOT if in_chorus(at) else VERSE_SHOT)
        near = min(beats or [], key=lambda beat: abs(beat - target), default=None)
        if near is not None and abs(near - target) <= BEAT_REACH:
            target = near
        if end - target < SHORTEST_SHOT + 0.5:
            break
        cuts.append(target); at = target
    edges = [start, *cuts, end]
    return [round(b - a, 3) for a, b in zip(edges, edges[1:])]


def chorus_looks(timeline: dict, spans: list[tuple[float, float]]) -> None:
    """Each return of the chorus looks a little different: the first as it is, then golden, then like film, then vivid."""
    looks = [None, 'warm', 'film', 'vivid']
    for clip in timeline['layers'][0]['items']:
        if not clip['id'].startswith('lyric-scene-') or clip.get('look') not in (None, 'none'):
            continue
        middle = clip['start'] + (clip['out'] - clip['in']) / clip.get('speed', 1) / 2
        turn = next((number for number, (a, b) in enumerate(spans) if a <= middle < b), None)
        if turn:
            clip['look'] = looks[min(turn, len(looks) - 1)]


def shots(timeline: dict, focus_of: dict[int, tuple[float, float] | list[tuple[float, float]]], painted: dict[int, list[int]] | None = None, seed: int = 7,
          beats: list[float] | None = None, chorus: list[tuple[float, float]] | None = None) -> None:
    """Cuts each long picture scene on the main track into a wide, a medium and a close shot of the same picture, each
    with its own slow move, joined by a soft blur. painted: picture media id -> painted versions; every other scene's
    middle shot shows one of them, so the same picture also changes look."""
    main = timeline['layers'][0]
    out: list[dict] = []
    turn = 0
    for clip in main['items']:
        length = (clip['out'] - clip['in']) / clip.get('speed', 1)
        if not clip['id'].startswith('lyric-scene-') or length < SHOT_MIN:
            out.append(clip)
            continue
        points = focus_of.get(clip['media_id']) or [(0.5, 0.4)]
        points = [points] if isinstance(points[0], (int, float)) else points
        pieces = cut_lengths(clip['start'], length, beats, chorus) if beats is not None or chorus is not None else shot_lengths(length)
        at_in = clip['in']
        for number, piece in enumerate(pieces):
            shot = {**clip, 'id': clip['id'] if number == 0 else f"{clip['id']}-{number + 1}", 'start': round(clip['start'] + sum(pieces[:number]), 3),
                    'in': round(at_in, 3), 'out': round(at_in + piece * clip.get('speed', 1), 3)}
            at_in += piece * clip.get('speed', 1)
            # The scene's own way in and out belong to its first and last shot.
            if number:
                shot.pop('enter', None)
            if number < len(pieces) - 1:
                shot.pop('exit', None); shot.pop('echo', None); shot['fade_out'] = 0
            if number:
                shot['transition_in'] = {'kind': 'cross-blur', 'duration': 0.8}
                zoom = 1.45 if len(pieces) == 2 else TIERS[number % len(TIERS)]
                if zoom:
                    shot['shot'] = zoom
                # Paintings: every other scene's first medium shot, and in a long scene every second medium shot.
                versions = (painted or {}).get(clip['media_id']) or []
                if versions and zoom == 1.35 and (number % 4 == 3 or turn % 2 == 0) and (number // 2) % 2 == (0 if turn % 2 == 0 else 1):
                    shot['media_id'] = versions[(turn // 2 + number // 4) % len(versions)]
            shot['focus'] = points[(number // 4) % len(points)]  # Each round of wide, medium, close, medium turns to the next face.
            out.append(shot)
        turn += 1
    main['items'] = out


def shot_move(clip: dict, move: dict) -> dict:
    """A move on a medium or close shot: zoomed in on the focus point, the move kept small around it."""
    zoom = clip.pop('shot', None)
    point = clip.pop('focus', None)
    if not zoom or not point:
        return move
    cx, cy = framed(point, zoom)
    scaled = {name: (a / 1.08 * zoom, b / 1.08 * zoom) if name == 'scale' else (cx + (a - 0.5) * 0.5, cx + (b - 0.5) * 0.5) if name == 'x'
              else (cy + (a - 0.5) * 0.5, cy + (b - 0.5) * 0.5) if name == 'y' else (a, b) for name, (a, b) in move.items()}
    scaled.setdefault('x', (cx, cx)); scaled.setdefault('y', (cy, cy))
    if 'scale' not in move:
        scaled['scale'] = (zoom, zoom)
    # At its smallest the shot still hides every edge: x and y stay within what that scale allows.
    room = max(0.0, (min(scaled['scale']) - 1) / 2 - 0.0001)
    for name in ('x', 'y'):
        scaled[name] = tuple(round(max(0.5 - room, min(0.5 + room, value)), 4) for value in scaled[name])
    return scaled


# --- Painted versions ---

PAINTS = ('watercolour', 'pencil', 'oil', 'dream')


def paint(picture: Path, style: str):
    """The picture as a painting, made with filters (no AI, a second or two). Returns a BGR image."""
    import cv2
    import numpy as np
    image = cv2.imread(str(picture), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f'Could not read {picture.name}.')
    shrink = 1920 / max(image.shape[:2])
    if shrink < 1:
        image = cv2.resize(image, None, fx=shrink, fy=shrink, interpolation=cv2.INTER_AREA)
    rng = np.random.default_rng(3)
    paper = cv2.GaussianBlur(rng.normal(0, 1, image.shape[:2]).astype(np.float32), (0, 0), 1.2)
    def saturate(img, amount):
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[..., 1] = np.clip(hsv[..., 1] * amount, 0, 255)
        return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

    def lift(img, floor):  # Raise the darks, as paint on paper never goes fully black.
        return (floor + img.astype(np.float32) * (255 - floor) / 255).astype(np.uint8)

    if style == 'watercolour':
        # Flat washes of colour, darker where a wash dries at its edge, bright paper showing through.
        flat = image
        for _ in range(2):
            flat = cv2.bilateralFilter(flat, 9, 40, 9)
        flat = cv2.pyrMeanShiftFiltering(flat, 12, 28)
        washed = saturate(lift(flat, 38), 1.25).astype(np.float32)
        gray = cv2.cvtColor(flat, cv2.COLOR_BGR2GRAY)
        rims = cv2.GaussianBlur(cv2.Canny(gray, 30, 90), (0, 0), 1.6).astype(np.float32) / 255
        bloom = cv2.GaussianBlur(washed, (0, 0), 3)
        out = (0.7 * washed + 0.3 * bloom) * (1 - 0.35 * rims[..., None])
        grain = cv2.GaussianBlur(rng.normal(0, 1, image.shape[:2]).astype(np.float32), (0, 0), 3)
        out = out * (1 + 0.05 * grain[..., None]) + paper[..., None] * 5
    elif style == 'pencil':
        # Coloured pencil: the picture's colours, softened, drawn over with graphite strokes.
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        sketch = cv2.divide(gray, 255 - cv2.GaussianBlur(255 - gray, (0, 0), 6), scale=256)
        sketch = cv2.GaussianBlur(sketch, (0, 0), 0.6).astype(np.float32) / 255
        colour = lift(saturate(cv2.bilateralFilter(image, 9, 60, 9), 1.1), 30).astype(np.float32)
        out = colour * (0.35 + 0.65 * sketch[..., None]) + paper[..., None] * 7
    elif style == 'oil':
        # Thick strokes: colours pooled by a median, smoothed along edges, a touch of canvas.
        strokes = cv2.medianBlur(cv2.bilateralFilter(image, 7, 50, 7), 7)
        out = saturate(cv2.edgePreservingFilter(strokes, flags=cv2.NORMCONV_FILTER, sigma_s=25, sigma_r=0.3), 1.2).astype(np.float32)
        canvas = cv2.GaussianBlur(rng.normal(0, 1, image.shape[:2]).astype(np.float32), (0, 0), 0.8)
        out = out * (1 + 0.04 * canvas[..., None])
    elif style == 'dream':
        # A soft glow (screen blend), lifted shadows and a pastel tint.
        glow = cv2.GaussianBlur(image, (0, 0), 14).astype(np.float32) / 255
        base = image.astype(np.float32) / 255
        screened = 1 - (1 - base) * (1 - glow * 0.75)
        tint = np.array([1.04, 0.97, 1.06], np.float32)  # BGR: a little lilac.
        out = saturate(np.clip(screened * tint * 255, 0, 255).astype(np.uint8), 0.8)
        out = lift(out, 22).astype(np.float32)
    else:
        raise ValueError(f'No paint style called {style}.')
    return np.clip(out, 0, 255).astype(np.uint8)
