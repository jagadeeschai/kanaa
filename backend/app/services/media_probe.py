"""What the editor needs to know about a source file."""
from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Any

from app.services.video_edit_service import HDR_TRANSFERS, media_duration
from app.services.video_service import _run_ffprobe


@dataclass
class MediaFacts:
    path: Path
    media_type: str
    width: int | None = None
    height: int | None = None
    duration: float | None = None
    fps: float | None = None
    rotation: int = 0
    has_audio: bool = False
    color_space: str | None = None
    color_transfer: str | None = None

    @property
    def is_hdr(self) -> bool:
        return self.color_transfer in HDR_TRANSFERS


def frame_rate(stream: dict[str, Any]) -> float | None:
    for key in ('avg_frame_rate', 'r_frame_rate'):
        try:
            value = float(Fraction(stream.get(key) or '0/0'))
        except (ValueError, ZeroDivisionError):
            continue
        if value > 0:
            return round(value, 3)
    return None


def probe_video(path: Path) -> MediaFacts | None:
    info = _run_ffprobe(path) or {}
    video = next((s for s in info.get('streams', []) if s.get('codec_type') == 'video'), None)
    if not video or media_duration(info) <= 0:
        return None
    rotation = next((int(item['rotation']) for item in video.get('side_data_list', []) if 'rotation' in item), 0)
    rotation = int(rotation or video.get('tags', {}).get('rotate', 0) or 0) % 360
    width, height = video.get('width'), video.get('height')
    if rotation in (90, 270):
        width, height = height, width
    return MediaFacts(path=path, media_type='video', width=width, height=height, duration=media_duration(info), fps=frame_rate(video), rotation=rotation,
                      has_audio=any(s.get('codec_type') == 'audio' for s in info.get('streams', [])),
                      color_space=video.get('color_space'), color_transfer=video.get('color_transfer'))


LOCAL_DATE_TAGS = ('com.apple.quicktime.creationdate', 'com.blackmagic-design.camera.dateRecorded')


def recorded_at(path: Path) -> str | None:
    """When a video was filmed or a photo taken, as local wall-clock time 'YYYY-MM-DDTHH:MM', or None when it isn't recorded.

    A tag written with the camera's own time and offset is used as written; a UTC creation_time is turned into this
    Mac's time; a photo's EXIF DateTimeOriginal is already local."""
    import json
    import shutil
    import subprocess
    from datetime import datetime, timezone
    path = Path(path)
    if path.suffix.lower() in ('.jpg', '.jpeg', '.heic', '.png', '.tif', '.tiff', '.webp'):
        try:
            from PIL import Image
            with Image.open(path) as image:
                exif = image.getexif()
                value = exif.get_ifd(0x8769).get(36867) or exif.get(306)
            return datetime.strptime(str(value).strip(), '%Y:%m:%d %H:%M:%S').strftime('%Y-%m-%dT%H:%M') if value else None
        except Exception:
            return None
    try:
        info = json.loads(subprocess.run([shutil.which('ffprobe') or 'ffprobe', '-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', str(path)],
                                         capture_output=True, text=True, timeout=30).stdout or '{}')
    except Exception:
        return None
    tags = {**{k: v for stream in info.get('streams', []) for k, v in (stream.get('tags') or {}).items()}, **(info.get('format', {}).get('tags') or {})}
    for name in LOCAL_DATE_TAGS:
        if value := tags.get(name):
            try:
                return datetime.fromisoformat(value.replace('Z', '+00:00')[:19]).strftime('%Y-%m-%dT%H:%M')
            except ValueError:
                continue
    if value := tags.get('creation_time'):
        try:
            moment = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if moment.year > 1971:  # Cameras with no clock write 1970 or 1904.
                return (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).astimezone().strftime('%Y-%m-%dT%H:%M')
        except ValueError:
            pass
    return None
