"""Pop-out (3D): a picture split into two real layers, so they can move differently and the picture gains depth.

- The person (or thing, or clicked outline: Remove's same choices) as a cut-out: the original pixels with a soft alpha.
- The background: the same picture with them removed and the place filled on this Mac (LaMa, local_fill.py), so there
  is a real, complete scene behind them; when the person grows, shrinks or drifts nothing tears or stretches.
Both are new pictures the size of the original; the original is never changed. The editor lays them as two clips
and gives each its own move (frontend timeline/popout.ts).
"""
import uuid
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from app.core.config import settings
from app.services import local_fill, remove_person
from app.services.job_service import JobCancelled, update_job
from app.services.media_service import get_media, index_media
from app.services.render_queue_service import enqueue_render

EDGE = 0.0015  # Of the short side: the cut-out's soft edge, so it sits in the scene without a hard line.


def cutout(original: Image.Image, picture: Path, numbers: list[int], kind: str) -> tuple[Image.Image, dict]:
    """The chosen ones on a transparent picture, and where they stand (shares of the picture: centre, top, bottom)."""
    folder = remove_person._folder(picture, kind)
    union = None
    for number in numbers:
        path = folder / f'person-{number}.png'
        if not path.exists():
            raise ValueError('Look again: that one was not found.')
        mask = np.asarray(Image.open(path).convert('L')) > 127
        union = mask if union is None else union | mask
    if union is None or not union.any():
        raise ValueError('Choose who (or what) pops out.')
    ys, xs = np.nonzero(union)
    h, w = union.shape
    where = {'x': round(float(xs.mean() / w), 4), 'top': round(float(ys.min() / h), 4), 'bottom': round(float((ys.max() + 1) / h), 4),
             'left': round(float(xs.min() / w), 4), 'right': round(float((xs.max() + 1) / w), 4)}
    alpha = Image.fromarray(union.astype(np.uint8) * 255).resize(original.size, Image.BILINEAR)
    alpha = alpha.filter(ImageFilter.GaussianBlur(max(0.6, min(original.size) * EDGE)))
    person = original.convert('RGBA')
    person.putalpha(alpha)
    return person, where


def start(media_id: int, numbers: list[int], kind: str = 'people') -> str:
    item = dict(get_media(media_id))
    if item['media_type'] != 'image':
        raise ValueError('Pop-out works on pictures.')
    if kind not in remove_person.KINDS:
        raise ValueError('Choose people, things or a clicked outline.')
    if not numbers:
        raise ValueError('Choose who (or what) pops out.')
    if not local_fill.available():
        raise ValueError('Pop-out needs the fill model: run ./install-fill.sh in the Kanaa folder.')
    source = Path(item['absolute_path'])
    name = Path(item.get('filename') or 'picture').stem[:60]
    with Image.open(source) as opened:
        size = opened.size
    remove_person.chosen_mask(source, numbers, size, kind)  # Checks the choice before queueing.

    def run(should_cancel):
        update_job(job_id, phase='Cutting out and filling behind', progress=15)
        with Image.open(source) as opened:
            original = opened.convert('RGB')
        person, where = cutout(original, source, numbers, kind)
        mask = remove_person.chosen_mask(source, numbers, original.size, kind)
        background = remove_person.blend(original, local_fill.fill(original, mask), mask)
        if should_cancel():
            raise JobCancelled()
        made, ids = [], {}
        try:
            for label, image, suffix in (('background', background, 'background'), ('person', person, 'cut-out')):
                target = settings.data_dir / 'media' / f'popout-{label}-{uuid.uuid4().hex}.png'
                target.parent.mkdir(parents=True, exist_ok=True)
                image.save(target)
                made.append(target)
                ids[label] = index_media(target, f'{name} ({suffix}).png', folder=item.get('folder'))['id']
        except BaseException:
            for path in made:
                path.unlink(missing_ok=True)
            raise
        return {'progress': 100, 'background_id': ids['background'], 'person_id': ids['person'], 'where': where}

    job_id = enqueue_render('ai_edit', f'Pop-out · {name}', run, total=100)
    return job_id
