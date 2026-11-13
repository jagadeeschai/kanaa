import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient


class Routes(unittest.TestCase):
    def test_signatures_are_listed_and_a_card_needs_a_title(self):
        from app.main import app
        from kanaa_mcp import signature
        with tempfile.TemporaryDirectory() as folder, mock.patch('app.api.signature_routes.settings') as settings:
            settings.data_dir = Path(folder)
            signature.save(Path(folder), 'பாவேந்தர் பாரதிதாசன்', {'lyricist': 'பாவேந்தர் பாரதிதாசன்', 'lyricist_english': 'Bharathidasan', 'roles': [['பாடல் வரிகள்', 'Lyrics', 'x']], 'paper': 1})
            client = TestClient(app)
            listed = client.get('/api/signatures').json()
            self.assertEqual(listed[0]['lyricist_english'], 'Bharathidasan')
            self.assertEqual(client.post('/api/signatures/பாவேந்தர் பாரதிதாசன்/card', json={'title': ' '}).status_code, 400)
            self.assertEqual(client.post('/api/signatures/nobody/card', json={'title': 'x'}).status_code, 404)
