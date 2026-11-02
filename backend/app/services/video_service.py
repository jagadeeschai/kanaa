from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime
from email.utils import formatdate
from pathlib import Path
import re
from typing import Optional

from fastapi import Request, Response
from fastapi.responses import StreamingResponse

from app.core.config import settings
from app.db.database import get_connection
from app.utils.path_utils import VIDEO_MIME_TYPES

logger = logging.getLogger(__name__)


@dataclass
class VideoMetadata:
    duration: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    codec: Optional[str] = None
    date_taken: Optional[datetime] = None
    gps_lat: Optional[float] = None
    gps_lon: Optional[float] = None


def _run_ffprobe(path: Path) -> Optional[dict]:
    """Run ffprobe and return parsed JSON, or None on failure."""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        logger.warning("ffprobe not found on PATH — video metadata unavailable")
        return None
    try:
        result = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            capture_output=True, text=True, timeout=30, check=False,
        )
        if result.returncode != 0:
            return None
        return json.loads(result.stdout)
    except Exception as exc:
        logger.warning("ffprobe failed for %s: %s", path, exc)
        return None


def _parse_creation_time(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    # Common formats: "2024:01:15 10:30:00" (MOV) or "2024-01-15T10:30:00Z" (MP4)
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _parse_gps(text: Optional[str]) -> tuple[Optional[float], Optional[float]]:
    """Parse GPS from MOV/MP4 location string like '37.7749-122.4194' (lat-lon, with hemisphere signs)."""
    if not text:
        return None, None
    # Format from Canon MOV: "+37.7749-122.4194+000.000/" (lat, lon, alt)
    import re
    m = re.search(r"([+-]?\d+\.?\d*)([+-]\d+\.?\d*)", text)
    if m:
        try:
            return float(m.group(1)), float(m.group(2))
        except ValueError:
            pass
    return None, None


def extract_video_metadata(file_path: str | Path) -> VideoMetadata:
    """Extract video metadata via ffprobe."""
    path = Path(file_path)
    meta = VideoMetadata()
    data = _run_ffprobe(path)
    if data is None:
        return meta

    # Find the video stream
    streams = data.get("streams", [])
    video_stream = None
    for s in streams:
        if s.get("codec_type") == "video":
            video_stream = s
            break
    if video_stream:
        meta.codec = video_stream.get("codec_name")
        try:
            meta.width = int(video_stream.get("width", 0)) or None
            meta.height = int(video_stream.get("height", 0)) or None
        except (ValueError, TypeError):
            pass
        # Duration may be on stream or format
        try:
            meta.duration = float(video_stream.get("duration", 0)) or None
        except (ValueError, TypeError):
            pass

    fmt = data.get("format", {})
    if meta.duration is None:
        try:
            meta.duration = float(fmt.get("duration", 0)) or None
        except (ValueError, TypeError):
            pass

    # Date taken from creation_time (in format tags, often on format)
    tags = fmt.get("tags", {}) or {}
    creation_time = tags.get("creation_time") or tags.get("date")
    meta.date_taken = _parse_creation_time(creation_time)

    # GPS — Canon MOV stores it in format tags 'com.apple.quicktime.location.ISO6709'
    gps_str = tags.get("com.apple.quicktime.location.ISO6709") or tags.get("location")
    meta.gps_lat, meta.gps_lon = _parse_gps(gps_str)

    # Also check stream tags for creation_time
    if meta.date_taken is None and video_stream:
        vtags = video_stream.get("tags", {}) or {}
        meta.date_taken = _parse_creation_time(vtags.get("creation_time"))

    return meta


def generate_video_poster(file_path: str | Path, out_path: Path, duration: Optional[float] = None) -> bool:
    """Extract a poster frame from a video using ffmpeg. Returns True on success."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        logger.warning("ffmpeg not found — cannot generate video poster")
        return False
    # Seek to ~1s, or 10% of duration for short clips
    seek = 1.0
    if duration and duration < 5:
        seek = duration * 0.1
    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            [
                ffmpeg, "-ss", f"{seek}", "-i", str(file_path),
                "-frames:v", "1", "-vf", "scale=400:-1", "-q:v", "3",
                "-y", str(out_path),
            ],
            capture_output=True, timeout=30, check=True,
        )
        return out_path.exists()
    except Exception as exc:
        logger.warning("Video poster generation failed for %s: %s", file_path, exc)
        return False


UNSATISFIABLE_RANGE = (-1, -1)


def parse_byte_range(header: str, size: int) -> tuple[int, int] | None:
    """Reads a single-range header. None means serve the whole file, as the spec allows."""
    match = re.fullmatch(r"\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*", header, re.IGNORECASE)
    if not match or not (match[1] or match[2]):
        return None
    if not match[1]:
        length = int(match[2])
        return (max(0, size - length), size - 1) if length > 0 and size > 0 else UNSATISFIABLE_RANGE
    start = int(match[1])
    end = min(int(match[2]), size - 1) if match[2] else size - 1
    return (start, end) if start < size and start <= end else UNSATISFIABLE_RANGE


def serve_file_with_ranges(file_path: Path, content_mime: str, request: Request) -> Response:
    file_size = file_path.stat().st_size
    stat = file_path.stat()
    validators = {
        "ETag": f'"{stat.st_mtime_ns:x}-{file_size:x}"',
        "Last-Modified": formatdate(stat.st_mtime, usegmt=True),
    }

    # Parse Range header for seeking
    range_header = request.headers.get("range")
    if range_header:
        requested = parse_byte_range(range_header, file_size)
        if requested == UNSATISFIABLE_RANGE:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}", "Accept-Ranges": "bytes"})
        if requested is not None:
            start, end = requested
            content_length = end - start + 1

            def _range_gen(s: int, e: int):
                with open(file_path, "rb") as f:
                    f.seek(s)
                    remaining = e - s + 1
                    while remaining > 0:
                        chunk = f.read(min(1024 * 1024, remaining))
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        yield chunk

            headers = {
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(content_length),
                "Content-Type": content_mime,
                **validators,
            }
            return StreamingResponse(_range_gen(start, end), status_code=206, headers=headers)

    # No Range header — stream whole file
    def _full_gen():
        with open(file_path, "rb") as f:
            while True:
                chunk = f.read(1024 * 1024)
                if not chunk:
                    break
                yield chunk

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(file_size),
        "Content-Type": content_mime,
        **validators,
    }
    return StreamingResponse(_full_gen(), status_code=200, headers=headers)


def serve_video_stream(photo_id: int, request: Request) -> Response:
    """Stream a video file with HTTP Range support for seeking."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT absolute_path, file_extension, media_type FROM photos WHERE id = ?",
            (photo_id,),
        ).fetchone()
    if row is None:
        return Response(status_code=404, content=b"Not found", media_type="text/plain")
    if row["media_type"] != "video":
        return Response(status_code=400, content=b"Not a video", media_type="text/plain")

    file_path = Path(row["absolute_path"])
    if not file_path.exists():
        return Response(status_code=404, content=b"Not found", media_type="text/plain")

    ext = row["file_extension"].lower()
    return serve_file_with_ranges(file_path, VIDEO_MIME_TYPES.get(ext, "application/octet-stream"), request)

