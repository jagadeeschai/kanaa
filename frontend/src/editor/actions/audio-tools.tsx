import { useSoundEffect as fetchSoundEffect,getSongBeats,startStems,uploadVideoAudio,type Stems } from "../../api/client";
import { beatSound,cutToBeats,timelineBeats } from "../../timeline/beats";
import { loopSound } from "../../timeline/loop";
import { addSound,detachAudio,duration,findSound,MUSIC_VOLUME,setSpeed,updateSound,type AudioLayer,type Clip,type Sound,type SourceFacts,type Timeline } from "../../timeline/model";
import { placeEffects,titleTimes,transitionTimes } from "../../timeline/sfx";
import type { Photo } from "../../types/photo";
import { MIN_MUSIC_SECONDS,newId } from "../editor-constants";
import { PlaybackEngine } from "../playback";
import { type ClipVisuals } from "../TimelineView";
type StemChoice = 'music' | 'vocals' | 'both';
type StemJob = { soundId: string; jobId: string; choice: StemChoice; progress: number };

type Input = {
  change: (next: Timeline, group?: string | null) => void;
  engineRef: React.MutableRefObject<PlaybackEngine | null>;
  facts: (id: number) => SourceFacts | undefined;
  looping: boolean;
  mediaById: Map<number, Photo>;
  selected: Clip | null;
  selectedSound: { sound: Sound; layer: AudioLayer; } | null;
  setAddingMusic: React.Dispatch<React.SetStateAction<boolean>>;
  setBeatBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setBeatNote: React.Dispatch<React.SetStateAction<string | null>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setLooping: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setSfxBusy: React.Dispatch<React.SetStateAction<"whoosh" | "hit" | null>>;
  setSfxNote: React.Dispatch<React.SetStateAction<string | null>>;
  setStemJob: React.Dispatch<React.SetStateAction<StemJob | null>>;
  setThunderBusy: React.Dispatch<React.SetStateAction<boolean>>;
  sfxBusy: "whoosh" | "hit" | null;
  sfxChoice: { whoosh: string; hit: string; };
  stemJob: StemJob | null;
  thunderBusy: boolean;
  timeline: Timeline | null;
  timelineRef: React.MutableRefObject<Timeline | null>;
  visuals: React.MutableRefObject<Map<number, ClipVisuals>>;
};

/** Existing editor actions; the input getter preserves render snapshots and forward references. */
export function createAudioToolActions(getInput: () => Input) {
  const applyStems = (...args: Parameters<(result: Stems) => void>) => {
    const { timelineRef, stemJob, setStemJob, change } = getInput();
    const invoke = (result: Stems) => {
    const current = timelineRef.current; const job = stemJob;
    const found = current && job ? findSound(current, job.soundId) : null;
    setStemJob(null);
    if (!current || !job || !found) return;
    const { sound } = found;
    const as = (id: string, label: string): Partial<Sound> => ({ asset_id: id, media_id: undefined, name: `${sound.name} (${label})`.slice(0, 120) });
    if (job.choice === 'vocals') change(updateSound(current, sound.id, as(result.vocals, 'vocals only')));
    else {
      const next = updateSound(current, sound.id, as(result.music, 'no vocals'));
      change(job.choice === 'music' ? next : addSound(next, { ...sound, ...as(result.vocals, 'vocals only'), id: newId() }, newId()));
    }
  };
    return invoke(...args);
  };

  const separate = (...args: Parameters<(choice: StemChoice) => Promise<void>>) => {
    const { selectedSound, setStemJob, setError } = getInput();
    const invoke = async (choice: StemChoice) => {
    if (!selectedSound) return;
    const { sound } = selectedSound;
    try {
      const { job_id } = await startStems(sound.asset_id ? { asset_id: sound.asset_id } : { media_id: sound.media_id });
      setStemJob({ soundId: sound.id, jobId: job_id, choice, progress: 0 });
    } catch (problem) { setError((problem as Error).message); }
  };
    return invoke(...args);
  };

  const updateSelectedSound = (...args: Parameters<(changes: Partial<Sound>, group?: string) => void>) => {
    const { timeline, selectedSound, change } = getInput();
    const invoke = (changes: Partial<Sound>, group?: string) => { if (timeline && selectedSound) change(changes.speed !== undefined ? setSpeed(timeline, selectedSound.sound.id, changes.speed) : updateSound(timeline, selectedSound.sound.id, changes), group); };
    return invoke(...args);
  };

  const hasSound = (...args: Parameters<(id: number) => boolean>) => {
    const { visuals } = getInput();
    const invoke = (id: number) => Boolean(visuals.current.get(id)?.peaks?.peaks.some(Boolean));
    return invoke(...args);
  };

  const detach = (...args: Parameters<(clip?: Clip | null) => void>) => {
    const { selected, timeline, change, mediaById, setSelectedId } = getInput();
    const invoke = (clip = selected) => {
    if (!timeline || !clip) return;
    const soundId = newId();
    change(detachAudio(timeline, clip.id, soundId, newId(), `${mediaById.get(clip.media_id)?.filename ?? 'Clip'} sound`.slice(0, 120), mediaById.get(clip.media_id)?.duration ?? undefined));
    setSelectedId(soundId);
  };
    return invoke(...args);
  };

  const addMusic = (...args: Parameters<(file: File) => Promise<void>>) => {
    const { timeline, setAddingMusic, engineRef, change, setSelectedId, setError } = getInput();
    const invoke = async (file: File) => {
    if (!timeline) return;
    setAddingMusic(true);
    try {
      const song = await uploadVideoAudio(file);
      const at = Math.round(engineRef.current ? engineRef.current.currentTime * 1000 : 0) / 1000;
      const left = duration(timeline) - at;
      const length = left >= MIN_MUSIC_SECONDS ? Math.min(left, song.duration) : song.duration;
      const sound: Sound = { id: newId(), asset_id: song.asset_id, start: at, in: 0, out: length, speed: 1, volume: MUSIC_VOLUME, muted: false, fade_in: 0, fade_out: 0, duck: true, name: file.name.slice(0, 120), source_length: song.duration };
      change(addSound(timeline, sound, newId()));
      setSelectedId(sound.id);
    } catch (problem) { setError((problem as Error).message); } finally { setAddingMusic(false); }
  };
    return invoke(...args);
  };

  const addSoundEffects = (...args: Parameters<(kind: "whoosh" | "hit") => Promise<void>>) => {
    const { timelineRef, sfxBusy, setSfxNote, setSfxBusy, sfxChoice, change } = getInput();
    const invoke = async (kind: 'whoosh' | 'hit') => {
    const current = timelineRef.current;
    if (!current || sfxBusy) return;
    const times = kind === 'whoosh' ? transitionTimes(current) : titleTimes(current);
    if (!times.length) { setSfxNote(kind === 'whoosh' ? 'Add transitions between clips first (Themes tab, or a clip\'s Motion tab).' : 'Add a title first (Text tab).'); return; }
    setSfxBusy(kind); setSfxNote(null);
    try {
      const effect = await fetchSoundEffect(sfxChoice[kind]);
      const result = placeEffects(timelineRef.current ?? current, effect, times, newId);
      change(result.timeline);
      setSfxNote(`${result.placed} ${kind === 'whoosh' ? (result.placed === 1 ? 'whoosh' : 'whooshes') : (result.placed === 1 ? 'hit' : 'hits')} added. Each is a sound you can move, trim or mute; ⌘Z undoes them all.`);
    } catch (problem) { setSfxNote((problem as Error).message); } finally { setSfxBusy(null); }
  };
    return invoke(...args);
  };

  const addThunder = (...args: Parameters<() => Promise<void>>) => {
    const { timelineRef, thunderBusy, setThunderBusy, engineRef, change, setSelectedId, setError } = getInput();
    const invoke = async () => {
    const current = timelineRef.current;
    if (!current || thunderBusy) return;
    setThunderBusy(true);
    try {
      const effect = await fetchSoundEffect('kanaa-thunder');
      const at = Math.round((engineRef.current?.currentTime ?? 0) * 1000) / 1000;
      const sound: Sound = { id: newId(), asset_id: effect.asset_id, start: at, in: 0, out: effect.duration, speed: 1, volume: 0.8, muted: false,
        fade_in: 0, fade_out: 0.8, duck: false, name: 'Thunder', source_length: effect.duration };
      change(addSound(timelineRef.current ?? current, sound, newId()));
      setSelectedId(sound.id);
    } catch (problem) { setError((problem as Error).message); } finally { setThunderBusy(false); }
  };
    return invoke(...args);
  };

  const loopSelectedSound = (...args: Parameters<(soundId: string) => Promise<void>>) => {
    const { timelineRef, looping, setLooping, change, setError } = getInput();
    const invoke = async (soundId: string) => {
    const current = timelineRef.current;
    const sound = current && findSound(current, soundId)?.sound;
    if (!current || !sound?.asset_id || looping) return;
    setLooping(true);
    try {
      let beats: number[] = [];
      try { beats = (await getSongBeats(sound.asset_id)).beats; } catch { beats = []; } // Without beats it still loops, end to start.
      const result = loopSound(timelineRef.current ?? current, soundId, beats, newId);
      if (result.repeats) change(result.timeline);
    } catch (problem) { setError((problem as Error).message); } finally { setLooping(false); }
  };
    return invoke(...args);
  };

  const cutClipsToBeat = (...args: Parameters<() => Promise<void>>) => {
    const { timeline, setBeatNote, setBeatBusy, facts, change } = getInput();
    const invoke = async () => {
    if (!timeline) return;
    const sound = beatSound(timeline);
    if (!sound) { setBeatNote('Add a song first. The cuts follow its beat.'); return; }
    setBeatBusy(true); setBeatNote(null);
    try {
      const { beats, bpm } = await getSongBeats(sound.asset_id);
      const result = cutToBeats(timeline, timelineBeats(sound, beats), facts);
      if (result.changed) change(result.timeline);
      setBeatNote(result.changed ? `${result.changed} clip${result.changed === 1 ? '' : 's'} now end on the beat (about ${Math.round(bpm)} beats a minute). ⌘Z undoes it.` : 'Your clips already end on the beat, or the song has no clear beat where they are.');
    } catch (problem) { setBeatNote((problem as Error).message); } finally { setBeatBusy(false); }
  };
    return invoke(...args);
  };
  return { applyStems, separate, updateSelectedSound, hasSound, detach, addMusic, addSoundEffects, addThunder, loopSelectedSound, cutClipsToBeat };
}
