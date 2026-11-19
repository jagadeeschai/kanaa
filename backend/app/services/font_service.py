"""Your own fonts: a .ttf or .otf added once is kept in Kanaa's data folder (nothing is installed on the Mac) and
offered beside the built-in ones. Titles are drawn through libass from one fonts folder that holds both, so the preview,
the GPU and FFmpeg all draw the same letters."""
from __future__ import annotations

import hashlib
import io
import re
import threading
from pathlib import Path

from fontTools.ttLib import TTFont

from app.core.config import settings
from app.services.video_edit_service import LYRIC_FONTS_DIR

MAX_BYTES = 30 * 1024 * 1024
TAMIL_LETTER = 0x0B95  # க
_lock = threading.Lock()


def own_dir() -> Path:
    return settings.data_dir / 'fonts'


def _family(font: TTFont) -> str:
    names = font['name']
    for name_id in (16, 1):  # The typographic family, else the plain family.
        for record in names.names:
            if record.nameID == name_id:
                try:
                    text = record.toUnicode()
                except UnicodeDecodeError:
                    continue
                cleaned = ' '.join(re.sub(r'[^A-Za-z0-9 ]', ' ', text).split())[:40]
                if cleaned:
                    return cleaned
    raise ValueError('This font has no usable name.')


def describe(path: Path) -> dict:
    font = TTFont(str(path), lazy=True)
    cmap = font.getBestCmap() or {}
    return {'family': _family(font), 'file': path.name, 'tamil': TAMIL_LETTER in cmap, 'latin': ord('A') in cmap}


def add_font(filename: str, data: bytes) -> dict:
    suffix = Path(filename).suffix.lower()
    if suffix not in ('.ttf', '.otf'):
        raise ValueError('Add a .ttf or .otf font file.')
    if len(data) > MAX_BYTES:
        raise ValueError('That font file is too large.')
    try:
        font = TTFont(io.BytesIO(data), lazy=True)
        family = _family(font)
        cmap = font.getBestCmap() or {}
    except ValueError:
        raise
    except Exception:
        raise ValueError('That file is not a font Kanaa can read.') from None
    if not cmap:
        raise ValueError('That font has no letters Kanaa can use.')
    bundled = {describe(path)['family'] for path in LYRIC_FONTS_DIR.glob('*.ttf')}
    if family in bundled:
        raise ValueError(f'Kanaa already has {family}.')
    folder = own_dir()
    folder.mkdir(parents=True, exist_ok=True)
    for other in folder.glob('*'):
        if other.suffix.lower() in ('.ttf', '.otf') and describe(other)['family'] == family:
            other.unlink()  # A newer file of the same family replaces it.
    target = folder / f"{family.replace(' ', '')}-{hashlib.sha256(data).hexdigest()[:8]}{suffix}"
    target.write_bytes(data)
    return describe(target)


def own_fonts() -> list[dict]:
    folder = own_dir()
    found = []
    for path in sorted(folder.glob('*')) if folder.is_dir() else []:
        if path.suffix.lower() in ('.ttf', '.otf'):
            try:
                found.append(describe(path))
            except Exception:
                continue
    return found


def remove_font(name: str) -> None:
    target = own_dir() / name
    if Path(name).name != name or not target.is_file():
        raise ValueError('No such font.')
    target.unlink()


def font_file(name: str) -> Path | None:
    """A font the editor may load by file name: bundled, or one of yours."""
    if Path(name).name != name or Path(name).suffix.lower() not in ('.ttf', '.otf'):
        return None
    for folder in (LYRIC_FONTS_DIR, own_dir()):
        if (folder / name).is_file():
            return folder / name
    return None


def fonts_dir() -> Path:
    """One folder holding the bundled fonts and yours (as links), for libass's fontsdir."""
    folder = settings.data_dir / 'cache' / 'fonts-all'
    wanted = {path.name: path for path in LYRIC_FONTS_DIR.glob('*.ttf')}
    if own_dir().is_dir():
        wanted.update({path.name: path for path in own_dir().glob('*') if path.suffix.lower() in ('.ttf', '.otf')})
    with _lock:
        folder.mkdir(parents=True, exist_ok=True)
        present = {path.name for path in folder.iterdir()}
        for name in present - set(wanted):
            (folder / name).unlink()
        for name in set(wanted) - present:
            (folder / name).symlink_to(wanted[name])
    return folder
