"""Split screen reveal: the next clip slides in beside this one, both play side by side for a moment, then the next one
takes the whole frame. Shared with frontend/src/timeline/split-screen.ts; the ffmpeg export, the GPU engine and the
preview all draw it from these numbers.

Each picture shows through a window of the frame, centred on its own middle: the outgoing clip's window shrinks to half,
holds, then closes; the incoming clip's opens to half, holds, then fills. Coordinates are top-left frame pixels, on the
two-pixel grid the 4:2:0 encoders share. `direction` is where the new clip travels: left (the default) means it comes in
from the right.
"""
from __future__ import annotations

import math

OPEN, HOLD = 0.35, 0.65  # The new clip opens to half by OPEN of the way through, holds side by side until HOLD, then fills.


def _smooth(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def amount(q: float) -> float:
    """How much of the frame the new clip has, 0 to 1."""
    if q < OPEN:
        return 0.5 * _smooth(q / OPEN)
    if q < HOLD:
        return 0.5
    return 0.5 + 0.5 * _smooth((q - HOLD) / (1 - HOLD))


def _even(value: float) -> int:
    return 2 * math.floor(value / 2 + 0.5)


def parts(q: float, direction: str | None, width: int, height: int) -> dict[str, list[int]]:
    """The window [x, y, w, h] each picture shows through and how far its picture moves [dx, dy], for the old clip ("a")
    and the new one ("b"), `q` of the way through."""
    a = amount(q)
    vertical = direction in ('up', 'down')
    span = height if vertical else width
    if direction in (None, 'left', 'up'):  # The new clip comes in from the right, or from below.
        edge = _even(span * (1 - a))
        old, new = (0, edge), (edge, span)
        old_move, new_move = -_even((span - edge) / 2), _even(edge / 2)
    else:  # From the left, or from above.
        edge = _even(span * a)
        old, new = (edge, span), (0, edge)
        old_move, new_move = _even(edge / 2), -_even((span - edge) / 2)

    def window(lo: int, hi: int, move: int) -> list[int]:
        return [0, lo, width, hi - lo, 0, move] if vertical else [lo, 0, hi - lo, height, move, 0]
    return {'a': window(*old, old_move), 'b': window(*new, new_move)}


def build(moves, a: str, b: str, transition) -> str:
    """The ffmpeg graph: the new clip moved onto a black frame, then the old one, cut to its window, over it."""
    w, h, frames, fps = moves.width, moves.height, moves.frames, moves.fps
    direction = getattr(transition, 'direction', None)
    vertical = direction in ('up', 'down')
    span, axis = (h, 'Y') if vertical else (w, 'X')

    def amount_of(q: str) -> str:
        s = lambda x: f'(({x})*({x})*(3-2*({x})))'
        return f'if(lt({q},{OPEN}),0.5*{s(f"{q}/{OPEN}")},if(lt({q},{HOLD}),0.5,0.5+0.5*{s(f"min(1,({q}-{HOLD})/{1 - HOLD})")}))'

    even = lambda x: f'(2*floor(({x})/2+0.5))'
    # Positions use the overlay's time, the window the old clip's frame number.
    qt, qn = f'(t*{fps}/{frames})', f'(N/{frames})'
    if direction in (None, 'left', 'up'):
        edge = lambda q: even(f'{span}*(1-{amount_of(q)})')
        old_move = lambda q: f'(-{even(f"({span}-{edge(q)})/2")})'
        new_move = lambda q: even(f'{edge(q)}/2')
        inside = f'lt({axis}+{old_move(qn)},{edge(qn)})'
    else:
        edge = lambda q: even(f'{span}*{amount_of(q)}')
        old_move = lambda q: even(f'{edge(q)}/2')
        new_move = lambda q: f'(-{even(f"({span}-{edge(q)})/2")})'
        inside = f'gte({axis}+{old_move(qn)},{edge(qn)})'
    black, early, moved, cut, out = (moves.label(name) for name in ('ssblack', 'ssearly', 'ssnew', 'ssold', 'ssout'))
    place = lambda move: (f"x=0:y='{move}'" if vertical else f"x='{move}':y=0")
    # Each overlay's main picture keeps its time; the picture laid over it runs 10 microseconds early.
    moves.lines += [
        f'color=black:s={w}x{h}:r={fps},format=rgba,trim=end_frame={frames},setpts=PTS-STARTPTS[{black}]',
        f'[{b}]settb=AVTB,setpts=PTS-10[{early}]',
        f"[{black}][{early}]overlay={place(new_move(qt))}:eval=frame:format=gbrp:eof_action=pass[{moved}]",
        f"[{a}]format=gbrap,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*{inside}',settb=AVTB,setpts=PTS-10[{cut}]",
        f"[{moved}][{cut}]overlay={place(old_move(qt))}:eval=frame:format=gbrp:eof_action=pass[{out}]",
    ]
    return out
