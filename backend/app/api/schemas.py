from typing import Optional, List, Literal
from pydantic import BaseModel, Field, field_validator, model_validator


class LyricSyncRequest(BaseModel):
    audio_asset_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    lyrics: str = Field(min_length=1, max_length=30000)
    language: Optional[str] = Field(default=None, pattern=r"^[a-z]{2,3}$")


class LyricCue(BaseModel):
    model_config = {"allow_inf_nan": False, "extra": "forbid"}
    start: float = Field(ge=0, le=86400)
    end: float = Field(gt=0, le=86400)
    text: str = Field(min_length=1, max_length=500)

    @field_validator("text")
    @classmethod
    def valid_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Lyric lines cannot be blank")
        return value.strip()

    @model_validator(mode="after")
    def valid_interval(self):
        if self.end <= self.start:
            raise ValueError("Lyric end must be after its start")
        return self


class VideoEditRequest(BaseModel):
    model_config = {"allow_inf_nan": False, "extra": "forbid"}
    trim_start: float = Field(default=0, ge=0)
    trim_end: Optional[float] = Field(default=None, gt=0)
    rotation: Literal[0, 90, 180, 270] = 0
    flip_horizontal: bool = False
    flip_vertical: bool = False
    brightness: float = Field(default=1, ge=0.25, le=2)
    contrast: float = Field(default=1, ge=0.25, le=2)
    saturation: float = Field(default=1, ge=0, le=2)
    volume: float = Field(default=1, ge=0, le=1)
    mute: bool = False
    keep_location: bool = False
    audio_asset_id: Optional[str] = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    lyrics: List[LyricCue] = Field(default_factory=list, max_length=500)
    canvas: Literal["original", "portrait", "square", "landscape"] = "original"
    lyric_color: str = Field(default="#ffffff", pattern=r"^#[0-9a-fA-F]{6}$")
    lyric_size: int = Field(default=44, ge=20, le=100)
    lyric_position: Literal["top", "center", "bottom"] = "bottom"
    background_photo_ids: List[int] = Field(default_factory=list, max_length=50)
    image_animation: Literal["none", "zoom-in", "pan-left", "ken-burns"] = "none"
    # When each background image begins, in seconds; empty shares the time evenly.
    slide_starts: List[float] = Field(default_factory=list, max_length=50)
    transition: Literal["none", "crossfade"] = "none"
    quality: Literal["720p", "1080p", "4k"] = "720p"
    lyric_style: Literal["outline", "shadow", "band"] = "outline"
    lyric_animation: Literal["none", "fade", "slide-up", "pop"] = "none"
    lyric_font: Literal["standard", "elegant", "modern", "playful", "handwritten"] = "standard"
    lyric_align: Literal["left", "center", "right"] = "center"
    lyric_band_color: str = Field(default="#000000", pattern=r"^#[0-9a-fA-F]{6}$")
