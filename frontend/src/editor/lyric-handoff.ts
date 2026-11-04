import type { Photo } from '../types/photo.ts';
import type { LyricCue } from '../utils/lyrics.ts';
import type { Animation } from '../timeline/animation.ts';
import { REST_TRANSFORM, type Clip, type TextItem, type Timeline } from '../timeline/model.ts';

export const CREDIT_SECONDS = 3;

type Canvas = 'portrait' | 'square' | 'landscape';
type LyricFont = 'standard' | 'elegant' | 'modern' | 'playful' | 'handwritten';
type LyricAnimation = 'none' | 'fade' | 'slide-up' | 'pop';

type Handoff = {
  name: string;
  backgrounds: Photo[];
  backgroundType: 'image' | 'video';
  duration: number;
  slideStarts: number[];
  song: { id: string; duration: number; name: string };
  cues: LyricCue[];
  canvas: Canvas;
  color: string;
  fontSize: number;
  placement: 'top' | 'center' | 'bottom';
  lyricStyle: 'outline' | 'shadow' | 'band';
  lyricFont: LyricFont;
  lyricAlign: 'left' | 'center' | 'right';
  lyricBandColor: string;
  lyricAnimation: LyricAnimation;
  crossfade: boolean;
  imageAnimation: 'none' | 'zoom-in' | 'pan-left' | 'ken-burns';
};

const formatFor = (canvas: Canvas) => canvas === 'portrait' ? { width: 1080, height: 1920, fps: 30 as const } : canvas === 'square' ? { width: 1080, height: 1080, fps: 30 as const } : { width: 1920, height: 1080, fps: 30 as const };
const fontFor = (font: LyricFont) => ({ elegant: 'Arima', modern: 'Catamaran', playful: 'Baloo Thambi 2', handwritten: 'Kavivanar' } as const)[font as Exclude<LyricFont, 'standard'>] ?? null;
const animationFor = (animation: LyricAnimation): Animation | null => animation === 'none' ? null : { preset: animation, duration: animation === 'fade' ? 0.25 : 0.35 };
const baseClip = (mediaId: number, id: string, length: number): Clip => ({ id, media_id: mediaId, start: 0, in: 0, out: Math.max(.1, length), speed: 1, volume: 0, muted: true, fade_in: 0, fade_out: 0, transform: { ...REST_TRANSFORM }, adjust: { rotation: 0, flip_horizontal: false, flip_vertical: false, brightness: 1, contrast: 1, saturation: 1 } });

function move(clip: Clip, animation: Handoff['imageAnimation'], index: number): Clip {
  if (animation === 'none') return clip;
  const length = clip.out - clip.in;
  const kind = animation === 'ken-burns' ? (index % 2 ? 'pan-left' : 'zoom-in') : animation;
  if (kind === 'zoom-in') return { ...clip, transform: { ...clip.transform, keyframes: { scale: [{ t: 0, v: 1, ease: 'linear' }, { t: length, v: 1.15, ease: 'linear' }] } } };
  return { ...clip, transform: { ...clip.transform, scale: 1.12, keyframes: { x: [{ t: 0, v: .56, ease: 'linear' }, { t: length, v: .44, ease: 'linear' }] } } };
}

export function lyricEditorTimeline(input: Handoff): Timeline {
  const first = input.backgrounds[0];
  const last = input.backgrounds[input.backgrounds.length - 1] ?? first;
  const clips: Clip[] = [baseClip(first.id, 'credit-opening-bg', CREDIT_SECONDS)];
  if (input.backgroundType === 'image') {
    input.backgrounds.forEach((item, index) => {
      const start = input.slideStarts[index] ?? index * input.duration / input.backgrounds.length;
      const end = input.slideStarts[index + 1] ?? input.duration;
      const clip = move(baseClip(item.id, `lyric-scene-${index + 1}`, end - start), input.imageAnimation, index);
      clips.push(index > 0 && input.crossfade ? { ...clip, transition_in: { kind: 'crossfade', duration: Math.min(.8, (end - start) / 2) } } : clip);
    });
  } else {
    const sourceLength = Math.max(.1, first.duration ?? input.duration);
    let left = input.duration; let index = 0;
    while (left > .001) { const length = Math.min(sourceLength, left); clips.push({ ...baseClip(first.id, `lyric-video-${index + 1}`, length), muted: true }); left -= length; index += 1; }
  }
  clips.push(baseClip(last.id, 'credit-closing-bg', CREDIT_SECONDS));
  const family = fontFor(input.lyricFont);
  const enter = animationFor(input.lyricAnimation);
  const lyricItems: TextItem[] = input.cues.map((cue, index) => ({ id: `lyric-line-${index + 1}`, start: CREDIT_SECONDS + cue.start, length: cue.end - cue.start, text: cue.text, style: input.lyricStyle, position: input.placement, color: input.color, size: input.fontSize, enter, exit: input.lyricAnimation === 'fade' ? enter : null, transform: { ...REST_TRANSFORM }, align: input.lyricAlign, band_color: input.lyricStyle === 'band' ? input.lyricBandColor : null, font: family, tamil_font: family }));
  const opening: TextItem = { id: 'opening-credit', start: 0, length: CREDIT_SECONDS, text: input.name, subtitle: 'A lyric video', style: 'shadow', position: 'center', color: '#ffffff', size: 72, enter: { preset: 'fade', duration: .6 }, exit: { preset: 'fade', duration: .4 }, transform: { ...REST_TRANSFORM }, align: 'center' };
  const closing: TextItem = { id: 'closing-credit', start: CREDIT_SECONDS + input.duration, length: CREDIT_SECONDS, text: 'Credits', subtitle: 'Add names and details here', style: 'band', band_color: '#111827', position: 'center', color: '#ffffff', size: 56, enter: { preset: 'fade', duration: .4 }, exit: { preset: 'fade', duration: .4 }, transform: { ...REST_TRANSFORM }, align: 'center' };
  return { version: 2, format: formatFor(input.canvas), layers: [
    { id: 'main', kind: 'video', name: 'Main', magnetic: true, items: clips },
    { id: 'song', kind: 'audio', name: 'Song', items: [{ id: 'lyric-song', asset_id: input.song.id, start: CREDIT_SECONDS, in: 0, out: input.song.duration, speed: 1, volume: 1, muted: false, fade_in: 0, fade_out: 0, duck: false, name: input.song.name, source_length: input.song.duration }] },
    { id: 'lyric-titles', kind: 'text', name: 'Lyrics & credits', items: [opening, ...lyricItems, closing] },
  ] };
}
