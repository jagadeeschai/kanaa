import { openPanelTab } from "../layout";
import { deleteAndStretch, factsFrom, isSongVideo, replaceClips } from "../../timeline/songSafe";
import { openAiEdit } from "../AiEditDialog";
import { openBringToLife } from "../BringToLifeDialog";
import { openPopout, openRemovePerson } from "../RemovePersonDialog";
import { openVideoPopout } from "../VideoPopoutDialog";
import { openClone } from "../CloneDialog";
import { openLens } from "../LensDialog";
import { openAtmosphere } from "../AtmosphereDialog";
import { openMatchCuts } from "../MatchCutDialog";
import { openMulticam } from "../MulticamDialog";
import { openFreeze3d } from "../Freeze3dDialog";
import { openSky } from "../SkyDialog";
import { removeSky } from "../../timeline/sky";
import { angleLayers, removeMulticam } from "../../timeline/multicam";
import { removeAtmosphere } from "../../timeline/atmosphere";
import { openSlowmo } from "../SlowmoDialog";
import { removeSlow } from "../../timeline/slowmo";
import { removeLens } from "../../timeline/lens";
import { hasClones, removeClones } from "../../timeline/clone";
import type { Clipboard,CopiedStyle } from '../../timeline/clipboard';
import { clipEffects,removeEffect,toggleAllEffects,toggleEffect } from "../../timeline/effects";
import type { Transform } from '../../timeline/evaluate';
import { type History } from "../../timeline/history";
import { removePopout,clipLength,findBlur,findCaption,findClip,findSound,findText,layerOf,mainLayer,overlayLayers,removeBlur,removeCaption,removeClip,removeMedia,removeSound,removeText,reorderLayer,splitClip,splitSound,updateClip,updateLayer,updateSound,type BlurBox,type Clip,type GraphicKind,type Timeline } from "../../timeline/model";
import { canReframe } from "../../timeline/reframe";
import type { Photo } from "../../types/photo";
import { isEditable,type MenuItem,type MenuState } from "../ContextMenu";
import { newId } from "../editor-constants";
import { cannotSlice, SLICES, sliceIntoPieces } from "../../timeline/slice";
import { openSmartSlice } from "../SmartSliceDialog";
import { openYouTube } from "../../publish/YouTubeDialog";
import { withVirtualBackground } from "../../timeline/virtual-background";
import { screenColour } from "../../api/client";
import { findAdjust, removeAdjust } from '../../timeline/adjust';
type Action = { type: 'load'; timeline: Timeline } | { type: 'change'; timeline: Timeline; group?: string | null } | { type: 'undo' } | { type: 'redo' };
type Box = [number, number, number, number];
type FollowJob = { itemId: string; underId: string; jobId: string; progress: number; queued?: boolean; drawnAt: number; from: number; size: boolean; place: Box | null; own: boolean; grew: boolean;
  /** Set while looking for a face under a blur box: where the box is in the source, and what to follow instead when no face is there. */
  faces?: { box: Box; at: number; own: Box; grow?: number } };

type Input = {
  addBlurBox: (style: "blur" | "pixelate", at?: [number, number] | undefined) => void;
  addExplainerGraphic: (kind: GraphicKind, at: [number, number]) => void;
  addGlowOutline: (at: [number, number]) => Promise<void>;
  addComparison: (clipId: string) => void;
  focusAllPictures: () => Promise<void>;
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
  engineRef: React.MutableRefObject<{ playRange: (start: number, end: number) => void } | null>;
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
    const { playing, total, togglePlay, safeArea, setSafeArea, renderJob, isRendered, renderPreview, addBlurBox, addExplainerGraphic, addGlowOutline, faceJob, blurFaces, followTarget, ownBox, followJob, selectedBlur, followHere, setMenu } = getInput();
    const invoke = (event: React.MouseEvent) => {
    event.preventDefault(); event.stopPropagation();
    const items: MenuItem[] = [{ label: playing ? 'Pause' : 'Play', hint: 'Space', disabled: !total, onSelect: togglePlay }, { label: safeArea ? 'Hide safe area' : 'Show safe area', onSelect: () => setSafeArea((value) => !value) }, { label: 'Render smooth preview', disabled: !total || Boolean(renderJob) || isRendered, onSelect: () => { void renderPreview(); } }];
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const at: [number, number] = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
    if (total) items.push('divider', { label: 'Add graphic', submenu: [
      { label: 'Straight arrow', onSelect: () => addExplainerGraphic('arrow-straight', at) },
      { label: 'Curved arrow', onSelect: () => addExplainerGraphic('arrow-curved', at) },
      { label: 'Circle highlight', onSelect: () => addExplainerGraphic('circle', at) },
      { label: 'Rounded box highlight', onSelect: () => addExplainerGraphic('box', at) },
      { label: 'Callout label', onSelect: () => addExplainerGraphic('callout', at) },
      { label: 'Lower third', onSelect: () => addExplainerGraphic('lower-third', at) },
      { label: 'Count-up number', onSelect: () => addExplainerGraphic('count-up', at) },
      { label: 'Chapter card', onSelect: () => addExplainerGraphic('chapter-card', at) },
      { label: 'Bar chart', onSelect: () => addExplainerGraphic('bar-chart', at) },
      { label: 'Line chart', onSelect: () => addExplainerGraphic('line-chart', at) },
      { label: 'Pie or donut chart', onSelect: () => addExplainerGraphic('pie-chart', at) },
      { label: 'Step list', onSelect: () => addExplainerGraphic('step-list', at) },
      { label: 'Timeline bar', onSelect: () => addExplainerGraphic('timeline-bar', at) },
      { label: 'Icon', onSelect: () => addExplainerGraphic('icon', at) },
      { label: 'Map', onSelect: () => addExplainerGraphic('map', at) },
      { label: 'Source footnote', onSelect: () => addExplainerGraphic('source', at) },
      'divider',
      { label: 'Spotlight', onSelect: () => addExplainerGraphic('spotlight', at) },
      { label: 'Glow outline around this', onSelect: () => { void addGlowOutline(at); } },
    ] }, { label: 'Blur this spot', onSelect: () => addBlurBox('blur', at) }, { label: 'Pixelate this spot', onSelect: () => addBlurBox('pixelate', at) }, { label: 'Blur all faces in this clip', disabled: Boolean(faceJob), onSelect: () => { void blurFaces(); } });
    if (followTarget && ownBox() && !followJob) items.push('divider', { label: selectedBlur ? 'Follow what is under this blur' : 'Follow what is under this', onSelect: () => { void followHere('start'); } });
    setMenu({ x: event.clientX, y: event.clientY, items });
  };
    return invoke(...args);
  };

  /** Right-click a main-track clip of someone: put them on one of the project's pictures or videos, keyed in one step. */
  const virtualBackgroundItem = (clip: Clip, media: Photo[], mediaById: Map<number, Photo>) => {
    // Newest first, one entry per name (an edited copy often keeps its original's name).
    const seen = new Set<string>();
    const choices = media.filter((item) => (item.media_type === 'image' || item.media_type === 'video') && item.id !== clip.media_id).reverse()
      .filter((item) => !seen.has(item.filename) && Boolean(seen.add(item.filename))).slice(0, 12);
    const apply = async (item: Photo) => {
      const { timelineRef, change, setSelectedId, setError } = getInput();
      let screen: string | null = null;
      try { screen = (await screenColour(clip.media_id, clip.in + clipLength(clip) * clip.speed / 2)).colour; } catch { screen = null; }
      if (!screen && mediaById.get(clip.media_id)?.media_type !== 'video') { setError('This picture has no green or blue screen to remove. A video of someone works without one: Kanaa cuts them out.'); return; }
      const current = timelineRef.current;
      if (!current) return;
      const person = newId();
      const next = withVirtualBackground(current, clip.id, { media_id: item.id, media_type: item.media_type === 'video' ? 'video' : 'image', duration: item.duration, width: item.width, height: item.height }, screen, { layer: newId(), person });
      if (next === current) { setError('That clip is no longer on the main track.'); return; }
      change(next); setSelectedId(person);
    };
    return { label: 'Virtual background', disabled: !choices.length, submenu: choices.map((item) => ({ label: item.filename, onSelect: () => { void apply(item); } })) };
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
      ...(item.media_type === 'video' ? [{ label: 'Publish to YouTube…', onSelect: () => openYouTube(item.id) }] : []),
      ...(usedIds.has(item.id) ? ['divider' as const, { label: 'Remove from this video', onSelect: () => { if (timeline) { change(removeMedia(timeline, item.id)); setSelectedId(null); } } }] : []),
      'divider', { label: 'Delete from Kanaa…', danger: true, onSelect: () => setDeleting(item) },
    ] });
  };
    return invoke(...args);
  };

  const openItemMenu = (...args: Parameters<(id: string | null, t: number, x: number, y: number) => void>) => {
    const { timeline, setMenu, seek, clipboard, total, fitZoom, change, mediaById, setRenamingClip, isVideo, reframeJob, reframeClip, sceneJob, splitScenes, freeze, snapshot, hasSound, detach, timelineRef, setSelectedId, engineRef } = getInput();
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
        { label: 'Play this clip', hint: '⇧Space', onSelect: () => { engineRef.current?.playRange(clip.start, clip.start + clipLength(clip)); } },
        // Animate: unlocks the frame and opens Motion, in one step.
        { label: 'Animate', onSelect: () => { if (clip.frame_locked) change(updateClip(timeline, id, { frame_locked: false })); setSelectedId(id); openPanelTab('clip', 'motion'); } },
        { label: 'Frame locked', checked: Boolean(clip.frame_locked), onSelect: () => change(updateClip(timeline, id, { frame_locked: !clip.frame_locked })) },
        { label: 'Clip on', checked: clip.enabled !== false, onSelect: () => change(updateClip(timeline, id, { enabled: clip.enabled === false })) },
        { label: 'Rename clip…', onSelect: () => setRenamingClip(id) },
        ...(onMain ? [] : [{ label: 'Before / after split', onSelect: () => getInput().addComparison(id) }]),
        ...(onMain ? [virtualBackgroundItem(clip, [...mediaById.values()], mediaById)] : []),
        // Slice into pieces: the end of this clip cut into strips that slide away to show the next one (slice.ts).
        ...(onMain ? [{ label: 'Slice into pieces', disabled: Boolean(cannotSlice(timeline, clip.id, 'sideways')), submenu: [{ label: 'Smart slice (Kanaa decides)', onSelect: () => openSmartSlice({ clipId: clip.id, mediaId: clip.media_id }) }, 'divider' as const, ...SLICES.map((choice) => ({ label: choice.label, onSelect: () => {
          try {
            const item = mediaById.get(clip.media_id);
            change(sliceIntoPieces(timeline, clip.id, choice.id, item ? { media_id: item.id, media_type: item.media_type === 'video' ? 'video' : 'image', duration: item.duration } : undefined, newId), 'slice');
          } catch (problem) { getInput().setError((problem as Error).message); }
        } }))] }] : []),
        ...(clip.popout || mainLayer(timeline).items.some((item) => item.popout?.person_clip_id === clip.id) ? [{ label: 'Remove pop-out', onSelect: () => change(removePopout(timeline, clip.id)) }] : []),
        'divider');
      // Then what only its kind has: a picture's AI tools, or a video's sound and freeze tools. Nothing greyed for the other kind.
      if (picture) items.push({ label: 'Edit with AI…', onSelect: () => openAiEdit({ clipId: id, mediaId: clip.media_id }) }, { label: 'Remove person or object…', onSelect: () => openRemovePerson({ clipId: id, mediaId: clip.media_id }) }, ...(onMain ? [{ label: 'Pop-out (3D)…', onSelect: () => openPopout({ clipId: id, mediaId: clip.media_id }) }, { label: 'Focus drift on every picture', onSelect: () => { void getInput().focusAllPictures(); } }] : []), { label: 'Bring to life…', onSelect: () => openBringToLife({ clipId: id, mediaId: clip.media_id }) });
      else {
        // Grouped, so the menu stays short however many tools there are: the big looks under Cinematic, every kind of
        // freeze under Freeze, the tools that work across clips under Smart edit. One applied shows a tick; its Remove
        // sits right under it.
        const cinematic: MenuItem[] = [
          { label: clip.lens ? 'Cinematic lens (change)…' : 'Cinematic lens…', checked: Boolean(clip.lens), onSelect: () => openLens(id) }, ...(clip.lens ? [{ label: 'Remove lens', onSelect: () => change(removeLens(timeline, id)) }] : []),
          { label: clip.atmosphere ? 'Atmosphere (change)…' : 'Atmosphere…', checked: Boolean(clip.atmosphere), onSelect: () => openAtmosphere(id) }, ...(clip.atmosphere ? [{ label: 'Remove atmosphere', onSelect: () => change(removeAtmosphere(timeline, id)) }] : []),
          { label: clip.new_sky ? 'New sky (change)…' : 'New sky…', checked: Boolean(clip.new_sky), onSelect: () => openSky(id) }, ...(clip.new_sky ? [{ label: 'Remove new sky', onSelect: () => change(removeSky(timeline, id)) }] : []),
          { label: clip.slowmo ? 'Smooth slow motion (change)…' : 'Smooth slow motion…', checked: Boolean(clip.slowmo), onSelect: () => openSlowmo(id) }, ...(clip.slowmo ? [{ label: 'Normal speed', onSelect: () => change(removeSlow(timeline, id)) }] : []),
          ...(onMain ? [{ label: 'Pop-out (3D)…', onSelect: () => openVideoPopout({ clipId: id, mediaId: clip.media_id }) },
            { label: 'Clone the person…', checked: hasClones(timeline, id), onSelect: () => openClone(id) }, ...(hasClones(timeline, id) ? [{ label: 'Remove clones', onSelect: () => change(removeClones(timeline, id)) }] : [])] : []),
        ];
        const freezes: MenuItem[] = [
          { label: 'Freeze frame here', disabled: !canFreeze, onSelect: () => freeze(t) },
          { label: 'Snapshot freeze here', disabled: !canFreeze, onSelect: () => { void snapshot(t); } },
          ...(onMain && clipItem?.media_type === 'video' ? [clip.freeze3d ? { label: 'Time freeze (change move)…', onSelect: () => openFreeze3d(id) } : { label: 'Time freeze in 3D here…', disabled: !canFreeze, onSelect: () => openFreeze3d(null) }] : []),
        ];
        const smart: MenuItem[] = [];
        if (onMain) smart.push({ label: 'Find match cuts…', onSelect: () => openMatchCuts() }, angleLayers(timeline, id).length ? { label: 'End multicam', onSelect: () => change(removeMulticam(timeline, id)) } : { label: 'Multicam sync…', onSelect: () => openMulticam(id) });
        if (clip && clipItem?.width && clipItem.height && isVideo(clip.media_id) && !layer.locked && canReframe({ width: clipItem.width, height: clipItem.height }, clip.adjust.rotation, timeline.format)) smart.push({ label: reframeJob ? `Finding who to follow… ${reframeJob.progress}%` : 'Follow the person (reframe)', disabled: Boolean(reframeJob), onSelect: () => { void reframeClip(clip.id); } });
        if (clip && layer === mainLayer(timeline) && isVideo(clip.media_id) && !layer.locked) smart.push({ label: sceneJob ? `Finding scenes… ${sceneJob.progress}%` : 'Split at scene changes', disabled: Boolean(sceneJob), onSelect: () => { void splitScenes(clip.id); } });
        items.push({ label: 'Cinematic', submenu: cinematic }, { label: 'Freeze', submenu: freezes });
        if (smart.length) items.push({ label: 'Smart edit', submenu: smart });
        items.push({ label: 'Sound on', checked: !clip.muted, disabled: !hasSound(clip.media_id), onSelect: () => change(updateClip(timeline, id, { muted: !clip.muted })) },
          { label: 'Detach sound', disabled: clip.muted || !hasSound(clip.media_id), onSelect: () => detach(clip) });
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
