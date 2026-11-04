import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.database import init_db
from app.main import app
from app.services import phone_service

PHONE = ('192.168.1.50', 50000)


class PhoneAccess(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.saved, settings.data_dir = settings.data_dir, Path(self.folder.name)
        phone_service._misses.clear()
        init_db()
        self.mac = TestClient(app)
        self.phone = TestClient(app, client=PHONE)

    def tearDown(self):
        settings.data_dir = self.saved
        self.folder.cleanup()

    def test_off_by_default_the_phone_is_turned_away_and_the_mac_is_not(self):
        self.assertEqual(self.phone.get('/api/projects').status_code, 403)
        self.assertEqual(self.phone.get('/').status_code, 403)
        self.assertEqual(self.mac.get('/api/projects').status_code, 200)
        self.assertFalse(self.mac.get('/api/phone').json()['enabled'])

    def test_the_right_pin_lets_a_phone_in_and_a_new_pin_signs_it_out(self):
        pin = self.mac.post('/api/phone', json={'enabled': True}).json()['pin']
        self.assertRegex(pin, r'^\d{6}$')
        page = self.phone.get('/')
        self.assertIn('Enter the PIN', page.text)
        self.assertEqual(self.phone.get('/api/projects').status_code, 401)
        self.assertEqual(self.phone.post('/api/phone/login', json={'pin': '000000' if pin != '000000' else '111111'}).status_code, 401)
        answer = self.phone.post('/api/phone/login', json={'pin': pin})
        self.assertEqual(answer.status_code, 200)
        self.assertIn('httponly', answer.headers['set-cookie'].lower())
        self.assertIn('samesite=strict', answer.headers['set-cookie'].lower())
        self.assertEqual(self.phone.get('/api/projects').status_code, 200)
        # A phone can't read the PIN or change phone access.
        self.assertEqual(self.phone.get('/api/phone').status_code, 403)
        self.assertEqual(self.phone.post('/api/phone/new-pin').status_code, 403)
        self.mac.post('/api/phone/new-pin')
        self.assertEqual(self.phone.get('/api/projects').status_code, 401)
        # Turning it off shuts the door at once, even for a phone that was in.
        fresh = self.mac.get('/api/phone').json()['pin']
        self.phone.post('/api/phone/login', json={'pin': fresh})
        self.mac.post('/api/phone', json={'enabled': False})
        self.assertEqual(self.phone.get('/api/projects').status_code, 403)

    def test_wrong_pins_slow_a_device_down_and_too_many_lock_it(self):
        pin = self.mac.post('/api/phone', json={'enabled': True}).json()['pin']
        wrong = '000000' if pin != '000000' else '111111'
        for _ in range(phone_service.TRIES_PER_DEVICE):
            self.phone.post('/api/phone/login', json={'pin': wrong})
        waiting = self.phone.post('/api/phone/login', json={'pin': pin})
        self.assertEqual(waiting.status_code, 401)
        self.assertIn('Wait', waiting.json()['detail'])
        with patch.object(phone_service, 'TRIES_IN_ALL', 7):
            for index in range(10):
                TestClient(app, client=(f'192.168.1.{60 + index}', 1)).post('/api/phone/login', json={'pin': wrong})
        self.assertTrue(self.mac.get('/api/phone').json()['locked'])
        self.assertEqual(TestClient(app, client=('192.168.1.99', 1)).post('/api/phone/login', json={'pin': pin}).status_code, 401)
        self.assertFalse(self.mac.post('/api/phone/new-pin').json()['locked'])


if __name__ == '__main__':
    unittest.main()
