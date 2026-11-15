"""Deterministic cinematic Screen overlays. No media, downloads or mutable particle caches."""
from __future__ import annotations
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# id, English, Tamil, one-line description; registered by effect_service.
LIGHTS = [
    ('volumetric-rays', 'Volumetric rays', 'ஒளிக் கற்றைகள்', 'Corner beams with dust drifting through the light'),
    ('frame-light-sweep', 'Light sweep', 'ஒளி வருடல்', 'A soft diagonal band crossing the frame once'),
    ('optical-flare-warm', 'Warm optical flare', 'வெப்ப லென்ஸ் ஒளி', 'Golden rings, starburst, hexagonal ghosts and a streak'),
    ('optical-flare-cool', 'Cool optical flare', 'குளிர் லென்ஸ் ஒளி', 'Blue rings, starburst, hexagonal ghosts and a streak'),
    ('bloom-hit', 'Bloom hit', 'ஒளிப் பொலிவு', 'A short bloom at the start; place it on a beat'),
    ('light-trails', 'Light streak trails', 'ஒளித் தடங்கள்', 'Fine glowing trails racing through the night'),
    ('burnt-edge-leak', 'Burnt edge leak', 'எரிந்த ஓர ஒளி', 'Organic orange-red film leaks crawling along the edges'),
    ('beam-sparkle-dust', 'Sparkle dust in a beam', 'கற்றையில் மின்னும் தூசி', 'Fine gold motes catching a drifting beam'),
]


def painter(kind: str):
    """Each call depends only on frame and size, so seeking or parallel renders cannot change it."""
    def paint(n, total, size, rng):
        w, h = size
        # Smooth light fields need only a small grid; particles and optical elements stay sharp.
        sw, sh = max(16, w // 4), max(16, h // 4)
        y, x = np.mgrid[:sh, :sw].astype(np.float32)
        x = (x + .5) / sw; y = (y + .5) / sh
        t = n / 30
        progress = n / max(1, total - 1)
        colour = np.array((255, 196, 92), np.float32)
        light = np.zeros((sh, sw), np.float32)
        image = Image.new('RGB', size)
        if kind in ('volumetric-rays', 'beam-sparkle-dust'):
            angle = np.arctan2(y + .12, (x + .08) * w / h)
            radius = np.hypot((x + .08) * w / h, y + .12)
            for k in range(6):
                direction = .22 + k * .18 + .025 * math.sin(t * .4 + k)
                light += np.exp(-((angle - direction) / (.018 + k * .003)) ** 2) * .22
            light *= np.exp(-radius * .45)
        elif kind == 'frame-light-sweep':
            centre = -.4 + 1.8 * progress
            distance = x + (y - .5) * .38 - centre
            light = .6 * np.exp(-(distance / .09) ** 2) + .35 * np.exp(-(distance / .025) ** 2)
        elif kind == 'bloom-hit':
            strength = math.exp(-t * 9) * min(1, t * 60)
            light = strength * (.2 + .8 * np.exp(-(((x - .5) * w / h) ** 2 + (y - .5) ** 2) / .2))
        elif kind == 'burnt-edge-leak':
            edge = np.minimum(x, 1 - x)
            wave = .025 * np.sin(y * 19 + t * 1.3) + .018 * np.sin(y * 37 - t)
            light = np.exp(-np.maximum(0, edge + wave) / (.035 + .02 * math.sin(t * .8) ** 2))
            light *= .6 + .3 * np.sin(y * 7 + t) ** 2
            colour = np.array((255, 65, 12), np.float32)
        elif kind.startswith('optical-flare'):
            colour = np.array((255, 191, 100) if kind.endswith('warm') else (110, 180, 255), np.float32)
            cx, cy = .24 + .12 * progress, .36 + .035 * math.sin(t * .5)
            dx, dy = (x - cx) * w / h, y - cy
            radius = np.hypot(dx, dy)
            light = .65 * np.exp(-(radius / .065) ** 2)
            light += .32 * np.exp(-(dy / .006) ** 2) * np.exp(-np.abs(dx) / .65)
            light += .24 * np.exp(-((radius - .17) / .008) ** 2)
            for a in (0, math.pi / 3, -math.pi / 3):
                across = -dx * math.sin(a) + dy * math.cos(a)
                along = dx * math.cos(a) + dy * math.sin(a)
                light += .35 * np.exp(-(across / .003) ** 2 - (along / .12) ** 2)
        image = Image.fromarray(np.clip(light[..., None] * colour, 0, 255).astype(np.uint8)).resize(size, Image.Resampling.BILINEAR)
        detail = Image.new('RGB', size)
        draw = ImageDraw.Draw(detail)
        unit = min(size)
        if kind in ('volumetric-rays', 'beam-sparkle-dust', 'light-trails'):
            particles = np.random.default_rng(7391).random((90, 5))
            for px, py, speed, phase, depth in particles:
                if kind == 'light-trails':
                    cx = ((px + t * (.35 + speed * .4)) % 1.3 - .15) * w
                    cy = py * h
                    length = unit * (.035 + depth * .12)
                    for j in range(8):
                        shade = (1 - j / 8) ** 2
                        c = tuple(int(v * shade) for v in (130, 195, 255))
                        draw.line((cx - length * (j + 1) / 8, cy + length * .1, cx - length * j / 8, cy), fill=c, width=max(1, round(unit * .002)))
                else:
                    cx = (px + .02 * math.sin(t * .4 + phase * 6)) * w
                    cy = ((py - t * (.012 + speed * .015)) % 1) * h
                    angle = math.atan2(cy / h + .12, (cx / w + .08) * w / h)
                    beam = max(math.exp(-((angle - (.22 + k * .18 + .025 * math.sin(t * .4 + k))) / .04) ** 2) for k in range(6))
                    strength = beam * (.3 + .7 * math.sin(t * .8 + phase * 6) ** 2)
                    r = max(.5, unit * .002 * depth)
                    draw.ellipse((cx-r, cy-r, cx+r, cy+r), fill=tuple(int(v * strength) for v in (255, 221, 143)))
        if kind.startswith('optical-flare'):
            cx, cy = .24 + .12 * progress, .36 + .035 * math.sin(t * .5)
            for distance, radius in ((.4, .025), (.85, .04), (1.25, .06), (1.7, .03)):
                gx, gy = (.5 + (.5-cx)*distance)*w, (.5 + (.5-cy)*distance)*h
                r = radius * unit
                points = [(gx+r*math.cos(a), gy+r*math.sin(a)) for a in np.arange(6)*math.pi/3]
                draw.polygon(points, outline=tuple(int(v * .3) for v in colour), width=max(1, round(unit*.002)))
        halo = detail.filter(ImageFilter.GaussianBlur(max(.8, unit * .008)))
        return Image.fromarray(np.clip(np.asarray(image, np.float32) + np.asarray(detail, np.float32) + np.asarray(halo, np.float32)*1.5, 0, 255).astype(np.uint8))
    return paint

PAINTERS = {row[0]: painter(row[0]) for row in LIGHTS}
