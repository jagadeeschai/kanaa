/**
 * Hold to compare and hover previews for the editor's preview (kept out of Editor.tsx).
 * - Comparing shows every video clip as it was shot: no look, neutral adjustments (rotation and flips kept), no clip
 *   effects, and the original footage instead of any made cinematic copy (sky, halation, shake, slow motion…).
 * - A hovered look chip shows that look on its clip until the pointer leaves.
 */
import { useCallback, useState } from 'react';
import { DEFAULT_ADJUST, type Clip, type Timeline } from '../../timeline/model.ts';
import { originalPart } from '../../timeline/stack.ts';

const MADE = ['colour_match', 'new_sky', 'night', 'rays', 'atmosphere', 'lens', 'halation', 'shake', 'weave', 'breathing', 'slowmo', 'motion_blur'] as const;
const EFFECTS = ['wheels', 'tone_grade', 'dreamy_glow', 'colour_splash', 'old_film', 'signal_damage', 'lens_surface', 'tilt_shift', 'mirror', 'zoom_blur', 'echo', 'chroma'] as const;

/** The clip as shot: the same moment of the original footage, lasting just as long. */
export function asShot(clip: Clip): Clip {
  const plain: Clip = { ...clip, look: undefined, adjust: { ...DEFAULT_ADJUST, rotation: clip.adjust.rotation, flip_horizontal: clip.adjust.flip_horizontal, flip_vertical: clip.adjust.flip_vertical } };
  for (const effect of EFFECTS) (plain as Record<string, unknown>)[effect] = null;
  if (!MADE.some((kind) => clip[kind])) return plain;
  const part = originalPart(clip), slower = clip.slowmo?.factor ?? 1;  // Slow motion's copy is `slower` times longer.
  for (const kind of MADE) (plain as Record<string, unknown>)[kind] = null;
  return { ...plain, media_id: part.media, in: part.start + clip.in / slower, out: part.start + clip.out / slower, speed: clip.speed / slower };
}

export function comparedTimeline(timeline: Timeline, comparing: boolean, hover: { clipId: string; look: string } | null): Timeline {
  if (!comparing && !hover) return timeline;
  const change = (clip: Clip): Clip => (comparing ? asShot(clip) : clip.id === hover!.clipId ? { ...clip, look: hover!.look as Clip['look'] } : clip);
  return { ...timeline, layers: timeline.layers.map((layer) => (layer.kind === 'video' ? { ...layer, items: layer.items.map(change) } : layer)) };
}

export function usePreviewCompare() {
  const [comparing, setComparing] = useState(false);
  const [hoverLook, setHoverLook] = useState<{ clipId: string; look: string } | null>(null);
  const previewLook = useCallback((clipId: string, look: string | null) => setHoverLook(look ? { clipId, look } : null), []);
  return { comparing, setComparing, hoverLook, previewLook };
}
