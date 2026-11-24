"""Multicam sync by sound: a second recording of the same moment is placed to the millisecond, whether it started
later or earlier, quieter and noisier; one that heard something else is reported as not synced."""
import shutil
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

from app.services import multicam_service as multicam

RATE = multicam.RATE


def moment(seconds: float, seed: int) -> np.ndarray:
    """A made-up event: claps and words (bursts) over a hum, the same for every camera that heard it."""
    rng = np.random.default_rng(seed)
    out = 0.02 * rng.standard_normal(int(seconds * RATE)).astype(np.float32)
    for at in np.sort(rng.uniform(0, seconds - 0.3, int(seconds * 2.5))):
        start = int(at * RATE); length = int(rng.uniform(0.03, 0.25) * RATE)
        out[start:start + length] += rng.uniform(0.2, 0.8) * rng.standard_normal(length).astype(np.float32) * np.exp(-np.arange(length) / (length / 3))
    return out


def other_camera(samples: np.ndarray, seed: int) -> np.ndarray:
    """Another phone: quieter, its own noise, a softer microphone."""
    rng = np.random.default_rng(seed)
    soft = np.convolve(samples, np.ones(4) / 4, mode='same')
    return (0.45 * soft + 0.03 * rng.standard_normal(len(samples))).astype(np.float32)


class Offsets(unittest.TestCase):
    def test_a_later_camera_is_placed_to_the_millisecond(self):
        event = moment(60, 1)
        later = other_camera(event[int(1.234 * RATE):int(50 * RATE)], 2)
        at, sure = multicam.offset(event, later)
        self.assertAlmostEqual(at, 1.234, delta=0.001)
        self.assertGreater(sure, multicam.SURE)

    def test_an_earlier_camera_gets_a_negative_offset(self):
        event = moment(40, 3)
        earlier = np.concatenate([0.02 * np.random.default_rng(4).standard_normal(2 * RATE).astype(np.float32), other_camera(event, 5)])
        at, sure = multicam.offset(event, earlier)
        self.assertAlmostEqual(at, -2.0, delta=0.001)
        self.assertGreater(sure, multicam.SURE)

    def test_a_camera_that_heard_something_else_is_not_sure(self):
        at, sure = multicam.offset(moment(40, 6), moment(40, 7))
        self.assertLess(sure, multicam.SURE)


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class FromFiles(unittest.TestCase):
    def test_sync_reads_the_files_and_reports_each(self):
        root = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, root)
        event = moment(30, 8)

        def save(name: str, samples: np.ndarray, picture: bool) -> Path:
            sound = root / f'{name}.wav'
            with wave.open(str(sound), 'wb') as out:
                out.setnchannels(1); out.setsampwidth(2); out.setframerate(RATE)
                out.writeframes((np.clip(samples, -1, 1) * 32000).astype(np.int16).tobytes())
            if not picture:
                return sound
            video = root / f'{name}.mp4'  # A phone video: picture and its sound, at 48 kHz as phones record.
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=30', '-i', str(sound), '-shortest', '-c:a', 'aac', '-ar', '48000', '-pix_fmt', 'yuv420p', str(video)], check=True)
            return video
        found = multicam.sync([save('a', event, True), save('b', other_camera(event[int(3.5 * RATE):], 9), True), save('c', moment(25, 10), False)])
        self.assertEqual(found[0], {'offset': 0.0, 'sure': 1.0, 'synced': True})
        self.assertAlmostEqual(found[1]['offset'], 3.5, delta=0.03)  # AAC adds a little delay of its own.
        self.assertTrue(found[1]['synced'])
        self.assertFalse(found[2]['synced'])


if __name__ == '__main__':
    unittest.main()
