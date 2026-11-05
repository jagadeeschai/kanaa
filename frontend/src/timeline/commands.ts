/**
 * Ask AI's edits. The AI proposes commands (checked by backend edit_plan_service.py); they are checked again here
 * against the editor's own options before the person sees them, and only run when the person applies them.
 * Pure ones change the timeline here; the rest (themes, effects, captions…) run through the editor's own actions.
 */
import type { LookName, TransitionKind } from './animation.ts';
import { captionLayers, FORMATS, mainLayer, updateClip, type Caption, type Timeline } from './model.ts';
import { TRANSITION_SECONDS } from './drop.ts';

export type Command =
  | { name: 'set_theme'; args: { theme: string } }
  | { name: 'set_look'; args: { look: LookName; clips: 'all' | number[] } }
  | { name: 'set_transition'; args: { transition: TransitionKind; clips: 'all' | number[] } }
  | { name: 'add_title'; args: { text: string; at: number; style?: string } }
  | { name: 'add_effect'; args: { effect: string; at: number } }
  | { name: 'cut_to_beat'; args: Record<string, never> }
  | { name: 'add_captions'; args: { words: number } }
  | { name: 'keep_captions_clear'; args: Record<string, never> }
  | { name: 'set_format'; args: { format: string } }
  | { name: 'make_story'; args: { story: string } }
  | { name: 'translate_captions'; args: { to: 'ta' | 'en' } };
export type Proposed = Command & { why?: string };
export type Options = Record<'themes' | 'looks' | 'transitions' | 'effects' | 'formats' | 'stories' | 'title_styles', { id: string; label: string }[]>;

const has = (list: { id: string }[], id: unknown) => list.some((item) => item.id === id);

/** Whether the editor can run this command as given. A second check after the backend's, as ids can differ by version. */
export function usable(command: Proposed, options: Options, timeline: Timeline): boolean {
  const clips = mainLayer(timeline).items.length;
  const numbersOk = (value: 'all' | number[], first: number) => value === 'all' || (Array.isArray(value) && value.length > 0 && value.every((n) => Number.isInteger(n) && n >= first && n <= clips));
  const a = command.args as Record<string, unknown>;
  switch (command.name) {
    case 'set_theme': return has(options.themes, a.theme) && clips > 0;
    case 'set_look': return has(options.looks, a.look) && numbersOk(a.clips as 'all' | number[], 1);
    case 'set_transition': return has(options.transitions, a.transition) && clips > 1 && numbersOk(a.clips as 'all' | number[], 2);
    case 'add_title': return typeof a.text === 'string' && a.text.trim().length > 0 && typeof a.at === 'number' && (a.style === undefined || has(options.title_styles, a.style));
    case 'add_effect': return has(options.effects, a.effect) && typeof a.at === 'number';
    case 'set_format': return has(options.formats, a.format);
    case 'make_story': return has(options.stories, a.story);
    case 'translate_captions': return (a.to === 'ta' || a.to === 'en') && captionLayers(timeline).some((layer) => layer.items.length > 0);
    case 'keep_captions_clear': return captionLayers(timeline).some((layer) => layer.items.length > 0);
    case 'cut_to_beat': case 'add_captions': return clips > 0;
    default: return false;
  }
}

/** The main-track clips a command means: "all", or numbers from 1 in playing order. */
function chosen(timeline: Timeline, clips: 'all' | number[]) {
  const ordered = [...mainLayer(timeline).items].sort((a, b) => a.start - b.start);
  return clips === 'all' ? ordered : clips.map((n) => ordered[n - 1]).filter(Boolean);
}

/** Commands that only change the timeline. Null for those the editor runs itself. */
export function applyPure(timeline: Timeline, command: Command): Timeline | null {
  if (mainLayer(timeline).locked && (command.name === 'set_look' || command.name === 'set_transition')) return timeline;
  if (command.name === 'set_look') return chosen(timeline, command.args.clips).reduce((next, clip) => updateClip(next, clip.id, { look: command.args.look }), timeline);
  if (command.name === 'set_transition') {
    const first = [...mainLayer(timeline).items].sort((a, b) => a.start - b.start)[0];
    return chosen(timeline, command.args.clips).filter((clip) => clip.id !== first?.id)
      .reduce((next, clip) => updateClip(next, clip.id, { transition_in: { kind: command.args.transition, duration: Math.min(TRANSITION_SECONDS, Math.max(0.2, (clip.out - clip.in) / clip.speed / 2)) } }), timeline);
  }
  if (command.name === 'set_format') {
    const format = FORMATS.find((item) => item.id === command.args.format);
    return format ? { ...timeline, format: { width: format.width, height: format.height, fps: timeline.format.fps } } : timeline;
  }
  return null;
}

/** A plain description of a command, for the list the person ticks. */
export function describeCommand(command: Command, options: Options): string {
  const label = (list: { id: string; label: string }[], id: string) => list.find((item) => item.id === id)?.label ?? id;
  const which = (clips: 'all' | number[]) => (clips === 'all' ? 'every clip' : `clip${clips.length > 1 ? 's' : ''} ${clips.join(', ')}`);
  const at = (seconds: number) => `at ${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(0).padStart(2, '0')}`;
  switch (command.name) {
    case 'set_theme': return `Theme: ${label(options.themes, command.args.theme)}`;
    case 'set_look': return `${label(options.looks, command.args.look)} look on ${which(command.args.clips)}`;
    case 'set_transition': return `${label(options.transitions, command.args.transition)} into ${which(command.args.clips)}`;
    case 'add_title': return `Title “${command.args.text}” ${at(command.args.at)}`;
    case 'add_effect': return `${label(options.effects, command.args.effect)} ${at(command.args.at)}`;
    case 'cut_to_beat': return 'Cut clips to the beat';
    case 'add_captions': return `Captions, ${command.args.words} word${command.args.words === 1 ? '' : 's'} at a time`;
    case 'keep_captions_clear': return 'Keep captions clear of faces';
    case 'set_format': return `Shape: ${label(options.formats, command.args.format)}`;
    case 'make_story': return `Make the video as the story “${label(options.stories, command.args.story)}”`;
    case 'translate_captions': return `Translate captions to ${command.args.to === 'ta' ? 'Tamil' : 'English'}`;
  }
}

const MAX_WORDS = 30; // A caption's limit in the schema.

/**
 * Replaces each caption's words with its translation. Word times are unknown in the new language, so the words share
 * the caption's time evenly (the caption itself keeps its start and length).
 */
export function translateCaptions(timeline: Timeline, translated: Map<string, string>): Timeline {
  return { ...timeline, layers: timeline.layers.map((layer) => {
    if (layer.kind !== 'captions' || layer.locked) return layer;
    return { ...layer, items: layer.items.map((caption): Caption => {
      const text = translated.get(caption.id)?.trim();
      if (!text) return caption;
      let words = text.split(/\s+/);
      if (words.length > MAX_WORDS) words = [...words.slice(0, MAX_WORDS - 1), words.slice(MAX_WORDS - 1).join(' ')];
      const step = caption.length / words.length;
      return { ...caption, words: words.map((w, index) => ({ w, s: Math.round(index * step * 1000) / 1000 })) };
    }) };
  }) };
}
