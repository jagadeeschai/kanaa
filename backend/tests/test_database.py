import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.core.config import settings
from app.db import database


class ConnectionLifetimeTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.patch = patch.object(settings, 'data_dir', Path(self.folder.name))
        self.patch.start()
        database.init_db()

    def tearDown(self):
        self.patch.stop()
        self.folder.cleanup()

    def test_kept_rows_do_not_hold_connections_open(self):
        before = len(os.listdir('/dev/fd'))
        rows = []
        for _ in range(30):
            with database.get_connection() as conn:
                rows.append(conn.execute("SELECT 1 AS value").fetchone())
        self.assertLessEqual(len(os.listdir('/dev/fd')) - before, 2)
        self.assertEqual(rows[0]['value'], 1)

    def test_commits_on_success_and_rolls_back_on_error(self):
        with database.get_connection() as conn:
            conn.execute("INSERT INTO render_jobs (id, kind, label, status) VALUES ('kept', 'test', 'kept', 'done')")
        with self.assertRaises(ValueError):
            with database.get_connection() as conn:
                conn.execute("INSERT INTO render_jobs (id, kind, label, status) VALUES ('dropped', 'test', 'dropped', 'done')")
                raise ValueError
        with database.get_connection() as conn:
            names = [row['id'] for row in conn.execute('SELECT id FROM render_jobs')]
        self.assertEqual(names, ['kept'])

    def test_connection_is_closed_after_the_block(self):
        with database.get_connection() as conn:
            pass
        with self.assertRaises(sqlite3.ProgrammingError):
            conn.execute('SELECT 1')
