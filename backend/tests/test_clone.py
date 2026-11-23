"""Clone a person: Follow me's layers (made by frontend/src/timeline/clone.ts) validate and stay on the GPU engine."""
import json
import unittest
from pathlib import Path

from app.services import gpu_render
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import Timeline

CLONED = json.loads('{"version": 2, "format": {"width": 640, "height": 360, "fps": 30}, "layers": [{"id": "main", "kind": "video", "magnetic": true, "items": [{"id": "clip-a", "media_id": 1, "start": 0, "in": 2, "out": 8, "speed": 1, "volume": 1, "muted": false, "fade_in": 0, "fade_out": 0, "transform": {"x": 0.5, "y": 0.5, "scale": 1, "opacity": 1, "rotation": 0}, "adjust": {"rotation": 0, "flip_horizontal": false, "flip_vertical": false, "brightness": 1, "contrast": 1, "saturation": 1, "gamma": 1, "temperature": 1, "tint": 1, "fade": 0}}]}, {"id": "L0", "kind": "video", "name": "Clone 1", "items": [{"id": "clip-a~3", "media_id": 1, "start": 0.4, "in": 0, "out": 5.6, "speed": 1, "volume": 0, "muted": true, "fade_in": 0, "fade_out": 0, "transform": {"x": 0.5, "y": 0.5, "scale": 1, "opacity": 1, "rotation": 0}, "adjust": {"rotation": 0, "flip_horizontal": false, "flip_vertical": false, "brightness": 1, "contrast": 1, "saturation": 1, "gamma": 1, "temperature": 1, "tint": 1, "fade": 0}, "name": "Clone 3 (2.4 s behind)", "cutout": "remove", "cutout_pick": null, "depth_gap": 0, "focus_pull": null, "popout": null, "transition_in": null, "enter": null, "exit": null, "frame_locked": true}]}, {"id": "L1", "kind": "video", "name": "Clone 2", "items": [{"id": "clip-a~2", "media_id": 1, "start": 0, "in": 0.4, "out": 6.4, "speed": 1, "volume": 0, "muted": true, "fade_in": 0, "fade_out": 0, "transform": {"x": 0.5, "y": 0.5, "scale": 1, "opacity": 1, "rotation": 0}, "adjust": {"rotation": 0, "flip_horizontal": false, "flip_vertical": false, "brightness": 1, "contrast": 1, "saturation": 1, "gamma": 1, "temperature": 1, "tint": 1, "fade": 0}, "name": "Clone 2 (1.6 s behind)", "cutout": "remove", "cutout_pick": null, "depth_gap": 0, "focus_pull": null, "popout": null, "transition_in": null, "enter": null, "exit": null, "frame_locked": true}]}, {"id": "L2", "kind": "video", "name": "Clone 3", "items": [{"id": "clip-a~1", "media_id": 1, "start": 0, "in": 1.2, "out": 7.2, "speed": 1, "volume": 0, "muted": true, "fade_in": 0, "fade_out": 0, "transform": {"x": 0.5, "y": 0.5, "scale": 1, "opacity": 1, "rotation": 0}, "adjust": {"rotation": 0, "flip_horizontal": false, "flip_vertical": false, "brightness": 1, "contrast": 1, "saturation": 1, "gamma": 1, "temperature": 1, "tint": 1, "fade": 0}, "name": "Clone 1 (0.8 s behind)", "cutout": "remove", "cutout_pick": null, "depth_gap": 0, "focus_pull": null, "popout": null, "transition_in": null, "enter": null, "exit": null, "frame_locked": true}]}, {"id": "L3", "kind": "video", "name": "Clone 4", "items": [{"id": "clip-a~0", "media_id": 1, "start": 0, "in": 2, "out": 8, "speed": 1, "volume": 0, "muted": true, "fade_in": 0, "fade_out": 0, "transform": {"x": 0.5, "y": 0.5, "scale": 1, "opacity": 1, "rotation": 0}, "adjust": {"rotation": 0, "flip_horizontal": false, "flip_vertical": false, "brightness": 1, "contrast": 1, "saturation": 1, "gamma": 1, "temperature": 1, "tint": 1, "fade": 0}, "name": "You (in front)", "cutout": "remove", "cutout_pick": null, "depth_gap": 0, "focus_pull": null, "popout": null, "transition_in": null, "enter": null, "exit": null, "frame_locked": true}]}]}')


class Clone(unittest.TestCase):
    def test_follow_me_validates_and_stays_on_the_gpu(self):
        timeline = Timeline.model_validate(CLONED)
        self.assertEqual([layer.items[0].cutout for layer in timeline.layers[1:]], ['remove'] * 4)
        facts = MediaFacts(path=Path('v.mp4'), media_type='video', width=640, height=360, duration=10, fps=30)
        self.assertEqual(gpu_render.unsupported(timeline, lambda _: facts), [])


if __name__ == '__main__':
    unittest.main()
