/** The song's name on a signature's titles (kanaa_mcp/signature_titles.py): the card's title, the credit in the song and the end card follow one name. */
import type { Timeline } from './model.ts';

export const SONG_IDS = ['signature-song', 'credit-song-lower', 'credit-song-end'];

/** The song's name as the signature card shows it now: Tamil, and the English under it. */
export function songName(timeline: Timeline): { tamil: string; english: string } | null {
  for (const layer of timeline.layers) if (layer.kind === 'text') for (const item of layer.items) if (item.id === 'signature-song') return { tamil: item.text, english: item.subtitle ?? '' };
  return null;
}

/** Every title that names the song takes the new name. */
export function renameSong(timeline: Timeline, old: { tamil: string; english: string }, next: { tamil: string; english: string }): Timeline {
  const swap = (value: string | null | undefined) => {
    if (!value) return value;
    let out = old.tamil ? value.split(old.tamil).join(next.tamil) : value;
    if (old.english) for (const [from, to] of [[old.english.toUpperCase(), next.english.toUpperCase()], [title(old.english), title(next.english)], [old.english, next.english]]) out = out.split(from).join(to);
    return out;
  };
  return { ...timeline, layers: timeline.layers.map((layer) => layer.kind !== 'text' ? layer : { ...layer, items: layer.items.map((item) =>
    SONG_IDS.some((id) => item.id.startsWith(id)) ? { ...item, text: swap(item.text) ?? item.text, subtitle: swap(item.subtitle) ?? item.subtitle } : item) }) };
}

const title = (value: string) => value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
