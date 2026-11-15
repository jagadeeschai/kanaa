import { faceFinderReady,getJobStatus,getPhoto,makeEffect,startFaces,startPreviewRender,startReframe,startScenes,waitForJob,type EffectInfo } from "../../api/client";
import { coverBrand } from "../../timeline/brand";
import { keepCaptionsClear,type FacePath } from "../../timeline/clear-faces";
import { dropClip,placeEffect } from "../../timeline/drop";
import { addBlur,BLUR_SECONDS,captionLayers,clipLength,DEFAULT_BLUR,exportFormat,findClip,mainLayer,newClip,type BlurBox,type Clip,type SourceFacts,type Timeline } from "../../timeline/model";
import { videoAt } from "../../timeline/tracking";
import type { Photo } from "../../types/photo";
import { newId,PREVIEW_SHORT_SIDE } from "../editor-constants";
import { PlaybackEngine } from "../playback";

type Input = {
  change: (next: Timeline, group?: string | null) => void;
  clearing: boolean;
  effectBusy: { id: string; progress: number; } | null;
  effects: EffectInfo[];
  engineRef: React.MutableRefObject<PlaybackEngine | null>;
  isVideo: (id: number) => boolean;
  mediaById: Map<number, Photo>;
  playhead: { current: number; };
  projectId: number;
  reframeJob: { jobId: string; clipId: string; progress: number; } | null;
  setClearing: React.Dispatch<React.SetStateAction<boolean>>;
  setClearNote: React.Dispatch<React.SetStateAction<string | null>>;
  setEffectBusy: React.Dispatch<React.SetStateAction<{ id: string; progress: number; } | null>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setFaceJob: React.Dispatch<React.SetStateAction<{ jobId: string; clipId: string; progress: number; } | null>>;
  setFaceNote: React.Dispatch<React.SetStateAction<string>>;
  setMedia: React.Dispatch<React.SetStateAction<Photo[]>>;
  setReframeJob: React.Dispatch<React.SetStateAction<{ jobId: string; clipId: string; progress: number; } | null>>;
  setRenderJob: React.Dispatch<React.SetStateAction<{ id: string; key: string; progress: number; } | null>>;
  setSceneJob: React.Dispatch<React.SetStateAction<{ jobId: string; clipId: string; progress: number; } | null>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  timeline: Timeline | null;
  timelineRef: React.MutableRefObject<Timeline | null>;
  weather: { rainDensity: number; rainSpeed: number; rainDirection: "left" | "straight" | "right"; frequency: number; brightness: number; fogDensity: number; fogSpeed: number; fogDirection: "left" | "straight" | "right"; snowDensity: number; snowSpeed: number; snowDirection: "left" | "straight" | "right"; seed: number; };
};

/** Existing editor actions; the input getter preserves render snapshots and forward references. */
export function createEffectJobActions(getInput: () => Input) {
  const renderPreview = (...args: Parameters<() => Promise<void>>) => {
    const { timeline, engineRef, projectId, setRenderJob, setError } = getInput();
    const invoke = async () => {
    if (!timeline) return;
    engineRef.current?.pause();
    try {
      const { job_id } = await startPreviewRender(projectId, { ...coverBrand(timeline), format: exportFormat(timeline.format, PREVIEW_SHORT_SIDE) });
      setRenderJob({ id: job_id, key: JSON.stringify(timeline), progress: 0 });
    } catch (problem) { setError((problem as Error).message); }
  };
    return invoke(...args);
  };

  const addBlurBox = (...args: Parameters<(style: BlurBox["style"], at?: [number, number]) => void>) => {
    const { timeline, engineRef, change, setSelectedId } = getInput();
    const invoke = (style: BlurBox['style'], at?: [number, number]) => {
    if (!timeline) return;
    const blur: BlurBox = { ...DEFAULT_BLUR, style, id: newId(), start: Math.round((engineRef.current?.currentTime ?? 0) * 1000) / 1000, length: BLUR_SECONDS, transform: { ...DEFAULT_BLUR.transform, ...(at ? { x: at[0], y: at[1] } : {}) } };
    change(addBlur(timeline, blur, newId()));
    setSelectedId(blur.id);
  };
    return invoke(...args);
  };

  const addEffect = (...args: Parameters<(effectId: string, dropAt?: number, length?: number, around?: Partial<Clip["transform"]>) => Promise<void>>) => {
    const { timeline, effectBusy, engineRef, setEffectBusy, weather, setMedia, timelineRef, effects, change, setSelectedId, setError } = getInput();
    const invoke = async (effectId: string, dropAt?: number, length?: number, around?: Partial<Clip['transform']>) => {
    if (!timeline || effectBusy) return;
    const at = Math.round((dropAt ?? engineRef.current?.currentTime ?? 0) * 1000) / 1000;
    const format = timeline.format;
    setEffectBusy({ id: effectId, progress: 0 });
    try {
      const direction = { left: -0.35, straight: 0, right: 0.35 } as const;
      const options = effectId === 'rain' ? { density: weather.rainDensity, speed: weather.rainSpeed, direction: direction[weather.rainDirection], seed: weather.seed }
        : effectId === 'lightning' ? { frequency: weather.frequency, brightness: weather.brightness, seed: weather.seed }
          : effectId === 'fog' ? { density: weather.fogDensity, speed: weather.fogSpeed, direction: direction[weather.fogDirection], seed: weather.seed }
            : effectId === 'snow' ? { density: weather.snowDensity, speed: weather.snowSpeed, direction: direction[weather.snowDirection], seed: weather.seed } : undefined;
      const made = await makeEffect(effectId, { width: format.width, height: format.height }, options);
      let item = made.media;
      if (!item && made.job_id) {
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, 600));
          const status = await getJobStatus(made.job_id) as unknown as { status?: string; progress: number; error?: string | null; media_id?: number };
          if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error ?? 'Could not make this effect.');
          if (status.status === 'done' && status.media_id) { item = await getPhoto(status.media_id); break; }
          setEffectBusy({ id: effectId, progress: status.progress });
        }
      }
      if (!item) throw new Error('Could not make this effect.');
      const made2 = item;
      setMedia((current) => (current.some((each) => each.id === made2.id) ? current : [made2, ...current]));
      const source: SourceFacts = { media_id: made2.id, media_type: 'video', duration: made2.duration, width: made2.width, height: made2.height };
      const current = timelineRef.current ?? timeline;
      // A film leader opens the video: an ordinary clip at the very start of the main track, with its beep.
      const opening = effects.find((effect) => effect.id === effectId)?.placement === 'start';
      const whole = { ...newClip(source, newId()), start: opening ? 0 : at, muted: !opening };
      if (around && length) {
        // Around a title's words: the 5-second effect repeats for as long as the title shows, sized to its letters.
        let next = current; let first: string | null = null;
        for (let offset = 0; offset < length - 0.05; offset += whole.out - whole.in) {
          const piece = { ...whole, id: newId(), start: Math.round((at + offset) * 1000) / 1000, out: Math.round(Math.min(whole.out, whole.in + length - offset) * 1000) / 1000, transform: { ...whole.transform, ...around } };
          next = placeEffect(next, piece, newId()); first ??= piece.id;
        }
        change(next); setSelectedId(first);
        return;
      }
      // For a title's effect: only as long as the title.
      const clip = length && !opening ? { ...whole, out: Math.min(whole.out, Math.round((whole.in + length) * 1000) / 1000) } : whole;
      change(opening ? dropClip(current, clip, 0) : placeEffect(current, clip, newId()));
      setSelectedId(clip.id);
    } catch (problem) { setError((problem as Error).message); } finally { setEffectBusy(null); }
  };
    return invoke(...args);
  };

  const keepClearOfFaces = (...args: Parameters<() => Promise<void>>) => {
    const { timeline, clearing, isVideo, setClearNote, setClearing, timelineRef, mediaById, change } = getInput();
    const invoke = async () => {
    if (!timeline || clearing) return;
    const captions = captionLayers(timeline).flatMap((layer) => layer.items);
    const clips = mainLayer(timeline).items.filter((clip) => isVideo(clip.media_id) && captions.some((caption) => caption.start < clip.start + clipLength(clip) && clip.start < caption.start + caption.length));
    if (!clips.length) { setClearNote('No videos under the captions to look at.'); return; }
    try {
      if (!await askForFaceFinder('Keep captions clear of faces')) return;
      setClearing(true);
      const faces = new Map<string, FacePath[]>();
      for (const [number, clip] of clips.entries()) {
        setClearNote(`Looking for faces… clip ${number + 1} of ${clips.length}`);
        const { job_id } = await startFaces(clip.media_id, { start: clip.in, end: clip.out });
        const found = await waitForJob<{ faces: FacePath[] }>(job_id, (progress) => setClearNote(`Looking for faces… clip ${number + 1} of ${clips.length}, ${progress}%`));
        faces.set(clip.id, found.faces);
      }
      const current = timelineRef.current ?? timeline;
      const result = keepCaptionsClear(current, faces, (id) => { const item = mediaById.get(id); return item?.width && item.height ? { width: item.width, height: item.height } : undefined; });
      if (result.moved) change(result.timeline);
      setClearNote(result.moved ? `Moved ${result.moved} caption${result.moved === 1 ? '' : 's'} clear of faces. ⌘Z undoes it. Making captions again puts them all back in place.` : 'No caption covers a face.');
    } catch (problem) { setClearNote((problem as Error).message); } finally { setClearing(false); }
  };
    return invoke(...args);
  };

  const askForFaceFinder = (...args: Parameters<(what: string) => Promise<boolean>>) => {
    const {  } = getInput();
    const invoke = async (what: string) => {
    if ((await faceFinderReady()).ready) return true;
    return window.confirm(`${what} uses OpenCV's face finder (YuNet, about 230 KB). It isn't on this Mac yet. Download it once now? It stays on this Mac and Blur faces uses it too.`);
  };
    return invoke(...args);
  };

  const reframeClip = (...args: Parameters<(clipId: string) => Promise<void>>) => {
    const { timeline, isVideo, reframeJob, engineRef, setFaceNote, setReframeJob, setError } = getInput();
    const invoke = async (clipId: string) => {
    const clip = timeline && findClip(timeline, clipId);
    if (!clip || !isVideo(clip.media_id) || reframeJob) return;
    engineRef.current?.pause();
    try {
      if (!await askForFaceFinder('Follow the person')) return;
      setFaceNote('');
      const { job_id } = await startReframe(clip.media_id, { start: clip.in, end: clip.out, allow_download: true });
      setReframeJob({ jobId: job_id, clipId, progress: 0 });
    } catch (problem) { setError((problem as Error).message); }
  };
    return invoke(...args);
  };

  const splitScenes = (...args: Parameters<(clipId: string) => Promise<void>>) => {
    const { timeline, isVideo, engineRef, setFaceNote, setSceneJob, setError } = getInput();
    const invoke = async (clipId: string) => {
    const clip = timeline && findClip(timeline, clipId);
    if (!clip || !isVideo(clip.media_id)) return;
    engineRef.current?.pause();
    setFaceNote('');
    try {
      const { job_id } = await startScenes(clip.media_id, { start: clip.in, end: clip.out });
      setSceneJob({ jobId: job_id, clipId, progress: 0 });
    } catch (problem) { setError((problem as Error).message); }
  };
    return invoke(...args);
  };

  const blurFaces = (...args: Parameters<() => Promise<void>>) => {
    const { timeline, engineRef, playhead, isVideo, setError, setFaceNote, setFaceJob } = getInput();
    const invoke = async () => {
    if (!timeline) return;
    engineRef.current?.pause();
    const clip = videoAt(timeline, playhead.current, isVideo);
    if (!clip) { setError('Move the playhead onto a video first.'); return; }
    setFaceNote('');
    try {
      const { job_id } = await startFaces(clip.media_id, { start: clip.in, end: clip.out });
      setFaceJob({ jobId: job_id, clipId: clip.id, progress: 0 });
    } catch (problem) { setError((problem as Error).message); }
  };
    return invoke(...args);
  };
  return { addEffect, keepClearOfFaces, reframeClip, splitScenes, blurFaces, askForFaceFinder, renderPreview, addBlurBox };
}
