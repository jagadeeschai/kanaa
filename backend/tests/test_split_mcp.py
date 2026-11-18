import asyncio,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import test_mcp as fixtures
from kanaa_mcp.server import build_server,ToolError

class SplitMCP(unittest.TestCase):
    def test_options_are_saved_and_invalid_panels_do_not_change_a_project(self):
        with tempfile.TemporaryDirectory() as folder,patch('kanaa_mcp.server.HISTORY',Path(folder)):
            api=fixtures.FakeApi();server=build_server(api)
            asyncio.run(server.call_tool('set_transition',{'project_id':1,'clip_id':'c0','kind':'split','split_panels':4,'split_direction':'diagonal','split_style':'shadow'}))
            self.assertEqual(api.timeline['layers'][0]['items'][0]['transition_in'],{'kind':'split','duration':.6,'split_panels':4,'split_direction':'diagonal','split_style':'shadow'})
            before=len(api.saved)
            with self.assertRaises(ToolError):asyncio.run(server.call_tool('set_transition',{'project_id':1,'clip_id':'c0','kind':'split','split_panels':5}))
            self.assertEqual(len(api.saved),before)
