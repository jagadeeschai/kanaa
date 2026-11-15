import type { Transform } from '../../timeline/evaluate';
import { startFaces,startTracking } from "../../api/client";
import { DEFAULT_CHROMA } from "../../timeline/chroma";
import { valueAt } from "../../timeline/evaluate";
import { writeValue } from "../../timeline/keyframes";
import type { AdjustLayer,BlurLayer,TextLayer } from '../../timeline/model';
import { clipLength,findBlur,findClip,findText,mainLayer,MIN_CLIP_SECONDS,REST_TRANSFORM,timecode,updateBlur,updateClip,updateText,type AudioLayer,type BlurBox,type CaptionLayer,type CinemaReveal,type Clip,type SurfaceKind,type TextItem,type Timeline,type VideoLayer } from "../../timeline/model";
import { localAt,sourceAt } from "../../timeline/ramp";
import { clipBox } from "../../timeline/resize";
import { blurForFace,boxInSource,faceUnder,followPath,videoUnder,type TrackPoint } from "../../timeline/tracking";
import { MIN_DRAWN_BOX,ON_ITEM } from "../editor-constants";
import { PlaybackEngine,type PlaybackSource } from "../playback";
type Box = [number, number, number, number];
type FollowJob = { itemId: string; underId: string; jobId: string; progress: number; queued?: boolean; drawnAt: number; from: number; size: boolean; place: Box | null; own: boolean; grew: boolean;
  /** Set while looking for a face under a blur box: where the box is in the source, and what to follow instead when no face is there. */
  faces?: { box: Box; at: number; own: Box; grow?: number } };

type Input = {
  blurLocal: number;
  change: (next: Timeline, group?: string | null) => void;
  dragPreview: React.MutableRefObject<{ x: number; y: number; clipX: number; clipY: number; group: string; } | null>;
  drawing: { mode: "start" | "continue"; from?: [number, number]; to?: [number, number]; onBox?: (box: Box) => void; } | null;
  drawStart: React.MutableRefObject<[number, number] | null>;
  engineRef: React.MutableRefObject<PlaybackEngine | null>;
  followSize: boolean;
  followTarget: { id: string; start: number; length: number; transform: Transform; } | null;
  isVideo: (id: number) => boolean;
  local: number;
  moving: { transform: Transform; local: number; update: (transform: Clip["transform"], group?: string) => void; } | null;
  pickingKey: boolean;
  placeInScene: (text: TextItem, spot: { x: number; y: number; } | null, kind: SurfaceKind | null) => Promise<void>;
  placing: { textId: string; busy: boolean; } | null;
  playhead: { current: number; };
  seek: (t: number) => void | undefined;
  selected: Clip | null;
  selectedBlur: BlurBox | null;
  selectedId: string | null;
  selectedLayer: VideoLayer | AudioLayer | TextLayer | CaptionLayer | BlurLayer | AdjustLayer | undefined;
  setDrawing: React.Dispatch<React.SetStateAction<{ mode: "start" | "continue"; from?: [number, number]; to?: [number, number]; onBox?: (box: Box) => void; } | null>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setFollowJob: React.Dispatch<React.SetStateAction<FollowJob | null>>;
  setFollowNote: React.Dispatch<React.SetStateAction<{ itemId: string; text: string; } | null>>;
  setLayerSettings: React.Dispatch<React.SetStateAction<string | null>>;
  setPickedInPreview: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  shaping: { textId: string; mode: "ground" | "outline"; points: [number, number][]; reveal?: CinemaReveal; } | null;
  sourceFor: (id: number, clip?: Clip) => PlaybackSource | undefined;
  stopPicking: () => void;
  timeline: Timeline | null;
  timelineRef: React.MutableRefObject<Timeline | null>;
  titleAt: (fx: number, fy: number) => TextItem | null;
  updateSelected: (changes: Partial<Clip>, group?: string | undefined) => void;
  updateSelectedBlur: (changes: Partial<BlurBox>, group?: string) => void;
};

/** Existing editor actions; the input getter preserves render snapshots and forward references. */
export function createPreviewTrackingActions(getInput: () => Input) {
  const previewDown = (...args: Parameters<(event: React.PointerEvent<HTMLCanvasElement>) => void>) => {
    const { placing, timeline, placeInScene, pickingKey, selected, engineRef, updateSelected, stopPicking, drawing, shaping, titleAt, setPickedInPreview, selectedId, setLayerSettings, setSelectedId, moving, selectedLayer, dragPreview } = getInput();
    const invoke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (placing && !placing.busy && timeline) {
      const rect = event.currentTarget.getBoundingClientRect();
      const text = findText(timeline, placing.textId)?.text;
      if (text) void placeInScene(text, { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }, null);
      return;
    }
    if (pickingKey && selected) {
      const rect = event.currentTarget.getBoundingClientRect();
      const color = engineRef.current?.sampleColor((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
      if (color) updateSelected({ chroma: { ...(selected.chroma ?? DEFAULT_CHROMA), color } });
      stopPicking();
      return;
    }
    // A click on a title in the preview picks it, as a click on the timeline does.
    if (event.button === 0 && !event.ctrlKey && !drawing && !shaping) {
      const rect = event.currentTarget.getBoundingClientRect();
      const hit = titleAt((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
      if (hit) { setPickedInPreview(hit.id); if (hit.id !== selectedId) { setLayerSettings(null); setSelectedId(hit.id); return; } }
    }
    if (!moving || selectedLayer?.locked || selected?.enabled === false || selected?.frame_locked || event.button !== 0 || event.ctrlKey) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragPreview.current = { x: event.clientX, y: event.clientY, clipX: valueAt(moving.transform, 'x', moving.local), clipY: valueAt(moving.transform, 'y', moving.local), group: `move-${Date.now()}` };
  };
    return invoke(...args);
  };

  const previewMove = (...args: Parameters<(event: React.PointerEvent<HTMLCanvasElement>) => void>) => {
    const { dragPreview, moving } = getInput();
    const invoke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragPreview.current;
    if (!drag || !moving) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const moved = writeValue(moving.transform, 'x', moving.local, drag.clipX + (event.clientX - drag.x) / rect.width);
    moving.update(writeValue(moved, 'y', moving.local, drag.clipY + (event.clientY - drag.y) / rect.height), drag.group);
  };
    return invoke(...args);
  };

  const startDrawing = (...args: Parameters<(mode: "start" | "continue") => void>) => {
    const { timeline, followTarget, engineRef, playhead, setError, isVideo, setFollowNote, setDrawing } = getInput();
    const invoke = (mode: 'start' | 'continue') => {
    if (!timeline || !followTarget) return;
    engineRef.current?.pause();
    const t = playhead.current;
    if (t < followTarget.start || t >= followTarget.start + followTarget.length) { setError('Move the playhead onto the selected item first.'); return; }
    if (!videoUnder(timeline, followTarget.id, t, isVideo)) { setError('There is no video under this item at the playhead to follow.'); return; }
    setFollowNote(null);
    setDrawing({ mode });
  };
    return invoke(...args);
  };

  const frameAt = (...args: Parameters<(event: React.PointerEvent<HTMLElement>) => [number, number]>) => {
    const {  } = getInput();
    const invoke = (event: React.PointerEvent<HTMLElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))];
  };
    return invoke(...args);
  };

  const drawnBox = (...args: Parameters<(state: { mode: "start" | "continue"; from?: [number, number]; to?: [number, number]; onBox?: (box: Box) => void; } | null) => Box | null>) => {
    const { drawing } = getInput();
    const invoke = (state: typeof drawing): Box | null => {
    if (!state?.from || !state.to) return null;
    const [x0, y0] = state.from; const [x1, y1] = state.to;
    return [(x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0)];
  };
    return invoke(...args);
  };

  const startFollowing = (...args: Parameters<(box: Box, mode: "start" | "continue", own?: boolean, until?: number) => Promise<void>>) => {
    const { timeline, followTarget, playhead, isVideo, sourceFor, setError, setFollowJob, followSize, selectedBlur } = getInput();
    const invoke = async (box: Box, mode: 'start' | 'continue', own = false, until?: number) => {
    if (!timeline || !followTarget) return;
    const t = playhead.current;
    const under = videoUnder(timeline, followTarget.id, t, isVideo);
    const source = under && sourceFor(under.media_id);
    if (!under || !source) return;
    const sourceBox = boxInSource(under, source, timeline.format, t - under.start, box);
    if (!sourceBox) { setError('Draw the box on the video itself.'); return; }
    const toSource = (time: number) => sourceAt(under, time - under.start);
    const first = mode === 'continue' ? t : Math.max(followTarget.start, under.start);
    const last = until ?? Math.min(followTarget.start + followTarget.length, under.start + clipLength(under));
    try {
      const { job_id } = await startTracking(under.media_id, { at: toSource(t), start: Math.min(toSource(first), toSource(last)), end: Math.max(toSource(first), toSource(last)), box: sourceBox });
      const drawnAt = t - followTarget.start;
      setFollowJob({ itemId: followTarget.id, underId: under.id, jobId: job_id, progress: 0, drawnAt, from: mode === 'continue' ? drawnAt : 0, size: followSize, place: selectedBlur ? box : null, own, grew: until !== undefined });
    } catch (problem) { setError((problem as Error).message); }
  };
    return invoke(...args);
  };

  const ownBox = (...args: Parameters<() => Box | null>) => {
    const { timeline, selectedBlur, blurLocal, selected, selectedLayer, sourceFor, local } = getInput();
    const invoke = (): Box | null => {
    if (!timeline) return null;
    if (selectedBlur) { const size = valueAt(selectedBlur.transform, 'scale', blurLocal); return [valueAt(selectedBlur.transform, 'x', blurLocal), valueAt(selectedBlur.transform, 'y', blurLocal), selectedBlur.width * size, selectedBlur.height * size]; }
    if (selected && selectedLayer && selectedLayer !== mainLayer(timeline)) {
      const source = sourceFor(selected.media_id);
      if (!source) return null;
      const box = clipBox(selected, source, timeline.format, local);
      return [box.x, box.y, box.width, box.height];
    }
    return null;
  };
    return invoke(...args);
  };

  const followHere = (...args: Parameters<(mode: "start" | "continue") => Promise<void>>) => {
    const { timeline, followTarget, engineRef, playhead, setError, seek, isVideo, setFollowNote, selectedBlur, sourceFor, setFollowJob, followSize, updateSelectedBlur } = getInput();
    const invoke = async (mode: 'start' | 'continue') => {
    if (!timeline || !followTarget) return;
    engineRef.current?.pause();
    let t = playhead.current;
    if (t < followTarget.start - ON_ITEM || t >= followTarget.start + followTarget.length) { setError('Move the playhead onto the selected item first.'); return; }
    if (t < followTarget.start) { t = followTarget.start; seek(t); playhead.current = t; }
    if (!videoUnder(timeline, followTarget.id, playhead.current, isVideo)) { setError('There is no video under it to follow.'); return; }
    const box = ownBox();
    if (!box) { startDrawing(mode); return; }
    setFollowNote(null);
    // A blur follows for as long as the video under it lasts, not just its first few seconds; it ends where the face is lost.
    const under = videoUnder(timeline, followTarget.id, t, isVideo)!;
    const end = under.start + clipLength(under);
    const grow = selectedBlur && mode === 'start' && end > selectedBlur.start + selectedBlur.length + 0.05 ? end : undefined;
    const own: Box = [box[0], box[1], Math.min(1, box[2]), Math.min(1, box[3])];
    // On a face, the face finder follows it far better than following the square: it does not drift onto hair or background.
    const source = sourceFor(under.media_id);
    const sourceBox = selectedBlur && mode === 'start' && source ? boxInSource(under, source, timeline.format, t - under.start, own) : null;
    if (selectedBlur && sourceBox) {
      try {
        const { job_id } = await startFaces(under.media_id, { start: under.in, end: under.out });
        setFollowJob({ itemId: selectedBlur.id, underId: under.id, jobId: job_id, progress: 0, drawnAt: t - selectedBlur.start, from: 0, size: followSize, place: own, own: true, grew: false, faces: { box: sourceBox, at: sourceAt(under, t - under.start), own, grow } });
      } catch (problem) { setError((problem as Error).message); }
      return;
    }
    if (grow !== undefined && selectedBlur) updateSelectedBlur({ length: grow - selectedBlur.start });
    void startFollowing(own, mode, true, grow);
  };
    return invoke(...args);
  };

  const finishDrawing = (...args: Parameters<(event: React.PointerEvent<HTMLElement>) => void>) => {
    const { drawStart, drawing, setDrawing } = getInput();
    const invoke = (event: React.PointerEvent<HTMLElement>) => {
    const box = drawnBox({ mode: 'start', from: drawStart.current ?? undefined, to: frameAt(event) });
    const mode = drawing?.mode ?? 'start';
    const onBox = drawing?.onBox;
    drawStart.current = null;
    setDrawing(null);
    if (!box || box[2] <= MIN_DRAWN_BOX || box[3] <= MIN_DRAWN_BOX) return;
    if (onBox) onBox(box); else void startFollowing(box, mode);  // A panel asked for a box (marking lamps), or Follow did.
  };
    return invoke(...args);
  };

  const applyFaces = (...args: Parameters<(job: FollowJob, faces: TrackPoint[][]) => void>) => {
    const { timelineRef, sourceFor, change, setFollowNote, selectedBlur, updateSelectedBlur } = getInput();
    const invoke = (job: FollowJob, faces: TrackPoint[][]) => {
    const current = timelineRef.current;
    const under = current && findClip(current, job.underId);
    const source = under && sourceFor(under.media_id);
    const blur = current && findBlur(current, job.itemId)?.blur;
    if (!current || !under || !source || !blur || !job.faces) return;
    const path = faceUnder(faces, job.faces.box, job.faces.at);
    const found = path && blurForFace(path, under, source, current.format, blur.id);
    if (found) {
      change(updateBlur(current, blur.id, { start: found.start, length: found.length, width: found.width, height: found.height, transform: found.transform }));
      setFollowNote({ itemId: blur.id, text: `Found the face. The blur follows it from ${timecode(found.start)} to ${timecode(found.start + found.length)}. Press Play to check.` });
      return;
    }
    if (selectedBlur?.id !== blur.id) return;
    const { grow, own } = job.faces;
    if (grow !== undefined) updateSelectedBlur({ length: grow - blur.start });
    void startFollowing(own, 'start', true, grow);
  };
    return invoke(...args);
  };

  const applyFollow = (...args: Parameters<(job: FollowJob, track: { points: TrackPoint[]; lost_before: boolean; lost_after: boolean; }) => void>) => {
    const { timelineRef, sourceFor, change, setFollowNote } = getInput();
    const invoke = (job: FollowJob, track: { points: TrackPoint[]; lost_before: boolean; lost_after: boolean }) => {
    const current = timelineRef.current;
    const under = current && findClip(current, job.underId);
    const source = under && sourceFor(under.media_id);
    const clip = current && findClip(current, job.itemId);
    const blur = current && findBlur(current, job.itemId)?.blur;
    const text = current && findText(current, job.itemId)?.text;
    if (!current || !under || !source || (!clip && !blur && !text) || !track.points.length) return;
    const item = clip ? { start: clip.start, length: clipLength(clip), transform: clip.transform } : blur ? { ...blur, transform: blur.transform } : { ...text!, transform: text!.transform ?? REST_TRANSFORM };
    let { transform } = item;
    let placed: Partial<BlurBox> = {};
    if (blur && job.place) {
      // A blur box sits right on what was drawn, so it covers that, not the spot it was in before.
      const [x, y, w, h] = job.place;
      const scale = job.from > 0 ? valueAt(transform, 'scale', job.drawnAt) : 1;
      transform = writeValue(writeValue(job.from > 0 ? transform : { ...transform, scale: 1, keyframes: { ...transform.keyframes, x: undefined, y: undefined, ...(job.size ? { scale: undefined } : {}) } }, 'x', job.drawnAt, x), 'y', job.drawnAt, y);
      if (job.from === 0) placed = { width: Math.max(0.02, Math.min(1, w / scale)), height: Math.max(0.02, Math.min(1, h / scale)) };
    }
    const followed = followPath({ start: item.start, length: item.length, transform }, under, source, current.format, track.points, { size: job.size, drawnAt: job.drawnAt, from: job.from });
    const timeOf = (point: TrackPoint) => under.start + localAt(under, point[0]);
    // A blur Follow stretched to the end of the video ends where the face was lost, rather than sitting still over nothing.
    const lostAt = timeOf(track.points[track.points.length - 1]);
    const cut = Boolean(blur && job.grew && track.lost_after && lostAt > blur.start + MIN_CLIP_SECONDS);
    if (cut) placed = { ...placed, length: lostAt - blur!.start };
    change(clip ? updateClip(current, clip.id, { transform: followed }) : blur ? updateBlur(current, blur.id, { ...placed, transform: followed }) : updateText(current, text!.id, { transform: followed }));
    if (cut) { setFollowNote({ itemId: job.itemId, text: `Followed until ${timecode(lostAt)}, where the face was lost, so the blur ends there. Press Play to check.` }); return; }
    const lost = track.lost_after ? `Lost it at ${timecode(timeOf(track.points[track.points.length - 1]))}. Move the playhead there${job.own ? ', put it back over what it covers,' : ','} then choose Continue from here.`
      : track.lost_before ? `Lost it before ${timecode(timeOf(track.points[0]))}. It stays still until then.` : '';
    setFollowNote({ itemId: job.itemId, text: lost || (job.own ? 'Done: it now follows what is under it. Press Play to check.' : 'Done: it now follows what you drew around. Press Play to check.') });
  };
    return invoke(...args);
  };
  return { previewDown, previewMove, startDrawing, frameAt, drawnBox, startFollowing, ownBox, followHere, finishDrawing, applyFaces, applyFollow };
}
