"""Transitions that move pixels (spin, doorway, puzzle, mosaic, ripple, cross zoom), built from ffmpeg's own filters.

xfade overlaps the end of the old clip (a) with the start of the new one (b) for n frames. Here the same n frames of
each are taken out of the joined stream, the transition's frames are built from them with fast native filters (scale,
pad, rotate, crop, overlay, displace, mix, a plain fade), and the three parts are joined again. A per-pixel xfade
expression would be exact but takes minutes per transition at 4K.

q is how far through the transition a frame is, 0 to 1 (frame k of n: k/n, as xfade's progress), and e = q²(3 − 2q).
Positions are frame pixels from the top left. The preview's TRANSITION_FRAGMENT (playback.ts) draws the same moves
with the same constants (MOVING in animation.ts).
"""
from __future__ import annotations

import math

MOVING_KINDS = ('spin-in', 'spin-out', 'doorway', 'puzzle-left', 'puzzle-right', 'mosaic', 'ripple', 'cross-zoom')
SPIN_TURNS = 1
DOOR_BACK = 0.75  # How small the new clip starts behind the doors.
PUZZLE_COLS, PUZZLE_ROWS, PUZZLE_STAGGER = 4, 3, 0.5
MOSAIC_COLS, MOSAIC_ROWS, MOSAIC_STAGGER, MOSAIC_STEP = 8, 5, 0.6, 7  # Tiles turn in the order (7i + 3) mod 40.
RIPPLE_AMP, RIPPLE_WAVES, RIPPLE_SPEED = 0.012, 12, 18  # Height share; waves across the half diagonal; phase over the transition.
RIPPLE_MAP_WIDTH = 320  # The ripple maps are drawn this wide, then scaled to the frame.
ZOOM_REACH, ZOOM_BLUR, ZOOM_TAPS = 1.8, 0.25, 5


class Moves:
    """Writes one moving transition into a filter graph: `lines` to append, reading [a] and [b] (n frames each, from 0 s)."""

    def __init__(self, name: str, width: int, height: int, fps: int, frames: int):
        self.name, self.width, self.height, self.fps, self.frames = name, width, height, fps, frames
        self.lines: list[str] = []
        self.count = 0
        seconds = frames / fps
        self.q = f'(t/{seconds:.6f})'  # Frame k of n is at t = k/fps, so q = k/n.
        self.e = f'({self.q}*{self.q}*(3-2*{self.q}))'

    def label(self, what: str) -> str:
        self.count += 1
        return f'{self.name}_{what}{self.count}'

    def canvas(self) -> str:
        out = self.label('canvas')
        self.lines.append(f'color=c=black@0:s={self.width}x{self.height}:r={self.fps},format=rgba,trim=end_frame={self.frames},setpts=PTS-STARTPTS[{out}]')
        return out

    def copies(self, source: str, count: int) -> list[str]:
        outs = [self.label('copy') for _ in range(count)]
        self.lines.append(f"[{source}]split={count}{''.join(f'[{out}]' for out in outs)}")
        return outs

    def over(self, under: str, top: str, x: str, y: str, enable: str | None = None) -> str:
        out = self.label('over')
        # Packed RGB keeps what is clear clear, so a moving piece shows the frame under it where it isn't.
        self.lines.append(f"[{under}][{top}]overlay=x='{x}':y='{y}':eval=frame:format=rgb{f':enable={chr(39)}{enable}{chr(39)}' if enable else ''}[{out}]")
        return out

    def sized(self, source: str, factor: str, wide: str | None = None) -> str:
        """`source` scaled by `factor` (each frame), never under 2 pixels; `wide` scales the width alone instead."""
        out = self.label('sized')
        w = f"max(2,trunc({self.width}*{wide or factor}/2)*2)"
        h = f"max(2,trunc({self.height}*{factor}/2)*2)" if not wide else str(self.height)
        self.lines.append(f"[{source}]scale=w='{w}':h='{h}':eval=frame:flags=bilinear[{out}]")
        return out

    def centred(self, source: str) -> str:
        """`source` (any size) laid in the middle of a clear frame."""
        return self.over(self.canvas(), source, '(main_w-overlay_w)/2', '(main_h-overlay_h)/2')

    # The transitions. Each returns the label of its n frames.
    def spin(self, inward: bool, a: str, b: str) -> str:
        moving, still = (b, a) if inward else (a, b)
        size = f'max({self.e},0.001)' if inward else f'max(1-{self.e},0.001)'
        turn = f'(1-{self.e})*{2 * math.pi * SPIN_TURNS:.9f}' if inward else f'{self.e}*{2 * math.pi * SPIN_TURNS:.9f}'
        spun = self.label('spun')
        # Turned anticlockwise by θ (rotate turns clockwise for a positive angle), within a fixed frame.
        self.lines.append(f"[{self.centred(self.sized(moving, size))}]rotate=a='-{turn}':ow={self.width}:oh={self.height}:c=black@0:bilinear=1[{spun}]")
        return self.over(still, spun, '0', '0')

    def doorway(self, a: str, b: str) -> str:
        half = self.width // 2
        left, right = self.label('left'), self.label('right')
        door_l, door_r = self.copies(a, 2)
        self.lines += [f'[{door_l}]crop=w={half}:h={self.height}:x=0:y=0[{left}]', f'[{door_r}]crop=w={self.width - half}:h={self.height}:x={half}:y=0[{right}]']
        behind = self.centred(self.sized(b, f'({DOOR_BACK}+{1 - DOOR_BACK}*{self.e})'))
        opened = self.over(behind, left, f'-{self.e}*{self.width / 2}', '0')
        return self.over(opened, right, f'{half}+{self.e}*{self.width / 2}', '0')

    def puzzle(self, from_right: bool, a: str, b: str) -> str:
        cols, rows, stagger = PUZZLE_COLS, PUZZLE_ROWS, PUZZLE_STAGGER
        pieces = [(c, r) for r in range(rows) for c in range(cols)]
        # Pieces nearest the side they come from arrive first; a later piece passes over those in place, so it is laid last.
        order = lambda c, r: ((cols - 1 - c) if from_right else c) + r  # noqa: E731
        pieces.sort(key=lambda piece: order(*piece))
        copies = self.copies(b, len(pieces))
        out = a
        for (c, r), copy in zip(pieces, copies):
            x0, x1 = round(c * self.width / cols), round((c + 1) * self.width / cols)
            y0, y1 = round(r * self.height / rows), round((r + 1) * self.height / rows)
            piece = self.label('piece')
            self.lines.append(f'[{copy}]crop=w={x1 - x0}:h={y1 - y0}:x={x0}:y={y0}[{piece}]')
            progress = f'min(1,max(0,({self.q}-{stagger}*{order(c, r)}/{cols - 1 + rows - 1})/{1 - stagger}))'
            offset = f'pow(1-{progress},3)*{self.width}*{1 if from_right else -1}'
            out = self.over(out, piece, f'{x0}+{offset}', str(y0))
        return out

    def mosaic(self, a: str, b: str) -> str:
        """Each tile turns edge-on and back: the old picture narrows to its middle line, then the new one widens from it.
        Built tile by tile at tile size, then stacked into rows and rows into the frame, so nothing copies a whole frame."""
        cols, rows, stagger, step = MOSAIC_COLS, MOSAIC_ROWS, MOSAIC_STAGGER, MOSAIC_STEP
        tiles = cols * rows
        old, new = self.copies(a, tiles), self.copies(b, tiles)
        lines_of_tiles = []
        for r in range(rows):
            row = []
            y0, y1 = round(r * self.height / rows), round((r + 1) * self.height / rows)
            for c in range(cols):
                index = c + r * cols
                x0, x1 = round(c * self.width / cols), round((c + 1) * self.width / cols)
                wide, tall = x1 - x0, y1 - y0
                progress = f'min(1,max(0,({self.q}-{stagger}*{(index * step + 3) % tiles}/{tiles - 1})/{1 - stagger}))'
                out = self.label('clear')
                self.lines.append(f'color=c=black@0:s={wide}x{tall}:r={self.fps},format=rgba,trim=end_frame={self.frames},setpts=PTS-STARTPTS[{out}]')
                for source, narrow, when in ((old[index], f'(1-2*{progress})', f'lt({progress},0.5)'), (new[index], f'(2*{progress}-1)', f'gte({progress},0.5)')):
                    tile, turned = self.label('tile'), self.label('turned')
                    self.lines += [f'[{source}]crop=w={wide}:h={tall}:x={x0}:y={y0}[{tile}]',
                                   # One thread each: every scale filter otherwise starts its own pool, and 80 of them, with a
                                   # long video's other filters, can pass the system's 4096 threads for one program.
                                   f"[{tile}]scale=w='max(2,trunc({wide}*{narrow}/2)*2)':h={tall}:eval=frame:flags=bilinear:threads=1[{turned}]"]
                    out = self.over(out, turned, f'({wide}-overlay_w)/2', '0', when)
                row.append(out)
            stacked = self.label('row')
            self.lines.append(f"{''.join(f'[{tile}]' for tile in row)}hstack=inputs={cols}[{stacked}]")
            lines_of_tiles.append(stacked)
        frame = self.label('mosaic')
        self.lines.append(f"{''.join(f'[{row}]' for row in lines_of_tiles)}vstack=inputs={rows}[{frame}]")
        return frame

    def ripple(self, a: str, b: str) -> str:
        """Both clips read through rings travelling out from the middle (ffmpeg's displace), then a fade. The maps of how
        far each pixel reads from (128 is still) are drawn small in the graph by geq and scaled up: the rings are smooth,
        and an extra input file held the whole export back until it was read."""
        w, h = self.width, self.height
        mw = RIPPLE_MAP_WIDTH
        mh = max(2, round(mw * h / w / 2) * 2)
        reach = math.hypot(w / 2, h / 2)
        fx, fy = f'((X+0.5)*{w}/{mw}-0.5-{w / 2})', f'((Y+0.5)*{h}/{mh}-0.5-{h / 2})'  # Frame pixels from the middle.
        q = f'(T/{self.frames / self.fps:.6f})'
        shift = f'{RIPPLE_AMP}*{h}*sin(PI*{q})*sin({RIPPLE_WAVES}*2*PI*hypot({fx},{fy})/{reach:.6f}-{q}*{RIPPLE_SPEED})'
        maps = []
        for along in (fx, fy):
            made, plain, alpha, planar = self.label('map'), self.label('mapc'), self.label('mapa'), self.label('mapp')
            self.lines.append(f"color=c=gray:s={mw}x{mh}:r={self.fps},format=gray,trim=end_frame={self.frames},setpts=PTS-STARTPTS,"
                              f"geq=lum='128+{along}/max(hypot({fx},{fy}),1)*{shift}',scale={w}:{h}:flags=bilinear:threads=1[{made}]")
            # displace moves each plane by the same plane of the map, so every plane (alpha too) must hold the shift: a
            # grey map turned into RGBA by ffmpeg gives alpha 255, and the picture moved 127 pixels.
            self.lines += [f'[{made}]split=2[{plain}][{alpha}]', f'[{plain}]format=gbrp,format=gbrap[{planar}]']
            merged = self.label('mapm')
            self.lines.append(f'[{planar}][{alpha}]alphamerge[{merged}]')
            maps.append(self.copies(merged, 2))  # One for each clip.
        moved = []
        for which, source in enumerate((a, b)):
            flat, out = self.label('planar'), self.label('rippled')
            self.lines += [f'[{source}]format=gbrap[{flat}]', f'[{flat}][{maps[0][which]}][{maps[1][which]}]displace=edge=blank[{out}]']
            moved.append(out)
        return self.fade(*moved)

    def cross_zoom(self, a: str, b: str) -> str:
        """Into the old clip and out of the new, each the average of ZOOM_TAPS sizes along lines from the middle, then a fade.
        The slowest of these: at 4K each tap scales a whole frame past the frame's size (about 20 s more per transition)."""
        streaks = f'sin(PI*{self.q})'
        blurred = []
        for source, size in ((a, f'(1+{ZOOM_REACH - 1}*{self.e})'), (b, f'({ZOOM_REACH}-{ZOOM_REACH - 1}*{self.e})')):
            taps = [self.centred(self.sized(copy, f'{size}*(1+{ZOOM_BLUR}*{streaks}*{t}/{ZOOM_TAPS - 1})')) for t, copy in enumerate(self.copies(source, ZOOM_TAPS))]
            out = self.label('mixed')
            self.lines.append(f"{''.join(f'[{tap}]' for tap in taps)}mix=inputs={ZOOM_TAPS}:weights={' '.join(['1'] * ZOOM_TAPS)}[{out}]")
            blurred.append(out)
        return self.fade(*blurred)

    def fade(self, a: str, b: str) -> str:
        out = self.label('faded')
        self.lines.append(f'[{a}][{b}]xfade=transition=fade:duration={self.frames / self.fps:.6f}:offset=0,trim=end_frame={self.frames}[{out}]')
        return out

    def build(self, kind: str, a: str, b: str) -> str:
        return {'spin-in': lambda: self.spin(True, a, b), 'spin-out': lambda: self.spin(False, a, b), 'doorway': lambda: self.doorway(a, b),
                'puzzle-left': lambda: self.puzzle(True, a, b), 'puzzle-right': lambda: self.puzzle(False, a, b), 'mosaic': lambda: self.mosaic(a, b),
                'ripple': lambda: self.ripple(a, b), 'cross-zoom': lambda: self.cross_zoom(a, b)}[kind]()
