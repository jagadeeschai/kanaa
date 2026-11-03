import type { TextItem } from './model.ts';

/** Everything about a title's look, without its timing. A template is one, with sample words to replace. */
export type TitleLook = Omit<TextItem, 'id' | 'start' | 'length' | 'transform'>;
export type Template = { id: string; label: string; look: TitleLook };

const fade = (duration: number) => ({ preset: 'fade' as const, duration });

/** Designed to read well in Tamil and English, on phones. Sizes are at a 720-wide frame and grow with the video. */
export const TEMPLATES: Template[] = [
  { id: 'cinematic', label: 'Cinematic', look: { text: 'கனவு', subtitle: 'A FILM BY YOU', subtitle_spacing: 12, subtitle_color: '#d9c7a0', style: 'shadow', position: 'center', color: '#ffffff', size: 96, enter: fade(1), exit: fade(0.6) } },
  { id: 'name-card', label: 'Name card', look: { text: 'Your name', subtitle: 'What you do', style: 'band', band_color: '#7c3aed', align: 'left', position: 'bottom', color: '#ffffff', size: 44, enter: { preset: 'slide-right', duration: 0.5 }, exit: fade(0.3) } },
  { id: 'festival', label: 'Festival', look: { text: 'Happy Pongal', subtitle: 'இனிய பொங்கல் வாழ்த்துகள்', subtitle_size: 40, subtitle_color: '#ffffff', style: 'outline', position: 'center', color: '#ffd400', size: 80, enter: { preset: 'pop', duration: 0.6 }, exit: fade(0.4) } },
  { id: 'chapter', label: 'Chapter', look: { text: 'The journey', subtitle: 'PART 1', subtitle_above: true, subtitle_spacing: 8, subtitle_color: '#f5a623', style: 'outline', position: 'center', color: '#ffffff', size: 80, enter: { preset: 'slide-up', duration: 0.7 }, exit: fade(0.4) } },
  { id: 'quote', label: 'Quote', look: { text: '“Dream big, start small.”', subtitle: '— Your name', subtitle_size: 30, subtitle_color: '#e5e5e5', style: 'shadow', position: 'center', color: '#ffffff', size: 52, enter: fade(0.8), exit: fade(0.5) } },
  { id: 'location', label: 'Location', look: { text: 'Kodaikanal', subtitle: '12 March', style: 'shadow', align: 'right', position: 'top', color: '#ffffff', size: 40, enter: { preset: 'slide-left', duration: 0.5 }, exit: fade(0.3) } },
  { id: 'bold-reel', label: 'Bold reel', look: { text: 'WAIT FOR IT…', style: 'band', band_color: '#ef4444', position: 'center', color: '#ffffff', size: 72, enter: { preset: 'pop', duration: 0.4 }, exit: fade(0.3) } },
  { id: 'minimal', label: 'Minimal', look: { text: 'Simple and clean', style: 'shadow', position: 'bottom', color: '#ffffff', size: 34, enter: fade(0.4), exit: fade(0.4) } },
  { id: 'news', label: 'News', look: { text: 'Big news today', subtitle: 'More details here', subtitle_color: '#facc15', style: 'band', band_color: '#0f172a', align: 'left', position: 'bottom', color: '#ffffff', size: 40, enter: { preset: 'slide-up', duration: 0.4 }, exit: fade(0.3) } },
  { id: 'end-card', label: 'End card', look: { text: 'Thank you', subtitle: '@yourchannel', subtitle_size: 36, subtitle_color: '#a5b4fc', style: 'outline', position: 'center', color: '#ffffff', size: 80, enter: { preset: 'zoom', duration: 0.6 }, exit: fade(0.5) } },
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
