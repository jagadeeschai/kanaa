"""Frame-exact drawing for arrows, highlights, callouts, spotlights and glow outlines shared by ffmpeg and GPU exports."""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from app.services.timeline_schema import Format, Text

STATES = 24  # Stroke graphics keep their existing cache size. Mirrored by frontend/src/timeline/graphics.ts.
MAX_STATES = 90


def state_count(item: Text, fps: int) -> int:
    """Count-up gets roughly one picture per entrance frame; strokes keep their proven 24 states."""
    if item.graphic and item.graphic.kind == 'step-list':
        from app.services.step_graphics import step_states
        return len(step_states(item, fps))
    if item.graphic and item.graphic.kind in ('count-up', 'bar-chart', 'line-chart', 'pie-chart') and item.enter and item.enter.preset == 'reveal':
        duration = max(1e-6, min(item.length, item.enter.duration))
        return min(MAX_STATES, max(2, round(duration * fps) + 1))
    return STATES


def state_at(item: Text, local: float, fps: int = 24) -> int:
    """Quantised stroke state at an item-local time; the preview uses the same formula."""
    if item.graphic and item.graphic.kind == 'step-list':
        from bisect import bisect_right
        from app.services.step_graphics import step_states
        return max(0, bisect_right(step_states(item, fps), local) - 1)
    if not item.graphic or not item.enter or item.enter.preset != 'reveal':
        return state_count(item, fps) - 1
    states = state_count(item, fps)
    duration = max(1e-6, min(item.length, item.enter.duration))
    if item.graphic.kind == 'lower-third' and item.exit and item.exit.preset == 'reveal':
        exit_duration = max(1e-6, min(item.length, item.exit.duration))
        if local > item.length - exit_duration:
            q = min(1, max(0, (item.length - local) / exit_duration))
            return min(states - 1, max(0, round((1 - (1 - q) ** 3) * (states - 1))))
    eased = 1 - (1 - min(1, max(0, local / duration))) ** 3
    return min(states - 1, max(0, round(eased * (states - 1))))


def _shorten(points: list[tuple[int, int]], share: float) -> list[tuple[int, int]]:
    if share >= 1 or len(points) < 2:
        return points
    lengths = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(points, points[1:])]
    left = sum(lengths) * max(0, share)
    out = [points[0]]
    for a, b, length in zip(points, points[1:], lengths):
        if left >= length:
            out.append(b); left -= length; continue
        if left > 0 and length:
            q = left / length
            out.append((round(a[0] + (b[0] - a[0]) * q), round(a[1] + (b[1] - a[1]) * q)))
        break
    return out


def _wobble(points: list[tuple[int, int]], amount: float) -> list[tuple[int, int]]:
    """A repeatable pen wobble across the stroke, not a duplicate offset line."""
    if len(points) < 3:
        a, b = points[0], points[-1]
        points = [(round(a[0] + (b[0]-a[0])*n/16), round(a[1] + (b[1]-a[1])*n/16)) for n in range(17)]
    return [(round(x + amount * math.sin(n * 1.73)), round(y + amount * math.sin(n * 2.37 + .8))) for n, (x, y) in enumerate(points)]


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    path = Path(__file__).parents[1] / 'assets' / 'fonts' / name
    return ImageFont.truetype(str(path), size, layout_engine=ImageFont.Layout.RAQM)


def _tamil(text: str) -> bool:
    return any('\u0b80' <= char <= '\u0bff' for char in text)


def format_count(value: int, indian: bool = False, tamil: bool = False) -> str:
    """Format an exact integer with Western or lakh/crore grouping and optional Tamil digits."""
    sign = '-' if value < 0 else ''
    digits = str(abs(value))
    if indian and len(digits) > 3:
        tail, head = digits[-3:], digits[:-3]
        groups = []
        while head:
            groups.insert(0, head[-2:]); head = head[:-2]
        digits = ','.join(groups + [tail])
    elif len(digits) > 3:
        digits = f'{abs(value):,}'
    result = sign + digits
    return result.translate(str.maketrans('0123456789', '௦௧௨௩௪௫௬௭௮௯')) if tamil else result


def count_value(graphic, progress: float) -> int:
    start, end = graphic.count_from, graphic.count_to
    return end if progress >= 1 else round(start + (end - start) * min(1, max(0, progress)))


def render(item: Text, fmt: Format, target: Path, progress: float = 1) -> None:
    graphic = item.graphic
    assert graphic is not None
    progress = min(1, max(0, progress))
    image = Image.new('RGBA', (fmt.width, fmt.height), (0, 0, 0, 0))
    value = item.color.lstrip('#')
    colour = tuple(int(value[index:index + 2], 16) for index in (0, 2, 4)) + (255,)
    width = max(2, round(graphic.line_width * fmt.height))
    a = (round(graphic.from_[0] * fmt.width), round(graphic.from_[1] * fmt.height))
    b = (round(graphic.to[0] * fmt.width), round(graphic.to[1] * fmt.height))
    draw = ImageDraw.Draw(image)

    def stroke(points: list[tuple[int, int]], share=progress):
        shown = _shorten(points, share)
        if len(shown) < 2:
            return shown
        if graphic.style == 'hand-drawn':
            shown = _wobble(shown, max(1.2, width * .32))
        draw.line(shown, fill=colour, width=width, joint='curve')
        return shown

    if graphic.kind == 'step-list':
        from app.services.step_graphics import render_steps
        image = render_steps(item, fmt, progress)
    elif graphic.kind in ('bar-chart', 'line-chart', 'pie-chart'):
        from app.services.chart_graphics import render_bar_chart, render_line_chart, render_pie_chart
        image = render_bar_chart(item, fmt, progress) if graphic.kind == 'bar-chart' else render_line_chart(item, fmt, progress) if graphic.kind == 'line-chart' else render_pie_chart(item, fmt, progress)
    elif graphic.kind == 'chapter-card':
        full = graphic.card_mode == 'full'; q = progress
        if full:
            shade = Image.new('RGBA', image.size, (0, 0, 0, round(165 * q)))
            image = Image.alpha_composite(image, shade); draw = ImageDraw.Draw(image)
            panel_w, panel_h = round(fmt.width * .76), round(fmt.height * .28)
            x0, y0 = round((fmt.width-panel_w)/2), round((fmt.height-panel_h)/2)
        else:
            panel_w, panel_h = round(graphic.width*fmt.width), round(graphic.height*fmt.height)
            x0, y0 = round(graphic.to[0]*fmt.width), round(graphic.to[1]*fmt.height)
            x0 = min(fmt.width-panel_w-width*2, max(width*2, x0)); y0 = min(fmt.height-panel_h-width*2, max(width*2, y0))
        accent = (245, 193, 27, 255) if graphic.style == 'documentary' else colour
        if not full or graphic.style in ('dark-band', 'bold-colour', 'documentary'):
            fill = (12, 15, 21, round(238*q)) if graphic.style == 'dark-band' else (44, 38, 18, round(238*q)) if graphic.style == 'documentary' else (58, 70, 180, round(238*q)) if graphic.style == 'bold-colour' else (12, 15, 21, round(210*q))
            draw.rounded_rectangle((x0, y0, x0+panel_w, y0+panel_h), radius=max(8, round(panel_h*.06)), fill=fill)
        line_q = min(1, q/.35)
        draw.line((x0+round(panel_w*.08), y0+round(panel_h*.78), x0+round(panel_w*(.08+.84*line_q)), y0+round(panel_h*.78)), fill=accent, width=max(width, round(fmt.height*.008)))
        if q > .25:
            shown = min(1, (q-.25)/.75); opacity = round(255*shown); slide = round((1-shown)*panel_w*.1)
            # Full screen: a title, about a third of the panel tall (Text size scales it); a corner card uses Text size as is.
            # Either way it shrinks until it fits the panel, so a long chapter name never runs off.
            face = 'Arima-Bold.ttf' if _tamil(item.text) else 'NotoSans-Bold.ttf'
            size = round(panel_h * .3 * item.size / 44) if full else round(item.size * fmt.height / 1080)
            size = max(12, size); font = _font(face, size)
            bounds = draw.textbbox((0, 0), item.text, font=font)
            while size > 12 and (bounds[2]-bounds[0] > panel_w * .84 or bounds[3]-bounds[1] > panel_h * .55):
                size = max(12, round(size * .9)); font = _font(face, size); bounds = draw.textbbox((0, 0), item.text, font=font)
            tw, th = bounds[2]-bounds[0], bounds[3]-bounds[1]
            ink = (245, 193, 27, opacity) if graphic.style == 'documentary' else (255, 255, 255, opacity)
            tx = x0 + (panel_w-tw)//2 - slide; ty = y0 + (panel_h-th)//2 - bounds[1] - round(panel_h*.05)
            draw.text((tx, ty), item.text, font=font, fill=ink)
    elif graphic.kind == 'count-up':
        value = count_value(graphic, progress)
        number = f'{graphic.prefix}{format_count(value, graphic.indian_grouping, graphic.tamil_numerals)}{graphic.suffix}'
        label = graphic.label or ''
        number_size = max(22, round(item.size * 1.45 * fmt.height / 1080)); label_size = max(12, round(number_size * .42))
        font_name = 'Arima-Bold.ttf' if graphic.tamil_numerals or _tamil(number + label) else 'NotoSans-Bold.ttf'
        number_font, label_font = _font(font_name, number_size), _font('Arima-Bold.ttf' if _tamil(label) else 'NotoSans-Bold.ttf', label_size)
        number_box = draw.textbbox((0, 0), number, font=number_font); label_box = draw.textbbox((0, 0), label or ' ', font=label_font)
        tw = max(number_box[2], label_box[2]); th = number_box[3] - number_box[1] + (label_box[3] - label_box[1] if label else 0) + round(label_size * .35)
        x0 = round(b[0] - tw / 2); y0 = round(b[1] - th / 2); pad = max(8, round(fmt.height * .018))
        if graphic.style in ('dark-band', 'bold-colour', 'documentary'):
            fill = (12, 15, 21, 235) if graphic.style == 'dark-band' else (44, 38, 18, 240) if graphic.style == 'documentary' else (58, 70, 180, 240)
            draw.rounded_rectangle((x0-pad, y0-pad, x0+tw+pad, y0+th+pad), radius=pad, fill=fill)
        ink = (245, 193, 27, 255) if graphic.style == 'documentary' else (255, 255, 255, 255) if graphic.style == 'bold-colour' else colour
        draw.text((x0 + (tw-number_box[2])/2, y0-number_box[1]), number, font=number_font, fill=ink)
        if label: draw.text((x0 + (tw-label_box[2])/2, y0 + number_box[3]-number_box[1] + round(label_size*.35)-label_box[1]), label, font=label_font, fill=ink)
    elif graphic.kind == 'lower-third':
        name_size = max(16, round(item.size * fmt.height / 1080)); role_size = max(12, round(name_size * .58))
        name_font = _font('Arima-Bold.ttf' if _tamil(item.text) else 'NotoSans-Bold.ttf', name_size)
        role_text = graphic.role or ''
        role_font = _font('Arima-Bold.ttf' if _tamil(role_text) else 'NotoSans-Bold.ttf', role_size)
        name_box = draw.textbbox((0, 0), item.text or ' ', font=name_font)
        role_box = draw.textbbox((0, 0), role_text, font=role_font) if role_text else (0, 0, 0, 0)
        gap = round(name_size * .25) if role_text else 0
        # The panel grows to fit both lines (Tamil letters reach well below the line), however small the frame.
        pad_y = max(4, round(name_size * .3)); pad_x = max(6, round(name_size * .45))
        text_h = (name_box[3] - name_box[1]) + gap + (role_box[3] - role_box[1])
        panel_w = min(fmt.width - width * 4, max(round(graphic.width * fmt.width), max(name_box[2], role_box[2]) + pad_x * 2))
        panel_h = min(fmt.height - width * 4, max(round(graphic.height * fmt.height), text_h + pad_y * 2))
        x0 = round(graphic.to[0] * fmt.width); y0 = round(graphic.to[1] * fmt.height)
        x0 = min(fmt.width - panel_w - width * 2, max(width * 2, x0)); y0 = min(fmt.height - panel_h - width * 2, max(width * 2, y0))
        accent = (245, 193, 27, 255) if graphic.style == 'documentary' else colour
        if graphic.style in ('dark-band', 'bold-colour', 'documentary'):
            fill = (12, 15, 21, round(232 * progress)) if graphic.style == 'dark-band' else (44, 38, 18, round(240 * progress)) if graphic.style == 'documentary' else (58, 70, 180, round(240 * progress))
            draw.rounded_rectangle((x0, y0, x0 + panel_w, y0 + panel_h), radius=max(5, round(panel_h * .08)), fill=fill)
        line_share = min(1, progress / .34)
        draw.line((x0, y0 + panel_h, x0 + round(panel_w * line_share), y0 + panel_h), fill=accent, width=max(width, round(fmt.height * .008)))
        if progress > .28:
            q = min(1, (progress - .28) / .72); slide = round((1 - q) * panel_w * .12); opacity = round(255 * q)
            ink = (245, 193, 27, opacity) if graphic.style == 'documentary' else (255, 255, 255, opacity)
            px = x0 + pad_x - slide; top = y0 + (panel_h - text_h) // 2
            draw.text((px, top - name_box[1]), item.text, font=name_font, fill=ink)
            if role_text: draw.text((px, top + name_box[3] - name_box[1] + gap - role_box[1]), role_text, font=role_font, fill=ink)
    elif graphic.kind.startswith('arrow'):
        if graphic.kind == 'arrow-curved':
            control = ((a[0] + b[0]) / 2, min(a[1], b[1]) - abs(b[0] - a[0]) * .22)
            points = [(round((1-q)**2*a[0] + 2*(1-q)*q*control[0] + q*q*b[0]), round((1-q)**2*a[1] + 2*(1-q)*q*control[1] + q*q*b[1])) for q in (n / 48 for n in range(49))]
        else:
            points = [a, b]
        shown = stroke(points)
        if len(shown) >= 2 and progress > .04:
            tip, before = shown[-1], shown[-2]
            angle = math.atan2(tip[1] - before[1], tip[0] - before[0]); head = max(width * 4, round(fmt.height * .035))
            left = (round(tip[0] - head * math.cos(angle - .55)), round(tip[1] - head * math.sin(angle - .55)))
            right = (round(tip[0] - head * math.cos(angle + .55)), round(tip[1] - head * math.sin(angle + .55)))
            draw.line(_wobble([left, tip, right], max(1, width * .2)) if graphic.style == 'hand-drawn' else [left, tip, right], fill=colour, width=width, joint='curve')
    elif graphic.kind == 'circle':
        half_w, half_h = graphic.width * fmt.width / 2, graphic.height * fmt.height / 2
        box = (round(b[0]-half_w), round(b[1]-half_h), round(b[0]+half_w), round(b[1]+half_h))
        if graphic.style == 'hand-drawn':
            points = [(round(b[0] + half_w * math.cos(-math.pi/2 + 2*math.pi*n/80)), round(b[1] + half_h * math.sin(-math.pi/2 + 2*math.pi*n/80))) for n in range(81)]
            stroke(points)
        else:
            draw.arc(box, -90, -90 + 360 * progress, fill=colour, width=width)
    elif graphic.kind == 'box':
        half_w, half_h = graphic.width * fmt.width / 2, graphic.height * fmt.height / 2
        left, top, right, bottom = round(b[0]-half_w), round(b[1]-half_h), round(b[0]+half_w), round(b[1]+half_h)
        radius = max(width * 2, round(fmt.height * .025))
        # A sampled rounded rectangle lets the stroke genuinely travel around its perimeter.
        points = []
        for cx, cy, start in ((left+radius, top+radius, math.pi), (right-radius, top+radius, -math.pi/2), (right-radius, bottom-radius, 0), (left+radius, bottom-radius, math.pi/2)):
            points += [(round(cx + radius*math.cos(start + math.pi*n/2/12)), round(cy + radius*math.sin(start + math.pi*n/2/12))) for n in range(13)]
        points.append(points[0]); stroke(points)
    elif graphic.kind == 'spotlight':
        # The rest of the frame darkens while the light closes in on the spot; styles other than clean add a ring.
        grow = 1 + .6 * (1 - progress)
        half_w, half_h = graphic.width * fmt.width / 2 * grow, graphic.height * fmt.height / 2 * grow
        hole = Image.new('L', (fmt.width, fmt.height), 255)
        ImageDraw.Draw(hole).ellipse((round(b[0]-half_w), round(b[1]-half_h), round(b[0]+half_w), round(b[1]+half_h)), fill=0)
        hole = hole.filter(ImageFilter.GaussianBlur(max(2, fmt.height * .03)))
        alpha = (np.asarray(hole, np.float32) * graphic.dim * progress).round().astype(np.uint8)
        shade = Image.new('RGBA', (fmt.width, fmt.height), (0, 0, 0, 0))
        shade.putalpha(Image.fromarray(alpha))
        image = Image.alpha_composite(shade, image)
        draw = ImageDraw.Draw(image)
        if graphic.style != 'clean':
            ring = [(round(b[0] + half_w * math.cos(-math.pi/2 + 2*math.pi*n/80)), round(b[1] + half_h * math.sin(-math.pi/2 + 2*math.pi*n/80))) for n in range(81)]
            stroke(ring)
    elif graphic.kind == 'outline':
        points = [(round(x * fmt.width), round(y * fmt.height)) for x, y in graphic.shape or []]
        stroke(points + points[:1])
    else:
        line_progress = min(1, progress / .68)
        stroke([a, b], line_progress)
        if progress > .58:
            opacity = round(255 * min(1, (progress - .58) / .42))
            font = _font('Arima-Bold.ttf' if _tamil(item.text) else 'NotoSans-Bold.ttf', max(16, round(item.size * fmt.height / 1080)))
            padding = max(8, round(fmt.height * .012)); bounds = draw.textbbox((0, 0), item.text or ' ', font=font)
            tw, th = bounds[2] - bounds[0], bounds[3] - bounds[1]
            # Prefer the right of the pointer, flip to the left at the edge, and clamp vertically.
            right_side = b[0] + tw + padding * 2 <= fmt.width - padding
            x0 = b[0] - padding if right_side else b[0] - tw - padding
            y0 = min(fmt.height - th - padding * 3, max(padding, b[1] - th - padding * 2))
            label = (x0, y0, x0 + tw + padding * 2, y0 + th + padding * 2)
            backing = (245, 193, 27, round(245 * opacity / 255)) if graphic.style == 'documentary' else (15, 15, 18, round(232 * opacity / 255))
            draw.rounded_rectangle(label, radius=padding, fill=backing)
            ink = (20, 20, 20, opacity) if graphic.style == 'documentary' else (255, 255, 255, opacity)
            draw.text((x0 + padding, y0 + padding - bounds[1]), item.text or ' ', font=font, fill=ink)
    if graphic.style == 'neon' or graphic.kind == 'outline':
        # A glow outline always glows; neon glows everything.
        glow = image.filter(ImageFilter.GaussianBlur(max(3, width * 1.6)))
        image = Image.alpha_composite(glow, image)
        if graphic.kind == 'outline':
            image = Image.alpha_composite(image.filter(ImageFilter.GaussianBlur(max(6, width * 3.5))), image)
    image.save(target)


def frames(item: Text, fmt: Format, fps: int, total: int, folder: Path, prefix: str) -> tuple[list[Path], list[int]]:
    states = state_count(item, fps)
    shown = [state_at(item, number / fps, fps) for number in range(total)]
    paths: list[Path] = []
    for state in sorted(set(shown)):
        target = folder / f'{prefix}-{state:02d}.png'
        render(item, fmt, target, state / (states - 1))
        paths.append(target)
    by_state = {int(path.stem.rsplit('-', 1)[1]): index for index, path in enumerate(paths)}
    return paths, [by_state[state] for state in shown]
