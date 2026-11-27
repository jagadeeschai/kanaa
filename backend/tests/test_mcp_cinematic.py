"""The MCP's cinematic tools: their rules (kanaa_mcp/looks.py) give the same clips as the editor's own (stack.ts,
velocity.ts, beatsync.ts, filmstock.ts, run here with node), and each tool changes a project as one undoable step."""
import asyncio
import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from mcp.server.mcpserver.exceptions import ToolError

from kanaa_mcp import looks as rules

FRONTEND = Path(__file__).resolve().parents[2] / 'frontend'
REST = {'x': 0.5, 'y': 0.5, 'scale': 1, 'opacity': 1, 'rotation': 0}
CLIP = {'id': 'a', 'media_id': 4, 'start': 10, 'in': 2, 'out': 6, 'speed': 1, 'volume': 1, 'muted': False, 'fade_in': 0, 'fade_out': 0, 'transform': REST, 'adjust': {}}
BEATS = [9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14.2]


def editor(script: str):
    """Runs `script` (an ES module printing JSON) against the editor's own timeline code."""
    out = subprocess.run(['node', '--input-type=module', '-e', script], cwd=FRONTEND, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


class SameAsTheEditor(unittest.TestCase):
    def test_stacking_looks(self):
        part = {'media': 4, 'start': 2, 'end': 6}
        cases = [
            (CLIP, [{'kind': 'halation', 'preset': 'classic'}, {'kind': 'shake', 'preset': 'beat', 'hits': [0.5, 1]}], {'media': 50, 'seconds': 4}),
            ({**CLIP, 'stabilise': True, 'bypass': ['steady', 'mirror']}, [{'kind': 'weave', 'preset': 'worn', 'tune': {'amount': 1.4}}], {'media': 51, 'seconds': 4}),
            ({**CLIP, 'media_id': 60, 'in': 0, 'out': 8, 'slowmo': {'original_media_id': 4, 'original_in': 2, 'original_out': 6, 'factor': 2}, 'muted': True}, [], None),
            (CLIP, [{'kind': 'lens', 'preset': 'dreamy', 'strength': 'soft'}, {'kind': 'slowmo', 'factor': 4}], {'media': 52, 'seconds': 16}),
            (CLIP, [{'kind': 'match', 'reference': {'media': 9, 'start': 0, 'end': 3}}, {'kind': 'atmosphere', 'preset': 'mist', 'strength': 'light'}], {'media': 53, 'seconds': 4}),
        ]
        for clip, wanted, made in cases:
            ours = rules.set_looks(clip, part, wanted, made)
            script = f"""import {{ setLooks, looksOf, originalPart }} from './src/timeline/stack.ts';
const clip = {json.dumps(clip)};
const timeline = {{ version: 2, format: {{ width: 1920, height: 1080, fps: 30 }}, layers: [{{ id: 'main', kind: 'video', magnetic: true, items: [clip] }}] }};
const next = setLooks(timeline, 'a', {json.dumps(part)}, {json.dumps(wanted)}, {json.dumps(made)}).layers[0].items[0];
console.log(JSON.stringify({{ clip: next, looks: looksOf(next), part: originalPart(next) }}));"""
            theirs = editor(script)
            strip = lambda c: {k: v for k, v in c.items() if v is not None and k != 'start'}  # The magnetic main track re-times starts.
            self.assertEqual(strip(ours), strip(theirs['clip']), wanted)
            self.assertEqual(rules.looks_of(ours), theirs['looks'])
            self.assertEqual(rules.original_part(ours), theirs['part'])

    def test_film_stocks_match(self):
        theirs = editor("import { FILM_STOCKS, STOCK_KINDS } from './src/timeline/filmstock.ts'; console.log(JSON.stringify({ stocks: Object.fromEntries(FILM_STOCKS.map((s) => [s.id, s.looks])), kinds: STOCK_KINDS }));")
        self.assertEqual(rules.FILM_STOCKS, theirs['stocks'])
        self.assertEqual(rules.STOCK_KINDS, theirs['kinds'])

    def test_beats(self):
        ramped = {**CLIP, 'ramp': [{'t': 0, 'v': 2}, {'t': 0.5, 'v': 0.4}, {'t': 1, 'v': 2}]}
        made = {**CLIP, 'media_id': 50, 'in': 0, 'out': 8, 'slowmo': {'original_media_id': 4, 'original_in': 2, 'original_out': 6, 'factor': 2}}
        base = {'strength': 0.5, 'size': 0.04, 'bpm': 90, 'offset': 0}
        script = f"""import {{ velocityRamp }} from './src/timeline/velocity.ts';
import {{ hitsFor, pulseFor }} from './src/timeline/beatsync.ts';
const beats = {json.dumps(BEATS)};
console.log(JSON.stringify({{ ramps: ['smooth', 'punchy', 'dramatic'].map((n) => velocityRamp({json.dumps(CLIP)}, beats, n)),
  hits: [{json.dumps(CLIP)}, {json.dumps(ramped)}, {json.dumps(made)}].map((c) => hitsFor(c, beats)), pulse: pulseFor({json.dumps({**CLIP, 'start': 10.2})}, beats, {json.dumps(base)}) }}));"""
        theirs = editor(script)
        self.assertEqual([rules.velocity_ramp(CLIP, BEATS, name) for name in ('smooth', 'punchy', 'dramatic')], theirs['ramps'])
        for clip, hits in zip([CLIP, ramped, made], theirs['hits']):
            self.assertEqual(rules.hits_for(clip, BEATS), hits)
        self.assertEqual(rules.pulse_for({**CLIP, 'start': 10.2}, BEATS, base), theirs['pulse'])


TIMELINE = {'version': 2, 'format': {'width': 1920, 'height': 1080, 'fps': 30}, 'layers': [
    {'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [dict(CLIP, start=0, id='a'), dict(CLIP, start=4, id='b', reverse=True)]},
    {'id': 'music', 'kind': 'audio', 'items': [{'id': 's1', 'asset_id': 'a' * 32, 'start': 0, 'in': 0, 'out': 8, 'speed': 1, 'volume': 1, 'muted': False, 'fade_in': 0, 'fade_out': 0, 'duck': False, 'name': 'Song'}]}]}


class FakeApi:
    """Kanaa as the tools see it: one project; each look made is a new media id, in the order asked."""
    def __init__(self):
        self.timeline = copy.deepcopy(TIMELINE)
        self.posts, self.saved, self.next = [], [], 100

    def get(self, path):
        if path == '/projects/1/timeline':
            return copy.deepcopy(self.timeline)
        if path == f"/video-audio/{'a' * 32}/beats":
            return {'beats': [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5], 'bpm': 120}
        if path == '/look-tuning':
            return {'ranges': {}, 'defaults': {}}
        if path.startswith('/photos/'):
            return {'id': int(path.split('/')[2]), 'filename': 'clip.mp4', 'media_type': 'video', 'width': 1920, 'height': 1080, 'duration': 10}
        raise AssertionError(path)

    def post(self, path, body):
        self.posts.append((path, body))
        self.next += 1
        return {'status': 'ready', 'output_photo_id': self.next}

    def put(self, path, body):
        self.timeline = copy.deepcopy(body['recipe']); self.saved.append(self.timeline)
        return {'success': True}

    def wait(self, job_id, timeout=600):
        raise AssertionError('No jobs here: everything is ready at once.')


class Tools(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.patch = patch('kanaa_mcp.server.HISTORY', Path(self.folder.name)); self.patch.start()
        from kanaa_mcp.server import build_server
        self.api = FakeApi(); self.server = build_server(self.api)

    def tearDown(self):
        self.patch.stop(); self.folder.cleanup()

    def call(self, name, **args):
        result = asyncio.run(self.server.call_tool(name, args))
        found = result.structured_content or json.loads(result.content[0].text)
        return found['result'] if set(found) == {'result'} else found

    def test_a_film_stock_is_made_look_by_look_from_the_original_and_undoes_in_one_step(self):
        done = self.call('set_cinematic_looks', project_id=1, clip_ids=['a'], film_stock='classic')
        self.assertEqual(done[0]['looks'], ['halation', 'weave'])
        (first, a), (second, b) = self.api.posts
        self.assertEqual(first, '/photos/4/halation'); self.assertEqual((a['start'], a['end']), (2, 6))
        self.assertEqual(second, '/photos/101/weave'); self.assertEqual(b['original_media_id'], 4)  # From the halation copy; weave seeded by the original.
        clip = self.api.timeline['layers'][0]['items'][0]
        self.assertEqual((clip['media_id'], clip['in'], clip['out']), (102, 0, 4))
        self.assertEqual(clip['halation']['original_media_id'], 4)
        self.call('undo', project_id=1)
        self.assertEqual(self.api.timeline['layers'][0]['items'][0]['media_id'], 4)

    def test_shake_on_the_beat_finds_the_songs_beats_and_reversed_clips_are_refused(self):
        self.call('set_cinematic_looks', project_id=1, clip_ids=['a'], looks=[{'kind': 'shake', 'preset': 'beat'}])
        path, body = self.api.posts[0]
        self.assertEqual(path, '/photos/4/shake')
        self.assertEqual(body['hits'], [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5])
        with self.assertRaises(ToolError):
            asyncio.run(self.server.call_tool('set_cinematic_looks', {'project_id': 1, 'clip_ids': ['b'], 'looks': [{'kind': 'halation'}]}))

    def test_velocity_pulse_duck_and_finish(self):
        made = self.call('velocity_edit', project_id=1, preset='punchy')
        self.assertEqual((made['changed'], made['left_alone']), (['a'], ['b']))
        self.assertTrue(self.api.timeline['layers'][0]['items'][0]['ramp'])
        pulse = self.call('beat_pulse', project_id=1, clip_ids=['a'])
        self.assertEqual(pulse['bpm'], 120)
        self.assertEqual(self.api.timeline['layers'][0]['items'][0]['beat_pulse']['bpm'], 120)
        self.call('auto_duck', project_id=1, sound_id='s1', preset='strong')
        self.assertEqual(self.api.timeline['layers'][1]['items'][0]['duck_preset'], 'strong')
        self.call('set_finish', project_id=1, grade=2, grain=0.1)
        self.assertEqual(self.api.timeline['finish']['grade'], 1.0)
        self.assertEqual(len(self.api.saved), 4)
        self.call('undo', project_id=1)
        self.assertIsNone(self.api.timeline.get('finish'))

    def test_the_tools_are_listed(self):
        names = {tool.name for tool in asyncio.run(self.server.list_tools())}
        self.assertLessEqual({'look_options', 'set_cinematic_looks', 'preview_looks', 'make_it_cinematic', 'song_beats', 'velocity_edit', 'beat_pulse',
                              'auto_duck', 'set_finish', 'sync_lyrics', 'picture_forms', 'cut_out_person'}, names)


if __name__ == '__main__':
    unittest.main()
