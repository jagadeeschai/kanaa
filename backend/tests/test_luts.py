import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from app.core.config import settings
from app.services import lut_service


IDENTITY_2 = """TITLE \"Identity\"
LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
"""


class Luts(unittest.TestCase):
    def test_library_parses_and_caches_a_preview_without_changing_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'pack'; source.mkdir()
            cube = source / 'My Film.CUBE'; cube.write_text(IDENTITY_2)
            with patch.object(lut_service, 'SOURCE', source), patch.object(settings, 'data_dir', root / 'data'):
                listed = lut_service.library()
                self.assertEqual([item['name'] for item in listed], ['My Film'])
                size, rows = lut_service.read(listed[0]['id'])
                self.assertEqual((size, rows.shape), (2, (8, 3)))
                preview = lut_service.atlas(listed[0]['id'])
                with Image.open(preview) as picture:
                    self.assertEqual(picture.size, (4, 2))
                self.assertEqual(cube.read_text(), IDENTITY_2)

    def test_bad_or_missing_luts_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder)
            (source / 'Bad.cube').write_text('LUT_3D_SIZE 2\n0 0 0\n')
            with patch.object(lut_service, 'SOURCE', source):
                item = lut_service.library()[0]
                with self.assertRaisesRegex(ValueError, 'supported 3D LUT'):
                    lut_service.read(item['id'])
                with self.assertRaisesRegex(ValueError, 'no longer'):
                    lut_service.resolve('missing')


if __name__ == '__main__':
    unittest.main()
