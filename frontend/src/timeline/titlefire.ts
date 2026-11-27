/**
 * A title on fire: Kanaa makes a looping clip of flames rising from the title's own letters (backend title_fire.py,
 * light on black), and it plays under the title on a Screen-blend "Title fire" layer, repeated for as long as the
 * title shows. The clips are ordinary video, so preview and export match. Putting the fire out removes them (and the
 * layer, once empty). A title moved or retyped afterwards needs its fire made again: the flames follow the letters
 * as they were.
 */
import { DEFAULT_ADJUST, MAX_VIDEO_LAYERS, type Clip, type TextItem, type Timeline, type VideoLayer } from './model.ts';

export type FireStrength = 'glow' | 'blaze' | 'inferno';
export const FIRE_STRENGTHS: { id: FireStrength; label: string; about: string }[] = [
  { id: 'glow', label: 'Glow', about: 'Low flames and a warm glow: for a line that smoulders' },
  { id: 'blaze', label: 'Blaze', about: 'Flames rising from the letters: the title on fire' },
  { id: 'inferno', label: 'Inferno', about: 'Tall, roaring flames: for the biggest moment' },
];
export const FIRE_LAYER = 'title-fire';
const prefix = (textId: string) => `fire-${textId}-`;
const round = (value: number) => Math.round(value * 1000) / 1000;

/** The fire under a title, if it has one: its strength (from the clip's name) and media. */
export function fireOf(timeline: Timeline, textId: string): { strength: FireStrength; media: number } | null {
  const layer = timeline.layers.find((each) => each.id === FIRE_LAYER) as VideoLayer | undefined;
  const clip = layer?.items.find((item) => item.id.startsWith(prefix(textId)));
  if (!clip) return null;
  const strength = FIRE_STRENGTHS.find((each) => clip.name?.endsWith(each.id))?.id ?? 'blaze';
  return { strength, media: clip.media_id };
}

/** The timeline with a title's fire taken off (the layer too, once nothing burns on it). */
export function withoutTitleFire(timeline: Timeline, textId: string): Timeline {
  const layers = timeline.layers.flatMap((layer) => {
    if (layer.id !== FIRE_LAYER) return [layer];
    const items = (layer as VideoLayer).items.filter((item) => !item.id.startsWith(prefix(textId)));
    return items.length ? [{ ...layer, items } as VideoLayer] : [];
  });
  return { ...timeline, layers };
}

/** The timeline with `text` on fire: the loop (`media`, `loop` s long) repeated under it from its start to its end. */
export function withTitleFire(timeline: Timeline, text: TextItem, media: number, loop: number, strength: FireStrength): Timeline {
  const base = withoutTitleFire(timeline, text.id);
  const clips: Clip[] = [];
  for (let at = 0, n = 0; at < text.length - 0.05; at += loop, n += 1) {
    const length = round(Math.min(loop, text.length - at));
    clips.push({ id: `${prefix(text.id)}${n}`, name: `Title fire · ${strength}`, media_id: media, start: round(text.start + at), in: 0, out: length, speed: 1, volume: 0, muted: true,
      fade_in: n === 0 ? 0.5 : 0, fade_out: at + loop >= text.length - 0.05 ? 0.6 : 0, transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 }, adjust: { ...DEFAULT_ADJUST } });
  }
  const existing = base.layers.find((layer) => layer.id === FIRE_LAYER) as VideoLayer | undefined;
  if (existing) {
    const clash = existing.items.find((item) => clips.some((clip) => clip.start < item.start + (item.out - item.in) / item.speed && item.start < clip.start + (clip.out - clip.in)));
    if (clash) throw new Error('Another title is already on fire at this time. Put its fire out, or move one of the titles.');
    return { ...base, layers: base.layers.map((layer) => (layer.id === FIRE_LAYER ? { ...existing, items: [...existing.items, ...clips].sort((a, b) => a.start - b.start) } : layer)) };
  }
  if (base.layers.filter((layer) => layer.kind === 'video').length >= MAX_VIDEO_LAYERS) throw new Error(`Use up to ${MAX_VIDEO_LAYERS} video layers: remove one to set a title on fire.`);
  const layer: VideoLayer = { id: FIRE_LAYER, kind: 'video', name: 'Title fire', blend: 'screen', magnetic: false, ripple: false, items: clips };
  // Just above the main track: the flames sit under the titles (text layers draw over every video layer).
  return { ...base, layers: [base.layers[0], layer, ...base.layers.slice(1)] };
}
