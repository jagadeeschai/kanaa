"""Finishing touches on a lyric video's words: karaoke word times, gentle keep-alive waves for words that stay up,
and a shine across a title. Used by the lyric builder and house style."""
from __future__ import annotations

import unicodedata

def karaoke_words(text: str, length: float) -> list[float]:
    """When each word of a line starts, from the line's own timing: as karaokeWords in model.ts."""
    words = text.split()
    if not words:
        return []
    sung = max(length * 0.6, min(length * 0.85, length - 0.4))
    weights = [max(1, sum(1 for c in word if unicodedata.category(c)[0] in 'LMN')) for word in words]
    total, at, out = sum(weights), 0.0, []
    for weight in weights:
        out.append(round(at, 3)); at += sung * weight / total
    return out


def karaoke(timeline: dict, colour: str = '#ffd54a') -> None:
    """Every lyric line lights its words as they are sung."""
    for layer in timeline['layers']:
        for line in layer['items'] if layer['kind'] == 'text' else []:
            if line['id'].startswith('lyric-line'):
                line['karaoke'] = {'color': colour, 'words': karaoke_words(line['text'], line['length'])}


def wave(length: float, a: float, b: float, period: float) -> list[dict]:
    """Back and forth between a and b every `period` seconds, eased (as titleMoves.ts wave)."""
    keys, at, step = [], 0.0, 0
    while at <= length + 1e-6:
        keys.append({'t': round(min(at, length), 4), 'v': round(b if step % 2 else a, 4), 'ease': 'easeInOut'})
        at += period / 2; step += 1
    return keys


def shine_over(timeline: dict, media_id: int, text_id: str, scale: float = 0.3) -> None:
    """A streak of light across one title's words for as long as it shows (the 5-second shine effect, repeated)."""
    from kanaa_mcp.lyrics import ADJUST  # lyrics imports this module, so it is read when needed.
    text = next((item for layer in timeline['layers'] if layer['kind'] == 'text' for item in layer['items'] if item['id'] == text_id), None)
    if text is None:
        return
    transform = text.get('transform') or {}
    pieces, at = [], 0.0
    while at < text['length'] - 0.05:
        piece = min(5.0, text['length'] - at)
        pieces.append({'id': f'{text_id}-shine-{len(pieces) + 1}', 'media_id': media_id, 'start': round(text['start'] + at, 3), 'in': 0, 'out': round(piece, 3), 'speed': 1,
                       'volume': 0, 'muted': True, 'fade_in': 0, 'fade_out': 0, 'adjust': dict(ADJUST),
                       'transform': {'x': transform.get('x', 0.5), 'y': transform.get('y', 0.5), 'scale': scale, 'opacity': 0.9, 'rotation': 0}})
        at += piece
    layers = timeline['layers']
    after = max(index for index, layer in enumerate(layers) if layer['kind'] == 'video') + 1
    layers.insert(after, {'id': f'{text_id}-shine', 'kind': 'video', 'name': 'Effects', 'blend': 'screen', 'items': pieces})
