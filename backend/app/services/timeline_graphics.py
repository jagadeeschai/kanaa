"""Event-aligned dates, a moving marker and collision-safe timeline labels."""
from app.services.chart_graphics import _fit, _frame, _smooth, least
from app.services.step_graphics import wrapped


def point_times(item):
    duration = min(item.length, item.enter.duration) if item.enter else .65
    return [duration * i / (len(item.graphic.points) - 1) for i in range(len(item.graphic.points))]


def timeline_states(item, fps):
    times = point_times(item)
    return [a + (b - a) * n / 12 for a, b in zip(times, times[1:]) for n in range(12)] + [times[-1]]


def marker(item, local):
    times = point_times(item)
    return min(1, max(0, local / max(1e-6, times[-1])))


def _draw_timeline(item, fmt, local):
    graphic, image, draw, (left, top, right, bottom), _, main, accent = _frame(item, fmt)
    small = max(18, least(fmt)); size = max(small, round(item.size * fmt.height / 1080))
    pad = max(8, round(fmt.height * .025)); radius = max(4, round(fmt.height * .009))
    vertical = graphic.timeline_vertical; count = len(graphic.points); times = point_times(item); share = marker(item, local)
    if vertical:
        half_row = (bottom - top - 2 * pad) / count / 2
        a, b = (left + pad + radius, top + pad + half_row), (left + pad + radius, bottom - pad - half_row)
    else:
        # Inset both ends by half a label column so even the first and last labels stay within their own box.
        inset = (right-left-2*pad) / (count+1)
        a, b = (left+pad+inset, (top+bottom)/2), (right-pad-inset, (top+bottom)/2)
    tip = (a[0]+(b[0]-a[0])*share, a[1]+(b[1]-a[1])*share)
    stroke = max(2, round(graphic.line_width*fmt.height))
    draw.line((a, b), fill=(*main[:3],65), width=stroke)
    draw.line((a, tip), fill=main, width=stroke)
    spacing = ((b[1]-a[1]) if vertical else (b[0]-a[0]))/(count-1)
    for i, point in enumerate(graphic.points):
        if local < times[i]: continue
        x, y = a[0]+(b[0]-a[0])*i/(count-1), a[1]+(b[1]-a[1])*i/(count-1)
        draw.ellipse((x-radius,y-radius,x+radius,y+radius), fill=main)
        if vertical:
            tx = x+pad+radius; room = right-pad-tx; available = spacing*.88
            # Date and label each occupy one line; retain a readable minimum even for eight points.
            fields = [point.date] + ([point.label] if point.label else [])
            fitted = [_fit(draw, value, size, room, available/len(fields), small) for value in fields]
            heights = [box[3]-box[1] for _,box,_ in fitted]; gap = max(1,round(fmt.height*.002))
            ty = y-(sum(heights)+gap*(len(fields)-1))/2
        else:
            room = spacing*1.8; tx = max(left+pad,min(right-pad-room,x-room/2))
            available = (bottom-top)/2-pad-radius*3
            date = _fit(draw, point.date, size, room, available*.38, small)
            rest = wrapped(draw,point.label,size,room,available*.62,small) if point.label else []
            fitted = [date]+rest; heights=[box[3]-box[1] for _,box,_ in fitted]; gap=max(2,round(fmt.height*.004))
            ty = y+radius*3 if i%2 else y-radius*3-sum(heights)-gap*(len(fitted)-1)
        for (font,box,shown),height in zip(fitted,heights):
            px = tx if vertical else max(left+pad,min(right-pad-(box[2]-box[0]),x-(box[2]-box[0])/2))
            draw.text((px-box[0],ty-box[1]),shown,font=font,fill=main); ty+=height+gap
    draw.ellipse((tip[0]-radius*1.5,tip[1]-radius*1.5,tip[0]+radius*1.5,tip[1]+radius*1.5),fill=accent)
    return image


def render_timeline_bar(item,fmt,progress):
    times=timeline_states(item,fmt.fps); local=times[min(len(times)-1,round(progress*(len(times)-1)))]
    return _smooth(_draw_timeline,item,fmt,local)
