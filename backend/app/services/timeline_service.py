"""Compiles a timeline into one ffmpeg graph, and upgrades older project recipes."""
from __future__ import annotations

import functools
import logging
import json
import math
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np
from PIL import Image

from app.api.schemas import VideoEditRequest
from app.services.finish_service import finish_filters
from app.services.ramp import ramp_time_expression, segments as ramp_segments
from app.services.animation import chroma_yuv, LOOKS, OPACITY_SPAN, WHIP_BLUR, XFADE_NAMES, look_at, offset_expression, scale_expression
from app.services.job_service import JobCancelled, stop_process_when
from app.services.media_probe import MediaFacts
from app.services.timeline_schema import value_at, Adjust, Animation, ShapeMask, BlurBox, BlurLayer, Caption, CaptionLayer, Chroma, Clip, Format, Sound, Text, Timeline, Transform, VideoLayer
from app.services.video_edit_service import (
    BT709_OUTPUT_ARGS, DEFAULT_LYRIC_FONT, HDR_TO_BT709, LYRIC_FONTS_DIR, ass_timestamp, lyric_font_for, SD_COLOR_SPACES, STALLED_AFTER_SECONDS, TAG_BT709, TO_BT709, run_cancellable, write_lyrics,
)

logger = logging.getLogger(__name__)
AUDIO_FORMAT = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'
# Watermark layers, mirrored with frontend/src/timeline/brand.ts. They draw after the cinematic finish, before captions.
BRAND_LAYER_IDS = ('brand', 'brand-clips')


@functools.lru_cache(maxsize=1)
def _hardware_h264(ffmpeg: str) -> bool:
    """True when this ffmpeg has a hardware H.264 encoder (Apple Silicon VideoToolbox, Quick Sync, NVENC)."""
    try:
        out = subprocess.run([ffmpeg, '-hide_banner', '-encoders'], capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return any(name in out for name in ('h264_videotoolbox', 'h264_qsv', 'h264_nvenc'))
# Matched by editor/audio.ts. A gentle ratio dips music by about 8 to 14 dB under normal speech.
DUCK_THRESHOLD = 0.02
DUCK_RATIO = 2
DUCK_FILTER = f'sidechaincompress=threshold={DUCK_THRESHOLD}:ratio={DUCK_RATIO}:attack=20:release=400:level_sc=1'
LUMA_RED, LUMA_GREEN, LUMA_BLUE = 0.2126, 0.7152, 0.0722
MAX_SUPERSAMPLE = 4
MIN_WORK_SCALE = 0.1
LOUDNORM = 'loudnorm=I=-14:TP=-1:LRA=11'  # -14 LUFS is what the main social platforms aim for.
MAX_ATEMPO_STEP = 2.0
# A source's prepared copy: (media id, steadied, reversed, background blurred) to the copy's facts.
Prepared = Callable[[int, bool, bool, Any], MediaFacts]  # The last: None, or (who stays sharp, blur amount, focus pull) for a blurred background.
RAMP_MARGIN = 2.0  # Seconds.
BLUR_REACH = 0.04  # A blur box's strength at 1, as a share of the frame height. Matches timeline/blur.ts.
BLUR_FEATHER = 0.12
BLOCK_REACH = 0.06
MIN_ATEMPO_STEP = 0.5


@dataclass
class Compiled:
    args: list[str]
    graph: str
    duration: float
    audio_args: list[str]
    audio_graph: str
    normalize_audio: bool = False

    @property
    def has_audio(self) -> bool:
        return bool(self.audio_graph)


def ease_expression(name: str, p: str) -> str:
    return {'linear': p, 'easeOut': f'(1-pow(1-{p},3))',
            'easeInOut': f'if(lt({p},0.5),4*pow({p},3),1-pow(-2*{p}+2,3)/2)'}[name]


def property_expression(transform: Transform, prop: str, clock: str = 't') -> str:
    """The curve from timeline_schema.value_at as an ffmpeg expression of `clock`."""
    keys = transform.keyframes.get(prop)
    if not keys:
        return f'{getattr(transform, prop)}'
    tail = f'{keys[-1].v}'
    for a, b in reversed(list(zip(keys, keys[1:]))):
        p = f'(({clock}-{a.t})/{b.t - a.t})'
        tail = f'if(lt({clock},{b.t}),{a.v}+({b.v - a.v})*{ease_expression(a.ease, p)},{tail})'
    return f'if(lte({clock},{keys[0].t}),{keys[0].v},{tail})'


def adjust_filters(adjust: Adjust) -> list[str]:
    filters = []
    if adjust.rotation == 90:
        filters.append('transpose=clock')
    elif adjust.rotation == 180:
        filters += ['hflip', 'vflip']
    elif adjust.rotation == 270:
        filters.append('transpose=cclock')
    if adjust.flip_horizontal:
        filters.append('hflip')
    if adjust.flip_vertical:
        filters.append('vflip')
    return filters


def chroma_filters(chroma: Chroma, image: bool) -> list[str]:
    """Keyed in BT.709 YUV, the same space the preview shader measures distance in."""
    y, u, v = chroma_yuv(chroma.color)
    red, green, blue = (int(chroma.color[index:index + 2], 16) for index in (1, 3, 5))
    steps = ['scale=out_color_matrix=bt709:out_range=tv'] if image else []
    steps += ['format=yuva444p', f'chromakey=color=0x{y:02x}{u:02x}{v:02x}:similarity={chroma.similarity}:blend={chroma.softness}:yuv=1', 'format=gbrap']
    if chroma.spill:
        kind = 'blue' if blue > green else 'green'
        steps.append(f'despill=type={kind}:mix=0.5:expand=0:red=0:green={-chroma.spill if kind == "green" else 0}:blue={-chroma.spill if kind == "blue" else 0}:brightness=0:alpha=0')
    return steps


def blur_grid(amount: float, width: int, height: int) -> tuple[int, int]:
    """Columns and rows of blocks when pixelating. Shares of the frame, so every export size gets the same blocks."""
    rows = max(2, round(1 / (max(0.05, amount) * BLOCK_REACH)))
    return max(2, round(rows * width / height)), rows


def blur_filters(item: BlurBox, fmt: Format) -> str:
    """The whole frame blurred or in blocks. The mask then keeps only the box. Matches hidden() in the preview shader."""
    if item.style == 'pixelate':
        columns, rows = blur_grid(item.amount, fmt.width, fmt.height)
        return f'scale={columns}:{rows}:flags=area,scale={fmt.width}:{fmt.height}:flags=neighbor'
    return f'gblur=sigma={item.amount * BLUR_REACH * fmt.height:.3f}:steps=3'


SHAPE_SUPERSAMPLE = 4  # Drawn larger, then shrunk, so a hard edge is smooth even with no feather.


def write_shape_mask(mask: ShapeMask, width: int, height: int, target: Path) -> None:
    """White inside the shape, clear outside, with a soft edge. The preview uses this same picture."""
    from PIL import ImageDraw, ImageFilter
    big = Image.new('L', (width * SHAPE_SUPERSAMPLE, height * SHAPE_SUPERSAMPLE), 0)
    ImageDraw.Draw(big).polygon([(x * width * SHAPE_SUPERSAMPLE, y * height * SHAPE_SUPERSAMPLE) for x, y in mask.points], fill=255)
    alpha = big.resize((width, height), Image.LANCZOS)
    if mask.feather:
        alpha = alpha.filter(ImageFilter.GaussianBlur(mask.feather * height))
    picture = Image.new('RGBA', (width, height), (255, 255, 255, 0))
    picture.putalpha(alpha)
    picture.save(target)


def write_blur_mask(item: BlurBox, fmt: Format, target: Path) -> None:
    """A full frame, clear except a soft oval or box in the middle, sized for a scale of 1."""
    W, H = fmt.width, fmt.height
    box_w, box_h = item.width * W, item.height * H
    columns = (np.arange(W) + 0.5 - (W - box_w) / 2) / box_w * 2 - 1
    rows = (np.arange(H) + 0.5 - (H - box_h) / 2) / box_h * 2 - 1
    x, y = np.meshgrid(columns, rows)
    distance = np.hypot(x, y) if item.shape == 'oval' else np.maximum(np.abs(x), np.abs(y))
    alpha = np.clip((1 - distance) / BLUR_FEATHER, 0, 1)
    picture = np.full((H, W, 4), 255, np.uint8)
    picture[..., 3] = np.round(alpha * 255).astype(np.uint8)
    Image.fromarray(picture, 'RGBA').save(target)


def picture_filters(adjust: Adjust, look: str) -> list[str]:
    """The preview shader's steps in its order, on RGB values, so the two can't disagree."""
    red, green, blue, contrast, saturation = LOOKS[look]
    contrast *= adjust.contrast
    saturation *= adjust.saturation
    b = adjust.brightness
    warm = adjust.temperature
    filters = []
    if (red, green, blue, b, warm, adjust.tint) != (1, 1, 1, 1, 1, 1):
        # The same tint vector the shader builds: warmth splits between red and blue, tint moves green.
        filters.append(f'colorchannelmixer=rr={red * b * warm:.5f}:gg={green * b * adjust.tint:.5f}:bb={blue * b * (2 - warm):.5f}')
    if adjust.gamma != 1:
        inv = 1 / adjust.gamma
        power = f"pow(val/255,{inv:.5f})*255"
        filters.append(f"lutrgb=r='{power}':g='{power}':b='{power}'")
    if adjust.fade > 0:
        fade = f"val*(1-{adjust.fade:.5f})+255*{adjust.fade:.5f}"
        filters.append(f"lutrgb=r='{fade}':g='{fade}':b='{fade}'")
    if contrast != 1:
        curve = f'clip((val-127.5)*{contrast:.5f}+127.5,0,255)'
        filters.append(f"lutrgb=r='{curve}':g='{curve}':b='{curve}'")
    if saturation != 1:
        keep = 1 - saturation
        r, g, l = LUMA_RED * keep, LUMA_GREEN * keep, LUMA_BLUE * keep
        filters.append(f'colorchannelmixer=rr={r + saturation:.5f}:rg={g:.5f}:rb={l:.5f}:gr={r:.5f}:gg={g + saturation:.5f}:gb={l:.5f}:br={r:.5f}:bg={g:.5f}:bb={l + saturation:.5f}')
    return ['format=rgba', *filters] if filters else []


def old_film_filters(effect, canvas: tuple[int, int]) -> list[str]:
    """Animated distressed-stock filters. Keep this after fps/scale so frame texture has stable output pixels."""
    if effect is None or effect.intensity <= 0:
        return []
    W, H = canvas
    strength = effect.intensity
    grain = max(0.1, 26 * effect.grain * strength)
    filters = [
        # Gently faded warm stock, with temporal luma/chroma grain. c3 keeps source transparency intact.
        f'colorchannelmixer=rr={1 - .03 * strength:.5f}:rg={.035 * strength:.5f}:gg={1 - .045 * strength:.5f}:gb={.02 * strength:.5f}:bb={1 - .13 * strength:.5f}',
        f'noise=c0s={grain:.3f}:c1s={grain:.3f}:c2s={grain:.3f}:c3s=0:allf=t+u',
    ]
    if effect.scratches > 0:
        alpha = .10 + .35 * effect.scratches * strength
        for offset, speed in ((.17, 83), (.53, 47), (.81, 109)):
            filters.append(f"drawbox=x='mod(t*{speed}+iw*{offset},iw)':y=0:w=1:h=ih:color=white@{alpha:.3f}:t=fill")
    if effect.dust > 0:
        alpha = .18 + .42 * effect.dust * strength
        for ox, oy, speed in ((.23, .31, 61), (.67, .72, 89), (.42, .13, 127)):
            filters.append(f"drawbox=x='mod(t*{speed}+iw*{ox},iw)':y='mod(t*{speed * .37:.3f}+ih*{oy},ih)':w=3:h=3:color=black@{alpha:.3f}:t=fill")
    if effect.weave > 0:
        edge_x = max(2, round(W * .008 * effect.weave * strength))
        edge_y = max(2, round(H * .004 * effect.weave * strength))
        filters.extend([
            f"crop={W - edge_x * 2}:{H - edge_y * 2}:x='{edge_x}+sin(t*19)*{edge_x}':y='{edge_y}+sin(t*13)*{edge_y}'",
            f'scale={W}:{H}:flags=bicubic',
        ])
    return filters


def signal_damage_filters(effect, canvas: tuple[int, int]) -> list[str]:
    """Digital glitch or analogue VHS damage, applied to the clip pixels rather than as an overlay."""
    if effect is None or effect.intensity <= 0:
        return []
    W, H = canvas
    amount = effect.intensity
    filters = []
    if effect.rgb_split > 0:
        shift = max(1, round(W * .012 * effect.rgb_split * amount))
        filters.append(f'rgbashift=rh={shift}:bh=-{shift}:edge=smear')
    if effect.jitter > 0:
        edge = max(2, round(W * .025 * effect.jitter * amount))
        rate = 29 if effect.mode == 'glitch' else 13
        filters.extend([f"crop={W - edge * 2}:{H}:x='{edge}+sin(t*{rate})*{edge}':y=0", f'scale={W}:{H}:flags=bicubic'])
    if effect.scanlines > 0:
        alpha = effect.scanlines * amount * (.20 if effect.mode == 'vhs' else .11)
        spacing = 3 if effect.mode == 'vhs' else 5
        filters.append(f'drawgrid=w=iw:h={spacing}:t=1:color=black@{alpha:.3f}')
    if effect.noise > 0:
        strength = 30 * effect.noise * amount * (1.25 if effect.mode == 'vhs' else .75)
        filters.append(f'noise=c0s={strength:.3f}:c1s={strength:.3f}:c2s={strength:.3f}:c3s=0:allf=t+u')
    if effect.mode == 'vhs':
        filters.extend(['gblur=sigma=0.35:steps=1', f'eq=saturation={max(.75, 1 - .18 * amount):.3f}'])
    return filters


def lens_surface_filters(effect, canvas: tuple[int, int]) -> list[str]:
    """Procedural soft lens spots; raindrops additionally refract pixels inside each drop."""
    if effect is None or effect.intensity <= 0:
        return []
    W, H = canvas
    cell = max(48, round(min(W, H) / (3.5 + effect.amount * 5)))
    radius = cell * (.13 + effect.amount * .07)
    dx = f'(mod(X+sin(floor(Y/{cell})*12.37)*{cell * .31:.3f},{cell})-{cell / 2:.3f})'
    dy = f'(mod(Y+sin(floor(X/{cell})*7.91)*{cell * .27:.3f},{cell})-{cell / 2:.3f})'
    distance = f'hypot({dx},{dy})'
    inside = f'lt({distance},{radius:.3f})'
    if effect.mode == 'dirt':
        shade = max(.55, 1 - effect.intensity * .34)
        factor = f'if({inside},{shade:.4f},1)'
        return [f"geq=r='r(X,Y)*{factor}':g='g(X,Y)*{factor}':b='b(X,Y)*{factor}':a='alpha(X,Y)'"]
    shift = 11 * effect.refraction * effect.intensity
    sx = f'X+{dx}/max({distance},1)*{shift:.3f}*{inside}'
    sy = f'Y+{dy}/max({distance},1)*{shift:.3f}*{inside}'
    edge = f'between({distance},{radius * (1 - .18 * (1 + effect.softness)):.3f},{radius:.3f})'
    lift = .16 * effect.intensity
    return [f"geq=r='clip(r({sx},{sy})+255*{lift:.4f}*{edge},0,255)':g='clip(g({sx},{sy})+255*{lift:.4f}*{edge},0,255)':b='clip(b({sx},{sy})+255*{lift * 1.2:.4f}*{edge},0,255)':a='alpha(X,Y)'"]


def colour_splash_filters(effect) -> list[str]:
    """Keep pixels near one chroma in colour and desaturate everything else."""
    if effect is None or effect.intensity <= 0:
        return []
    red, green, blue = (int(effect.color[at:at + 2], 16) / 255 for at in (1, 3, 5))
    target_luma = LUMA_RED * red + LUMA_GREEN * green + LUMA_BLUE * blue
    target_cb, target_cr = (blue - target_luma) / 1.8556, (red - target_luma) / 1.5748
    r, g, b = 'r(X,Y)', 'g(X,Y)', 'b(X,Y)'
    luma = f'({LUMA_RED}*{r}+{LUMA_GREEN}*{g}+{LUMA_BLUE}*{b})'
    cb, cr = f'(({b}-{luma})/1.8556/255)', f'(({r}-{luma})/1.5748/255)'
    distance = f'hypot({cb}-{target_cb:.6f},{cr}-{target_cr:.6f})'
    fade = f'({effect.intensity:.6f}*clip(({distance}-{effect.tolerance:.6f})/{effect.softness:.6f},0,1))'
    channel = lambda source: f'({source}*(1-{fade})+{luma}*{fade})'
    return [f"geq=r='{channel(r)}':g='{channel(g)}':b='{channel(b)}':a='alpha(X,Y)'"]


def dreamy_glow_filters(effect) -> list[str]:
    """Gently soften detail and lift warm highlights without washing out the whole shot."""
    if effect is None or effect.intensity <= 0:
        return []
    radius = 3 + round(effect.softness * 8)
    soften = -.25 - effect.intensity * .9
    lift = 1 + effect.intensity * .035
    red = effect.warmth * effect.intensity * .045
    blue = -effect.warmth * effect.intensity * .025
    return [f'unsharp=luma_msize_x={radius | 1}:luma_msize_y={radius | 1}:luma_amount={soften:.4f}',
            f'eq=brightness={lift - 1:.4f}:saturation={1 + effect.intensity * .04:.4f}',
            f'colorbalance=rs={red:.4f}:bs={blue:.4f}:pl=1']


def color_filter(facts: MediaFacts) -> str:
    if facts.media_type == 'image':
        return 'format=gbrap'  # Pictures are already RGB, and a logo's transparency must survive.
    if facts.color_space in SD_COLOR_SPACES:
        # scale leaves the old label on the frame, and later steps would convert it a second time.
        return f'{TO_BT709},{TAG_BT709}'
    return HDR_TO_BT709 if facts.is_hdr else TAG_BT709


def source_steps(facts: MediaFacts) -> list[str]:
    """Standard colour and square pixels. A person mask is applied right after these, at the source's own size."""
    return [color_filter(facts), 'scale=trunc(iw*sar/2)*2:ih', 'setsar=1']


def clip_chain(clip: Clip, facts: MediaFacts, canvas: tuple[int, int], fps: int, frames: int, held_head: int = 0, timing: str | None = None, sourced: bool = False) -> str:
    """Bring any source to one size, rate and color, and exactly `frames` long. held_head repeats the first frame. `sourced` skips source_steps, already done."""
    W, H = canvas
    steps = [*([] if sourced else source_steps(facts)), *(chroma_filters(clip.chroma, facts.media_type == 'image') if clip.chroma else []), *adjust_filters(clip.adjust), *picture_filters(clip.adjust, clip.look)]
    if timing:
        steps.append(f"setpts='{timing}'")
    elif clip.speed != 1:
        steps.append(f'setpts=PTS/{clip.speed}')
    steps += [f'fps={fps}', f'scale={W}:{H}:force_original_aspect_ratio=decrease:flags=bicubic', 'format=gbrap',
              f'pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black@0', 'setsar=1', *old_film_filters(clip.old_film, canvas), *signal_damage_filters(clip.signal_damage, canvas), *lens_surface_filters(clip.lens_surface, canvas), *colour_splash_filters(clip.colour_splash), *dreamy_glow_filters(clip.dreamy_glow)]
    if held_head:
        steps.append(f'tpad=start={held_head}:start_mode=clone')
    # Short or variable sources are held on their last frame, so later layers never slip.
    steps += ['tpad=stop=-1:stop_mode=clone', f'trim=end_frame={frames}', 'setpts=PTS-STARTPTS', 'settb=AVTB']
    return ','.join(steps)


def shared_fit(enter: Animation | None, exit_: Animation | None, length: float) -> tuple[float, float]:
    """Overlong animations share the item's length, like fades."""
    first, last = enter.duration if enter else 0, exit_.duration if exit_ else 0
    excess = max(1, (first + last) / length)
    return first / excess, last / excess


def supersample(transform: Transform, enter: Animation | None, exit_: Animation | None, facts: MediaFacts | None, fmt: Format) -> float:
    """Work at the largest size the item reaches, within its source: sharp when zoomed in, cheap when small."""
    if facts is None or not facts.width or not facts.height:
        return 1
    keys = transform.keyframes.get('scale', [])
    largest = max([transform.scale, *(key.v for key in keys)])
    if any(item and item.preset == 'pop' for item in (enter, exit_)):
        largest *= 1.11  # The overshoot.
    if largest < 1:
        return max(largest, MIN_WORK_SCALE)  # A small overlay needs no full-size frames to turn and scale.
    detail = max(facts.width, facts.height) / min(fmt.width, fmt.height)
    return max(1, min(largest, detail, MAX_SUPERSAMPLE))


def atempo_chain(speed: float) -> list[str]:
    steps = []
    while speed > MAX_ATEMPO_STEP:
        steps.append(f'atempo={MAX_ATEMPO_STEP}')
        speed /= MAX_ATEMPO_STEP
    while speed < MIN_ATEMPO_STEP:
        steps.append(f'atempo={MIN_ATEMPO_STEP}')
        speed /= MIN_ATEMPO_STEP
    return [*steps, f'atempo={speed}'] if speed != 1 else steps


def sound_steps(item: Clip | Sound, layer_volume: float = 1) -> list[str]:
    """Fades are in timeline seconds, so they follow the speed change. Overlong fades share the item's length."""
    length = item.length
    excess = max(1, (item.fade_in + item.fade_out) / length)
    fade_in, fade_out = item.fade_in / excess, item.fade_out / excess
    steps = [AUDIO_FORMAT, *atempo_chain(item.speed), f'volume={item.volume * layer_volume:.4f}']
    if fade_in:
        steps.append(f'afade=t=in:st=0:d={fade_in}')
    if fade_out:
        steps.append(f'afade=t=out:st={length - fade_out}:d={fade_out}')
    return [*steps, f'adelay={round(item.start * 1000)}:all=1']


TAMIL_FONT = 'Noto Sans Tamil'
SUBTITLE_SHARE = 0.55  # A subtitle's size when none is set, as a share of the title's.


def ass_colour(hex_colour: str, alpha: int = 0) -> str:
    red, green, blue = (hex_colour.lstrip('#')[index:index + 2] for index in (0, 2, 4))
    return f'&H{alpha:02X}{blue}{green}{red}'


def ass_text(text: str) -> str:
    """Typed text stays text, never an ASS override."""
    return text.replace('\\', '＼').replace('{', '｛').replace('}', '｝').replace('\r', '').replace('\n', r'\N')


def script_runs(text: str) -> list[str]:
    """The text cut where it changes between Tamil and anything else, so each part gets its own font. Spaces stay with the part before."""
    runs: list[str] = []
    kind = None
    for char in text:
        tamil = 0x0B80 <= ord(char) <= 0x0BFF
        if char.isspace() or (runs and tamil == kind):
            if runs:
                runs[-1] += char
            else:
                runs.append(char)
            continue
        runs.append(char)
        kind = tamil
    return runs or [text]


def write_title(path: Path, item: Text, fmt: Format) -> None:
    """A template title: title and subtitle in one block, each line in its script's font, aligned and boxed as chosen.
    Uses write_lyrics' sizes and borders, so a template's title line matches a plain title of the same size."""
    width, height = fmt.width, fmt.height
    unit = width / 720
    title_size = max(20, item.size) * unit
    sub_size = (item.subtitle_size or round(max(20, item.size) * SUBTITLE_SHARE)) * unit
    border_style, outline, shadow, outline_colour, back_colour = {
        'outline': (1, 2 * unit, 1 * unit, '&H00101010', '&H80000000'),
        'shadow': (1, 3 * unit, 2 * unit, '&H00000000', '&H40000000'),
        'band': (3, 12 * unit, 0, '&H70000000', '&H70000000'),
    }[item.style]
    if item.style == 'band' and item.band_color:
        outline_colour = back_colour = ass_colour(item.band_color, 0x20)
    blur = rf'\blur{3 * unit}' if item.style == 'shadow' else ''
    row = {'top': 7, 'center': 4, 'bottom': 1}[item.position]
    alignment = row + {'left': 0, 'center': 1, 'right': 2}[item.align]
    margin, side = round(height * 0.08), round(width * 0.055)

    def font_for(run: str) -> tuple[str, float]:
        # The chosen fonts replace the bundled one for their script; other scripts keep theirs.
        family, scale = lyric_font_for(run)
        if family == TAMIL_FONT:
            return item.tamil_font or family, scale
        if family == DEFAULT_LYRIC_FONT[0] and item.font:
            return item.font, scale
        return family, scale

    def line(text: str, size: float, colour: str, spacing: int = 0) -> str:
        # Every line sets its own spacing and colour: override tags carry on past a line break.
        head = rf'{{\1c{ass_colour(colour)}\fsp{spacing * unit}{blur}}}'
        pieces = []
        for run in script_runs(text):
            family, scale = font_for(run)
            pieces.append(rf'{{\fn{family}\fs{size * scale}}}{ass_text(run)}')
        return head + ''.join(pieces)

    lines = [line(item.text, title_size, item.color)]
    if item.subtitle:
        sub = line(item.subtitle, sub_size, item.subtitle_color or item.color, item.subtitle_spacing)
        lines = [sub, *lines] if item.subtitle_above else [*lines, sub]
    family = DEFAULT_LYRIC_FONT[0]
    path.write_text(f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,{family},{title_size},{ass_colour(item.color)},{ass_colour(item.color)},{outline_colour},{back_colour},-1,0,0,0,100,100,0,0,{border_style},{outline},{shadow},{alignment},{side},{side},{margin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,{ass_timestamp(0)},{ass_timestamp(1)},Title,,0,0,0,,{r'\N'.join(lines)}
""", encoding='utf-8')


def caption_states(item: Caption, highlight: bool) -> list[tuple[float, float, int | None]]:
    """Each moment a caption looks different: (start, end, lit word), in its own seconds. Matches captionStates in model.ts."""
    if not highlight:
        return [(0.0, item.length, None)]
    times = [0.0, *(word.s for word in item.words[1:]), item.length]
    return [(times[number], times[number + 1], number) for number in range(len(item.words)) if times[number + 1] > times[number]]


def caption_edit(layer: CaptionLayer, cues: list[dict]) -> VideoEditRequest:
    return VideoEditRequest(canvas='original', lyric_style=layer.style, lyric_size=layer.size, lyric_position=layer.position, lyric_color=layer.color, lyrics=cues)


def render_text_image(item: Text, fmt: Format, target: Path, layer: CaptionLayer | None = None, lit: int | None = None) -> None:
    """Text goes through libass once, so preview and export share the same letters. With `layer`, `item` is a caption in that layer's look."""
    if layer is not None:
        edit, marks = caption_edit(layer, [{'start': 0, 'end': 1, 'text': item.text}]), [lit]
    else:
        edit, marks = VideoEditRequest(canvas='original', lyric_style=item.style, lyric_size=max(20, item.size), lyric_position=item.position,
                                       lyric_color=item.color, lyrics=[{'start': 0, 'end': 1, 'text': item.text}]), None
    with tempfile.TemporaryDirectory() as folder:
        folder = Path(folder)
        if layer is None and item.designed:
            write_title(folder / 'lyrics.ass', item, fmt)
        else:
            write_lyrics(folder / 'lyrics.ass', edit, Path('/dev/null'), size=(fmt.width, fmt.height), marks=marks, mark_color=layer.highlight if layer else None)
        (folder / 'fonts').symlink_to(LYRIC_FONTS_DIR)
        result = subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'color=c=black@0:s={fmt.width}x{fmt.height}:r=30:d=0.5,format=rgba',
                                 '-vf', 'ass=filename=lyrics.ass:shaping=complex:fontsdir=fonts:alpha=1', '-frames:v', '1', '-update', '1', str(target)],
                                cwd=folder, capture_output=True, text=True)
    if result.returncode:
        logger.error('Text render failed: %s', result.stderr[-800:])
        raise RuntimeError('Could not render the text on this timeline.')


class Builder:
    def __init__(self, timeline: Timeline, media: Callable[[int], MediaFacts], audio_asset: Callable[[str], Path], folder: Path, prepared: Prepared | None = None, masks: Callable[[MediaFacts, Any], Path] | None = None, voices: Callable[[Path], Path] | None = None):
        timeline = playing_timeline(timeline)
        self.timeline, self.media, self.audio_asset, self.folder, self.prepared, self.masks, self.voices = timeline, media, audio_asset, folder, prepared, masks, voices
        self.fmt = timeline.format
        self.args: list[str] = []
        self.graph: list[str] = []
        self.audio: list[str] = []
        self.ducked: list[str] = []
        self.audio_args: list[str] = []
        self.audio_graph: list[str] = []
        self.audio_inputs = 0
        self.inputs = 0
        self.duration = timeline.duration
        self.total_frames = max(1, round(self.duration * self.fmt.fps))

    def add_input(self, *args: str) -> int:
        self.args += args
        self.inputs += 1
        return self.inputs - 1

    def add_audio_track(self, path: Path, source_start: float, seconds: float, steps: list[str], duck: bool = False) -> None:
        self.audio_args += ['-ss', f'{source_start:.6f}', '-t', f'{seconds:.6f}', '-i', str(path)]
        label = f'a{self.audio_inputs}'
        self.audio_graph.append(f"[{self.audio_inputs}:a]{','.join(steps)}[{label}]")
        (self.ducked if duck else self.audio).append(label)
        self.audio_inputs += 1

    def frames(self, seconds: float) -> int:
        return max(1, round(seconds * self.fmt.fps))

    def transparent_gap(self, label: str, frames: int) -> None:
        self.graph.append(f'color=c=black@0:s={self.fmt.width}x{self.fmt.height}:r={self.fmt.fps}:d={frames / self.fmt.fps:.6f},format=gbrap,settb=AVTB,trim=end_frame={frames},setsar=1[{label}]')

    def clip_input(self, clip: Clip, facts: MediaFacts, source_start: float, seconds: float) -> int:
        if facts.media_type == 'image':
            return self.add_input('-loop', '1', '-framerate', str(self.fmt.fps), '-t', f'{seconds:.6f}', '-i', str(facts.path))
        return self.add_input('-ss', f'{source_start:.6f}', '-t', f'{seconds:.6f}', '-i', str(facts.path))

    def add_clip_audio(self, clip: Clip, facts: MediaFacts, layer_muted: bool) -> None:
        # A frozen or reversed clip is silent, in the preview too.
        if clip.muted or layer_muted or not facts.has_audio or clip.volume == 0 or clip.freeze is not None or clip.reverse or clip.ramp:
            return
        self.add_audio_track(self.voice(facts.path) if clip.clean_voice else facts.path, clip.in_, clip.out - clip.in_, sound_steps(clip))

    def voice(self, path: Path) -> Path:
        """The cleaned copy of a sound, which lines up with the original sample for sample."""
        if self.voices is None:
            raise ValueError('A clip with Clean voice needs its cleaned copy.')
        return self.voices(path)

    def transition_frames(self, clips: list[Clip]) -> list[int]:
        """For each clip, the frames either side of its opening cut. Matches transitionHalf in model.ts."""
        fps = self.fmt.fps
        halves = [0] * len(clips)
        for number, (before, clip) in enumerate(zip(clips, clips[1:]), start=1):
            if clip.transition_in and round(before.start * fps) + self.frames(before.length) == round(clip.start * fps):
                halves[number] = min(round(clip.transition_in.duration * fps / 2), self.frames(before.length) // 2, self.frames(clip.length) // 2)
        return halves

    def pose(self, label: str, transform: Transform, enter: Animation | None, exit_: Animation | None, length: float, frames: int, canvas_scale: float, lead: float, name: str, beat_pulse=None) -> str:
        """Place one item on a transparent full frame. `lead` is how many seconds of the stream come before the item's own start."""
        if transform.is_default and not enter and not exit_ and canvas_scale == 1 and not beat_pulse:
            return label
        W, H = self.fmt.width, self.fmt.height
        first, last = shared_fit(enter, exit_, length)
        clock = f'(t-{lead:.6f})' if lead else 't'
        filters: list[str] = []
        if 'opacity' in transform.keyframes:
            filters.append(self.opacity_commands(transform, frames, lead, name))
        elif transform.opacity != 1:
            filters.append(f'colorchannelmixer=aa={transform.opacity}')
        moves = []
        if enter:
            moves.append((enter.preset, f'min(1,max(0,{clock}/{first:.6f}))'))
            if span := OPACITY_SPAN.get(enter.preset):
                filters.append(f'fade=t=in:st={lead:.6f}:d={first * span:.6f}:alpha=1')
        if exit_:
            moves.append((exit_.preset, f'min(1,max(0,({length:.6f}-{clock})/{last:.6f}))'))
            if span := OPACITY_SPAN.get(exit_.preset):
                filters.append(f'fade=t=out:st={lead + length - last * span:.6f}:d={last * span:.6f}:alpha=1')
        if blur := self.blur_commands(enter, exit_, first, last, length, frames, lead, name):
            filters.append(blur)
        x, y, scale = property_expression(transform, 'x', clock), property_expression(transform, 'y', clock), property_expression(transform, 'scale', clock)
        if beat_pulse:
            interval = 60 / beat_pulse.bpm
            # A fast ease-out zoom at each beat. The phase is stored in clip-local seconds.
            phase = f'mod(max(0,{clock}-{beat_pulse.offset:.6f}),{interval:.6f})'
            pulse = f'if(gte({clock},{beat_pulse.offset:.6f}),max(0,1-{phase}/0.180000),0)'
            scale = f'({scale})*(1+{beat_pulse.size * beat_pulse.strength:.6f}*{pulse})'
        sized, back, posed = f'{name}_sized', f'{name}_back', f'{name}_posed'
        spread = 1.0
        if transform.rotation or 'rotation' in transform.keyframes:
            # Turned first, while the size is fixed. The square output holds every angle, and the scale below allows for it.
            canvas_w, canvas_h = round(W * canvas_scale), round(H * canvas_scale)
            side = math.ceil(math.hypot(canvas_w, canvas_h) / 2) * 2
            spread = side / canvas_w
            filters.append(f"rotate=a='({property_expression(transform, 'rotation', clock)})*PI/180':c=black@0:ow={side}:oh={side}:bilinear=1")
        wide, tall = (W * spread, W * spread) if spread != 1 else (W, H)
        self.graph.append(f"[{label}]{''.join(step + ',' for step in filters)}scale=w='max(2,{wide}*({scale}))':h='max(2,{tall}*({scale}))':eval=frame:flags=bicubic[{sized}]")
        self.transparent_gap(back, frames)
        self.graph.append(f"[{back}][{sized}]overlay=x='{W}*({x})-overlay_w/2':y='{H}*({y})-overlay_h/2':eval=frame:format=gbrp[{posed}]")
        # The item is now cropped to the frame. Moves carry that whole frame, so a zoomed-in clip still slides in from outside.
        shift_x = [extra for preset, p in moves if (extra := offset_expression(preset, 'dx', p))]
        shift_y = [extra for preset, p in moves if (extra := offset_expression(preset, 'dy', p))]
        zoom = [extra for preset, p in moves if (extra := scale_expression(preset, p))]
        if not (shift_x or shift_y or zoom):
            return posed
        size = '*'.join(zoom) or '1'
        moved_sized, moved_back, moved = f'{name}_msized', f'{name}_mback', f'{name}_moved'
        self.graph.append(f"[{posed}]scale=w='max(2,{W}*({size}))':h='max(2,{H}*({size}))':eval=frame:flags=bicubic[{moved_sized}]")
        self.transparent_gap(moved_back, frames)
        self.graph.append(f"[{moved_back}][{moved_sized}]overlay=x='{W}*(0.5+{'+'.join(shift_x) or '0'})-overlay_w/2':y='{H}*(0.5+{'+'.join(shift_y) or '0'})-overlay_h/2':eval=frame:format=gbrp[{moved}]")
        return moved

    def opacity_commands(self, transform: Transform, frames: int, lead: float, name: str) -> str:
        """Eased opacity has no linear filter, so each frame gets its exact value."""
        fps = self.fmt.fps
        lines = [f'{frame / fps:.6f} colorchannelmixer@{name}o aa {value_at(transform, "opacity", max(0, frame / fps - lead)):.5f};' for frame in range(frames)]
        (self.folder / f'{name}-o.cmd').write_text('\n'.join(lines), encoding='utf-8')
        return f"sendcmd=f={name}-o.cmd,colorchannelmixer@{name}o=aa={value_at(transform, 'opacity', 0):.5f}"

    def blur_commands(self, enter: Animation | None, exit_: Animation | None, first: float, last: float, length: float, frames: int, lead: float, name: str) -> str | None:
        if not any(item and item.preset == 'blur' for item in (enter, exit_)):
            return None
        fps = self.fmt.fps
        lines = []
        for frame in range(frames):
            local = frame / fps - lead
            amount = 0.0
            if enter and enter.preset == 'blur':
                amount = max(amount, look_at('blur', local / first)['blur'])
            if exit_ and exit_.preset == 'blur':
                amount = max(amount, look_at('blur', (length - local) / last)['blur'])
            lines.append(f'{frame / fps:.6f} gblur@{name} sigma {amount * self.fmt.height:.3f};')
        (self.folder / f'{name}.cmd').write_text('\n'.join(lines), encoding='utf-8')
        return f'sendcmd=f={name}.cmd,gblur@{name}=sigma=0'

    def add_video_layer(self, layer: VideoLayer, position: int, base: str) -> str:
        clips = sorted((clip for clip in layer.items if clip.enabled), key=lambda clip: clip.start)
        if not clips:
            return base
        fps = self.fmt.fps
        halves = self.transition_frames(clips)
        segments: list[str] = []
        cursor = 0  # In frames, so rounding can't accumulate down a long timeline.
        joined_label, joined_frames = None, 0
        for number, clip in enumerate(clips):
            facts = sound_facts = self.media(clip.media_id)
            source_in = clip.in_
            frozen = clip.freeze is not None and facts.media_type == 'video'
            steady = clip.stabilise and facts.media_type == 'video'
            backwards = clip.reverse and facts.media_type == 'video' and not frozen
            portrait = (clip.cutout_pick, clip.blur_amount, clip.focus_pull) if clip.cutout == 'blur' and facts.media_type == 'video' else None
            cut = clip.cutout == 'remove' and facts.media_type == 'video'
            if steady or backwards or portrait:
                if self.prepared is None:
                    raise ValueError('A steadied, reversed or background-blurred clip needs its prepared copy.')
                if backwards:
                    # The reversed copy runs from the source's end, so in..out maps to the mirrored stretch.
                    source_in = max(0.0, (facts.duration or clip.out) - clip.out)
                facts = self.prepared(clip.media_id, steady, backwards, portrait)
            if cut and self.masks is None:
                raise ValueError('A clip with its background removed needs its person mask.')
            head, tail = halves[number], halves[number + 1] if number + 1 < len(clips) else 0
            if not head:
                if joined_label:
                    segments.append(f'[{joined_label}]')
                    joined_label = None
                start = round(clip.start * fps)
                if start > cursor:
                    label = f'gap{position}_{number}'
                    self.transparent_gap(label, start - cursor)
                    segments.append(f'[{label}]')
                    cursor = start
            base_frames = self.frames(clip.length)
            frames = base_frames + head + tail
            # The extra frames come from the source when it has them. Otherwise the first or last frame is held.
            # A ramp's first speed carries on into a transition's extra frames, as in the preview.
            lead_rate = clip.speed * (ramp_segments(clip.ramp)[0].r0 if clip.ramp else 1)
            wanted = source_in - head * lead_rate / fps
            held = max(0, math.ceil(-wanted * fps / lead_rate)) if facts.media_type != 'image' else 0
            if frozen:
                # One frame in, held for every frame out, transitions included.
                held = head
                reading = ('-ss', f'{max(0, clip.freeze - 0.25 / fps):.6f}', '-t', f'{1 / fps:.6f}')  # A quarter frame early, so rounding can't pick the next one.
                index = self.add_input(*reading, '-i', str(facts.path))
            else:
                # A ramp can play faster than average at the end, so it reads a little more than it needs.
                reading = ('-ss', f'{max(0, wanted):.6f}', '-t', f'{(frames - held) * clip.speed / fps + (RAMP_MARGIN if clip.ramp else 0):.6f}')
                index = self.clip_input(clip, facts, max(0, wanted), (frames - held) * clip.speed / fps + (RAMP_MARGIN if clip.ramp else 0))
            enter, exit_ = None if head else clip.enter, None if tail else clip.exit
            scale = supersample(clip.transform, enter, exit_, facts, self.fmt)
            canvas = (round(self.fmt.width * scale / 2) * 2, round(self.fmt.height * scale / 2) * 2)
            label = f'c{position}_{number}'
            timing = None
            if clip.ramp and not frozen and facts.media_type == 'video':
                # Each source frame moves to the moment the ramp shows it, then fps= keeps the nearest frame for each output frame.
                share = f'((T+{max(0, wanted) - source_in:.6f})/{clip.out - clip.in_:.6f})'
                timing = f'({ramp_time_expression(clip.ramp, share)}*{clip.length:.6f}+{(head - held) / fps:.6f})/TB'
            if cut:
                # The mask is read over the same stretch as the video, frame for frame, and applied at the source's size.
                mask = self.add_input(*reading, '-i', str(self.masks(facts, clip.cutout_pick)))
                self.graph += [f"[{index}:v]{','.join(source_steps(facts))}[{label}_full]", f'[{mask}:v]format=gray[{label}_shape]',
                               f'[{label}_shape][{label}_full]scale2ref=flags=bicubic[{label}_mask][{label}_sized]', f'[{label}_sized][{label}_mask]alphamerge[{label}_cut]',
                               f'[{label}_cut]{clip_chain(clip, facts, canvas, fps, frames, held, timing, sourced=True)}[{label}]']
            else:
                self.graph.append(f'[{index}:v]{clip_chain(clip, facts, canvas, fps, frames, held, timing)}[{label}]')
            shown = self.pose(label, clip.transform, enter, exit_, clip.length, frames, scale, head / fps, label, clip.beat_pulse)
            if clip.shape_mask:
                shown = self.shape(shown, clip.shape_mask, frames, label)
            if head:
                merged = f'x{position}_{number}'
                self.graph.append(f'[{joined_label}][{shown}]xfade=transition={XFADE_NAMES[clip.transition_in.kind]}:duration={2 * head / fps:.6f}:offset={(joined_frames - 2 * head) / fps:.6f}[{merged}]')
                if clip.transition_in.kind == 'whip':
                    merged = self.whip_blur(merged, joined_frames - 2 * head, 2 * head, joined_frames + frames - 2 * head)
                joined_label, joined_frames = merged, joined_frames + frames - 2 * head
            elif tail:
                joined_label, joined_frames = shown, frames
            else:
                segments.append(f'[{shown}]')
            cursor += base_frames
            self.add_clip_audio(clip, sound_facts, layer.muted)
        if joined_label:
            segments.append(f'[{joined_label}]')
        if cursor < self.total_frames:
            label = f'gap{position}_end'
            self.transparent_gap(label, self.total_frames - cursor)
            segments.append(f'[{label}]')
        joined = f'layer{position}'
        self.graph.append(f"{''.join(segments)}concat=n={len(segments)}:v=1:a=0[{joined}]")
        if layer.blend != 'normal':
            return self.blended(base, joined, position, layer.blend)
        return self.overlay(base, joined, position, '0', '0')

    def shape(self, label: str, mask: ShapeMask, frames: int, name: str) -> str:
        """Keeps only the frame inside the shape: its own transparency times the shape's, so nothing outside the picture appears."""
        fps = self.fmt.fps
        picture = self.folder / f'{name}-shape.png'
        write_shape_mask(mask, self.fmt.width, self.fmt.height, picture)
        index = self.add_input('-loop', '1', '-framerate', str(fps), '-t', f'{(frames + 1) / fps:.6f}', '-i', str(picture))
        self.graph += [f'[{label}]split=2[{name}_body][{name}_own]', f'[{name}_own]alphaextract[{name}_alpha]',
                       f'[{index}:v]format=gbrap,trim=end_frame={frames},setpts=PTS-STARTPTS,settb=AVTB,alphaextract[{name}_shape]',
                       f'[{name}_alpha][{name}_shape]blend=all_mode=multiply[{name}_both]', f'[{name}_body][{name}_both]alphamerge[{name}_shaped]']
        return f'{name}_shaped'

    def whip_blur(self, label: str, first: int, frames: int, total: int) -> str:
        """A sideways blur that peaks halfway through the slide, so the cut reads as a fast camera pan."""
        fps = self.fmt.fps
        lines = [f'{frame / fps:.6f} gblur@{label}w sigma {WHIP_BLUR * self.fmt.height * math.sin(math.pi * min(1, max(0, (frame - first + 0.5) / frames))) if first <= frame < first + frames else 0:.3f};' for frame in range(total)]
        (self.folder / f'{label}-w.cmd').write_text('\n'.join(lines), encoding='utf-8')
        blurred = f'{label}_whip'
        self.graph.append(f'[{label}]sendcmd=f={label}-w.cmd,gblur@{label}w=sigma=0:sigmaV=0:steps=3[{blurred}]')
        return blurred

    def blended(self, base: str, top: str, position: int, mode: str) -> str:
        """Blend the color, then let the layer's own alpha decide how much of that shows. Matches the preview shader."""
        n = f'b{position}'
        self.graph += [f'[{top}]split=2[{n}_color][{n}_shape]', f'[{n}_shape]alphaextract[{n}_mask]', f'[{n}_color]format=gbrp[{n}_rgb]',
                       f'[{base}]format=gbrp,split=2[{n}_under][{n}_base]', f'[{n}_under][{n}_rgb]blend=all_mode={mode},format=gbrp[{n}_mixed]',
                       f'[{n}_mixed]format=gbrap[{n}_open]', f'[{n}_open][{n}_mask]alphamerge[{n}_shaped]']
        return self.overlay(f'{n}_base', f'{n}_shaped', position, '0', '0')

    def overlay(self, base: str, top: str, position: int, x: str, y: str) -> str:
        output = f'v{position}'
        self.graph.append(f"[{base}][{top}]overlay=x='{x}':y='{y}':eval=frame:format=gbrp:eof_action=pass[{output}]")
        return output

    def add_text_layer(self, layer, position: int, base: str) -> str:
        fps = self.fmt.fps
        for number, item in enumerate(sorted(layer.items, key=lambda text: text.start)):
            image = self.folder / f'text-{position}-{number}.png'
            render_text_image(item, self.fmt, image)
            frames = self.frames(item.length)
            index = self.add_input('-loop', '1', '-framerate', str(fps), '-t', f'{(frames + 1) / fps:.6f}', '-i', str(image))
            label, output = f'text{position}_{number}', f't{position}_{number}'
            self.graph.append(f'[{index}:v]format=gbrap,trim=end_frame={frames},setpts=PTS-STARTPTS,settb=AVTB[{label}]')
            shown = self.pose(label, item.transform, item.enter, item.exit, item.length, frames, 1, 0, label)
            late = f'{label}_late'
            self.graph.append(f'[{shown}]tpad=start={round(item.start * fps)}:color=black@0[{late}]')
            self.graph.append(f'[{base}][{late}]overlay=format=gbrp:eof_action=pass[{output}]')
            base = output
        return base

    def add_blur_layer(self, layer: BlurLayer, position: int, base: str) -> str:
        fps = self.fmt.fps
        for number, item in enumerate(sorted(layer.items, key=lambda box: box.start)):
            name = f'blur{position}_{number}'
            mask = self.folder / f'{name}.png'
            write_blur_mask(item, self.fmt, mask)
            frames = self.frames(item.length)
            index = self.add_input('-loop', '1', '-framerate', str(fps), '-t', f'{(frames + 1) / fps:.6f}', '-i', str(mask))
            self.graph.append(f'[{index}:v]format=gbrap,trim=end_frame={frames},setpts=PTS-STARTPTS,settb=AVTB[{name}_m]')
            shown = self.pose(f'{name}_m', item.transform, None, None, item.length, frames, 1, 0, f'{name}_m')
            start = round(item.start * fps)
            # Clear frames before and after: a mask that simply ended would have its last frame repeated.
            self.graph += [f'[{shown}]tpad=start={start}:stop={max(0, self.total_frames - start - frames)}:stop_mode=add:color=black@0,alphaextract[{name}_alpha]',
                           f'[{base}]split=2[{name}_keep][{name}_src]', f'[{name}_src]{blur_filters(item, self.fmt)},format=gbrap[{name}_fx]',
                           f'[{name}_fx][{name}_alpha]alphamerge[{name}_shaped]', f'[{name}_keep][{name}_shaped]overlay=format=gbrp:eof_action=pass[{name}_out]']
            base = f'{name}_out'
        return base

    def add_caption_layer(self, layer: CaptionLayer, position: int, base: str) -> str:
        """Every caption in one subtitle file, drawn in one step: a long talk has hundreds, too many to add one by one."""
        cues, marks = [], []
        for item in sorted(layer.items, key=lambda caption: caption.start):
            for start, end, lit in caption_states(item, bool(layer.highlight)):
                cues.append({'start': item.start + start, 'end': item.start + end, 'text': item.text, **({'position': item.position} if item.position else {})})
                marks.append(lit)
        if not cues:
            return base
        name = f'captions-{position}.ass'
        write_lyrics(self.folder / name, caption_edit(layer, cues), Path('/dev/null'), size=(self.fmt.width, self.fmt.height), marks=marks, mark_color=layer.highlight)
        fonts = self.folder / 'fonts'
        if not fonts.exists():
            fonts.symlink_to(LYRIC_FONTS_DIR)
        output = f'cap{position}'
        self.graph.append(f'[{base}]format=rgb24,ass=filename={name}:shaping=complex:fontsdir=fonts,format=gbrp[{output}]')
        return output

    def add_audio_layer(self, layer) -> None:
        if layer.muted:
            return
        for sound in layer.items:
            if sound.muted or sound.volume == 0:
                continue
            if sound.media_id is not None:
                facts = self.media(sound.media_id)
                if not facts.has_audio:
                    continue
                path = facts.path
            else:
                path = self.audio_asset(sound.asset_id)
            self.add_audio_track(self.voice(path) if sound.clean_voice else path, sound.in_, sound.out - sound.in_, sound_steps(sound, layer.volume), sound.duck)

    def bus(self, labels: list[str], total: float) -> str:
        # normalize=0 keeps each track's level.
        return f"{''.join(f'[{label}]' for label in labels)}amix=inputs={len(labels)}:duration=longest:normalize=0,apad,atrim=end={total}"

    def mix_tracks(self, total: float) -> None:
        if self.audio and self.ducked:
            self.audio_graph += [f'{self.bus(self.audio, total)},asplit=2[key][main]', f'{self.bus(self.ducked, total)}[under]',
                                 f'[under][key]{DUCK_FILTER}[dipped]', '[main][dipped]amix=inputs=2:duration=longest:normalize=0[mix]']
        elif self.audio or self.ducked:
            self.audio_graph.append(f'{self.bus(self.audio or self.ducked, total)}[mix]')

    def add_finish(self, current: str) -> str:
        """The cinematic finish over everything so far: captions come after it, above the bars."""
        finish = self.timeline.finish
        if self.timeline.lut and self.timeline.lut_amount > 0:
            from app.services.lut_service import resolve
            path = str(resolve(self.timeline.lut)).replace("'", "'\\''")
            amount = self.timeline.lut_amount
            graded, mixed, original = 'project_lut', 'project_lut_mix', 'project_lut_source'
            self.graph += [f'{current}split=2[{original}][{graded}]', f'[{graded}]lut3d=file=\'{path}\':interp=trilinear[{graded}done]',
                           f'[{original}][{graded}done]blend=all_expr=\'A*{1 - amount:.6f}+B*{amount:.6f}\'[{mixed}]']
            current = f'[{mixed}]'
        if finish is None or not (finish.letterbox or finish.grade or finish.glow or finish.vignette or finish.grain):
            return current
        steps, out, inputs = finish_filters(finish, self.fmt.width, self.fmt.height, self.folder, 'finish', current)
        if inputs:
            index = self.add_input(*inputs)
            steps = [line.replace('[MASK]', f'[{index}:v]') for line in steps]
        self.graph += steps
        return out

    def add_brand_layers(self, brand_layers, current: str) -> str:
        """Watermarks over the cinematic finish (bars included), under the captions. Matches the preview's drawBrand."""
        for position, layer in brand_layers:
            current = self.add_video_layer(layer, position, current)
        return current

    def build(self) -> Compiled:
        fmt = self.fmt
        self.graph.append(f'color=c=black:s={fmt.width}x{fmt.height}:r={fmt.fps}:d={self.total_frames / fmt.fps},format=gbrp,trim=end_frame={self.total_frames}[canvas]')
        current = 'canvas'
        finished = False
        brand_layers = []
        for position, layer in enumerate(self.timeline.layers):
            if layer.hidden or not layer.items:
                continue
            if layer.kind == 'video' and layer.id in BRAND_LAYER_IDS:  # drawn after the finish, before the captions
                brand_layers.append((position, layer))
                continue
            if layer.kind == 'captions' and not finished:
                current, finished = self.add_finish(current), True
                current = self.add_brand_layers(brand_layers, current)
            if layer.kind == 'video':
                current = self.add_video_layer(layer, position, current)
            elif layer.kind == 'text':
                current = self.add_text_layer(layer, position, current)
            elif layer.kind == 'blur':
                current = self.add_blur_layer(layer, position, current)
            elif layer.kind == 'captions':
                current = self.add_caption_layer(layer, position, current)
            else:
                self.add_audio_layer(layer)
        if not finished:
            current = self.add_finish(current)
            current = self.add_brand_layers(brand_layers, current)
        self.graph.append(f'[{current}]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[final]')
        total = self.total_frames / fmt.fps
        self.mix_tracks(total)
        return Compiled(self.args, ';'.join(self.graph), total, self.audio_args, ';'.join(self.audio_graph), self.timeline.normalize_audio)


def apply_bypass(clip):
    """The clip as it plays: effects switched off (`bypass`) left out, their settings kept in the saved timeline.
    frontend/src/timeline/effects.ts applyBypass does the same for the preview."""
    if not clip.bypass:
        return clip
    changes: dict[str, Any] = {}
    for effect in clip.bypass:
        if effect == 'look':
            changes['look'] = 'none'
        elif effect == 'colour':
            changes['adjust'] = clip.adjust.model_copy(update={'brightness': 1, 'contrast': 1, 'saturation': 1, 'gamma': 1, 'temperature': 1, 'tint': 1, 'fade': 0})
        elif effect == 'old_film':
            changes['old_film'] = None
        elif effect == 'signal_damage':
            changes['signal_damage'] = None
        elif effect == 'lens_surface':
            changes['lens_surface'] = None
        elif effect == 'colour_splash':
            changes['colour_splash'] = None
        elif effect == 'dreamy_glow':
            changes['dreamy_glow'] = None
        elif effect == 'beat_pulse':
            changes['beat_pulse'] = None
        elif effect == 'background':
            changes.update(cutout=None, cutout_pick=None, focus_pull=None)
        elif effect == 'green_screen':
            changes['chroma'] = None
        elif effect == 'steady':
            changes['stabilise'] = False
        elif effect == 'reverse':
            changes['reverse'] = False
        elif effect == 'speed_effect':
            changes['ramp'] = None
        elif effect == 'motion':
            changes['transform'] = clip.transform.model_copy(update={'keyframes': {}})
        elif effect == 'enter_exit':
            changes.update(enter=None, exit=None)
        elif effect == 'transition':
            changes['transition_in'] = None
        elif effect == 'clean_voice':
            changes['clean_voice'] = False
    return clip.model_copy(update=changes)


def playing_timeline(timeline: Timeline) -> Timeline:
    """The timeline with every clip's switched-off effects left out."""
    if not any(layer.kind == 'video' and any(clip.bypass for clip in layer.items) for layer in timeline.layers):
        return timeline
    layers = [layer.model_copy(update={'items': [apply_bypass(clip) for clip in layer.items]}) if layer.kind == 'video' else layer for layer in timeline.layers]
    return timeline.model_copy(update={'layers': layers})


def compile_timeline(timeline: Timeline, media: Callable[[int], MediaFacts], audio_asset: Callable[[str], Path], folder: Path, prepared: Prepared | None = None, masks: Callable[[MediaFacts, Any], Path] | None = None, voices: Callable[[Path], Path] | None = None) -> Compiled:
    if timeline.duration <= 0:
        raise ValueError('Add a clip to the timeline first.')
    return Builder(timeline, media, audio_asset, folder, prepared, masks, voices).build()


def video_inputs(compiled: Compiled) -> int:
    return compiled.args.count('-i')


def mix_audio(ffmpeg: str, compiled: Compiled, folder: Path, should_cancel: Callable[[], bool]) -> Path:
    (folder / 'audio-graph.txt').write_text(compiled.audio_graph, encoding='utf-8')
    target = folder / 'mix.wav'
    result = run_cancellable([ffmpeg, '-nostdin', '-v', 'error', '-y', *compiled.audio_args, '-filter_complex_script', str(folder / 'audio-graph.txt'),
                              '-map', '[mix]', '-c:a', 'pcm_f32le', str(target)], should_cancel)
    if result.returncode:
        logger.error('Audio mix failed: %s', result.stderr[-1000:])
        raise RuntimeError('Export failed. The audio could not be mixed.')
    return target


def normalize_loudness(ffmpeg: str, compiled: Compiled, source: Path, folder: Path, should_cancel: Callable[[], bool]) -> Path:
    """Two passes: measure, then apply one steady gain, so quiet and loud moments keep their balance."""
    measure = run_cancellable([ffmpeg, '-nostdin', '-hide_banner', '-y', '-i', str(source), '-af', f'{LOUDNORM}:print_format=json', '-f', 'null', '-'], should_cancel)
    found = re.search(r'\{[^{}]*"input_i"[^{}]*\}', measure.stderr or '')
    if measure.returncode or not found:
        logger.warning('Could not measure loudness: %s', (measure.stderr or '')[-500:])
        return source
    stats = json.loads(found.group())
    if not math.isfinite(float(stats['input_i'])):  # Silence has no loudness to correct.
        return source
    target = folder / 'normalized.wav'
    measured = f"measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}"
    result = run_cancellable([ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', str(source), '-af', f'{LOUDNORM}:{measured}:linear=true,aresample=48000,apad,atrim=end={compiled.duration}',
                              '-c:a', 'pcm_f32le', str(target)], should_cancel)
    if result.returncode:
        logger.warning('Loudness correction failed: %s', result.stderr[-500:])
        return source
    return target


def render_timeline(timeline: Timeline, media: Callable[[int], MediaFacts], audio_asset: Callable[[str], Path], target: Path,
                    on_progress: Callable[[int], None], should_cancel: Callable[[], bool] = lambda: False, draft: bool = False, prepared: Prepared | None = None, masks: Callable[[MediaFacts, Any], Path] | None = None, voices: Callable[[Path], Path] | None = None, hardware: bool = True) -> None:
    """Encode into a private folder, then publish a complete file. A draft is for watching in the editor, so speed comes first."""
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise ValueError('Exporting requires ffmpeg on the server.')
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.video-export-', dir=target.parent) as folder:
        folder = Path(folder)
        compiled = compile_timeline(timeline, media, audio_asset, folder, prepared, masks, voices)
        (folder / 'graph.txt').write_text(compiled.graph, encoding='utf-8')
        output = folder / 'output.mp4'
        # Audio is mixed in its own pass: sharing a graph with video let ffmpeg lose the end of a clip's sound.
        audio_input, audio = [], ['-an']
        if compiled.has_audio:
            mix = mix_audio(ffmpeg, compiled, folder, should_cancel)
            if compiled.normalize_audio and not draft:
                mix = normalize_loudness(ffmpeg, compiled, mix, folder, should_cancel)
            audio_input = ['-i', str(mix)]
            audio = ['-map', f'{video_inputs(compiled)}:a', '-c:a', 'aac', '-b:a', '192k']
        # Hardware encoding (Apple Silicon's Media Engine, Intel Quick Sync, NVENC where available) is several times
        # faster than libx264 at export quality. VideoToolbox takes a bitrate instead of a CRF, so scale it with the
        # frame size. Drafts keep libx264, which is already fast at its low settings.
        short = min(timeline.format.width, timeline.format.height)
        encoder = ['-c:v', 'libx264', *(['-preset', 'veryfast', '-crf', '26', '-g', '15'] if draft else ['-preset', 'fast', '-crf', '20'])]
        if hardware and not draft and _hardware_h264(ffmpeg):
            megabits = {720: 9, 1080: 16, 1440: 28}.get(short, 50 if short >= 2160 else round(short * 0.015))
            encoder = ['-c:v', 'h264_videotoolbox', '-b:v', f'{megabits}M']
        # The graph goes in a file: a long timeline's graph can exceed the command-line limit.
        args = [ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', *compiled.args, *audio_input, '-filter_complex_script', str(folder / 'graph.txt'),
                '-map', '[final]', *audio, '-t', f'{compiled.duration:.6f}', *encoder, '-pix_fmt', 'yuv420p', *BT709_OUTPUT_ARGS,
                '-map_metadata', '-1', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', '-n', str(output)]
        with tempfile.TemporaryFile(mode='w+') as errors:
            process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=errors, text=True, cwd=folder)
            last_output = [time.monotonic()]
            stalled = [False]

            def should_stop() -> bool:
                stalled[0] = time.monotonic() - last_output[0] > STALLED_AFTER_SECONDS
                return stalled[0] or should_cancel()

            stop_process_when(process, should_stop)
            try:
                assert process.stdout is not None
                for line in process.stdout:
                    last_output[0] = time.monotonic()
                    key, _, value = line.strip().partition('=')
                    if key == 'out_time_us' and value.lstrip('-').isdigit():
                        on_progress(min(99, max(0, int(int(value) / (compiled.duration * 1_000_000) * 100))))
                code = process.wait()
                if should_cancel():
                    raise JobCancelled()
                if stalled[0]:
                    raise RuntimeError('Export failed. The encoder stopped responding.')
                if code != 0 or not output.exists() or output.stat().st_size == 0:
                    errors.seek(0)
                    logger.error('Timeline export failed: %s', errors.read()[-1500:].strip())
                    raise RuntimeError('Export failed. The encoder could not process this timeline; see the server log for details.')
                if target.exists():
                    raise RuntimeError('The export destination already exists. Please export again.')
                target.hardlink_to(output)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                if process.stdout is not None:
                    process.stdout.close()


def upgrade_edit_recipe(recipe: dict[str, Any] | None, media_id: int, duration: float, width: int | None, height: int | None) -> dict[str, Any]:
    """Version 1 stored one trimmed clip and global settings. Older recipes stay untouched on disk."""
    if recipe and recipe.get('version') == 2:
        return recipe
    clip = (recipe or {}).get('clips', [{}])[0] if (recipe or {}).get('clips') else {}
    settings = (recipe or {}).get('settings', {})
    item: dict[str, Any] = {
        'id': 'clip-1', 'media_id': clip.get('photo_id', media_id), 'start': 0, 'in': clip.get('in', 0), 'out': clip.get('out') or duration,
        'volume': settings.get('volume', 1), 'muted': settings.get('mute', False),
        'adjust': {key: settings[key] for key in ('rotation', 'flip_horizontal', 'flip_vertical', 'brightness', 'contrast', 'saturation') if key in settings},
    }
    w, h = width or 1920, height or 1080
    if settings.get('rotation') in (90, 270):
        w, h = h, w
    longest = max(w, h)
    if longest > 3840:
        w, h = round(w * 3840 / longest), round(h * 3840 / longest)
    return {'version': 2, 'format': {'width': w - w % 2, 'height': h - h % 2, 'fps': 30},
            'layers': [{'id': 'main', 'kind': 'video', 'name': 'Main', 'magnetic': True, 'items': [item]}]}
