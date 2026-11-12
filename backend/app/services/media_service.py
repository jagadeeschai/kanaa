import re
from pathlib import Path
from fastapi import HTTPException
from PIL import Image, ImageOps
from app.db.database import get_connection
from app.services.media_probe import probe_video

def get_media(identifier):
    with get_connection() as conn:
        row = conn.execute('SELECT * FROM photos WHERE id=?', (identifier,)).fetchone()
    if not row:
        raise HTTPException(404, 'Media not found')
    return row


def describe(row):
    return {**dict(row), 'library_id': 1, 'file_extension': Path(row['absolute_path']).suffix,
            'edit_settings': None, 'photo_type': row['media_type'], 'file_mtime_ns': None}


def song_folder(project_name: str) -> str | None:
    """The library folder for a song's media: the project's name without a trailing ' – Lyric video' and the like."""
    name = re.sub(r'\s*[–—-]\s*(3D\s+)?lyric\s+video\s*$', '', project_name or '', flags=re.IGNORECASE).strip()
    return name[:60] or None


def index_media(path: Path, name: str, exported=False, folder: str | None = None):
    image_extensions = {'.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp'}
    if path.suffix.lower() in image_extensions:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            width, height = ImageOps.exif_transpose(image).size
        kind, duration, fps, rotation, has_audio = 'image', None, None, 0, False
    else:
        facts = probe_video(path)
        if facts is None:
            raise ValueError('This file is not a readable image or video.')
        width, height, duration, fps, rotation, has_audio = facts.width, facts.height, facts.duration, facts.fps, facts.rotation, facts.has_audio
        kind = 'video'
    with get_connection() as conn:
        cursor = conn.execute('INSERT INTO photos(filename,absolute_path,media_type,width,height,duration,file_size,is_export,fps,rotation,has_audio) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                              (name, str(path.resolve()), kind, width, height, duration, path.stat().st_size, int(exported), fps, rotation, int(has_audio)))
        identifier = cursor.lastrowid
        if folder and not exported:
            # New media can go straight into a library folder (a song's folder for lyric media).
            conn.execute('INSERT OR IGNORE INTO media_folders(name) VALUES(?)', (folder,))
            conn.execute('UPDATE photos SET folder=? WHERE id=?', (folder, identifier))
        conn.commit()
    return describe(get_media(identifier))

