"""Enter and exit presets, looks and transitions. frontend/src/timeline/animation.ts holds the same math."""
from __future__ import annotations

import math

MAX_BLUR = 0.03  # Of the frame height.
# Opacity is always linear, so ffmpeg's fade filter can draw it exactly. The value is the share of the animation it takes.
OPACITY_SPAN = {'fade': 1, 'zoom': 1, 'pop': 1 / 3, 'blur': 1, 'bounce': 1 / 3, 'blast': .22, 'magic-form': .7, 'magic-vanish': .8, 'particle-form': .9, 'rise-behind': .25, 'push-through': .35,
                'chromatic': .4, 'prism': .4, 'echo': .5, 'blur-sideways': .6}
# Title picture tricks (PictureLook in animation.ts), drawn in the title's own picture by title3d_render.py.
PICTURE_PRESETS = {'reveal', 'soft-edge', 'line', 'chromatic', 'prism', 'echo', 'pop-letters', 'gravity', 'split', 'expand', 'blur-sideways'}
# Letter by letter (letterLook in animation.ts): dx in widths of the title's letters box, dy in its heights, scale about
# each letter's own middle. Pop-up letters and Gravity start one after another across LETTER_STAGGER of the animation.
LETTER_PRESETS = {'pop-letters', 'gravity', 'split', 'expand'}
LETTER_STAGGER = 0.6
LETTER_REST = {'dx': 0.0, 'dy': 0.0, 'scale': 1.0, 'opacity': 1.0}
PICTURE_REST = {'reveal': 1.0, 'soft': 0.0, 'rise': 1.0, 'line': -1.0, 'split': 0.0, 'trick': 0, 'streak': 0.0}
STREAK_TAPS = 8  # A sideways blur's taps either side of the middle. Matches animation.ts.
TRICK_COPIES = 4
TRICK_MARGIN = 1.25  # How far beyond the letters, in letter heights, the tricks may reach.
LINE_DRAW, RISE_FROM = .45, .35
XFADE_NAMES = {'crossfade': 'fade', 'wipe': 'wipeleft', 'slide': 'slideleft', 'zoom': 'zoomin', 'flash': 'fadewhite', 'dip': 'fadeblack', 'whip': 'slideleft',
               'circle-open': 'circleopen', 'circle-close': 'circleclose', 'cross-blur': 'fade'}
CROSS_BLUR = 0.025  # Peak blur of a cross blur, as a share of the frame height, halfway through. Matches animation.ts.


def xfade_name(transition) -> str:
    """ffmpeg's xfade transition for a timeline transition: a wipe or slide goes the chosen way (left when none).
    A dip or flash through a chosen colour is a custom blend with the same weights as fadeblack/fadewhite and the
    preview's dipWeights, on RGB planes (G, B, R, A as ffmpeg's gbrap orders them)."""
    colour = getattr(transition, 'color', None)
    if transition.kind in ('dip', 'flash') and colour and colour.lower() not in ('#000000', '#ffffff'):
        r, g, b = (int(colour[i:i + 2], 16) for i in (1, 3, 5))
        smooth = 'st({n},clip((P-{lo})/(1-{lo}),0,1));ld({n})*ld({n})*(3-2*ld({n}))'
        before, after = smooth.format(n=0, lo=0.8), smooth.format(n=1, lo=0.2)
        fill = f'if(eq(PLANE,0),{g},if(eq(PLANE,1),{b},if(eq(PLANE,2),{r},255)))'
        expr = f"st(2,{before});st(3,{after});A*P*ld(2)+B*(1-P)*(1-ld(3))+({fill})*(P*(1-ld(2))+(1-P)*ld(3))"
        return f"custom:expr='{expr}'"
    if transition.kind == 'dip' and colour and colour.lower() == '#ffffff':
        return 'fadewhite'
    if transition.kind == 'flash' and colour and colour.lower() == '#000000':
        return 'fadeblack'
    if transition.kind in ('wipe', 'slide') and transition.direction:
        return f'{transition.kind}{transition.direction}'
    return XFADE_NAMES[transition.kind]
WHIP_BLUR = 0.05  # Peak horizontal blur of a whip, as a share of the frame height. Matches animation.ts.
# Red, green and blue gain, contrast, saturation.
LOOKS = {'none': (1, 1, 1, 1, 1), 'warm': (1.08, 1, 0.9, 1.02, 1.05), 'cool': (0.92, 1, 1.1, 1.02, 1), 'mono': (1, 1, 1, 1.1, 0),
         'vivid': (1, 1, 1, 1.1, 1.35), 'film': (1.03, 1, 0.96, 0.88, 0.85)}
SLIDES = {'slide-up': (0, 1), 'slide-down': (0, -1), 'slide-left': (1, 0), 'slide-right': (-1, 0)}


def ease_out(p: float) -> float:
    return 1 - (1 - p) ** 3


def look_at(preset: str, p: float) -> dict[str, float]:
    """The item's state `p` of the way through a preset: 0 is the hidden end, 1 is at rest."""
    p = min(1, max(0, p))
    e = ease_out(p)
    span = OPACITY_SPAN.get(preset)
    look = {'dx': 0.0, 'dy': 0.0, 'scale': 1.0, 'opacity': min(1, p / span) if span else 1.0, 'blur': 0.0}
    if preset in SLIDES:
        x, y = SLIDES[preset]
        look.update(dx=x * (1 - e), dy=y * (1 - e))
    elif preset == 'zoom':
        look['scale'] = 0.6 + 0.4 * e
    elif preset == 'pop':
        look['scale'] = max(0.01, 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2)
    elif preset == 'blur':
        look['blur'] = (1 - e) * MAX_BLUR
    elif preset == 'bounce':
        look['dy'] = -0.6 * abs(math.cos(3 * math.pi * p)) * (1 - p) ** 2
    elif preset == 'ground-rise':
        look['dy'] = 0.62 * math.exp(-6 * p) * math.cos(8 * p)
    elif preset == 'blast':
        look.update(scale=1 + 1.25 * math.exp(-7 * p) * math.cos(10 * p) * (1 - p), blur=.018 * (1 - e))
    elif preset == 'magic-form':
        look.update(scale=.68 + .32 * e, blur=.035 * (1 - e), dy=.05 * math.sin(16 * p) * (1 - p))
    elif preset == 'magic-vanish':
        look.update(scale=1.38 - .38 * e, blur=.04 * (1 - e))
    elif preset == 'particle-form':
        look.update(scale=.9 + .1 * e, blur=.018 * (1 - e))
    # Cinema reveals, drawn through title3d. Rise descends gently and settles onto a floor plane; the cubic reaches
    # zero velocity at the landing, avoiding a visible snap between the last animated frame and the resting title.
    elif preset == 'rise-behind':
        look.update(dy=-.32 * (1 - e), tilt=68 * e)
    elif preset == 'push-through':
        look.update(scale=.18 + .82 * e + .08 * math.sin(math.pi * p) * e, dy=-.08 * (1 - e), tilt=75 * (1 - e) ** 2)
    # Picture tricks: a wipe across the letters, hard or soft; a line drawn out, then the letters rising from it; colour
    # copies or fading copies that close in on the letters.
    elif preset == 'reveal':
        look.update(reveal=e, soft=.04)
    elif preset == 'soft-edge':
        look.update(reveal=p * p * (3 - 2 * p), soft=.35)
    elif preset == 'line':
        drawn, risen = min(1, p / LINE_DRAW), min(1, max(0, (p - RISE_FROM) / (1 - RISE_FROM)))
        look.update(line=1 - (1 - drawn) ** 3, rise=1 - (1 - risen) ** 3)
    elif preset == 'chromatic':
        look.update(split=.35 * (1 - e), trick=1)
    elif preset == 'prism':
        look.update(split=.3 * (1 - e), trick=2)
    elif preset == 'echo':
        look.update(split=.8 * (1 - e), trick=3)
    elif preset == 'blur-sideways':  # A sideways blur, its width a share of the letters' height, easing to sharp.
        look.update(streak=.3 * (1 - e))
    return look


def offset_expression(preset: str, axis: str, p: str) -> str | None:
    if preset in SLIDES:
        amount = SLIDES[preset][0 if axis == 'dx' else 1]
        return f'({amount}*pow(1-{p},3))' if amount else None
    if preset == 'bounce' and axis == 'dy':
        return f'(-0.6*abs(cos({3 * math.pi}*{p}))*pow(1-{p},2))'
    if preset == 'ground-rise' and axis == 'dy':
        return f'(0.62*exp(-6*{p})*cos(8*{p}))'
    if preset == 'magic-form' and axis == 'dy':
        return f'(0.05*sin(16*{p})*(1-{p}))'
    return None


def scale_expression(preset: str, p: str) -> str | None:
    if preset == 'zoom':
        return f'(0.6+0.4*(1-pow(1-{p},3)))'
    if preset == 'pop':
        return f'max(0.01,1+2.7*pow({p}-1,3)+1.7*pow({p}-1,2))'
    if preset == 'blast':
        return f'(1+1.25*exp(-7*{p})*cos(10*{p})*(1-{p}))'
    if preset == 'magic-form':
        return f'(0.68+0.32*(1-pow(1-{p},3)))'
    if preset == 'magic-vanish':
        return f'(1.38-0.38*(1-pow(1-{p},3)))'
    if preset == 'particle-form':
        return f'(0.9+0.1*(1-pow(1-{p},3)))'
    return None


def chroma_yuv(color: str) -> tuple[int, int, int]:
    """A #rrggbb colour as limited-range BT.709, the form video is keyed in."""
    r, g, b = (int(color[index:index + 2], 16) / 255 for index in (1, 3, 5))
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return round(16 + 219 * luma), round(128 + 224 * (b - luma) / 1.8556), round(128 + 224 * (r - luma) / 1.5748)


def picture_look(first: dict, last: dict) -> dict:
    """Enter and exit picture tricks together, as pictureLook in animation.ts: the less shown wins, a line is drawn by
    whichever has one, the wider copies win."""
    a = {**PICTURE_REST, **{key: first[key] for key in PICTURE_REST if key in first}}
    b = {**PICTURE_REST, **{key: last[key] for key in PICTURE_REST if key in last}}
    line = b['line'] if a['line'] < 0 else a['line'] if b['line'] < 0 else min(a['line'], b['line'])
    copies = b if b['split'] > a['split'] else a
    return {'reveal': min(a['reveal'], b['reveal']), 'soft': max(a['soft'], b['soft']), 'rise': min(a['rise'], b['rise']), 'line': line,
            'split': copies['split'], 'trick': copies['trick'] if copies['split'] > 0 else max(a['trick'], b['trick']), 'streak': max(a['streak'], b['streak'])}


def letter_look(preset: str, progress: float, index: int, count: int, u: float) -> dict:
    """Letter `index` of `count`, whose middle is `u` widths of the letters box from its middle. As letterLook in animation.ts."""
    if preset not in LETTER_PRESETS:
        return dict(LETTER_REST)
    p = min(1, max(0, progress))
    staggered = preset in ('pop-letters', 'gravity')
    k = min(1, max(0, (p - LETTER_STAGGER * index / (count - 1)) / (1 - LETTER_STAGGER))) if staggered and count > 1 else p
    e = 1 - (1 - k) ** 3
    if preset == 'pop-letters':
        return {'dx': 0.0, 'dy': 0.0, 'scale': max(0.01, 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2), 'opacity': min(1, k * 3)}
    if preset == 'gravity':
        return {'dx': 0.0, 'dy': -1.4 * abs(math.cos(3 * math.pi * k)) * (1 - k) ** 2, 'scale': 1.0, 'opacity': min(1, k * 4)}
    if preset == 'split':
        return {'dx': u * 1.2 * (1 - e), 'dy': 0.0, 'scale': 1.0, 'opacity': min(1, k * 2.5)}
    return {'dx': -u * .85 * (1 - e), 'dy': 0.0, 'scale': 1.0, 'opacity': min(1, k * 2)}


def letter_looks(enter, exit_, local: float, length: float, us: list[float]) -> list[dict]:
    """Every letter's look `local` seconds in, enter and exit together. As letterLooks in animation.ts."""
    excess = max(1, ((enter.duration if enter else 0) + (exit_.duration if exit_ else 0)) / length)
    out = []
    for index, u in enumerate(us):
        a = letter_look(enter.preset, local / (enter.duration / excess), index, len(us), u) if enter else LETTER_REST
        b = letter_look(exit_.preset, (length - local) / (exit_.duration / excess), index, len(us), u) if exit_ else LETTER_REST
        out.append({'dx': a['dx'] + b['dx'], 'dy': a['dy'] + b['dy'], 'scale': a['scale'] * b['scale'], 'opacity': a['opacity'] * b['opacity']})
    return out
