import tempfile
import io
import wave
import shutil
import time
from types import SimpleNamespace

from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
from app.db import database
from app.services.lyric_transcription_worker import transcribe_words
import unittest
from pathlib import Path
from unittest.mock import patch

from app.api.schemas import VideoEditRequest
from app.services.lyric_sync_service import align_lyric_lines, normalize_word, repair_impossible_timing
from app.services.video_edit_service import write_lyrics


class LyricSyncTests(unittest.TestCase):
    def test_repeated_lines_use_distinct_word_timestamps(self):
        lines = ['Morning light', 'Carry me home', 'Morning light']
        words = [{'word': word, 'start': index * 0.5, 'end': index * 0.5 + 0.4} for index, word in enumerate('Morning light Carry me home Morning light'.split())]
        cues, coverage = align_lyric_lines(lines, words, 5)
        self.assertEqual(coverage, 1)
        self.assertEqual(cues[0]['start'], 0)
        self.assertEqual(cues[2]['start'], 2.5)
        self.assertFalse(any(cue['review'] for cue in cues))
        self.assertTrue(all(cues[index]['end'] <= cues[index + 1]['start'] for index in range(len(cues) - 1)))

    def test_missing_line_is_marked_for_review(self):
        cues, _ = align_lyric_lines(['Morning light', 'Carry me home', 'Stars above'], [{'word': 'Morning', 'start': 1, 'end': 1.5}, {'word': 'light', 'start': 1.5, 'end': 2}, {'word': 'Stars', 'start': 6, 'end': 6.5}, {'word': 'above', 'start': 6.5, 'end': 7}], 8)
        self.assertTrue(cues[1]['review'])
        self.assertGreaterEqual(cues[1]['start'], cues[0]['end'])
        self.assertLessEqual(cues[1]['end'], cues[2]['start'])

    def test_unrelated_audio_returns_estimates_flagged_for_review(self):
        cues, coverage = align_lyric_lines(['Morning light', 'Carry me home'], [{'word': 'something', 'start': 1, 'end': 2}], 20)
        self.assertEqual(coverage, 0)
        self.assertTrue(all(cue['review'] for cue in cues))
        self.assertTrue(all(cue['end'] > cue['start'] for cue in cues))

    def test_estimated_lines_do_not_stretch_across_silence(self):
        words = [{'word': word, 'start': 100 + index * 0.5, 'end': 100.4 + index * 0.5} for index, word in enumerate('Morning light'.split())]
        cues, _ = align_lyric_lines(['One two three', 'Morning light'], words, 120)
        self.assertLess(cues[0]['end'] - cues[0]['start'], 5)

    def test_merged_spellings_and_sound_alike_letters_still_align(self):
        words = [{'word': 'ஏறியசுவையும்', 'start': 5, 'end': 7}, {'word': 'கண்டிர்', 'start': 8, 'end': 9}, {'word': 'தமிரும்', 'start': 10, 'end': 11}]
        cues, coverage = align_lyric_lines(['ஏறிய சுவையும்', 'கண்டீர்', 'தமிழும்'], words, 15)
        self.assertGreater(coverage, 0.8)
        self.assertEqual([cue['start'] for cue in cues], [5, 8, 10])
        self.assertFalse(any(cue['review'] for cue in cues))

    def test_squashed_and_stretched_lines_are_repaired_and_flagged(self):
        cues = repair_impossible_timing([
            {'text': 'Morning light is here', 'start': 0, 'end': 3, 'review': False},
            {'text': 'Morning light is here', 'start': 3, 'end': 3.1, 'review': False},
            {'text': 'Morning light is here', 'start': 3.1, 'end': 6, 'review': False},
            {'text': 'Stars above us', 'start': 6, 'end': 40, 'review': False},
        ])
        self.assertTrue(all(cue['end'] - cue['start'] > 1 for cue in cues[:3]))
        self.assertTrue(all(cue['review'] for cue in cues))
        self.assertLess(cues[3]['end'], 15)

    def test_identical_word_timestamps_do_not_fail_the_sync(self):
        words = [{'word': 'Morning', 'start': 1, 'end': 1}, {'word': 'light', 'start': 1, 'end': 1}, {'word': 'Stars', 'start': 1, 'end': 1}]
        cues, _ = align_lyric_lines(['Morning', 'light', 'Stars'], words, 5)
        self.assertTrue(all(cue['end'] > cue['start'] for cue in cues))
        self.assertTrue(all(cues[index]['end'] <= cues[index + 1]['start'] for index in range(2)))

    @unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg required')
    def test_real_audio_decoding_bypasses_incompatible_pyav_api(self):
        import numpy as np
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / 'song.wav'
            with wave.open(str(audio), 'wb') as stream:
                stream.setnchannels(1)
                stream.setsampwidth(2)
                stream.setframerate(16000)
                stream.writeframes(np.zeros(32000, dtype=np.int16).tobytes())
            def transcribe(samples, **kwargs):
                self.assertIsInstance(samples, np.ndarray)
                self.assertEqual(len(samples), 32000)
                return [SimpleNamespace(end=1, words=[SimpleNamespace(word='Morning', start=0, end=.4), SimpleNamespace(word='light', start=.5, end=1)])], None
            words = transcribe_words(audio, 'small', Path(folder), 'en', lambda **_: None, model=SimpleNamespace(transcribe=transcribe))
            cues, coverage = align_lyric_lines(['Morning light'], words, 2)
            self.assertEqual(coverage, 1)
            self.assertEqual(cues[0]['text'], 'Morning light')

    @unittest.skipUnless(shutil.which('ffprobe'), 'FFprobe required')
    def test_upload_and_sync_job_round_trip(self):
        data = io.BytesIO()
        with wave.open(data, 'wb') as stream:
            stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(16000)
            stream.writeframes(b'\x00\x00' * 32000)
        with tempfile.TemporaryDirectory() as folder, patch.object(settings, 'data_dir', Path(folder)):
            database.init_db()
            client = TestClient(app)
            response = client.post('/api/video-audio', files={'file': ('song.wav', data.getvalue(), 'audio/wav')})
            self.assertEqual(response.status_code, 200)
            asset = response.json()
            self.assertEqual(len(asset['asset_id']), 32)
            self.assertAlmostEqual(asset['duration'], 2, delta=.01)
            result = ([{'start': 0, 'end': 1, 'text': 'Morning light', 'review': False}], 1.0)
            with patch('app.services.lyric_sync_service.sync_lyrics', return_value=result):
                started = client.post('/api/lyric-sync', json={'audio_asset_id': asset['asset_id'], 'lyrics': 'Morning light', 'language': 'en'})
                self.assertEqual(started.status_code, 200)
                for _ in range(100):
                    status = client.get(f"/api/jobs/{started.json()['job_id']}/status").json()
                    if status['done']: break
                    time.sleep(.01)
                self.assertTrue(status['done'])
                self.assertEqual(status['lyric_cues'][0]['text'], 'Morning light')
            self.assertEqual(client.post('/api/video-audio', files={'file': ('bad.mp3', b'not audio', 'audio/mpeg')}).status_code, 400)
            self.assertEqual(len(list((Path(folder) / 'video_audio').iterdir())), 1)
            self.assertEqual(client.post('/api/lyric-sync', json={'audio_asset_id': '../bad', 'lyrics': 'Hello'}).status_code, 422)
            client.close()

    def test_unicode_and_subtitle_commands(self):
        self.assertEqual(normalize_word('தமிழ்!'), 'தமிழ்')
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'lyrics.ass'
            edit = VideoEditRequest(canvas='portrait', lyrics=[{'start': 0, 'end': 1, 'text': r'{\pos(0,0)}தமிழ்'}])
            write_lyrics(path, edit, Path('unused'))
            text = path.read_text()
            self.assertIn('தமிழ்', text)
            self.assertNotIn(r'{\pos', text)
            self.assertIn('PlayResY: 1280', text)


if __name__ == '__main__':
    unittest.main()
