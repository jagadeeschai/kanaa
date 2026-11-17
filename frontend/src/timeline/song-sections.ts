/**
 * Song sections for lyric videos: the chorus is found from the lyrics themselves (lines sung more than once), so it can
 * look stronger than the verses, and light hits land on its beats. Everything here is ordinary titles and effect clips,
 * so it previews, exports and renders on the GPU like anything else, and one undo takes it back.
 */
import { textLayers, markOwn, updateText, type Clip, type TextItem, type Timeline } from './model.ts';
import { placeEffect } from './drop.ts';

/** Chorus words: bigger, by this much, and popping in word by word. */
export const CHORUS_GROWTH = 1.18;
const CHORUS_ENTER = { preset: 'word-pop' as const, duration: 0.6 };
/** Lines closer than this belong to one section. */
const SECTION_GAP = 3;
/** Light hits: one on the first beat of each chorus, then one every HIT_EVERY beats inside it, at least HIT_SPACING apart. */
export const HIT_EVERY = 8;
const HIT_SPACING = 2;
const HIT_LENGTH = 1.2;
const SNAP = 0.5;  // How far a section start may move to land on a beat.
export const LIGHT_PREFIX = 'beat-light-';
const round = (value: number) => Math.round(value * 1000) / 1000;

const CREDITS = new Set(['opening-credit', 'closing-credit']);
const normal = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

/** The lyric lines of a timeline, in time order: titles that are words, not credits, graphics or laid-out designs. */
export function lyricLines(timeline: Timeline): TextItem[] {
  return textLayers(timeline).filter((layer) => !layer.hidden).flatMap((layer) => layer.items)
    .filter((item) => !CREDITS.has(item.id) && !item.graphic && !item.design && normal(item.text).length > 0)
    .sort((a, b) => a.start - b.start);
}

/** Chorus lines: the lyric lines whose words are sung more than once. None for a song of fewer than four lines. */
export function chorusLines(timeline: Timeline): TextItem[] {
  const lines = lyricLines(timeline);
  if (lines.length < 4) return [];
  const count = new Map<string, number>();
  for (const line of lines) count.set(normal(line.text), (count.get(normal(line.text)) ?? 0) + 1);
  return lines.filter((line) => (count.get(normal(line.text)) ?? 0) >= 2);
}

/** Each chorus as [start, end] in timeline seconds: its lines, joined where the gap between them is short. */
export function chorusSections(timeline: Timeline): [number, number][] {
  const sections: [number, number][] = [];
  for (const line of chorusLines(timeline)) {
    const last = sections[sections.length - 1];
    if (last && line.start - last[1] <= SECTION_GAP) last[1] = Math.max(last[1], line.start + line.length);
    else sections.push([line.start, line.start + line.length]);
  }
  return sections;
}

/** Chorus lines bigger and popping in word by word (on a karaoke line, as each word is sung). Already styled lines stay. */
export function styleChorus(timeline: Timeline): { timeline: Timeline; styled: number } {
  let next = timeline; let styled = 0;
  for (const line of chorusLines(timeline)) {
    if (line.enter?.preset === CHORUS_ENTER.preset) continue;
    // A cinematic line keeps its flight in; it still grows.
    const changes: Partial<TextItem> = { size: Math.min(100, Math.round(line.size * CHORUS_GROWTH)), ...(line.depth ? {} : { enter: CHORUS_ENTER }) };
    next = markOwn(updateText(next, line.id, changes), line.id, changes);
    styled += 1;
  }
  return { timeline: next, styled };
}

export type Hit = { at: number; strong: boolean };

/** When the light hits land: each chorus's first beat (or its start, with no beat near) strongest, then every HIT_EVERY beats. */
export function hitTimes(sections: [number, number][], beats: number[]): Hit[] {
  const sorted = [...beats].sort((a, b) => a - b);
  const hits: Hit[] = [];
  for (const [start, end] of sections) {
    const near = sorted.filter((beat) => Math.abs(beat - start) <= SNAP).sort((a, b) => Math.abs(a - start) - Math.abs(b - start))[0];
    const first = near ?? start;
    const inside = sorted.filter((beat) => beat >= first - 1e-6 && beat < end - 0.5);
    const wanted = [first, ...inside.filter((_, index) => index > 0 && index % HIT_EVERY === 0)];
    wanted.forEach((at, index) => { if (!hits.length || at - hits[hits.length - 1].at >= HIT_SPACING) hits.push({ at: round(at), strong: index === 0 }); });
  }
  return hits;
}

const isHit = (clip: Clip) => clip.id.startsWith(LIGHT_PREFIX);

/** Earlier light hits taken away (and an Effects layer they alone filled), so placing them again doesn't double them. */
export function removeLightHits(timeline: Timeline): Timeline {
  const layers = timeline.layers.flatMap((layer) => {
    if (layer.kind !== 'video' || !layer.items.some(isHit)) return [layer];
    const items = layer.items.filter((clip) => !isHit(clip));
    return items.length ? [{ ...layer, items }] : [];
  });
  return { ...timeline, layers };
}

/** How long before the beat a hit starts, so the light's rise peaks on the beat. */
export const HIT_LEAD = 0.35;
/** How bright the hits are: the first of each chorus, and the rest. Strong enough to feel, never washing out the words. */
export const HIT_STRONG = 0.75, HIT_SOFT = 0.4;

/** A short flash of `effect` (a light effect clip, screen-blended on the Effects layer) peaking on each hit. `peak`: the
 * second of the effect where its light is brightest. */
export function placeLightHits(timeline: Timeline, effect: Clip, hits: Hit[], peak: number, newId: () => string): Timeline {
  let next = removeLightHits(timeline);
  const from = Math.max(0, peak - HIT_LEAD);
  const length = Math.min(HIT_LENGTH, effect.out - from);
  for (const { at, strong } of hits) {
    const lead = Math.min(peak - from, at);  // At the very start of the video there is less room before the beat.
    const clip: Clip = { ...effect, id: `${LIGHT_PREFIX}${newId()}`, start: round(at - lead), in: round(peak - lead), out: round(from + length), muted: true, fade_in: 0, fade_out: 0.2,
      transform: { ...effect.transform, opacity: strong ? HIT_STRONG : HIT_SOFT } };
    next = placeEffect(next, clip, newId());
  }
  return next;
}
