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
