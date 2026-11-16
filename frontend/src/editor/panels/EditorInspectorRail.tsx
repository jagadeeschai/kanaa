import { useContext } from "react";
import type { ProjectInspectorBindings } from '../inspectors/ProjectInspector';
import type { BlurInspectorBindings } from '../inspectors/BlurInspector';
import type { CaptionInspectorBindings } from '../inspectors/CaptionInspector';
import type { SoundInspectorBindings } from '../inspectors/SoundInspector';
import type { InspectorBindings } from '../inspectors/ClipInspector';
import type { TextInspectorBindings } from '../inspectors/TextInspector';
import { InspectorBindingsProvider } from '../state/EditorContext';
import { useEditorPanel } from '../state/EditorContext';
import { cancelRenderJob,moveMediaToFolder } from "../../api/client";
import { t } from "../../i18n";
import { applyBrand,BRAND_SIZES,brandClip,brandOnClip,brandsOnClip,removeBrand,removeClipBrand } from "../../timeline/brand";
import { retypeCaption } from "../../timeline/captions";
import { removeKeepClear } from "../../timeline/keepClear";
import { needsLoop } from "../../timeline/loop";
import type { AdjustLayer,BlurLayer,KeepClear,TextLayer } from '../../timeline/model';
import { cinemaReveal,cinemaRevealFront,clipLength,groundRiseGap,mainLayer,MAX_VIDEO_LAYERS,putBehindPerson,removeCinemaReveal,setCaptions,setGroundRiseGap,TITLE_SPACE,updateCaption,updateCaptionLook,updateClip,updateLayer,updateText,type AudioLayer,type BlurBox,type Caption,type CaptionLayer,type CinemaReveal,type Clip,type Format,type Sound,type SurfaceKind,type TextItem,type Timeline,type TitlePin,type VideoLayer } from "../../timeline/model";
import { type MovePreset } from "../../timeline/presets";
import { canReframe } from "../../timeline/reframe";
import { drawnPoints } from "../../timeline/shapeEdit";
import { removeStay } from "../../timeline/stayWith";
import type { Photo } from "../../types/photo";
import { type TimeFieldProps } from "../controls";
import { BRAND_FOLDER,isBrandImage,newId,preparedKey,preparedWant,STYLE_NAMES } from "../editor-constants";
import { BlurInspector } from "../inspectors/BlurInspector";
import { AdjustInspector } from "../inspectors/AdjustInspector";
import { findAdjust } from "../../timeline/adjust";
import { CaptionInspector } from "../inspectors/CaptionInspector";
import { Inspector } from "../inspectors/ClipInspector";
import { ProjectInspector } from "../inspectors/ProjectInspector";
import { SoundInspector } from "../inspectors/SoundInspector";
import { TextInspector } from "../inspectors/TextInspector";
import { LayerModeContext } from "../layout";
import { asVideo } from "../photoToVideo";
import { PlaybackEngine,type PlaybackSource } from "../playback";
import { EditorContext } from "../state/EditorContext";
type StemChoice = 'music' | 'vocals' | 'both';
type StemJob = { soundId: string; jobId: string; choice: StemChoice; progress: number };
type Box = [number, number, number, number];

export type EditorInspectorRailBindings = {
  addBrandIntro: (logo: Photo, tamil: string, english: string) => Promise<void>;
  blurLocal: number;
  change: (next: Timeline, group?: string | null) => void;
  clearProgress: number | null;
  clipIndex: number;
  clipsInOrder: Clip[];
  clipTiming: (clip: Clip) => TimeFieldProps[];
  clipUnderTitle: (current: Timeline, text: TextItem) => Clip | null;
  decorateTitle: (effectId: "bubbles" | "shine") => void;
  detach: (clip?: Clip | null | undefined) => void;
  effectBusy: { id: string; progress: number; } | null;
  engineRef: React.MutableRefObject<PlaybackEngine | null>;
  firstClipFormat: Format | null;
  followPanel: React.JSX.Element | null;
  hasSound: (id: number) => boolean;
  inspectorOpen: boolean;
  introProgress: number | null;
  keepClearNote: { textId: string; text: string; } | null;
  keepTitleClear: (text: TextItem, settings: Pick<KeepClear, "gap" | "direction" | "max_move" | "who">) => Promise<void>;
  layerSettings: string | null;
  looping: boolean;
  loopSelectedSound: (soundId: string) => Promise<void>;
  media: Photo[];
  mediaById: Map<number, Photo>;
  mixedSettings: () => string[];
  moreIds: ReadonlySet<string>;
  moveSelected: (move: MovePreset) => Promise<void>;
  newBackground: (clip: Clip, item: Photo) => void;
  pauseEngine: () => void | undefined;
  pickingKey: boolean;
  pinProgress: number | null;
  pinTitle: (text: TextItem, on: boolean, placedPin?: TitlePin | undefined) => Promise<void>;
  placeInScene: (text: TextItem, spot: { x: number; y: number; } | null, kind: SurfaceKind | null) => Promise<void>;
  placing: { textId: string; busy: boolean; } | null;
  preparedReady: Record<string, boolean>;
  reframeClip: (clipId: string) => Promise<void>;
  reframeJob: { jobId: string; clipId: string; progress: number; } | null;
  saveStyle: (text: TextItem) => void;
  scopeBar: (id: string, noun: "title" | "clip") => React.JSX.Element | null;
  seek: (t: number) => void | undefined;
  selected: Clip | null;
  selectedBlur: BlurBox | null;
  selectedCaption: { caption: Caption; layer: CaptionLayer; } | null;
  selectedIdentity: { kind: string; name: string; } | null;
  selectedLayer: VideoLayer | AudioLayer | TextLayer | CaptionLayer | BlurLayer | AdjustLayer | undefined;
  selectedSound: { sound: Sound; layer: AudioLayer; } | null;
  selectedText: TextItem | null;
  separate: (choice: StemChoice) => Promise<void>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setKaraoke: (colour: string | null) => void;
  setKeepClearNote: React.Dispatch<React.SetStateAction<{ textId: string; text: string; } | null>>;
  setLeftTab: React.Dispatch<React.SetStateAction<"audio" | "text" | "media" | "words" | "transitions" | "effects" | "templates" | "themes" | "ask">>;
  setMedia: React.Dispatch<React.SetStateAction<Photo[]>>;
  setMoreIds: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  setNote: React.Dispatch<React.SetStateAction<string>>;
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPlacing: React.Dispatch<React.SetStateAction<{ textId: string; busy: boolean; } | null>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setShaping: React.Dispatch<React.SetStateAction<{ textId: string; mode: "ground" | "outline"; points: [number, number][]; reveal?: CinemaReveal; } | null>>;
  setStayNote: React.Dispatch<React.SetStateAction<{ textId: string; text: string; } | null>>;
  settingsLayer: VideoLayer | AudioLayer | TextLayer | CaptionLayer | BlurLayer | AdjustLayer | undefined;
  shaping: { textId: string; mode: "ground" | "outline"; points: [number, number][]; reveal?: CinemaReveal; } | null;
  showEnter: (start: number, seconds: number) => void | undefined;
  showExit: (end: number, seconds: number) => void | undefined;
  soundTiming: (sound: Sound) => TimeFieldProps[];
  sourceFor: (id: number, clip?: Clip) => PlaybackSource | undefined;
  splitScreen: (layout: "side" | "stack") => void;
  startPicking: () => void;
  stayNote: { textId: string; text: string; } | null;
  stayProgress: number | null;
  stayWithPeople: (text: TextItem) => Promise<void>;
  stemJob: StemJob | null;
  stems: { available: boolean; install_command: string; } | null;
  textTiming: (text: TextItem | BlurBox | Caption) => TimeFieldProps[];
  timeline: Timeline | null;
  updateSelected: (changes: Partial<Clip>, group?: string | undefined) => void;
  updateSelectedBlur: (changes: Partial<BlurBox>, group?: string) => void;
  updateSelectedSound: (changes: Partial<Sound>, group?: string | undefined) => void;
  updateSelectedText: (changes: Partial<TextItem>, group?: string | undefined) => void;
};

export function EditorInspectorRail() {
  const selectedAdjustId = useContext(EditorContext)?.selectedId ?? null;
  const { layerSettings, inspectorOpen, selectedIdentity, selected, settingsLayer, mediaById, change, timeline, moreIds, mixedSettings, setMoreIds, selectedLayer, selectedText, scopeBar, selectedCaption, textTiming, setSelectedId, selectedBlur, blurLocal, updateSelectedBlur, seek, pauseEngine, followPanel, setKaraoke, decorateTitle, effectBusy, saveStyle, engineRef, setShaping, shaping, showEnter, setKeepClearNote, clipUnderTitle, setNote, setMedia, setError, placing, setPlacing, placeInScene, pinProgress, pinTitle, stayProgress, stayNote, stayWithPeople, setStayNote, clearProgress, keepClearNote, keepTitleClear, updateSelectedText, showExit, selectedSound, loopSelectedSound, looping, soundTiming, updateSelectedSound, stems, stemJob, separate, reframeClip, reframeJob, moveSelected, media, newBackground, sourceFor, updateSelected, hasSound, detach, preparedReady, splitScreen, pickingKey, startPicking, clipTiming, clipsInOrder, clipIndex, introProgress, addBrandIntro, firstClipFormat, setLeftTab, setPanelOpen } = useEditorPanel<EditorInspectorRailBindings>('inspector');
  return (<aside className="ed-inspector" aria-label="Clip settings"><LayerModeContext.Provider value={Boolean(layerSettings)}>{inspectorOpen && <>{selectedIdentity && <div className="ed-selection"><span>{t(selectedIdentity.kind)}</span>{selected && !settingsLayer ? <input key={selected.id} className="ed-selection-name" aria-label="Clip name" title="What this clip is for; shown on it in the timeline" maxLength={80} defaultValue={selected.name ?? ''} placeholder={mediaById.get(selected.media_id)?.filename ?? 'Clip name'}
        onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter' || event.key === 'Escape') { if (event.key === 'Escape') event.currentTarget.value = selected.name ?? ''; event.currentTarget.blur(); } }}
        onBlur={(event) => { const name = event.currentTarget.value.trim() || null; if ((selected.name ?? null) !== name) change(updateClip(timeline!, selected.id, { name })); }}/> : <strong title={selectedIdentity.name}>{selectedIdentity.name}</strong>}</div>}{moreIds.size > 0 && !layerSettings && <div className="ed-scope ed-multi"><b>{t('{count} items picked', { count: moreIds.size + 1 })}</b><span>{t('Changes apply to all of them (not their words or timing).')}</span>{(() => { const mixed = mixedSettings(); return mixed.length > 0 && <span className="ed-multi-mixed">{t('Mixed:')} {mixed.map((key) => t(STYLE_NAMES[key] ?? key.replace(/_/g, ' '))).join(', ')} — {t('the panel shows the first; a change makes them all the same.')}</span>; })()}<button className="ed-link" onClick={() => setMoreIds(new Set())}>{t('Just this one')}</button></div>}{!selectedLayer?.locked && (selectedText && !selectedText.graphic ? scopeBar(selectedText.id, 'title') : selected ? scopeBar(selected.id, 'clip') : null)}</>}{selectedLayer?.locked ? <div className="ed-hint"><h2>Layer locked</h2><p>Unlock this layer on the timeline to change it.</p></div>
        : selectedCaption ? <InspectorBindingsProvider name="caption" bindings={{ caption: selectedCaption.caption, layer: selectedCaption.layer, timing: textTiming(selectedCaption.caption), onText: (text) => change(updateCaption(timeline!, selectedCaption.caption.id, { words: retypeCaption(selectedCaption.caption, text) }), `caption-${selectedCaption.caption.id}`), onLook: (changes, group) => change(updateCaptionLook(timeline!, selectedCaption.layer.id, changes), group), onRemoveAll: () => { change(setCaptions(timeline!, [], '')); setSelectedId(null); } } satisfies CaptionInspectorBindings}><CaptionInspector/></InspectorBindingsProvider>
        : timeline && findAdjust(timeline, selectedAdjustId) ? <AdjustInspector/>
        : selectedBlur ? <InspectorBindingsProvider name="blur" bindings={{ blur: selectedBlur, timing: textTiming(selectedBlur), local: blurLocal, onChange: updateSelectedBlur, onSeekLocal: (t) => seek(selectedBlur.start + t), onPause: pauseEngine, follow: followPanel } satisfies BlurInspectorBindings}><BlurInspector/></InspectorBindingsProvider>
        : selectedText ? <InspectorBindingsProvider name="text" bindings={{ text: selectedText, onKaraoke: setKaraoke, onDecorate: decorateTitle, decorating: effectBusy?.id === 'bubbles' || effectBusy?.id === 'shine', groundGap: groundRiseGap(timeline!, selectedText.id), onGroundGap: (depth_gap) => change(setGroundRiseGap(timeline!, selectedText.id, depth_gap), `ground-gap-${selectedText.id}`), onSaveStyle: () => saveStyle(selectedText), onBehindShape: (reveal, mode) => { engineRef.current?.pause(); setShaping({ textId: selectedText.id, mode, points: drawnPoints(timeline!, selectedText.id, mode) ?? [], reveal }); }, cover: (() => { const index = timeline ? timeline.layers.findIndex((layer) => layer.kind === 'text' && (layer.items as TextItem[]).some((item) => item.id === selectedText.id)) : -1; const next = index >= 0 ? timeline!.layers[index + 1] : null; if (next?.kind === 'video') { if (next.name === 'Person') return 'people' as const; if (next.name === 'Object') return 'object' as const; if (next.name === 'Land') return 'land' as const; if (next.name === 'In front') return 'drawn' as const; } return 'front' as const; })(), shapingMode: shaping && shaping.textId === selectedText.id ? shaping.mode : null, onCinemaClear: () => change(removeCinemaReveal(timeline!, selectedText.id), `cinema-clear-${selectedText.id}`), onCinemaFront: (reveal) => { const next = cinemaRevealFront(timeline!, selectedText.id, reveal); change(next, `cinema-front-${selectedText.id}`); setSelectedId(selectedText.id); showEnter(selectedText.start, reveal === 'push' ? 1.4 : 1.2); }, onCinema: (reveal, what) => { const ids: [string, string] = [newId(), newId()]; // People or an object in front, and keeping clear of them, pull opposite ways: the title would dodge every frame.
            const base = selectedText.keep_clear && what !== 'land' ? updateText(timeline!, selectedText.id, removeKeepClear(selectedText)) : timeline!; if (base !== timeline) setKeepClearNote(null); void (async () => { const title = selectedText; let ready = base; const under = clipUnderTitle(base, title); if (under && mediaById.get(under.media_id)?.media_type === 'image') { setNote('Preparing the picture so people can be found in it…'); try { const made = await asVideo(base, under); setMedia((current) => (current.some((each) => each.id === made.video.id) ? current : [made.video, ...current])); ready = made.timeline; } catch (problem) { setError((problem as Error).message); return; } } const next = cinemaReveal(ready, title.id, reveal, what, ids); if (next === ready) setError(ready.layers.filter((layer) => layer.kind === 'video').length >= MAX_VIDEO_LAYERS ? `This song already uses ${MAX_VIDEO_LAYERS} video layers, the most it can have. Delete or merge one (an unused effects or overlay layer), then try again.` : 'Put the title over a picture or video clip on the main track first.'); else { change(next, `cinema-${title.id}`); setSelectedId(title.id); showEnter(title.start, reveal === 'push' ? 1.4 : 1.2); } })(); }, placing: placing?.textId === selectedText.id ? (placing.busy ? 'busy' : 'waiting') : null, onPlace: () => setPlacing((now) => now?.textId === selectedText.id ? null : { textId: selectedText.id, busy: false }), onSurface: (kind) => { void placeInScene(selectedText, null, kind); }, pinning: pinProgress, onPin: (on) => { void pinTitle(selectedText, on); }, staying: stayProgress, onStayCover: (banner) => { const next = banner ? setGroundRiseGap(putBehindPerson(timeline!, selectedText.id, [newId(), newId()]), selectedText.id, TITLE_SPACE.close) : cinemaRevealFront(timeline!, selectedText.id, 'pass'); change(next, `stay-cover-${selectedText.id}`); setSelectedId(selectedText.id); }, stayNote: stayNote?.textId === selectedText.id ? stayNote.text : null, onStay: () => { void stayWithPeople(selectedText); }, onStopStay: () => { change(updateText(timeline!, selectedText.id, removeStay(selectedText)), `stay-${selectedText.id}`); setStayNote(null); }, clearing: clearProgress, clearUnder: timeline ? clipUnderTitle(timeline, selectedText) : null, clearNote: keepClearNote?.textId === selectedText.id ? keepClearNote.text : null, onKeepClear: (settings) => { void keepTitleClear(selectedText, settings); }, onRemoveClear: () => { change(updateText(timeline!, selectedText.id, removeKeepClear(selectedText)), `keep-clear-${selectedText.id}`); setKeepClearNote(null); }, timing: textTiming(selectedText), follow: followPanel, onChange: updateSelectedText, onEnter: () => showEnter(selectedText.start, selectedText.enter?.duration ?? 0.5), onExit: () => showExit(selectedText.start + selectedText.length, selectedText.exit?.duration ?? 0.5) } satisfies TextInspectorBindings}><TextInspector/></InspectorBindingsProvider>
        : selectedSound ? <InspectorBindingsProvider name="sound" bindings={{ onLoop: timeline && needsLoop(timeline, selectedSound.sound) && !selectedSound.layer.locked ? () => { void loopSelectedSound(selectedSound.sound.id); } : null, looping: looping, sound: selectedSound.sound, timing: soundTiming(selectedSound.sound), layer: selectedSound.layer, onChange: updateSelectedSound, onLayer: (changes) => change(updateLayer(timeline!, selectedSound.layer.id, changes)), stems: stems, job: stemJob?.soundId === selectedSound.sound.id ? stemJob : null, busy: Boolean(stemJob), onSeparate: (choice) => { void separate(choice); }, onCancelStems: () => { if (stemJob) void cancelRenderJob(stemJob.jobId); } } satisfies SoundInspectorBindings}><SoundInspector/></InspectorBindingsProvider>
        : selected ? <InspectorBindingsProvider name="clip" bindings={{ onReframe: (() => { const item = mediaById.get(selected.media_id); return item?.media_type === 'video' && item.width && item.height && timeline && canReframe({ width: item.width, height: item.height }, selected.adjust.rotation, timeline.format) ? () => { void reframeClip(selected.id); } : null; })(), reframing: Boolean(reframeJob), onMove: (move) => { void moveSelected(move); }, backgrounds: media.filter((item) => item.id !== selected.media_id && (item.media_type === 'video' || item.media_type === 'image')), onBackground: (item) => newBackground(selected, item), logos: media.filter((item) => isBrandImage(item) && item.id !== selected.media_id), clipBrandMarks: brandsOnClip(timeline!, selected).map((mark) => ({ id: mark.id, name: mediaById.get(mark.media_id)?.filename ?? `Media ${mark.media_id}` })), onClipBrand: (item) => change(brandOnClip(timeline!, selected, { media_id: item.id, width: item.width || 800, height: item.height || 800 }, 'top-right', BRAND_SIZES[1].scale, newId()), 'brand'), onRemoveClipBrand: (id) => change(removeClipBrand(timeline!, id), 'brand'), clip: selected, source: sourceFor(selected.media_id), onChange: updateSelected, canDetach: !selected.muted && hasSound(selected.media_id), onDetach: () => detach(), follow: followPanel, isMain: selectedLayer === mainLayer(timeline!), copyReady: Boolean(preparedWant(selected, timeline!.format.fps) && preparedReady[preparedKey(selected.media_id, ...preparedWant(selected, timeline!.format.fps)!)]), onLayout: splitScreen, picking: pickingKey, onPick: startPicking, timing: clipTiming(selected), overlay: selectedLayer?.kind === 'video' && !selectedLayer.magnetic && selectedLayer !== mainLayer(timeline!) ? selectedLayer : null, onLayer: (changes) => change(updateLayer(timeline!, selectedLayer!.id, changes)), closesWithTransition: Boolean(clipsInOrder[clipIndex + 1]?.transition_in), onShowEnter: () => showEnter(selected.start, selected.enter?.duration ?? 0.5), onShowExit: () => showExit(selected.start + clipLength(selected), selected.exit?.duration ?? 0.5) } satisfies InspectorBindings}><Inspector/></InspectorBindingsProvider> : timeline ? <InspectorBindingsProvider name="project" bindings={{ introBusy: introProgress, onBrandIntro: (item, tamil, english) => { void addBrandIntro(item, tamil, english); }, clipFormat: firstClipFormat && { ...firstClipFormat, fps: timeline.format.fps }, logos: media.filter(isBrandImage), logo: (() => { const item = brandClip(timeline); return item ? media.find((entry) => entry.id === item.media_id) ?? null : null; })(), onBrand: (item) => change(applyBrand(timeline, { media_id: item.id, width: item.width || 800, height: item.height || 800 }, 'top-right', BRAND_SIZES[1].scale, newId()), 'brand'), onImported: (items) => {
            // A logo imported here is a brand picture: it goes into the Brand folder.
            const images = items.filter((item) => item.media_type === 'image');
            const filed = items.map((item) => item.media_type === 'image' ? { ...item, folder: BRAND_FOLDER } : item);
            setMedia((current) => [...filed, ...current]);
            if (images.length) void moveMediaToFolder(images.map((item) => item.id), BRAND_FOLDER).catch(() => {});
          }, onRemoveBrand: () => change(removeBrand(timeline), 'brand'), onThemes: () => { setLeftTab('themes'); setPanelOpen(true); } } satisfies ProjectInspectorBindings}><ProjectInspector/></InspectorBindingsProvider>
          : <div className="ed-hint"><h2>Project settings</h2><p>Loading your project…</p></div>}</LayerModeContext.Provider></aside>);
}
