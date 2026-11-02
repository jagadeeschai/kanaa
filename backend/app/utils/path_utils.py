from __future__ import annotations

import os
from pathlib import Path


IMAGE_EXTENSIONS = {
    # Common formats
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp", ".heic", ".heif",
    # RAW formats (Canon, Nikon, Sony, etc.)
    ".cr2", ".cr3",  # Canon
    ".nef", ".nrw",  # Nikon
    ".arw", ".srf", ".sr2",  # Sony
    ".dng",  # Adobe Digital Negative
    ".orf",  # Olympus
    ".rw2",  # Panasonic
    ".pef",  # Pentax
    ".raf",  # Fujifilm
}

VIDEO_EXTENSIONS = {
    ".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".wmv", ".3gp", ".mpg", ".mpeg",
}

# MIME types for video streaming (Range support)
VIDEO_MIME_TYPES = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".wmv": "video/x-ms-wmv",
    ".3gp": "video/3gpp",
    ".mpg": "video/mpeg",
    ".mpeg": "video/mpeg",
}


def validate_absolute_directory(directory_path: str) -> Path:
    if not directory_path or not directory_path.strip():
        raise ValueError("directory_path is required")

    path = Path(directory_path).expanduser()
    if not path.is_absolute():
        raise ValueError("directory_path must be an absolute path")
    if not path.exists():
        raise FileNotFoundError(f"Directory does not exist: {directory_path}")
    if not path.is_dir():
        raise NotADirectoryError(f"Path is not a directory: {directory_path}")
    return path.resolve()


def is_image_file(filename: str) -> bool:
    return os.path.splitext(filename.lower())[1] in IMAGE_EXTENSIONS


def is_video_file(filename: str) -> bool:
    return os.path.splitext(filename.lower())[1] in VIDEO_EXTENSIONS


def is_media_file(filename: str) -> bool:
    return is_image_file(filename) or is_video_file(filename)


def get_media_type(filename: str) -> str:
    """Return 'image', 'video', or 'unknown' for a filename."""
    if is_image_file(filename):
        return "image"
    if is_video_file(filename):
        return "video"
    return "unknown"


def safe_relative_path(root: Path, file_path: Path) -> str:
    return str(file_path.relative_to(root)).replace("\\", "/")


def list_subdirectories(path: Path) -> list[dict[str, str]]:
    """Return a sorted list of non-hidden subdirectories under `path`."""
    entries: list[dict[str, str]] = []
    try:
        for child in path.iterdir():
            if child.name.startswith("."):
                continue
            if child.is_dir():
                entries.append({"name": child.name, "path": str(child.resolve())})
    except PermissionError:
        return []
    entries.sort(key=lambda e: e["name"].lower())
    return entries


def get_quick_paths() -> list[dict[str, str]]:
    """Return common user directories that exist on this system."""
    home = Path.home()
    candidates = [
        ("Home", home),
        ("Desktop", home / "Desktop"),
        ("Documents", home / "Documents"),
        ("Downloads", home / "Downloads"),
        ("Pictures", home / "Pictures"),
    ]
    return [
        {"label": label, "path": str(p.resolve())}
        for label, p in candidates
        if p.exists() and p.is_dir()
    ]

