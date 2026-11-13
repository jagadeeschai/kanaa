import asyncio
import base64
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import httpx

from app.services.image_references import request_image_with_references


class References(unittest.TestCase):
    def test_references_go_as_input_pictures_to_the_edit_request(self):
        seen = {}

        async def post(self, url, headers=None, data=None, files=None):
            seen.update(url=url, data=data, files=[name for _, (name, _, _) in files], auth=headers['Authorization'])
            return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(b'PNG').decode()}]})
        with tempfile.TemporaryDirectory() as folder:
            pictures = []
            for name in ('day.png', 'night.png'):
                path = Path(folder) / name; path.write_bytes(b'x'); pictures.append(path)
            with mock.patch.object(httpx.AsyncClient, 'post', post):
                image = asyncio.run(request_image_with_references({'base_url': 'https://example.test/v1', 'api_key': 'k', 'model': 'm'}, 'the same couple', '1536x1024', 'medium', pictures, lambda: False))
        self.assertEqual(image, b'PNG')
        self.assertEqual(seen['url'], 'https://example.test/v1/images/edits')
        self.assertEqual(seen['files'], ['day.png', 'night.png'])
        self.assertEqual(seen['data']['size'], '1536x1024')


if __name__ == '__main__':
    unittest.main()
