import type { Caption, Clip } from './model.ts';
import { buildTokens, tokenTime, type Word } from './words.ts';

/** How captions are cut from speech. Short lines read fastest on a phone. */
export type CaptionOptions = { words: number; maxLetters: number };
export const DEFAULT_CAPTION_OPTIONS: CaptionOptions = { words: 3, maxLetters: 24 };
const PAUSE_BREAK = 0.6; // A pause this long starts a new caption.
const HOLD = 0.3; // Stays up this long after its last word, unless the next caption comes first.
const SENTENCE_END = /[.!?।॥…]$/;
const CLAUSE_END = /[,;:]$/; // Ends a caption only once it has two words, so a lone 'Today,' doesn't flash by.
const round = (value: number) => Math.round(value * 1000) / 1000;

type Spoken = { text: string; start: number; end: number };

/** Captions for the speech in the main track's clips, in timeline time. `newId` names each one. */
export function buildCaptions(clips: Clip[], wordsFor: (mediaId: number) => Word[] | undefined, newId: () => string, options = DEFAULT_CAPTION_OPTIONS): Caption[] {
  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  const spoken: Spoken[] = buildTokens(clips, wordsFor).flatMap((token) => {
    const clip = byId.get(token.clipId)!;
    return token.text ? [{ text: token.text, start: tokenTime(clip, token.from), end: tokenTime(clip, token.to) }] : [];
  });
  const groups: Spoken[][] = [];
  for (const word of spoken) {
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    const letters = group ? group.reduce((sum, item) => sum + item.text.length + 1, 0) + word.text.length : 0;
    const fresh = !group || group.length >= options.words || letters > options.maxLetters || word.start - last!.end > PAUSE_BREAK || SENTENCE_END.test(last!.text) || (CLAUSE_END.test(last!.text) && group.length >= 2);
    if (fresh) groups.push([word]); else group.push(word);
  }
  return groups.map((group, index) => {
    const start = round(group[0].start);
    const next = groups[index + 1]?.[0].start ?? Infinity;
    const end = Math.max(start + 0.1, Math.min(next, group[group.length - 1].end + HOLD));
    return { id: newId(), start, length: round(end - start), words: group.map((word) => ({ w: word.text, s: round(Math.max(0, word.start - start)) })) };
  });
}

/** The words after the person retypes a caption. Same count: each keeps its moment. Otherwise they share the time evenly. */
export function retypeCaption(caption: Caption, text: string): Caption['words'] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return caption.words;
  if (words.length === caption.words.length) return words.map((w, index) => ({ w, s: caption.words[index].s }));
  return words.map((w, index) => ({ w, s: round((index * caption.length) / words.length) }));
}

/** Which word is lit `local` seconds into a caption: the last one spoken by then. */
export function litWord(caption: Caption, local: number): number {
  let lit = 0;
  caption.words.forEach((word, index) => { if (word.s <= local + 1e-6) lit = index; });
  return lit;
}
