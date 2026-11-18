"""The editing timeline, version 2. One document drives preview and export."""
from __future__ import annotations

import math

from typing import Annotated, Dict, List, Literal, Optional, Tuple, Union

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_LAYERS = 8  # Lyric videos carry lights, effects, brand, credits and a person layer; sparse layers cost the preview little.
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
    preset: Literal['fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom', 'pop', 'blur', 'bounce', 'ground-rise', 'blast', 'magic-form', 'magic-vanish', 'particle-form', 'rise-behind', 'push-through',
                    'reveal', 'soft-edge', 'line', 'chromatic', 'prism', 'echo', 'pop-letters', 'gravity', 'split', 'expand', 'blur-sideways', 'fly-through', 'rapid-zoom', 'fly-reveal', 'fly-through-3d', 'word-rise', 'word-pop', 'word-fade']
    duration: float = Field(default=0.5, ge=0.1, le=3)


class Transition(Strict):
    kind: Literal['crossfade', 'wipe', 'slide', 'zoom', 'flash', 'dip', 'whip', 'circle-open', 'circle-close', 'cross-blur',
                  'spin-in', 'spin-out', 'doorway', 'puzzle-left', 'puzzle-right', 'mosaic', 'ripple', 'cross-zoom',
                  'cube', 'swap', 'page-curl-left', 'page-curl-right', 'light-wipe']
    duration: float = Field(default=0.6, ge=0.1, le=2)
    # Which way a wipe's edge or a slide's pictures travel; none is left. Mirrors Transition in animation.ts.
    direction: Optional[Literal['left', 'right', 'up', 'down']] = None
    # What a dip or flash passes through; none is black for a dip and white for a flash. Mirrors animation.ts.
    color: Optional[str] = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$')


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
    kind: Literal['people', 'objects', 'land']  # land: everything but the sky, always all of it.
    ids: Optional[List[int]] = Field(default=None, min_length=1, max_length=6)

    @field_validator('ids')
    @classmethod
    def known(cls, ids):
        if ids is not None and any(not 0 <= number < 6 for number in ids):
            raise ValueError('Pick from the people or objects found.')
        return sorted(set(ids)) if ids is not None else None

    @model_validator(mode='after')
    def whole_land(self):
        if self.kind == 'land' and self.ids is not None:
            raise ValueError('The land is kept whole: no numbers.')
        return self


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


class PopoutLink(Strict):
    """A Pop-out (3D) clip shows a filled background, its person on a layer above: what it was before, so it can go back."""
    original_media_id: int
    person_clip_id: str = Field(min_length=1, max_length=64)
    original_transform: Optional[Transform] = None


class Composite(Strict):
    """How a keyed or cut-out clip sits on what is behind it. Same numbers in the preview shader and the export."""
    choke: float = Field(default=0, ge=0, le=0.9)          # Tightens the edge: alpha below this goes, the rest is stretched.
    wrap: float = Field(default=0, ge=0, le=1)             # Light wrap: the background's blurred light over the edge.
    match: float = Field(default=0, ge=0, le=1)            # How far toward match_gain the clip's colour goes.
    match_gain: Optional[Tuple[float, float, float]] = None  # Red, green, blue gains measured against the background.

    @field_validator('match_gain')
    @classmethod
    def sensible(cls, gain):
        if gain is not None and any(not (0.4 <= value <= 2.5) for value in gain):
            raise ValueError('Colour match gains must be between 0.4 and 2.5.')
        return gain


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


class Wheel(Strict):
    hue: float = Field(default=0, ge=0, le=360)
    amount: float = Field(default=0, ge=0, le=1)
    brightness: float = Field(default=0, ge=-1, le=1)


class ColourWheels(Strict):
    """Shadows, midtones and highlights (lift, gamma, gain), after the look and adjustments. See colour_wheels.py."""
    shadows: Wheel = Field(default_factory=Wheel)
    midtones: Wheel = Field(default_factory=Wheel)
    highlights: Wheel = Field(default_factory=Wheel)


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
    # What the clip is for, shown on it in the timeline; none shows the file's name. The export ignores it.
    name: Optional[str] = Field(default=None, max_length=80)
    # Settings this item sets for itself, over its layer's style (Layer.style). Names of the item's own fields.
    own: List[Annotated[str, Field(min_length=1, max_length=40)]] = Field(default_factory=list, max_length=80)
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
    wheels: Optional[ColourWheels] = None
    audio_presets: List[Literal['remove-rumble', 'clearer-voice', 'warmer-music', 'even-out']] = Field(default_factory=list, max_length=4)  # audio_presets.py
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
    popout: Optional[PopoutLink] = None  # Set by Pop-out (3D); Remove pop-out puts the original picture back.
    composite: Optional[Composite] = None  # Edge tightening, light wrap and colour match for a keyed or cut-out clip.

    @model_validator(mode='after')
    def valid_range(self):
        if self.out <= self.in_:
            raise ValueError('A clip must end after it starts.')
        if any(move and move.preset in ('fly-reveal', 'fly-through-3d') for move in (self.enter, self.exit)):
            raise ValueError('Letter-window reveals are for titles only.')
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
    material: Optional[Literal['gold', 'chrome', 'stone', 'neon', 'glass']] = None
    bevel: float = Field(default=0, ge=0, le=1)
    shine: float = Field(default=0, ge=0, le=1)
    sweep: bool = False
    angle: float = Field(default=24.44, ge=-180, le=180)  # Extrusion direction: degrees from straight-down towards the right.


class KeepClear(Strict):
    """The title moves aside so no person comes within `gap` of its letters (frame heights). The move itself is ordinary
    x/y keyframes; this only remembers the settings and the position keys from before, so it can be redone or removed."""
    gap: float = Field(default=0.04, ge=0, le=0.15)
    direction: Literal['auto', 'up', 'down', 'left', 'right', 'side'] = 'auto'  # side: left or right, whichever is shorter.
    max_move: float = Field(default=0.35, ge=0.02, le=0.8)  # Frame heights (up/down) or widths (left/right).
    who: Optional[CutoutPick] = None  # The people kept clear of; None: everyone.
    x: float = 0.5  # The position and keys before the move.
    y: float = 0.5
    x_keys: Optional[List[Keyframe]] = Field(default=None, max_length=2000)
    y_keys: Optional[List[Keyframe]] = Field(default=None, max_length=2000)


class Karaoke(Strict):
    """Words light up as they are sung: `words` holds when each word starts, in the title's own seconds."""
    color: str = Field(default='#ffd54a', pattern=r'^#[0-9a-fA-F]{6}$')
    words: List[float] = Field(default_factory=list, max_length=200)
    # The sung word glows in `color`, as strongly as the song is loud: `levels` holds 0..GLOW_LEVELS-1, GLOW_RATE a
    # second through the title (karaoke_states). Empty: a steady glow.
    glow: bool = False
    levels: List[Annotated[int, Field(ge=0, le=2)]] = Field(default_factory=list, max_length=6000)

    @model_validator(mode='after')
    def ordered(self):
        if any(b < a for a, b in zip(self.words, self.words[1:])):
            raise ValueError('Karaoke word times must not go backwards.')
        return self


class StayWith(Strict):
    """The title stays with moving people: it keeps its distance from them and grows as they come nearer. The move is
    ordinary x, y and size keyframes; this remembers the moment it was set at and the position, size and keys from before."""
    at: float = Field(ge=0)  # The title's own seconds.
    x: float = 0.5
    y: float = 0.5
    scale: float = Field(default=1, gt=0)
    x_keys: Optional[List[Keyframe]] = Field(default=None, max_length=2000)
    y_keys: Optional[List[Keyframe]] = Field(default=None, max_length=2000)
    scale_keys: Optional[List[Keyframe]] = Field(default=None, max_length=2000)


class TitlePin(Strict):
    """Locks the title to the scene in a clip: it keeps its place in the world as that clip's camera moves."""
    clip_id: str = Field(min_length=1, max_length=64)
    at: float = Field(ge=0)  # Timeline seconds where the title is placed as it is drawn.
    # Placed in the scene: the spot it sits on (x, y of the source picture, 0..1) and what kind of surface that is. The
    # track then follows that surface only: floor and wall in perspective, upright and sky only panning and turning.
    region: Optional[Tuple[float, float]] = None
    surface: Optional[Literal['floor', 'wall', 'upright', 'sky']] = None


class ChartRow(Strict):
    label: str = Field(min_length=1, max_length=60)
    value: float = Field(ge=-1_000_000_000_000, le=1_000_000_000_000)


class TimelinePoint(Strict):
    date: str = Field(min_length=1, max_length=120)
    label: str = Field(default='', max_length=300)


class MapPlace(Strict):
    name:str=Field(min_length=1,max_length=120)
    lat:float=Field(ge=-85,le=85,allow_inf_nan=False)
    lon:float=Field(ge=-180,le=180,allow_inf_nan=False)


class ExplainerGraphic(Strict):
    """Editable explainer artwork; every coordinate is a share of the output frame."""
    kind: Literal['arrow-straight', 'arrow-curved', 'circle', 'box', 'callout', 'spotlight', 'outline', 'lower-third', 'count-up', 'chapter-card', 'bar-chart', 'line-chart', 'pie-chart', 'step-list', 'timeline-bar', 'icon', 'compare-divider', 'map', 'source']
    style: Literal['clean', 'hand-drawn', 'neon', 'documentary', 'dark-band', 'bold-colour'] = 'clean'
    from_: Tuple[float, float] = Field(alias='from')
    to: Tuple[float, float]
    width: float = Field(default=0.24, ge=0.03, le=1)
    height: float = Field(default=0.18, ge=0.03, le=1)
    line_width: float = Field(default=0.006, ge=0.001, le=0.04)
    # Spotlight: how dark the rest of the frame goes.
    dim: float = Field(default=0.6, ge=0.1, le=0.95)
    # Glow outline: the object's edge, found once by Click to choose, as frame shares around `to`.
    shape: Optional[List[Tuple[float, float]]] = Field(default=None, min_length=3, max_length=200)
    role: Optional[str] = Field(default=None, max_length=160)
    count_from: int = Field(default=0, ge=-999_999_999_999, le=999_999_999_999)
    count_to: int = Field(default=2000, ge=-999_999_999_999, le=999_999_999_999)
    label: Optional[str] = Field(default=None, max_length=120)
    prefix: str = Field(default='', max_length=20)
    suffix: str = Field(default='', max_length=20)
    indian_grouping: bool = False
    tamil_numerals: bool = False
    card_mode: Literal['full', 'corner'] = 'full'
    data: Optional[List[ChartRow]] = None
    chart_orientation: Literal['horizontal', 'vertical'] = 'horizontal'
    highlight_index: Optional[int] = Field(default=None, ge=0, le=11)
    show_values: bool = True
    donut: bool = False
    steps: Optional[List[Annotated[str, Field(min_length=1, max_length=300)]]] = Field(default=None, min_length=2, max_length=8)
    step_times: Optional[List[Annotated[float, Field(ge=0, allow_inf_nan=False)]]] = Field(default=None, max_length=8)
    step_bullets: bool = False
    highlight_current: bool = True
    points: Optional[List[TimelinePoint]] = Field(default=None, min_length=2, max_length=8)
    timeline_vertical: bool = False
    icon: Literal['pin', 'warning', 'tick', 'cross', 'question', 'star', 'heart', 'trend-up', 'trend-down'] = 'pin'
    icon_badge: bool = False
    # Before / after split: the divider and labels are drawn here; `compare_clip` (an overlay clip) shows only to its right.
    compare_clip: Optional[str] = Field(default=None, min_length=1, max_length=64)
    split_from: float = Field(default=1.0, ge=0, le=1)   # Divider position across the frame when the clip starts.
    split_to: float = Field(default=.5, ge=0, le=1)      # Where it settles.
    split_delay: float = Field(default=.3, ge=0, le=60, allow_inf_nan=False)
    split_move: float = Field(default=1.2, gt=0, le=10, allow_inf_nan=False)
    before_label: str = Field(default='முன்', max_length=40)
    after_label: str = Field(default='பின்', max_length=40)
    map_places:Optional[List[MapPlace]]=Field(default=None,min_length=1,max_length=8)
    map_region:Literal['world','india','tamil-nadu']='india'
    map_route:bool=True
    map_zoom:bool=True

    @field_validator('from_', 'to')
    @classmethod
    def point_in_frame(cls, point):
        if any(value < 0 or value > 1 for value in point):
            raise ValueError('Graphic points must be inside the frame.')
        return point

    @field_validator('shape')
    @classmethod
    def shape_in_frame(cls, shape):
        if shape is not None and any(value < -0.05 or value > 1.05 for point in shape for value in point):
            raise ValueError('The outline must be inside the frame.')
        return shape

    @model_validator(mode='after')
    def outline_has_shape(self):
        if self.kind=='map' and (not self.map_places or any(not place.name.strip() for place in self.map_places)):
            raise ValueError('Add 1–8 places as name, latitude, longitude.')
        if self.kind == 'outline' and not self.shape:
            raise ValueError('A glow outline needs the outline of something: right-click on it in the preview.')
        if self.kind == 'step-list':
            if not self.steps or any(not step.strip() for step in self.steps):
                raise ValueError('Add 2–8 steps, one per line.')
            if self.step_times and (len(self.step_times) > len(self.steps) or any(b <= a for a, b in zip(self.step_times, self.step_times[1:]))):
                raise ValueError('Step times must increase, with one time per step.')
        if self.kind == 'compare-divider' and not self.compare_clip:
            raise ValueError('A before / after split needs the clip it reveals.')
        if self.kind == 'timeline-bar' and (not self.points or any(not point.date.strip() for point in self.points)):
            raise ValueError('Add 2–8 points as date, label.')
        if self.kind in ('bar-chart', 'line-chart', 'pie-chart'):
            if not self.data:
                raise ValueError('Add at least one row as label, value.')
            if self.kind == 'bar-chart' and len(self.data) > 8:
                raise ValueError('A bar chart can have up to 8 rows.')
            if self.kind == 'line-chart' and len(self.data) > 12:
                raise ValueError('A line chart can have up to 12 points.')
            if self.kind == 'pie-chart':
                if len(self.data) > 6:
                    raise ValueError('A pie chart can have up to 6 slices.')
                if any(row.value <= 0 for row in self.data):
                    raise ValueError('Pie values must be greater than zero.')
            if self.highlight_index is not None and self.highlight_index >= len(self.data):
                raise ValueError('The highlighted bar must be one of the data rows.')
        return self


class LayoutOriginal(Strict):
    """A lyric line's own place and look before a one-click lyric layout (lyric-layouts.ts), so Original can put it back."""
    position: Literal['top', 'center', 'bottom'] = 'bottom'
    align: Literal['left', 'center', 'right'] = 'center'
    style: Literal['outline', 'shadow', 'band', 'plain'] = 'band'
    size: int = Field(default=44, ge=8, le=100)
    transform: Transform = Field(default_factory=Transform)
    own: List[Annotated[str, Field(min_length=1, max_length=40)]] = Field(default_factory=list, max_length=80)


class Text(Strict):
    id: str = Field(min_length=1, max_length=64)
    source:Optional[str]=Field(default=None,max_length=500)
    layout_original: Optional[LayoutOriginal] = None  # Set by a lyric layout; Original puts it back.
    # Settings this item sets for itself, over its layer's style (Layer.style). Names of the item's own fields.
    own: List[Annotated[str, Field(min_length=1, max_length=40)]] = Field(default_factory=list, max_length=80)
    start: float = Field(ge=0)
    length_: float = Field(gt=0, alias='length')
    text: str = Field(min_length=1, max_length=500)
    style: Literal['outline', 'shadow', 'band', 'plain'] = 'band'  # plain: no outline, shadow or box (for text on white).
    position: Literal['top', 'center', 'bottom'] = 'bottom'
    color: str = Field(default='#ffffff', pattern=r'^#[0-9a-fA-F]{6}$')
    size: int = Field(default=44, ge=8, le=100)  # Credit lines may be small; the editor's slider starts at 20.
    enter: Optional[Animation] = None
    exit: Optional[Animation] = None
    transform: Transform = Field(default_factory=Transform)  # Moves the whole title from where `position` puts it.
    glint: bool = False
    depth: Optional[TitleDepth] = None
    pin: Optional[TitlePin] = None
    keep_clear: Optional[KeepClear] = None
    stay_with: Optional[StayWith] = None
    graphic: Optional[ExplainerGraphic] = None
    karaoke: Optional[Karaoke] = None
    # credits: one title holds a whole credit block; each line is styled by what it is (title_credits in timeline_service).
    layout: Optional[Literal['credits']] = None
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
    # A laid-out title (title_design.py): a bar fading out to the right, a formal bar across the frame, the subtitle
    # overlapping the end of the title, or the title and subtitle in opposite corners. Mirrors TitleDesign in model.ts.
    design: Optional[Literal['gradient', 'formal', 'overlap', 'corners', 'clouds', 'paper', 'torn', 'organic']] = None

    @property
    def designed(self) -> bool:
        return bool(self.subtitle) or self.align != 'center' or self.band_color is not None or bool(self.font) or bool(self.tamil_font) or self.spacing > 0 or self.design is not None or self.karaoke is not None or self.style == 'plain' or self.layout is not None

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
    audio_presets: List[Literal['remove-rumble', 'clearer-voice', 'warmer-music', 'even-out']] = Field(default_factory=list, max_length=4)  # audio_presets.py

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
    ripple: bool = True  # Moves with the main track's edits (inserting, removing, trimming); false stays put.


class VideoLayer(LayerBase):
    kind: Literal['video'] = 'video'
    magnetic: bool = False
    blend: Literal['add', 'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] = 'normal'
    # The layer's style: settings every item takes unless it sets its own (its `own`). Each item already holds the
    # result, so the export needs nothing from here; the editor keeps it to restyle the layer.
    style: Dict[Annotated[str, Field(max_length=40)], object] = Field(default_factory=dict, max_length=80)
    items: List[Clip] = Field(default_factory=list)


class TextLayer(LayerBase):
    kind: Literal['text']
    # The layer's style: settings every item takes unless it sets its own (its `own`). Each item already holds the
    # result, so the export needs nothing from here; the editor keeps it to restyle the layer.
    style: Dict[Annotated[str, Field(max_length=40)], object] = Field(default_factory=dict, max_length=80)
    items: List[Text] = Field(default_factory=list)


class BlurLayer(LayerBase):
    kind: Literal['blur']
    items: List[BlurBox] = Field(default_factory=list)


class CaptionLayer(LayerBase):
    kind: Literal['captions']
    shared_images:bool=False
    style: Literal['outline', 'shadow', 'band'] = 'outline'
    position: Literal['top', 'center', 'bottom'] = 'bottom'
    color: str = Field(default='#ffffff', pattern=r'^#[0-9a-fA-F]{6}$')
    highlight: Optional[str] = Field(default='#ffd400', pattern=r'^#[0-9a-fA-F]{6}$')  # The word being spoken, or None.
    size: int = Field(default=48, ge=20, le=100)
    items: List[Caption] = Field(default_factory=list)


class AdjustItem(Strict):
    """A span of an adjustment layer: its look, colour and glow change everything drawn below it, fading in and out."""
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(default='', max_length=80)
    start: float = Field(ge=0)
    length: float = Field(gt=0, le=86400)
    look: Literal['none', 'warm', 'cool', 'mono', 'vivid', 'film'] = 'none'
    adjust: Adjust = Field(default_factory=Adjust)
    dreamy_glow: Optional[DreamyGlow] = None
    wheels: Optional[ColourWheels] = None
    fade_in: float = Field(default=0.5, ge=0, le=5)
    fade_out: float = Field(default=0.5, ge=0, le=5)


class AdjustLayer(LayerBase):
    kind: Literal['adjust']
    items: List[AdjustItem] = Field(default_factory=list)


class AudioLayer(LayerBase):
    kind: Literal['audio']
    items: List[Sound] = Field(default_factory=list)
    volume: float = Field(default=1, ge=0, le=1.5)  # The whole track's level, multiplied into each sound.


Layer = Annotated[Union[VideoLayer, TextLayer, BlurLayer, AdjustLayer, CaptionLayer, AudioLayer], Field(discriminator='kind')]


class Finish(Strict):
    """A cinematic look over the whole video, under the captions. Each part 0 (off) to 1 (strong)."""
    letterbox: bool = False
    grade: float = Field(default=0, ge=0, le=1)  # Teal shadows, orange highlights.
    glow: float = Field(default=0, ge=0, le=1)
    vignette: float = Field(default=0, ge=0, le=1)
    grain: float = Field(default=0, ge=0, le=1)


class DocumentarySound(Strict):
    enabled:bool=True
    asset_id:str=Field(pattern=r'^[a-f0-9]{32}$')
    duration:float=Field(gt=0,le=10)
    peak:float=Field(ge=0,le=10)


class Timeline(Strict):
    version: Literal[2] = 2
    format: Format = Field(default_factory=Format)
    layers: List[Layer] = Field(default_factory=list)
    normalize_audio: bool = False
    documentary_sound: Optional[DocumentarySound] = None
    sources_roll:bool=False
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
        base=max((item.start + item.length for layer in self.layers if not layer.id.startswith('__source_') for item in layer.items), default=0)
        from app.services.source_graphics import roll_lines,catalog
        lines=roll_lines(catalog(self.model_dump(by_alias=True))) if self.sources_roll else []
        return base+(6+max(0,len(lines)-1)*.8 if lines else 0)


def frame_at(seconds: float, fps: int) -> int:
    """The frame a moment falls on, halves rounded up (as Math.round in the preview, not Python's round to even)."""
    return math.floor(seconds * fps + 0.5)


def clip_frames(clip, fps: int) -> tuple[int, int]:
    """A clip's first frame and how many it covers: from its start's frame to its end's, so clips that meet in seconds
    meet in frames, with no gap or overlap however their lengths round. Matches clipFrames in model.ts."""
    first = frame_at(clip.start, fps)
    return first, max(1, frame_at(clip.start + clip.length, fps) - first)


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
