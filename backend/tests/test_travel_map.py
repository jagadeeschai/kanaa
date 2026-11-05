"""Travel maps: place search, routes, the download, and drawing the map video."""
import io
import json
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import httpx
import numpy as np
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services import travel_map_render, travel_map_service as maps
from app.services.media_probe import probe_video

CITIES = [  # GeoNames columns: id, name, ascii, alternates, lat, lon, …, country (8), …, population (14).
    ['1264527', 'Chennai', 'Chennai', 'Madras,சென்னை,Chennaj', '13.08784', '80.27847', 'P', 'PPLA', 'IN', '', '25', '', '', '', '4328063'],
    ['1264521', 'Madurai', 'Madurai', 'Madura,மதுரை', '9.91735', '78.11962', 'P', 'PPLA2', 'IN', '', '25', '', '', '', '909908'],
    ['1266534', 'Kodaikanal', 'Kodaikanal', 'கொடைக்கானல்', '10.23925', '77.48932', 'P', 'PPL', 'IN', '', '25', '', '', '', '36501'],
    ['1880252', 'Singapore', 'Singapore', 'Singapur,சிங்கப்பூர்', '1.28967', '103.85007', 'P', 'PPLC', 'SG', '', '', '', '', '', '3547809'],
    ['1264000', 'Madhubani', 'Madhubani', '', '26.35367', '86.07169', 'P', 'PPL', 'IN', '', '', '', '', '', '200000'],
]
SQUARE = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {}, 'geometry': {'type': 'Polygon', 'coordinates': [[[70, 0], [110, 0], [110, 30], [70, 30], [70, 0]]]}}]}
RIVER = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {}, 'geometry': {'type': 'LineString', 'coordinates': [[77, 10], [78, 11], [79, 11.5]]}}]}


def cities_zip() -> bytes:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as archive:
        archive.writestr('cities15000.txt', '\n'.join('\t'.join(row + [''] * 4) for row in CITIES))
    return stream.getvalue()


def files() -> dict:
    padding = ' ' * 1000  # Real files are big; a tiny one would look like an error page.
    return {'countries.geojson': json.dumps(SQUARE) + padding, 'states.geojson': json.dumps(SQUARE) + padding, 'lakes.geojson': json.dumps({'type': 'FeatureCollection', 'features': []}) + padding,
            'rivers.geojson': json.dumps(RIVER) + padding, 'cities15000.zip': cities_zip()}


class Data(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.patch = patch.object(settings, 'data_dir', Path(self.folder.name))
        self.patch.start()
        maps.load_places.cache_clear(); maps.load_layers.cache_clear()

    def tearDown(self):
        self.patch.stop()
        maps.load_places.cache_clear(); maps.load_layers.cache_clear()
        self.folder.cleanup()

    def install(self):
        maps.folder().mkdir(parents=True, exist_ok=True)
        for name, content in files().items():
            (maps.folder() / name).write_bytes(content if isinstance(content, bytes) else content.encode())

    def test_downloads_only_what_is_missing_and_only_whole_files(self):
        self.assertFalse(maps.status()['ready'])
        self.assertGreater(maps.status()['size_mb'], 15)
        served = files()
        asked = []

        def handler(request):
            name = next(name for name, (url, _) in maps.SOURCES.items() if url == str(request.url))
            asked.append(name)
            return httpx.Response(200, content=served[name] if isinstance(served[name], bytes) else served[name].encode())
        with patch.object(maps, 'transport', httpx.MockTransport(handler)):
            self.assertTrue(maps.download()['ready'])
            self.assertEqual(len(asked), 5)
            maps.download()
            self.assertEqual(len(asked), 5, 'nothing fetched twice')
        (maps.folder() / 'lakes.geojson').unlink()
        with patch.object(maps, 'transport', httpx.MockTransport(lambda request: httpx.Response(404, text='nope'))):
            with self.assertRaises(RuntimeError):
                maps.download()
        self.assertFalse((maps.folder() / 'lakes.geojson.part').exists())

    def test_places_are_found_by_english_tamil_or_old_names(self):
        self.install()
        self.assertEqual([place['name'] for place in maps.search('mad')], ['Chennai', 'Madurai', 'Madhubani'], 'starting matches (Chennai by its old name, Madras), biggest first')
        self.assertEqual(maps.search('madras')[0]['name'], 'Chennai')
        self.assertEqual(maps.search('மது')[0]['name'], 'Madurai')
        found = maps.search('kodai')[0]
        self.assertEqual((found['tamil'], found['country']), ('கொடைக்கானல்', 'IN'))
        self.assertEqual(maps.search('x'), [])
        self.assertEqual(maps.place_label(found, 'both'), 'Kodaikanal · கொடைக்கானல்')
        self.assertEqual(maps.place_label({'name': 'Kodaikanal', 'tamil': ''}, 'ta'), 'Kodaikanal', 'no Tamil name: the English one')

    def test_flights_follow_the_great_circle(self):
        path = maps.great_circle((80.27, 13.08), (103.85, 1.29))
        self.assertEqual((path[0], path[-1]), ([80.27, 13.08], [103.85, 1.29]))
        across = maps.great_circle((170, 10), (-170, 10))
        self.assertTrue(all(abs(b[0] - a[0]) < 5 for a, b in zip(across, across[1:])), 'no jump at the date line')
        self.assertAlmostEqual(across[-1][0], 190, places=3)

    def test_roads_come_from_osrm_are_kept_and_fall_back_to_a_curve(self):
        calls = []

        def handler(request):
            calls.append(str(request.url))
            return httpx.Response(200, json={'routes': [{'geometry': {'coordinates': [[78.12, 9.92], [77.9, 10.0], [77.49, 10.24]]}}]})
        with patch.object(maps, 'transport', httpx.MockTransport(handler)):
            points, real = maps.route((78.12, 9.92), (77.49, 10.24), 'car')
            again, _ = maps.route((78.12, 9.92), (77.49, 10.24), 'train')
        self.assertTrue(real)
        self.assertEqual(points, [[78.12, 9.92], [77.9, 10.0], [77.49, 10.24]])
        self.assertEqual(again, points)
        self.assertEqual(len(calls), 1, 'the road is asked for once, then kept')
        self.assertIn('router.project-osrm.org/route/v1/driving/78.12000,9.92000;77.49000,10.24000', calls[0])
        with patch.object(maps, 'transport', httpx.MockTransport(lambda request: (_ for _ in ()).throw(httpx.ConnectError('offline')))):
            curve, real = maps.route((78.0, 9.0), (79.0, 10.0), 'car')
        self.assertFalse(real)
        self.assertEqual((curve[0], curve[-1]), ([78.0, 9.0], [79.0, 10.0]))

    def test_the_map_video_shows_the_trip(self):
        self.install()
        stops = [{'name': 'Chennai', 'tamil': 'சென்னை', 'lat': 13.08, 'lon': 80.27}, {'name': 'Singapore', 'tamil': '', 'lat': 1.29, 'lon': 103.85}]
        with tempfile.TemporaryDirectory() as out, patch.object(travel_map_render, 'SHORT_SIDE', 90), patch.object(travel_map_render, 'SUPERSAMPLE', 1):
            target = Path(out) / 'map.mp4'
            result = travel_map_render.render(stops, ['flight'], (1920, 1080), 'light', 'both', target)
            facts = probe_video(target)
            self.assertEqual((facts.width, facts.height), (160, 90))
            self.assertAlmostEqual(facts.duration, result['seconds'], delta=0.1)
            self.assertFalse(result['roads'])
            with self.assertRaises(ValueError):
                travel_map_render.render(stops[:1], [], (100, 100), 'light', 'en', target)

    def test_frames_draw_land_route_and_vehicle(self):
        self.install()
        painter = travel_map_render.Painter((160, 90), 'dark')
        points = [travel_map_render.world([[80.27, 13.08]])[0], travel_map_render.world([[103.85, 1.29]])[0]]
        path = travel_map_render.world(maps.great_circle((80.27, 13.08), (103.85, 1.29)))
        camera = travel_map_render.fit(path, 160 / 90)
        empty = np.asarray(painter.frame(camera, points, ['A', 'B'], [path], ['flight'], [0.0], [1, 0], ''))
        halfway = np.asarray(painter.frame(camera, points, ['A', 'B'], [path], ['flight'], [0.5], [1, 0], ''))
        self.assertGreater(len(np.unique(empty.reshape(-1, 3), axis=0)), 3, 'sea, land and more')
        self.assertGreater(np.abs(halfway.astype(int) - empty.astype(int)).sum(), 1000, 'the route and the plane are drawn')


class Api(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        root = Path(self.folder.name)
        self.patches = [patch.object(settings, key, root / value) for key, value in [('data_dir', 'data'), ('thumbnail_dir', 'thumbs'), ('edit_workspace_dir', 'exports')]]
        self.patches += [patch.object(travel_map_render, 'SHORT_SIDE', 90), patch.object(travel_map_render, 'SUPERSAMPLE', 1)]
        for item in self.patches: item.start()
        maps.load_places.cache_clear(); maps.load_layers.cache_clear()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        for item in reversed(self.patches): item.stop()
        maps.load_places.cache_clear(); maps.load_layers.cache_clear()
        self.folder.cleanup()

    def test_maps_are_made_only_with_the_data_and_filed_together(self):
        body = {'stops': [{'name': 'Chennai', 'lat': 13.08, 'lon': 80.27}, {'name': 'Singapore', 'lat': 1.29, 'lon': 103.85}], 'modes': ['flight'], 'width': 1080, 'height': 1920}
        self.assertEqual(self.client.post('/api/travel-map', json=body).status_code, 409, 'no data yet')
        self.assertFalse(self.client.get('/api/travel-map/status').json()['ready'])
        maps.folder().mkdir(parents=True, exist_ok=True)
        for name, content in files().items():
            (maps.folder() / name).write_bytes(content if isinstance(content, bytes) else content.encode())
        self.assertEqual(self.client.get('/api/travel-map/places', params={'q': 'chen'}).json()['places'][0]['tamil'], 'சென்னை')
        self.assertEqual(self.client.post('/api/travel-map', json={**body, 'modes': ['rocket']}).status_code, 400)
        job = self.client.post('/api/travel-map', json=body).json()
        for _ in range(600):
            status = self.client.get(f"/api/jobs/{job['job_id']}/status").json()
            if status.get('status') in {'done', 'failed'}:
                break
            time.sleep(0.1)
        self.assertEqual(status['status'], 'done', status)
        media = self.client.get(f"/api/photos/{status['media_id']}").json()
        self.assertEqual((media['folder'], media['filename'], media['width'], media['height']), ('Travel maps', 'Chennai → Singapore.mp4', 90, 160))


if __name__ == '__main__':
    unittest.main()
