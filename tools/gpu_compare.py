"""Compare two scratch exports and make the GPU handoff's frame report/contact sheet.

Usage: backend/.venv/bin/python tools/gpu_compare.py FOLDER --fps 30 --times 1,20,69.8,71,120
FOLDER contains ffmpeg.mp4 and gpu.mp4; all report files are written beside those copies.
"""
import argparse
import json
import math
import re
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw


def compare(folder: Path, fps: float, times: list[float]):
    stats = folder / 'psnr.txt'
    result = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(folder / 'ffmpeg.mp4'), '-i', str(folder / 'gpu.mp4'),
        '-lavfi', f'psnr=stats_file={stats}', '-f', 'null', '-'], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-1000:])
    rows = []
    for line in stats.read_text().splitlines():
        match = re.search(r'n:(\d+).*?psnr_avg:([\d.]+|inf)', line)
        if match:
            frame, value = int(match[1]), float(match[2])
            rows.append({'frame': frame, 'seconds': round((frame - 1) / fps, 4), 'psnr_db': value})
    if not rows:
        raise RuntimeError('No frame comparison was produced')
    finite = [row['psnr_db'] for row in rows if math.isfinite(row['psnr_db'])]
    report = {'frames': len(rows), 'average_db': sum(finite) / len(finite) if finite else 'inf',
              'worst20': sorted(rows, key=lambda row: row['psnr_db'])[:20],
              'below30': [row for row in rows if row['psnr_db'] < 30]}
    (folder / 'comparison.json').write_text(json.dumps(report, indent=2))
    width, height = 384, 216
    times = sorted(set(times))
    sheet = Image.new('RGB', (width * 4, (height + 28) * math.ceil(len(times) / 2)), '#202025')
    draw = ImageDraw.Draw(sheet)
    for index, seconds in enumerate(times):
        x = (index % 2) * width * 2
        y = (index // 2) * (height + 28)
        for column, engine in enumerate(('ffmpeg', 'gpu')):
            path = folder / f'review-{index:02}-{engine}.png'
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-ss', str(seconds), '-i', str(folder / f'{engine}.mp4'),
                '-frames:v', '1', '-vf', f'scale={width}:{height}', str(path)], check=True)
            with Image.open(path) as image:
                sheet.paste(image.convert('RGB'), (x + column * width, y + 28))
            draw.text((x + column * width + 5, y + 8), f'{seconds:.2f}s - {engine}', fill='white')
    sheet.save(folder / 'contact-sheet.jpg', quality=94)
    print(json.dumps({key: value for key, value in report.items() if key != 'below30'}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    parser.add_argument('--fps', type=float, default=30)
    parser.add_argument('--times', default='1,20,40,69.8,70.8,72.1,100,140,180,220,260,280')
    args = parser.parse_args()
    compare(args.folder, args.fps, [float(value) for value in args.times.split(',')])
