/**
 * Stacking looks: a new sky, day for night, atmosphere, the cinematic lens and smooth slow motion together on one clip. Each is a
 * made copy (made on the GPU by its service); stacked, each is made from the one before, always in one order, the one
 * that looks right: the sky first, then night falls on the land, the sun's rays, the air in front, the lens over both, slow motion last. Every look on a clip
 * remembers the same original part, so taking any one off rebuilds the rest from it (copies already made come back from
 * the cache at once), and taking the last one off gives the original back exactly.
 */
import { findClip, updateClip, type Clip, type Timeline } from './model.ts';

export type Look =
  | { kind: 'new_sky'; sky: 'sunset' | 'night' | 'storm' | 'blue' }
  | { kind: 'night'; mood: 'moonlit' | 'dark' }
  | { kind: 'rays'; preset: 'soft' | 'strong' | 'dusty' }
  | { kind: 'atmosphere'; preset: 'mist' | 'sunset' | 'rain' | 'low-fog'; strength: 'light' | 'medium' | 'heavy' }
  | { kind: 'lens'; preset: 'portrait' | 'dreamy' | 'rack-out' | 'rack-in'; strength: 'soft' | 'medium' | 'strong' }
  | { kind: 'slowmo'; factor: 2 | 4 | 8 };
export type LookKind = Look['kind'];
export const LOOK_ORDER: LookKind[] = ['new_sky', 'night', 'rays', 'atmosphere', 'lens', 'slowmo'];
export type Part = { media: number; start: number; end: number };
const round = (value: number) => Math.round(value * 1000) / 1000;

/** The looks on a clip, in order. */
export function looksOf(clip: Clip): Look[] {
  const found: Look[] = [];
  if (clip.new_sky) found.push({ kind: 'new_sky', sky: clip.new_sky.sky });
  if (clip.night) found.push({ kind: 'night', mood: clip.night.mood ?? 'moonlit' });
  if (clip.rays) found.push({ kind: 'rays', preset: clip.rays.preset ?? 'soft' });
  if (clip.atmosphere) found.push({ kind: 'atmosphere', preset: clip.atmosphere.preset, strength: clip.atmosphere.strength ?? 'medium' });
  if (clip.lens) found.push({ kind: 'lens', preset: clip.lens.preset, strength: clip.lens.strength ?? 'medium' });
  if (clip.slowmo) found.push({ kind: 'slowmo', factor: clip.slowmo.factor });
  return found;
}

/** The original part every look on the clip is made from (the clip itself when it has none). */
export function originalPart(clip: Clip): Part {
  const link = clip.new_sky ?? clip.night ?? clip.rays ?? clip.atmosphere ?? clip.lens ?? clip.slowmo;
  return link ? { media: link.original_media_id, start: link.original_in, end: link.original_out } : { media: clip.media_id, start: clip.in, end: clip.out };
}

/** The looks with `look` added (or changed, if one of its kind is there), in order. */
export const withLook = (looks: Look[], look: Look): Look[] =>
  [...looks.filter((each) => each.kind !== look.kind), look].sort((a, b) => LOOK_ORDER.indexOf(a.kind) - LOOK_ORDER.indexOf(b.kind));
export const withoutLook = (looks: Look[], kind: LookKind): Look[] => looks.filter((each) => each.kind !== kind);

/** What stops looks from being added to a clip at all. */
export function cannotLook(clip: Clip, kind: LookKind): string | null {
  if (clip.reverse || clip.ramp || clip.freeze != null || clip.freeze3d) return 'These looks work on a clip that plays normally (not reversed, ramped or frozen).';
  if (kind === 'slowmo' && !clip.slowmo && clip.speed !== 1) return 'Set the clip to normal speed first; smooth slow motion makes its own.';
  return null;
}

/** How long the made copy of `part` lasts after `look` (slow motion makes it longer). */
export const lengthAfter = (seconds: number, look: Look) => (look.kind === 'slowmo' ? seconds * look.factor : seconds);

/**
 * Makes the looks one after another, each from the one before, starting from `part`. `make` makes one look of one
 * source part and returns the made media's id. Returns the last made media and how long it lasts (null: no looks).
 */
export async function makeLooks(part: Part, looks: Look[], make: (look: Look, source: Part, step: number) => Promise<number>): Promise<{ media: number; seconds: number } | null> {
  let source = part, seconds = part.end - part.start;
  let made: number | null = null;
  for (const [step, look] of looks.entries()) {
    made = await make(look, source, step);
    seconds = lengthAfter(seconds, look);
    source = { media: made, start: 0, end: round(seconds) };
  }
  return made === null ? null : { media: made, seconds: round(seconds) };
}

/** The clip playing `made` (the looks' last copy), every look remembering the original; or the original itself. */
export function setLooks(timeline: Timeline, clipId: string, part: Part, looks: Look[], made: { media: number; seconds: number } | null): Timeline {
  const clip = findClip(timeline, clipId);
  if (!clip) return timeline;
  const original = { original_media_id: part.media, original_in: part.start, original_out: part.end };
  const has = (kind: LookKind) => looks.find((each) => each.kind === kind);
  const sky = has('new_sky'), dark = has('night'), beams = has('rays'), air = has('atmosphere'), lens = has('lens'), slow = has('slowmo');
  const links: Partial<Clip> = {
    new_sky: sky?.kind === 'new_sky' ? { ...original, sky: sky.sky } : null,
    night: dark?.kind === 'night' ? { ...original, mood: dark.mood } : null,
    rays: beams?.kind === 'rays' ? { ...original, preset: beams.preset } : null,
    atmosphere: air?.kind === 'atmosphere' ? { ...original, preset: air.preset, strength: air.strength } : null,
    lens: lens?.kind === 'lens' ? { ...original, preset: lens.preset, strength: lens.strength } : null,
    slowmo: slow?.kind === 'slowmo' ? { ...original, factor: slow.factor } : null,
  };
  if (!made) return updateClip(timeline, clipId, { media_id: part.media, in: part.start, out: part.end, ...links, ...(clip.slowmo ? { muted: false } : {}) });
  // Slow motion's copy has no sound.
  return updateClip(timeline, clipId, { media_id: made.media, in: 0, out: made.seconds, ...links, ...(slow ? { muted: true } : clip.slowmo ? { muted: false } : {}) });
}
