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


def render_line_chart(item: Text, fmt: Format, progress: float) -> Image.Image:
    graphic = item.graphic; assert graphic and graphic.data
    image = Image.new('RGBA', (fmt.width, fmt.height), (0,0,0,0)); draw = ImageDraw.Draw(image)
    cx,cy=round(graphic.to[0]*fmt.width),round(graphic.to[1]*fmt.height); width,height=round(graphic.width*fmt.width),round(graphic.height*fmt.height)
    left=min(fmt.width-width-3,max(3,cx-width//2)); top=min(fmt.height-height-3,max(3,cy-height//2)); right,bottom=left+width,top+height
    panel={'documentary':(44,38,18,238),'dark-band':(12,15,21,235),'bold-colour':(58,70,180,238)}.get(graphic.style)
    if panel: draw.rounded_rectangle((left,top,right,bottom),radius=max(5,height//24),fill=panel)
    ink=(245,193,27,255) if graphic.style=='documentary' else (255,255,255,255); accent=(255,216,76,255) if graphic.style=='bold-colour' else ink
    pad=max(8,round(height*.08)); label_h=max(14,round(height*.2)); chart=(left+pad,top+pad,right-pad,bottom-pad-label_h)
    normal=line_geometry(graphic.data); pixels=[(round(chart[0]+p.x*(chart[2]-chart[0])),round(chart[1]+p.y*(chart[3]-chart[1]))) for p in normal]
    shown=_partial(pixels,progress)
    if len(shown)>1: draw.line(shown,fill=accent,width=max(2,round(graphic.line_width*fmt.height)),joint='curve')
    if shown:
        radius=max(3,round(fmt.height*.009)); draw.ellipse((shown[-1][0]-radius,shown[-1][1]-radius,shown[-1][0]+radius,shown[-1][1]+radius),fill=accent)
    col_w=(chart[2]-chart[0])/max(1,len(normal))
    for point,(x,y) in zip(normal,pixels):
        font,box,label=_fit(draw,point.label,round(item.size*fmt.height/1080),round(col_w*.92),label_h)
        label_w=box[2]-box[0]; tx=min(chart[2]-label_w,max(chart[0],x-label_w/2))
        draw.text((tx,chart[3]+5-box[1]),label,font=font,fill=ink)
    if graphic.show_values and progress>=.999:
        point=normal[-1]; x,y=pixels[-1]; value=f'{point.value:g}'; font,box,value=_fit(draw,value,round(item.size*.8*fmt.height/1080),round(col_w),max(10,label_h//2))
        tx=min(right-pad-(box[2]-box[0]),max(left+pad,x+5)); ty=max(top+pad,y-(box[3]-box[1])-4-box[1])
        draw.text((tx,ty),value,font=font,fill=ink)
    return image


def render_pie_chart(item: Text, fmt: Format, progress: float) -> Image.Image:
    graphic=item.graphic; assert graphic and graphic.data
    image=Image.new('RGBA',(fmt.width,fmt.height),(0,0,0,0)); draw=ImageDraw.Draw(image)
    cx,cy=round(graphic.to[0]*fmt.width),round(graphic.to[1]*fmt.height); width,height=round(graphic.width*fmt.width),round(graphic.height*fmt.height)
    left=min(fmt.width-width-3,max(3,cx-width//2)); top=min(fmt.height-height-3,max(3,cy-height//2)); right,bottom=left+width,top+height
    panel={'documentary':(44,38,18,238),'dark-band':(12,15,21,235),'bold-colour':(58,70,180,238)}.get(graphic.style)
    if panel: draw.rounded_rectangle((left,top,right,bottom),radius=max(5,height//24),fill=panel)
    ink=(245,193,27,255) if graphic.style=='documentary' else (255,255,255,255)
    palette=[(245,193,27,255),(77,166,255,255),(239,101,122,255),(91,204,153,255),(174,126,232,255),(255,154,76,255)]
    pad=max(8,round(height*.07)); pie_size=min(height-2*pad,round(width*.48)); pie_box=(left+pad,top+(height-pie_size)//2,left+pad+pie_size,top+(height+pie_size)//2)
    sweep=-90+360*progress; slices=pie_geometry(graphic.data)
    for index,slice_ in enumerate(slices):
        visible_end=min(slice_.end,sweep)
        if visible_end>slice_.start: draw.pieslice(pie_box,start=slice_.start,end=visible_end,fill=palette[index])
    if graphic.donut:
        inset=round(pie_size*.27); hole=(pie_box[0]+inset,pie_box[1]+inset,pie_box[2]-inset,pie_box[3]-inset)
        draw.ellipse(hole,fill=panel or (0,0,0,0))
    legend_l=pie_box[2]+pad; legend_w=right-pad-legend_l; row_h=(height-2*pad)/len(slices)
    for index,slice_ in enumerate(slices):
        y=round(top+pad+row_h*(index+.5)); swatch=max(5,round(row_h*.34)); draw.ellipse((legend_l,y-swatch//2,legend_l+swatch,y+swatch//2),fill=palette[index])
        label=f'{slice_.label}  {slice_.percent}%' if graphic.show_values else slice_.label
        font,box,label=_fit(draw,label,round(item.size*fmt.height/1080),max(8,legend_w-swatch-pad),round(row_h*.8))
        draw.text((legend_l+swatch+pad//2,y-(box[3]-box[1])/2-box[1]),label,font=font,fill=ink)
    return image
