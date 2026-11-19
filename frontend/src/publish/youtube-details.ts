/**
 * What Kanaa fills in for a YouTube upload, from the project itself: the title, a description from the credits, tags,
 * and the sung lyrics as caption files (the Tamil lines, and the English lines when the lyrics carry a translation).
 */
import type { TextItem, Timeline } from '../timeline/model.ts';

export type CaptionTrack = { language: string; name: string; srt: string };
export type Details = { title: string; description: string; tags: string[]; language: string; captions: CaptionTrack[]; short: boolean };

const TAMIL = /[஀-௿]/;
const SHORT_SECONDS = 180;

function texts(timeline: Timeline): TextItem[] {
  return timeline.layers.flatMap((layer) => layer.kind === 'text' && !layer.hidden ? layer.items as TextItem[] : []);
}

const sung = (timeline: Timeline) => texts(timeline).filter((item) => item.karaoke && item.text.trim()).sort((a, b) => a.start - b.start);

function stamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

/** SRT for lines, each shown from its start until it ends (or until the next line starts, so two never overlap). */
export function toSrt(lines: { start: number; end: number; text: string }[]): string {
  return lines.map((line, index) => {
    const end = Math.min(line.end, lines[index + 1]?.start ?? Infinity);
    return `${index + 1}\n${stamp(line.start)} --> ${stamp(Math.max(end, line.start + 0.1))}\n${line.text.trim().replace(/\n{2,}/g, '\n')}\n`;
  }).join('\n');
}

export function lyricCaptions(timeline: Timeline): CaptionTrack[] {
  const lines = sung(timeline);
  if (!lines.length) return [];
  const own = lines.map((item) => ({ start: item.start, end: item.start + item.length, text: item.text }));
  const tamil = own.some((line) => TAMIL.test(line.text));
  const tracks: CaptionTrack[] = [{ language: tamil ? 'ta' : 'en', name: tamil ? 'தமிழ் வரிகள்' : 'Lyrics', srt: toSrt(own) }];
  const translated = lines.filter((item) => item.subtitle?.trim() && !TAMIL.test(item.subtitle));
  if (tamil && translated.length >= lines.length / 2) {
    tracks.push({ language: 'en', name: 'English', srt: toSrt(translated.map((item) => ({ start: item.start, end: item.start + item.length, text: item.subtitle! }))) });
  }
  return tracks;
}

function credits(timeline: Timeline): string {
  return texts(timeline).filter((item) => item.layout === 'credits' || (!item.karaoke && /(lyrics|music|singer|vocals|directed|edit|வரிகள்|இசை|பாடியவர்)/i.test(item.text)))
    .map((item) => item.text.trim()).filter((text, index, all) => text && all.indexOf(text) === index).join('\n');
}

export function youtubeDetails(projectName: string, timeline: Timeline, seconds: number): Details {
  const lines = sung(timeline);
  const tamil = lines.some((item) => TAMIL.test(item.text)) || TAMIL.test(projectName);
  const short = timeline.format.height > timeline.format.width && seconds <= SHORT_SECONDS;
  const lyric = lines.length > 0;
  const title = projectName.trim().slice(0, 100) || 'My video';
  const parts = [credits(timeline)];
  if (lyric) parts.push(lines.slice(0, 4).map((item) => item.text.replace(/\n/g, ' ')).join('\n') + (lines.length > 4 ? '\n…' : ''));
  if (short) parts.push('#Shorts');
  const tags = [...(tamil ? ['tamil', 'tamil song'] : []), ...(lyric ? ['lyric video', tamil ? 'tamil lyric video' : 'lyrics'] : []), title].filter((tag, index, all) => all.indexOf(tag) === index);
  return { title, description: parts.filter(Boolean).join('\n\n').slice(0, 5000), tags, language: tamil ? 'ta' : 'en', captions: lyricCaptions(timeline), short };
}
