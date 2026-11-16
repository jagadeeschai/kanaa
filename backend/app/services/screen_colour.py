"""Was this shot on a green or blue screen? Looks at the frame's border, where a screen fills the picture."""
from __future__ import annotations

import colorsys

import numpy as np
from PIL import Image

BORDER = .06


def screen_colour(picture: Image.Image) -> str | None:
    """The screen's colour as #rrggbb when most of the border is one saturated green or blue; otherwise None."""
    pixels = np.asarray(picture.convert('RGB').resize((320, 180))).astype(float)
    h, w = pixels.shape[:2]; band = max(2, round(h * BORDER))
    border = np.concatenate([pixels[:band].reshape(-1, 3), pixels[-band:].reshape(-1, 3), pixels[:, :band].reshape(-1, 3), pixels[:, -band:].reshape(-1, 3)])
    middle = np.median(border, axis=0)
    hue, saturation, value = colorsys.rgb_to_hsv(*(middle / 255))
    green, blue = 80 / 360 <= hue <= 170 / 360, 190 / 360 <= hue <= 250 / 360
    if saturation < .35 or value < .2 or not (green or blue):
        return None
    if (np.abs(border - middle).sum(axis=1) < 90).mean() < .6:
        return None   # Coloured, but not one even screen (a forest, a sky…).
    return '#' + ''.join(f'{round(c):02x}' for c in middle)
