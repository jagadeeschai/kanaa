"""The editing timeline, version 2. One document drives preview and export."""
from __future__ import annotations

from typing import Annotated, Dict, List, Literal, Optional, Tuple, Union

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_LAYERS = 6  # Phase 1: live preview stays smooth up to 6 video layers.
MAX_ITEMS = 2000  # Captions on a long talk add up.
FONT_NAME = r'^[A-Za-z0-9 ]{1,40}$'  # A font family name, which can't carry ASS formatting.
Ease = Literal['linear', 'easeOut', 'easeInOut']


class Strict(BaseModel):
    model_config = {'allow_inf_nan': False, 'extra': 'forbid', 'populate_by_name': True}


class Format(Strict):
    width: int = Field(default=1080, ge=240, le=3840)
    height: int = Field(default=1920, ge=240, le=3840)
    fps: Literal[24, 25, 30, 50, 60] = 30

    @field_validator('width', 'height')
    @classmethod
    def even(cls, value: int) -> int:
        if value % 2:
            raise ValueError('Frame sizes must be even numbers.')
        return value


class Keyframe(Strict):
    t: float = Field(ge=0)
    v: float
    ease: Ease = 'linear'


class Transform(Strict):
    x: float = 0.5
    y: float = 0.5
    scale: float = Field(default=1, gt=0, le=8)
    opacity: float = Field(default=1, ge=0, le=1)
    rotation: float = Field(default=0, ge=-3600, le=3600)  # Degrees, clockwise.
    # Titles only: leaning back (tilt_x, top away) and turning (tilt_y, right side away), in degrees, in true perspective.
    tilt_x: float = Field(default=0, ge=-80, le=80)
    tilt_y: float = Field(default=0, ge=-80, le=80)
    keyframes: Dict[Literal['x', 'y', 'scale', 'rotation', 'opacity', 'tilt_x', 'tilt_y'], List[Keyframe]] = Field(default_factory=dict)

    @model_validator(mode='after')
    def ordered(self):
        for keys in self.keyframes.values():
            if any(b.t <= a.t for a, b in zip(keys, keys[1:])):
                raise ValueError('Keyframes must be in time order.')
        if any(not 0 <= key.v <= 1 for key in self.keyframes.get('opacity', [])):
            raise ValueError('Opacity keyframes must be between 0 and 1.')
        if any(key.v <= 0 or key.v > 8 for key in self.keyframes.get('scale', [])):
            raise ValueError('Size keyframes must be above 0 and at most 8.')
        return self

    @property
    def is_default(self) -> bool:
        return (self.x, self.y, self.scale, self.opacity, self.rotation) == (0.5, 0.5, 1, 1, 0) and not self.keyframes


class Adjust(Strict):
    rotation: Literal[0, 90, 180, 270] = 0
    flip_horizontal: bool = False
    flip_vertical: bool = False
    brightness: float = Field(default=1, ge=0.25, le=2)
    contrast: float = Field(default=1, ge=0.25, le=2)
    saturation: float = Field(default=1, ge=0, le=2)
    gamma: float = Field(default=1, ge=0.5, le=2)
    temperature: float = Field(default=1, ge=0.7, le=1.4)  # Warmth: above 1 warms the reds, below 1 cools the blues.
    tint: float = Field(default=1, ge=0.75, le=1.33)  # Green above 1, magenta below.
    fade: float = Field(default=0, ge=0, le=0.6)  # Lifts the blacks toward white, a soft film matte.


class Animation(Strict):
    preset: Literal['fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom', 'pop', 'blur', 'bounce', 'ground-rise', 'blast', 'magic-form', 'magic-vanish', 'particle-form', 'rise-behind', 'push-through']
    duration: float = Field(default=0.5, ge=0.1, le=3)


class Transition(Strict):
    kind: Literal['crossfade', 'wipe', 'slide', 'zoom', 'flash', 'dip', 'whip']
    duration: float = Field(default=0.6, ge=0.1, le=2)


class Chroma(Strict):
    """Removes a background colour. Similarity and softness are chroma distances, 0 to about 0.7."""
    color: str = Field(default='#00b140', pattern=r'^#[0-9a-fA-F]{6}$')
    similarity: float = Field(default=0.08, ge=0.001, le=0.5)
    softness: float = Field(default=0.06, ge=0.001, le=0.5)
    spill: float = Field(default=0.5, ge=0, le=1)


class RampPoint(Strict):
    t: float = Field(ge=0, le=1)  # Through the clip's time.
    v: float = Field(ge=0.05, le=10)  # Relative speed; a ramp is scaled to average 1.


class CutoutPick(Strict):
    """Which of the people, or the objects, a cut-out keeps. Numbers are from the clip's list of them; None keeps them all."""
    kind: Literal['people', 'objects']
    ids: Optional[List[int]] = Field(default=None, min_length=1, max_length=6)

    @field_validator('ids')
    @classmethod
    def known(cls, ids):
        if ids is not None and any(not 0 <= number < 6 for number in ids):
            raise ValueError('Pick from the people or objects found.')
        return sorted(set(ids)) if ids is not None else None


class FocusPull(Strict):
    """With a blurred background: part way through, the focus moves from who was chosen to `to` (None is all of them).
    `at` is in the clip's source seconds, of the steadied or reversed copy when there is one."""
    to: Optional[List[int]] = Field(default=None, min_length=1, max_length=6)
    at: float = Field(ge=0)
    length: float = Field(default=1, ge=0.2, le=4)


class ShapeMask(Strict):
    """Only the part of the frame inside `points` shows, with a soft edge. Points are 0 to 1 across and down the frame."""
    points: List[Tuple[float, float]] = Field(min_length=3, max_length=200)
    feather: float = Field(default=0.004, ge=0, le=0.05)  # Of the frame height.

    @field_validator('points')
    @classmethod
    def inside(cls, points):
        if any(not (-0.1 <= x <= 1.1 and -0.1 <= y <= 1.1) for x, y in points):
            raise ValueError('A shape must stay on the frame.')
        return points


class OldFilm(Strict):
    """Clip-level distressed film stock. Values are strengths from off to strong."""
    intensity: float = Field(default=0.65, ge=0, le=1)
    grain: float = Field(default=0.55, ge=0, le=1)
    scratches: float = Field(default=0.45, ge=0, le=1)
    dust: float = Field(default=0.35, ge=0, le=1)
    weave: float = Field(default=0.25, ge=0, le=1)


class SignalDamage(Strict):
    mode: Literal['glitch', 'vhs'] = 'glitch'
    intensity: float = Field(default=0.6, ge=0, le=1)
    rgb_split: float = Field(default=0.5, ge=0, le=1)
    jitter: float = Field(default=0.45, ge=0, le=1)
    scanlines: float = Field(default=0.35, ge=0, le=1)
    noise: float = Field(default=0.3, ge=0, le=1)


class LensSurface(Strict):
    mode: Literal['dirt', 'raindrops'] = 'raindrops'
    intensity: float = Field(default=0.6, ge=0, le=1)
    amount: float = Field(default=0.5, ge=0, le=1)
    refraction: float = Field(default=0.55, ge=0, le=1)
    softness: float = Field(default=0.4, ge=0, le=1)


class ColourSplash(Strict):
    color: str = Field(default='#d52836', pattern=r'^#[0-9a-fA-F]{6}$')
    intensity: float = Field(default=1, ge=0, le=1)
    tolerance: float = Field(default=0.12, ge=0.01, le=0.5)
    softness: float = Field(default=0.08, ge=0.001, le=0.3)


class DreamyGlow(Strict):
    intensity: float = Field(default=0.45, ge=0, le=1)
    softness: float = Field(default=0.5, ge=0, le=1)
    warmth: float = Field(default=0.2, ge=0, le=1)


class BeatPulse(Strict):
    strength: float = Field(default=0.6, ge=0, le=1)
    size: float = Field(default=0.04, ge=0.005, le=0.15)
    bpm: float = Field(default=120, ge=30, le=300)
    offset: float = Field(default=0, ge=0, le=60)


class ToneGrade(Strict):
    """Duotone maps dark to `shadow` and light to `highlight`; split-tone tints shadows and highlights of the real colours."""
    mode: Literal['duotone', 'split'] = 'split'
    shadow: str = Field(default='#1f6f78', pattern=r'^#[0-9a-fA-F]{6}$')
    highlight: str = Field(default='#f2a541', pattern=r'^#[0-9a-fA-F]{6}$')
    balance: float = Field(default=0.5, ge=0, le=1)
    intensity: float = Field(default=0.7, ge=0, le=1)


class Mirror(Strict):
    mode: Literal['left', 'top', 'quad', 'kaleido'] = 'left'
    segments: int = Field(default=6, ge=3, le=12)
    angle: float = Field(default=0, ge=-180, le=180)


class ZoomBlur(Strict):
    intensity: float = Field(default=0.5, ge=0, le=1)
    center_x: float = Field(default=0.5, ge=0, le=1)
    center_y: float = Field(default=0.5, ge=0, le=1)


class TiltShift(Strict):
    focus_y: float = Field(default=0.55, ge=0, le=1)
    band: float = Field(default=0.22, ge=0.02, le=0.8)
    blur: float = Field(default=0.6, ge=0, le=1)
    saturation: float = Field(default=0.35, ge=0, le=1)


class Echo(Strict):
    """Echo blends the last few frames; smear keeps bright parts lingering, like light trails."""
    mode: Literal['echo', 'smear'] = 'echo'
    trails: int = Field(default=4, ge=2, le=8)
    decay: float = Field(default=0.6, ge=0.2, le=0.95)


class Clip(Strict):
    """A video or photo on a video layer. `in` and `out` are source seconds, `start` timeline seconds."""
    id: str = Field(min_length=1, max_length=64)
    media_id: int
    start: float = Field(ge=0)
    in_: float = Field(default=0, ge=0, alias='in')
    out: float = Field(gt=0)
    speed: float = Field(default=1, ge=0.05, le=20)  # Wider than the slider: halves of a split ramp need it.
    volume: float = Field(default=1, ge=0, le=2)
    muted: bool = False
    enabled: bool = True  # An inactive multicam angle stays timed on the timeline but is absent from preview and export.
    fade_in: float = Field(default=0, ge=0)
    fade_out: float = Field(default=0, ge=0)
    transform: Transform = Field(default_factory=Transform)
    adjust: Adjust = Field(default_factory=Adjust)
    frame_locked: bool = True  # Prevents accidental position, size, and rotation changes in the editor.
    enter: Optional[Animation] = None
    exit: Optional[Animation] = None
    transition_in: Optional[Transition] = None
    look: Literal['none', 'warm', 'cool', 'mono', 'vivid', 'film'] = 'none'
    old_film: Optional[OldFilm] = None
    signal_damage: Optional[SignalDamage] = None
    lens_surface: Optional[LensSurface] = None
    colour_splash: Optional[ColourSplash] = None
    dreamy_glow: Optional[DreamyGlow] = None
    beat_pulse: Optional[BeatPulse] = None
    tone_grade: Optional[ToneGrade] = None
    mirror: Optional[Mirror] = None
    zoom_blur: Optional[ZoomBlur] = None
    tilt_shift: Optional[TiltShift] = None
    echo: Optional[Echo] = None  # Export blends frames inline; the preview plays a prepared copy made the same way.
    chroma: Optional[Chroma] = None
    freeze: Optional[float] = Field(default=None, ge=0)  # Source seconds of the frame held for the whole clip.
    reverse: bool = False  # Plays in..out backwards, without sound.
    stabilise: bool = False  # Uses the steadied copy, slightly zoomed in.
    ramp: Optional[List[RampPoint]] = Field(default=None, max_length=20)  # Speed through the clip, without sound.
    cutout: Optional[Literal['remove', 'blur']] = None  # The person's background, removed or blurred.
    cutout_pick: Optional[CutoutPick] = None  # Only these people, or these objects, stay (remove) or stay sharp (blur).
    depth_gap: Literal[0, 1, 2, 3, 4, 5] = 0  # Extra clear space around a foreground used to hide a title behind it.
    blur_amount: Literal['subtle', 'medium', 'strong'] = 'medium'  # How soft the background goes, with blur.
    focus_pull: Optional[FocusPull] = None  # With blur: the focus moves to someone else part way through.
    bypass: Optional[List[Literal['look', 'colour', 'old_film', 'signal_damage', 'lens_surface', 'colour_splash', 'dreamy_glow', 'beat_pulse', 'tone_grade', 'mirror', 'zoom_blur', 'tilt_shift', 'echo', 'background', 'green_screen', 'steady', 'reverse', 'speed_effect', 'motion', 'enter_exit', 'transition', 'clean_voice']]] = Field(default=None, max_length=22)  # Effects switched off, their settings kept.
    clean_voice: bool = False  # Its sound plays from the cleaned copy.
    shape_mask: Optional[ShapeMask] = None  # Shows only part of the frame, to put a title behind scenery.

    @model_validator(mode='after')
    def valid_range(self):
        if self.out <= self.in_:
            raise ValueError('A clip must end after it starts.')
        if self.ramp is not None and (len(self.ramp) < 2 or self.ramp[0].t != 0 or self.ramp[-1].t != 1 or any(b.t <= a.t for a, b in zip(self.ramp, self.ramp[1:]))):
            raise ValueError('A speed ramp must run from the start of the clip to its end.')
        if self.cutout_pick is not None and self.cutout is None:
            raise ValueError('Choosing who stays needs the background removed or blurred.')
        if self.focus_pull is not None and self.cutout != 'blur':
            raise ValueError('A focus pull needs the background blurred.')
        return self

    @property
    def length(self) -> float:
        return (self.out - self.in_) / self.speed


class TitleDepth(Strict):
    """Extruded letters: copies stepping back into the scene, shaded darker towards the back."""
    amount: float = Field(default=0.5, ge=0, le=1)
    color: str = Field(default='#6b4a1f', pattern=r'^#[0-9a-fA-F]{6}$')  # The sides of the letters.
    light: float = Field(default=0.55, ge=0, le=1)  # How much the sides catch the light.
    angle: float = Field(default=24.44, ge=-180, le=180)  # Extrusion direction: degrees from straight-down towards the right.


class KeepClear(Strict):
    """The title moves aside so no person comes within `gap` of its letters (frame heights). The move itself is ordinary
    x/y keyframes; this only remembers the settings and the position keys from before, so it can be redone or removed."""
    gap: float = Field(default=0.04, ge=0, le=0.15)
    direction: Literal['auto', 'up', 'down', 'left', 'right'] = 'auto'
    max_move: float = Field(default=0.35, ge=0.02, le=0.8)  # Frame heights (up/down) or widths (left/right).
    x: float = 0.5  # The position and keys before the move.
    y: float = 0.5
    x_keys: Optional[List[Keyframe]] = Field(default=None, max_length=2000)
    y_keys: Optional[List[Keyframe]] = Field(default=None, max_length=2000)


class TitlePin(Strict):
    """Locks the title to the scene in a clip: it keeps its place in the world as that clip's camera moves."""
    clip_id: str = Field(min_length=1, max_length=64)
    at: float = Field(ge=0)  # Timeline seconds where the title is placed as it is drawn.


class Text(Strict):
    id: str = Field(min_length=1, max_length=64)
    start: float = Field(ge=0)
    length_: float = Field(gt=0, alias='length')
    text: str = Field(min_length=1, max_length=500)
    style: Literal['outline', 'shadow', 'band'] = 'band'
    position: Literal['top', 'center', 'bottom'] = 'bottom'
    color: str = Field(default='#ffffff', pattern=r'^#[0-9a-fA-F]{6}$')
    size: int = Field(default=44, ge=12, le=100)
    enter: Optional[Animation] = None
    exit: Optional[Animation] = None
    transform: Transform = Field(default_factory=Transform)  # Moves the whole title from where `position` puts it.
    depth: Optional[TitleDepth] = None
    pin: Optional[TitlePin] = None
    keep_clear: Optional[KeepClear] = None
    # Template looks. A title using none of these is drawn exactly as before.
    subtitle: Optional[str] = Field(default=None, max_length=200)
    subtitle_size: Optional[int] = Field(default=None, ge=10, le=100)  # Defaults to just over half the title's size.
    subtitle_color: Optional[str] = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$')
    subtitle_above: bool = False
    subtitle_spacing: int = Field(default=0, ge=0, le=30)  # Letter spacing, in points at 720 wide.
    spacing: int = Field(default=0, ge=0, le=30)  # The title's own letter spacing, same units — the wide-tracked cinematic look.
    align: Literal['left', 'center', 'right'] = 'center'
    band_color: Optional[str] = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$')  # The box behind a band title.
    font: Optional[str] = Field(default=None, pattern=FONT_NAME)  # For English and other Latin lines.
    tamil_font: Optional[str] = Field(default=None, pattern=FONT_NAME)  # For Tamil lines.

    @property
    def designed(self) -> bool:
        return bool(self.subtitle) or self.align != 'center' or self.band_color is not None or bool(self.font) or bool(self.tamil_font)

    @property
    def length(self) -> float:
        return self.length_


class CaptionWord(Strict):
    w: str = Field(min_length=1, max_length=80)
    s: float = Field(ge=0)  # Seconds from the caption's start.


class Caption(Strict):
    """One caption line: its words and when each is spoken. The layer holds the look."""
    id: str = Field(min_length=1, max_length=64)
    start: float = Field(ge=0)
    length_: float = Field(gt=0, alias='length')
    words: List[CaptionWord] = Field(min_length=1, max_length=30)
    # This caption's own place, when it differs from its layer's (moved clear of a face). Mirrors model.ts.
    position: Optional[Literal['top', 'center', 'bottom']] = None

    @model_validator(mode='after')
    def ordered(self):
        if any(b.s < a.s for a, b in zip(self.words, self.words[1:])) or self.words[-1].s >= self.length_:
            raise ValueError('Caption words must be in order and inside the caption.')
        return self

    @property
    def length(self) -> float:
        return self.length_

    @property
    def text(self) -> str:
        return ' '.join(word.w for word in self.words)


class BlurBox(Strict):
    """Hides part of the picture under it. Width and height are shares of the frame, before the transform's scale."""
    id: str = Field(min_length=1, max_length=64)
    start: float = Field(ge=0)
    length_: float = Field(gt=0, alias='length')
    style: Literal['blur', 'pixelate'] = 'blur'
    shape: Literal['oval', 'box'] = 'oval'
    amount: float = Field(default=0.6, ge=0.05, le=1)
    width: float = Field(default=0.2, ge=0.02, le=1)
    height: float = Field(default=0.2, ge=0.02, le=1)
    transform: Transform = Field(default_factory=Transform)

    @property
    def length(self) -> float:
        return self.length_


class Sound(Strict):
    """Audio on an audio layer: an uploaded song, or the sound of a media item."""
    id: str = Field(min_length=1, max_length=64)
    asset_id: Optional[str] = Field(default=None, pattern=r'^[a-f0-9]{32}$')
    media_id: Optional[int] = None
    start: float = Field(ge=0)
    in_: float = Field(default=0, ge=0, alias='in')
    out: float = Field(gt=0)
    speed: float = Field(default=1, ge=0.25, le=4)
    volume: float = Field(default=1, ge=0, le=2)
    muted: bool = False
    fade_in: float = Field(default=0, ge=0)
    fade_out: float = Field(default=0, ge=0)
    duck: bool = False  # Dips under the timeline's other sound.
    name: str = Field(default='', max_length=120)
    source_length: Optional[float] = Field(default=None, gt=0)  # Limits trimming in the editor.
    clean_voice: bool = False  # Plays from the cleaned copy.

    @model_validator(mode='after')
    def one_source(self):
        if (self.asset_id is None) == (self.media_id is None):
            raise ValueError('Sound needs exactly one source.')
        if self.out <= self.in_:
            raise ValueError('Sound must end after it starts.')
        return self

    @property
    def length(self) -> float:
        return (self.out - self.in_) / self.speed


class LayerBase(Strict):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(default='', max_length=80)
    hidden: bool = False
    muted: bool = False
    locked: bool = False


class VideoLayer(LayerBase):
    kind: Literal['video'] = 'video'
    magnetic: bool = False
    blend: Literal['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] = 'normal'
    items: List[Clip] = Field(default_factory=list)


class TextLayer(LayerBase):
    kind: Literal['text']
    items: List[Text] = Field(default_factory=list)


class BlurLayer(LayerBase):
    kind: Literal['blur']
    items: List[BlurBox] = Field(default_factory=list)


class CaptionLayer(LayerBase):
    kind: Literal['captions']
    style: Literal['outline', 'shadow', 'band'] = 'outline'
    position: Literal['top', 'center', 'bottom'] = 'bottom'
    color: str = Field(default='#ffffff', pattern=r'^#[0-9a-fA-F]{6}$')
    highlight: Optional[str] = Field(default='#ffd400', pattern=r'^#[0-9a-fA-F]{6}$')  # The word being spoken, or None.
    size: int = Field(default=48, ge=20, le=100)
    items: List[Caption] = Field(default_factory=list)


class AudioLayer(LayerBase):
    kind: Literal['audio']
    items: List[Sound] = Field(default_factory=list)
    volume: float = Field(default=1, ge=0, le=1.5)  # The whole track's level, multiplied into each sound.


Layer = Annotated[Union[VideoLayer, TextLayer, BlurLayer, CaptionLayer, AudioLayer], Field(discriminator='kind')]


class Finish(Strict):
    """A cinematic look over the whole video, under the captions. Each part 0 (off) to 1 (strong)."""
    letterbox: bool = False
    grade: float = Field(default=0, ge=0, le=1)  # Teal shadows, orange highlights.
    glow: float = Field(default=0, ge=0, le=1)
    vignette: float = Field(default=0, ge=0, le=1)
    grain: float = Field(default=0, ge=0, le=1)


class Timeline(Strict):
    version: Literal[2] = 2
    format: Format = Field(default_factory=Format)
    layers: List[Layer] = Field(default_factory=list)
    normalize_audio: bool = False
    finish: Optional[Finish] = None
    lut: Optional[str] = Field(default=None, pattern=r'^[a-z0-9-]{1,64}$')
    lut_amount: float = Field(default=1, ge=0, le=1)

    @model_validator(mode='after')
    def limits(self):
        if sum(layer.kind == 'video' for layer in self.layers) > MAX_LAYERS:
            raise ValueError(f'Use up to {MAX_LAYERS} video layers.')
        if sum(len(layer.items) for layer in self.layers) > MAX_ITEMS:
            raise ValueError(f'Use up to {MAX_ITEMS} items.')
        ids = [layer.id for layer in self.layers] + [item.id for layer in self.layers for item in layer.items]
        if len(ids) != len(set(ids)):
            raise ValueError('Every layer and item needs its own id.')
        for layer in self.layers:
            ordered = sorted(layer.items, key=lambda item: item.start)
            if any(a.start + a.length > b.start + 1e-6 for a, b in zip(ordered, ordered[1:])):
                raise ValueError(f'Items overlap on layer "{layer.name or layer.id}".')
        return self

    @property
    def duration(self) -> float:
        return max((item.start + item.length for layer in self.layers for item in layer.items), default=0)


def value_at(transform: Transform, prop: str, t: float) -> float:
    """Reference implementation, matched by frontend/src/timeline/evaluate.ts and the ffmpeg expressions."""
    keys = transform.keyframes.get(prop)
    if not keys:
        return getattr(transform, prop)
    if t <= keys[0].t:
        return keys[0].v
    for a, b in zip(keys, keys[1:]):
        if t < b.t:
            p = (t - a.t) / (b.t - a.t)
            eased = {'linear': p, 'easeOut': 1 - (1 - p) ** 3,
                     'easeInOut': 4 * p ** 3 if p < 0.5 else 1 - (-2 * p + 2) ** 3 / 2}[a.ease]
            return a.v + (b.v - a.v) * eased
    return keys[-1].v
