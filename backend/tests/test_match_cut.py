"""Match-cut finder: a round shape ending one clip finds the round shape starting another (not a bar), and a move to
the right finds a move to the right (not to the left); each suggestion says where to cut and shows both sides."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from app.services import match_cut_service as match


def clip(path: Path, picture: str, seconds: float = 3) -> Path:
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', f'color=c=0x202830:s=640x360:r=30:d={seconds}', '-vf', picture, '-pix_fmt', 'yuv420p', str(path)], check=True)
    return path


ROUND = "geq=lum='if(lt(hypot(X-320,Y-180),90),230,40)':cb=128:cr=128"
BAR = "drawbox=x=40:y=160:w=560:h=40:color=white:t=fill"


def moving(direction: int) -> str:  # A textured box crossing the frame (geq knows the time; drawbox's t is its line).
    left = '(40+T*120)' if direction > 0 else '(480-T*120)'
    return f"geq=lum='if(between(X,{left},{left}+120)*between(Y,100,260),if(lt(mod(X-{left},24),4)+lt(mod(Y,24),4),90,230),40)':cb=128:cr=128"


@unittest.skipUnless(shutil.which('ffmpeg'), 'needs ffmpeg')
class Finder(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)

    def run_on(self, files: dict[str, Path]) -> list[dict]:
        ids = list(files)
        clips = [{'id': name, 'media_id': number, 'in': 0, 'out': 3} for number, name in enumerate(ids)]
        return match.find(clips, lambda number: files[ids[number]])

    def test_a_round_shape_finds_a_round_shape(self):
        found = self.run_on({'sun': clip(self.root / 'a.mp4', ROUND), 'plate': clip(self.root / 'b.mp4', ROUND), 'bar': clip(self.root / 'c.mp4', BAR)})
        best = found[0]
        self.assertEqual({best['from'], best['to']}, {'sun', 'plate'})
        self.assertGreater(best['score'], 0.8)
        self.assertTrue(best['from_picture'].startswith('data:image/jpeg;base64,') and best['to_picture'])
        self.assertGreater(best['from_at'], 1.0)  # Cut out near the end of the first...
        self.assertLess(best['to_at'], 2.0)  # ...into the start of the second.
        self.assertTrue(all(pair['score'] < best['score'] for pair in found if 'bar' in (pair['from'], pair['to'])))
        alone = match.find([{'id': 'sun', 'media_id': 0, 'in': 0, 'out': 3}, {'id': 'bar', 'media_id': 1, 'in': 0, 'out': 3}], lambda n: [self.root / 'a.mp4', self.root / 'c.mp4'][n])
        self.assertTrue(all(pair['score'] < 0.8 for pair in alone))  # Round into a bar: weak, if suggested at all.

    def test_a_move_carries_on_the_same_way(self):
        found = self.run_on({'walk': clip(self.root / 'a.mp4', moving(1)), 'right': clip(self.root / 'b.mp4', moving(1)), 'left': clip(self.root / 'c.mp4', moving(-1))})
        into = {pair['to']: pair['score'] for pair in found if pair['from'] == 'walk'}
        with_right = [pair for pair in match.find([{'id': 'walk', 'media_id': 0, 'in': 0, 'out': 3}, {'id': 'right', 'media_id': 1, 'in': 0, 'out': 3}], lambda n: [self.root / 'a.mp4', self.root / 'b.mp4'][n])]
        with_left = [pair for pair in match.find([{'id': 'walk', 'media_id': 0, 'in': 0, 'out': 3}, {'id': 'left', 'media_id': 1, 'in': 0, 'out': 3}], lambda n: [self.root / 'a.mp4', self.root / 'c.mp4'][n])]
        score = lambda pairs: next((pair['score'] for pair in pairs if pair['from'] == 'walk'), 0.0)
        self.assertGreater(score(with_right), score(with_left), into)

    def test_each_clip_is_cut_out_of_and_into_at_most_once(self):
        found = self.run_on({name: clip(self.root / f'{name}.mp4', ROUND) for name in 'abcd'})
        self.assertEqual(len({pair['from'] for pair in found}), len(found))
        self.assertEqual(len({pair['to'] for pair in found}), len(found))


if __name__ == '__main__':
    unittest.main()
