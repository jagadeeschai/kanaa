"""Adjustment layers: a span whose look, colour and glow change everything drawn below it, fading in and out.

The export grades a copy of the picture so far with the same filters a clip uses (picture_filters,
dreamy_glow_filters) and lays it back over the original, its alpha fading in and out and only during the span.
The preview does the same over the composite (playback.ts drawAdjust).
"""
from app.services.timeline_schema import AdjustItem, AdjustLayer


def grade_filters(item: AdjustItem) -> list[str]:
    from app.services.timeline_service import dreamy_glow_filters, picture_filters
    from app.services.colour_wheels import wheel_filters
    return [*picture_filters(item.adjust, item.look), *wheel_filters(item.wheels), *dreamy_glow_filters(item.dreamy_glow)]


def fade_filters(item: AdjustItem) -> list[str]:
    """The graded copy's alpha: in over fade_in from the start, out over fade_out to the end."""
    end = item.start + item.length
    fade_in, fade_out = min(item.fade_in, item.length / 2), min(item.fade_out, item.length / 2)
    steps = []
    if fade_in > 0:
        steps.append(f'fade=t=in:st={item.start:.4f}:d={fade_in:.4f}:alpha=1')
    if fade_out > 0:
        steps.append(f'fade=t=out:st={end - fade_out:.4f}:d={fade_out:.4f}:alpha=1')
    return steps


def strength(item: AdjustItem, t: float) -> float:
    """How much of the graded picture shows at time t (the preview's opacity)."""
    local = t - item.start
    if local < 0 or local >= item.length:
        return 0.0
    fade_in, fade_out = min(item.fade_in, item.length / 2), min(item.fade_out, item.length / 2)
    up = local / fade_in if fade_in > 0 else 1.0
    down = (item.length - local) / fade_out if fade_out > 0 else 1.0
    return max(0.0, min(1.0, up, down))


def add_adjust_layer(graph: list[str], layer: AdjustLayer, position: int, base: str) -> str:
    for number, item in enumerate(sorted(layer.items, key=lambda entry: entry.start)):
        grade = grade_filters(item)
        if not grade:
            continue
        name = f'adj{position}_{number}'
        end = item.start + item.length
        steps = ','.join([*grade, 'format=gbrap', *fade_filters(item)])
        graph += [f'[{base}]split=2[{name}_keep][{name}_src]', f'[{name}_src]{steps}[{name}_fx]',
                  f"[{name}_keep][{name}_fx]overlay=format=gbrp:eof_action=pass:enable='between(t,{item.start:.4f},{end:.4f})'[{name}_out]"]
        base = f'{name}_out'
    return base
