#!/usr/bin/env python3
"""Golden-frame test, part 1. Exports a project using every preset, then writes each sample's frame for tools/golden_check.js.

Usage: golden_frames.py API_URL OUTPUT_JSON WORK_FOLDER, against a test server with empty data.
"""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import numpy as np

API, OUTPUT, WORK = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
WIDTH, HEIGHT, FPS = 1280, 720, 30
GRID = (64, 36)
PRESETS = ['fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom', 'pop', 'blur', 'bounce']
TRANSITIONS = ['crossfade', 'wipe', 'slide', 'zoom']
LOOKS = ['warm', 'cool', 'mono', 'vivid', 'film']
ANIMATION = 0.6
SECONDS = 2.0


def call(path, body=None, method='POST'):
    request = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method if body is not None else 'GET', headers={'content-type': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(request))
    except urllib.error.HTTPError as error:
        sys.exit(f'{path}: {error.read().decode()}')


def upload(path):
    boundary = uuid.uuid4().hex
    body = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\n\r\n'.encode() + path.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
    request = urllib.request.Request(API + '/api/media', data=body, headers={'content-type': f'multipart/form-data; boundary={boundary}'})
    return json.load(urllib.request.urlopen(request))['id']


def make_sources():
    pictures = []
    for name, pattern in (('a', 'gradients=s=1280x720:c0=red:c1=blue:x0=0:y0=0:x1=1280:y1=720:n=2'), ('b', 'gradients=s=1280x720:c0=yellow:c1=teal:x0=1280:y0=0:x1=0:y1=720:n=2')):
        path = WORK / f'{name}.png'
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', pattern, '-vf', 'drawbox=x=500:y=260:w=280:h=200:c=white:t=fill,drawbox=x=100:y=100:w=120:h=120:c=black:t=fill', '-frames:v', '1', str(path)], check=True)
        pictures.append(upload(path))
    return pictures


def clip(ident, media, start, **extra):
    return {'id': ident, 'media_id': media, 'start': start, 'in': 0, 'out': SECONDS, **extra}


def build(first, second):
    clips, texts, samples, t = [], [], [], 0.0
    for number, preset in enumerate(PRESETS):
        animation = {'preset': preset, 'duration': ANIMATION}
        clips.append(clip(f'p{number}', first if number % 2 else second, t, enter=animation, exit=animation))
        for share in (0.1, 0.25, 0.5, 0.8):
            samples += [{'name': f'enter {preset} {share}', 't': t + ANIMATION * share}, {'name': f'exit {preset} {share}', 't': t + SECONDS - ANIMATION * share}]
        t += SECONDS
    for number, kind in enumerate(TRANSITIONS):
        clips.append(clip(f't{number}', first if number % 2 else second, t, transition_in={'kind': kind, 'duration': 1}))
        for share in (0.2, 0.5, 0.8):
            samples.append({'name': f'transition {kind} {share}', 't': t - 0.5 + share})
        t += SECONDS
    for number, look in enumerate(LOOKS):
        clips.append(clip(f'l{number}', first, t, look=look))
        samples.append({'name': f'look {look}', 't': t + 1})
        t += SECONDS
    clips.append(clip('adjust', second, t, adjust={'brightness': 1.2, 'contrast': 1.3, 'saturation': 0.6}, transform={'x': 0.4, 'y': 0.6, 'scale': 1.5, 'opacity': 0.7}))
    samples.append({'name': 'adjust and pose', 't': t + 1})
    t += SECONDS
    # A zoomed-in clip is cropped to the frame first, then that frame moves.
    for name, extra, at in (('filled slide-left', {'enter': {'preset': 'slide-left', 'duration': ANIMATION}}, 0.15), ('filled pop', {'enter': {'preset': 'pop', 'duration': ANIMATION}}, 0.15), ('filled zoom', {'exit': {'preset': 'zoom', 'duration': ANIMATION}}, 1.8), ('filled transition', {'transition_in': {'kind': 'slide', 'duration': 1}}, -0.1)):
        clips.append(clip(name.replace(' ', '-'), second if name == 'filled transition' else first, t, transform={'scale': 2.4}, **extra))
        samples.append({'name': name, 't': t + at})
        t += SECONDS
    # Tamil text runs through every preset on plain frames.
    for number, preset in enumerate(PRESETS):
        animation = {'preset': preset, 'duration': ANIMATION}
        clips.append(clip(f'q{number}', first, t))
        texts.append({'id': f'x{number}', 'start': t, 'length': SECONDS, 'text': 'தமிழ் வாழ்க கண்டேன்', 'style': 'band', 'position': 'center', 'size': 60, 'enter': animation, 'exit': animation})
        for share in (0.25, 0.5, 0.8):
            samples.append({'name': f'text enter {preset} {share}', 't': t + ANIMATION * share})
        samples.append({'name': f'text rest {preset}', 't': t + 1})
        samples.append({'name': f'text exit {preset} 0.5', 't': t + SECONDS - ANIMATION * 0.5})
        t += SECONDS
    return {'version': 2, 'format': {'width': WIDTH, 'height': HEIGHT, 'fps': FPS}, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': clips}, {'id': 'words', 'kind': 'text', 'items': texts}]}, samples


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    first, second = make_sources()
    cover = WORK / 'cover.mp4'
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=30:d=1', '-pix_fmt', 'yuv420p', str(cover)], check=True)
    cover_id = upload(cover)
    project = call('/api/projects', {'name': 'Golden frames', 'kind': 'edit', 'media_id': cover_id, 'media_ids': [cover_id]})
    timeline, samples = build(first, second)
    call(f"/api/projects/{project['id']}/recipe", {'recipe': timeline}, 'PUT')
    job = call(f"/api/projects/{project['id']}/export", timeline)['job_id']
    while (status := call(f'/api/jobs/{job}/status'))['status'] not in ('done', 'failed', 'cancelled'):
        time.sleep(1)
    if status['status'] != 'done':
        sys.exit(f'Export failed: {status.get("error")}')
    media = call(f"/api/photos/{status['output_photo_id']}")
    video = media['absolute_path']
    count = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', video], capture_output=True, text=True).stdout.strip()
    raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', video, '-vf', 'scale=in_color_matrix=bt709,format=rgb24', '-f', 'rawvideo', '-'], capture_output=True, check=True).stdout
    size = WIDTH * HEIGHT * 3
    for sample in samples:
        frame = round(sample['t'] * FPS)
        sample['t'] = frame / FPS
        # Both sides average exact blocks, so resampling can't look like a difference.
        pixels = np.frombuffer(raw[frame * size:(frame + 1) * size], dtype=np.uint8).reshape(HEIGHT, WIDTH, 3).astype(float)
        block = WIDTH // GRID[0]
        grid = pixels.reshape(GRID[1], block, GRID[0], block, 3).mean(axis=(1, 3))
        sample['pixels'] = np.rint(grid).astype(np.uint8).tobytes().hex()
    OUTPUT.write_text(json.dumps({'project': project['id'], 'grid': GRID, 'frames': count, 'video': video, 'samples': samples}))
    print(f'{len(samples)} samples, {count} frames, project {project["id"]}')


main()
