import { openPanelTab } from "../layout";
import { deleteAndStretch, factsFrom, isSongVideo, replaceClips } from "../../timeline/songSafe";
import { openAiEdit } from "../AiEditDialog";
import { openBringToLife } from "../BringToLifeDialog";
import { openRemovePerson } from "../RemovePersonDialog";
import type { Clipboard,CopiedStyle } from '../../timeline/clipboard';
import { clipEffects,removeEffect,toggleAllEffects,toggleEffect } from "../../timeline/effects";
import type { Transform } from '../../timeline/evaluate';
import { type History } from "../../timeline/history";
import { clipLength,findBlur,findCaption,findClip,findSound,findText,layerOf,mainLayer,overlayLayers,removeBlur,removeCaption,removeClip,removeMedia,removeSound,removeText,reorderLayer,splitClip,splitSound,updateClip,updateLayer,updateSound,type BlurBox,type Clip,type Timeline } from "../../timeline/model";
import { canReframe } from "../../timeline/reframe";
import type { Photo } from "../../types/photo";
import { isEditable,type MenuItem,type MenuState } from "../ContextMenu";
import { newId } from "../editor-constants";
import { findAdjust, removeAdjust } from '../../timeline/adjust';
type Action = { type: 'load'; timeline: Timeline } | { type: 'change'; timeline: Timeline; group?: string | null } | { type: 'undo' } | { type: 'redo' };
type Box = [number, number, number, number];
type FollowJob = { itemId: string; underId: string; jobId: string; progress: number; queued?: boolean; drawnAt: number; from: number; size: boolean; place: Box | null; own: boolean; grew: boolean;
  /** Set while looking for a face under a blur box: where the box is in the source, and what to follow instead when no face is there. */
  faces?: { box: Box; at: number; own: Box; grow?: number } };

type Input = {
  addBlurBox: (style: "blur" | "pixelate", at?: [number, number] | undefined) => void;
  addMedia: (item: Photo) => void;
  addOverlayMedia: (item: Photo, dropAt?: number | undefined) => void;
  blurFaces: () => Promise<void>;
  change: (next: Timeline, group?: string | null) => void;
  clipboard: { styleCopy: CopiedStyle | null; clearStyle: () => void; copy: (cut?: boolean) => void; pasteAt: (at: number, copied?: Clipboard | null) => void; duplicate: () => void; copyStyleOf: (id?: string | null) => void; pasteStyleOnto: (ids?: string[]) => void; menuItems: (id: string, at: number) => MenuItem[]; hasCopy: () => boolean; };
  detach: (clip?: Clip | null | undefined) => void;
  dispatch: React.Dispatch<Action>;
  faceJob: { jobId: string; clipId: string; progress: number; } | null;
  fitZoom: () => void;
  followHere: (mode: "start" | "continue") => Promise<void>;
  followJob: FollowJob | null;
  followTarget: { id: string; start: number; length: number; transform: Transform; } | null;
  freeze: (t?: number) => void;
  hasSound: (id: number) => boolean;
  history: History<Timeline | null>;
  isRendered: boolean;
  isVideo: (id: number) => boolean;
  mediaById: Map<number, Photo>;
  selectedId: string | null;
  moreIds: ReadonlySet<string>;
  setError: (message: string) => void;
  ownBox: () => Box | null;
  playing: boolean;
  reframeClip: (clipId: string) => Promise<void>;
  reframeJob: { jobId: string; clipId: string; progress: number; } | null;
  renderJob: { id: string; key: string; progress: number; } | null;
  renderPreview: () => Promise<void>;
  resetLayout: () => void;
  safeArea: boolean;
  sceneJob: { jobId: string; clipId: string; progress: number; } | null;
  seek: (t: number) => void | undefined;
  selectedBlur: BlurBox | null;
  setDeleting: React.Dispatch<React.SetStateAction<Photo | null>>;
  setFiling: React.Dispatch<React.SetStateAction<Photo | null>>;
  setMenu: React.Dispatch<React.SetStateAction<MenuState | null>>;
  setRenamingClip: React.Dispatch<React.SetStateAction<string | null>>;
  setSafeArea: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setShowingHelp: React.Dispatch<React.SetStateAction<boolean>>;
  snapshot: (t?: number | undefined) => Promise<void>;
  splitScenes: (clipId: string) => Promise<void>;
  timeline: Timeline | null;
  timelineRef: React.MutableRefObject<Timeline | null>;
  togglePlay: () => void;
  total: number;
  usedIds: Set<number>;
};

/** Existing editor actions; the input getter preserves render snapshots and forward references. */
export function createEditorMenuActions(getInput: () => Input) {
  const generalItems = (...args: Parameters<() => MenuItem[]>) => {
    const { history, dispatch } = getInput();
    const invoke = (): MenuItem[] => [
    { label: 'Undo', hint: '⌘Z', disabled: !history.past.length, onSelect: () => dispatch({ type: 'undo' }) },
    { label: 'Redo', hint: '⇧⌘Z', disabled: !history.future.length, onSelect: () => dispatch({ type: 'redo' }) },
  ];
    return invoke(...args);
  };

  const openGeneralMenu = (...args: Parameters<(event: React.MouseEvent) => void>) => {
    const { setMenu } = getInput();
    const invoke = (event: React.MouseEvent) => {
    if (isEditable(event.target)) return;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, items: generalItems() });
  };
    return invoke(...args);
  };

  const openViewMenu = (...args: Parameters<(event: React.MouseEvent) => void>) => {
    const { setMenu, safeArea, setSafeArea, total, renderJob, isRendered, renderPreview, setShowingHelp, resetLayout } = getInput();
    const invoke = (event: React.MouseEvent) => {
    event.preventDefault(); event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.right, y: rect.bottom + 4, items: [
      { label: safeArea ? 'Hide safe area' : 'Show safe area', onSelect: () => setSafeArea((value) => !value) },
      { label: 'Render smooth preview', disabled: !total || Boolean(renderJob) || isRendered, onSelect: () => { void renderPreview(); } },
      'divider',
      { label: 'Guide and shortcuts', hint: '?', onSelect: () => setShowingHelp(true) },
      { label: 'Reset panel layout', onSelect: resetLayout },
    ] });
  };
    return invoke(...args);
  };

  const openPreviewMenu = (...args: Parameters<(event: React.MouseEvent) => void>) => {
    const { playing, total, togglePlay, safeArea, setSafeArea, renderJob, isRendered, renderPreview, addBlurBox, faceJob, blurFaces, followTarget, ownBox, followJob, selectedBlur, followHere, setMenu } = getInput();
    const invoke = (event: React.MouseEvent) => {
    event.preventDefault(); event.stopPropagation();
    const items: MenuItem[] = [{ label: playing ? 'Pause' : 'Play', hint: 'Space', disabled: !total, onSelect: togglePlay }, { label: safeArea ? 'Hide safe area' : 'Show safe area', onSelect: () => setSafeArea((value) => !value) }, { label: 'Render smooth preview', disabled: !total || Boolean(renderJob) || isRendered, onSelect: () => { void renderPreview(); } }];
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const at: [number, number] = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
    if (total) items.push('divider', { label: 'Blur this spot', onSelect: () => addBlurBox('blur', at) }, { label: 'Pixelate this spot', onSelect: () => addBlurBox('pixelate', at) }, { label: 'Blur all faces in this clip', disabled: Boolean(faceJob), onSelect: () => { void blurFaces(); } });
    if (followTarget && ownBox() && !followJob) items.push('divider', { label: selectedBlur ? 'Follow what is under this blur' : 'Follow what is under this', onSelect: () => { void followHere('start'); } });
    setMenu({ x: event.clientX, y: event.clientY, items });
  };
    return invoke(...args);
  };

  const openMediaMenu = (...args: Parameters<(event: React.MouseEvent, item: Photo) => void>) => {
    const { setMenu, addMedia, addOverlayMedia, setFiling, usedIds, timeline, change, setSelectedId, setDeleting, selectedId, moreIds, setError } = getInput();
    const invoke = (event: React.MouseEvent, item: Photo) => {
    event.preventDefault(); event.stopPropagation();
    // Replace the selected main clips with this one, in exactly their time: nothing else moves.
    const mainIds = timeline ? mainLayer(timeline).items.map((clip) => clip.id) : [];
    const picked = [selectedId, ...moreIds].filter((id): id is string => Boolean(id) && mainIds.includes(id as string));
    const replace = () => {
      if (!timeline) return;
      const result = replaceClips(timeline, picked, { media_id: item.id, media_type: item.media_type === 'video' ? 'video' : 'image', duration: item.duration, width: item.width, height: item.height }, newId());
      if ('problem' in result) { setError(result.problem); return; }
      change(result.timeline); setSelectedId(null);
    };
    setMenu({ x: event.clientX, y: event.clientY, items: [
      { label: 'Add to timeline', onSelect: () => addMedia(item) }, { label: 'Add as overlay', onSelect: () => addOverlayMedia(item) },
      // Always third, greyed until main clips are selected, so the menu never changes shape.
      { label: picked.length > 1 ? `Replace the ${picked.length} selected clips` : 'Replace the selected clip', disabled: !picked.length, onSelect: replace }, 'divider' as const, { label: 'Move to folder…', onSelect: () => setFiling(item) },
      ...(usedIds.has(item.id) ? ['divider' as const, { label: 'Remove from this video', onSelect: () => { if (timeline) { change(removeMedia(timeline, item.id)); setSelectedId(null); } } }] : []),
      'divider', { label: 'Delete from Kanaa…', danger: true, onSelect: () => setDeleting(item) },
    ] });
  };
    return invoke(...args);
  };

  const openItemMenu = (...args: Parameters<(id: string | null, t: number, x: number, y: number) => void>) => {
    const { timeline, setMenu, seek, clipboard, total, fitZoom, change, mediaById, setRenamingClip, isVideo, reframeJob, reframeClip, sceneJob, splitScenes, freeze, snapshot, hasSound, detach, timelineRef, setSelectedId } = getInput();
    const invoke = (id: string | null, t: number, x: number, y: number) => {
    if (!timeline) return;
    const place = { x, y };
    if (!id) {
      setMenu({ ...place, items: [{ label: 'Move playhead here', onSelect: () => seek(t) }, { label: 'Paste here', hint: '⌘V', disabled: !clipboard.hasCopy(), onSelect: () => clipboard.pasteAt(t) }, { label: 'Fit timeline', disabled: !total, onSelect: fitZoom }, 'divider', ...generalItems()] });
      return;
    }
    const layer = layerOf(timeline, id)!;
    const lockItem: MenuItem = { label: layer.locked ? 'Unlock layer' : 'Lock layer', onSelect: () => change(updateLayer(timeline, layer.id, { locked: !layer.locked })) };
    if (layer.locked) { setMenu({ ...place, items: [lockItem] }); return; }
    const clip = findClip(timeline, id);
    const sound = findSound(timeline, id)?.sound;
    // One fixed order for every clip, in groups: edit, frame, AI, clip and sound, effects, arrange, delete. An action
    // that does not apply to this clip is shown greyed in its place, never left out, so nothing moves between clips.
    const items: MenuItem[] = [];
    if (clip || sound) items.push({ label: 'Split here', hint: 'S', onSelect: () => { const next = sound ? splitSound(timeline, id, t, newId()) : layer === mainLayer(timeline) ? splitClip(timeline, t, newId()) : splitSound(timeline, id, t, newId()); if (next !== timeline) change(next); } });
    items.push(...clipboard.menuItems(id, t));  // Starts and ends with its own divider.
    const clipItem = clip ? mediaById.get(clip.media_id) : undefined;
    if (clip) {
      const picture = clipItem?.media_type === 'image';
      const onMain = layer === mainLayer(timeline);
      const canFreeze = onMain && clip.freeze == null && clipItem?.media_type === 'video';
      // What every clip has, always in these places (the clipboard items above end the edit group).
      items.push(
        // Animate: unlocks the frame and opens Motion, in one step.
        { label: 'Animate', onSelect: () => { if (clip.frame_locked) change(updateClip(timeline, id, { frame_locked: false })); setSelectedId(id); openPanelTab('clip', 'motion'); } },
        { label: 'Frame locked', checked: Boolean(clip.frame_locked), onSelect: () => change(updateClip(timeline, id, { frame_locked: !clip.frame_locked })) },
        { label: 'Clip on', checked: clip.enabled !== false, onSelect: () => change(updateClip(timeline, id, { enabled: clip.enabled === false })) },
        { label: 'Rename clip…', onSelect: () => setRenamingClip(id) },
        'divider');
      // Then what only its kind has: a picture's AI tools, or a video's sound and freeze tools. Nothing greyed for the other kind.
      if (picture) items.push({ label: 'Edit with AI…', onSelect: () => openAiEdit({ clipId: id, mediaId: clip.media_id }) }, { label: 'Remove person or object…', onSelect: () => openRemovePerson({ clipId: id, mediaId: clip.media_id }) }, { label: 'Bring to life…', onSelect: () => openBringToLife({ clipId: id, mediaId: clip.media_id }) });
      else {
        items.push({ label: 'Sound on', checked: !clip.muted, disabled: !hasSound(clip.media_id), onSelect: () => change(updateClip(timeline, id, { muted: !clip.muted })) },
          { label: 'Detach sound', disabled: clip.muted || !hasSound(clip.media_id), onSelect: () => detach(clip) },
          { label: 'Freeze frame here', disabled: !canFreeze, onSelect: () => freeze(t) },
          { label: 'Snapshot freeze here', disabled: !canFreeze, onSelect: () => { void snapshot(t); } });
        const smart: MenuItem[] = [];
        if (clip && clipItem?.width && clipItem.height && isVideo(clip.media_id) && !layer.locked && canReframe({ width: clipItem.width, height: clipItem.height }, clip.adjust.rotation, timeline.format)) smart.push({ label: reframeJob ? `Finding who to follow… ${reframeJob.progress}%` : 'Follow the person (reframe)', disabled: Boolean(reframeJob), onSelect: () => { void reframeClip(clip.id); } });
        if (clip && layer === mainLayer(timeline) && isVideo(clip.media_id) && !layer.locked) smart.push({ label: sceneJob ? `Finding scenes… ${sceneJob.progress}%` : 'Split at scene changes', disabled: Boolean(sceneJob), onSelect: () => { void splitScenes(clip.id); } });
        if (smart.length) items.push({ label: 'Smart tools', submenu: smart });
      }
      if (clipEffects(clip).length) {
        // Built each time the menu draws, from the clip as it is now, so ticks stay true while switches are flipped.
        const now = () => { const latest = timelineRef.current; const found = latest && findClip(latest, id); return latest && found ? { latest, found } : null; };
        const apply = (changes: (found: Clip) => Partial<Clip>) => { const at = now(); if (at) change(updateClip(at.latest, id, changes(at.found))); };
        items.push('divider', {
          label: 'Effects', submenu: () => {
            const at = now(); if (!at) return [];
            const effects = clipEffects(at.found);
            const allOff = effects.every((effect) => !effect.on);
            return [...effects.map((effect): MenuItem => ({ label: `${effect.label} · ${effect.detail}`, checked: effect.on, keepOpen: true, onSelect: () => apply((found) => toggleEffect(found, effect.id)) })),
              'divider', { label: allOff ? 'Turn all back on' : 'Turn all off', keepOpen: true, onSelect: () => apply(toggleAllEffects) }];
          },
        }, {
          label: 'Remove effects', submenu: () => {
            const at = now(); if (!at) return [];
            const effects = clipEffects(at.found);
            return [...effects.map((effect): MenuItem => ({ label: `${effect.label} · ${effect.detail}`, keepOpen: effects.length > 1, onSelect: () => apply((found) => removeEffect(found, effect.id)) })),
              'divider', { label: 'Remove all effects', danger: true, onSelect: () => apply((found) => clipEffects(found).reduce<Clip>((next, effect) => ({ ...next, ...removeEffect(next, effect.id) }), found)) }];
          },
        });
      }
    }
    if (sound) items.push('divider', { label: 'Sound on', checked: !sound.muted, onSelect: () => change(updateSound(timeline, id, { muted: !sound.muted })) }, { label: 'Dip under speech', checked: Boolean(sound.duck), onSelect: () => change(updateSound(timeline, id, { duck: !sound.duck })) });
    items.push('divider');
    const overlays = overlayLayers(timeline);
    const stack = overlays.findIndex((entry) => entry.id === layer.id);
    if (stack >= 0) items.push({ label: 'Bring forward', disabled: stack === overlays.length - 1, onSelect: () => change(reorderLayer(timeline, layer.id, 'forward')) }, { label: 'Send back', disabled: stack === 0, onSelect: () => change(reorderLayer(timeline, layer.id, 'back')) });
    const stretchable = clip && layer === mainLayer(timeline) ? deleteAndStretch(timeline, id, factsFrom(mediaById)) : null;
    items.push(lockItem, 'divider');
    // Which neighbour grows: the one before when it could, otherwise the one after.
    const main = mainLayer(timeline).items; const at = main.findIndex((each) => each.id === id);
    const grewBefore = Boolean(stretchable && at > 0 && clipLength(mainLayer(stretchable).items[at - 1]) > clipLength(main[at - 1]) + 1e-6);
    if (stretchable) items.push({ label: grewBefore ? 'Delete, clip before fills in' : 'Delete, clip after fills in', hint: isSongVideo(timeline) ? '⌫' : undefined, onSelect: () => { change(stretchable); setSelectedId(null); } });
    items.push({ label: stretchable ? 'Delete, close the gap' : 'Delete', hint: stretchable && isSongVideo(timeline) ? undefined : '⌫', danger: true, onSelect: () => { change(findSound(timeline, id) ? removeSound(timeline, id) : findText(timeline, id) ? removeText(timeline, id) : findBlur(timeline, id) ? removeBlur(timeline, id) : findAdjust(timeline, id) ? removeAdjust(timeline, id) : findCaption(timeline, id) ? removeCaption(timeline, id) : removeClip(timeline, id)); setSelectedId(null); } });
    setMenu({ ...place, items });
  };
    return invoke(...args);
  };
  return { generalItems, openGeneralMenu, openViewMenu, openPreviewMenu, openMediaMenu, openItemMenu };
}
