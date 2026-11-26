/**
 * Hold to compare and hover previews for the editor's preview (kept out of Editor.tsx).
 * - Comparing shows every video clip as it was shot (and no adjustment layers, project LUT or finish): no look, neutral adjustments (rotation and flips kept), no clip
 *   effects, and the original footage instead of any made cinematic copy (sky, halation, shake, slow motion…).
 * - A hovered look chip shows that look on its clip until the pointer leaves.
 */
import { useCallback, useState } from 'react';
import { DEFAULT_ADJUST, type Clip, type Timeline } from '../../timeline/model.ts';
import { originalPart } from '../../timeline/stack.ts';

const MADE = ['colour_match', 'new_sky', 'night', 'rays', 'atmosphere', 'lens', 'halation', 'shake', 'weave', 'breathing', 'slowmo', 'motion_blur'] as const;
const EFFECTS = ['wheels', 'tone_grade', 'dreamy_glow', 'colour_splash', 'old_film', 'signal_damage', 'lens_surface', 'tilt_shift', 'mirror', 'zoom_blur', 'echo', 'chroma', 'beat_pulse'] as const;

/** The clip as shot: the same moment of the original footage, lasting just as long. `has` says whether a media is
 *  still in the project; a made copy whose original is gone is kept, rather than showing nothing. */
export function asShot(clip: Clip, has: (media: number) => boolean = () => true): Clip {
  const plain: Clip = { ...clip, look: undefined, adjust: { ...DEFAULT_ADJUST, rotation: clip.adjust.rotation, flip_horizontal: clip.adjust.flip_horizontal, flip_vertical: clip.adjust.flip_vertical } };
  for (const effect of EFFECTS) (plain as Record<string, unknown>)[effect] = null;
  if (clip.popout && has(clip.popout.original_media_id)) {  // Video pop-out: the scene as it was (its person clip is hidden).
    return { ...plain, media_id: clip.popout.original_media_id, transform: clip.popout.original_transform ?? clip.transform, popout: null };
  }
  if (clip.freeze3d && has(clip.freeze3d.original_media_id)) {  // Time freeze in 3D: the frozen moment, held still.
    return { ...plain, media_id: clip.freeze3d.original_media_id, freeze: clip.freeze3d.at, in: 0, out: (clip.out - clip.in) / clip.speed, speed: 1, freeze3d: null };
  }
  if (!MADE.some((kind) => clip[kind]) || !has(originalPart(clip).media)) return plain;
  const part = originalPart(clip), slower = clip.slowmo?.factor ?? 1;  // Slow motion's copy is `slower` times longer.
  for (const kind of MADE) (plain as Record<string, unknown>)[kind] = null;
  return { ...plain, media_id: part.media, in: part.start + clip.in / slower, out: part.start + clip.out / slower, speed: clip.speed / slower };
}

export function comparedTimeline(timeline: Timeline, comparing: boolean, hover: { clipId: string; look: string } | null, has: (media: number) => boolean = () => true): Timeline {
  if (!comparing && !hover) return timeline;
  if (!comparing) {
    const change = (clip: Clip): Clip => (clip.id === hover!.clipId ? { ...clip, look: hover!.look as Clip['look'] } : clip);
    return { ...timeline, layers: timeline.layers.map((layer) => (layer.kind === 'video' ? { ...layer, items: layer.items.map(change) } : layer)) };
  }
  // The people cut out by Video pop-out: hidden while their scene shows as it was.
  const people = new Set(timeline.layers.flatMap((layer) => (layer.kind === 'video' ? layer.items.flatMap((clip) => (clip.popout && has(clip.popout.original_media_id) ? [clip.popout.person_clip_id] : [])) : [])));
  return { ...timeline, lut: null, finish: null,
    layers: timeline.layers.filter((layer) => layer.kind !== 'adjust').map((layer) => (layer.kind === 'video' ? { ...layer, items: layer.items.filter((clip) => !people.has(clip.id)).map((clip) => asShot(clip, has)) } : layer)) };
}

export function usePreviewCompare() {
  const [comparing, setComparing] = useState(false);
  const [hoverLook, setHoverLook] = useState<{ clipId: string; look: string } | null>(null);
  const previewLook = useCallback((clipId: string, look: string | null) => setHoverLook(look ? { clipId, look } : null), []);
  return { comparing, setComparing, hoverLook, previewLook };
}
