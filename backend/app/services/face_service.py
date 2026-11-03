"""Finds every face in a stretch of video, as one path per person, for blur boxes. Runs on this Mac."""
from __future__ import annotations

import hashlib
import logging
import threading
import urllib.request
from pathlib import Path
from typing import Callable

import numpy as np

from app.core.config import settings
from app.services.job_service import JobCancelled
from app.services.tracking_service import FPS, frames, smooth, work_size

logger = logging.getLogger(__name__)
# OpenCV's YuNet face detector, MIT licence, from the official OpenCV model zoo. The hash pins the exact file.
MODEL_NAME = 'face_detection_yunet_2023mar.onnx'
MODEL_URL = f'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/{MODEL_NAME}'
MODEL_SHA256 = '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'
MIN_SCORE = 0.6
LINK_REACH = 0.8  # How far a face can move between sightings, in face widths.
MAX_GAP_FRAMES = 15  # A blink, a turn or a hand in front, filled in from either side.
MIN_FRAMES = 8  # Shorter sightings are usually not faces.
MAX_FACES = 12
MIN_SIZE_SHARE = 0.9  # Of a person's usual face size.
PAD_WIDTH, PAD_HEIGHT = 1.35, 1.5  # The detector's box stops at the hairline and chin.
_download = threading.Lock()


def model_path() -> Path:
    """The detector's file, fetched once and checked against its known hash."""
    target = settings.model_cache_dir / 'face' / MODEL_NAME
    with _download:
        if target.is_file():
            return target
        target.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(MODEL_URL, timeout=60) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != MODEL_SHA256:
            raise RuntimeError('The face detector download was not the expected file. Check your connection and try again.')
        temporary = target.with_suffix('.tmp')
        temporary.write_bytes(data)
        temporary.replace(target)
    return target


Box = tuple[float, float, float, float]


def link(sightings: list[list[tuple[Box, float]]]) -> list[dict[int, Box]]:
    """Joins each frame's faces into people: a face continues the nearest person seen recently, else starts a new one."""
    people: list[dict[int, Box]] = []
    for index, found in enumerate(sightings):
        taken: set[int] = set()
        for box, _score in sorted(found, key=lambda item: -item[1]):
            best, gap = None, LINK_REACH
            for number, person in enumerate(people):
                last = max(person)
                if number in taken or index - last > MAX_GAP_FRAMES:
                    continue
                previous = person[last]
                distance = np.hypot(box[0] - previous[0], box[1] - previous[1]) / max(box[2], previous[2])
                if distance < gap:
                    best, gap = number, distance
            if best is None:
                people.append({index: box})
                taken.add(len(people) - 1)
            else:
                people[best][index] = box
                taken.add(best)
    return people


def fill(person: dict[int, Box]) -> list[Box]:
    """Every frame from the first sighting to the last, with gaps drawn straight across."""
    seen = sorted(person)
    values = np.array([person[index] for index in seen])
    every = np.arange(seen[0], seen[-1] + 1)
    return [tuple(row) for row in np.stack([np.interp(every, seen, values[:, column]) for column in range(4)], axis=1).tolist()]


def padded(box: Box) -> Box:
    x, y, w, h = box
    return x, y, min(1.0, w * PAD_WIDTH), min(1.0, h * PAD_HEIGHT)


def find_faces(source: Path, source_size: tuple[int, int], start: float, end: float, on_progress: Callable[[int], None], should_cancel: Callable[[], bool],
               detector_factory: Callable[[tuple[int, int]], Callable[[np.ndarray], list[tuple[Box, float]]]] | None = None) -> dict:
    """Faces between `start` and `end`, source seconds. Each is a list of [seconds, x, y, width, height], 0 to 1, like a tracked path."""
    size = work_size(source_size)
    first, last = round(start * FPS), max(round(start * FPS), round(end * FPS) - 1)
    total = last - first + 1
    detect = (detector_factory or yunet)(size)
    sightings: list[list[tuple[Box, float]]] = []
    for number, picture in enumerate(frames(source, first, total, size)):
        if should_cancel():
            raise JobCancelled()
        sightings.append(detect(picture))
        on_progress(min(99, (number + 1) * 100 // total))
    people = [person for person in link(sightings) if len(person) >= MIN_FRAMES]
    # The biggest faces first, as they matter most when there are too many.
    people.sort(key=lambda person: -np.mean([box[2] * box[3] for box in person.values()]))
    faces = []
    for person in people[:MAX_FACES]:
        begin = first + min(person)
        # A half-hidden face gives a smaller box. For privacy the blur stays near the person's usual size instead.
        usual_w, usual_h = (float(np.median([box[index] for box in person.values()])) * MIN_SIZE_SHARE for index in (2, 3))
        path = smooth([padded((x, y, max(w, usual_w), max(h, usual_h))) for x, y, w, h in fill(person)])
        faces.append([[round((begin + index) / FPS, 4), *(round(value, 5) for value in box)] for index, box in enumerate(path)])
    faces.sort(key=lambda path: path[0][0])
    return {'faces': faces, 'more': max(0, len(people) - MAX_FACES)}


def yunet(size: tuple[int, int]) -> Callable[[np.ndarray], list[tuple[Box, float]]]:
    import cv2  # Loaded only when finding faces, as it is large.
    width, height = size
    detector = cv2.FaceDetectorYN.create(str(model_path()), '', size, MIN_SCORE, 0.3, 50)

    def detect(picture: np.ndarray) -> list[tuple[Box, float]]:
        _, found = detector.detect(picture)
        if found is None:
            return []
        return [(((x + w / 2) / width, (y + h / 2) / height, w / width, h / height), float(row[14])) for row in found for x, y, w, h in [row[:4]]]
    return detect
