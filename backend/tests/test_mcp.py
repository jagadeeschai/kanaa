import asyncio
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from mcp.server.mcpserver.exceptions import ToolError

TIMELINE = {'version': 2, 'format': {'width': 1280, 'height': 720, 'fps': 30}, 'layers': [
    {'id': 'main', 'kind': 'video', 'magnetic': True, 'items': [{'id': 'c0', 'name': 'Opening shot', 'media_id': 1, 'start': 0, 'in': 0, 'out': 6}]},
    {'id': 'tx', 'kind': 'text', 'items': [{'id': 't1', 'start': 1, 'length': 3, 'text': 'Hello', 'style': 'shadow', 'position': 'center', 'color': '#ffffff', 'size': 34}]}]}


class FakeApi:
    """Kanaa's API as the server sees it: one project, saved timelines kept in order."""
    def __init__(self):
        self.timeline = copy.deepcopy(TIMELINE)
        self.saved = []

    def get(self, path):
        if path == '/projects/1/timeline':
            return copy.deepcopy(self.timeline)
        if path == '/photos/1':
            return {'id': 1, 'filename': 'walk.mp4', 'media_type': 'video', 'width': 1280, 'height': 720, 'duration': 10}
        if path == '/photos/2':
            return {'id': 2, 'filename': 'still.jpg', 'media_type': 'image', 'width': 1280, 'height': 720}
        raise AssertionError(path)

    def put(self, path, body):
        assert path == '/projects/1/recipe'
        self.timeline = copy.deepcopy(body['recipe'])
        self.saved.append(self.timeline)
        return {'success': True}


class Server(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.patch = patch('kanaa_mcp.server.HISTORY', Path(self.folder.name))
        self.patch.start()
        from kanaa_mcp.server import build_server
        self.api = FakeApi()
        self.server = build_server(self.api)

    def tearDown(self):
        self.patch.stop()
        self.folder.cleanup()

    def call(self, name, **args):
        result = asyncio.run(self.server.call_tool(name, args))
        return result

    def test_finds_items_by_name_and_words(self):
        found = asyncio.run(self.server.call_tool('find_items', {'project_id': 1, 'query': 'opening'}))
        self.assertIn('c0', json.dumps(found, default=str))
        found = asyncio.run(self.server.call_tool('find_items', {'project_id': 1, 'query': 'hello'}))
        self.assertIn('t1', json.dumps(found, default=str))

    def test_a_change_is_checked_saved_and_undoable(self):
        self.call('update_item', project_id=1, item_id='t1', changes={'transform': {'y': 0.3}, 'text': 'Hi'})
        title = self.api.timeline['layers'][1]['items'][0]
        self.assertEqual((title['text'], title['transform']['y']), ('Hi', 0.3))
        self.call('undo', project_id=1)
        self.assertEqual(self.api.timeline, TIMELINE, 'undo puts the timeline back exactly')

    def test_a_change_that_breaks_the_timeline_is_refused_and_nothing_saved(self):
        with self.assertRaises(ToolError):
            self.call('update_item', project_id=1, item_id='t1', changes={'size': 500})
        with self.assertRaises(ToolError):
            self.call('set_keyframes', project_id=1, item_id='t1', property='y', keyframes=[{'t': 9, 'v': 0.2}])
        self.assertEqual(self.api.saved, [])

    def test_keyframes_replace_one_property_and_an_empty_list_stops_it(self):
        self.call('set_keyframes', project_id=1, item_id='t1', property='scale', keyframes=[{'t': 2, 'v': 1.2}, {'t': 0, 'v': 0.6}])
        keys = self.api.timeline['layers'][1]['items'][0]['transform']['keyframes']['scale']
        self.assertEqual([key['t'] for key in keys], [0, 2], 'sorted by time')
        self.call('set_keyframes', project_id=1, item_id='t1', property='scale', keyframes=[])
        self.assertNotIn('scale', self.api.timeline['layers'][1]['items'][0]['transform']['keyframes'])

    def test_a_new_title_that_would_overlap_gets_its_own_layer(self):
        self.call('add_title', project_id=1, text='Second', start=2, length=2)
        text_layers = [layer for layer in self.api.timeline['layers'] if layer['kind'] == 'text']
        self.assertEqual([len(layer['items']) for layer in text_layers], [1, 1])
        self.call('add_title', project_id=1, text='Later', start=4.5, length=1)
        self.assertEqual(len([layer for layer in self.api.timeline['layers'] if layer['kind'] == 'text']), 2, 'room on the first layer after 4 s')


class Building(Server):
    def main(self):
        return self.api.timeline['layers'][0]['items']

    def test_clips_go_on_in_order_one_after_another_with_their_transitions(self):
        self.call('add_clips', project_id=1, clips=[{'media_id': 2, 'name': 'Photo'}, {'media_id': 1, 'in': 2, 'out': 5, 'transition': {'kind': 'crossfade', 'duration': 0.8}}])
        self.assertEqual([(clip['start'], clip['in'], clip['out']) for clip in self.main()], [(0, 0, 6), (6, 0, 4), (10, 2, 5)], 'a photo shows 4 s')
        self.assertEqual(self.main()[2]['transition_in'], {'kind': 'crossfade', 'duration': 0.8})
        self.assertEqual(self.main()[1]['name'], 'Photo')

    def test_past_the_end_of_a_video_is_refused(self):
        with self.assertRaises(ToolError):
            self.call('add_clips', project_id=1, clips=[{'media_id': 1, 'in': 5, 'out': 12}])

    def test_removing_a_clip_closes_the_gap_and_the_first_clip_has_no_transition(self):
        self.call('add_clips', project_id=1, clips=[{'media_id': 1, 'out': 3, 'transition': {'kind': 'wipe'}}])
        self.call('remove_item', project_id=1, item_id='c0')
        self.assertEqual(self.main()[0]['start'], 0)
        self.assertNotIn('transition_in', self.main()[0])
        self.call('set_transition', project_id=1, clip_id=self.main()[0]['id'], kind=None)
        self.call('undo', project_id=1)
        self.call('undo', project_id=1)
        self.assertEqual([clip['id'] for clip in self.main()][0], 'c0', 'undo brings it back')


if __name__ == '__main__':
    unittest.main()
