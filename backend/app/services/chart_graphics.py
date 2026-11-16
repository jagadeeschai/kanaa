"""Exact chart maths and Pillow drawing for explainer graphics."""
from __future__ import annotations

import unicodedata
from pathlib import Path
from typing import NamedTuple

from PIL import Image, ImageDraw, ImageFont

from app.services.timeline_schema import Format, Text


class Bar(NamedTuple):
    label: str
    value: float
    start: float
    end: float
    progress: float


class LinePoint(NamedTuple):
    label: str
    value: float
    x: float
    y: float


class Slice(NamedTuple):
    label: str
    value: float
    start: float
    end: float
    percent: int


def ease(value: float) -> float:
    q = min(1, max(0, value))
    return 1 - (1 - q) ** 3


def bar_geometry(rows, progress: float) -> list[Bar]:
    """Normalised axis positions; zero is always on the axis and each row is staggered."""
    low = min(0, *(row.value for row in rows)); high = max(0, *(row.value for row in rows))
    span = max(1e-9, high - low); zero = (0 - low) / span; count = len(rows)
    answer = []
    for index, row in enumerate(rows):
        delay = index * .42 / max(1, count - 1) if count > 1 else 0
        shown = ease((progress - delay) / .58)
        target = (row.value - low) / span
        answer.append(Bar(row.label, row.value, zero, zero + (target - zero) * shown, shown))
    return answer


def line_geometry(rows) -> list[LinePoint]:
    """Normalised points with five percent headroom above and below the data."""
    low, high = min(row.value for row in rows), max(row.value for row in rows)
    span = max(1e-9, high - low); low -= span * .05; high += span * .05; span = high - low
    return [LinePoint(row.label, row.value, index / max(1, len(rows)-1), 1 - (row.value-low)/span) for index, row in enumerate(rows)]


def pie_percentages(rows) -> list[int]:
    """Largest-remainder rounding: displayed whole percentages always total exactly 100."""
    total=sum(row.value for row in rows); exact=[row.value*100/total for row in rows]; rounded=[int(value) for value in exact]
    order=sorted(range(len(rows)),key=lambda index:(exact[index]-rounded[index],-index),reverse=True)
    for index in order[:100-sum(rounded)]: rounded[index]+=1
    return rounded


def pie_geometry(rows) -> list[Slice]:
    total=sum(row.value for row in rows); percents=pie_percentages(rows); at=-90.0; answer=[]
    for row,percent in zip(rows,percents):
        end=at+row.value*360/total; answer.append(Slice(row.label,row.value,at,end,percent)); at=end
    if answer: answer[-1]=answer[-1]._replace(end=270.0)
    return answer


def _partial(points: list[tuple[int, int]], progress: float) -> list[tuple[int, int]]:
    if progress >= 1 or len(points) < 2: return points
    lengths = [((b[0]-a[0])**2 + (b[1]-a[1])**2) ** .5 for a,b in zip(points,points[1:])]
    left = sum(lengths) * max(0, progress); shown = [points[0]]
    for a,b,length in zip(points,points[1:],lengths):
        if left >= length: shown.append(b); left -= length; continue
        if left > 0 and length: shown.append((round(a[0]+(b[0]-a[0])*left/length), round(a[1]+(b[1]-a[1])*left/length)))
        break
    return shown


def _font(text: str, size: int):
    name = 'Arima-Bold.ttf' if any('஀' <= char <= '௿' for char in text) else 'NotoSans-Bold.ttf'
    path = Path(__file__).parents[1] / 'assets' / 'fonts' / name
    return ImageFont.truetype(str(path), max(8, size), layout_engine=ImageFont.Layout.RAQM)


def clusters(text: str) -> list[str]:
    """Split into letters a reader sees: a Tamil consonant keeps its vowel sign or pulli, so shortening never strands one."""
    answer: list[str] = []
    for char in text:
        joins = unicodedata.category(char) in ('Mn', 'Mc') or char in '‌‍'
        if answer and (joins or answer[-1][-1] in '‌‍'): answer[-1] += char
        else: answer.append(char)
    return answer


def least(fmt: Format) -> int:
    """The smallest chart text that still reads on this frame size."""
    return max(9, round(fmt.height * .028))


def _fit(draw, text: str, size: int, width: int, height: int, smallest: int = 8):
    """Shrink to fit, but not below `smallest`; past that, end in an ellipsis on a whole letter."""
    size = max(smallest, size); shown = text; font = _font(shown, size); box = draw.textbbox((0, 0), shown, font=font)
    while size > smallest and (box[2] - box[0] > width or box[3] - box[1] > height):
        size -= 1; font = _font(shown, size); box = draw.textbbox((0, 0), shown, font=font)
    letters = clusters(text)
    while len(letters) > 1 and box[2] - box[0] > width:
        letters.pop(); shown = ''.join(letters).rstrip() + '…'; font = _font(shown, size); box = draw.textbbox((0, 0), shown, font=font)
    return font, box, shown


def number(value: float, graphic) -> str:
    """Values read as people write them: 15,00,000 or 1,500,000, never 1.5e+06."""
    from app.services.explainer_graphics import format_count
    whole = round(value)
    if abs(value - whole) < 1e-9: return format_count(whole, graphic.indian_grouping, graphic.tamil_numerals)
    text = f'{abs(value):.2f}'.rstrip('0'); integer, fraction = text.split('.')
    return ('-' if value < 0 else '') + format_count(int(integer), graphic.indian_grouping, graphic.tamil_numerals) + '.' + fraction


def _frame(item: Text, fmt: Format):
    graphic = item.graphic; assert graphic and graphic.data
    image = Image.new('RGBA', (fmt.width, fmt.height), (0, 0, 0, 0)); draw = ImageDraw.Draw(image)
    cx, cy = round(graphic.to[0] * fmt.width), round(graphic.to[1] * fmt.height)
    width, height = round(graphic.width * fmt.width), round(graphic.height * fmt.height)
    left = min(fmt.width - width - 3, max(3, cx - width // 2)); top = min(fmt.height - height - 3, max(3, cy - height // 2))
    panel = {'documentary': (28, 27, 24, 238), 'dark-band': (12, 15, 21, 235), 'bold-colour': (30, 36, 58, 238)}.get(graphic.style)
    if panel: draw.rounded_rectangle((left, top, left + width, top + height), radius=max(5, height // 24), fill=panel)
    colour = item.color.lstrip('#'); main = tuple(int(colour[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
    accent = (105, 170, 235, 255) if graphic.style == 'bold-colour' else (245, 193, 27, 255)
    if accent[:3] == main[:3]: accent = (255, 255, 255, 255)
    return graphic, image, draw, (left, top, left + width, top + height), panel, main, accent


def _text(draw, xy, text, font, box):
    draw.text((xy[0] - box[0], xy[1] - box[1]), text, font=font, fill=(255, 255, 255, 255))


def _draw_bar(item: Text, fmt: Format, progress: float) -> Image.Image:
    graphic, image, draw, (left, top, right, bottom), _, main, accent = _frame(item, fmt)
    rows = bar_geometry(graphic.data, progress); small = least(fmt); horizontal = graphic.chart_orientation == 'horizontal'
    width, height = right - left, bottom - top; pad = max(6, round(min(width, height) * .05)); gap = max(3, pad // 2)
    size = max(small, round(item.size * fmt.height / 1080)); vsize = max(small, round(size * .8))
    values = [number(row.value, graphic) for row in graphic.data] if graphic.show_values else []
    negative = any(row.value < 0 for row in graphic.data); positive = any(row.value > 0 for row in graphic.data)
    vfont = _font(''.join(values), vsize); vboxes = [draw.textbbox((0, 0), value, font=vfont) for value in values]
    if horizontal:
        label_w = round(width * .28); value_w = min(round(width * .22), max((b[2] - b[0] for b in vboxes), default=0) + gap)
        plot_l = left + pad + label_w + gap + (value_w if negative else 0); plot_r = right - pad - (value_w if positive else 0)
        row_h = (height - 2 * pad) / len(rows); bar_h = max(3, round(row_h * .55))
        for index, bar in enumerate(rows):
            y = top + pad + row_h * (index + .5)
            font, box, label = _fit(draw, bar.label, size, label_w, round(row_h * .9), small)
            _text(draw, (left + pad + label_w - (box[2] - box[0]), y - (box[3] - box[1]) / 2), label, font, box)
            x0 = plot_l + bar.start * (plot_r - plot_l); x1 = plot_l + bar.end * (plot_r - plot_l)
            if abs(x1 - x0) >= 1:
                draw.rounded_rectangle((round(min(x0, x1)), round(y - bar_h / 2), round(max(x0, x1)), round(y + bar_h / 2)), radius=max(1, bar_h // 4), fill=accent if graphic.highlight_index == index else main)
            if values and bar.progress >= .999:
                font, box, value = _fit(draw, values[index], vsize, value_w - gap, round(row_h * .9))
                vx = x1 + gap if bar.value >= 0 else x1 - gap - (box[2] - box[0])
                _text(draw, (vx, y - (box[3] - box[1]) / 2), value, font, box)
        draw.line((round(plot_l + rows[0].start * (plot_r - plot_l)), top + pad, round(plot_l + rows[0].start * (plot_r - plot_l)), bottom - pad), fill=(255, 255, 255, 150), width=1)
    else:
        col_w = (width - 2 * pad) / len(rows)
        lfont = _font(''.join(row.label for row in rows), size); label_h = max(round(size * 1.5), draw.textbbox((0, 0), 'கஊ', font=lfont)[3] + gap)
        value_h = max((b[3] - b[1] for b in vboxes), default=0) + gap
        plot_t = top + pad + (value_h if positive and values else 0); plot_b = bottom - pad - label_h - (value_h + gap if negative and values else 0)
        zero = plot_b - rows[0].start * (plot_b - plot_t); bar_w = max(4, round(col_w * .5))
        for index, bar in enumerate(rows):
            x = left + pad + col_w * (index + .5); y1 = plot_b - bar.end * (plot_b - plot_t)
            if abs(y1 - zero) >= 1:
                draw.rounded_rectangle((round(x - bar_w / 2), round(min(zero, y1)), round(x + bar_w / 2), round(max(zero, y1))), radius=max(1, bar_w // 6), fill=accent if graphic.highlight_index == index else main)
            font, box, label = _fit(draw, bar.label, size, round(col_w * .92), label_h - gap, small)
            _text(draw, (x - (box[2] - box[0]) / 2, bottom - pad - label_h + gap), label, font, box)
            if values and bar.progress >= .999:
                font, box, value = _fit(draw, values[index], vsize, round(col_w * .96), value_h)
                vy = y1 - gap - (box[3] - box[1]) if bar.value >= 0 else y1 + gap
                _text(draw, (x - (box[2] - box[0]) / 2, vy), value, font, box)
        draw.line((left + pad, round(zero), right - pad, round(zero)), fill=(255, 255, 255, 150), width=1)
    return image


def _draw_line(item: Text, fmt: Format, progress: float) -> Image.Image:
    graphic, image, draw, (left, top, right, bottom), _, main, accent = _frame(item, fmt)
    colour = accent if graphic.style in ('documentary', 'bold-colour') else main
    small = least(fmt); width, height = right - left, bottom - top; pad = max(6, round(min(width, height) * .06)); gap = max(3, pad // 2)
    size = max(small, round(item.size * fmt.height / 1080)); count = len(graphic.data)
    font = _font(''.join(row.label for row in graphic.data), size); label_h = max(round(size * 1.5), draw.textbbox((0, 0), 'கஊ', font=font)[3] + gap)
    end_value = number(graphic.data[-1].value, graphic) if graphic.show_values else ''
    vfont = _font(end_value, max(small, round(size * .9))); vbox = draw.textbbox((0, 0), end_value, font=vfont) if end_value else (0, 0, 0, 0)
    plot = (left + pad + round(width * .04), top + pad + (vbox[3] - vbox[1]) // 2, right - pad - (vbox[2] - vbox[0] + gap * 2 if end_value else round(width * .04)), bottom - pad - label_h)
    normal = line_geometry(graphic.data); pixels = [(round(plot[0] + p.x * (plot[2] - plot[0])), round(plot[1] + p.y * (plot[3] - plot[1]))) for p in normal]
    shown = _partial(pixels, progress)
    if len(shown) > 1: draw.line(shown, fill=colour, width=max(2, round(graphic.line_width * fmt.height)), joint='curve')
    if shown:
        radius = max(3, round(fmt.height * .009)); draw.ellipse((shown[-1][0] - radius, shown[-1][1] - radius, shown[-1][0] + radius, shown[-1][1] + radius), fill=colour)
    # Thin the labels instead of shrinking them past reading: every k-th point is named when all of them cannot be.
    spacing = (plot[2] - plot[0]) / max(1, count - 1); widest = max(draw.textbbox((0, 0), row.label, font=_font(row.label, small))[2] for row in graphic.data)
    step = 1
    while step < count - 1 and widest > spacing * step * .92: step += 1
    named = list(range(0, count, step))
    if named[-1] != count - 1:
        if count - 1 - named[-1] < step and len(named) > 1: named.pop()
        named.append(count - 1)
    room = round(spacing * step * .92) if count > 1 else plot[2] - plot[0]
    for index in named:
        font, box, label = _fit(draw, graphic.data[index].label, size, room, label_h - gap, small)
        label_w = box[2] - box[0]; tx = min(right - pad - label_w, max(left + pad, pixels[index][0] - label_w / 2))
        _text(draw, (tx, bottom - pad - label_h + gap), label, font, box)
    if end_value and progress >= .999:
        x, y = pixels[-1]; _text(draw, (x + gap * 2, max(top + pad, min(bottom - pad - label_h - (vbox[3] - vbox[1]), y - (vbox[3] - vbox[1]) / 2))), end_value, vfont, vbox)
    return image


def _draw_pie(item: Text, fmt: Format, progress: float) -> Image.Image:
    graphic, image, draw, (left, top, right, bottom), panel, _, _ = _frame(item, fmt)
    palette = [(215, 188, 105, 255), (120, 157, 181, 255), (190, 132, 140, 255), (119, 169, 145, 255), (155, 132, 178, 255), (199, 151, 105, 255)]
    small = least(fmt); width, height = right - left, bottom - top; pad = max(6, round(min(width, height) * .07))
    pie_size = min(height - 2 * pad, round(width * .48)); pie_box = (left + pad, top + (height - pie_size) // 2, left + pad + pie_size, top + (height + pie_size) // 2)
    sweep = -90 + 360 * progress; slices = pie_geometry(graphic.data)
    for index, slice_ in enumerate(slices):
        visible_end = min(slice_.end, sweep)
        if visible_end > slice_.start: draw.pieslice(pie_box, start=slice_.start, end=visible_end, fill=palette[index])
    if graphic.donut:
        inset = round(pie_size * .27); draw.ellipse((pie_box[0] + inset, pie_box[1] + inset, pie_box[2] - inset, pie_box[3] - inset), fill=panel or (0, 0, 0, 0))
    legend_l = pie_box[2] + pad; legend_w = right - pad - legend_l; row_h = (height - 2 * pad) / len(slices)
    size = max(small, round(item.size * fmt.height / 1080))
    for index, slice_ in enumerate(slices):
        y = top + pad + row_h * (index + .5); swatch = max(5, round(row_h * .34))
        draw.ellipse((legend_l, round(y - swatch / 2), legend_l + swatch, round(y + swatch / 2)), fill=palette[index])
        text_l = legend_l + swatch + pad // 2; room = right - pad - text_l
        percent = f'{slice_.percent}%' if graphic.show_values else ''
        pfont, pbox, percent = _fit(draw, percent, size, room // 3, round(row_h * .9), small) if percent else (None, (0, 0, 0, 0), '')
        pw = pbox[2] - pbox[0]
        font, box, label = _fit(draw, slice_.label, size, room - (pw + pad // 2 if percent else 0), round(row_h * .9), small)
        _text(draw, (text_l, y - (box[3] - box[1]) / 2), label, font, box)
        if percent: _text(draw, (right - pad - pw, y - (pbox[3] - pbox[1]) / 2), percent, pfont, pbox)
    return image


def _smooth(draw, item: Text, fmt: Format, progress: float) -> Image.Image:
    """Draw at twice the size and scale down: Pillow's hard pixel steps would otherwise come out differently from the
    GPU and ffmpeg exports (and look jagged), most on a saturated line over a busy picture."""
    big = draw(item, Format(width=fmt.width * 2, height=fmt.height * 2, fps=fmt.fps), progress)
    return big.convert('RGBa').resize((fmt.width, fmt.height), Image.Resampling.BOX).convert('RGBA')


def render_bar_chart(item: Text, fmt: Format, progress: float) -> Image.Image: return _smooth(_draw_bar, item, fmt, progress)
def render_line_chart(item: Text, fmt: Format, progress: float) -> Image.Image: return _smooth(_draw_line, item, fmt, progress)
def render_pie_chart(item: Text, fmt: Format, progress: float) -> Image.Image: return _smooth(_draw_pie, item, fmt, progress)
