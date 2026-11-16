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
    return image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS) if scale < 1 else image


def _embedding(picture: Path, encoder=None):
    key = str(picture)
    if key not in _read:
        small = _small(picture)
        run = encoder or (lambda pixels: _session(ENCODER).run(None, {'input_image': pixels})[0])
        _read[key] = (run(np.asarray(small).astype(np.float32)), small.size)
        while len(_read) > 4:
            _read.pop(next(iter(_read)))
    return _read[key]


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
    embedding, (width, height) = _embedding(picture, encoder)
    coords = np.array([[[p['x'] * width, p['y'] * height] for p in points] + [[0, 0]]], np.float32)
    labels = np.array([[1 if p.get('keep', True) else 0 for p in points] + [-1]], np.float32)
    inputs = {'image_embeddings': embedding, 'point_coords': coords, 'point_labels': labels, 'mask_input': np.zeros((1, 1, 256, 256), np.float32),
              'has_mask_input': np.zeros(1, np.float32), 'orig_im_size': np.array([height, width], np.float32)}
    masks = (decoder or (lambda feed: _session(DECODER).run(None, feed)[0]))(inputs)
    mask = masks[0, 0] > 0
    folder = remove_person._folder(picture, 'clicks')
    folder.mkdir(parents=True, exist_ok=True)
    Image.fromarray(mask.astype(np.uint8) * 255).save(folder / 'person-1.png')
    preview = np.asarray(_small(picture)).copy()
    preview[mask] = (preview[mask] * 0.45 + TINT * 0.55).astype(np.uint8)
    Image.fromarray(preview).save(folder / 'preview.jpg', quality=88)
    return {'area': round(float(mask.mean()), 4), 'preview': f'/api/photos/{media_id}/people/preview?kind=clicks'}
