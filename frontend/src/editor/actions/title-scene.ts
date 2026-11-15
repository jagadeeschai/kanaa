import { getJobStatus,getPhoto,getSurface,startBrandIntro,startPeopleGrid,startSceneTrack } from "../../api/client";
import { valueAt } from "../../timeline/evaluate";
import { keepClear,removeKeepClear,type PeopleGrid } from "../../timeline/keepClear";
import type { KeepClear } from "../../timeline/model";
import { clipLength,findText,insertClip,mainLayer,newClip,onSkyline,putBehindPerson,removeClip,REST_TRANSFORM,setGroundRiseGap,TITLE_SPACE,updateText,type Clip,type SurfaceKind,type TextItem,type Timeline,type TitlePin } from "../../timeline/model";
import { sourceAt } from "../../timeline/ramp";
import { stayWith } from "../../timeline/stayWith";
import { clipPlacement,invert,pinStretch,pinTrackOptions,sceneMatrix,type SceneTrack } from "../../timeline/title3d";
import type { Photo } from "../../types/photo";
import { PlaybackEngine } from "../playback";

type Input = {
  change: (next: Timeline, group?: string | null) => void;
  engineRef: React.MutableRefObject<PlaybackEngine | null>;
  mediaById: Map<number, Photo>;
  newId: () => string;
  sceneTrackKey: (mediaId: number, stretch: { start: number; end: number; at: number; horizon?: boolean; region?: [number, number] | null; upright?: boolean; }) => string;
  sceneTracks: Record<string, SceneTrack>;
  setClearProgress: React.Dispatch<React.SetStateAction<number | null>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setIntroProgress: React.Dispatch<React.SetStateAction<number | null>>;
  setKeepClearNote: React.Dispatch<React.SetStateAction<{ textId: string; text: string; } | null>>;
  setMedia: React.Dispatch<React.SetStateAction<Photo[]>>;
  setNote: React.Dispatch<React.SetStateAction<string>>;
  setPinProgress: React.Dispatch<React.SetStateAction<number | null>>;
  setPlacing: React.Dispatch<React.SetStateAction<{ textId: string; busy: boolean; } | null>>;
  setSceneTracks: React.Dispatch<React.SetStateAction<Record<string, SceneTrack>>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setStayNote: React.Dispatch<React.SetStateAction<{ textId: string; text: string; } | null>>;
  setStayProgress: React.Dispatch<React.SetStateAction<number | null>>;
  timelineRef: React.MutableRefObject<Timeline | null>;
};

/** Existing editor actions; the input getter preserves render snapshots and forward references. */
export function createTitleSceneActions(getInput: () => Input) {
  const pinTarget = (...args: Parameters<(current: Timeline, text: TextItem) => { clip: Clip; stretch: { horizon: boolean; region: [number, number] | null; upright: boolean; start: number; end: number; at: number; }; key: string; } | null>) => {
    const { sceneTrackKey } = getInput();
    const invoke = (current: Timeline, text: TextItem) => {
    if (!text.pin) return null;
    for (const layer of current.layers) if (layer.kind === 'video') for (const clip of layer.items) {
      if (clip.id !== text.pin.clip_id) continue;
      // With Sky only in front, the title rides the skyline: a different track, asked for when the cover changes too.
      const stretch = { ...pinStretch(clip, text), ...pinTrackOptions(onSkyline(current, text.id), text) };
      return { clip, stretch, key: sceneTrackKey(clip.media_id, stretch) };
    }
    return null;
  };
    return invoke(...args);
  };

  const pinTitle = (...args: Parameters<(text: TextItem, on: boolean, placedPin?: TitlePin) => Promise<void>>) => {
    const { timelineRef, change, engineRef, mediaById, setError, setPinProgress, setSceneTracks, sceneTrackKey } = getInput();
    const invoke = async (text: TextItem, on: boolean, placedPin?: TitlePin) => {
    const current = timelineRef.current;
    if (!current) return;
    if (!on) { change(updateText(current, text.id, { pin: null })); return; }
    const main = mainLayer(current);
    const playhead = engineRef.current?.currentTime ?? text.start;
    const at = placedPin?.at ?? Math.min(Math.max(playhead, text.start), text.start + text.length);
    const clip = main.items.find((item) => placedPin ? item.id === placedPin.clip_id : item.start <= at && at < item.start + clipLength(item));
    if (!clip || mediaById.get(clip.media_id)?.media_type !== 'video') { setError('Lock to the scene needs a video under the title on the main track.'); return; }
    if (clip.reverse || clip.ramp) { setError('Lock to the scene follows clips played forwards at one speed. Turn off Backwards or the speed effect first.'); return; }
    const pinned = { ...text, pin: placedPin ?? { clip_id: clip.id, at } };
    const stretch = { ...pinStretch(clip, pinned), ...pinTrackOptions(onSkyline(current, text.id), pinned) };
    setPinProgress(0);
    try {
      let made = await startSceneTrack(clip.media_id, stretch);
      if (made.status !== 'ready' && made.job_id) {
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const status = await getJobStatus(made.job_id) as unknown as { status?: string; progress: number; error?: string | null; track?: SceneTrack };
          if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error ?? 'Could not follow the camera in this clip.');
          if (status.status === 'done' && status.track) { made = { status: 'ready', track: status.track }; break; }
          setPinProgress(status.progress);
        }
      }
      if (made.track) setSceneTracks((tracks) => ({ ...tracks, [sceneTrackKey(clip.media_id, stretch)]: made.track! }));
      change(updateText(timelineRef.current ?? current, text.id, { pin: pinned.pin }));
    } catch (problem) { setError((problem as Error).message); } finally { setPinProgress(null); }
  };
    return invoke(...args);
  };

  const placeInScene = (...args: Parameters<(text: TextItem, spot: { x: number; y: number; } | null, kind: SurfaceKind | null) => Promise<void>>) => {
    const { timelineRef, engineRef, mediaById, setError, setPlacing, newId, change, setNote } = getInput();
    const invoke = async (text: TextItem, spot: { x: number; y: number } | null, kind: SurfaceKind | null) => {
    const current = timelineRef.current;
    if (!current) return;
    const at = spot ? Math.min(Math.max(engineRef.current?.currentTime ?? text.start, text.start), text.start + text.length) : text.pin?.at ?? text.start;
    const main = mainLayer(current);
    const clip = spot ? main.items.find((item) => item.start <= at && at < item.start + clipLength(item)) : main.items.find((item) => item.id === text.pin?.clip_id);
    const facts = clip && mediaById.get(clip.media_id);
    if (!clip || facts?.media_type !== 'video') { setError('Place in scene needs a video under the title on the main track. Move the playhead onto it.'); return; }
    if (clip.reverse || clip.ramp) { setError('Place in scene follows clips played forwards at one speed. Turn off Backwards or the speed effect first.'); return; }
    const source = { width: facts.width ?? 1920, height: facts.height ?? 1080 };
    // The spot in the source picture (0..1), from the frame, through where the clip sits on it at that moment.
    let region = text.pin?.region ?? null; let place = { x: valueAt(text.transform ?? REST_TRANSFORM, 'x', 0), y: valueAt(text.transform ?? REST_TRANSFORM, 'y', 0) };
    if (spot) {
      const back = invert(clipPlacement(clip, source, current.format, at - clip.start));
      const fx = spot.x * current.format.width, fy = spot.y * current.format.height;
      const w = back[2][0] * fx + back[2][1] * fy + back[2][2];
      region = [(back[0][0] * fx + back[0][1] * fy + back[0][2]) / w, (back[1][0] * fx + back[1][1] * fy + back[1][2]) / w];
      place = spot;
    }
    if (!region || region[0] < 0 || region[0] > 1 || region[1] < 0 || region[1] > 1) { setError('Click on the video itself, not the bars around it.'); return; }
    setPlacing({ textId: text.id, busy: true });
    try {
      const pose = await getSurface(clip.media_id, { t: clip.in + (at - clip.start) * clip.speed, x: region[0], y: region[1], kind });
      const transform = { ...(text.transform ?? REST_TRANSFORM), keyframes: undefined, x: place.x, y: place.y, rotation: pose.turn, tilt_x: pose.tilt_x, tilt_y: pose.tilt_y };
      // The words themselves go on the spot: a title drawn at the top or bottom of its picture would land off it.
      let next = updateText(timelineRef.current ?? current, text.id, { transform, keep_clear: null, stay_with: null, position: 'center', pin: null });
      // People walk in front of a title on a floor or a wall; on the sky the skyline already keeps the land in front.
      const above = (() => { const found = findText(next, text.id); if (!found) return null; return next.layers[next.layers.indexOf(found.layer) + 1]; })();
      if (pose.kind !== 'sky' && !(above?.kind === 'video' && ['Person', 'Object', 'Land', 'In front'].includes(above.name ?? ''))) next = putBehindPerson(next, text.id, [newId(), newId()]);
      change(next, `place-${text.id}`);
      const placed = findText(next, text.id)?.text;
      if (placed) await pinTitle({ ...placed, pin: { clip_id: clip.id, at, region, surface: pose.kind } }, true, { clip_id: clip.id, at, region, surface: pose.kind });
      setNote(pose.kind === 'sky' ? 'On the sky: it rides the skyline as the camera moves.' : pose.found ? `On the ${pose.kind}: it lies on it and stays there as the camera moves. Wrong surface? Pick another under Place in scene.` : pose.kind === 'upright' ? 'Upright, facing you: there were no clear lines of a floor or a wall there. If it is one, pick Floor or Wall.' : `Not enough straight edges there to read this ${pose.kind}'s angle, so it is set as most ${pose.kind}s are. Fine-tune with Lean back and Turn under 3D if needed.`);
    } catch (problem) { setError((problem as Error).message); } finally { setPlacing(null); }
  };
    return invoke(...args);
  };

  const clipUnderTitle = (...args: Parameters<(current: Timeline, text: TextItem) => Clip | null>) => {
    const {  } = getInput();
    const invoke = (current: Timeline, text: TextItem) => {
    const main = mainLayer(current);
    const middle = text.start + text.length / 2;
    return main.items.find((item) => item.start <= middle && middle < item.start + clipLength(item))
      ?? main.items.find((item) => item.start < text.start + text.length && text.start < item.start + clipLength(item)) ?? null;
  };
    return invoke(...args);
  };

  const keepTitleClear = (...args: Parameters<(text: TextItem, settings: Pick<KeepClear, "gap" | "direction" | "max_move" | "who">) => Promise<void>>) => {
    const { timelineRef, mediaById, setError, engineRef, setClearProgress, setKeepClearNote, sceneTracks, change } = getInput();
    const invoke = async (text: TextItem, settings: Pick<KeepClear, 'gap' | 'direction' | 'max_move' | 'who'>) => {
    const current = timelineRef.current;
    if (!current) return;
    const clip = clipUnderTitle(current, text);
    const media = clip && mediaById.get(clip.media_id);
    if (!clip || media?.media_type !== 'video') { setError('Put the title over a video with people in it first.'); return; }
    if (clip.ramp) { setError('This does not work with the speed effect yet. Turn the speed effect off on this clip first.'); return; }
    const box = engineRef.current?.titleBox(text);
    if (!box) { setError('Play the video over this title once, then tick the box again.'); return; }
    // Everyone, unless particular people were chosen in the panel.
    const pick = settings.who ?? null;
    const from = Math.max(clip.start, text.start), to = Math.min(clip.start + clipLength(clip), text.start + text.length);
    const sources = [sourceAt(clip, from - clip.start), sourceAt(clip, to - clip.start)];
    const stretch = { start: Math.max(0, Math.min(...sources)), end: Math.max(...sources) };
    setClearProgress(0); setKeepClearNote(null);
    try {
      let made = await startPeopleGrid(clip.media_id, { ...stretch, pick, steady: Boolean(clip.stabilise), backwards: Boolean(clip.reverse) });
      if (made.status !== 'ready' && made.job_id) {
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const status = await getJobStatus(made.job_id) as unknown as { status?: string; progress: number; error?: string | null; grid?: PeopleGrid };
          if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error ?? 'Could not find the people in this clip.');
          if (status.status === 'done' && status.grid) { made = { status: 'ready', grid: status.grid }; break; }
          setClearProgress(status.progress);
        }
      }
      const latest = timelineRef.current ?? current;
      const fresh = findText(latest, text.id)?.text ?? text;
      const source = { width: media.width || latest.format.width, height: media.height || latest.format.height };
      const pinTo = pinTarget(latest, fresh);
      const track = pinTo && sceneTracks[pinTo.key];
      const result = keepClear({ text: fresh, box, format: latest.format, under: clip, source, grid: made.grid!, settings,
        pinAt: track && pinTo ? (time) => sceneMatrix(track, pinTo.clip, source, latest.format, time, fresh.pin!.at) : undefined });
      change(updateText(latest, text.id, { transform: result.transform, keep_clear: result.keep_clear }), `keep-clear-${text.id}`);
      const times = result.uncleared.map(([from, to]) => (to - from < 0.2 ? `${from.toFixed(1)} s` : `${from.toFixed(1)}–${to.toFixed(1)} s`)).join(', ');
      setKeepClearNote({ textId: text.id, text: result.uncleared.length
        ? `Mostly clear. Someone still touches the title at ${times}. Try "A little" space, or another way to move.`
        : 'Done. The title moves out of their way and comes back after they pass.' });
    } catch (problem) { setError((problem as Error).message); } finally { setClearProgress(null); }
  };
    return invoke(...args);
  };

  const addBrandIntro = (...args: Parameters<(logo: Photo, tamil: string, english: string) => Promise<void>>) => {
    const { timelineRef, setIntroProgress, setMedia, newId, change, setNote, setError } = getInput();
    const invoke = async (logo: Photo, tamil: string, english: string) => {
    const current = timelineRef.current;
    if (!current) return;
    setIntroProgress(0);
    try {
      let made = await startBrandIntro(logo.id, current.format.width, current.format.height, tamil, english);
      while (made.status !== 'ready' && made.job_id) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        const status = await getJobStatus(made.job_id) as unknown as { status?: string; progress: number; error?: string | null; media_id?: number };
        if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error ?? 'Could not make the brand intro.');
        if (status.status === 'done' && status.media_id) made = { status: 'ready', media_id: status.media_id };
        else setIntroProgress(status.progress);
      }
      const item = await getPhoto(made.media_id!);
      setMedia((list) => (list.some((entry) => entry.id === item.id) ? list : [item, ...list]));
      const latest = timelineRef.current ?? current;
      const old = mainLayer(latest).items.find((clip) => clip.id.startsWith('brand-intro'));
      const without = old ? removeClip(latest, old.id) : latest;
      const clip = { ...newClip({ media_id: item.id, media_type: 'video', duration: item.duration ?? 5.5, width: item.width, height: item.height }, `brand-intro-${newId()}`), muted: true, name: 'Brand intro' };
      change(insertClip(without, clip, 0), 'brand-intro');
      setNote('Brand intro added at the start. Play from the beginning to see it.');
    } catch (problem) { setError((problem as Error).message); } finally { setIntroProgress(null); }
  };
    return invoke(...args);
  };

  const stayWithPeople = (...args: Parameters<(text: TextItem) => Promise<void>>) => {
    const { timelineRef, mediaById, setError, engineRef, setStayProgress, setStayNote, newId, change, setSelectedId, setKeepClearNote } = getInput();
    const invoke = async (text: TextItem) => {
    const current = timelineRef.current;
    if (!current) return;
    const clip = clipUnderTitle(current, text);
    const media = clip && mediaById.get(clip.media_id);
    if (!clip || media?.media_type !== 'video') { setError('Put the title over a video with people in it first.'); return; }
    if (clip.ramp) { setError('This does not work with the speed effect yet. Turn the speed effect off on this clip first.'); return; }
    const box = engineRef.current?.titleBox(text);
    if (!box) { setError('Play the video over this title once, then try again.'); return; }
    engineRef.current?.pause();
    const playhead = engineRef.current?.currentTime ?? text.start;
    const at = Math.min(text.length, Math.max(0, playhead - text.start));
    const from = Math.max(clip.start, text.start), to = Math.min(clip.start + clipLength(clip), text.start + text.length);
    const sources = [sourceAt(clip, from - clip.start), sourceAt(clip, to - clip.start)];
    setStayProgress(0); setStayNote(null);
    try {
      let made = await startPeopleGrid(clip.media_id, { start: Math.max(0, Math.min(...sources)), end: Math.max(...sources), pick: null, steady: Boolean(clip.stabilise), backwards: Boolean(clip.reverse) });
      if (made.status !== 'ready' && made.job_id) {
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const status = await getJobStatus(made.job_id) as unknown as { status?: string; progress: number; error?: string | null; grid?: PeopleGrid };
          if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error ?? 'Could not find the people in this clip.');
          if (status.status === 'done' && status.grid) { made = { status: 'ready', grid: status.grid }; break; }
          setStayProgress(status.progress);
        }
      }
      const latest = timelineRef.current ?? current;
      const found = findText(latest, text.id)?.text ?? text;
      // From how the title sits by itself: not locked to the scene and not moved aside.
      const fresh: TextItem = { ...found, ...(found.keep_clear ? removeKeepClear(found) : {}), pin: null };
      const source = { width: media.width || latest.format.width, height: media.height || latest.format.height };
      const result = stayWith({ text: fresh, box, format: latest.format, under: clip, source, grid: made.grid!, at });
      if (!result) { setStayNote({ textId: text.id, text: 'No people were found near the title at this moment. Move the playhead to where they are clear and not too far away, then try again.' }); return; }
      let next = updateText(latest, text.id, { transform: result.transform, stay_with: result.stay_with, keep_clear: null, pin: null });
      // Like a real banner on the far side of them: the people pass in front of it, with a thin steady margin so letters at their edges don't flicker.
      const placed = findText(next, text.id);
      const above = placed && next.layers[next.layers.indexOf(placed.layer) + 1];
      if (!(above?.kind === 'video' && ['Person', 'Object', 'Land', 'In front'].includes(above.name ?? ''))) {
        next = putBehindPerson(next, text.id, [newId(), newId()]);
        next = setGroundRiseGap(next, text.id, TITLE_SPACE.close);
      }
      change(next, `stay-${text.id}`);
      setSelectedId(text.id);
      setKeepClearNote(null);
      setStayNote({ textId: text.id, text: result.lost > 0.5 ? `Done. It stays with them and changes size as they come nearer or go further. For ${result.lost} s they could not be seen (too far, or out of the picture); it holds its place there. Press Play to check.` : 'Done. It stays with them, changes size as they come nearer or go further, and they pass in front of it like a real banner. Press Play to check.' });
    } catch (problem) { setError((problem as Error).message); } finally { setStayProgress(null); }
  };
    return invoke(...args);
  };
  return { pinTarget, pinTitle, placeInScene, clipUnderTitle, keepTitleClear, addBrandIntro, stayWithPeople };
}
