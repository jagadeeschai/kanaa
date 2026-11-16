import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

from app.services.chart_graphics import _fit, clusters, number, bar_geometry, line_geometry, pie_geometry, pie_percentages, render_bar_chart, render_line_chart, render_pie_chart
from app.services.explainer_graphics import state_count
from app.services.timeline_schema import Format, Text


def bar_item(orientation='horizontal', labels=None):
    labels = labels or ['தமிழ்நாட்டின் மிக நீளமான மாவட்டப் பெயர்', 'Loss', 'Gain']
    return Text.model_validate({'id': 'bars', 'start': 0, 'length': 3, 'text': 'Bar chart', 'style': 'plain', 'position': 'center', 'color': '#ffffff', 'size': 44,
        'enter': {'preset': 'reveal', 'duration': 1.2}, 'graphic': {'kind': 'bar-chart', 'style': 'documentary', 'from': [.5, .5], 'to': [.5, .5], 'width': .9, 'height': .78, 'line_width': .006,
        'data': [{'label': labels[0], 'value': 200000}, {'label': labels[1], 'value': -100000}, {'label': labels[2], 'value': 150000}], 'chart_orientation': orientation, 'highlight_index': 2, 'show_values': True}})


def line_item(labels=None):
    labels = labels or ['சனவரி', 'பிப்ரவரி', 'மார்ச்', 'ஏப்ரல்']
    return Text.model_validate({'id': 'line', 'start': 0, 'length': 3, 'text': 'Line chart', 'style': 'plain', 'position': 'center', 'color': '#ffffff', 'size': 44,
        'enter': {'preset': 'reveal', 'duration': 1.2}, 'graphic': {'kind': 'line-chart', 'style': 'documentary', 'from': [.5,.5], 'to': [.5,.5], 'width': .9, 'height': .78, 'line_width': .006,
        'data': [{'label': label, 'value': value} for label,value in zip(labels,(10,30,20,40))], 'show_values': True}})


def pie_item(labels=None):
    labels=labels or ['கல்வி','சுகாதாரம்','போக்குவரத்து']
    return Text.model_validate({'id':'pie','start':0,'length':3,'text':'Pie chart','style':'plain','position':'center','color':'#ffffff','size':44,
        'enter':{'preset':'reveal','duration':1.2},'graphic':{'kind':'pie-chart','style':'documentary','from':[.5,.5],'to':[.5,.5],'width':.9,'height':.78,'line_width':.006,
        'data':[{'label':label,'value':value} for label,value in zip(labels,(1,1,1))],'donut':True,'show_values':True}})


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

    def test_line_geometry_passes_through_every_point_with_headroom(self):
        rows = line_item().graphic.data; points = line_geometry(rows)
        self.assertEqual([point.x for point in points], [0, 1/3, 2/3, 1])
        self.assertEqual([point.value for point in points], [10,30,20,40])
        self.assertTrue(all(0 < point.y < 1 for point in points))
        self.assertLess(points[-1].y, points[1].y)
        self.assertEqual(state_count(line_item(), 30), 37)

    def test_line_long_tamil_labels_stay_inside_minimum_frame(self):
        labels=['மிகநீளமானசனவரிமாதப்பெயர்','மிகநீளமானபிப்ரவரிமாதப்பெயர்','மிகநீளமானமார்ச்சுமாதப்பெயர்','மிகநீளமானஏப்ரல்மாதப்பெயர்']
        image=np.asarray(render_line_chart(line_item(labels),Format(width=426,height=240,fps=24),1)); ys,xs=np.nonzero(image[:,:,3])
        self.assertGreater(len(xs),100); self.assertGreaterEqual(xs.min(),3); self.assertLessEqual(xs.max(),422); self.assertGreaterEqual(ys.min(),3); self.assertLessEqual(ys.max(),236)

    def test_line_schema_rejects_more_than_twelve_points(self):
        data=line_item().model_dump(by_alias=True); data['graphic']['data']=[{'label':str(n),'value':n} for n in range(13)]
        with self.assertRaisesRegex(ValueError,'up to 12 points'): Text.model_validate(data)

    def test_pie_angles_and_rounded_percentages_are_exact(self):
        rows=pie_item().graphic.data; slices=pie_geometry(rows)
        self.assertAlmostEqual(sum(slice_.end-slice_.start for slice_ in slices),360)
        self.assertEqual(pie_percentages(rows),[34,33,33]); self.assertEqual(sum(slice_.percent for slice_ in slices),100)
        self.assertEqual(slices[0].start,-90); self.assertEqual(slices[-1].end,270)
        self.assertEqual(state_count(pie_item(),30),37)

    def test_pie_schema_rejects_too_many_or_nonpositive_slices(self):
        data=pie_item().model_dump(by_alias=True); data['graphic']['data']=[{'label':str(n),'value':n+1} for n in range(7)]
        with self.assertRaisesRegex(ValueError,'up to 6 slices'): Text.model_validate(data)
        data['graphic']['data']=[{'label':'bad','value':0}]
        with self.assertRaisesRegex(ValueError,'greater than zero'): Text.model_validate(data)

    def test_pie_long_tamil_legend_stays_inside_minimum_frame(self):
        labels=['மிகநீளமானகல்வித்துறைப்பெயர்','மிகநீளமானசுகாதாரத்துறைப்பெயர்','மிகநீளமானபோக்குவரத்துப்பெயர்']
        image=np.asarray(render_pie_chart(pie_item(labels),Format(width=426,height=240,fps=24),1)); ys,xs=np.nonzero(image[:,:,3])
        self.assertGreater(len(xs),100); self.assertGreaterEqual(xs.min(),3); self.assertLessEqual(xs.max(),422); self.assertGreaterEqual(ys.min(),3); self.assertLessEqual(ys.max(),236)



def clean(item, **changes):
    data = item.model_dump(by_alias=True); data['graphic'].update({'style': 'clean', **changes}); return Text.model_validate(data)


def content_box(image):
    ys, xs = np.nonzero(np.asarray(image)[:, :, 3] > 8); return xs.min(), ys.min(), xs.max(), ys.max()


class ChartQuality(unittest.TestCase):
    def test_values_read_as_written_never_scientific(self):
        graphic = bar_item().graphic
        self.assertEqual(number(1500000, graphic), '1,500,000')
        self.assertEqual(number(1500000, graphic.model_copy(update={'indian_grouping': True})), '15,00,000')
        self.assertEqual(number(-12.5, graphic), '-12.5')

    def test_shortening_keeps_whole_tamil_letters(self):
        from PIL import ImageDraw
        draw = ImageDraw.Draw(Image.new('RGBA', (10, 10)))
        text = 'திருநெல்வேலி மாவட்டம்'
        for width in range(20, 120, 7):
            _, _, shown = _fit(draw, text, 30, width, 100, 14)
            if shown.endswith('…'):
                letters = clusters(text); kept = clusters(shown[:-1].rstrip())
                self.assertEqual(kept, letters[:len(kept)])

    def test_bar_heights_follow_their_values_on_real_frames(self):
        fmt = Format(width=1280, height=720, fps=24)
        def yellow_height(index):
            pixels = np.asarray(render_bar_chart(clean(bar_item('vertical'), highlight_index=index), fmt, 1)).astype(int)
            ys, _ = np.nonzero((pixels[:, :, 0] > 220) & (abs(pixels[:, :, 1] - 193) < 25) & (pixels[:, :, 2] < 80))
            return ys.max() - ys.min() + 1
        self.assertAlmostEqual(yellow_height(0) / yellow_height(2), 200000 / 150000, delta=.03)
        self.assertAlmostEqual(yellow_height(0) / yellow_height(1), 200000 / 100000, delta=.04)

    def test_every_chart_stays_inside_its_own_box_at_the_smallest_size(self):
        fmt = Format(width=426, height=240, fps=24); long = 'தமிழ்நாட்டின் மிக மிக நீளமான மாவட்டப் பெயர்'
        items = [clean(bar_item(labels=[long, long, long])), clean(bar_item('vertical', labels=[long, long, long])),
                 clean(line_item([long] * 4)), clean(pie_item([long] * 3))]
        for item, draw in zip(items, (render_bar_chart, render_bar_chart, render_line_chart, render_pie_chart)):
            graphic = item.graphic; width, height = round(graphic.width * 426), round(graphic.height * 240)
            left, top = round(graphic.to[0] * 426) - width // 2, round(graphic.to[1] * 240) - height // 2
            x0, y0, x1, y1 = content_box(draw(item, fmt, 1))
            with self.subTest(kind=graphic.kind, orientation=graphic.chart_orientation):
                self.assertGreaterEqual(x0, left - 1); self.assertGreaterEqual(y0, top - 1)
                self.assertLessEqual(x1, left + width + 1); self.assertLessEqual(y1, top + height + 1)

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg required')
    def test_gpu_export_matches_ffmpeg_for_every_chart_and_style(self):
        from app.services import gpu_render
        from app.services.cutout_service import helper
        from app.services.media_probe import MediaFacts
        from app.services.timeline_schema import Timeline
        from app.services.timeline_service import render_timeline
        W, H = 426, 240
        read = lambda path: np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout, np.uint8).reshape(-1, H, W, 3)
        for make in (bar_item, line_item, pie_item):
            for style in ('clean', 'documentary', 'dark-band', 'bold-colour'):
                with self.subTest(kind=make.__name__, style=style), tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'KANAA_GPU_RENDER': '0'}):
                    root = Path(folder); base = root / 'base.png'
                    yy, xx = np.mgrid[:H, :W]
                    Image.fromarray(np.stack([xx * 255 // W, yy * 255 // H, np.full_like(xx, 140)], 2).astype(np.uint8)).save(base)
                    facts = {1: MediaFacts(path=base, media_type='image', width=W, height=H)}
                    chart = make().model_dump(by_alias=True); chart['graphic']['style'] = style; chart['length'] = 1.5
                    timeline = Timeline.model_validate({'format': {'width': W, 'height': H, 'fps': 24}, 'layers': [
                        {'id': 'main', 'kind': 'video', 'items': [{'id': 'base', 'media_id': 1, 'start': 0, 'in': 0, 'out': 1.5}]},
                        {'id': 'graphics', 'kind': 'text', 'name': 'Graphics', 'items': [chart]}]})
                    self.assertEqual(gpu_render.unsupported(timeline, facts.__getitem__), [])
                    cpu = root / 'cpu.mp4'; render_timeline(timeline, facts.__getitem__, lambda _: None, cpu, lambda _: None, hardware=False)
                    if not (sys.platform == 'darwin' and shutil.which('swiftc')): continue
                    with patch('app.services.cutout_service.settings') as settings:
                        settings.data_dir = root; tool = helper(gpu_render.SOURCE)
                    gpu = root / 'gpu.mp4'; gpu_render.render(timeline, facts.__getitem__, gpu, tool=tool)
                    mse = ((read(cpu).astype(float) - read(gpu)) ** 2).mean(axis=(1, 2, 3))
                    psnr = 10 * np.log10(255 ** 2 / np.maximum(mse, 1e-10))
                    print(make.__name__, style, 'GPU vs ffmpeg dB: worst', round(float(psnr.min()), 2))
                    self.assertGreaterEqual(float(psnr.min()), 35, psnr)


if __name__ == '__main__': unittest.main()
