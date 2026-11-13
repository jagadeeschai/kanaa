import tempfile
import unittest
from pathlib import Path

from kanaa_mcp import lyrics, scene_motion


def scene(n, start, length, media=10):
    return {'id': f'lyric-scene-{n}', 'media_id': media, 'start': start, 'in': 0, 'out': length, 'speed': 1, 'volume': 0, 'muted': True, 'fade_in': 0, 'fade_out': 0,
            'transform': {'x': 0.5, 'y': 0.5, 'scale': 1, 'opacity': 1, 'rotation': 0}, 'adjust': dict(lyrics.ADJUST)}


class Moves(unittest.TestCase):
    def test_no_move_comes_back_within_three_scenes(self):
        names = scene_motion.pick(40)
        for index in range(3, len(names)):
            self.assertNotIn(names[index], names[index - 3:index])
        self.assertGreaterEqual(len(set(names)), 8, 'a long song uses most of the moves')

    def test_the_chorus_gets_the_bigger_moves(self):
        names = scene_motion.pick(12, strong_at={2, 6})
        self.assertIn(names[2], scene_motion.STRONG)
        self.assertNotIn(names[0], scene_motion.STRONG)

    def test_chorus_is_the_lines_sung_twice(self):
        self.assertEqual(scene_motion.chorus_lines(['கற்கண்டு…', 'ஒரு வரி', 'கற்கண்டு']), {'கற்கண்டு'})


class Shots(unittest.TestCase):
    def test_a_long_scene_becomes_wide_medium_close_and_a_painting(self):
        timeline = {'format': {'width': 1920, 'height': 1080, 'fps': 30}, 'layers': [{'id': 'main', 'kind': 'video', 'items': [scene(1, 0, 14), scene(2, 14, 5, media=11)]}]}
        scene_motion.shots(timeline, {10: (0.7, 0.3)}, {10: [99]})
        items = timeline['layers'][0]['items']
        self.assertEqual([item['id'] for item in items], ['lyric-scene-1', 'lyric-scene-1-2', 'lyric-scene-1-3', 'lyric-scene-2'])
        self.assertAlmostEqual(sum(item['out'] - item['in'] for item in items[:3]), 14, places=2)
        self.assertEqual([item['start'] for item in items], [0, round(14 / 3, 3), round(28 / 3, 3), 14])
        self.assertEqual(items[1]['media_id'], 99, 'the medium shot is the painted one')
        self.assertEqual(items[2]['media_id'], 10)
        self.assertEqual(items[1]['transition_in']['kind'], 'cross-blur')
        move = scene_motion.shot_move(items[2], scene_motion.MOVES['pan-left'])
        self.assertGreater(move['scale'][0], 1.5, 'the close shot is close')
        self.assertLess(move['x'][0], 0.5, 'and leans toward the face on the right')
        zoom = move['scale'][0]
        self.assertLessEqual(abs(move['x'][0] - 0.5), (zoom - 1) / 2, 'no edge shows')
        for name in scene_motion.MOVES:
            for shot in (1.35, 1.45, 1.7):
                m = scene_motion.shot_move({'shot': shot, 'focus': (0.95, 0.05)}, scene_motion.MOVES[name])
                room = (min(m['scale']) - 1) / 2
                self.assertTrue(all(abs(v - 0.5) <= room + 1e-6 for v in m['x'] + m['y']), name)


class LongScenes(unittest.TestCase):
    def test_a_long_scene_keeps_cutting_about_every_ten_seconds(self):
        long = {**scene(1, 0, 107), 'enter': {'preset': 'blur', 'duration': 0.5}, 'exit': {'preset': 'fade', 'duration': 3.0}}
        timeline = {'layers': [{'id': 'main', 'kind': 'video', 'items': [long]}]}
        scene_motion.shots(timeline, {}, {10: [99]})
        items = timeline['layers'][0]['items']
        self.assertEqual(len(items), 11)
        self.assertTrue(all(9 < item['out'] - item['in'] < 10.5 for item in items))
        self.assertEqual([item.get('shot') for item in items[:5]], [None, 1.35, 1.7, 1.35, None])
        self.assertEqual([bool(item.get('enter')) for item in items].count(True), 1)
        self.assertTrue(items[-1].get('exit') and not any(item.get('exit') for item in items[:-1]))
        painted = [item['id'] for item in items if item['media_id'] == 99]
        self.assertTrue(1 <= len(painted) <= 3, painted)


class TwoPeople(unittest.TestCase):
    def test_close_shots_go_from_one_face_to_the_other(self):
        timeline = {'layers': [{'id': 'main', 'kind': 'video', 'items': [scene(1, 0, 90)]}]}
        scene_motion.shots(timeline, {10: [(0.3, 0.3), (0.7, 0.35)]})
        closes = [item['focus'] for item in timeline['layers'][0]['items'] if item.get('shot') == 1.7]
        self.assertEqual(len(set(closes)), 2, closes)


class Pacing(unittest.TestCase):
    def test_cuts_land_on_beats_and_come_quicker_in_the_chorus(self):
        beats = [round(i * 0.5, 3) for i in range(200)]
        lengths = scene_motion.cut_lengths(0, 60, beats, [(30, 60)])
        edges = [sum(lengths[:n]) for n in range(1, len(lengths))]
        self.assertTrue(all(abs(edge * 2 - round(edge * 2)) < 1e-6 for edge in edges), 'every cut on a beat')
        verse = [b - a for a, b in zip([0] + edges, edges) if b <= 30]
        chorus = [b - a for a, b in zip(edges, edges[1:]) if a >= 30]
        self.assertTrue(verse and chorus and max(chorus) < min(verse))
        self.assertGreaterEqual(min(lengths), scene_motion.SHORTEST_SHOT)

    def test_the_chorus_is_found_and_each_return_looks_different(self):
        line = lambda at, text: {'id': f'lyric-line-{at}', 'start': at, 'length': 3, 'text': text}
        lines = [line(0, 'ஒன்று'), line(10, 'கற்கண்டு'), line(14, 'நீ வா'), line(40, 'இரண்டு'), line(60, 'கற்கண்டு'), line(64, 'நீ வா'), line(90, 'கற்கண்டு!'), line(94, 'நீ வா')]
        spans = scene_motion.chorus_spans(lines)
        self.assertEqual(spans, [(10, 17), (60, 67), (90, 97)])
        timeline = {'layers': [{'id': 'main', 'kind': 'video', 'items': [scene(1, 10, 6), scene(2, 60, 6), scene(3, 90, 6), scene(4, 40, 6)]}]}
        scene_motion.chorus_looks(timeline, spans)
        self.assertEqual([c.get('look') for c in timeline['layers'][0]['items']], [None, 'warm', 'film', None])

    def test_picture_advice(self):
        from kanaa_mcp.lyric_builder import picture_advice
        self.assertEqual(picture_advice(6, 280)['suggest'], 13)
        self.assertIn('13 pictures', picture_advice(6, 280)['note'])
        self.assertIsNone(picture_advice(12, 280)['note'])


class KeepAlive(unittest.TestCase):
    def test_a_shine_covers_the_whole_title_on_its_own_screen_layer(self):
        timeline = {'layers': [{'id': 'main', 'kind': 'video', 'items': []}, {'id': 'T', 'kind': 'text', 'items': [{'id': 'house-title', 'start': 2, 'length': 12, 'transform': {'x': 0.62, 'y': 0.9}}]}]}
        lyrics.shine_over(timeline, 7, 'house-title')
        layer = timeline['layers'][1]
        self.assertEqual((layer['blend'], layer['kind']), ('screen', 'video'))
        self.assertAlmostEqual(sum(item['out'] for item in layer['items']), 12)
        self.assertEqual(layer['items'][-1]['start'], 12)
        self.assertEqual(lyrics.wave(8, 1, 1.03, 4)[-1], {'t': 8, 'v': 1, 'ease': 'easeInOut'})


class Gentle(unittest.TestCase):
    def test_into_clear_pictures_breathe_and_the_person_layer_moves_with_them(self):
        clip = scene(1, 0, 10); clip['transform']['scale'] = 1.2
        cover = {**scene(9, 4, 2), 'id': 'lyric-line-3-front', 'in': 4, 'out': 6}
        timeline = {'layers': [{'id': 'main', 'kind': 'video', 'items': [clip]}, {'id': 'lyric-in-front', 'kind': 'video', 'items': [cover]}]}
        lyrics.gentle_moves(timeline)
        keys = clip['transform']['keyframes']
        self.assertTrue(keys)
        for name, frames in keys.items():
            a, b = frames[0]['v'], frames[-1]['v']
            mid_cover = cover['transform']['keyframes'].get(name)
            self.assertIsNotNone(mid_cover)
            self.assertAlmostEqual(mid_cover[0]['v'], a + (b - a) * 0.4, places=3)
        scales = [frame['v'] for frame in keys.get('scale', [{'v': clip['transform']['scale']}])]
        self.assertTrue(all(1.19 < value < 1.26 for value in scales), 'only a few per cent')


class Paint(unittest.TestCase):
    def test_every_paint_style_makes_a_picture(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as folder:
            picture = Path(folder) / 'p.jpg'
            image = np.zeros((300, 400, 3), np.uint8); cv2.circle(image, (200, 150), 80, (40, 160, 230), -1)
            cv2.imwrite(str(picture), image)
            for style in scene_motion.PAINTS:
                out = scene_motion.paint(picture, style)
                self.assertEqual(out.shape, image.shape)
                self.assertGreater(float(np.abs(out.astype(int) - image.astype(int)).mean()), 1, style)
            self.assertEqual(len(scene_motion.focus_points(picture)), 1, 'no face: one point')


if __name__ == '__main__':
    unittest.main()
