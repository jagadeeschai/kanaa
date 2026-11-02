"""The editing timeline, version 2. One document drives preview and export."""
from __future__ import annotations

from typing import Annotated, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_LAYERS = 6  # Phase 1: live preview stays smooth up to 6 video layers.
MAX_ITEMS = 500
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
    scale: float = Field(default=1, gt=0, le=4)
    opacity: float = Field(default=1, ge=0, le=1)
    keyframes: Dict[Literal['x', 'y', 'scale'], List[Keyframe]] = Field(default_factory=dict)

    @model_validator(mode='after')
    def ordered(self):
        for keys in self.keyframes.values():
            if any(b.t <= a.t for a, b in zip(keys, keys[1:])):
                raise ValueError('Keyframes must be in time order.')
        return self

    @property
    def is_default(self) -> bool:
        return (self.x, self.y, self.scale, self.opacity) == (0.5, 0.5, 1, 1) and not self.keyframes


class Adjust(Strict):
    rotation: Literal[0, 90, 180, 270] = 0
    flip_horizontal: bool = False
    flip_vertical: bool = False
    brightness: float = Field(default=1, ge=0.25, le=2)
    contrast: float = Field(default=1, ge=0.25, le=2)
    saturation: float = Field(default=1, ge=0, le=2)


class Clip(Strict):
    """A video or photo on a video layer. `in` and `out` are source seconds, `start` timeline seconds."""
    id: str = Field(min_length=1, max_length=64)
    media_id: int
    start: float = Field(ge=0)
    in_: float = Field(default=0, ge=0, alias='in')
    out: float = Field(gt=0)
    speed: float = Field(default=1, ge=0.25, le=4)
    volume: float = Field(default=1, ge=0, le=2)
    muted: bool = False
    transform: Transform = Field(default_factory=Transform)
    adjust: Adjust = Field(default_factory=Adjust)

    @model_validator(mode='after')
    def valid_range(self):
        if self.out <= self.in_:
            raise ValueError('A clip must end after it starts.')
        return self

    @property
    def length(self) -> float:
        return (self.out - self.in_) / self.speed


class Text(Strict):
    id: str = Field(min_length=1, max_length=64)
    start: float = Field(ge=0)
    length_: float = Field(gt=0, alias='length')
    text: str = Field(min_length=1, max_length=500)
    style: Literal['outline', 'shadow', 'band'] = 'band'
    position: Literal['top', 'center', 'bottom'] = 'bottom'
    color: str = Field(default='#ffffff', pattern=r'^#[0-9a-fA-F]{6}$')
    size: int = Field(default=44, ge=12, le=100)

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
    volume: float = Field(default=1, ge=0, le=2)
    fade_in: float = Field(default=0, ge=0)
    fade_out: float = Field(default=0, ge=0)

    @model_validator(mode='after')
    def one_source(self):
        if (self.asset_id is None) == (self.media_id is None):
            raise ValueError('Sound needs exactly one source.')
        if self.out <= self.in_:
            raise ValueError('Sound must end after it starts.')
        return self

    @property
    def length(self) -> float:
        return self.out - self.in_


class LayerBase(Strict):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(default='', max_length=80)
    hidden: bool = False
    muted: bool = False
    locked: bool = False


class VideoLayer(LayerBase):
    kind: Literal['video'] = 'video'
    magnetic: bool = False
    items: List[Clip] = Field(default_factory=list)


class TextLayer(LayerBase):
    kind: Literal['text']
    items: List[Text] = Field(default_factory=list)


class AudioLayer(LayerBase):
    kind: Literal['audio']
    items: List[Sound] = Field(default_factory=list)


Layer = Annotated[Union[VideoLayer, TextLayer, AudioLayer], Field(discriminator='kind')]


class Timeline(Strict):
    version: Literal[2] = 2
    format: Format = Field(default_factory=Format)
    layers: List[Layer] = Field(default_factory=list)

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
