import { musicListenUrl,startBestMoments,takeLibraryTrack,waitForJob,type LibraryTrack } from "../../api/client";
import { addSound,duration,mainLayer,MUSIC_VOLUME,type Clip,type Sound,type SourceFacts,type Timeline } from "../../timeline/model";
import { type Focus } from "../../timeline/presets";
import { buildStory,STORIES,type Story } from "../../timeline/stories";
import { activeTheme,addThemeMusic,applyTheme,openingWords,pickTrack,removeThemeMusic,THEMES,type Theme as VideoTheme } from "../../timeline/themes";
import type { Photo } from "../../types/photo";
import { PlaybackEngine } from "../playback";

type Input = {
  aimFor: (clip: Clip, base: Timeline) => Promise<Focus | null>;
  change: (next: Timeline, group?: string | null) => void;
  engineRef: React.MutableRefObject<PlaybackEngine | null>;
  facts: (id: number) => SourceFacts | undefined;
  library: LibraryTrack[] | null;
  listening: string | null;
  listenRef: React.MutableRefObject<HTMLAudioElement | null>;
  loadLibrary: () => Promise<LibraryTrack[]>;
  mediaById: Map<number, Photo>;
  MIN_MUSIC_SECONDS: 1;
  newId: () => string;
  projectName: string;
  setAddingMusic: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setListening: React.Dispatch<React.SetStateAction<string | null>>;
  setMomentProgress: React.Dispatch<React.SetStateAction<number | null>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setStory: React.Dispatch<React.SetStateAction<{ story: Story; fills: (number | null)[]; choosing: number | null; } | null>>;
  setThemeBusy: React.Dispatch<React.SetStateAction<string | null>>;
  setThemeTrack: React.Dispatch<React.SetStateAction<string | null>>;
  story: { story: Story; fills: (number | null)[]; choosing: number | null; } | null;
  themeBusy: string | null;
  themeTrack: string | null;
  themeWithMusic: boolean;
  timeline: Timeline | null;
  timelineRef: React.MutableRefObject<Timeline | null>;
};

/** Existing editor actions; the input getter preserves render snapshots and forward references. */
export function createThemeActions(getInput: () => Input) {
  const listen = (...args: Parameters<(id: string) => void>) => {
    const { listenRef, listening, setListening } = getInput();
    const invoke = (id: string) => {
    const player = listenRef.current ?? (listenRef.current = new Audio());
    if (listening === id) { player.pause(); setListening(null); return; }
    player.src = musicListenUrl(id);
    player.onended = () => setListening(null);
    void player.play().catch(() => setListening(null));
    setListening(id);
  };
    return invoke(...args);
  };

  const librarySong = (...args: Parameters<(track: LibraryTrack) => Promise<{ name: string; asset_id: string; duration: number; }>>) => {
    const {  } = getInput();
    const invoke = async (track: LibraryTrack) => ({ ...(await takeLibraryTrack(track.id)), name: track.genre && /^track\b/i.test(track.name) ? `${track.name} · ${track.genre}` : track.name });
    return invoke(...args);
  };

  const chooseTheme = (...args: Parameters<(look: VideoTheme, base?: Timeline | null, busy?: string) => Promise<void>>) => {
    const { timeline, setError, themeBusy, projectName, setThemeBusy, mediaById, aimFor, newId, themeWithMusic, loadLibrary, setThemeTrack, change } = getInput();
    const invoke = async (look: VideoTheme, base = timeline, busy = look.id) => {
    if (!base || !mainLayer(base).items.length) { setError('Add a clip to your video first.'); return; }
    if (themeBusy) return;
    const words = openingWords(base) ?? projectName;
    setThemeBusy(busy);
    const isPhoto = (clip: Clip) => mediaById.get(clip.media_id)?.media_type === 'image';
    const aims = new Map(await Promise.all(mainLayer(base).items.filter(isPhoto).map(async (clip) => [clip.id, await aimFor(clip, base)] as const)));
    let next = applyTheme(base, look, words, isPhoto, [newId(), newId(), newId()], (clip) => aims.get(clip.id) ?? null);
    try {
      const track = themeWithMusic ? pickTrack(await loadLibrary(), look, duration(next)) : null;
      if (track) {
        try { next = addThemeMusic(next, await librarySong(track), [newId(), newId()]); setThemeTrack(track.id); } catch (problem) { setError((problem as Error).message); }
      }
      change(next);
    } finally { setThemeBusy(null); }
  };
    return invoke(...args);
  };

  const makeStory = (...args: Parameters<() => Promise<void>>) => {
    const { timeline, story, facts } = getInput();
    const invoke = async () => {
    if (!timeline || !story) return;
    await buildStoryVideo(story.story, story.fills.map((id) => (id === null ? null : facts(id) ?? null)));
  };
    return invoke(...args);
  };

  const buildStoryVideo = (...args: Parameters<(chosenStory: (typeof STORIES)[number], fills: (SourceFacts | null)[]) => Promise<void>>) => {
    const { timelineRef, setError, setMomentProgress, newId, setStory } = getInput();
    const invoke = async (chosenStory: (typeof STORIES)[number], fills: (SourceFacts | null)[]) => {
    const base = timelineRef.current;
    if (!base) return;
    const story = { story: chosenStory };
    if (!fills.some(Boolean)) { setError('Put a clip or photo in at least one moment.'); return; }
    const look = THEMES.find((item) => item.id === story.story.theme) ?? THEMES[0];
    // Each video's best stretch (sharp, steady, well lit, with faces) instead of its middle. If that fails, the middle still works.
    let best: (number | null)[] = [];
    const wanted = story.story.slots.map((slot, index) => ({ slot, source: fills[index] })).filter(({ slot, source }) => source?.media_type === 'video' && (source.duration ?? 0) > slot.seconds);
    if (wanted.length) {
      setMomentProgress(0);
      try {
        const { job_id } = await startBestMoments(wanted.map(({ slot, source }) => ({ media_id: source!.media_id, length: slot.seconds })));
        const { starts } = await waitForJob<{ starts: (number | null)[] }>(job_id, setMomentProgress);
        best = story.story.slots.map((slot) => { const at = wanted.findIndex((entry) => entry.slot === slot); return at < 0 ? null : starts[at]; });
      } catch { best = []; } finally { setMomentProgress(null); }
    }
    await chooseTheme(look, buildStory(base, story.story, fills, newId, best), `story-${story.story.id}`);
    setStory(null);
  };
    return invoke(...args);
  };

  const changeThemeMusic = (...args: Parameters<(on: boolean) => Promise<void>>) => {
    const { timeline, change, library, themeTrack, setError, newId, setThemeTrack } = getInput();
    const invoke = async (on: boolean) => {
    const look = timeline && activeTheme(timeline);
    if (!timeline || !look) return;
    if (!on) { change(removeThemeMusic(timeline)); return; }
    const track = library && pickTrack(library, look, duration(timeline), themeTrack);
    if (!track) { setError('No music in your library suits this theme yet.'); return; }
    try { change(addThemeMusic(timeline, await librarySong(track), [newId(), newId()])); setThemeTrack(track.id); } catch (problem) { setError((problem as Error).message); }
  };
    return invoke(...args);
  };

  const addLibraryTrack = (...args: Parameters<(track: LibraryTrack, dropAt?: number) => Promise<void>>) => {
    const { timeline, setAddingMusic, engineRef, MIN_MUSIC_SECONDS, newId, change, setSelectedId, setError } = getInput();
    const invoke = async (track: LibraryTrack, dropAt?: number) => {
    if (!timeline) return;
    setAddingMusic(true);
    try {
      const song = await librarySong(track);
      const at = Math.round((dropAt ?? engineRef.current?.currentTime ?? 0) * 1000) / 1000;
      const left = duration(timeline) - at;
      const length = left >= MIN_MUSIC_SECONDS ? Math.min(left, song.duration) : song.duration;
      const sound: Sound = { id: newId(), asset_id: song.asset_id, start: at, in: 0, out: length, speed: 1, volume: MUSIC_VOLUME, muted: false, fade_in: 0, fade_out: 0, duck: true, name: song.name.slice(0, 120), source_length: song.duration };
      change(addSound(timeline, sound, newId()));
      setSelectedId(sound.id);
    } catch (problem) { setError((problem as Error).message); } finally { setAddingMusic(false); }
  };
    return invoke(...args);
  };
  return { listen, librarySong, chooseTheme, makeStory, buildStoryVideo, changeThemeMusic, addLibraryTrack };
}
