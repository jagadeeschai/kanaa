"""Before / after split: a divider that slides across the frame, with a label on each side.

The divider is an explainer graphic, drawn like every other one (preview, ffmpeg and GPU show the same pictures). The
"after" clip it is linked to shows only to the divider's right; the export and the preview both cut it with `split_at`,
which steps exactly as the graphic's states do, so the clip's edge never drifts from the line.
"""
from __future__ import annotations

import math

from PIL import Image, ImageDraw

from app.services.chart_graphics import _fit, _frame, _smooth, least

MAX_STEPS = 88


def _step(graphic, fps: int) -> float:
    return max(1 / fps, graphic.split_move / MAX_STEPS)


def compare_states(item, fps: int) -> list[float]:
    """Item-local times where the picture changes: once at the start, then every step of the slide."""
    graphic = item.graphic; step = _step(graphic, fps)
    count = math.ceil(graphic.split_move / step - 1e-9)
    return sorted({0.0, *(graphic.split_delay + min(graphic.split_move, k * step) for k in range(count + 1))})


def ease(q: float) -> float:
    q = min(1.0, max(0.0, q)); return q * q * (3 - 2 * q)


def split_at(graphic, local: float, fps: int) -> float:
    """Divider position (share of the frame width) at graphic-local time `local`, held between states."""
    if local < graphic.split_delay: return graphic.split_from
    step = _step(graphic, fps)
    shown = min(graphic.split_move, math.floor((local - graphic.split_delay) / step + 1e-6) * step)
    return graphic.split_from + (graphic.split_to - graphic.split_from) * ease(shown / graphic.split_move)


def split_expression(graphic, offset: float, fps: int) -> str:
    """`split_at` as an ffmpeg expression in the clip's own time `t`; `offset` is the graphic's start within the clip."""
    step = _step(graphic, fps); delay, move = graphic.split_delay, graphic.split_move
    local = f'(t-({offset:.6f}))'
    shown = f'min({move:.6f},floor(({local}-{delay:.6f})/{step:.9f}+1e-6)*{step:.9f})'
    q = f'({shown}/{move:.6f})'
    eased = f'({q}*{q}*(3-2*{q}))'
    moving = f'({graphic.split_from:.6f}+({graphic.split_to - graphic.split_from:.6f})*{eased})'
    return f'if(lt({local},{delay:.6f}),{graphic.split_from:.6f},{moving})'


def _draw_compare(item, fmt, local):
    graphic, _, _, _, panel, main, accent = _frame(item, fmt)   # Colours only: the style's panel would cover the frame.
    image = Image.new('RGBA', (fmt.width, fmt.height), (0, 0, 0, 0)); draw = ImageDraw.Draw(image)
    width, height = fmt.width, fmt.height; x = split_at(graphic, local, round(fmt.fps)) * width
    stroke = max(2, round(graphic.line_width * height)); radius = max(8, round(height * .03))
    draw.rectangle((round(x - stroke / 2), 0, round(x + stroke / 2), height), fill=main)
    cy = height / 2
    draw.ellipse((x - radius, cy - radius, x + radius, cy + radius), fill=main)
    arrow = radius * .42; dark = (20, 22, 26, 255)
    for sign in (-1, 1):
        tip = x + sign * radius * .62
        draw.polygon([(tip, cy), (tip - sign * arrow, cy - arrow), (tip - sign * arrow, cy + arrow)], fill=dark)
    # Labels sit in the top corners on their own side, and fade as the divider passes over them.
    pad = max(8, round(height * .035)); size = max(least(fmt), round(item.size * height / 1080))
    fill = panel or (12, 15, 21, 200); ink = accent if graphic.style in ('documentary', 'bold-colour') else (255, 255, 255, 255)
    for text, left_side in ((graphic.before_label, True), (graphic.after_label, False)):
        if not text.strip(): continue
        font, box, shown = _fit(draw, text, size, round(width * .4), round(height * .12), least(fmt))
        w, h = box[2] - box[0], box[3] - box[1]; inner = round(h * .45)
        bx0 = pad if left_side else width - pad - w - 2 * inner; bx1 = bx0 + w + 2 * inner
        room = (x - bx1) if left_side else (bx0 - x)
        alpha = max(0.0, min(1.0, room / (pad * 2)))
        if alpha <= 0: continue
        layer = Image.new('RGBA', image.size); pen = ImageDraw.Draw(layer)
        pen.rounded_rectangle((bx0, pad, bx1, pad + h + 2 * inner), radius=(h + 2 * inner) // 2, fill=fill)
        pen.text((bx0 + inner - box[0], pad + inner - box[1]), shown, font=font, fill=ink)
        layer.putalpha(layer.getchannel('A').point(lambda a: round(a * alpha)))
        image.alpha_composite(layer)
    return image


def render_compare(item, fmt, progress):
    times = compare_states(item, round(fmt.fps)); local = times[min(len(times) - 1, round(progress * (len(times) - 1)))]
    return _smooth(_draw_compare, item, fmt, local)
