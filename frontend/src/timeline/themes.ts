import type { LookName, Transition } from './animation.ts';
import { applyMove, type MovePreset } from './presets.ts';
import { clipLength, duration, mainLayer, textLayers, type Clip, type TextItem, type TextLayer, type Timeline } from './model.ts';
import type { TitleLook } from './templates.ts';

/**
 * A theme dresses the whole video in one go, like iMovie's: one colour look on every clip, one transition between
 * them, gentle movement on photos, an opening title with the project's name, an ending card, and the theme's fonts
 * and colours on titles already there. Choosing another theme replaces it; the person's own words stay.
 */
export type Theme = {
  id: string; label: string; tamil: string; about: string;
  look: LookName; transition: Transition | null; photos: MovePreset | null;
  opener: TitleLook; closer: TitleLook;
  /** For titles already in the video: their fonts and colours change, their words and places don't. */
  titles: Pick<TextItem, 'font' | 'tamil_font' | 'color' | 'style' | 'band_color' | 'subtitle_color'>;
  swatch: [string, string];
};

const fade = (duration: number) => ({ preset: 'fade' as const, duration });

export const THEMES: Theme[] = [
  { id: 'wedding', label: 'Wedding', tamil: 'திருமணம்', about: 'Warm and soft, slow crossfades', look: 'warm', transition: { kind: 'crossfade', duration: 0.9 }, photos: 'push-in', swatch: ['#7a4b2a', '#e8c48a'],
    opener: { font: 'Snell Roundhand', tamil_font: 'Arima', text: 'Our wedding', subtitle: 'WITH LOVE', subtitle_size: 28, subtitle_spacing: 8, subtitle_color: '#f3dfb0', style: 'shadow', position: 'center', color: '#ffffff', size: 84, enter: fade(1), exit: fade(0.8) },
    closer: { font: 'Snell Roundhand', tamil_font: 'Arima', text: 'நன்றி', subtitle: 'Thank you for being with us', subtitle_size: 28, subtitle_color: '#f3dfb0', style: 'shadow', position: 'center', color: '#ffffff', size: 76, enter: fade(0.8), exit: fade(0.8) },
    titles: { font: 'Snell Roundhand', tamil_font: 'Arima', color: '#ffffff', style: 'shadow', subtitle_color: '#f3dfb0' } },
  { id: 'festival', label: 'Festival', tamil: 'திருவிழா', about: 'Bright colours, lively zooms', look: 'vivid', transition: { kind: 'zoom', duration: 0.5 }, photos: 'punch-in', swatch: ['#c2410c', '#facc15'],
    opener: { font: 'Futura', tamil_font: 'Baloo Thambi 2', text: 'Happy festival', subtitle: 'இனிய வாழ்த்துகள்', subtitle_size: 36, subtitle_color: '#ffffff', style: 'outline', position: 'center', color: '#facc15', size: 76, enter: { preset: 'pop', duration: 0.5 }, exit: fade(0.4) },
    closer: { font: 'Futura', tamil_font: 'Baloo Thambi 2', text: 'நன்றி', subtitle: 'See you next year', subtitle_size: 32, subtitle_color: '#ffffff', style: 'outline', position: 'center', color: '#facc15', size: 72, enter: { preset: 'pop', duration: 0.5 }, exit: fade(0.4) },
    titles: { font: 'Futura', tamil_font: 'Baloo Thambi 2', color: '#facc15', style: 'outline', subtitle_color: '#ffffff' } },
  { id: 'travel', label: 'Travel', tamil: 'பயணம்', about: 'Film colours, sliding cuts', look: 'film', transition: { kind: 'slide', duration: 0.5 }, photos: 'push-in', swatch: ['#0f4c5c', '#e9c46a'],
    opener: { font: 'DIN Condensed', tamil_font: 'Catamaran', text: 'On the road', subtitle: 'A TRAVEL STORY', subtitle_size: 28, subtitle_spacing: 10, subtitle_color: '#e9c46a', style: 'shadow', position: 'center', color: '#ffffff', size: 88, enter: { preset: 'slide-up', duration: 0.6 }, exit: fade(0.5) },
    closer: { font: 'DIN Condensed', tamil_font: 'Catamaran', text: 'Until the next trip', subtitle: 'அடுத்த பயணம் வரை', subtitle_size: 30, subtitle_color: '#e9c46a', style: 'shadow', position: 'center', color: '#ffffff', size: 64, enter: { preset: 'slide-up', duration: 0.6 }, exit: fade(0.5) },
    titles: { font: 'DIN Condensed', tamil_font: 'Catamaran', color: '#ffffff', style: 'shadow', subtitle_color: '#e9c46a' } },
  { id: 'birthday', label: 'Birthday', tamil: 'பிறந்தநாள்', about: 'Playful pops and quick whips', look: 'vivid', transition: { kind: 'whip', duration: 0.4 }, photos: 'punch-in', swatch: ['#db2777', '#a78bfa'],
    opener: { font: 'Marker Felt', tamil_font: 'Baloo Thambi 2', text: 'Happy birthday!', subtitle: 'பிறந்தநாள் வாழ்த்துகள்', subtitle_size: 34, subtitle_color: '#ffffff', style: 'band', band_color: '#db2777', position: 'center', color: '#ffffff', size: 72, enter: { preset: 'bounce', duration: 0.7 }, exit: fade(0.4) },
    closer: { font: 'Marker Felt', tamil_font: 'Baloo Thambi 2', text: 'Make a wish!', subtitle: 'With love', subtitle_size: 30, subtitle_color: '#ffffff', style: 'band', band_color: '#7c3aed', position: 'center', color: '#ffffff', size: 68, enter: { preset: 'pop', duration: 0.5 }, exit: fade(0.4) },
    titles: { font: 'Marker Felt', tamil_font: 'Baloo Thambi 2', color: '#ffffff', style: 'band', band_color: '#db2777', subtitle_color: '#ffffff' } },
  { id: 'memories', label: 'Memories', tamil: 'நினைவுகள்', about: 'Faded film, gentle fades to black', look: 'film', transition: { kind: 'dip', duration: 1 }, photos: 'pull-out', swatch: ['#3f3a36', '#c9b79c'],
    opener: { font: 'Georgia', tamil_font: 'Kavivanar', text: 'நினைவுகள்', subtitle: 'Memories', subtitle_size: 30, subtitle_spacing: 4, subtitle_color: '#e7dcc8', style: 'shadow', position: 'center', color: '#ffffff', size: 72, enter: fade(1.2), exit: fade(1) },
    closer: { font: 'Georgia', tamil_font: 'Kavivanar', text: 'Forever in our hearts', subtitle: 'என்றும் நம் நினைவில்', subtitle_size: 30, subtitle_color: '#e7dcc8', style: 'shadow', position: 'center', color: '#ffffff', size: 56, enter: fade(1), exit: fade(1) },
    titles: { font: 'Georgia', tamil_font: 'Kavivanar', color: '#ffffff', style: 'shadow', subtitle_color: '#e7dcc8' } },
  { id: 'vlog', label: 'Vlog', tamil: 'வ்லாக்', about: 'Cool and punchy, fast cuts', look: 'cool', transition: { kind: 'whip', duration: 0.3 }, photos: 'punch-in', swatch: ['#0f172a', '#38bdf8'],
    opener: { font: 'Impact', tamil_font: 'Baloo Thambi 2', text: 'TODAY’S VLOG', subtitle: 'Watch till the end', subtitle_size: 30, subtitle_color: '#0f172a', style: 'band', band_color: '#38bdf8', position: 'center', color: '#0f172a', size: 76, enter: { preset: 'pop', duration: 0.4 }, exit: fade(0.3) },
    closer: { font: 'Impact', tamil_font: 'Baloo Thambi 2', text: 'SUBSCRIBE', subtitle: '@yourchannel', subtitle_size: 30, subtitle_color: '#0f172a', style: 'band', band_color: '#38bdf8', position: 'center', color: '#0f172a', size: 72, enter: { preset: 'pop', duration: 0.4 }, exit: fade(0.3) },
    titles: { font: 'Impact', tamil_font: 'Baloo Thambi 2', color: '#0f172a', style: 'band', band_color: '#38bdf8', subtitle_color: '#0f172a' } },
  { id: 'classic', label: 'Classic', tamil: 'கிளாசிக்', about: 'Black and white, simple crossfades', look: 'mono', transition: { kind: 'crossfade', duration: 0.7 }, photos: 'push-in', swatch: ['#111111', '#d4d4d4'],
    opener: { font: 'Didot', tamil_font: 'Arima', text: 'A story', subtitle: 'IN BLACK AND WHITE', subtitle_size: 26, subtitle_spacing: 10, subtitle_color: '#d4d4d4', style: 'shadow', position: 'center', color: '#ffffff', size: 84, enter: fade(1), exit: fade(0.8) },
    closer: { font: 'Didot', tamil_font: 'Arima', text: 'The end', subtitle: 'முற்றும்', subtitle_size: 30, subtitle_color: '#d4d4d4', style: 'shadow', position: 'center', color: '#ffffff', size: 72, enter: fade(1), exit: fade(1) },
    titles: { font: 'Didot', tamil_font: 'Arima', color: '#ffffff', style: 'shadow', subtitle_color: '#d4d4d4' } },
];

const THEME_LAYER = 'Theme';
const OPENER_SECONDS = 3.5;
const CLOSER_SECONDS = 3;

/** The theme layer holds the opening and ending titles, so a new theme can replace them without touching other titles. */
const isThemeLayer = (layer: { kind: string; name?: string }) => layer.kind === 'text' && (layer.name ?? '').startsWith(`${THEME_LAYER} · `);

/** Which theme the video has, if any. */
export function activeTheme(timeline: Timeline): Theme | null {
  const layer = timeline.layers.find(isThemeLayer);
  const label = layer?.name?.slice(THEME_LAYER.length + 3);
  return THEMES.find((theme) => theme.label === label) ?? null;
}

/** The photo moves a theme uses, taking turns so a run of photos doesn't all zoom the same way. */
function photoMove(theme: Theme, index: number): MovePreset | null {
  if (theme.photos === 'push-in' || theme.photos === 'pull-out') return index % 2 ? (theme.photos === 'push-in' ? 'pull-out' : 'push-in') : theme.photos;
  return theme.photos;
}

/**
 * Dresses the video in `theme`. `title` is the opening title's words, usually the project's name; `isPhoto` says which
 * clips are photos, which get gentle movement unless they already move. ids: the theme layer and its two titles.
 */
export function applyTheme(timeline: Timeline, theme: Theme, title: string, isPhoto: (clip: Clip) => boolean, ids: [string, string, string]): Timeline {
  const cleared = removeTheme(timeline);
  const main = mainLayer(cleared);
  const ordered = [...main.items].sort((a, b) => a.start - b.start);
  let photoIndex = 0;
  const clips = main.items.map((clip) => {
    const first = clip.id === ordered[0]?.id;
    const next: Clip = { ...clip, look: theme.look, transition_in: first ? null : theme.transition };
    if (isPhoto(clip) && !next.transform.keyframes?.scale?.length) {
      const move = photoMove(theme, photoIndex++);
      if (move) next.transform = applyMove(next.transform, move, 0, clipLength(clip));
    }
    return next;
  });
  const restyled: Timeline = { ...cleared, layers: cleared.layers.map((layer) => {
    if (layer === main) return { ...main, items: clips };
    if (layer.kind !== 'text') return layer;
    return { ...layer, items: layer.items.map((text) => ({ ...text, ...theme.titles })) };
  }) };
  const total = duration(restyled);
  if (total <= 0) return restyled;
  const openerLength = Math.min(OPENER_SECONDS, total * 0.4);
  const items: TextItem[] = [{ ...theme.opener, text: title.trim() || theme.opener.text, id: ids[1], start: 0, length: round(openerLength) }];
  if (total >= openerLength + CLOSER_SECONDS) items.push({ ...theme.closer, id: ids[2], start: round(total - CLOSER_SECONDS), length: CLOSER_SECONDS });
  const layer: TextLayer = { id: ids[0], kind: 'text', name: `${THEME_LAYER} · ${theme.label}`, items };
  return { ...restyled, layers: [...restyled.layers, layer] };
}

/** Takes the theme off: its titles go, clips return to their own colours with plain cuts. Restyled titles keep their new look. */
export function removeTheme(timeline: Timeline): Timeline {
  const had = activeTheme(timeline);
  const layers = timeline.layers.filter((layer) => !isThemeLayer(layer));
  if (!had) return { ...timeline, layers };
  const main = mainLayer(timeline);
  const themed = (clip: Clip) => clip.look === had.look;
  return { ...timeline, layers: layers.map((layer) => (layer === main ? { ...main, items: main.items.map((clip) => (themed(clip) ? { ...clip, look: 'none' as const, transition_in: null } : clip)) } : layer)) };
}

/** The words of the opening title, so changing theme keeps what the person typed there. */
export function openingWords(timeline: Timeline): string | null {
  const layer = timeline.layers.find(isThemeLayer) as TextLayer | undefined;
  const opener = layer?.items.find((item) => item.start === 0);
  return opener ? opener.text : null;
}

export const themeTextLayers = (timeline: Timeline) => textLayers(timeline).filter(isThemeLayer);
const round = (value: number) => Math.round(value * 1000) / 1000;
