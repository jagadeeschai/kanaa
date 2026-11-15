/**
 * Adjustment layers: a span whose look, colour and glow change everything below it, fading in and out.
 * Mirrors backend/app/services/adjust_layer.py; the preview draws it in playback.ts (drawAdjust).
 */
import { DEFAULT_ADJUST, type AdjustItem, type AdjustLayer, type Adjust, type DreamyGlow, type Timeline } from './model.ts';
import type { LookName } from './animation.ts';

export const ADJUST_SECONDS = 5;
export const DEFAULT_FADE = 0.5;

/** One-click looks for a whole scene. Each sets the span's look, colour and glow from plain defaults. */
export type AdjustPreset = { id: string; label: string; look: LookName; adjust: Partial<Adjust>; dreamy_glow?: DreamyGlow | null };
export const ADJUST_PRESETS: AdjustPreset[] = [
  { id: 'warm', label: 'Warm the whole scene', look: 'warm', adjust: { temperature: 1.08 } },
  { id: 'night', label: 'Cool night', look: 'cool', adjust: { brightness: 0.88, saturation: 0.85, temperature: 0.9 } },
  { id: 'dreamy', label: 'Dreamy', look: 'none', adjust: { fade: 0.05 }, dreamy_glow: { intensity: 0.6, softness: 0.6, warmth: 0.5 } },
  { id: 'film', label: 'Film look', look: 'film', adjust: { fade: 0.06, contrast: 1.05 } },
];

export const adjustLayers = (timeline: Timeline) => timeline.layers.filter((layer): layer is AdjustLayer => layer.kind === 'adjust');

export function findAdjust(timeline: Timeline, id: string | null): { span: AdjustItem; layer: AdjustLayer } | null {
  if (!id) return null;
  for (const layer of adjustLayers(timeline)) {
    const span = layer.items.find((item) => item.id === id);
    if (span) return { span, layer };
  }
  return null;
}

export function newAdjust(id: string, start: number, preset: AdjustPreset = ADJUST_PRESETS[0], length = ADJUST_SECONDS): AdjustItem {
  return { id, name: preset.label, start, length, look: preset.look, adjust: { ...DEFAULT_ADJUST, ...preset.adjust }, dreamy_glow: preset.dreamy_glow ?? null, fade_in: DEFAULT_FADE, fade_out: DEFAULT_FADE };
}

/** The span with a preset applied: its look, colour and glow replaced, its timing kept. */
export const withPreset = (span: AdjustItem, preset: AdjustPreset): AdjustItem =>
  ({ ...span, name: preset.label, look: preset.look, adjust: { ...DEFAULT_ADJUST, ...preset.adjust }, dreamy_glow: preset.dreamy_glow ?? null });

const sorted = (items: AdjustItem[]) => [...items].sort((a, b) => a.start - b.start);
const fits = (layer: AdjustLayer, span: AdjustItem) => layer.items.every((item) => item.start + item.length <= span.start + 1e-6 || span.start + span.length <= item.start + 1e-6);

/** Above every video layer and blur, below text: titles stay as they are. A free adjustment layer is reused. */
export function addAdjust(timeline: Timeline, span: AdjustItem, layerId: string): Timeline {
  const free = adjustLayers(timeline).find((layer) => fits(layer, span));
  if (free) return { ...timeline, layers: timeline.layers.map((layer) => (layer.id === free.id ? { ...free, items: sorted([...free.items, span]) } : layer)) };
  const after = timeline.layers.reduce((last, layer, index) => (['video', 'blur', 'adjust'].includes(layer.kind) ? index : last), 0) + 1;
  const layer: AdjustLayer = { id: layerId, kind: 'adjust', name: 'Adjustment', items: [span] };
  return { ...timeline, layers: [...timeline.layers.slice(0, after), layer, ...timeline.layers.slice(after)] };
}

export function updateAdjust(timeline: Timeline, id: string, changes: Partial<AdjustItem>): Timeline {
  const found = findAdjust(timeline, id);
  if (!found) return timeline;
  const items = found.layer.items.map((item) => (item.id === id ? { ...item, ...changes } : item));
  return { ...timeline, layers: timeline.layers.map((layer) => (layer.id === found.layer.id ? { ...found.layer, items } : layer)) };
}

export function removeAdjust(timeline: Timeline, id: string): Timeline {
  const found = findAdjust(timeline, id);
  if (!found) return timeline;
  const items = found.layer.items.filter((item) => item.id !== id);
  return items.length ? { ...timeline, layers: timeline.layers.map((layer) => (layer.id === found.layer.id ? { ...found.layer, items } : layer)) }
    : { ...timeline, layers: timeline.layers.filter((layer) => layer.id !== found.layer.id) };
}

/** How much of the graded picture shows at time t: as adjust_layer.strength. */
export function adjustStrength(span: AdjustItem, t: number): number {
  const local = t - span.start;
  if (local < 0 || local >= span.length) return 0;
  const fadeIn = Math.min(span.fade_in, span.length / 2); const fadeOut = Math.min(span.fade_out, span.length / 2);
  const up = fadeIn > 0 ? local / fadeIn : 1; const down = fadeOut > 0 ? (span.length - local) / fadeOut : 1;
  return Math.max(0, Math.min(1, up, down));
}
