"""Edit with AI: the request reaches the provider with the picture, the result becomes a new picture, the original
stays, and a failure leaves nothing behind. The provider is faked: no network."""
import io
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

from app.services import ai_image_edit


def png(width=8, height=8):
    buffer = io.BytesIO(); Image.new('RGB', (width, height), 'red').save(buffer, 'PNG'); return buffer.getvalue()


class EditWithAI(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.source = self.root / 'scene.webp'
        Image.new('RGB', (30, 20), 'blue').save(self.source, 'WEBP')
        self.row = {'id': 7, 'filename': 'scene.webp', 'absolute_path': str(self.source), 'media_type': 'image', 'width': 1536, 'height': 1024, 'folder': 'Song'}
        self.jobs = []
        patches = [mock.patch.object(ai_image_edit, 'get_media', return_value=self.row),
                   mock.patch.object(ai_image_edit, 'read_settings', return_value={'api_key': 'k', 'base_url': 'https://example.invalid/v1', 'model': 'm'}),
                   mock.patch.object(ai_image_edit, 'enqueue_render', side_effect=lambda kind, label, run, **_: self.jobs.append((kind, run)) or 'job-1'),
                   mock.patch.object(ai_image_edit, 'update_job'),
                   mock.patch.object(ai_image_edit.settings, 'data_dir', self.root)]
        for patch in patches:
            patch.start(); self.addCleanup(patch.stop)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_sends_the_picture_and_request_and_saves_a_new_picture(self):
        calls = []

        async def provider(config, prompt, size, quality, references, should_cancel):
            calls.append((prompt, size, quality, [Path(p).suffix for p in references], all(Path(p).exists() for p in references)))
            return png()
        with mock.patch.object(ai_image_edit, 'request_image_with_references', provider), \
             mock.patch.object(ai_image_edit, 'index_media', return_value={'id': 99}) as index:
            self.assertEqual(ai_image_edit.start_edit(7, 'make it a rainy evening'), 'job-1')
            kind, run = self.jobs[0]
            self.assertEqual(kind, 'ai_edit')
            self.assertEqual(run(lambda: False), {'progress': 100, 'media_id': 99})
        prompt, size, quality, suffixes, existed = calls[0]
        self.assertIn('make it a rainy evening', prompt)
        self.assertEqual((size, quality, suffixes, existed), ('1536x1024', 'medium', ['.png'], True))  # WebP sent as PNG.
        saved, name = index.call_args.args
        self.assertTrue(saved.exists()); self.assertEqual(name, 'scene (AI edit).png'); self.assertEqual(index.call_args.kwargs['folder'], 'Song')
        self.assertTrue(self.source.exists())  # The original is untouched.
        self.assertEqual(sorted(p.name for p in (self.root / 'media').iterdir()), [saved.name])  # The converted copy is gone.

    def test_a_failed_request_leaves_nothing(self):
        async def provider(*_):
            raise ValueError('The provider limit was reached.')
        with mock.patch.object(ai_image_edit, 'request_image_with_references', provider), mock.patch.object(ai_image_edit, 'index_media') as index:
            ai_image_edit.start_edit(7, 'brighter')
            with self.assertRaises(ValueError):
                self.jobs[0][1](lambda: False)
        index.assert_not_called()
        self.assertEqual(list((self.root / 'media').iterdir()) if (self.root / 'media').exists() else [], [])

    def test_refuses_videos_empty_requests_and_no_key(self):
        with self.assertRaises(ValueError):
            ai_image_edit.start_edit(7, '   ')
        self.row['media_type'] = 'video'
        with self.assertRaises(ValueError):
            ai_image_edit.start_edit(7, 'brighter')
        self.row['media_type'] = 'image'
        with mock.patch.object(ai_image_edit, 'read_settings', return_value={'api_key': ''}), self.assertRaises(ValueError):
            ai_image_edit.start_edit(7, 'brighter')

    def test_size_follows_the_picture_shape(self):
        self.assertEqual([ai_image_edit.size_for(*s) for s in ((1920, 1080), (1080, 1920), (1000, 1000))], ['1536x1024', '1024x1536', '1024x1024'])


if __name__ == '__main__':
    unittest.main()
