import { Bookmark,Image as ImageIcon,MessageSquareText,Music,Palette,Shuffle,Sparkles,Type,WandSparkles } from 'lucide-react';
import { type Mood } from '../api/client';
import { DRAG_TYPE,encodePayload,setActiveDrag,type DragPayload } from '../timeline/drop';
import { cutoutToken,type Clip } from '../timeline/model';
import type { Photo } from '../types/photo';

export const LEFT_TABS = ['media', 'audio', 'text', 'words', 'transitions', 'effects', 'templates', 'themes', 'ask'] as const;
export const RAIL_BREAK_BEFORE = new Set<string>(['text', 'transitions', 'ask']);
export const LITE_TABS = new Set<string>(['media', 'audio', 'text', 'templates', 'themes']);
export const LEFT_TAB_LABELS: Record<(typeof LEFT_TABS)[number], string> = { media: 'Media', ask: 'Ask AI', templates: 'Stories', themes: 'Themes', transitions: 'Transitions', effects: 'Effects', text: 'Text', audio: 'Audio', words: 'Words' };
export const TAB_ICONS: Record<(typeof LEFT_TABS)[number], React.ReactNode> = { media: <ImageIcon size={17}/>, ask: <Sparkles size={17}/>, templates: <Bookmark size={17}/>, themes: <Palette size={17}/>, transitions: <Shuffle size={17}/>, effects: <WandSparkles size={17}/>, text: <Type size={17}/>, audio: <Music size={17}/>, words: <MessageSquareText size={17}/> };
export const TAB_TIPS: Record<(typeof LEFT_TABS)[number], string> = { media: 'Media — your clips, photos, folders and travel maps', ask: 'Ask AI — describe an edit in words', templates: 'Stories — ready-made stories with music and titles', themes: 'Themes — dress the whole video in one click', transitions: 'Transitions — how clips join each other', effects: 'Effects — clip effects, weather and light overlays, and privacy blur', text: 'Text — titles and captions', audio: 'Audio — music library, songs and whooshes', words: 'Words — transcript, pauses and caption cuts' };
export const QUALITIES = [{ id: 720, label: '720p', note: 'Smallest file' }, { id: 1080, label: '1080p', note: 'Best for most posts' }, { id: 2160, label: '4K', note: 'Slower, larger file' }];
export const ESTIMATED_MB_PER_SECOND_1080 = 1.1;
export const hardwareMbps = (shortSide: number) => ({ 720: 9, 1080: 16, 1440: 28 } as Record<number, number>)[shortSide] ?? (shortSide >= 2160 ? 50 : Math.round(shortSide * 0.015));
export const ZOOM_MIN = 8;
export const ZOOM_MAX = 300;
export const ZOOM_STEP = 1.4;
export const FAST_RATES = [1, 2, 4];
export const MIN_MUSIC_SECONDS = 1;
export const PREVIEW_SHORT_SIDE = 540;
export const RENDERED_ID = -1;
export const CLIP_EFFECT_PRESETS = [
  { id: 'colour-splash', group: 'Stylise', label: 'Colour splash', about: 'Keep one chosen colour while everything else turns monochrome.' },
  { id: 'dreamy-glow', group: 'Stylise', label: 'Dreamy glow', about: 'Soft, warm highlight bloom for weddings and portraits.' },
  { id: 'split-tone', group: 'Stylise', label: 'Split-tone', about: 'Tint shadows and highlights with two colours, keeping the real colours.' },
  { id: 'duotone', group: 'Stylise', label: 'Duotone', about: 'Paint the picture in two colours, dark to light.' },
  { id: 'zoom-blur', group: 'Motion', label: 'Zoom blur', about: 'Streaks rushing towards a centre, like a fast push in.' },
  { id: 'echo', group: 'Motion', label: 'Echo trail', about: 'Ghosts of the last moments trailing movement, for dance and action.' },
  { id: 'tilt-shift', group: 'Lens', label: 'Tilt-shift', about: 'A sharp band with soft blur above and below: a toy-town miniature.' },
  { id: 'mirror', group: 'Shape', label: 'Mirror', about: 'Reflect the left or top half, or all four quarters.' },
  { id: 'kaleidoscope', group: 'Shape', label: 'Kaleidoscope', about: 'Mirrored wedges turning round the centre.' },
  { id: 'beat-pulse', group: 'Motion', label: 'Beat pulse', about: 'A quick camera push synchronized to the music.' },
  { id: 'old-film', group: 'Film', label: 'Old film', about: 'Warm faded stock, grain, scratches and gate weave.' },
  { id: 'glitch', group: 'Signal', label: 'Digital glitch', about: 'RGB separation, broken bands and digital noise.' },
  { id: 'vhs', group: 'Signal', label: 'VHS tape', about: 'Tape jitter, scanlines, softness and analogue noise.' },
  { id: 'raindrops', group: 'Lens', label: 'Raindrops', about: 'Water drops that bend and highlight the picture.' },
  { id: 'lens-dirt', group: 'Lens', label: 'Lens dirt', about: 'Soft optical dirt and dark lens contamination.' },
] as const;
export const FIT_MARGIN = 48;
export const TEXT_SECONDS = 3;
export const TEXT_TYPE_DELAY_MS = 250;
export const CAPTION_FETCHES = 3;
export const STYLE_NAMES: Record<string, string> = { size: 'Size', color: 'Colour', font: 'Font', tamil_font: 'Tamil font', style: 'Style', position: 'Position', enter: 'Enter', exit: 'Exit',
  transform: 'Place and motion', align: 'Alignment', band_color: 'Band colour', design: 'Design', spacing: 'Letter spacing', subtitle_size: 'Subtitle size', subtitle_color: 'Subtitle colour',
  look: 'Look', adjust: 'Colour adjustments', volume: 'Volume', muted: 'Mute', fade_in: 'Fade in', fade_out: 'Fade out' };
export const BRAND_FOLDER = 'Brand';
export const isBrandImage = (item: Photo) => item.media_type === 'image' && (/brand/i.test(item.folder ?? '') || /logo/i.test(item.filename));
export const FREEZE_SECONDS = 2;
export const THUMB_FORMAT = { width: 480, height: 270, fps: 30 };
export const SHAPE_FEATHER = 0.004;
export const voiceKey = (item: { media_id?: number; asset_id?: string }) => (item.asset_id ? `a:${item.asset_id}` : `m:${item.media_id}`);
export const preparedWant = (clip: Clip, fps: number): [boolean, boolean, string, string] | null => {
  const steady = Boolean(clip.stabilise); const backwards = Boolean(clip.reverse) && clip.freeze == null; const cutout = cutoutToken(clip);
  const echo = clip.echo && clip.freeze == null && !cutout ? `${clip.echo.mode}.${clip.echo.trails}.${clip.echo.decay.toFixed(2)}@${Number((fps * clip.speed).toFixed(3))}` : '';
  return steady || backwards || cutout || echo ? [steady, backwards, echo, cutout] : null;
};
export const preparedKey = (id: number, steady: boolean, backwards: boolean, echo: string, cutout: string) => `${id}:${steady ? 1 : 0}:${backwards ? 1 : 0}:${echo}:${cutout}`;
export const MOODS: Mood[] = ['romantic', 'happy', 'birthday', 'calm', 'energetic', 'cinematic', 'inspiring', 'songs'];
export const MOOD_LABELS: Record<Mood, string> = { romantic: 'Romantic', happy: 'Happy', birthday: 'Birthday', calm: 'Calm', energetic: 'Energetic', cinematic: 'Cinematic', inspiring: 'Inspiring', songs: 'Songs' };
export const ON_ITEM = 0.05;
export const MIN_DRAWN_BOX = 0.015;
let idCounter = 0;
export const newId = () => `clip-${Date.now().toString(36)}-${(idCounter += 1)}`;
export const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && ((['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && (target as HTMLInputElement).type !== 'range') || target.isContentEditable || target.getAttribute('role') === 'separator');
export const buttonTakesSpace = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('button') !== null;
export const releaseClickedButton = (event: React.MouseEvent) => { if (event.detail > 0 && document.activeElement instanceof HTMLButtonElement) document.activeElement.blur(); };
export const draggableAs = (payload: DragPayload) => ({
  draggable: true,
  onDragStart: (event: React.DragEvent) => { setActiveDrag(payload); event.dataTransfer.setData(DRAG_TYPE, encodePayload(payload)); event.dataTransfer.effectAllowed = 'copy'; },
  onDragEnd: () => setActiveDrag(null),
});
export const RESTART_MESSAGE = 'Kanaa was updated and needs a restart. Stop it in its terminal with Ctrl+C, then run ./start.sh again.';
export const SHORTCUTS: [string, string][] = [['⌘K', 'Find any action or setting'], ['Space', 'Play or pause'], ['F', 'Full screen preview'], ['S', 'Split at the playhead'], ['Delete', 'Delete the selected item'], ['⌘C / ⌘X / ⌘V', 'Copy, cut, paste at the playhead'], ['⌘D', 'Duplicate'], ['⌥⌘C / ⌥⌘V', 'Copy style, paste style'], ['I / O', 'Trim the clip start or end to the playhead'], ['← →', 'Move one frame (Shift for ten)'], ['J / K / L', 'Back a second, pause, play faster'], ['⌘Z / ⇧⌘Z', 'Undo and redo'], ['?', 'Show this guide']];
