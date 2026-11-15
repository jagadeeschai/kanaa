import { translateLines } from "../../api/client";
import { applyPure,describeCommand,translateCaptions,type Options,type Proposed } from "../../timeline/commands";
import type { Transform } from '../../timeline/evaluate';
import { audioLayers,captionLayers,captionText,clipLength,duration,FORMATS,mainLayer,textLayers,type SourceFacts,type Timeline } from "../../timeline/model";
import { fillRest,STORIES,type Story } from "../../timeline/stories";
import { TEMPLATES,type Template } from "../../timeline/templates";
import { activeTheme,THEMES,type Theme as VideoTheme } from "../../timeline/themes";
import type { Photo } from "../../types/photo";

type Input = {
  actions: React.MutableRefObject<{ chooseTheme: (look: VideoTheme, base?: Timeline | null | undefined, busy?: string | undefined) => Promise<void>; addTitle: (title: Template, dropAt?: number | undefined, words?: string | undefined) => Promise<void>; addEffect: (effectId: string, dropAt?: number | undefined, length?: number | undefined, around?: Partial<Transform> | undefined) => Promise<void>; cutClipsToBeat: () => Promise<void>; makeCaptions: (words?: number) => void; keepClearOfFaces: () => Promise<void>; buildStoryVideo: (chosenStory: Story, fills: (SourceFacts | null)[]) => Promise<void>; storyMedia: Photo[]; facts: (id: number) => SourceFacts | undefined; change: (next: Timeline, group?: string | null) => void; }>;
  askOptions: Options;
  media: Photo[];
  mediaById: Map<number, Photo>;
  setCaptionWords: React.Dispatch<React.SetStateAction<number>>;
  timelineRef: React.MutableRefObject<Timeline | null>;
  usedIds: Set<number>;
};

/** Existing editor actions; the input getter preserves render snapshots and forward references. */
export function createAskActions(getInput: () => Input) {
  const askProject = (...args: Parameters<() => { format?: undefined; duration?: undefined; clip_count?: undefined; clips?: undefined; theme?: undefined; music?: undefined; titles?: undefined; captions?: undefined; media?: undefined; } | { format: string; duration: number; clip_count: number; clips: { kind: string; name: string; length: number; start: number; }[]; theme: string; music: string[]; titles: string[]; captions: string[]; media: string[]; }>) => {
    const { timelineRef, mediaById, media, usedIds } = getInput();
    const invoke = () => {
    const current = timelineRef.current;
    if (!current) return {};
    const clips = [...mainLayer(current).items].sort((a, b) => a.start - b.start);
    const format = FORMATS.find((item) => item.width === current.format.width && item.height === current.format.height);
    const theme = activeTheme(current);
    return {
      format: format ? `${format.label} (${format.ratio})` : `${current.format.width}×${current.format.height}`, duration: duration(current), clip_count: clips.length,
      clips: clips.map((clip) => ({ kind: mediaById.get(clip.media_id)?.media_type ?? 'clip', name: mediaById.get(clip.media_id)?.filename ?? '', length: clipLength(clip), start: clip.start })),
      theme: theme?.label ?? '', music: audioLayers(current).flatMap((layer) => layer.items.map((sound) => sound.name)),
      titles: textLayers(current).flatMap((layer) => layer.items.map((text) => text.text)),
      captions: captionLayers(current).flatMap((layer) => layer.items.slice(0, 30).map((caption) => captionText(caption))),
      media: media.filter((item) => !usedIds.has(item.id) && item.folder !== 'Effects').slice(0, 20).map((item) => item.filename),
    };
  };
    return invoke(...args);
  };

  const runAsk = (...args: Parameters<(commands: Proposed[]) => Promise<string[]>>) => {
    const { timelineRef, actions, askOptions, setCaptionWords } = getInput();
    const invoke = async (commands: Proposed[]): Promise<string[]> => {
    const done: string[] = [];
    const settle = () => new Promise((resolve) => setTimeout(resolve, 120)); // Lets the editor redraw with the last edit before the next.
    for (const command of commands) {
      const current = timelineRef.current;
      const act = actions.current;
      if (!current) break;
      try {
        const pure = applyPure(current, command);
        if (pure) { if (pure !== current) act.change(pure); done.push(`✓ ${describeCommand(command, askOptions)}`); }
        else if (command.name === 'set_theme') { const theme = THEMES.find((item) => item.id === command.args.theme); if (theme) { await act.chooseTheme(theme, current); done.push(`✓ ${theme.label} theme`); } }
        else if (command.name === 'add_title') { act.addTitle(TEMPLATES.find((item) => item.id === command.args.style) ?? TEMPLATES[0], command.args.at, command.args.text); done.push(`✓ Title “${command.args.text}”`); }
        else if (command.name === 'add_effect') { await act.addEffect(command.args.effect, command.args.at); done.push(`✓ ${describeCommand(command, askOptions)}`); }
        else if (command.name === 'cut_to_beat') { await act.cutClipsToBeat(); done.push('✓ Cut to the beat (see the Audio tab for details)'); }
        else if (command.name === 'add_captions') { setCaptionWords(command.args.words); act.makeCaptions(command.args.words); done.push('✓ Captions: they appear once Kanaa has listened to the speech'); }
        else if (command.name === 'keep_captions_clear') { await act.keepClearOfFaces(); done.push('✓ Captions checked against faces'); }
        else if (command.name === 'make_story') {
          const chosen = STORIES.find((item) => item.id === command.args.story);
          const pool = act.storyMedia.map((item) => act.facts(item.id)).filter((item): item is SourceFacts => Boolean(item));
          if (chosen) { await act.buildStoryVideo(chosen, fillRest(chosen, chosen.slots.map(() => null), pool)); done.push(`✓ Made as “${chosen.label}”`); }
        } else if (command.name === 'translate_captions') {
          const captions = captionLayers(current).flatMap((layer) => layer.items);
          const { lines } = await translateLines(captions.map((caption) => captionText(caption)), command.args.to);
          act.change(translateCaptions(timelineRef.current ?? current, new Map(captions.map((caption, index) => [caption.id, lines[index]]))));
          done.push(`✓ ${captions.length} captions translated`);
        }
      } catch (problem) { done.push(`✗ ${(problem as Error).message}`); }
      await settle();
    }
    return done;
  };
    return invoke(...args);
  };
  return { askProject, runAsk };
}
