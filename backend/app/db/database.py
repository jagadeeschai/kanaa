import sqlite3
from app.core.config import settings

class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def get_connection():
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.data_dir / 'motion.db', factory=ClosingConnection, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA journal_mode=WAL')
    return conn


def init_db():
    with get_connection() as conn:
        conn.executescript('''
        CREATE TABLE IF NOT EXISTS photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, absolute_path TEXT NOT NULL UNIQUE,
            media_type TEXT NOT NULL, width INTEGER, height INTEGER, duration REAL, file_size INTEGER,
            is_export INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL,
            media_id INTEGER NOT NULL REFERENCES photos(id), recipe TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS image_batches (
            id TEXT PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            lyrics TEXT NOT NULL, style TEXT NOT NULL, brief TEXT NOT NULL, canvas TEXT NOT NULL,
            job_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS image_scenes (
            id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT NOT NULL REFERENCES image_batches(id) ON DELETE CASCADE,
            position INTEGER NOT NULL, lyric TEXT NOT NULL, prompt TEXT NOT NULL,
            start REAL, end REAL, status TEXT NOT NULL DEFAULT 'draft',
            media_id INTEGER REFERENCES photos(id), error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_image_batches_project ON image_batches(project_id);
        CREATE TABLE IF NOT EXISTS render_jobs (
            id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, status TEXT NOT NULL,
            error TEXT, output_photo_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, finished_at TEXT
        );
        CREATE TABLE IF NOT EXISTS media_folders (
            name TEXT PRIMARY KEY COLLATE NOCASE,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        ''')
        # Added for the timeline; older databases gain them here and fill in on next use.
        existing = {row['name'] for row in conn.execute('PRAGMA table_info(photos)')}
        for column, definition in (('fps', 'REAL'), ('rotation', 'INTEGER NOT NULL DEFAULT 0'), ('has_audio', 'INTEGER NOT NULL DEFAULT 0'), ('folder', 'TEXT')):
            if column not in existing:
                conn.execute(f'ALTER TABLE photos ADD COLUMN {column} {definition}')
        conn.execute("INSERT OR IGNORE INTO media_folders(name) SELECT DISTINCT folder FROM photos WHERE folder IS NOT NULL AND TRIM(folder) != ''")
        conn.commit()
