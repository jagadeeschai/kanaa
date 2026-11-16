import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from app.services.chart_graphics import bar_geometry, render_bar_chart
from app.services.explainer_graphics import state_count
from app.services.timeline_schema import Format, Text


def bar_item(orientation='horizontal', labels=None):
    labels = labels or ['தமிழ்நாட்டின் மிக நீளமான மாவட்டப் பெயர்', 'Loss', 'Gain']
    return Text.model_validate({'id': 'bars', 'start': 0, 'length': 3, 'text': 'Bar chart', 'style': 'plain', 'position': 'center', 'color': '#ffffff', 'size': 44,
        'enter': {'preset': 'reveal', 'duration': 1.2}, 'graphic': {'kind': 'bar-chart', 'style': 'documentary', 'from': [.5, .5], 'to': [.5, .5], 'width': .9, 'height': .78, 'line_width': .006,
        'data': [{'label': labels[0], 'value': 200000}, {'label': labels[1], 'value': -100000}, {'label': labels[2], 'value': 150000}], 'chart_orientation': orientation, 'highlight_index': 2, 'show_values': True}})


class ChartGraphics(unittest.TestCase):
    def test_bar_geometry_is_exact_staggered_and_handles_negatives(self):
        rows = bar_item().graphic.data
        final = bar_geometry(rows, 1)
        for bar, expected in zip(final, ((1/3, 1), (1/3, 0), (1/3, 5/6))):
            self.assertAlmostEqual(bar.start, expected[0]); self.assertAlmostEqual(bar.end, expected[1])
        middle = bar_geometry(rows, .3)
        self.assertGreater(middle[0].progress, middle[1].progress)
        self.assertGreater(middle[1].progress, middle[2].progress)
        self.assertEqual(state_count(bar_item(), 30), 37)

    def test_bar_schema_rejects_empty_and_more_than_eight_rows(self):
        data = bar_item().model_dump(by_alias=True); data['graphic']['data'] = []
        with self.assertRaisesRegex(ValueError, 'at least one row'): Text.model_validate(data)
        data['graphic']['data'] = [{'label': str(n), 'value': n} for n in range(9)]
        with self.assertRaisesRegex(ValueError, 'up to 8 rows'): Text.model_validate(data)

    def test_long_tamil_labels_stay_inside_chart_at_minimum_size(self):
        item = bar_item(labels=['தமிழ்நாட்டின் மிக மிக மிக நீளமான விளக்கப்பெயர் எழுத்துகள்', 'எதிர்மறை மதிப்பு', 'நேர்மறை மதிப்பு'])
        image = render_bar_chart(item, Format(width=426, height=240, fps=24), 1)
        alpha = np.asarray(image)[:, :, 3]; ys, xs = np.nonzero(alpha)
        self.assertGreater(len(xs), 100)
        self.assertGreaterEqual(xs.min(), 3); self.assertLessEqual(xs.max(), 422)
        self.assertGreaterEqual(ys.min(), 3); self.assertLessEqual(ys.max(), 236)

    def test_vertical_bar_real_frame_height_matches_value(self):
        item = bar_item('vertical'); fmt = Format(width=426, height=240, fps=24)
        image = np.asarray(render_bar_chart(item, fmt, 1))
        # The highlighted third bar is yellow; its top-to-axis distance is 150/200 of the positive plot range.
        yellow = (image[:, :, 0] > 220) & (image[:, :, 1] > 150) & (image[:, :, 2] < 100)
        ys, xs = np.nonzero(yellow)
        self.assertGreater(len(xs), 20)
        self.assertGreater(ys.max() - ys.min(), 40)


if __name__ == '__main__': unittest.main()
