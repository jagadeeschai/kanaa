import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from app.core.config import settings
from app.services import music_library_service as library

FFMPEG = shutil.which('ffmpeg')


def tone(path: Path, seconds: float, **tags):
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = [argument for key, value in tags.items() for argument in ('-metadata', f'{key}={value}')]
    subprocess.run([FFMPEG, '-v', 'error', '-y', '-f', 'lavfi', '-i', f'sine=frequency=440:duration={seconds}', *meta, '-c:a', 'libmp3lame', '-q:a', '9', str(path)], check=True, timeout=60)


class MusicLibrary(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        root = Path(self.folder.name)
        self.music, self.data = root / 'Music', root / 'data'
        tone(self.music / 'Pack' / 'Track 3.mp3', 40, title='Track', artist='Pack', genre='Classical')
        tone(self.music / 'Pack' / 'Copy' / 'Track 3.mp3', 40, title='Track', artist='Pack', genre='Classical')
        tone(self.music / 'Unknown' / 'Happy Rock.mp3', 35)
        tone(self.music / 'Unknown' / 'Whoosh.mp3', 2)
        tone(self.music / 'Unknown' / 'podcast_module_1.mp3', 45)
        tone(self.music / 'Songs' / 'கற்கண்டு.mp3', 31, title='கற்கண்டு')
        tone(self.music / 'Bell' / 'Happy Birthday to you.mp3', 32, title='Happy Birthday to you', genre='Instrumental')
        os.environ['KANAA_MUSIC_DIR'] = str(self.music)
        self.saved, settings.data_dir = settings.data_dir, self.data

    def tearDown(self):
        os.environ.pop('KANAA_MUSIC_DIR', None)
        settings.data_dir = self.saved
        self.folder.cleanup()

    def test_tracks_are_sorted_into_moods_and_effects_and_talks_left_out(self):
        found = {track['name']: track for track in library.tracks()}
        self.assertEqual(set(found), {'Track 3', 'Happy Rock', 'கற்கண்டு', 'Happy Birthday to you'})
        self.assertEqual(found['Track 3']['mood'], 'romantic')
        self.assertEqual(found['Track 3']['genre'], 'Classical')
        self.assertEqual(found['Happy Rock']['mood'], 'happy')
        self.assertEqual(found['கற்கண்டு']['mood'], 'songs')
        self.assertEqual(found['Happy Birthday to you']['mood'], 'birthday')

    def test_using_a_track_copies_it_once_and_leaves_the_library_alone(self):
        track = next(item for item in library.tracks() if item['name'] == 'Happy Rock')
        source = self.music / 'Unknown' / 'Happy Rock.mp3'
        before = (source.stat().st_mtime, source.read_bytes())
        first, second = library.use(track['id']), library.use(track['id'])
        self.assertEqual(first['asset_id'], second['asset_id'])
        copied = self.data / 'video_audio' / first['asset_id']
        self.assertEqual(copied.read_bytes(), before[1])
        self.assertEqual((source.stat().st_mtime, source.read_bytes()), before)
        with self.assertRaises(ValueError):
            library.path_of('0' * 16)
        with self.assertRaises(ValueError):
            library.path_of('../etc/passwd')


if __name__ == '__main__':
    unittest.main()
