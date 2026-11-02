"""Draws the app icon: Motion's purple square with a white play mark."""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
folder = Path(sys.argv[1]) / 'icon.iconset'
folder.mkdir(parents=True, exist_ok=True)
scale = 4
big = SIZE * scale
picture = Image.new('RGBA', (big, big), (0, 0, 0, 0))
draw = ImageDraw.Draw(picture)
inset, radius = int(big * 0.1), int(big * 0.19)
for row in range(inset, big - inset):
    share = (row - inset) / (big - 2 * inset)
    color = tuple(round(a + (b - a) * share) for a, b in zip((124, 92, 240), (92, 62, 214)))
    draw.line([(0, row), (big, row)], fill=(*color, 255))
mask = Image.new('L', (big, big), 0)
ImageDraw.Draw(mask).rounded_rectangle((inset, inset, big - inset, big - inset), radius, fill=255)
picture.putalpha(mask)
middle = big // 2
draw = ImageDraw.Draw(picture)
draw.polygon([(middle - big * 0.13, middle - big * 0.19), (middle - big * 0.13, middle + big * 0.19), (middle + big * 0.2, middle)], fill=(255, 255, 255, 255))
picture = picture.resize((SIZE, SIZE), Image.LANCZOS)
for size in (16, 32, 64, 128, 256, 512):
    picture.resize((size, size), Image.LANCZOS).save(folder / f'icon_{size}x{size}.png')
    picture.resize((size * 2, size * 2), Image.LANCZOS).save(folder / f'icon_{size}x{size}@2x.png')
subprocess.run(['iconutil', '-c', 'icns', str(folder), '-o', str(Path(sys.argv[1]) / 'icon.icns')], check=True)
