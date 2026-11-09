#!/usr/bin/env python3
"""Golden-frame test, part 1. Exports a project using every preset, then writes each sample's frame for tools/golden_check.js.

Usage: golden_frames.py API_URL OUTPUT_JSON WORK_FOLDER, against a test server with empty data.
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import numpy as np
from PIL import Image

API, OUTPUT, WORK = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
WIDTH, HEIGHT, FPS = 1280, 720, 30
GRID = (64, 36)
PRESETS = ['fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom', 'pop', 'blur', 'bounce']
TRANSITIONS = ['crossfade', 'wipe', 'slide', 'zoom', 'flash', 'dip', 'whip']
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


def make_logo():
    path = WORK / 'logo.png'
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black@0:s=400x400,format=rgba', '-vf', "geq=r='255*lt(X,200)':g='255*gte(X,200)':b=80:a='255*lt(hypot(X-200,Y-200),190)'", '-frames:v', '1', str(path)], check=True)
    return upload(path)


def make_screens():
    """A soft-edged subject on green, with the shadows and noise a real screen has."""
    picture = WORK / 'screen.png'
    rows, columns = np.mgrid[0:HEIGHT, 0:WIDTH].astype(float)
    shade = rows / HEIGHT
    screen = np.stack([8 + 12 * shade, 190 - 45 * shade, 70 - 14 * shade], axis=2)
    subject = np.clip((190 - np.hypot(columns - WIDTH / 2, rows - HEIGHT / 2)) / 6, 0, 1)[..., None]
    Image.fromarray((screen * (1 - subject) + np.array([235, 200, 170]) * subject).astype(np.uint8)).save(picture)
    video = WORK / 'screen.mp4'
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-loop', '1', '-i', str(picture), '-t', '4', '-r', '30', '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', str(video)], check=True)
    ids = upload(picture), upload(video)
    for _ in range(90):
        if call(f'/api/photos/{ids[1]}/assets').get('status') == 'ready':
            return ids
        time.sleep(1)
    sys.exit('The green screen clip never became ready.')


def make_detail():
    """Coloured squares and fine lines, so a blur or blocks change every part of the box."""
    rows, columns = np.mgrid[0:HEIGHT, 0:WIDTH]
    picture = np.stack([(columns // 40 % 2) * 200 + 30, (rows // 40 % 2) * 180 + 40, ((columns + rows) // 25 % 3) * 100], axis=2)
    picture[:, ::6] = 255
    path = WORK / 'detail.png'
    Image.fromarray(picture.astype(np.uint8)).save(path)
    return upload(path)


def make_motion():
    """Four seconds where every frame differs: a box crosses a gradient that brightens. Waits for its proxy and reversed copy."""
    path = WORK / 'motion.mp4'
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'gradients=s={WIDTH}x{HEIGHT}:c0=navy:c1=orange:x0=0:y0=0:x1={WIDTH}:y1={HEIGHT}:r={FPS}:d=4:speed=0.05',
                    '-vf', f"drawbox=x='t*250':y=200:w=180:h=300:c=white:t=fill,drawbox=x=900:y='50+t*120':w=120:h=120:c=black:t=fill", '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p',
                    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', str(path)], check=True)
    media = upload(path)
    for _ in range(180):
        if call(f'/api/photos/{media}/assets').get('status') == 'ready' and call(f'/api/photos/{media}/prepared?backwards=true', {}).get('status') == 'ready' and call(f'/api/photos/{media}/prepared?steady=true', {}).get('status') == 'ready':
            return media
        time.sleep(1)
    sys.exit('The moving clip never became ready.')


def make_person():
    """An optional clip with real people, from PERSON_VIDEO, for the cut-out samples. Waits for its masks and copies."""
    path = os.environ.get('PERSON_VIDEO')
    if not path:
        return None
    media = upload(Path(path))
    for _ in range(600):
        ready = call(f'/api/photos/{media}/assets').get('status') == 'ready'
        if ready and all(call(f'/api/photos/{media}/prepared?cutout={mode}', {}).get('status') == 'ready' for mode in ('remove', 'blur')):
            return media
        time.sleep(1)
    sys.exit('The person clip never became ready.')


def make_sources():
    pictures = []
    for name, pattern in (('a', 'gradients=s=1280x720:c0=red:c1=blue:x0=0:y0=0:x1=1280:y1=720:n=2'), ('b', 'gradients=s=1280x720:c0=yellow:c1=teal:x0=1280:y0=0:x1=0:y1=720:n=2')):
        path = WORK / f'{name}.png'
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', pattern, '-vf', 'drawbox=x=500:y=260:w=280:h=200:c=white:t=fill,drawbox=x=100:y=100:w=120:h=120:c=black:t=fill', '-frames:v', '1', str(path)], check=True)
        pictures.append(upload(path))
    return pictures


def clip(ident, media, start, **extra):
    return {'id': ident, 'media_id': media, 'start': start, 'in': 0, 'out': SECONDS, **extra}


def keys(*points, ease='easeInOut'):
    return [{'t': t, 'v': v, 'ease': ease} for t, v in points]


def build(first, second, logo, screen_image, screen_video, detail, motion, person=None):
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
    # Picture-shaping and two-colour effects (the echo plays a prepared copy, so it is checked by its own test instead).
    for name, extra in (('duotone', {'tone_grade': {'mode': 'duotone', 'shadow': '#1f2a5a', 'highlight': '#ffd27a', 'balance': 0.5, 'intensity': 1}}),
                        ('split-tone', {'tone_grade': {'mode': 'split', 'shadow': '#1f6f78', 'highlight': '#f2a541', 'balance': 0.4, 'intensity': 0.8}}),
                        ('mirror quad', {'mirror': {'mode': 'quad', 'segments': 6, 'angle': 0}}),
                        ('kaleidoscope', {'mirror': {'mode': 'kaleido', 'segments': 7, 'angle': 25}}),
                        ('zoom blur', {'zoom_blur': {'intensity': 0.8, 'center_x': 0.35, 'center_y': 0.6}}),
                        ('tilt-shift', {'tilt_shift': {'focus_y': 0.4, 'band': 0.15, 'blur': 1, 'saturation': 0.5}})):
        clips.append(clip(name.replace(' ', '-'), first, t, **extra))
        samples.append({'name': name, 't': t + 1})
        t += SECONDS
    clips.append(clip('adjust', second, t, adjust={'brightness': 1.2, 'contrast': 1.3, 'saturation': 0.6}, transform={'x': 0.4, 'y': 0.6, 'scale': 1.5, 'opacity': 0.7}))
    samples.append({'name': 'adjust and pose', 't': t + 1})
    t += SECONDS
    # A zoomed-in clip is cropped to the frame first, then that frame moves.
    for name, extra, at in (('filled slide-left', {'enter': {'preset': 'slide-left', 'duration': ANIMATION}}, 0.15), ('filled pop', {'enter': {'preset': 'pop', 'duration': ANIMATION}}, 0.15), ('filled zoom', {'exit': {'preset': 'zoom', 'duration': ANIMATION}}, 1.8), ('filled transition', {'transition_in': {'kind': 'slide', 'duration': 1}}, -0.1)):
        clips.append(clip(name.replace(' ', '-'), second if name == 'filled transition' else first, t, transform={'scale': 2.4}, **extra))
        samples.append({'name': name, 't': t + at})
        t += SECONDS
    # Keyframes, on the picture itself.
    for name, transform in (('turned', {'rotation': 30, 'scale': 0.7}),
                            ('spinning', {'scale': 0.6, 'keyframes': {'rotation': keys((0, -40), (2, 220))}}),
                            ('fading', {'keyframes': {'opacity': keys((0, 0), (2, 1), ease='easeOut')}}),
                            ('everything', {'keyframes': {'x': keys((0, 0.2), (2, 0.8)), 'y': keys((0, 0.3), (2, 0.7), ease='easeOut'), 'scale': keys((0, 0.4), (1, 1.2), (2, 0.5), ease='linear'), 'rotation': keys((0, 0), (2, 90)), 'opacity': keys((0, 0.4), (1, 1))}})):
        clips.append(clip(name, first, t, transform=transform))
        for at in (0.3, 1, 1.7):
            samples.append({'name': f'key {name} {at}', 't': t + at})
        t += SECONDS
    # A transparent logo crossing the video on its own layer.
    overlay = {'id': 'logo', 'media_id': logo, 'start': t, 'in': 0, 'out': 4, 'transform': {'scale': 0.3, 'keyframes': {'x': keys((0, 0.1), (4, 0.9)), 'y': keys((0, 0.8), (4, 0.2)), 'rotation': keys((0, 0), (4, 360)), 'opacity': keys((0, 0.3), (2, 1))}}}
    clips += [clip('under1', second, t), clip('under2', first, t + SECONDS)]
    for at in (0.5, 1.5, 2, 3.5):
        samples.append({'name': f'logo {at}', 't': t + at})
    t += 2 * SECONDS
    # Chroma key on an overlay, on a picture and a compressed video, with a blue screen setting too.
    overlays = [overlay]
    for name, media, chroma in (('key picture', screen_image, {}), ('key video', screen_video, {}), ('key tight', screen_video, {'similarity': 0.03, 'softness': 0.02}), ('key wide', screen_image, {'similarity': 0.2, 'softness': 0.2, 'spill': 1})):
        clips.append(clip(name.replace(' ', '-') + '-under', second, t))
        overlays.append({'id': name.replace(' ', '-'), 'media_id': media, 'start': t, 'in': 0, 'out': SECONDS, 'chroma': {'color': '#00b140', 'similarity': 0.08, 'softness': 0.06, 'spill': 0.5, **chroma}})
        samples.append({'name': name, 't': t + 1})
        t += SECONDS
    # A held frame, and a clip played backwards, on a clip where every frame differs.
    clips.append(clip('frozen', motion, t, freeze=1.5))
    samples += [{'name': 'freeze 0.5', 't': t + 0.5}, {'name': 'freeze 1.5', 't': t + 1.5}]
    t += SECONDS
    clips.append({'id': 'backwards', 'media_id': motion, 'start': t, 'in': 0.5, 'out': 3.5, 'reverse': True})
    samples += [{'name': f'reverse {at}', 't': t + at} for at in (0.2, 1.5, 2.8)]
    t += 3
    hero = [{'t': 0, 'v': 1.6}, {'t': 0.35, 'v': 1.6}, {'t': 0.45, 'v': 0.3}, {'t': 0.6, 'v': 0.3}, {'t': 0.7, 'v': 1.6}, {'t': 1, 'v': 1.6}]
    clips.append({'id': 'ramped', 'media_id': motion, 'start': t, 'in': 0.2, 'out': 3.8, 'speed': 1.2, 'ramp': hero})
    samples += [{'name': f'ramp {at}', 't': t + at} for at in (0.4, 1.2, 1.6, 2.1, 2.8)]
    t += 3
    person_layers, person_texts, fronts = [], [], []
    if person:
        # A real person, cut out over another picture, with the background blurred, and in front of a title.
        clips.append(clip('person-under', first, t))
        overlays.append({'id': 'cut', 'media_id': person, 'start': t, 'in': 1, 'out': 3, 'cutout': 'remove', 'muted': True})
        samples += [{'name': f'person remove {at}', 't': t + at} for at in (0.3, 1.5)]
        t += SECONDS
        clips.append({'id': 'portrait', 'media_id': person, 'start': t, 'in': 1, 'out': 3, 'cutout': 'blur'})
        samples += [{'name': f'person blur {at}', 't': t + at} for at in (0.3, 1.5)]
        t += SECONDS
        clips.append({'id': 'behind', 'media_id': person, 'start': t, 'in': 1, 'out': 3})
        person_texts.append({'id': 'behind-title', 'start': t, 'length': SECONDS, 'text': 'BEHIND', 'style': 'outline', 'position': 'center', 'size': 100})
        fronts.append({'id': 'front', 'media_id': person, 'start': t, 'in': 1, 'out': 3, 'cutout': 'remove', 'muted': True})
        samples += [{'name': f'person behind {at}', 't': t + at} for at in (0.3, 1.5)]
        t += SECONDS
    # A title behind a drawn ridge: the part below the line is a copy of the picture in front of the title.
    ridge = [[0, 0.62], [0.25, 0.5], [0.45, 0.58], [0.7, 0.42], [1, 0.55], [1, 1], [0, 1]]
    clips.append(clip('ridge-under', detail, t))
    texts.append({'id': 'ridge-title', 'start': t, 'length': SECONDS, 'text': 'MOUNTAINS', 'style': 'outline', 'position': 'center', 'size': 100, 'enter': {'preset': 'slide-up', 'duration': 1}})
    fronts.append({'id': 'ridge-front', 'media_id': detail, 'start': t, 'in': 0, 'out': SECONDS, 'muted': True, 'shape_mask': {'points': ridge, 'feather': 0.004}})
    samples += [{'name': f'behind ridge {at}', 't': t + at} for at in (0.4, 1.5)]
    t += SECONDS
    clips.append({'id': 'steadied', 'media_id': motion, 'start': t, 'in': 0.5, 'out': 2.5, 'stabilise': True})
    samples += [{'name': f'steady {at}', 't': t + at} for at in (0.3, 1.7)]
    t += 2
    # Blur boxes over a detailed picture: both styles, both shapes, a moving one and a big strong one.
    hides = []
    for name, extra in (('blur oval', {}), ('pixelate box', {'style': 'pixelate', 'shape': 'box'}), ('pixelate strong', {'style': 'pixelate', 'amount': 1, 'width': 0.6}),
                        ('blur moving', {'transform': {'keyframes': {'x': keys((0, 0.3), (2, 0.7)), 'scale': keys((0, 0.8), (2, 1.6))}}}), ('blur strong', {'amount': 1, 'width': 0.5, 'height': 0.3})):
        clips.append(clip(name.replace(' ', '-') + '-under', detail, t))
        hides.append({'id': name.replace(' ', '-'), 'start': t, 'length': SECONDS, 'style': 'blur', 'shape': 'oval', 'amount': 0.6, 'width': 0.3, 'height': 0.4, **extra})
        samples.append({'name': name, 't': t + 1})
        t += SECONDS
    # Blend modes, with the project at the six-layer limit.
    blends = ['multiply', 'screen', 'overlay']  # Six video layers at most: the layer in front of titles needs one.
    extra_layers = []
    for number, mode in enumerate(blends):
        clips.append(clip(f'base{number}', first, t))
        extra_layers.append({'id': f'blend{number}', 'kind': 'video', 'blend': mode, 'items': [{'id': f'top{number}', 'media_id': second, 'start': t, 'in': 0, 'out': SECONDS, 'transform': {'scale': 0.7, 'rotation': 15}}]})
        samples.append({'name': f'blend {mode}', 't': t + 1})
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
    # Titles moved and animated by their own transform, under their enter animation.
    for name, transform, enter in (('title moved', {'x': 0.3, 'y': 0.4, 'scale': 0.7, 'rotation': 10}, None),
                                   ('title moving', {'keyframes': {'x': keys((0, 0.3), (2, 0.7)), 'y': keys((0, 0.6), (2, 0.4)), 'scale': keys((0, 0.6), (2, 1.3))}}, {'preset': 'slide-up', 'duration': 1})):
        clips.append(clip(name.replace(' ', '-') + '-under', first, t))
        texts.append({'id': name.replace(' ', '-'), 'start': t, 'length': SECONDS, 'text': 'தமிழ் வாழ்க', 'style': 'outline', 'position': 'center', 'size': 60, 'enter': enter, 'transform': transform})
        for at in (0.5, 1, 1.6):
            samples.append({'name': f'{name} {at}', 't': t + at})
        t += SECONDS
    # Titles in 3D: leaning and turning in perspective, extruded, and the two cinema reveals mid-way.
    depth = {'amount': 0.7, 'color': '#7a4a12', 'light': 0.7}
    for name, extra, ats in (('title 3d lean', {'transform': {'tilt_x': 40, 'tilt_y': -25}}, (1,)),
                             ('title 3d depth', {'transform': {'tilt_x': 25, 'tilt_y': 20}, 'depth': depth}, (1,)),
                             ('title rise-behind', {'enter': {'preset': 'rise-behind', 'duration': 1.2}, 'depth': depth}, (0.3, 0.7, 1.5)),
                             ('title push-through', {'enter': {'preset': 'push-through', 'duration': 1.4}, 'depth': depth}, (0.3, 0.8, 1.6))):
        clips.append(clip(name.replace(' ', '-') + '-under', first, t))
        texts.append({'id': name.replace(' ', '-'), 'start': t, 'length': SECONDS, 'text': 'KANAA', 'style': 'shadow', 'position': 'center', 'size': 90, 'color': '#ffd27a', **extra})
        for at in ats:
            samples.append({'name': f'{name} {at}', 't': t + at})
        t += SECONDS
    # Title picture animations (drawn in the title's own picture on both sides), and the one-click title moves.
    for preset in ('reveal', 'soft-edge', 'line', 'chromatic', 'prism', 'echo'):
        clips.append(clip(f'trick-{preset}-under', first, t))
        texts.append({'id': f'trick-{preset}', 'start': t, 'length': SECONDS, 'text': 'Happy பொங்கல்', 'style': 'shadow', 'position': 'center', 'size': 80, 'color': '#ffd27a',
                      'enter': {'preset': preset, 'duration': 1}, 'exit': {'preset': preset, 'duration': ANIMATION}})
        samples += [{'name': f'title {preset} enter {share}', 't': t + share} for share in (0.25, 0.5, 0.8)]
        samples += [{'name': f'title {preset} rest', 't': t + 1.2}, {'name': f'title {preset} exit 0.5', 't': t + SECONDS - ANIMATION * 0.5}]
        t += SECONDS
    for name, extra in (('ticker', {'position': 'bottom', 'transform': {'keyframes': {'x': keys((0, 1.5), (SECONDS, -0.5))}}}),
                        ('story crawl', {'transform': {'tilt_x': 55, 'keyframes': {'y': keys((0, 1.25), (SECONDS, 0.3)), 'scale': keys((0, 1.3), (SECONDS, 0.45))}}})):
        clips.append(clip(name.replace(' ', '-') + '-under', first, t))
        texts.append({'id': name.replace(' ', '-'), 'start': t, 'length': SECONDS, 'text': 'Happy பொங்கல்', 'style': 'band', 'position': 'center', 'size': 70, **extra})
        samples += [{'name': f'title move {name} {at}', 't': t + at} for at in (0.5, 1, 1.5)]
        t += SECONDS
    # Laid-out titles: one picture for preview and export, also under a picture animation that wipes the bar too.
    for name, look in (('gradient', {'design': 'gradient', 'position': 'bottom', 'enter': {'preset': 'reveal', 'duration': 1}}),
                       ('gradient white', {'design': 'gradient', 'band_color': '#ffffff', 'color': '#1f2937', 'position': 'bottom'}),
                       ('formal', {'design': 'formal', 'position': 'bottom', 'color': '#3b2f1e', 'font': 'Baskerville'}),
                       ('overlap', {'design': 'overlap', 'size': 84, 'subtitle_size': 54, 'color': '#ef4444', 'subtitle_color': '#ffffff'}),
                       ('corners', {'design': 'corners', 'enter': {'preset': 'soft-edge', 'duration': 1}})):
        clips.append(clip('design-' + name.replace(' ', '-') + '-under', first, t))
        texts.append({'id': 'design-' + name.replace(' ', '-'), 'start': t, 'length': SECONDS, 'text': 'Meena Kumar', 'subtitle': 'மதுரை 2026', 'style': 'shadow', 'position': 'center', 'size': 44, 'color': '#ffffff', **look})
        samples += [{'name': f'title design {name} {at}', 't': t + at} for at in (0.5, 1.5)]
        t += SECONDS
    # Captions on top of everything, with the spoken word lit, in Tamil and English.
    captions = {'id': 'subs', 'kind': 'captions', 'style': 'outline', 'position': 'bottom', 'color': '#ffffff', 'highlight': '#ffd400', 'size': 56, 'items': [
        {'id': 'cap1', 'start': 1.0, 'length': 1.6, 'words': [{'w': 'தமிழ்', 's': 0}, {'w': 'வாழ்க', 's': 0.6}]},
        {'id': 'cap2', 'start': 3.0, 'length': 1.8, 'words': [{'w': 'Light', 's': 0}, {'w': 'each', 's': 0.5}, {'w': 'word', 's': 1.1}]}]}
    samples += [{'name': f'caption {at}', 't': at} for at in (1.2, 1.9, 3.2, 3.7, 4.4)]
    return {'version': 2, 'format': {'width': WIDTH, 'height': HEIGHT, 'fps': FPS}, 'layers': [{'id': 'main', 'kind': 'video', 'magnetic': True, 'items': clips}, {'id': 'over', 'kind': 'video', 'items': overlays}, *extra_layers, {'id': 'hide', 'kind': 'blur', 'items': hides}, {'id': 'words', 'kind': 'text', 'items': texts}, *([{'id': 'person-title', 'kind': 'text', 'items': person_texts}] if person_texts else []), *person_layers, {'id': 'fronts', 'kind': 'video', 'items': fronts}, captions]}, samples


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    first, second = make_sources()
    logo = make_logo()
    screen_image, screen_video = make_screens()
    cover = WORK / 'cover.mp4'
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=30:d=1', '-pix_fmt', 'yuv420p', str(cover)], check=True)
    cover_id = upload(cover)
    project = call('/api/projects', {'name': 'Golden frames', 'kind': 'edit', 'media_id': cover_id, 'media_ids': [cover_id]})
    timeline, samples = build(first, second, logo, screen_image, screen_video, make_detail(), make_motion(), make_person())
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
