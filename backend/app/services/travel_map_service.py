"""Travel maps: the places of a trip, and the way between them, for an animated route map.

Map outlines come from Natural Earth (public domain; India's borders as India shows them) and the place list from
GeoNames (cities over 15,000 people, CC BY 4.0). Both are downloaded once, only after the person agrees, and kept in
the data folder. Place search runs on this Mac. Flights follow the great circle, worked out here. Road trips ask the
free OSRM route server (no key; only the two points are sent), keep each answer, and fall back to a gentle curve when
it can't be reached. Road data is © OpenStreetMap contributors, credited on the map.
"""
from __future__ import annotations

import hashlib
import json
import math
import pickle
import re
import threading
import unicodedata
import zipfile
from functools import lru_cache
from pathlib import Path
from typing import Callable

import httpx
import numpy as np

from app.core.config import settings
from app.services.job_service import JobCancelled

NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'
SOURCES = {
    'countries.geojson': (NE + 'ne_10m_admin_0_countries_ind.geojson', 13.2),
    'states.geojson': (NE + 'ne_50m_admin_1_states_provinces.geojson', 2.3),
    'lakes.geojson': (NE + 'ne_50m_lakes.geojson', 0.9),
    'rivers.geojson': (NE + 'ne_50m_rivers_lake_centerlines.geojson', 0.8),
    'cities15000.zip': ('https://download.geonames.org/export/dump/cities15000.zip', 2.9),
}
OSRM = 'https://router.project-osrm.org/route/v1/driving/{a};{b}?overview=full&geometries=geojson'
TAMIL = re.compile(r'[஀-௿]')
CACHE_VERSION = 1
_lock = threading.Lock()
# Tests swap this for an httpx.MockTransport; nothing else changes it.
transport: httpx.BaseTransport | None = None


def folder() -> Path:
    return settings.data_dir / 'maps'


def status() -> dict:
    missing = [name for name in SOURCES if not (folder() / name).is_file()]
    return {'ready': not missing, 'missing': missing, 'size_mb': round(sum(SOURCES[name][1] for name in missing), 1),
            'sources': 'Natural Earth (public domain) and GeoNames (CC BY 4.0)'}


def looks_right(name: str, content: bytes) -> bool:
    """A real map file, not an error page: a zip archive, or GeoJSON."""
    if name.endswith('.zip'):
        return content[:2] == b'PK'
    return content.lstrip()[:1] == b'{' and b'FeatureCollection' in content[:2000]


def download(on_progress: Callable[[int], None] = lambda _: None, should_cancel: Callable[[], bool] = lambda: False) -> dict:
    """Fetches the missing map files, one by one, each saved whole or not at all."""
    folder().mkdir(parents=True, exist_ok=True)
    missing = status()['missing']
    with httpx.Client(timeout=httpx.Timeout(120, connect=20), transport=transport, follow_redirects=True) as client:
        for number, name in enumerate(missing):
            if should_cancel():
                raise JobCancelled()
            response = client.get(SOURCES[name][0])
            if response.status_code != 200 or not looks_right(name, response.content):
                raise RuntimeError(f'Could not download the map data ({name}: {response.status_code}). Check the connection and try again.')
            temporary = folder() / f'{name}.part'
            temporary.write_bytes(response.content)
            temporary.replace(folder() / name)
            on_progress(min(99, (number + 1) * 100 // max(1, len(missing))))
    load_places.cache_clear(); load_layers.cache_clear()
    return status()


# ---- Places ----

def fold(text: str) -> str:
    return unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode().lower().strip()


@lru_cache(maxsize=1)
def load_places() -> list[dict]:
    """GeoNames cities: name, Tamil name when there is one, country, lat, lon, population."""
    path = folder() / 'cities15000.zip'
    if not path.is_file():
        return []
    with zipfile.ZipFile(path) as archive:
        text = archive.read(next(name for name in archive.namelist() if name.endswith('.txt'))).decode('utf-8')
    places = []
    for line in text.splitlines():
        row = line.split('\t')
        if len(row) < 15:
            continue
        others = [name for name in row[3].split(',') if name]
        tamil = next((name for name in others if TAMIL.search(name)), '')
        places.append({'id': int(row[0]), 'name': row[1], 'tamil': tamil, 'country': row[8], 'lat': float(row[4]), 'lon': float(row[5]),
                       'population': int(row[14] or 0), 'keys': {fold(row[1]), fold(row[2]), *(fold(name) for name in others if not TAMIL.search(name)), *(name for name in others if TAMIL.search(name))}})
    return places


def search(query: str, limit: int = 8) -> list[dict]:
    """Places whose name starts with (or, after those, contains) the query, biggest first. Tamil names work too."""
    wanted = query.strip() if TAMIL.search(query) else fold(query)
    if len(wanted) < 2:
        return []
    starts, contains = [], []
    for place in load_places():
        if any(key.startswith(wanted) for key in place['keys']):
            starts.append(place)
        elif len(wanted) >= 3 and any(wanted in key for key in place['keys']):
            contains.append(place)
    found = sorted(starts, key=lambda place: -place['population']) + sorted(contains, key=lambda place: -place['population'])
    return [{key: value for key, value in place.items() if key != 'keys'} for place in found[:limit]]


# ---- Routes ----

def great_circle(a: tuple[float, float], b: tuple[float, float], steps: int = 96) -> list[list[float]]:
    """[[lon, lat], …] along the shortest way over the globe: how planes fly."""
    (lon1, lat1), (lon2, lat2) = [(math.radians(lon), math.radians(lat)) for lon, lat in (a, b)]
    p1 = np.array([math.cos(lat1) * math.cos(lon1), math.cos(lat1) * math.sin(lon1), math.sin(lat1)])
    p2 = np.array([math.cos(lat2) * math.cos(lon2), math.cos(lat2) * math.sin(lon2), math.sin(lat2)])
    angle = math.acos(max(-1.0, min(1.0, float(p1 @ p2))))
    if angle < 1e-9:
        return [list(a), list(b)]
    points = []
    for step in range(steps + 1):
        f = step / steps
        p = (math.sin((1 - f) * angle) * p1 + math.sin(f * angle) * p2) / math.sin(angle)
        points.append([round(math.degrees(math.atan2(p[1], p[0])), 5), round(math.degrees(math.asin(p[2])), 5)])
    # Keep longitudes continuous across the date line, so the line doesn't jump across the map.
    for index in range(1, len(points)):
        while points[index][0] - points[index - 1][0] > 180: points[index][0] -= 360
        while points[index][0] - points[index - 1][0] < -180: points[index][0] += 360
    return points


def gentle_curve(a: tuple[float, float], b: tuple[float, float], steps: int = 48) -> list[list[float]]:
    """A soft arc between two places, when the real road isn't known."""
    (x1, y1), (x2, y2) = a, b
    bend = 0.15
    cx, cy = (x1 + x2) / 2 - (y2 - y1) * bend, (y1 + y2) / 2 + (x2 - x1) * bend
    return [[round((1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t * t * x2, 5), round((1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t * t * y2, 5)]
            for t in (step / steps for step in range(steps + 1))]


def road(a: tuple[float, float], b: tuple[float, float]) -> tuple[list[list[float]], bool]:
    """The driving route as [[lon, lat], …] and whether it is the real road (False: a drawn curve)."""
    key = hashlib.sha256(json.dumps([a, b]).encode()).hexdigest()[:24]
    saved = folder() / 'routes' / f'{key}.json'
    if saved.is_file():
        return json.loads(saved.read_text()), True
    url = OSRM.format(a=f'{a[0]:.5f},{a[1]:.5f}', b=f'{b[0]:.5f},{b[1]:.5f}')
    try:
        with httpx.Client(timeout=httpx.Timeout(20, connect=8), transport=transport, headers={'User-Agent': 'Kanaa video editor'}) as client:
            response = client.get(url)
        coordinates = response.json()['routes'][0]['geometry']['coordinates'] if response.status_code == 200 else None
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        coordinates = None
    if not coordinates or len(coordinates) < 2:
        return gentle_curve(a, b), False
    # Fewer points draw just as well: keep one every so often, always the ends.
    stride = max(1, len(coordinates) // 400)
    points = [[round(x, 5), round(y, 5)] for x, y in coordinates[::stride]]
    if points[-1] != [round(coordinates[-1][0], 5), round(coordinates[-1][1], 5)]:
        points.append([round(coordinates[-1][0], 5), round(coordinates[-1][1], 5)])
    saved.parent.mkdir(parents=True, exist_ok=True)
    saved.write_text(json.dumps(points))
    return points, True


def route(a: tuple[float, float], b: tuple[float, float], mode: str) -> tuple[list[list[float]], bool]:
    """(points, uses road data). Trains follow the road route, the nearest free stand-in for the railway."""
    if mode == 'flight':
        return great_circle(a, b), False
    if mode == 'boat':
        return gentle_curve(a, b), False
    return road(a, b)


# ---- Map outlines, ready to draw ----

def mercator(lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Web Mercator in world units: x 0..1 west to east, y 0..1 north to south."""
    lat = np.clip(lat, -85.0, 85.0)
    return (lon + 180.0) / 360.0, 0.5 - np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) / (2 * np.pi)


def _rings(path: Path) -> list[tuple[np.ndarray, tuple[float, float, float, float]]]:
    """Every ring (or line) in a GeoJSON file, projected, with its bounding box."""
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding='utf-8'))
    out = []
    for feature in data.get('features', []):
        geometry = feature.get('geometry') or {}
        kind, coords = geometry.get('type'), geometry.get('coordinates') or []
        parts = {'Polygon': [coords], 'MultiPolygon': coords, 'LineString': [[coords]], 'MultiLineString': [[line] for line in coords]}.get(kind, [])
        for polygon in parts:
            for ring in polygon:
                array = np.asarray(ring, dtype=np.float64)
                if array.ndim != 2 or len(array) < 2:
                    continue
                x, y = mercator(array[:, 0], array[:, 1])
                points = np.stack([x, y], axis=1).astype(np.float32)
                out.append((points, (float(x.min()), float(y.min()), float(x.max()), float(y.max()))))
    return out


@lru_cache(maxsize=1)
def load_layers() -> dict:
    """Land, state and country borders, lakes and rivers, projected once and kept in a cache file."""
    cache = folder() / f'drawing-v{CACHE_VERSION}.pickle'
    with _lock:
        if cache.is_file() and all(cache.stat().st_mtime >= (folder() / name).stat().st_mtime for name in SOURCES if name.endswith('.geojson') and (folder() / name).is_file()):
            with cache.open('rb') as handle:
                return pickle.load(handle)
        layers = {'land': _rings(folder() / 'countries.geojson'), 'states': _rings(folder() / 'states.geojson'),
                  'lakes': _rings(folder() / 'lakes.geojson'), 'rivers': _rings(folder() / 'rivers.geojson')}
        if layers['land']:
            folder().mkdir(parents=True, exist_ok=True)
            temporary = cache.with_suffix('.part')
            with temporary.open('wb') as handle:
                pickle.dump(layers, handle, protocol=pickle.HIGHEST_PROTOCOL)
            temporary.replace(cache)
        return layers


def place_label(place: dict, language: str) -> str:
    """The name on the map: English, Tamil (when GeoNames has it), or both."""
    tamil = place.get('tamil') or ''
    if language == 'ta' and tamil:
        return tamil
    if language == 'both' and tamil:
        return f"{place['name']} · {tamil}"
    return place['name']

