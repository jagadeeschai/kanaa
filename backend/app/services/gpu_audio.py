"""Compile the reference audio graph without rasterising the unused video title graph."""
from app.services.timeline_service import Builder


class AudioBuilder(Builder):
    def add_text_layer(self, layer, position, base):
        return base

    def add_caption_layer(self, layer, position, base):
        return base

    def add_blur_layer(self, layer, position, base):
        return base


def compile_audio(timeline, media, audio_asset, folder, prepared=None, masks=None, voices=None):
    # Original timeline/duration, clip-audio processing, mix_tracks and normalisation stay in Builder.
    return AudioBuilder(timeline, media, audio_asset, folder, prepared, masks, voices).build()
