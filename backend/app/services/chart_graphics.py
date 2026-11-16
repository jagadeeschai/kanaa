"""Exact chart maths and Pillow drawing for explainer graphics."""
from __future__ import annotations

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


def _font(text: str, size: int):
    name = 'Arima-Bold.ttf' if any('\u0b80' <= char <= '\u0bff' for char in text) else 'NotoSans-Bold.ttf'
    path = Path(__file__).parents[1] / 'assets' / 'fonts' / name
    return ImageFont.truetype(str(path), max(8, size), layout_engine=ImageFont.Layout.RAQM)


def _fit(draw, text: str, size: int, width: int, height: int):
    shown = text; font = _font(shown, size); box = draw.textbbox((0, 0), shown, font=font)
    while size > 8 and (box[2] - box[0] > width or box[3] - box[1] > height):
        size -= 1; font = _font(shown, size); box = draw.textbbox((0, 0), shown, font=font)
    while len(shown) > 2 and box[2] - box[0] > width:
        shown = shown[:-2].rstrip() + '…'; font = _font(shown, size); box = draw.textbbox((0, 0), shown, font=font)
    return font, box, shown


def render_bar_chart(item: Text, fmt: Format, progress: float) -> Image.Image:
    graphic = item.graphic; assert graphic and graphic.data
    image = Image.new('RGBA', (fmt.width, fmt.height), (0, 0, 0, 0)); draw = ImageDraw.Draw(image)
    cx, cy = round(graphic.to[0] * fmt.width), round(graphic.to[1] * fmt.height)
    width, height = round(graphic.width * fmt.width), round(graphic.height * fmt.height)
    left = min(fmt.width - width - 3, max(3, cx - width // 2)); top = min(fmt.height - height - 3, max(3, cy - height // 2))
    right, bottom = left + width, top + height
    panel = {'documentary': (44, 38, 18, 238), 'dark-band': (12, 15, 21, 235), 'bold-colour': (58, 70, 180, 238)}.get(graphic.style)
    if panel: draw.rounded_rectangle((left, top, right, bottom), radius=max(5, height // 24), fill=panel)
    ink = (245, 193, 27, 255) if graphic.style == 'documentary' else (255, 255, 255, 255)
    accent = (245, 193, 27, 255) if graphic.style != 'bold-colour' else (255, 216, 76, 255)
    pad = max(8, round(height * .06)); rows = bar_geometry(graphic.data, progress); horizontal = graphic.chart_orientation == 'horizontal'
    if horizontal:
        label_w = round(width * .28); chart_l, chart_r = left + pad + label_w, right - pad
        row_h = max(8, (height - 2 * pad) / len(rows)); bar_h = max(3, round(row_h * .5))
        for index, bar in enumerate(rows):
            y = round(top + pad + row_h * (index + .5)); font, box, label = _fit(draw, bar.label, round(item.size * fmt.height / 1080), label_w - pad, round(row_h * .8))
            draw.text((chart_l - pad - (box[2]-box[0]), y - (box[3]-box[1])/2 - box[1]), label, font=font, fill=ink)
            x0 = round(chart_l + bar.start * (chart_r-chart_l)); x1 = round(chart_l + bar.end * (chart_r-chart_l))
            colour = accent if graphic.highlight_index == index else ink
            draw.rounded_rectangle((min(x0,x1), y-bar_h//2, max(x0,x1), y+bar_h//2), radius=max(1, bar_h//4), fill=colour)
            if graphic.show_values and bar.progress >= .999:
                value = f'{bar.value:g}'; vf, vb, value = _fit(draw, value, round(item.size * .8 * fmt.height / 1080), max(18, abs(x1-x0)-4), bar_h-2)
                vx = min(max(min(x0,x1)+2, x1-(vb[2]-vb[0])-2), max(x0,x1)-(vb[2]-vb[0])-2)
                draw.text((vx, y-(vb[3]-vb[1])/2-vb[1]), value, font=vf, fill=(20,20,20,255) if colour == accent else (12,15,21,255))
    else:
        label_h = round(height * .2); chart_t, chart_b = top + pad, bottom - pad - label_h
        col_w = (width - 2 * pad) / len(rows); zero_y = chart_b - rows[0].start * (chart_b-chart_t)
        draw.line((left+pad, zero_y, right-pad, zero_y), fill=ink, width=1)
        for index, bar in enumerate(rows):
            x = round(left + pad + col_w*(index+.5)); y0 = round(chart_b-bar.start*(chart_b-chart_t)); y1 = round(chart_b-bar.end*(chart_b-chart_t)); bar_w = max(4, round(col_w*.48))
            colour = accent if graphic.highlight_index == index else ink
            draw.rounded_rectangle((x-bar_w//2, min(y0,y1), x+bar_w//2, max(y0,y1)), radius=max(1, bar_w//5), fill=colour)
            font, box, label = _fit(draw, bar.label, round(item.size * fmt.height / 1080), round(col_w*.9), label_h)
            draw.text((x-(box[2]-box[0])/2, chart_b+4-box[1]), label, font=font, fill=ink)
            if graphic.show_values and bar.progress >= .999:
                value=f'{bar.value:g}'; vf,vb,value=_fit(draw,value,round(item.size*.7*fmt.height/1080),bar_w-2,max(8,abs(y1-y0)-2))
                draw.text((x-(vb[2]-vb[0])/2,min(y0,y1)+2-vb[1]),value,font=vf,fill=(20,20,20,255) if colour==accent else (12,15,21,255))
    return image
