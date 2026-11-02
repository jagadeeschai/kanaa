from pathlib import Path
from fastapi import HTTPException
from PIL import Image, ImageOps
from app.db.database import get_connection
from app.services.video_service import _run_ffprobe
from app.services.video_edit_service import media_duration

def get_media(identifier):
    with get_connection() as conn:
        row = conn.execute('SELECT * FROM photos WHERE id=?', (identifier,)).fetchone()
    if not row:
        raise HTTPException(404, 'Media not found')
    return row


def describe(row):
    return {**dict(row), 'library_id': 1, 'file_extension': Path(row['absolute_path']).suffix,
            'edit_settings': None, 'photo_type': row['media_type'], 'file_mtime_ns': None}


def index_media(path: Path, name: str, exported=False):
    image_extensions = {'.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp'}
    if path.suffix.lower() in image_extensions:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            width, height = ImageOps.exif_transpose(image).size
        kind, duration = 'image', None
    else:
        info = _run_ffprobe(path) or {}
        video = next((stream for stream in info.get('streams', []) if stream.get('codec_type') == 'video'), None)
        if not video or media_duration(info) <= 0:
            raise ValueError('This file is not a readable image or video.')
        width, height = video.get('width'), video.get('height')
        kind, duration = 'video', media_duration(info)
    with get_connection() as conn:
        cursor = conn.execute('INSERT INTO photos(filename,absolute_path,media_type,width,height,duration,file_size,is_export) VALUES(?,?,?,?,?,?,?,?)',
                              (name, str(path.resolve()), kind, width, height, duration, path.stat().st_size, int(exported)))
        conn.commit()
        identifier = cursor.lastrowid
    return describe(get_media(identifier))

