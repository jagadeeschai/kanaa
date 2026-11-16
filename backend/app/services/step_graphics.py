"""Readable step lists and event-aligned cached states, shared by every renderer."""
from __future__ import annotations

from PIL import Image
from app.services.chart_graphics import _fit, _font, _frame, _smooth, clusters, least, number


def step_starts(item):
    count = len(item.graphic.steps)
    duration = min(item.length, item.enter.duration) if item.enter else .65
    defaults = [index * max(0, duration - .18) / max(1, count - 1) for index in range(count)]
    # Trimming the clip shorter must not make the project invalid: a tapped time past the end is simply not used.
    timed = [at for at in item.graphic.step_times or [] if at < item.length]
    if timed:
        # A partially tapped list leaves the remaining steps evenly spaced after the last tap.
        remaining = count - len(timed)
        return list(timed) + [timed[-1] + (item.length - timed[-1]) * (i + 1) / (remaining + 1) for i in range(remaining)]
    return defaults


def step_states(item, fps):
    """At most 81 states, including every exact event. Never quantise an event to an earlier frame."""
    starts = step_starts(item)
    times = {0.0}
    for index, at in enumerate(starts):
        end = min(item.length - 1e-8, at + .18, starts[index + 1] if index + 1 < len(starts) else item.length)
        for n in range(10):
            times.add(at + (end - at) * n / 9)
    return sorted(times)


def wrapped(draw, text, size, width, height, smallest):
    """Two lines maximum, breaking on words where possible and only whole letters otherwise."""
    size = max(smallest, size)
    while size > smallest and draw.textbbox((0, 0), 'கஊ', font=_font(text, size))[3] * 2 > height:
        size -= 1
    font = _font(text, size)
    sample = draw.textbbox((0, 0), 'கஊ', font=font)
    if (sample[3] - sample[1]) * 2 + 2 > height:
        return [_fit(draw, text, size, width, height, smallest)]
    if draw.textbbox((0, 0), text, font=font)[2] <= width:
        return [_fit(draw, text, size, width, height, smallest)]
    letters = clusters(text); cut = 0
    for i in range(1, len(letters) + 1):
        if draw.textbbox((0, 0), ''.join(letters[:i]), font=font)[2] > width: break
        cut = i
    prefix = ''.join(letters[:max(1, cut)])
    space = prefix.rfind(' ')
    # Break between words whenever the first line has one; only a single long word is broken between letters.
    if space > 0 and cut < len(letters): cut = len(clusters(prefix[:space]))
    elif ' ' in text.strip() and cut < len(letters): cut = len(clusters(text[:text.index(' ', 1)]))  # First word too wide: shrink it, don't split it.
    cut = max(1, cut)
    return [_fit(draw, ''.join(letters[:cut]).strip(), size, width, height // 2, smallest),
            _fit(draw, ''.join(letters[cut:]).strip(), size, width, height // 2, smallest)]


def _draw_steps(item, fmt, local):
    graphic, image, draw, (left, top, right, bottom), _, main, accent = _frame(item, fmt)
    starts = step_starts(item); current = max((i for i, at in enumerate(starts) if local >= at), default=-1)
    small = max(18, least(fmt)); pad = max(6, round(fmt.height * .02))
    row_h = (bottom - top - 2 * pad) / len(starts); badge = max(small, min(round(row_h * .65), round(fmt.height * .046)))
    # Text grows with the room each step has (3 steps in a tall panel read large), but never past a title's size.
    size = max(small, round(item.size * fmt.height / 1080), min(round(row_h * .3), round(fmt.height * .065) * item.size // 44))
    badge = max(badge, min(round(size * 1.35), round(row_h * .8)))
    for index, (text, at) in enumerate(zip(graphic.steps, starts)):
        if local < at: continue
        # A visible first state at the exact event, then a short slide/fade. Previous states contain no pixels for it.
        q = min(1, max(.08, (local - at) / .18)); opacity = round(255 * q)
        layer = Image.new('RGBA', image.size); from PIL import ImageDraw
        pen = ImageDraw.Draw(layer)
        y = top + pad + row_h * index; slide = round((1 - q) * pad)
        ink = accent if graphic.highlight_current and index == current else main
        if graphic.step_bullets:
            r = max(2, badge // 7); pen.ellipse((left + pad + badge // 2 - r, y + row_h / 2 - r, left + pad + badge // 2 + r, y + row_h / 2 + r), fill=ink)
        else:
            cy = y + row_h / 2; pen.ellipse((left + pad, cy - badge / 2, left + pad + badge, cy + badge / 2), outline=ink, width=max(1, round(fmt.height * .002)))
            f, box, label = _fit(pen, number(index + 1, graphic), max(small, round(badge * .55)), badge * .75, badge * .8, small)
            pen.text((left + pad + (badge - box[2] + box[0]) / 2 - box[0], cy - (box[3] - box[1]) / 2 - box[1]), label, font=f, fill=ink)
        x = left + pad * 2 + badge + slide
        lines = wrapped(pen, text, size, right - pad - x, row_h - 2, small)
        heights = [box[3] - box[1] for _, box, _ in lines]; gap = max(1, round(fmt.height * .003))
        ty = y + (row_h - sum(heights) - gap * (len(lines) - 1)) / 2
        for (font, box, shown), height in zip(lines, heights):
            pen.text((x - box[0], ty - box[1]), shown, font=font, fill=ink); ty += height + gap
        layer.putalpha(layer.getchannel('A').point(lambda a: round(a * opacity / 255)))
        image.alpha_composite(layer)
    return image


def render_steps(item, fmt, progress):
    times = step_states(item, fmt.fps)
    local = times[min(len(times) - 1, round(progress * (len(times) - 1)))]
    return _smooth(_draw_steps, item, fmt, local)
