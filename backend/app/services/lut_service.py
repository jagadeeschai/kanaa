"""Read-only library for standard .cube LUT packs and small preview atlases for WebGL."""
from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path

import numpy as np
from PIL import Image

from app.core.config import settings

SOURCE = Path(os.getenv('KANAA_LUT_DIR', str(Path.home() / 'Documents' / 'CUBE')))


def _id(path: Path) -> str:
    slug = re.sub(r'[^a-z0-9]+', '-', path.stem.lower()).strip('-')[:48]
    return f'{slug}-{hashlib.sha256(str(path).encode()).hexdigest()[:8]}'


def library() -> list[dict]:
    if not SOURCE.is_dir():
        return []
    return [{'id': _id(path), 'name': path.stem} for path in sorted(SOURCE.rglob('*'), key=lambda item: item.stem.lower()) if path.is_file() and path.suffix.lower() == '.cube']


def resolve(identifier: str) -> Path:
    found = next((path for path in SOURCE.rglob('*') if path.is_file() and path.suffix.lower() == '.cube' and _id(path) == identifier), None) if SOURCE.is_dir() else None
    if found is None:
        raise ValueError('That LUT is no longer in your LUT folder.')
    return found


def read(identifier: str) -> tuple[int, np.ndarray]:
    path = resolve(identifier)
    size = 0
    rows: list[list[float]] = []
    with path.open(errors='replace') as source:
        for line in source:
            clean = line.strip()
            if clean.startswith('LUT_3D_SIZE'):
                size = int(clean.split()[1])
            elif clean and not clean.startswith(('#', 'TITLE', 'DOMAIN_')):
                parts = clean.split()
                if len(parts) == 3:
                    rows.append([float(value) for value in parts])
    if size < 2 or size > 128 or len(rows) != size ** 3:
        raise ValueError(f'{path.name} is not a supported 3D LUT.')
    return size, np.clip(np.asarray(rows, np.float32), 0, 1)


def atlas(identifier: str) -> Path:
    """Blue slices left-to-right; red across each slice, green down. Browser samples it bilinearly."""
    target = settings.data_dir / 'luts' / f'{identifier}.png'
    if target.is_file():
        return target
    size, rows = read(identifier)
    # CUBE rows have red changing fastest, then green, then blue.
    volume = rows.reshape(size, size, size, 3)  # blue, green, red, rgb
    picture = np.concatenate([volume[blue] for blue in range(size)], axis=1)
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.round(picture * 255).astype(np.uint8), 'RGB').save(target, optimize=True)
    return target
