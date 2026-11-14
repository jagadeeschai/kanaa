"""Resolve the same alpha videos used by the reference timeline compositor."""
from pathlib import Path


def resolve(clip, facts, masks) -> str | None:
    if clip.cutout != 'remove':
        return None
    if masks is None:
        raise ValueError('A cut-out clip needs its prepared person mask.')
    path = Path(masks(facts, clip.cutout_pick))
    if clip.depth_gap:
        from app.services.cutout_service import make_space_mask
        path = make_space_mask(path, clip.depth_gap)
    return str(path)
