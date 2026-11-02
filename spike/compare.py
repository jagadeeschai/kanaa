"""Compare preview captures with the export at the same moments: layer positions and colors."""
import json, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image
here = Path(__file__).parent; out = here / '.out'
W, H = 1920, 1080
def export_frame(t):
    frame = round(t * 30)
    data = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(out / 'export.mp4'), '-vf', f'select=eq(n\\,{frame}),scale=in_color_matrix=bt709:in_range=tv', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True)
    return np.frombuffer(data.stdout, dtype=np.uint8).reshape(H, W, 3).astype(int)
def box(image, test, need=50):
    mask = test(image)
    rows = np.where(mask.sum(axis=1) > need)[0]; cols = np.where(mask.sum(axis=0) > need)[0]
    return None if not len(rows) or not len(cols) else np.array([cols[0], rows[0], cols[-1], rows[-1]])
magenta = lambda i: (i[..., 0] > 190) & (i[..., 1] < 80) & (i[..., 2] > 190)
cyan = lambda i: (i[..., 0] < 90) & (i[..., 1] > 180) & (i[..., 2] > 180)
times = [float(t) for t in sys.argv[1:]]
rows = []
for t in times:
    p = np.array(Image.open(out / ("preview-" + (str(int(t)) if t == int(t) else str(t).replace(".", "_")) + ".png")).convert('RGB')).astype(int)
    e = export_frame(t)
    row = {'t': t, 'mean_color_diff': round(float(np.abs(p - e).mean()), 2)}
    for name, test in (('a', magenta), ('b', cyan)):
        bp, be = box(p, test), box(e, test)
        row[name] = None if bp is None or be is None else [int(v) for v in bp - be]
    rows.append(row); print(row)
errors = [abs(v) for r in rows for k in 'ab' if r[k] for v in r[k]]
print('max position error px', max(errors) if errors else None, 'mean color diff', round(np.mean([r['mean_color_diff'] for r in rows]), 2))
