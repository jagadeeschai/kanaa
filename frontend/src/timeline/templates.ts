import type { TextItem } from './model.ts';

/** Everything about a title's look, without its timing. A template is one, with sample words to replace. */
export type TitleLook = Omit<TextItem, 'id' | 'start' | 'length' | 'transform'>;
export type Template = { id: string; label: string; look: TitleLook };

const fade = (duration: number) => ({ preset: 'fade' as const, duration });

/** English fonts are this Mac's own; Tamil ones are bundled with Kanaa (`file`), so the editor can show them too. */
export type FontChoice = { family: string; label: string; file?: string };
export const ENGLISH_FONTS: FontChoice[] = [
  { family: 'Noto Sans', label: 'Standard' }, { family: 'Futura', label: 'Futura' }, { family: 'Gill Sans', label: 'Gill Sans' }, { family: 'Optima', label: 'Optima' },
  { family: 'DIN Condensed', label: 'DIN Condensed' }, { family: 'Impact', label: 'Impact' }, { family: 'Didot', label: 'Didot' }, { family: 'Bodoni 72', label: 'Bodoni' },
  { family: 'Baskerville', label: 'Baskerville' }, { family: 'Georgia', label: 'Georgia' }, { family: 'Rockwell', label: 'Rockwell' }, { family: 'American Typewriter', label: 'Typewriter' },
  { family: 'Copperplate', label: 'Copperplate' }, { family: 'Snell Roundhand', label: 'Script' }, { family: 'SignPainter', label: 'Sign painter' },
  { family: 'Marker Felt', label: 'Marker' }, { family: 'Noteworthy', label: 'Noteworthy' }, { family: 'Chalkduster', label: 'Chalk' },
];
export const TAMIL_FONTS: FontChoice[] = [
  { family: 'Noto Sans Tamil', label: 'Standard', file: 'NotoSansTamil-Bold.ttf' }, { family: 'Hind Madurai', label: 'Hind Madurai', file: 'HindMadurai-Bold.ttf' },
  { family: 'Catamaran', label: 'Catamaran', file: 'Catamaran-Bold.ttf' }, { family: 'Baloo Thambi 2', label: 'Baloo Thambi', file: 'BalooThambi2-Bold.ttf' },
  { family: 'Arima', label: 'Arima', file: 'Arima-Bold.ttf' }, { family: 'Pavanam', label: 'Pavanam', file: 'Pavanam-Regular.ttf' }, { family: 'Kavivanar', label: 'Kavivanar', file: 'Kavivanar-Regular.ttf' },
];

/** Designed to read well in Tamil and English, on phones. Sizes are at a 720-wide frame and grow with the video. */
export const TEMPLATES: Template[] = [
  { id: 'cinematic', label: 'Cinematic', look: { font: 'Futura', tamil_font: 'Arima', text: 'கனவு', subtitle: 'A FILM BY YOU', subtitle_size: 30, subtitle_spacing: 9, subtitle_color: '#d9c7a0', style: 'outline', position: 'center', color: '#ffffff', size: 88, spacing: 14, enter: fade(1), exit: fade(0.6) } },
  { id: 'name-card', label: 'Name card', look: { font: 'Gill Sans', tamil_font: 'Hind Madurai', text: 'Your name', subtitle: 'What you do', style: 'band', band_color: '#7c3aed', align: 'left', position: 'bottom', color: '#ffffff', size: 44, enter: { preset: 'slide-right', duration: 0.5 }, exit: fade(0.3) } },
  { id: 'festival', label: 'Festival', look: { font: 'Futura', tamil_font: 'Baloo Thambi 2', text: 'Happy Pongal', subtitle: 'இனிய பொங்கல் வாழ்த்துகள்', subtitle_size: 36, subtitle_color: '#ffffff', style: 'outline', position: 'center', color: '#ffd400', size: 60, enter: { preset: 'pop', duration: 0.6 }, exit: fade(0.4) } },
  { id: 'chapter', label: 'Chapter', look: { font: 'Futura', tamil_font: 'Catamaran', text: 'The journey', subtitle: 'PART 1', subtitle_above: true, subtitle_spacing: 8, subtitle_color: '#f5a623', style: 'outline', position: 'center', color: '#ffffff', size: 80, enter: { preset: 'slide-up', duration: 0.7 }, exit: fade(0.4) } },
  { id: 'quote', label: 'Quote', look: { font: 'Georgia', tamil_font: 'Kavivanar', text: '“Dream big, start small.”', subtitle: '— Your name', subtitle_size: 28, subtitle_color: '#e5e5e5', style: 'shadow', position: 'center', color: '#ffffff', size: 40, enter: fade(0.8), exit: fade(0.5) } },
  { id: 'location', label: 'Location', look: { font: 'DIN Condensed', tamil_font: 'Catamaran', text: 'Kodaikanal', subtitle: '12 March', style: 'shadow', align: 'right', position: 'top', color: '#ffffff', size: 40, enter: { preset: 'slide-left', duration: 0.5 }, exit: fade(0.3) } },
  { id: 'bold-reel', label: 'Bold reel', look: { font: 'Impact', tamil_font: 'Baloo Thambi 2', text: 'WAIT FOR IT…', style: 'band', band_color: '#ef4444', position: 'center', color: '#ffffff', size: 72, enter: { preset: 'pop', duration: 0.4 }, exit: fade(0.3) } },
  { id: 'minimal', label: 'Minimal', look: { font: 'Optima', tamil_font: 'Pavanam', text: 'Simple and clean', style: 'shadow', position: 'bottom', color: '#ffffff', size: 34, enter: fade(0.4), exit: fade(0.4) } },
  { id: 'news', label: 'News', look: { text: 'Big news today', subtitle: 'More details here', subtitle_color: '#facc15', style: 'band', band_color: '#0f172a', align: 'left', position: 'bottom', color: '#ffffff', size: 40, enter: { preset: 'slide-up', duration: 0.4 }, exit: fade(0.3) } },
  { id: 'end-card', label: 'End card', look: { font: 'Snell Roundhand', tamil_font: 'Arima', text: 'Thank you', subtitle: '@yourchannel', subtitle_size: 36, subtitle_color: '#a5b4fc', style: 'outline', position: 'center', color: '#ffffff', size: 80, enter: { preset: 'zoom', duration: 0.6 }, exit: fade(0.5) } },
];

/** The parts of a title that make its look, for saving as a style. Words and timing stay behind. */
export function lookOf(text: TextItem): TitleLook {
  const { id: _id, start: _start, length: _length, transform: _transform, ...look } = text;
  return look;
}

const SAVED_KEY = 'kanaa.titleStyles';
export const MAX_SAVED = 12;

/** Styles the person saved. Kept on this Mac; a missing or broken list is just empty. */
export function savedStyles(): Template[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string' && item.look && typeof item.look.text === 'string') : [];
  } catch { return []; }
}

export function saveStyles(styles: Template[]) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(styles.slice(0, MAX_SAVED))); } catch { /* It just won't be remembered. */ }
}
