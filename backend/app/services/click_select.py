"""Click to choose: MobileSAM (Acly's ONNX export, MIT) outlines whatever is clicked in a picture: a person, a rock, a
tree, a pole, a building. Clicks can add to the outline or take away from it. The picture is read once (about 0.5 s on
an M1 Pro) and kept; each click is then about 0.03 s.

The outline is saved where Remove person or object looks for its choices (kind 'clicks', one choice), so the same
fill, on this Mac or by the AI service, takes it from there.
"""
import threading
from pathlib import Path

import numpy as np
from PIL import Image

from app.services.media_service import get_media

FOLDER = Path(__file__).resolve().parents[2] / '.models' / 'mobilesam'
ENCODER = FOLDER / 'mobile_sam_image_encoder.onnx'
DECODER = FOLDER / 'sam_mask_decoder_single.onnx'
SIDE = 1024  # The model reads pictures at most this big on the longer side.
TINT = np.array([255, 60, 140])
_sessions: dict = {}
_read: dict[str, tuple] = {}  # Picture path -> (embedding, size): the last few pictures read.
_lock = threading.Lock()


def available() -> bool:
    return ENCODER.is_file() and DECODER.is_file()


def _session(path: Path):
    with _lock:
        if path not in _sessions:
            import onnxruntime
            _sessions[path] = onnxruntime.InferenceSession(str(path), providers=['CPUExecutionProvider'])
        return _sessions[path]


def _small(picture: Path) -> Image.Image:
    with Image.open(picture) as opened:
        image = opened.convert('RGB')
    scale = SIDE / max(image.size)
    # Always exactly SIDE on the longer side: the model is lost on a smaller picture (it reads clicks on that scale).
    return image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS) if scale != 1 else image


def _embedding(picture: Path, encoder=None):
    key = str(picture)
    if key not in _read:
        small = _small(picture)
        run = encoder or (lambda pixels: _session(ENCODER).run(None, {'input_image': pixels})[0])
        _read[key] = (run(np.asarray(small).astype(np.float32)), small.size)
        while len(_read) > 4:
            _read.pop(next(iter(_read)))
    return _read[key]


def mask_at(picture: Path, points: list[dict], encoder=None, decoder=None) -> np.ndarray:
    """What the clicks pick out of `picture`, as a mask the size of the picture the model read (at most SIDE)."""
    embedding, (width, height) = _embedding(picture, encoder)
    coords = np.array([[[p['x'] * width, p['y'] * height] for p in points] + [[0, 0]]], np.float32)
    labels = np.array([[1 if p.get('keep', True) else 0 for p in points] + [-1]], np.float32)
    inputs = {'image_embeddings': embedding, 'point_coords': coords, 'point_labels': labels, 'mask_input': np.zeros((1, 1, 256, 256), np.float32),
              'has_mask_input': np.zeros(1, np.float32), 'orig_im_size': np.array([height, width], np.float32)}
    masks = (decoder or (lambda feed: _session(DECODER).run(None, feed)[0]))(inputs)
    return masks[0, 0] > 0


def outline(media_id: int, points: list[dict], encoder=None, decoder=None) -> dict:
    """`points`: [{x, y, keep}], x and y shares of the picture; keep false takes that area away. Saves the outline as
    Remove's 'clicks' choice and returns how much of the picture it covers and a tinted preview."""
    from app.services import remove_person
    item = dict(get_media(media_id))
    if item['media_type'] != 'image':
        raise ValueError('Click to choose works on pictures.')
    if not points:
        raise ValueError('Click on what to remove.')
    picture = Path(item['absolute_path'])
    mask = mask_at(picture, points, encoder, decoder)
    folder = remove_person._folder(picture, 'clicks')
    folder.mkdir(parents=True, exist_ok=True)
    Image.fromarray(mask.astype(np.uint8) * 255).save(folder / 'person-1.png')
    preview = np.asarray(_small(picture)).copy()
    preview[mask] = (preview[mask] * 0.45 + TINT * 0.55).astype(np.uint8)
    Image.fromarray(preview).save(folder / 'preview.jpg', quality=88)
    return {'area': round(float(mask.mean()), 4), 'preview': f'/api/photos/{media_id}/people/preview?kind=clicks'}


def refine(media_id: int, start: dict | None, edits: list[dict], encoder=None, decoder=None) -> dict:
    """Fix the selection: begin from what was found (`start`: {kind: 'people' | 'objects', numbers}) or from nothing,
    then each click in turn adds the region it lands on (`add` true) or takes it away, and each brush stroke (`stroke`:
    [[x, y]...], `radius`) paints exactly where it goes. Saved as Remove's and Pop-out's
    'clicks' choice, with a tinted preview, like outline()."""
    from app.services import remove_person
    item = dict(get_media(media_id))
    if item['media_type'] != 'image':
        raise ValueError('Fixing the selection works on pictures.')
    picture = Path(item['absolute_path'])
    width, height = _small(picture).size
    chosen = np.zeros((height, width), bool)
    if start and start.get('numbers'):
        folder = remove_person._folder(picture, start['kind'])
        for number in start['numbers']:
            path = folder / f'person-{number}.png'
            if not path.exists():
                raise ValueError('Look again: that one was not found.')
            with Image.open(path) as found:
                chosen |= np.asarray(found.convert('L').resize((width, height), Image.NEAREST)) > 127
    for edit in edits:
        if edit.get('stroke'):
            # Brush: a painted line, `radius` a share of the picture's shorter side.
            import cv2
            region = np.zeros((height, width), np.uint8)
            points = np.array([[round(x * width), round(y * height)] for x, y in edit['stroke']], np.int32)
            thick = max(1, round(edit.get('radius', 0.02) * min(width, height)))
            if len(points) == 1:
                cv2.circle(region, tuple(int(v) for v in points[0]), thick, 1, -1, cv2.LINE_AA)
            else:
                cv2.polylines(region, [points], False, 1, thick * 2, cv2.LINE_AA)
            region = region.astype(bool)
            chosen = chosen | region if edit.get('add', True) else chosen & ~region
            continue
        region = mask_at(picture, [{'x': edit['x'], 'y': edit['y'], 'keep': True}], encoder, decoder)
        if region.shape != chosen.shape:
            region = np.asarray(Image.fromarray(region.astype(np.uint8) * 255).resize((width, height), Image.NEAREST)) > 127
        chosen = chosen | region if edit.get('add', True) else chosen & ~region
    folder = remove_person._folder(picture, 'clicks')
    folder.mkdir(parents=True, exist_ok=True)
    Image.fromarray(chosen.astype(np.uint8) * 255).save(folder / 'person-1.png')
    preview = np.asarray(_small(picture)).copy()
    preview[chosen] = (preview[chosen] * 0.45 + TINT * 0.55).astype(np.uint8)
    Image.fromarray(preview).save(folder / 'preview.jpg', quality=88)
    return {'area': round(float(chosen.mean()), 4), 'preview': f'/api/photos/{media_id}/people/preview?kind=clicks'}
