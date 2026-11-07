"""Writes title3d cases and the corners and homographies Python gives for them, for the frontend to check (title3d.test.mjs).

Usage: backend/.venv/bin/python tools/title3d_fixture.py > frontend/tests/title3d-cases.json
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app.services import title3d  # noqa: E402
from app.services.timeline_schema import Text  # noqa: E402

SIZE = (1280, 720)
BOX = (380.0, 300.0, 900.0, 420.0)
cases = []
for pose in ({'cx': .5, 'cy': .5, 'size': 1, 'turn': 0, 'tilt_x': 0, 'tilt_y': 0},
             {'cx': .5, 'cy': .5, 'size': 1, 'turn': 0, 'tilt_x': 45, 'tilt_y': 0},
             {'cx': .42, 'cy': .61, 'size': 1.3, 'turn': 8, 'tilt_x': -20, 'tilt_y': 35},
             {'cx': .6, 'cy': .4, 'size': .7, 'turn': -15, 'tilt_x': 70, 'tilt_y': -60}):
    for share, amount in ((0, 0), (1, .6)):
        pin = [[1.02, .01, -14], [-.005, .99, 6], [.00002, -.00001, 1]] if pose['tilt_y'] else None
        corners = title3d.corners(pose, BOX, SIZE, share, amount, pin)
        source = [(BOX[0], BOX[1]), (BOX[2], BOX[1]), (BOX[2], BOX[3]), (BOX[0], BOX[3])]
        cases.append({'pose': pose, 'share': share, 'amount': amount, 'pin': pin, 'corners': corners, 'homography': title3d.homography(source, corners)})
looks = []
for preset in ('rise-behind', 'push-through', 'ground-rise', 'fade'):
    text = Text.model_validate({'id': 't', 'start': 0, 'length': 3, 'text': 'x', 'enter': {'preset': preset, 'duration': 1.2}, 'exit': {'preset': 'fade', 'duration': .5},
                                'transform': {'tilt_x': 10, 'keyframes': {'tilt_y': [{'t': 0, 'v': 30}, {'t': 2, 'v': -10}]}}})
    for local in (0, .3, .6, 1.1, 2.0, 2.8):
        pose, look = title3d.pose_at(text, local)
        looks.append({'preset': preset, 'local': local, 'pose': pose, 'opacity': look['opacity']})
json.dump({'size': SIZE, 'box': BOX, 'cases': cases, 'looks': looks}, sys.stdout)
