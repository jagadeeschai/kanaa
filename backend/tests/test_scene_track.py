"""A title locked to the scene with Sky only in front rides the skyline like a billboard: it pans and turns with the
camera, keeps its shape and size, and stays on the horizon."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np

from app.services import scene_track_service
from app.services.timeline_schema import Timeline
from app.services.title3d import on_skyline

W, H, FPS, SECONDS = 640, 360, 30, 2.0
WORLD_W, WORLD_H, HORIZON, SUN = 1100, 620, 300, (640.0, 190.0)


def world() -> np.ndarray:
    """A soft sky over a blocky city (corners to follow), with a small sun in the sky. BGR."""
    rng = np.random.default_rng(5)
    picture = np.zeros((WORLD_H, WORLD_W, 3), np.uint8)
    for y in range(HORIZON):
        picture[y] = (215, 175 + y * 25 // HORIZON, 150 + y * 40 // HORIZON)
    blocks = rng.integers(25, 200, ((WORLD_H - HORIZON) // 8 + 1, WORLD_W // 8 + 1, 3), dtype=np.uint8)
    picture[HORIZON:] = np.repeat(np.repeat(blocks, 8, axis=0), 8, axis=1)[:WORLD_H - HORIZON, :WORLD_W]
    yy, xx = np.ogrid[:WORLD_H, :WORLD_W]
    picture[(yy - SUN[1]) ** 2 + (xx - SUN[0]) ** 2 < 7 ** 2] = (60, 90, 245)
    return picture


def camera(t: float) -> np.ndarray:
    """World pixels to frame pixels at `t`: the camera pans right and rolls a few degrees, as a person turning does."""
    turn = np.radians(4 * np.sin(np.pi * t / SECONDS))
    cos, sin = np.cos(turn), np.sin(turn)
    look_x, look_y = 230 + 120 * t, 240 + 12 * np.sin(2 * np.pi * t / SECONDS)  # World point at the frame's centre.
    centre = np.array([[1, 0, W / 2], [0, 1, H / 2], [0, 0, 1]])
    return centre @ np.array([[cos, -sin, 0], [sin, cos, 0], [0, 0, 1]]) @ np.array([[1, 0, -look_x], [0, 1, -look_y], [0, 0, 1]])


def frame_point(matrix: np.ndarray, x: float, y: float) -> np.ndarray:
    point = matrix @ np.array([x, y, 1.0])
    return point[:2] / point[2]


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class SkylineTrack(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import cv2
        cls.folder = tempfile.TemporaryDirectory()
        cls.video = Path(cls.folder.name) / 'turning.mp4'
        picture = world()
        encode = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                                   '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', str(cls.video)], stdin=subprocess.PIPE)
        for number in range(round(SECONDS * FPS) + 1):
            encode.stdin.write(cv2.warpAffine(picture, camera(number / FPS)[:2], (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT).tobytes())
        encode.stdin.close()
        encode.wait()
        cls.at = 0.5
        cls.track = scene_track_service.scene_track(cls.video, (W, H), 0, SECONDS - 0.1, cls.at, horizon=True)

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def matrix(self, t: float) -> np.ndarray:
        """The track's matrix at `t`, in frame pixels."""
        normal = np.array(scene_track_service.matrix_at(self.track, t))
        return np.diag([W, H, 1]) @ normal @ np.diag([1 / W, 1 / H, 1])

    def test_the_skyline_is_found_straight_and_where_it_is(self):
        import cv2
        picture = cv2.warpAffine(world(), camera(1.0)[:2], (W, H), borderMode=cv2.BORDER_REFLECT)
        a, b = scene_track_service.skyline(picture)
        left, right = frame_point(camera(1.0), 0, HORIZON), frame_point(camera(1.0), WORLD_W, HORIZON)
        for x in (0.2, 0.5, 0.8):
            # Where the world's horizon crosses this column of the frame.
            want = left[1] + (right[1] - left[1]) * (x * W - left[0]) / (right[0] - left[0])
            self.assertAlmostEqual((a + b * x) * H, want, delta=4, msg=f'at x={x}')

    def test_a_billboard_on_the_horizon_stays_on_it_and_follows_the_sun(self):
        pin = camera(self.at)
        truth = lambda t: camera(t) @ np.linalg.inv(pin)  # Frame at the pin moment to frame at t.
        sun = frame_point(pin, *SUN)
        on_horizon = frame_point(pin, 500, HORIZON)
        for t in np.arange(0.1, SECONDS - 0.15, 0.2):
            for point, name in ((sun, 'the sun'), (on_horizon, 'the horizon')):
                found, want = frame_point(self.matrix(t), *point), frame_point(truth(t), *point)
                self.assertLess(np.hypot(*(found - want)), 6, f'{name} at {t:.1f} s: {found} against {want}')

    def test_the_title_keeps_its_shape_and_size(self):
        for t in np.arange(0.1, SECONDS - 0.15, 0.3):
            part = self.matrix(t)
            part = part / part[2, 2]
            self.assertLess(np.abs(part[2, :2]).max(), 1e-4, 'no perspective')
            square = part[:2, :2]
            self.assertAlmostEqual(abs(np.linalg.det(square)), 1, delta=0.03, msg='no zoom')
            self.assertAlmostEqual(np.dot(square[:, 0], square[:, 1]), 0, delta=0.03, msg='no shear')
            self.assertAlmostEqual(np.linalg.norm(square[:, 0]), np.linalg.norm(square[:, 1]), delta=0.03, msg='not squashed')

    def test_skyline_tracks_are_kept_apart_from_ordinary_ones(self):
        self.assertNotEqual(scene_track_service.track_path(self.video, 0, 1, 0.5), scene_track_service.track_path(self.video, 0, 1, 0.5, horizon=True))


class SkylineRule(unittest.TestCase):
    def timeline(self, pick='land', hidden=False, bypass=None):
        clip = {'id': 'c', 'media_id': 1, 'start': 0, 'in': 0, 'out': 5}
        cover = {**clip, 'id': 'cover', 'cutout': 'remove', 'cutout_pick': {'kind': pick, 'ids': None}, 'bypass': bypass}
        return Timeline.model_validate({'layers': [
            {'id': 'main', 'kind': 'video', 'items': [clip]},
            {'id': 'words', 'kind': 'text', 'items': [{'id': 't', 'start': 0, 'length': 2, 'text': 'Hi', 'pin': {'clip_id': 'c', 'at': 1}}]},
            {'id': 'land', 'kind': 'video', 'name': 'Land', 'hidden': hidden, 'items': [cover]}]})

    def test_only_sky_only_in_front_puts_the_title_on_the_skyline(self):
        text = lambda timeline: timeline.layers[1].items[0]
        self.assertTrue(on_skyline(self.timeline(), text(self.timeline())))
        self.assertFalse(on_skyline(self.timeline('objects'), text(self.timeline('objects'))))
        self.assertFalse(on_skyline(self.timeline(hidden=True), text(self.timeline(hidden=True))))
        self.assertFalse(on_skyline(self.timeline(bypass=['background']), text(self.timeline(bypass=['background']))))


if __name__ == '__main__':
    unittest.main()
