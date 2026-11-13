/**
 * Copy and paste of timeline items, and copying one item's look onto others (the style painter).
 *
 * A copy keeps each item whole with its layer and its distance from the earliest copied item, so a pasted group keeps
 * its spacing. Main-track clips go back into the main track as one block at the clip edge nearest the paste point
 * (which ripples the rest, as adding a clip does); everything else lands at the paste point plus its distance, on its
 * own layer when that is free there, otherwise on the first free layer of its kind or a new one above.
 */
import {
  addBlur, addOverlay, addSound, addText, clipLength, findBlur, findClip, findSound, findText, insertClip, itemLength, mainLayer, moveItem, trackLayers,
  type BlurBox, type Clip, type Sound, type TextItem, type Timeline,
} from './model.ts';

export type CopiedKind = 'main' | 'overlay' | 'text' | 'blur' | 'sound';
export type Copied = { kind: CopiedKind; layer: string; offset: number; item: Clip | TextItem | BlurBox | Sound };
export type Clipboard = { items: Copied[] };

function locate(timeline: Timeline, id: string): { kind: CopiedKind; layer: string; item: Copied['item'] } | null {
  const main = mainLayer(timeline);
  const onMain = main.items.find((clip) => clip.id === id);
  if (onMain) return { kind: 'main', layer: main.id, item: onMain };
  const clip = findClip(timeline, id);
  if (clip) return { kind: 'overlay', layer: timeline.layers.find((layer) => (layer.items as { id: string }[]).some((item) => item.id === id))!.id, item: clip };
  const text = findText(timeline, id);
  if (text) return { kind: 'text', layer: text.layer.id, item: text.text };
  const blur = findBlur(timeline, id);
  if (blur) return { kind: 'blur', layer: blur.layer.id, item: blur.blur };
  const sound = findSound(timeline, id);
  return sound ? { kind: 'sound', layer: sound.layer.id, item: sound.sound } : null;
}

const lengthOf = (copied: { kind: CopiedKind; item: Copied['item'] }) => copied.kind === 'main' || copied.kind === 'overlay' ? clipLength(copied.item as Clip) : itemLength(copied.item as TextItem);

/** What `ids` hold, in time order. Lyrics captions are not copied (they are rebuilt from the words). */
export function copyItems(timeline: Timeline, ids: string[]): Clipboard | null {
  const found = ids.map((id) => locate(timeline, id)).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  if (!found.length) return null;
  const first = Math.min(...found.map((entry) => entry.item.start));
  const items = found.map((entry) => ({ ...entry, offset: Math.round((entry.item.start - first) * 1000) / 1000, item: structuredClone(entry.item) }))
    .sort((a, b) => a.offset - b.offset);
  return { items };
}

/** Where pasted items start: the end of what was copied, for duplicating. */
export function clipboardEnd(timeline: Timeline, ids: string[]): number {
  return Math.max(0, ...ids.map((id) => locate(timeline, id)).filter((entry) => entry !== null).map((entry) => entry!.item.start + lengthOf(entry!)));
}

/** Pastes at `at` seconds. Returns the timeline and the new items' ids, in clipboard order. */
export function pasteItems(timeline: Timeline, clipboard: Clipboard, at: number, newId: () => string): { timeline: Timeline; ids: string[] } {
  let next = timeline;
  const ids: string[] = [];
  let anchor = Math.max(0, at);
  const mains = clipboard.items.filter((entry) => entry.kind === 'main');
  if (mains.length) {
    // The block goes in at the main-track edge nearest the paste point; the rest are placed from where it starts.
    const clips = mainLayer(next).items;
    let index = clips.findIndex((clip) => clip.start + clipLength(clip) / 2 > at);
    if (index < 0) index = clips.length;
    anchor = index < clips.length ? clips[index].start : clips.reduce((end, clip) => Math.max(end, clip.start + clipLength(clip)), 0);
    mains.forEach((entry, step) => {
      const id = newId();
      // A transition joins a clip to the one before it in the original, which is not what is before it here.
      next = insertClip(next, { ...(structuredClone(entry.item) as Clip), id, transition_in: null }, index + step);
      ids.push(id);
    });
  }
  for (const entry of clipboard.items) {
    if (entry.kind === 'main') continue;
    const id = newId();
    const start = Math.round((anchor + entry.offset) * 1000) / 1000;
    const item = { ...structuredClone(entry.item), id, start };
    const layerId = newId();
    next = entry.kind === 'overlay' ? addOverlay(next, item as Clip, layerId)
      : entry.kind === 'text' ? addText(next, item as TextItem, layerId)
      : entry.kind === 'blur' ? addBlur(next, item as BlurBox, layerId)
      : addSound(next, item as Sound, layerId);
    // Back on its own layer when that is free at this time.
    if (next.layers.some((layer) => layer.id === entry.layer) && !trackLayers(next).find((layer) => layer.id === entry.layer)?.items.some((other) => other.id === id)) {
      const moved = moveItem(next, id, start, entry.layer);
      if (trackLayers(moved).find((layer) => layer.id === entry.layer)?.items.some((other) => other.id === id && Math.abs(other.start - start) < 1e-6)) next = withoutEmptyLayers(moved);
    }
    ids.push(id);
  }
  return { timeline: next, ids };
}

/** A layer made for a pasted item and then left empty when it moved back to its own layer goes. */
const withoutEmptyLayers = (timeline: Timeline): Timeline => ({ ...timeline, layers: timeline.layers.filter((layer, index) => index === 0 || layer.kind === 'captions' || layer.items.length > 0) });

// --- The style painter ---

const TITLE_STYLE = ['design', 'style', 'position', 'color', 'size', 'enter', 'exit', 'transform', 'depth', 'subtitle_size', 'subtitle_color', 'subtitle_above', 'subtitle_spacing',
  'spacing', 'align', 'band_color', 'font', 'tamil_font'] as const;
const CLIP_STYLE = ['transform', 'adjust', 'look', 'enter', 'exit', 'fade_in', 'fade_out', 'transition_in', 'old_film', 'signal_damage', 'lens_surface', 'colour_splash', 'dreamy_glow',
  'beat_pulse', 'tone_grade', 'mirror', 'zoom_blur', 'tilt_shift', 'echo', 'bypass', 'frame_locked'] as const;
const BLUR_STYLE = ['style', 'shape', 'amount', 'width', 'height', 'transform'] as const;
const SOUND_STYLE = ['volume', 'fade_in', 'fade_out', 'duck'] as const;
/** What a title and a clip both have, so a look can go from one to the other. */
const SHARED = ['enter', 'exit', 'transform'];

export type StyleKind = 'title' | 'clip' | 'blur' | 'sound';
export type CopiedStyle = { kind: StyleKind; values: Record<string, unknown> };

const keysOf = (kind: StyleKind): readonly string[] => kind === 'title' ? TITLE_STYLE : kind === 'clip' ? CLIP_STYLE : kind === 'blur' ? BLUR_STYLE : SOUND_STYLE;
const styleKind = (kind: CopiedKind): StyleKind => kind === 'main' || kind === 'overlay' ? 'clip' : kind === 'text' ? 'title' : kind;

/** The look of one item: everything but what it shows, where it sits in time, and how long it is. */
export function copyStyle(timeline: Timeline, id: string): CopiedStyle | null {
  const found = locate(timeline, id);
  if (!found) return null;
  const kind = styleKind(found.kind);
  const item = found.item as Record<string, unknown>;
  return { kind, values: Object.fromEntries(keysOf(kind).filter((key) => key in item).map((key) => [key, structuredClone(item[key])])) };
}

/** The settings of `style` that make sense on `id`: all of them on the same kind, the shared ones across kinds. */
export function styleFor(style: CopiedStyle, kind: StyleKind): string[] {
  if (style.kind === kind) return Object.keys(style.values);
  return (style.kind === 'title' && kind === 'clip') || (style.kind === 'clip' && kind === 'title') ? SHARED.filter((key) => key in style.values) : [];
}

/** Gives each of `ids` the copied look. Items on a layer with a layer style keep these as their own settings. */
export function pasteStyle(timeline: Timeline, style: CopiedStyle, ids: string[]): Timeline {
  let next = timeline;
  for (const id of ids) {
    const found = locate(next, id);
    if (!found) continue;
    const kind = styleKind(found.kind);
    const keys = styleFor(style, kind).filter((key) => !(key === 'transition_in' && (found.kind !== 'main' || mainLayer(next).items[0]?.id === id)));
    if (!keys.length) continue;
    const changes: Record<string, unknown> = Object.fromEntries(keys.map((key) => [key, structuredClone(style.values[key])]));
    const own = (found.item as { own?: string[] }).own;
    if (own && !own.includes('*')) changes.own = [...new Set([...own, ...keys])];
    else if (!own && next.layers.find((layer) => layer.id === found.layer && 'style' in layer && layer.style)) changes.own = keys;
    next = { ...next, layers: next.layers.map((layer) => layer.id !== found.layer ? layer : { ...layer, items: (layer.items as { id: string }[]).map((item) => item.id === id ? { ...item, ...changes } : item) } as typeof layer) };
  }
  return next;
}
