import { useSoundEffect as fetchSoundEffect,getFocus,getSongBeats,type LibraryTrack } from "../../api/client";
import { beatSound,timelineBeats } from "../../timeline/beats";
import { applyClipDrop,clipEffectChanges,dropClip,type DragPayload,type DropTarget } from "../../timeline/drop";
import { writeValue } from "../../timeline/keyframes";
import { addOverlay,addSound,clipLength,fittedSize,DEFAULT_BEAT_PULSE,DEFAULT_COLOUR_SPLASH,DEFAULT_DREAMY_GLOW,DEFAULT_LENS_SURFACE,DEFAULT_OLD_FILM,DEFAULT_SIGNAL_DAMAGE,findClip,insertClip,isLocked,mainLayer,markOwn,newClip,OVERLAY_SCALE,replaceBackground,setSpeed,sharedKeys,snapshotFrame,updateClip,type Clip,type Format,type Sound,type SourceFacts,type Timeline } from "../../timeline/model";
import { applyMove,focusOnScreen,slotPlacement,type Focus,type MovePreset } from "../../timeline/presets";
import { TEMPLATES,type Template } from "../../timeline/templates";
import type { Photo } from "../../types/photo";
import { CLIP_EFFECT_PRESETS,FREEZE_SECONDS,newId } from "../editor-constants";
import type { Layout } from '../layout';
import { PlaybackEngine,type PlaybackSource } from "../playback";

type Input = {
  addEffect: (effectId: string, dropAt?: number, length?: number, around?: Partial<Clip["transform"]>) => Promise<void>;
  addLibraryTrack: (track: LibraryTrack, dropAt?: number | undefined) => Promise<void>;
  addTitle: (title: Template, dropAt?: number | undefined, words?: string | undefined) => Promise<void>;
  change: (next: Timeline, group?: string | null) => void;
  engineRef: React.MutableRefObject<PlaybackEngine | null>;
  focusCache: React.MutableRefObject<Map<string, Focus | null>>;
  library: LibraryTrack[] | null;
  local: number;
  mediaById: Map<number, Photo>;
  moreIds: ReadonlySet<string>;
  myStyles: Template[];
  playhead: { current: number; };
  scopedUpdate: <T extends object>(id: string, changes: T, one: (t: Timeline) => Timeline, group?: string) => void;
  selected: Clip | null;
  setChoosingFormat: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  sourceFor: (id: number, clip?: Clip) => PlaybackSource | undefined;
  styleScope: "item" | "layer";
  timeline: Timeline | null;
  updateLayout: (changes: Partial<Layout>) => void;
};

/** Existing editor actions; the input getter preserves render snapshots and forward references. */
export function createClipToolActions(getInput: () => Input) {
  const updateSelected = (...args: Parameters<(changes: Partial<Clip>, group?: string) => void>) => {
    const { timeline, selected, moreIds, styleScope, change, scopedUpdate } = getInput();
    const invoke = (changes: Partial<Clip>, group?: string) => {
    if (timeline && selected && moreIds.size && styleScope === 'item' && changes.speed === undefined) {
      const shared = Object.fromEntries(Object.entries(changes).filter(([key]) => sharedKeys({ [key]: 0 }).length)) as Partial<Clip>;
      let next = updateClip(timeline, selected.id, changes);
      for (const id of moreIds) if (findClip(next, id) && Object.keys(shared).length) next = markOwn(updateClip(next, id, shared), id, shared);
      change(markOwn(next, selected.id, changes), group);
      return;
    }
    if (timeline && selected) scopedUpdate(selected.id, changes, (t) => changes.speed !== undefined ? setSpeed(t, selected.id, changes.speed) : updateClip(t, selected.id, changes), group); };
    return invoke(...args);
  };

  const clipEffectApplied = (...args: Parameters<(id: (typeof CLIP_EFFECT_PRESETS)[number]["id"]) => boolean>) => {
    const { selected } = getInput();
    const invoke = (id: (typeof CLIP_EFFECT_PRESETS)[number]['id']) => Boolean(selected && (
    id === 'colour-splash' ? selected.colour_splash
      : id === 'dreamy-glow' ? selected.dreamy_glow
      : id === 'beat-pulse' ? selected.beat_pulse
      : id === 'split-tone' || id === 'duotone' ? selected.tone_grade?.mode === (id === 'duotone' ? 'duotone' : 'split')
      : id === 'mirror' ? selected.mirror && selected.mirror.mode !== 'kaleido'
      : id === 'kaleidoscope' ? selected.mirror?.mode === 'kaleido'
      : id === 'zoom-blur' ? selected.zoom_blur
      : id === 'tilt-shift' ? selected.tilt_shift
      : id === 'echo' ? selected.echo
      : id === 'old-film' ? selected.old_film
      : id === 'glitch' || id === 'vhs' ? selected.signal_damage?.mode === id
        : selected.lens_surface?.mode === (id === 'lens-dirt' ? 'dirt' : 'raindrops')
  ));
    return invoke(...args);
  };

  const applyClipEffect = (...args: Parameters<(id: (typeof CLIP_EFFECT_PRESETS)[number]["id"]) => Promise<void>>) => {
    const { selected, updateLayout, timeline } = getInput();
    const invoke = async (id: (typeof CLIP_EFFECT_PRESETS)[number]['id']) => {
    if (!selected) return;
    if (clipEffectApplied(id)) { updateLayout({ inspectorOpen: true }); return; }
    if (id === 'beat-pulse') {
      let beat_pulse = { ...DEFAULT_BEAT_PULSE };
      const song = timeline && beatSound(timeline);
      if (song) try {
        const found = await getSongBeats(song.asset_id);
        const beats = timelineBeats(song, found.beats);
        const first = beats.find((beat) => beat >= selected.start && beat < selected.start + clipLength(selected));
        beat_pulse = { ...beat_pulse, bpm: Math.max(30, Math.min(300, found.bpm)), offset: first === undefined ? 0 : first - selected.start };
      } catch { /* The editable 120 BPM default remains available when analysis fails. */ }
      updateSelected({ beat_pulse }); updateLayout({ inspectorOpen: true }); return;
    }
    const shaping = clipEffectChanges(id);
    if (shaping) { updateSelected(shaping); updateLayout({ inspectorOpen: true }); return; }
    const changes: Partial<Clip> = id === 'colour-splash' ? { colour_splash: { ...DEFAULT_COLOUR_SPLASH } }
      : id === 'dreamy-glow' ? { dreamy_glow: { ...DEFAULT_DREAMY_GLOW } }
      : id === 'old-film' ? { old_film: { ...DEFAULT_OLD_FILM } }
      : id === 'glitch' || id === 'vhs' ? { signal_damage: { ...DEFAULT_SIGNAL_DAMAGE, mode: id } }
        : { lens_surface: { ...DEFAULT_LENS_SURFACE, mode: id === 'lens-dirt' ? 'dirt' : 'raindrops' } };
    updateSelected(changes);
    updateLayout({ inspectorOpen: true });
  };
    return invoke(...args);
  };

  const snapshot = (...args: Parameters<(t?: number) => Promise<void>>) => {
    const { playhead, timeline, setError, change } = getInput();
    const invoke = async (t = playhead.current) => {
    if (!timeline || mainLayer(timeline).locked) return;
    let next = snapshotFrame(timeline, t, [newId(), newId()], FREEZE_SECONDS);
    if (next === timeline) { setError('Put the playhead inside a video clip to make a snapshot.'); return; }
    try {
      const shutter = await fetchSoundEffect('kanaa-shutter');
      const sound: Sound = { id: newId(), asset_id: shutter.asset_id, start: Math.max(0, t), in: 0, out: shutter.duration, speed: 1, volume: 0.72, muted: false, fade_in: 0, fade_out: 0, duck: false, name: 'Camera shutter', source_length: shutter.duration };
      next = addSound(next, sound, newId());
    } catch { /* The visual snapshot remains useful if its generated sound cannot be prepared. */ }
    change(next);
  };
    return invoke(...args);
  };

  const newBackground = (...args: Parameters<(clip: Clip, item: Photo) => void>) => {
    const { timeline, setError, change } = getInput();
    const invoke = (clip: Clip, item: Photo) => {
    if (!timeline) return;
    const source = { media_id: item.id, media_type: item.media_type === 'video' ? 'video' as const : 'image' as const, duration: item.duration, width: item.width || 1920, height: item.height || 1080 };
    try {
      const next = replaceBackground(timeline, clip.id, source, [newId(), newId()]);
      if (next === timeline) setError('Put the cut-out clip over the main track first.');
      else change(next);
    } catch (problem) { setError((problem as Error).message); }
  };
    return invoke(...args);
  };

  const addMedia = (...args: Parameters<(item: Photo) => void>) => {
    const { timeline, change, setSelectedId } = getInput();
    const invoke = (item: Photo) => {
    if (!timeline) return;
    const source: SourceFacts = { media_id: item.id, media_type: item.media_type === 'video' ? 'video' : 'image', duration: item.duration, width: item.width, height: item.height };
    const clip = newClip(source, newId());
    change(insertClip(timeline, clip));
    setSelectedId(clip.id);
  };
    return invoke(...args);
  };

  const addOverlayMedia = (...args: Parameters<(item: Photo, dropAt?: number) => void>) => {
    const { timeline, engineRef, change, setSelectedId, setError } = getInput();
    const invoke = (item: Photo, dropAt?: number) => {
    if (!timeline) return;
    const source: SourceFacts = { media_id: item.id, media_type: item.media_type === 'video' ? 'video' : 'image', duration: item.duration, width: item.width, height: item.height };
    const base = newClip(source, newId());
    const clip = { ...base, start: Math.round((dropAt ?? engineRef.current?.currentTime ?? 0) * 1000) / 1000, transform: { ...base.transform, scale: OVERLAY_SCALE } };
    try {
      change(addOverlay(timeline, clip, newId()));
      setSelectedId(clip.id);
    } catch (problem) { setError((problem as Error).message); }
  };
    return invoke(...args);
  };

  const onDropPayload = (...args: Parameters<(payload: DragPayload, target: DropTarget) => void>) => {
    const { timeline, mediaById, change, setSelectedId, myStyles, addTitle, library, addLibraryTrack, addEffect } = getInput();
    const invoke = (payload: DragPayload, target: DropTarget) => {
    if (!timeline) return;
    if (payload.kind === 'media') {
      const item = mediaById.get(payload.id);
      if (!item) return;
      if (target.zone === 'above') { addOverlayMedia(item, target.time); return; }
      const source: SourceFacts = { media_id: item.id, media_type: item.media_type === 'video' ? 'video' : 'image', duration: item.duration, width: item.width, height: item.height };
      const clip = newClip(source, newId());
      change(dropClip(timeline, clip, target.time));
      setSelectedId(clip.id);
    } else if (payload.kind === 'look' || payload.kind === 'transition' || payload.kind === 'clip_effect') {
      if (!target.clipId || isLocked(timeline, target.clipId)) return;
      const next = applyClipDrop(timeline, payload, target.clipId);
      if (next !== timeline) { change(next); setSelectedId(target.clipId); }
    } else if (payload.kind === 'title') {
      const template = [...TEMPLATES, ...myStyles].find((each) => each.id === payload.template);
      if (template) addTitle(template, target.time);
    } else if (payload.kind === 'track') {
      const track = library?.find((each) => each.id === payload.track);
      if (track) void addLibraryTrack(track, target.time);
    } else void addEffect(payload.effect, target.time);
  };
    return invoke(...args);
  };

  const aimFor = (...args: Parameters<(clip: Clip, base: Timeline) => Promise<Focus | null>>) => {
    const { mediaById, focusCache } = getInput();
    const invoke = async (clip: Clip, base: Timeline): Promise<Focus | null> => {
    const item = mediaById.get(clip.media_id);
    if (!item?.width || !item.height) return null;
    const at = item.media_type === 'video' ? clip.in : 0;
    const cacheKey = `${item.id}@${at.toFixed(2)}`;
    if (!focusCache.current.has(cacheKey)) {
      try {
        const found = await getFocus(item.id, at);
        focusCache.current.set(cacheKey, found.x === null || found.y === null ? null : { x: found.x, y: found.y });
      } catch { return null; } // Moves still work, towards the middle.
    }
    const focus = focusCache.current.get(cacheKey);
    return focus ? focusOnScreen(clip.transform, focus, { width: item.width, height: item.height }, clip.adjust.rotation, base.format) : null;
  };
    return invoke(...args);
  };

  const moveSelected = (...args: Parameters<(move: MovePreset) => Promise<void>>) => {
    const { timeline, selected, local } = getInput();
    const invoke = async (move: MovePreset) => {
    if (!timeline || !selected) return;
    const clip = selected;
    const aim = move === 'push-in' || move === 'pull-out' || move === 'focus-drift' ? await aimFor(clip, timeline) : null;
    const item = getInput().mediaById.get(clip.media_id);
    const fitted = item?.width && item.height ? fittedSize({ width: item.width, height: item.height }, clip.adjust.rotation, timeline.format) : null;
    const [wide, tall] = fitted ? [fitted.width / timeline.format.width, fitted.height / timeline.format.height] : [1, 1];
    updateSelected({ transform: applyMove(clip.transform, move, local, (clip.out - clip.in) / clip.speed, aim, wide, tall) });
  };
    return invoke(...args);
  };

  const applyToSelected = (...args: Parameters<(payload: DragPayload) => void>) => {
    const { timeline, selected, setError, change } = getInput();
    const invoke = (payload: DragPayload) => {
    if (!timeline || !selected) { setError('Select a clip first, or drag this onto a clip in the timeline.'); return; }
    if (isLocked(timeline, selected.id)) return;
    const next = applyClipDrop(timeline, payload, selected.id);
    if (next === timeline) setError('A transition goes on a clip that comes after another one on the main track.'); else change(next);
  };
    return invoke(...args);
  };

  const chooseFormat = (...args: Parameters<(format: Format) => void>) => {
    const { timeline, change, setChoosingFormat } = getInput();
    const invoke = (format: Format) => {
    if (!timeline) return;
    change({ ...timeline, format });
    setChoosingFormat(false);
  };
    return invoke(...args);
  };

  const splitScreen = (...args: Parameters<(layout: "side" | "stack") => void>) => {
    const { timeline, selected, sourceFor, local, change } = getInput();
    const invoke = (layout: 'side' | 'stack') => {
    if (!timeline || !selected) return;
    const main = mainLayer(timeline).items.find((clip) => selected.start >= clip.start && selected.start < clip.start + clipLength(clip));
    const place = (clip: Clip, slot: 'left' | 'right' | 'top' | 'bottom', at: number) => {
      const source = sourceFor(clip.media_id);
      if (!source) return clip.transform;
      const spot = slotPlacement(source, clip.adjust.rotation, timeline.format, slot);
      return writeValue(writeValue(writeValue(clip.transform, 'x', at, spot.x), 'y', at, spot.y), 'scale', at, spot.scale);
    };
    const [mine, theirs] = layout === 'side' ? ['right', 'left'] as const : ['bottom', 'top'] as const;
    let next = updateClip(timeline, selected.id, { transform: place(selected, mine, local) });
    if (main && !mainLayer(timeline).locked) next = updateClip(next, main.id, { transform: place(main, theirs, selected.start - main.start) });
    change(next);
  };
    return invoke(...args);
  };
  /** Focus drift on every picture of the main track in one step (one undo), each aimed at its own faces or subject. */
  const focusAllPictures = async () => {
    const { timeline, mediaById, change } = getInput();
    if (!timeline) return;
    const pictures = mainLayer(timeline).items.filter((clip) => mediaById.get(clip.media_id)?.media_type === 'image' && !clip.frame_locked);
    const aims = await Promise.all(pictures.map((clip) => aimFor(clip, timeline)));
    let next = getInput().timeline ?? timeline;
    pictures.forEach((clip, index) => {
      const item = mediaById.get(clip.media_id)!;
      const current = findClip(next, clip.id);
      if (!current || !item.width || !item.height) return;
      const fitted = fittedSize({ width: item.width, height: item.height }, current.adjust.rotation, next.format);
      next = updateClip(next, clip.id, { transform: applyMove(current.transform, 'focus-drift', 0, clipLength(current), aims[index], fitted.width / next.format.width, fitted.height / next.format.height) });
    });
    if (next !== timeline) change(next, 'focus-drift');
  };

  return { snapshot, newBackground, updateSelected, clipEffectApplied, applyClipEffect, addMedia, addOverlayMedia, onDropPayload, aimFor, moveSelected, applyToSelected, chooseFormat, splitScreen, focusAllPictures };
}
