import { useFullscreen } from './hooks/useFullscreen';
import { useFollowJob } from './hooks/useFollowJob';
import { useFaceJob } from './hooks/useFaceJob';
import { useSceneJob } from './hooks/useSceneJob';
import { useReframeJob } from './hooks/useReframeJob';
import { CircleHelp,Download,Trash2,TriangleAlert,X } from 'lucide-react';
import { useCallback,useEffect,useMemo,useReducer,useRef,useState } from 'react';
import { createPortal } from 'react-dom';
import { cancelRenderJob,cleanVoiceUrl,clipFilmstripUrl,clipProxyUrl,fetchCaptionImage,fetchShapeMask,fetchTextImage,fetchTextLetters,getClipAssets,getClipPeaks,getJobStatus,getMusicLibrary,getProjectTimeline,getSongPeaks,getStemsStatus,getVideoProject,getWords,listEffects,listPhotos,listSoundEffects,photoImageUrl,photoThumbUrl,photoVideoUrl,preparedProxyUrl,previewRenderUrl,requestCleanVoice,requestPrepared,saveVideoProject,songUrl,startSceneTrack,startWords,type EffectInfo,type LibraryTrack,type Mood,type SoundEffectInfo,type Stems } from '../api/client';
import AIImageGenerator from '../components/CoverArtGenerator';
import { DeleteMediaDialog,FolderDialog,folderNames } from '../components/MediaDialogs';
import { t } from '../i18n';
import type { Transition,TransitionKind } from '../timeline/animation';
import { LETTER_PRESETS } from '../timeline/animation';
import { coverBrand } from '../timeline/brand';
import { buildCaptions,DEFAULT_CAPTION_OPTIONS } from '../timeline/captions';
import { type Options } from '../timeline/commands';
import { applyBypass,clipEffects,playingTimeline } from '../timeline/effects';
import { commit,redo,startHistory,undo,type History } from '../timeline/history';
import { setKaraoke as setKaraokeFor } from '../timeline/karaoke';
import { addBlur,applyLayerStyles,audioLayers,captionLayers,captionStates,captionText,clipLength,duration,findBlur,findCaption,findClip,findSound,findText,FORMATS,freezeFrame,isLocked,layerOf,mainLayer,markOwn,MAX_PHOTO_SECONDS,newClip,normalizeTimeline,overrideLayerItems,removeBlur,removeCaption,removeClip,removeSound,removeText,REST_TRANSFORM,setCaptions,setLayerStyle,sharedKeys,splitClip,splitSound,textLayers,timecode,updateBlur,updateClip,type BlurBox,type Caption,type CaptionLayer,type CinemaReveal,type Clip,type Format,type ShapeMask,type Sound,type SourceFacts,type TextItem,type Timeline } from '../timeline/model';
import { type Focus } from '../timeline/presets';
import { reframeTransform,type SubjectPoint } from '../timeline/reframe';
import { splitAtCuts } from '../timeline/scenes';
import { STORIES,type Story } from '../timeline/stories';
import { savedStyles,TEMPLATES,type Template } from '../timeline/templates';
import { THEMES } from '../timeline/themes';
import { sceneMatrix,type SceneTrack } from '../timeline/title3d';
import { blurForFace,unfollow,type TrackPoint } from '../timeline/tracking';
import { clearTransitions,transitionEverywhere } from '../timeline/transitions';
import { buildTokens,cutTokens,tidyUp,type Word } from '../timeline/words';
import { wheelFactor,zoomBy } from '../timeline/zoom';
import type { Photo } from '../types/photo';
import { createAskActions } from './actions/ask';
import { createAudioToolActions } from './actions/audio-tools';
import { createClipToolActions } from './actions/clip-tools';
import { createEffectJobActions } from './actions/effect-jobs';
import { createInspectorScopeActions } from './actions/inspector-scope';
import { createEditorMenuActions } from './actions/menus';
import { createPreviewTrackingActions } from './actions/preview-tracking';
import { createThemeActions } from './actions/themes-and-stories';
import { createTitleEditingActions } from './actions/title-editing';
import { createTitleSceneActions } from './actions/title-scene';
import CommandPalette from './CommandPalette';
import { ContextMenu,type MenuState } from './ContextMenu';
import { ExportDialog } from './dialogs/ExportDialog';
import { FormatDialog } from './dialogs/FormatDialog';
import { CAPTION_FETCHES,CLIP_EFFECT_PRESETS,draggableAs,FIT_MARGIN,FREEZE_SECONDS,LEFT_TAB_LABELS,LEFT_TABS,LITE_TABS,MIN_MUSIC_SECONDS,MOOD_LABELS,MOODS,newId,preparedKey,preparedWant,RAIL_BREAK_BEFORE,releaseClickedButton,RENDERED_ID,RESTART_MESSAGE,SHORTCUTS,TAB_ICONS,TAB_TIPS,TEXT_TYPE_DELAY_MS,THUMB_FORMAT,voiceKey,ZOOM_MAX,ZOOM_MIN } from './editor-constants';
import ErrorBanner from './ErrorBanner';
import { Guide } from './Guide';
import { useEditorShortcuts } from './hooks/useEditorShortcuts';
import { LOOK_NAMES } from './inspectors/clip-parts';
import { ASSET_POLL_MS } from './inspectors/parts';
import JobTray from './JobTray';
import { DEFAULT_LAYOUT,HelpContext,LIMITS,RailContext,SimpleContext,Splitter,useEditorLayout,type ThemeChoice } from './layout';
import type { EditorInspectorRailBindings } from './panels/EditorInspectorRail';
import { EditorInspectorRail } from './panels/EditorInspectorRail';
import type { EditorLeftRailBindings } from './panels/EditorLeftRail';
import { EditorLeftRail } from './panels/EditorLeftRail';
import type { EditorTimelineToolbarBindings } from './panels/EditorTimelineToolbar';
import { EditorTimelineToolbar } from './panels/EditorTimelineToolbar';
import { PlaybackEngine,type PlaybackSource } from './playback';
import type { EditorPreviewStageBindings } from './preview/EditorPreviewStage';
import { EditorPreviewStage } from './preview/EditorPreviewStage';
import type { FollowPanelBindings } from './preview/FollowPanel';
import { FollowPanel } from './preview/FollowPanel';
import { ProjectSaveQueue,type SaveState } from './project-save';
import { EditorContext,InspectorBindingsProvider } from './state/EditorContext';
import TimelineView,{ type ClipVisuals } from './TimelineView';
import { TopSettings } from './TopSettings';
import { TRANSITIONS } from './transition-catalog';
import TransitionPopover from './TransitionPopover';
import { useClipboard } from './useClipboard';

type Props = { projectId: number; projectName: string; photo: Photo; onClose: () => void; onOpenOutput: (id: number) => void; theme: string; themeChoice: ThemeChoice; nextTheme: () => void; setTheme?: (choice: ThemeChoice) => void };
type Action = { type: 'load'; timeline: Timeline } | { type: 'change'; timeline: Timeline; group?: string | null } | { type: 'undo' } | { type: 'redo' };
const EMPTY = startHistory<Timeline | null>(null);
type StemChoice = 'music' | 'vocals' | 'both';
type StemJob = { soundId: string; jobId: string; choice: StemChoice; progress: number };
type Box = [number, number, number, number];
type FollowJob = { itemId: string; underId: string; jobId: string; progress: number; queued?: boolean; drawnAt: number; from: number; size: boolean; place: Box | null; own: boolean; grew: boolean;
  /** Set while looking for a face under a blur box: where the box is in the source, and what to follow instead when no face is there. */
  faces?: { box: Box; at: number; own: Box; grow?: number } };

function reducer(state: History<Timeline | null>, action: Action): History<Timeline | null> {
  if (action.type === 'load') return startHistory(action.timeline);
  if (action.type === 'change') return commit(state, action.timeline, action.group ?? null);
  const next = action.type === 'undo' ? undo(state) : redo(state);
  return next.present === null ? state : next;
}

export default function Editor({ projectId, projectName, photo, onClose, onOpenOutput, theme, themeChoice, nextTheme, setTheme }: Props) {
  const [history, dispatch] = useReducer(reducer, EMPTY);
  const timeline = history.present;
  const [choosingFormat, setChoosingFormat] = useState(false);
  const [media, setMedia] = useState<Photo[]>([photo]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Multi-select: items picked along with the selected one (⌘-click adds, Shift-click picks a range on its layer).
  const [moreIds, setMoreIds] = useState<ReadonlySet<string>>(new Set());
  const [zoom, setZoom] = useState(40);
  const [snapping, setSnapping] = useState(true);  // N turns snapping off and on.
  // First steps for a new video: shown until each is done or the card is closed.
  const [firstRunClosed, setFirstRunClosed] = useState(() => { try { return localStorage.getItem('kanaa-first-run-closed') === '1'; } catch { return false; } });
  const [exportedOnce, setExportedOnce] = useState(() => { try { return localStorage.getItem('kanaa-exported-once') === '1'; } catch { return false; } });
  const [playing, setPlaying] = useState(false);
  const [saved, setSaved] = useState<SaveState>('saved');
  const [ready, setReady] = useState<Record<number, boolean>>({});
  const [preparedReady, setPreparedReady] = useState<Record<string, boolean>>({});
  const [cleanReady, setCleanReady] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  /** An informational banner: a fact about the project, not a failure — calm note style, not the red error. */
  const [note, setNote] = useState('');
  const [safeArea, setSafeArea] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [addingMusic, setAddingMusic] = useState(false);
  const [creatingAIImage, setCreatingAIImage] = useState(false);
  // The preview alone, filling the screen. Esc or the same button leaves it.
  const stageRef = useRef<HTMLElement>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const toggleFullScreen = useFullscreen(stageRef, setFullScreen);
  /** Fills the window at once, and the whole screen where the system allows it. */
  
  // The person's own music, read once when Themes or Audio is first opened.
  const [library, setLibrary] = useState<LibraryTrack[] | null>(null);
  const [libraryFolder, setLibraryFolder] = useState('');
  const [themeWithMusic, setThemeWithMusic] = useState(true);
  const [themeTrack, setThemeTrack] = useState<string | null>(null);
  const [themeBusy, setThemeBusy] = useState<string | null>(null);
  // A story being filled: what goes in each moment, and which moment is choosing.
  const [story, setStory] = useState<{ story: Story; fills: (number | null)[]; choosing: number | null } | null>(null);
  const [musicMood, setMusicMood] = useState<Mood | null>(null);
  const [musicSearch, setMusicSearch] = useState('');
  /** The left panel: a slim icon rail. It starts open on Media; clicking the open tab's icon folds it away. */
  const [panelOpen, setPanelOpen] = useState(true);
  /** The transition kind picked in the Transitions tab; used for click-apply and Every cut. */
  const [transitionPick, setTransitionPick] = useState<TransitionKind>('crossfade');
  /** The cut whose transition popover is open: the clip after it, and its badge on screen. */
  /** The clip being renamed right on the timeline. */
  const [renamingClip, setRenamingClip] = useState<string | null>(null);
  const [cutOpen, setCutOpen] = useState<{ clipId: string; anchor: DOMRect } | null>(null);
  /** True while the Remove-all-transitions confirmation is up. */
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [listening, setListening] = useState<string | null>(null);
  const listenRef = useRef<HTMLAudioElement | null>(null);
  const [stemJob, setStemJob] = useState<StemJob | null>(null);
  const [now, setNow] = useState(0);
  const { layout, update: updateLayout, reset: resetLayout } = useEditorLayout();
  const [leftTab, setLeftTab] = useState<(typeof LEFT_TABS)[number]>('media');
  /** Lite mode: a guided, template-driven path. Only these menus show. */
  useEffect(() => { if (layout.simple && !LITE_TABS.has(leftTab)) setLeftTab('media'); }, [layout.simple, leftTab]);
  const [language, setLanguage] = useState(() => { try { return localStorage.getItem('wa.wordsLanguage') ?? 'auto'; } catch { return 'auto'; } });
  const [transcripts, setTranscripts] = useState<Record<string, Word[]>>({});
  const [wordJob, setWordJob] = useState<{ mediaId: number; id: string; progress: number; left: number[] } | null>(null);
  const [wordSelection, setWordSelection] = useState<Set<string>>(new Set());
  const [showingHelp, setShowingHelp] = useState(false);
  // The guide's article to open at: an ⓘ in a settings panel picks one.
  const [guideArticle, setGuideArticle] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const openGuide = useCallback((article: string) => { setGuideArticle(article); setShowingHelp(true); }, []);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pickingKey, setPickingKey] = useState(false);
  const [drawing, setDrawing] = useState<{ mode: 'start' | 'continue'; from?: [number, number]; to?: [number, number]; onBox?: (box: Box) => void } | null>(null);
  const drawStart = useRef<[number, number] | null>(null); // Pointer events can arrive before a re-render, so the corner is kept here too.
  const [followSize, setFollowSize] = useState(false);
  const [followJob, setFollowJob] = useState<FollowJob | null>(null);
  // Scene tracks for titles locked to the scene, by media and source stretch, and how far one being made has got.
  const [sceneTracks, setSceneTracks] = useState<Record<string, SceneTrack>>({});
  const [pinProgress, setPinProgress] = useState<number | null>(null);
  const sceneTrackKey = (mediaId: number, stretch: { start: number; end: number; at: number; horizon?: boolean; region?: [number, number] | null; upright?: boolean }) => `${mediaId}:${Math.round(stretch.start * 30)}:${Math.round(stretch.end * 30)}:${Math.round(stretch.at * 30)}${stretch.horizon ? ':horizon' : ''}${stretch.region ? `:${stretch.region[0].toFixed(3)},${stretch.region[1].toFixed(3)}` : ''}${stretch.upright ? ':upright' : ''}`;
  const { pinTarget, pinTitle, placeInScene, clipUnderTitle, keepTitleClear, addBrandIntro, stayWithPeople } = createTitleSceneActions(() => ({
    get sceneTrackKey(): typeof sceneTrackKey { return sceneTrackKey; },
    get timelineRef(): typeof timelineRef { return timelineRef; },
    get change(): typeof change { return change; },
    get engineRef(): typeof engineRef { return engineRef; },
    get mediaById(): typeof mediaById { return mediaById; },
    get setError(): typeof setError { return setError; },
    get setPinProgress(): typeof setPinProgress { return setPinProgress; },
    get setSceneTracks(): typeof setSceneTracks { return setSceneTracks; },
    get setPlacing(): typeof setPlacing { return setPlacing; },
    get newId(): typeof newId { return newId; },
    get setNote(): typeof setNote { return setNote; },
    get setClearProgress(): typeof setClearProgress { return setClearProgress; },
    get setKeepClearNote(): typeof setKeepClearNote { return setKeepClearNote; },
    get sceneTracks(): typeof sceneTracks { return sceneTracks; },
    get setIntroProgress(): typeof setIntroProgress { return setIntroProgress; },
    get setMedia(): typeof setMedia { return setMedia; },
    get setStayProgress(): typeof setStayProgress { return setStayProgress; },
    get setStayNote(): typeof setStayNote { return setStayNote; },
    get setSelectedId(): typeof setSelectedId { return setSelectedId; },
  }));
  /** Place in scene: waiting for a click on the preview for this title, or working out the surface. */
  const [placing, setPlacing] = useState<{ textId: string; busy: boolean } | null>(null);
  useEffect(() => {
    if (!placing || placing.busy) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setPlacing(null); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [placing]);
  const [clearProgress, setClearProgress] = useState<number | null>(null);
  const [keepClearNote, setKeepClearNote] = useState<{ textId: string; text: string } | null>(null);
  const [introProgress, setIntroProgress] = useState<number | null>(null);
  const [stayProgress, setStayProgress] = useState<number | null>(null);
  const [stayNote, setStayNote] = useState<{ textId: string; text: string } | null>(null);
  const [followNote, setFollowNote] = useState<{ itemId: string; text: string } | null>(null);
  const [faceJob, setFaceJob] = useState<{ jobId: string; clipId: string; progress: number } | null>(null);
  const [reframeJob, setReframeJob] = useState<{ jobId: string; clipId: string; progress: number } | null>(null);
  const [sceneJob, setSceneJob] = useState<{ jobId: string; clipId: string; progress: number } | null>(null);
  const [faceNote, setFaceNote] = useState('');
  const [captionWords, setCaptionWords] = useState(DEFAULT_CAPTION_OPTIONS.words);
  const [captionsWaiting, setCaptionsWaiting] = useState(false);
  const [pauseLength, setPauseLength] = useState(0.7);
  const [shaping, setShaping] = useState<{ textId: string; mode: 'ground' | 'outline'; points: [number, number][]; reveal?: CinemaReveal } | null>(null);
  const [removeFillers, setRemoveFillers] = useState(true);
  const [folder, setFolder] = useState<string | null>(null);
  const [filing, setFiling] = useState<Photo | null>(null);
  const [deleting, setDeleting] = useState<Photo | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const stopPicking = useCallback(() => { setPickingKey(false); engineRef.current?.showUnkeyed(null); }, []);
  const rootRef = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);
  const [heavy, setHeavy] = useState(false);
  const [rendered, setRendered] = useState<{ key: string; url: string } | null>(null);
  const [renderJob, setRenderJob] = useState<{ id: string; key: string; progress: number } | null>(null);
  const [stems, setStems] = useState<{ available: boolean; install_command: string } | null>(null);
  const [, redrawPeaks] = useReducer((count: number) => count + 1, 0);
  const songPeaks = useRef(new Map<string, ClipVisuals['peaks'] | 'loading'>());
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const playhead = useRef({ current: 0 }).current;
  const fastRate = useRef(0);
  const loadedRef = useRef(false);
  const saveQueue = useRef<ProjectSaveQueue | null>(null);
  if (!saveQueue.current) saveQueue.current = new ProjectSaveQueue(
    (serialized) => saveVideoProject(projectId, 'edit', JSON.parse(serialized)),
    setSaved,
  );
  const visuals = useRef(new Map<number, ClipVisuals>());

  const mediaById = useMemo(() => new Map(media.map((item) => [item.id, item])), [media]);
  const facts = useCallback((id: number): SourceFacts | undefined => {
    const item = mediaById.get(id);
    return item && { media_id: id, media_type: item.media_type === 'video' ? 'video' : 'image', duration: item.duration, width: item.width, height: item.height };
  }, [mediaById]);
  const sourceFor = useCallback((id: number, clip?: Clip): PlaybackSource | undefined => {
    const item = mediaById.get(id);
    if (!item) return undefined;
    const size = { width: item.width || 1920, height: item.height || 1080 };
    if (item.media_type !== 'video') return { url: photoImageUrl(id), kind: 'image', ...size };
    // Until its prepared copy is ready, a steadied or reversed clip previews the original.
    const want = clip && preparedWant(clip, timelineRef.current?.format.fps ?? 30);
    if (want && preparedReady[preparedKey(id, ...want)]) return { url: preparedProxyUrl(id, ...want), kind: 'video', ...size, duration: item.duration, reversed: want[1] };
    // A new blur strength or focus is made in the background; until then the last ready blur shows, not the sharp original.
    if (want && want[2].startsWith('blur')) {
      const prefix = `${id}:${want[0] ? 1 : 0}:${want[1] ? 1 : 0}:${want[2]}:blur`;
      const earlier = Object.keys(preparedReady).find((key) => preparedReady[key] && key.startsWith(prefix));
      if (earlier) return { url: preparedProxyUrl(id, want[0], want[1], want[2], earlier.slice(earlier.indexOf(':blur') + 1)), kind: 'video', ...size, duration: item.duration, reversed: want[1] };
    }
    return { url: ready[id] ? clipProxyUrl(id) : photoVideoUrl(id), kind: 'video', ...size, duration: item.duration,
      pendingCutout: Boolean(clip?.cutout === 'remove' && want && !preparedReady[preparedKey(id, ...want)]) };
  }, [mediaById, ready, preparedReady]);

  const textImages = useRef(new Map<string, string | 'loading'>());
  // Where each letter of a letter-by-letter title is, by look (/api/text-letters).
  const textLetterMaps = useRef(new Map<string, { boxes: [number, number, number, number][]; labels: string } | 'loading'>());
  const [textVersion, redrawText] = useReducer((count: number) => count + 1, 0);
  const textKey = (text: TextItem, format: Format) => JSON.stringify([text.text, text.style, text.position, text.color, text.size, text.subtitle ?? null, text.subtitle_size ?? null, text.subtitle_color ?? null, Boolean(text.subtitle_above), text.subtitle_spacing ?? 0, text.spacing ?? 0, text.align ?? 'center', text.band_color ?? null, text.font ?? null, text.tamil_font ?? null, text.design ?? null, text.karaoke?.color ?? null, format.width, format.height]);
  const textUrl = useCallback((text: TextItem, lit?: number | null) => {
    const found = timelineRef.current && textImages.current.get(textKey(text, timelineRef.current.format) + (lit == null ? '' : `|lit${lit}`));
    return found && found !== 'loading' ? found : undefined;
  }, []);
  useEffect(() => {
    if (!timeline) return;
    const timer = setTimeout(() => {
      for (const text of textLayers(timeline).flatMap((layer) => layer.items)) {
        const key = textKey(text, timeline.format);
        if (textImages.current.has(key)) continue;
        textImages.current.set(key, 'loading');
        void fetchTextImage(text, timeline.format).then((url) => { textImages.current.set(key, url); redrawText(); }).catch((problem: Error) => { textImages.current.delete(key); setError(problem.message); });
      }
      // Karaoke lines: one picture for each word sung so far.
      for (const text of textLayers(timeline).flatMap((layer) => layer.items)) {
        for (let lit = 0; lit < (text.karaoke?.words.length ?? 0); lit += 1) {
          const key = `${textKey(text, timeline.format)}|lit${lit}`;
          if (textImages.current.has(key)) continue;
          textImages.current.set(key, 'loading');
          void fetchTextImage(text, timeline.format, lit).then((url) => { textImages.current.set(key, url); redrawText(); }).catch(() => { textImages.current.delete(key); });
        }
      }
      // Letter-by-letter titles also need to know where each letter is (the same map the export finds).
      for (const text of textLayers(timeline).flatMap((layer) => layer.items)) {
        if (![text.enter, text.exit].some((animation) => animation && LETTER_PRESETS.has(animation.preset))) continue;
        const key = textKey(text, timeline.format);
        if (textLetterMaps.current.has(key)) continue;
        textLetterMaps.current.set(key, 'loading');
        void fetchTextLetters(text, timeline.format).then((map) => { textLetterMaps.current.set(key, map); redrawText(); }).catch(() => { textLetterMaps.current.delete(key); });
      }
    }, TEXT_TYPE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [timeline]);
  // Captions: one image per caption and lit word, drawn by the server like titles, fetched a few at a time.
  const captionImages = useRef(new Map<string, string | 'loading'>());
  const captionKey = (layer: CaptionLayer, caption: Caption, lit: number | null, format: Format) => JSON.stringify([captionText(caption), lit, layer.style, caption.position ?? layer.position, layer.color, layer.highlight, layer.size, format.width, format.height]);
  const captionUrl = useCallback((layer: CaptionLayer, caption: Caption, lit: number | null) => {
    const found = timelineRef.current && captionImages.current.get(captionKey(layer, caption, lit, timelineRef.current.format));
    return found && found !== 'loading' ? found : undefined;
  }, []);
  useEffect(() => {
    if (!timeline) return;
    let stopped = false;
    const timer = setTimeout(() => {
      const wanted = captionLayers(timeline).flatMap((layer) => layer.items.flatMap((caption) => captionStates(caption, Boolean(layer.highlight)).map(([, , lit]) => ({ layer, caption, lit }))))
        .filter(({ layer, caption, lit }) => !captionImages.current.has(captionKey(layer, caption, lit, timeline.format)));
      // Nearest the playhead first, so what is on screen shows up soonest.
      wanted.sort((a, b) => Math.abs(a.caption.start - playhead.current) - Math.abs(b.caption.start - playhead.current));
      const next = async () => {
        const job = wanted.shift();
        if (!job || stopped) return;
        const key = captionKey(job.layer, job.caption, job.lit, timeline.format);
        captionImages.current.set(key, 'loading');
        const look = { style: job.layer.style, position: job.caption.position ?? job.layer.position, color: job.layer.color, highlight: job.layer.highlight, size: job.layer.size };
        try { captionImages.current.set(key, await fetchCaptionImage(job.caption, look, job.lit, timeline.format)); redrawText(); } catch { captionImages.current.delete(key); }
        await next();
      };
      for (let lane = 0; lane < CAPTION_FETCHES; lane += 1) void next();
    }, TEXT_TYPE_DELAY_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [timeline, playhead]);
  // Shape masks: the server draws each once, the same picture the export uses.
  const shapeImages = useRef(new Map<string, string | 'loading'>());
  useEffect(() => {
    if (!timeline) return;
    const masks = timeline.layers.flatMap((layer) => (layer.kind === 'video' ? layer.items.flatMap((clip) => (clip.shape_mask ? [clip.shape_mask] : [])) : []));
    for (const mask of masks) {
      const key = JSON.stringify([mask, timeline.format.width, timeline.format.height]);
      if (shapeImages.current.has(key)) continue;
      shapeImages.current.set(key, 'loading');
      void fetchShapeMask(mask, timeline.format).then((url) => { shapeImages.current.set(key, url); redrawText(); }).catch((problem: Error) => { shapeImages.current.delete(key); setError(problem.message); });
    }
    if (engineRef.current) engineRef.current.shapeUrl = (mask: ShapeMask) => {
      const found = timelineRef.current && shapeImages.current.get(JSON.stringify([mask, timelineRef.current.format.width, timelineRef.current.format.height]));
      return found && found !== 'loading' ? found : undefined;
    };
  }, [timeline]);
  const soundUrl = useCallback((sound: Sound) => {
    // Until its cleaned copy is ready, a sound with Clean voice plays as recorded.
    if (sound.clean_voice && cleanReady[voiceKey(sound)]) return cleanVoiceUrl(sound);
    if (sound.asset_id) return songUrl(sound.asset_id);
    const item = sound.media_id === undefined ? undefined : mediaById.get(sound.media_id);
    return item ? (ready[item.id] ? clipProxyUrl(item.id) : photoVideoUrl(item.id)) : undefined;
  }, [mediaById, ready, cleanReady]);
  const soundPeaks = useCallback((sound: Sound) => {
    if (sound.media_id !== undefined) return visuals.current.get(sound.media_id)?.peaks;
    const peaks = songPeaks.current.get(sound.asset_id ?? '');
    return peaks === 'loading' ? undefined : peaks;
  }, []);

  useEffect(() => { void getStemsStatus().then(setStems).catch(() => setStems(null)); }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [project, upgraded, library] = await Promise.all([getVideoProject<{ version?: number; fresh?: boolean }>(projectId, 'edit'), getProjectTimeline<Timeline>(projectId), listPhotos({ collection: 'imports', limit: 500 })]);
        if (cancelled) return;
        setMedia((current) => [...current, ...library.photos.filter((item) => !current.some((entry) => entry.id === item.id))]);
        // A new project's first timeline is marked fresh until its first save, so the editor still asks where it will be posted.
        const started = project.recipe?.version === 2 && !project.recipe.fresh;
        const loaded = normalizeTimeline(upgraded);
        saveQueue.current!.load(started ? JSON.stringify(loaded) : '');
        dispatch({ type: 'load', timeline: loaded });
        if (!started) setChoosingFormat(true);
        loadedRef.current = true;
      } catch (problem) {
        // Only a backend older than this page lacks the timeline route.
        if (!cancelled) setError((problem as Error).message === 'Not Found' ? RESTART_MESSAGE : (problem as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // Someone else (an AI agent through Kanaa's MCP server, or another window) may change the saved project. Every few
  // seconds while this window is visible, the saved timeline is compared with the one this editor last loaded or
  // saved; a change comes in as an ordinary step, so Undo takes it back. Unsaved edits here are never overwritten.
  const remoteNoted = useRef('');
  useEffect(() => {
    const canonical = (value: unknown) => JSON.stringify(value);
    const check = async () => {
      const queue = saveQueue.current;
      if (!loadedRef.current || !queue || document.visibilityState !== 'visible' || !queue.saved) return;
      let recipe: Timeline | null;
      try { recipe = (await getVideoProject<Timeline>(projectId, 'edit')).recipe; } catch { return; }
      // Compared in the editor's own form: a project saved by Kanaa's backend (a lyric build, an agent) lacks some
      // defaults the editor fills in, which is not a change.
      if (!recipe || canonical(normalizeTimeline(recipe)) === canonical(JSON.parse(queue.saved))) return;
      if (queue.pending) {
        if (remoteNoted.current !== canonical(recipe)) { remoteNoted.current = canonical(recipe); setNote('This project was changed outside this window while you were editing. Your edits are kept; reopen the project to see the other change.'); }
        return;
      }
      const next = normalizeTimeline(recipe);
      queue.load(JSON.stringify(next));
      dispatch({ type: 'change', timeline: next, group: `outside-${Date.now()}` });
      setNote('Updated from outside this window (an AI agent or another window). Undo takes it back.');
    };
    const timer = window.setInterval(() => { void check(); }, 3000);
    return () => window.clearInterval(timer);
  }, [projectId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const engine = new PlaybackEngine(canvas);
      engine.onTime = (t) => {
        playhead.current = t;
        if (clockRef.current) clockRef.current.textContent = timecode(t);
        if (!engine.playing) setNow(t);
      };
      engine.onStruggling = () => setHeavy(true);
      engine.onPlayingChange = (value) => { setPlaying(value); if (!value) setNow(engine.currentTime); };
      engineRef.current = engine;
      if (import.meta.env.DEV) (window as unknown as { motionEngine: PlaybackEngine }).motionEngine = engine;
      return () => { engine.destroy(); engineRef.current = null; };
    } catch (problem) { setError((problem as Error).message); }
  }, [playhead]);

  useEffect(() => { if (!timeline) return;
    const flat = rendered && rendered.key === JSON.stringify(timeline) ? rendered : null;
    if (engineRef.current) engineRef.current.letterMap = (item) => {
      const found = textLetterMaps.current.get(textKey(item, timeline.format));
      return found && found !== 'loading' ? found : null;
    };
    if (engineRef.current) engineRef.current.pinMatrix = (item, time) => {
      const target = pinTarget(timeline, item);
      const track = target && sceneTracks[target.key];
      const source = target && mediaById.get(target.clip.media_id);
      return target && track && source ? sceneMatrix(track, target.clip, { width: source.width || timeline.format.width, height: source.height || timeline.format.height }, timeline.format, time, item.pin!.at) : null;
    };
    if (!flat) { engineRef.current?.setTimeline(playingTimeline(coverBrand(timeline)), sourceFor, soundUrl, textUrl, captionUrl); return; }
    // The rendered copy plays as one clip, so nothing else has to keep up.
    const length = duration(timeline);
    const base = newClip({ media_id: RENDERED_ID, media_type: 'video', duration: length, ...timeline.format }, 'rendered');
    const single: Timeline = { version: 2, format: timeline.format, layers: [{ id: 'rendered', kind: 'video', magnetic: true, items: [{ ...base, out: length }] }] };
    engineRef.current?.setTimeline(single, (id) => (id === RENDERED_ID ? { url: flat.url, kind: 'video', ...timeline.format } : sourceFor(id)), soundUrl, textUrl);
  }, [timeline, sourceFor, soundUrl, textUrl, textVersion, rendered, sceneTracks, mediaById]);
  // Pinned titles in a project that has just opened: fetch their scene tracks, or make them in the background.
  const pinnedNeeded = useMemo(() => (timeline ? timeline.layers.flatMap((layer) => (layer.kind === 'text' ? layer.items : [])).flatMap((item) => { const target = pinTarget(timeline, item); return target && !sceneTracks[target.key] ? [JSON.stringify([target.clip.media_id, target.stretch, target.key])] : []; }) : []).join('|'), [timeline, sceneTracks]);
  useEffect(() => {
    if (!pinnedNeeded) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      for (const entry of pinnedNeeded.split('|')) {
        const [mediaId, stretch, key] = JSON.parse(entry) as [number, { start: number; end: number; at: number; horizon?: boolean }, string];
        try { const made = await startSceneTrack(mediaId, stretch); if (made.track && !stopped) setSceneTracks((tracks) => ({ ...tracks, [key]: made.track! })); } catch { /* The title shows unlocked until its track can be made. */ }
      }
      if (!stopped) timer = setTimeout(check, ASSET_POLL_MS);
    };
    void check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [pinnedNeeded]);

  useEffect(() => {
    if (!renderJob) return;
    const timer = setTimeout(async () => {
      try {
        const status = await getJobStatus(renderJob.id);
        if (status.status === 'done') { setRendered({ key: renderJob.key, url: `${previewRenderUrl(projectId)}?v=${renderJob.id}` }); setRenderJob(null); setHeavy(false); return; }
        if (status.status === 'failed' || status.status === 'cancelled') { if (status.status === 'failed') setError(status.error ?? 'The preview could not be rendered.'); setRenderJob(null); return; }
        setRenderJob({ ...renderJob, progress: status.progress });
      } catch (problem) { setError((problem as Error).message); setRenderJob(null); }
    }, 800);
    return () => clearTimeout(timer);
  }, [renderJob, projectId]);

  const preparedNeeded = useMemo(() => [...new Set(timeline ? timeline.layers.flatMap((layer) => (layer.kind === 'video' ? layer.items.flatMap((clip) => {
    const want = mediaById.get(clip.media_id)?.media_type === 'video' && preparedWant(applyBypass(clip), timeline.format.fps);
    return want ? [preparedKey(clip.media_id, ...want)] : [];
  }) : [])) : [])].join(','), [timeline, mediaById]);
  useEffect(() => {
    const keys = preparedNeeded ? preparedNeeded.split(',').filter((key) => !preparedReady[key]) : [];
    if (!keys.length) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      for (const key of keys) {
        const [id, steady, backwards, echo, cutout] = key.split(':');
        try { if ((await requestPrepared(Number(id), steady === '1', backwards === '1', echo, cutout)).status === 'ready' && !stopped) setPreparedReady((current) => ({ ...current, [key]: true })); } catch (problem) {
          if (!stopped && cutout) {
            const message = (problem as Error).message;
            // A photo (or unknown cut-out) can never prepare: that is a fact about the clip, not a failure.
            if (message.startsWith('Only videos can be steadied')) setNote('Pick the reveal again: Kanaa turns the picture into a still video first, then finds the people.');
            else setError(message);
          }
        }
      }
      if (!stopped) timer = setTimeout(check, ASSET_POLL_MS);
    };
    void check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [preparedNeeded, preparedReady]);

  // Clean voice: each sound source that needs a cleaned copy asks for it until it is ready.
  const voicesNeeded = useMemo(() => [...new Set(timeline ? timeline.layers.flatMap((layer) => (layer.items as (Clip | Sound)[]).filter((item) => 'clean_voice' in item && item.clean_voice && (layer.kind === 'audio' || layer.kind === 'video'))
    .map((item) => voiceKey(item as Sound))) : [])].join(','), [timeline]);
  useEffect(() => {
    const keys = voicesNeeded ? voicesNeeded.split(',').filter((key) => !cleanReady[key]) : [];
    if (!keys.length) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      for (const key of keys) {
        const source = key.startsWith('a:') ? { asset_id: key.slice(2) } : { media_id: Number(key.slice(2)) };
        try { if ((await requestCleanVoice(source)).status === 'ready' && !stopped) setCleanReady((current) => ({ ...current, [key]: true })); } catch (problem) { if (!stopped) setError((problem as Error).message); }
      }
      if (!stopped) timer = setTimeout(check, ASSET_POLL_MS);
    };
    void check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [voicesNeeded, cleanReady]);
  useEffect(() => { if (engineRef.current) engineRef.current.cleanVoice = (id) => (cleanReady[`m:${id}`] ? cleanVoiceUrl({ media_id: id }) : undefined); }, [cleanReady]);

  const usedMedia = useMemo(() => [...new Set(timeline ? [...timeline.layers.flatMap((layer) => (layer.kind === 'video' ? layer.items.map((clip) => clip.media_id) : [])), ...audioLayers(timeline).flatMap((layer) => layer.items.flatMap((sound) => sound.media_id ?? []))] : [])].join(','), [timeline]);

  useEffect(() => {
    for (const sound of timeline ? audioLayers(timeline).flatMap((layer) => layer.items) : []) {
      const id = sound.asset_id;
      if (!id || songPeaks.current.has(id)) continue;
      songPeaks.current.set(id, 'loading');
      void getSongPeaks(id).then((peaks) => { songPeaks.current.set(id, peaks); redrawPeaks(); }).catch(() => songPeaks.current.delete(id));
    }
  }, [timeline]);

  useEffect(() => {
    if (!stemJob) return;
    const timer = setTimeout(async () => {
      try {
        const status = await getJobStatus(stemJob.jobId) as unknown as { status?: string; progress: number; error?: string | null; stems?: Stems };
        if (status.status === 'done' && status.stems && timelineRef.current) { applyStems(status.stems); return; }
        if (status.status === 'failed' || status.status === 'cancelled') {
          if (status.status === 'failed') setError(status.error ?? 'Voice separation failed.');
          setStemJob(null);
          return;
        }
        setStemJob({ ...stemJob, progress: status.progress });
      } catch (problem) { setError((problem as Error).message); setStemJob(null); }
    }, 1000);
    return () => clearTimeout(timer);
  });
  useEffect(() => {
    const ids = usedMedia ? usedMedia.split(',').map(Number) : [];
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      let waiting = false;
      for (const id of ids) {
        if (visuals.current.get(id)?.filmstrip) continue;
        if (mediaById.get(id)?.media_type !== 'video') {
          const image = new Image();
          image.onload = () => visuals.current.set(id, { filmstrip: { image, tiles: 1, tile_width: image.naturalWidth, tile_height: image.naturalHeight } });
          image.src = photoThumbUrl(id);
          continue;
        }
        try {
          const assets = await getClipAssets(id);
          if (assets.status === 'preparing') waiting = true;
          if (assets.status === 'ready' && assets.filmstrip && !stopped) {
            const image = new Image(); image.src = clipFilmstripUrl(id);
            visuals.current.set(id, { filmstrip: { image, ...assets.filmstrip }, peaks: await getClipPeaks(id) });
            setReady((current) => ({ ...current, [id]: true }));
          }
        } catch { waiting = true; }
      }
      if (waiting && !stopped) timer = setTimeout(check, ASSET_POLL_MS);
    };
    void check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [usedMedia, mediaById]);

  useEffect(() => {
    if (!timeline || !loadedRef.current || choosingFormat) return;
    saveQueue.current!.change(JSON.stringify(timeline));
  }, [timeline, choosingFormat]);
  const closeEditor = useCallback(async () => {
    if (await saveQueue.current!.flush()) onClose();
    else setError('Your latest edit could not be saved. Check the connection and try Back again.');
  }, [onClose]);
  useEffect(() => {
    const flush = () => saveQueue.current!.flush();
    window.kanaaFlush = flush;
    return () => {
      if (window.kanaaFlush === flush) delete window.kanaaFlush;
      void saveQueue.current!.flush();
    };
  }, []);

  const change = useCallback((next: Timeline, group?: string | null) => dispatch({ type: 'change', timeline: applyLayerStyles(next), group }), []);
  const [layerSettings, setLayerSettings] = useState<string | null>(null);
  useEffect(() => { if (!selectedId) { setLayerSettings(null); setMoreIds(new Set()); } }, [selectedId]);
  const selected = timeline ? findClip(timeline, selectedId) : null;
  const local = selected ? Math.max(0, Math.min(now - selected.start, clipLength(selected))) : 0;
  const selectedSound = timeline ? findSound(timeline, selectedId) : null;
  const selectedLayer = timeline ? layerOf(timeline, selectedId) : undefined;
  const isRendered = Boolean(timeline && rendered && rendered.key === JSON.stringify(timeline));
  const { addEffect, keepClearOfFaces, reframeClip, splitScenes, blurFaces, askForFaceFinder, renderPreview, addBlurBox } = createEffectJobActions(() => ({
    get timeline(): typeof timeline { return timeline; },
    get engineRef(): typeof engineRef { return engineRef; },
    get projectId(): typeof projectId { return projectId; },
    get setRenderJob(): typeof setRenderJob { return setRenderJob; },
    get setError(): typeof setError { return setError; },
    get change(): typeof change { return change; },
    get setSelectedId(): typeof setSelectedId { return setSelectedId; },
    get effectBusy(): typeof effectBusy { return effectBusy; },
    get setEffectBusy(): typeof setEffectBusy { return setEffectBusy; },
    get weather(): typeof weather { return weather; },
    get setMedia(): typeof setMedia { return setMedia; },
    get timelineRef(): typeof timelineRef { return timelineRef; },
    get effects(): typeof effects { return effects; },
    get clearing(): typeof clearing { return clearing; },
    get isVideo(): typeof isVideo { return isVideo; },
    get setClearNote(): typeof setClearNote { return setClearNote; },
    get setClearing(): typeof setClearing { return setClearing; },
    get mediaById(): typeof mediaById { return mediaById; },
    get reframeJob(): typeof reframeJob { return reframeJob; },
    get setFaceNote(): typeof setFaceNote { return setFaceNote; },
    get setReframeJob(): typeof setReframeJob { return setReframeJob; },
    get setSceneJob(): typeof setSceneJob { return setSceneJob; },
    get playhead(): typeof playhead { return playhead; },
    get setFaceJob(): typeof setFaceJob { return setFaceJob; },
  }));
  const selectedText = timeline ? findText(timeline, selectedId)?.text ?? null : null;
  const selectedBlur = timeline ? findBlur(timeline, selectedId)?.blur ?? null : null;
  const selectedCaption = timeline ? findCaption(timeline, selectedId) : null;
  const settingsLayer = layerSettings ? timeline?.layers.find((l) => l.id === layerSettings) : undefined;
  const selectedIdentity = settingsLayer ? { kind: 'Layer', name: settingsLayer.name || (settingsLayer.kind === 'text' ? 'Text' : 'Video') }
    : selected ? { kind: 'Clip', name: selected.name || (mediaById.get(selected.media_id)?.filename ?? `Media ${selected.media_id}`) }
    : selectedText ? { kind: 'Title', name: selectedText.text || 'Untitled title' }
      : selectedSound ? { kind: 'Sound', name: selectedSound.sound.name || 'Untitled sound' }
        : selectedBlur ? { kind: 'Privacy', name: selectedBlur.style === 'pixelate' ? 'Pixelated area' : 'Blurred area' }
          : selectedCaption ? { kind: 'Caption', name: captionText(selectedCaption.caption) || 'Empty caption' } : null;
  const blurLocal = selectedBlur ? Math.max(0, Math.min(now - selectedBlur.start, selectedBlur.length)) : 0;
  const updateSelectedBlur = (changes: Partial<BlurBox>, group?: string) => { if (timeline && selectedBlur) change(updateBlur(timeline, selectedBlur.id, changes), group); };
  const textLocal = selectedText ? Math.max(0, Math.min(now - selectedText.start, selectedText.length)) : 0;
  // Edits go to this item alone (and become its own, over the layer's style), or to the whole layer's style.
  // The settings panel can show a whole text or video layer (its icon on the timeline): edits then go to the layer's style.
  const styleScope: 'item' | 'layer' = layerSettings ? 'layer' : 'item';
  const [layerWins, setLayerWins] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const { openLayerSettings, scopeBar, pick, paletteCommands, findSetting, mixedSettings, clipTiming, soundTiming, textTiming } = createInspectorScopeActions(() => ({
    get fps(): typeof fps { return fps; },
    get setSyncOpen(): typeof setSyncOpen { return setSyncOpen; },
    get timeline(): typeof timeline { return timeline; },
    get setSelectedId(): typeof setSelectedId { return setSelectedId; },
    get setLayerSettings(): typeof setLayerSettings { return setLayerSettings; },
    get layerSettings(): typeof layerSettings { return layerSettings; },
    get layerWins(): typeof layerWins { return layerWins; },
    get setLayerWins(): typeof setLayerWins { return setLayerWins; },
    get change(): typeof change { return change; },
    get syncOpen(): typeof syncOpen { return syncOpen; },
    get now(): typeof now { return now; },
    get seek(): typeof seek { return seek; },
    get selectedId(): typeof selectedId { return selectedId; },
    get setMoreIds(): typeof setMoreIds { return setMoreIds; },
    get moreIds(): typeof moreIds { return moreIds; },
    get total(): typeof total { return total; },
    get togglePlay(): typeof togglePlay { return togglePlay; },
    get split(): typeof split { return split; },
    get freeze(): typeof freeze { return freeze; },
    get snapshot(): typeof snapshot { return snapshot; },
    get renderPreview(): typeof renderPreview { return renderPreview; },
    get engineRef(): typeof engineRef { return engineRef; },
    get setExporting(): typeof setExporting { return setExporting; },
    get dispatch(): typeof dispatch { return dispatch; },
    get clipboard(): typeof clipboard { return clipboard; },
    get playhead(): typeof playhead { return playhead; },
    get toggleFullScreen(): typeof toggleFullScreen { return toggleFullScreen; },
    get setShowingHelp(): typeof setShowingHelp { return setShowingHelp; },
    get updateLayout(): typeof updateLayout { return updateLayout; },
    get layout(): typeof layout { return layout; },
    get setLanguage(): typeof setLanguage { return setLanguage; },
    get setLeftTab(): typeof setLeftTab { return setLeftTab; },
    get setPanelOpen(): typeof setPanelOpen { return setPanelOpen; },
    get addTitle(): typeof addTitle { return addTitle; },
    get openGuide(): typeof openGuide { return openGuide; },
    get selectedLayer(): typeof selectedLayer { return selectedLayer; },
    get facts(): typeof facts { return facts; },
    get sourceLimit(): typeof sourceLimit { return sourceLimit; },
    get mediaById(): typeof mediaById { return mediaById; },
  }));
  const scopedUpdate = <T extends object>(id: string, changes: T, one: (t: Timeline) => Timeline, group?: string) => {
    if (!timeline) return;
    if (styleScope === 'layer' && sharedKeys(changes).length) {
      const shared = Object.fromEntries(Object.entries(changes).filter(([key]) => sharedKeys({ [key]: 0 }).length));
      const rest = Object.fromEntries(Object.entries(changes).filter(([key]) => !sharedKeys({ [key]: 0 }).length));
      void rest; // Timing, words and picture-bound settings belong to one item, never to a layer.
      const styled = setLayerStyle(timeline, id, shared);
      // "Layer wins": this change reaches items that set their own, too.
      change(layerWins && layerSettings ? overrideLayerItems(styled, layerSettings, Object.keys(shared)) : styled, group ? `layer-${group}` : undefined);
      return;
    }
    change(markOwn(one(timeline), id, changes), group);
  };
  // In a text layer's settings, karaoke goes on (or off) for every title on the layer, each timed to its own words.
  const setKaraoke = (colour: string | null) => { if (timeline && selectedText) change(setKaraokeFor(timeline, settingsLayer?.kind === 'text' ? settingsLayer.items.map((item) => item.id) : [selectedText.id, ...moreIds], colour)); };
  const { saveStyle, forgetStyle, addTitle, updateSelectedText, titleRect, decorateTitle, titleAt, finishShape } = createTitleEditingActions(() => ({
    get timeline(): typeof timeline { return timeline; },
    get selectedText(): typeof selectedText { return selectedText; },
    get moreIds(): typeof moreIds { return moreIds; },
    get styleScope(): typeof styleScope { return styleScope; },
    get change(): typeof change { return change; },
    get scopedUpdate(): typeof scopedUpdate { return scopedUpdate; },
    get myStyles(): typeof myStyles { return myStyles; },
    get setMyStyles(): typeof setMyStyles { return setMyStyles; },
    get engineRef(): typeof engineRef { return engineRef; },
    get setError(): typeof setError { return setError; },
    get timelineRef(): typeof timelineRef { return timelineRef; },
    get addEffect(): typeof addEffect { return addEffect; },
    get setSelectedId(): typeof setSelectedId { return setSelectedId; },
    get shaping(): typeof shaping { return shaping; },
    get setShaping(): typeof setShaping { return setShaping; },
    get now(): typeof now { return now; },
  }));
  const [myStyles, setMyStyles] = useState<Template[]>(savedStyles);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  // Each template's picture, drawn by the server like any title, small.
  useEffect(() => {
    if (leftTab === 'themes') {
      for (const look of THEMES) {
        const key = `theme-${look.id}`;
        if (thumbs[key]) continue;
        void fetchTextImage({ ...look.opener, enter: null, exit: null, id: 'thumb', start: 0, length: 1 }, THUMB_FORMAT).then((url) => setThumbs((current) => ({ ...current, [key]: url }))).catch(() => {});
      }
      return;
    }
    if (leftTab !== 'text') return;
    for (const template of [...TEMPLATES, ...myStyles]) {
      if (thumbs[template.id]) continue;
      void fetchTextImage({ ...template.look, id: 'thumb', start: 0, length: 1 }, THUMB_FORMAT).then((url) => setThumbs((current) => ({ ...current, [template.id]: url }))).catch(() => {});
    }
  }, [leftTab, myStyles, thumbs]);
  const libraryLoad = useRef<Promise<LibraryTrack[]> | null>(null);
  /** Reads the library once; later calls share the same answer. */
  const loadLibrary = useCallback(() => libraryLoad.current ?? (libraryLoad.current = getMusicLibrary()
    .then((found) => { setLibrary(found.tracks); setLibraryFolder(found.folder); return found.tracks; })
    .catch(() => { setLibrary([]); return [] as LibraryTrack[]; })), []);
  useEffect(() => { if (leftTab === 'themes' || leftTab === 'audio') void loadLibrary(); }, [leftTab, loadLibrary]);
  const { listen, librarySong, chooseTheme, makeStory, buildStoryVideo, changeThemeMusic, addLibraryTrack } = createThemeActions(() => ({
    get listenRef(): typeof listenRef { return listenRef; },
    get listening(): typeof listening { return listening; },
    get setListening(): typeof setListening { return setListening; },
    get timeline(): typeof timeline { return timeline; },
    get setError(): typeof setError { return setError; },
    get themeBusy(): typeof themeBusy { return themeBusy; },
    get projectName(): typeof projectName { return projectName; },
    get setThemeBusy(): typeof setThemeBusy { return setThemeBusy; },
    get mediaById(): typeof mediaById { return mediaById; },
    get aimFor(): typeof aimFor { return aimFor; },
    get newId(): typeof newId { return newId; },
    get themeWithMusic(): typeof themeWithMusic { return themeWithMusic; },
    get loadLibrary(): typeof loadLibrary { return loadLibrary; },
    get setThemeTrack(): typeof setThemeTrack { return setThemeTrack; },
    get change(): typeof change { return change; },
    get story(): typeof story { return story; },
    get facts(): typeof facts { return facts; },
    get timelineRef(): typeof timelineRef { return timelineRef; },
    get setMomentProgress(): typeof setMomentProgress { return setMomentProgress; },
    get setStory(): typeof setStory { return setStory; },
    get library(): typeof library { return library; },
    get themeTrack(): typeof themeTrack { return themeTrack; },
    get setAddingMusic(): typeof setAddingMusic { return setAddingMusic; },
    get engineRef(): typeof engineRef { return engineRef; },
    get MIN_MUSIC_SECONDS(): typeof MIN_MUSIC_SECONDS { return MIN_MUSIC_SECONDS; },
    get setSelectedId(): typeof setSelectedId { return setSelectedId; },
  }));
  useEffect(() => () => { listenRef.current?.pause(); }, []);
  const storyMedia = media.filter((item) => item.media_type === 'video' || item.media_type === 'image');
  const showEnter = (start: number, seconds: number) => engineRef.current?.playRange(start, start + seconds);
  const showExit = (end: number, seconds: number) => engineRef.current?.playRange(Math.max(0, end - seconds), Math.max(0, end - 0.02));
  const clipsInOrder = timeline ? [...mainLayer(timeline).items].sort((a, b) => a.start - b.start) : [];
  const clipIndex = selected ? clipsInOrder.findIndex((clip) => clip.id === selected.id) : -1;
  const { applyStems, separate, updateSelectedSound, hasSound, detach, addMusic, addSoundEffects, addThunder, loopSelectedSound, cutClipsToBeat } = createAudioToolActions(() => ({
    get timelineRef(): typeof timelineRef { return timelineRef; },
    get stemJob(): typeof stemJob { return stemJob; },
    get setStemJob(): typeof setStemJob { return setStemJob; },
    get change(): typeof change { return change; },
    get selectedSound(): typeof selectedSound { return selectedSound; },
    get setError(): typeof setError { return setError; },
    get timeline(): typeof timeline { return timeline; },
    get visuals(): typeof visuals { return visuals; },
    get selected(): typeof selected { return selected; },
    get mediaById(): typeof mediaById { return mediaById; },
    get setSelectedId(): typeof setSelectedId { return setSelectedId; },
    get setAddingMusic(): typeof setAddingMusic { return setAddingMusic; },
    get engineRef(): typeof engineRef { return engineRef; },
    get sfxBusy(): typeof sfxBusy { return sfxBusy; },
    get setSfxNote(): typeof setSfxNote { return setSfxNote; },
    get setSfxBusy(): typeof setSfxBusy { return setSfxBusy; },
    get sfxChoice(): typeof sfxChoice { return sfxChoice; },
    get thunderBusy(): typeof thunderBusy { return thunderBusy; },
    get setThunderBusy(): typeof setThunderBusy { return setThunderBusy; },
    get looping(): typeof looping { return looping; },
    get setLooping(): typeof setLooping { return setLooping; },
    get setBeatNote(): typeof setBeatNote { return setBeatNote; },
    get setBeatBusy(): typeof setBeatBusy { return setBeatBusy; },
    get facts(): typeof facts { return facts; },
  }));
  const hasAudibleAudio = Boolean(timeline?.layers.some((layer) => {
    if (layer.muted) return false;
    if (layer.kind === 'audio') return layer.items.some((sound) => !sound.muted && sound.volume > 0);
    if (layer.kind === 'video') return layer.items.some((clip) => !clip.muted && clip.volume > 0 && hasSound(clip.media_id));
    return false;
  }));
  const { snapshot, newBackground, updateSelected, clipEffectApplied, applyClipEffect, addMedia, addOverlayMedia, onDropPayload, aimFor, moveSelected, applyToSelected, chooseFormat, splitScreen } = createClipToolActions(() => ({
    get timeline(): typeof timeline { return timeline; },
    get selected(): typeof selected { return selected; },
    get moreIds(): typeof moreIds { return moreIds; },
    get styleScope(): typeof styleScope { return styleScope; },
    get change(): typeof change { return change; },
    get scopedUpdate(): typeof scopedUpdate { return scopedUpdate; },
    get updateLayout(): typeof updateLayout { return updateLayout; },
    get playhead(): typeof playhead { return playhead; },
    get setError(): typeof setError { return setError; },
    get setSelectedId(): typeof setSelectedId { return setSelectedId; },
    get engineRef(): typeof engineRef { return engineRef; },
    get mediaById(): typeof mediaById { return mediaById; },
    get myStyles(): typeof myStyles { return myStyles; },
    get addTitle(): typeof addTitle { return addTitle; },
    get library(): typeof library { return library; },
    get addLibraryTrack(): typeof addLibraryTrack { return addLibraryTrack; },
    get addEffect(): typeof addEffect { return addEffect; },
    get focusCache(): typeof focusCache { return focusCache; },
    get local(): typeof local { return local; },
    get setChoosingFormat(): typeof setChoosingFormat { return setChoosingFormat; },
    get sourceFor(): typeof sourceFor { return sourceFor; },
  }));
  const fps = timeline?.format.fps ?? 30;
  const sourceLimit = (mediaId: number) => { const item = mediaById.get(mediaId); return item?.media_type === 'video' ? item.duration ?? undefined : MAX_PHOTO_SECONDS; };
  const pauseEngine = () => engineRef.current?.pause();
  const seek = useCallback((t: number) => engineRef.current?.seek(t), []);
  // What the settings panels share (state/EditorContext). Null until the project has loaded.
  const editorShared = useMemo(() => ({ timeline, change, pause: () => engineRef.current?.pause(), openGuide: (article?: string) => { if (article) openGuide(article); else setShowingHelp(true); },
    now, seek, selectedId, select: (id: string | null) => { setMoreIds(new Set()); setSelectedId(id); },
    addMedia: (item: Photo) => setMedia((current) => (current.some((each) => each.id === item.id) ? current : [item, ...current])),
    drawBox: (onBox: (box: Box) => void) => { engineRef.current?.pause(); setDrawing({ mode: 'start', onBox }); } }), [timeline, change, openGuide, now, seek, selectedId]);
  const togglePlay = useCallback(() => { const engine = engineRef.current; if (!engine) return; if (engine.playing) engine.pause(); else engine.play(); }, []);
  const split = useCallback(() => {
    if (!timeline) return;
    if (selectedId && isLocked(timeline, selectedId)) return;
    const next = findSound(timeline, selectedId) ? splitSound(timeline, selectedId!, playhead.current, newId()) : splitClip(timeline, playhead.current, newId());
    if (next !== timeline) change(next);
  }, [timeline, selectedId, playhead, change]);
  const freeze = useCallback((t = playhead.current) => {
    if (!timeline || mainLayer(timeline).locked) return;
    const next = freezeFrame(timeline, t, [newId(), newId()], FREEZE_SECONDS);
    if (next === timeline) { setError('Put the playhead on a video clip in the main track to freeze a frame.'); return; }
    change(next);
  }, [timeline, playhead, change]);
  const mainClips = useMemo(() => (timeline ? mainLayer(timeline).items : []), [timeline]);
  const spokenIds = useMemo(() => [...new Set(mainClips.map((clip) => clip.media_id))].filter((id) => mediaById.get(id)?.media_type === 'video'), [mainClips, mediaById]);
  const missingWords = spokenIds.filter((id) => !transcripts[`${id}:${language}`]);
  const tokens = useMemo(() => buildTokens(mainClips, (id) => transcripts[`${id}:${language}`]), [mainClips, transcripts, language]);
  // Remove pauses reads its own tokens, so its shortest pause can differ from the transcript's.
  const tidyTokens = useMemo(() => buildTokens(mainClips, (id) => transcripts[`${id}:${language}`], pauseLength), [mainClips, transcripts, language, pauseLength]);
  const tidy = useMemo(() => tidyUp(tidyTokens, mainClips, removeFillers), [tidyTokens, mainClips, removeFillers]);
  useEffect(() => {
    let stopped = false;
    for (const id of spokenIds) {
      if (transcripts[`${id}:${language}`]) continue;
      void getWords(id, language).then(({ words }) => { if (words && !stopped) setTranscripts((current) => ({ ...current, [`${id}:${language}`]: words })); }).catch(() => {});
    }
    return () => { stopped = true; };
  }, [spokenIds.join(','), language]);
  useEffect(() => {
    if (!wordJob) return;
    const timer = setTimeout(async () => {
      try {
        const status = await getJobStatus(wordJob.id);
        if (status.status === 'failed' || status.status === 'cancelled') { if (status.status === 'failed') setError(status.error ?? 'This clip could not be transcribed.'); setWordJob(null); return; }
        if (status.status !== 'done') { setWordJob({ ...wordJob, progress: status.progress }); return; }
        const { words } = await getWords(wordJob.mediaId, language);
        setTranscripts((current) => ({ ...current, [`${wordJob.mediaId}:${language}`]: words ?? [] }));
        const [next, ...rest] = wordJob.left;
        if (next === undefined) { setWordJob(null); return; }
        const { job_id } = await startWords(next, language);
        setWordJob({ mediaId: next, id: job_id, progress: 0, left: rest });
      } catch (problem) { setError((problem as Error).message); setWordJob(null); }
    }, 800);
    return () => clearTimeout(timer);
  }, [wordJob, language]);
  const transcribeClips = async () => {
    const [first, ...rest] = missingWords;
    if (first === undefined) return;
    try { const { job_id } = await startWords(first, language); setWordJob({ mediaId: first, id: job_id, progress: 0, left: rest }); } catch (problem) { setError((problem as Error).message); }
  };
  const cutWords = useCallback((keys: Set<string>) => {
    if (!timeline || mainLayer(timeline).locked) return;
    const next = cutTokens(timeline, tokens, keys, newId);
    if (next !== timeline) change(next);
    setWordSelection(new Set());
  }, [timeline, tokens, change]);
  /** Captions from the main track's speech. Clips not transcribed yet are transcribed first, then the captions follow. */
  const makeCaptions = useCallback((words?: number) => {
    if (!timeline) return;
    if (missingWords.length) { setCaptionsWaiting(true); if (!wordJob) void transcribeClips(); return; }
    setCaptionsWaiting(false);
    const items = buildCaptions(mainClips, (id) => transcripts[`${id}:${language}`], newId, { ...DEFAULT_CAPTION_OPTIONS, words: words ?? captionWords });
    if (!items.length) { setError('No speech was found in the main track to caption.'); return; }
    change(setCaptions(timeline, items, newId()));
  }, [timeline, missingWords.length, wordJob, mainClips, transcripts, language, captionWords, change]);
  useEffect(() => { if (captionsWaiting && !wordJob && !missingWords.length) makeCaptions(); }, [captionsWaiting, wordJob, missingWords.length, makeCaptions]);
  /** Cuts every chosen pause and filler at once. Captions, if any, are made again from what's left, in the same Undo. */
  const removePauses = useCallback(() => {
    if (!timeline || mainLayer(timeline).locked || !tidy.keys.size) return;
    let next = cutTokens(timeline, tidyTokens, tidy.keys, newId);
    if (captionLayers(next).length) next = setCaptions(next, buildCaptions(mainLayer(next).items, (id) => transcripts[`${id}:${language}`], newId, { ...DEFAULT_CAPTION_OPTIONS, words: captionWords }), newId());
    change(next);
    setWordSelection(new Set());
  }, [timeline, tidy, tidyTokens, transcripts, language, captionWords, change]);
  const removeSelected = useCallback(() => {
    if (!timeline || !selectedId || isLocked(timeline, selectedId)) return;
    if (moreIds.size) {
      // Every picked item goes, in one step for undo.
      let next = timeline;
      for (const id of [selectedId, ...moreIds]) {
        if (isLocked(next, id)) continue;
        next = findSound(next, id) ? removeSound(next, id) : findText(next, id) ? removeText(next, id) : findBlur(next, id) ? removeBlur(next, id) : findCaption(next, id) ? removeCaption(next, id) : findClip(next, id) ? removeClip(next, id) : next;
      }
      change(next); setSelectedId(null); return;
    }
    change(findSound(timeline, selectedId) ? removeSound(timeline, selectedId) : findText(timeline, selectedId) ? removeText(timeline, selectedId) : findBlur(timeline, selectedId) ? removeBlur(timeline, selectedId) : findCaption(timeline, selectedId) ? removeCaption(timeline, selectedId) : removeClip(timeline, selectedId));
    setSelectedId(null);
  }, [timeline, selectedId, moreIds, change]);
  const clipboard = useClipboard({ timeline, selectedId, moreIds, change, removeSelected, newId, note: setNote, fail: setError,
    select: (ids) => { setSelectedId(ids[0] ?? null); setMoreIds(new Set(ids.slice(1))); } });
  /** Where faces are in each picture (0 to 1), found once per picture and moment. Null: none, or the face finder isn't on this Mac yet. */
  const focusCache = useRef(new Map<string, Focus | null>());
  const [effects, setEffects] = useState<EffectInfo[]>([]);
  const [effectBusy, setEffectBusy] = useState<{ id: string; progress: number } | null>(null);
  const [effectSection, setEffectSection] = useState<string | null>('clip-Film');
  const [effectSearch, setEffectSearch] = useState('');
  const [weather, setWeather] = useState({ rainDensity: 1, rainSpeed: 1, rainDirection: 'left' as 'left' | 'straight' | 'right', frequency: 3, brightness: 0.8,
    fogDensity: 0.65, fogSpeed: 0.55, fogDirection: 'right' as 'left' | 'straight' | 'right', snowDensity: 0.8, snowSpeed: 0.8, snowDirection: 'right' as 'left' | 'straight' | 'right', seed: 0 });
  useEffect(() => { if (leftTab === 'effects' && !effects.length) listEffects().then(setEffects).catch((problem) => setError((problem as Error).message)); }, [leftTab, effects.length]);
  const [momentProgress, setMomentProgress] = useState<number | null>(null);
  const [clearNote, setClearNote] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [soundEffects, setSoundEffects] = useState<SoundEffectInfo[] | null>(null);
  const [sfxChoice, setSfxChoice] = useState<{ whoosh: string; hit: string }>({ whoosh: 'kanaa-whoosh', hit: 'kanaa-hit' });
  const [sfxBusy, setSfxBusy] = useState<'whoosh' | 'hit' | null>(null);
  const [sfxNote, setSfxNote] = useState<string | null>(null);
  useEffect(() => { if (leftTab === 'audio' && soundEffects === null) listSoundEffects().then((found) => setSoundEffects(found.effects)).catch(() => setSoundEffects([])); }, [leftTab, soundEffects]);
  const [thunderBusy, setThunderBusy] = useState(false);
  const [looping, setLooping] = useState(false);
  const [beatBusy, setBeatBusy] = useState(false);
  const [beatNote, setBeatNote] = useState<string | null>(null);
  /** "Same as my clip": the first clip on the main track, not the project's starting file (a blank project has none). */
  const firstClip = timeline ? [...mainLayer(timeline).items].sort((a, b) => a.start - b.start)[0] : undefined;
  const firstMedia = firstClip ? mediaById.get(firstClip.media_id) : undefined;
  const firstClipFormat: Format | null = firstMedia?.width && firstMedia.height ? { width: firstMedia.width - firstMedia.width % 2, height: firstMedia.height - firstMedia.height % 2, fps: 30 } : null;

  // What Alt+arrows nudge: set below, once the selection's transform is known.
  const movingRef = useRef<{ transform: Clip['transform']; update: (transform: Clip['transform'], group?: string) => void } | null>(null);
  useEditorShortcuts(() => ({ setPalette, setShowingHelp, fullScreen, toggleFullScreen, pickingKey, stopPicking, drawing, setDrawing, shaping, setShaping, finishShape, timeline, exporting, choosingFormat, showingHelp, menu, engineRef, playhead, dispatch, selectedId, setMoreIds, clipboard, togglePlay, fastRate, seek, movingRef, split, setSnapping, change, facts, wordSelection, cutWords, removeSelected, setWordSelection, setSelectedId, selectedText }), [toggleFullScreen, fullScreen, timeline, exporting, choosingFormat, showingHelp, menu, pickingKey, drawing, shaping, stopPicking, wordSelection, cutWords, togglePlay, split, removeSelected, seek, change, playhead, facts, selectedId, selectedText, clipboard]);

  const dragPreview = useRef<{ x: number; y: number; clipX: number; clipY: number; group: string } | null>(null);
  const moving = selected ? { transform: selected.transform, local, update: (transform: Clip['transform'], group?: string) => updateSelected({ transform }, group) }
    : selectedBlur ? { transform: selectedBlur.transform, local: blurLocal, update: (transform: Clip['transform'], group?: string) => updateSelectedBlur({ transform }, group) }
    : selectedText ? { transform: selectedText.transform ?? REST_TRANSFORM, local: textLocal, update: (transform: Clip['transform'], group?: string) => updateSelectedText({ transform }, group) } : null;
  movingRef.current = moving;
  const startPicking = () => { if (selected) { engineRef.current?.pause(); engineRef.current?.showUnkeyed(selected.id); setPickingKey(true); } };
  // Titles in the preview: where each visible title's letters sit in the frame (shares), for picking and editing it there.
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  // The title picked by clicking it in the preview: only then does the preview show its box and toolbar.
  const [pickedInPreview, setPickedInPreview] = useState<string | null>(null);
  const { previewDown, previewMove, startDrawing, frameAt, drawnBox, startFollowing, ownBox, followHere, finishDrawing, applyFaces, applyFollow } = createPreviewTrackingActions(() => ({
    get placing(): typeof placing { return placing; },
    get timeline(): typeof timeline { return timeline; },
    get placeInScene(): typeof placeInScene { return placeInScene; },
    get pickingKey(): typeof pickingKey { return pickingKey; },
    get selected(): typeof selected { return selected; },
    get engineRef(): typeof engineRef { return engineRef; },
    get updateSelected(): typeof updateSelected { return updateSelected; },
    get stopPicking(): typeof stopPicking { return stopPicking; },
    get drawing(): typeof drawing { return drawing; },
    get shaping(): typeof shaping { return shaping; },
    get titleAt(): typeof titleAt { return titleAt; },
    get setPickedInPreview(): typeof setPickedInPreview { return setPickedInPreview; },
    get selectedId(): typeof selectedId { return selectedId; },
    get setLayerSettings(): typeof setLayerSettings { return setLayerSettings; },
    get setSelectedId(): typeof setSelectedId { return setSelectedId; },
    get moving(): typeof moving { return moving; },
    get selectedLayer(): typeof selectedLayer { return selectedLayer; },
    get dragPreview(): typeof dragPreview { return dragPreview; },
    get followTarget(): typeof followTarget { return followTarget; },
    get playhead(): typeof playhead { return playhead; },
    get setError(): typeof setError { return setError; },
    get isVideo(): typeof isVideo { return isVideo; },
    get setFollowNote(): typeof setFollowNote { return setFollowNote; },
    get setDrawing(): typeof setDrawing { return setDrawing; },
    get sourceFor(): typeof sourceFor { return sourceFor; },
    get setFollowJob(): typeof setFollowJob { return setFollowJob; },
    get followSize(): typeof followSize { return followSize; },
    get selectedBlur(): typeof selectedBlur { return selectedBlur; },
    get blurLocal(): typeof blurLocal { return blurLocal; },
    get local(): typeof local { return local; },
    get seek(): typeof seek { return seek; },
    get updateSelectedBlur(): typeof updateSelectedBlur { return updateSelectedBlur; },
    get drawStart(): typeof drawStart { return drawStart; },
    get timelineRef(): typeof timelineRef { return timelineRef; },
    get change(): typeof change { return change; },
  }));
  // Zoom by hand: a trackpad pinch (or ⌘-scroll) over the preview resizes the selected picture or video.
  const wheelRef = useRef<(event: WheelEvent) => void>(() => {});
  wheelRef.current = (event: WheelEvent) => {
    if (!(event.ctrlKey || event.metaKey) || !moving || selectedLayer?.locked || selected?.enabled === false || selected?.frame_locked) return;
    event.preventDefault();  // A pinch would otherwise zoom the whole window.
    moving.update(zoomBy(moving.transform, moving.local, wheelFactor(event.deltaY, event.ctrlKey)), `zoom-${selectedId}`);
  };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const listen = (event: WheelEvent) => wheelRef.current(event);
    canvas.addEventListener('wheel', listen, { passive: false });  // Passive listeners can't stop the page zooming.
    return () => canvas.removeEventListener('wheel', listen);
  }, [timeline !== null]);

  // Follow movement: the item's position (and size) become keys from a box tracked in the video under it.
  const followTarget = selected && selectedLayer && timeline && selectedLayer !== mainLayer(timeline) ? { id: selected.id, start: selected.start, length: clipLength(selected), transform: selected.transform }
    : selectedBlur ? { id: selectedBlur.id, start: selectedBlur.start, length: selectedBlur.length, transform: selectedBlur.transform }
    : selectedText ? { id: selectedText.id, start: selectedText.start, length: selectedText.length, transform: selectedText.transform ?? REST_TRANSFORM } : null;
  const isVideo = useCallback((id: number) => mediaById.get(id)?.media_type === 'video', [mediaById]);
  useReframeJob(() => ({ reframeJob, setError, setReframeJob, timelineRef, mediaById, setFaceNote, change, setSelectedId }), [reframeJob, change, mediaById]);
  useSceneJob(() => ({ sceneJob, setError, setSceneJob, timelineRef, change, setFaceNote }), [sceneJob, change]);
  useFaceJob(() => ({ faceJob, setError, setFaceJob, timelineRef, sourceFor, setFaceNote, change, setSelectedId }), undefined);
  useFollowJob(() => ({ followJob, setError, setFollowJob, applyFaces, applyFollow }), undefined);
  const { generalItems, openGeneralMenu, openViewMenu, openPreviewMenu, openMediaMenu, openItemMenu } = createEditorMenuActions(() => ({
    get history(): typeof history { return history; },
    get dispatch(): typeof dispatch { return dispatch; },
    get setMenu(): typeof setMenu { return setMenu; },
    get safeArea(): typeof safeArea { return safeArea; },
    get setSafeArea(): typeof setSafeArea { return setSafeArea; },
    get total(): typeof total { return total; },
    get renderJob(): typeof renderJob { return renderJob; },
    get isRendered(): typeof isRendered { return isRendered; },
    get renderPreview(): typeof renderPreview { return renderPreview; },
    get setShowingHelp(): typeof setShowingHelp { return setShowingHelp; },
    get resetLayout(): typeof resetLayout { return resetLayout; },
    get playing(): typeof playing { return playing; },
    get togglePlay(): typeof togglePlay { return togglePlay; },
    get addBlurBox(): typeof addBlurBox { return addBlurBox; },
    get faceJob(): typeof faceJob { return faceJob; },
    get blurFaces(): typeof blurFaces { return blurFaces; },
    get followTarget(): typeof followTarget { return followTarget; },
    get ownBox(): typeof ownBox { return ownBox; },
    get followJob(): typeof followJob { return followJob; },
    get selectedBlur(): typeof selectedBlur { return selectedBlur; },
    get followHere(): typeof followHere { return followHere; },
    get addMedia(): typeof addMedia { return addMedia; },
    get addOverlayMedia(): typeof addOverlayMedia { return addOverlayMedia; },
    get setFiling(): typeof setFiling { return setFiling; },
    get usedIds(): typeof usedIds { return usedIds; },
    get timeline(): typeof timeline { return timeline; },
    get change(): typeof change { return change; },
    get setSelectedId(): typeof setSelectedId { return setSelectedId; },
    get setDeleting(): typeof setDeleting { return setDeleting; },
    get seek(): typeof seek { return seek; },
    get clipboard(): typeof clipboard { return clipboard; },
    get fitZoom(): typeof fitZoom { return fitZoom; },
    get mediaById(): typeof mediaById { return mediaById; },
    get setRenamingClip(): typeof setRenamingClip { return setRenamingClip; },
    get isVideo(): typeof isVideo { return isVideo; },
    get reframeJob(): typeof reframeJob { return reframeJob; },
    get reframeClip(): typeof reframeClip { return reframeClip; },
    get sceneJob(): typeof sceneJob { return sceneJob; },
    get splitScenes(): typeof splitScenes { return splitScenes; },
    get freeze(): typeof freeze { return freeze; },
    get snapshot(): typeof snapshot { return snapshot; },
    get hasSound(): typeof hasSound { return hasSound; },
    get detach(): typeof detach { return detach; },
    get timelineRef(): typeof timelineRef { return timelineRef; },
  }));
  const total = timeline ? duration(timeline) : 0;
  const fitZoom = useCallback(() => {
    const width = rootRef.current?.querySelector('.tl-scroll')?.clientWidth;
    if (width && total) setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (width - FIT_MARGIN) / total)));
  }, [total]);
  useEffect(() => { if (total && !fitted.current) { fitted.current = true; fitZoom(); } }, [total, fitZoom]);
  const usedIds = useMemo(() => new Set(timeline ? timeline.layers.flatMap((layer) => (layer.kind === 'text' ? [] : (layer.items as { media_id?: number }[]).flatMap((item) => item.media_id ?? []))) : []), [timeline]);
  const folders = folderNames(media);
  const shownMedia = media.filter((item) => !item.filename.startsWith('Blank canvas') && (!folder || item.folder === folder));
  const inVideo = shownMedia.filter((item) => usedIds.has(item.id));
  const otherMedia = shownMedia.filter((item) => !usedIds.has(item.id));
  const inspectorOpen = layout.inspectorOpen;
  const shellStyle = { '--media-col': panelOpen ? `${layout.media}px` : '44px', '--media-gap': '6px', '--inspector-col': inspectorOpen ? `${layout.inspector}px` : '44px', '--inspector-gap': '6px', '--timeline-h': `${Math.min(layout.timeline, Math.round(window.innerHeight * 0.55))}px` } as React.CSSProperties;
  const ratio = timeline ? timeline.format.width / timeline.format.height : 16 / 9;
  const isEmpty = timeline && !mainLayer(timeline).items.length;
  // ---- Ask AI ----
  useEffect(() => { if (leftTab === 'ask' && !effects.length) listEffects().then(setEffects).catch(() => { /* Effects just won't be offered. */ }); }, [leftTab, effects.length]);
  const askOptions: Options = {
    themes: THEMES.map((theme) => ({ id: theme.id, label: theme.label })), looks: LOOK_NAMES.map((look) => ({ id: look.id, label: look.label })),
    transitions: TRANSITIONS.map((item) => ({ id: item.id, label: item.label })), effects: effects.map((effect) => ({ id: effect.id, label: effect.label })),
    formats: FORMATS.map((format) => ({ id: format.id, label: `${format.label} (${format.ratio})` })), stories: STORIES.map((item) => ({ id: item.id, label: item.label })),
    title_styles: TEMPLATES.map((template) => ({ id: template.id, label: template.label })),
  };
  const { askProject, runAsk } = createAskActions(() => ({
    get timelineRef(): typeof timelineRef { return timelineRef; },
    get mediaById(): typeof mediaById { return mediaById; },
    get media(): typeof media { return media; },
    get usedIds(): typeof usedIds { return usedIds; },
    get actions(): typeof actions { return actions; },
    get askOptions(): typeof askOptions { return askOptions; },
    get setCaptionWords(): typeof setCaptionWords { return setCaptionWords; },
  }));
  const actions = useRef({ chooseTheme, addTitle, addEffect, cutClipsToBeat, makeCaptions, keepClearOfFaces, buildStoryVideo, storyMedia, facts, change });
  actions.current = { chooseTheme, addTitle, addEffect, cutClipsToBeat, makeCaptions, keepClearOfFaces, buildStoryVideo, storyMedia, facts, change };
const followPanel = followTarget && <InspectorBindingsProvider name="follow" bindings={{ blur: Boolean(selectedBlur), own: Boolean(selectedBlur || (selected && selectedLayer && timeline && selectedLayer !== mainLayer(timeline))), onDraw: () => startDrawing('start'), drawing: Boolean(drawing), job: followJob?.itemId === followTarget.id ? followJob : null, busy: Boolean(followJob), note: followNote?.itemId === followTarget.id ? followNote.text : null, following: Boolean(followTarget.transform.keyframes?.x?.length), size: followSize, onSize: setFollowSize, onStart: () => { void followHere('start'); }, onContinue: () => { void followHere('continue'); }, onCancel: () => { if (followJob) void cancelRenderJob(followJob.jobId); setFollowJob(null); }, onStop: () => { if (selected) updateSelected({ transform: unfollow(selected.transform, local) }); else if (selectedBlur) updateSelectedBlur({ transform: unfollow(selectedBlur.transform, blurLocal) }); else if (selectedText) updateSelectedText({ transform: unfollow(selectedText.transform ?? REST_TRANSFORM, textLocal) }); setFollowNote(null); } } satisfies FollowPanelBindings}><FollowPanel/></InspectorBindingsProvider>;
  const effectNeedle = effectSearch.trim().toLocaleLowerCase();
  const matchingClipEffects = CLIP_EFFECT_PRESETS.filter((preset) => !effectNeedle || `${preset.label} ${preset.group} ${preset.about}`.toLocaleLowerCase().includes(effectNeedle));
  const matchingOverlayEffects = effects.filter((effect) => !effectNeedle || `${effect.label} ${effect.tamil} ${effect.mood} ${effect.about}`.toLocaleLowerCase().includes(effectNeedle));
  const activeClipEffects = selected ? clipEffects(selected) : [];
  return <EditorContext.Provider value={{ ...editorShared, panels: { left: ({ saved, closeEditor, projectName, layout, LEFT_TABS, LITE_TABS, panelOpen, leftTab, RAIL_BREAK_BEFORE, LEFT_TAB_LABELS, TAB_TIPS, setPanelOpen, setLeftTab, TAB_ICONS, updateLayout, timeline, setCreatingAIImage, setMedia, folders, media, folder, setFolder, inVideo, otherMedia, draggableAs, addMedia, openMediaMenu, usedIds, addOverlayMedia, tokens, mainClips, language, setLanguage, setWordSelection, missingWords, wordJob, transcribeClips, seek, cutWords, playhead, wordSelection, tidy, pauseLength, setPauseLength, removeFillers, setRemoveFillers, removePauses, setMenu, story, setStory, mediaById, storyMedia, facts, themeBusy, momentProgress, makeStory, chooseTheme, thumbs, themeWithMusic, setThemeWithMusic, library, changeThemeMusic, change, transitionPick, setTransitionPick, applyToSelected, setConfirmingClear, askOptions, askProject, runAsk, effectSearch, setEffectSearch, selected, activeClipEffects, matchingClipEffects, effectNeedle, effectSection, setEffectSection, clipEffectApplied, applyClipEffect, timelineRef, newId, engineRef, setSelectedId, matchingOverlayEffects, weather, setWeather, effectBusy, total, addEffect, thunderBusy, addThunder, effects, addBlurBox, faceJob, setFaceJob, blurFaces, faceNote, addTitle, myStyles, forgetStyle, captionsWaiting, makeCaptions, captionWords, setCaptionWords, clearing, keepClearOfFaces, clearNote, libraryFolder, musicSearch, musicMood, setMusicSearch, MOODS, setMusicMood, MOOD_LABELS, listening, listen, addingMusic, addLibraryTrack, addMusic, soundEffects, sfxChoice, setSfxChoice, sfxBusy, addSoundEffects, sfxNote, beatBusy, cutClipsToBeat, beatNote } satisfies EditorLeftRailBindings), preview: ({ fullScreen, stageRef, saved, projectName, timeline, firstRunClosed, total, setLeftTab, setPanelOpen, exportedOnce, engineRef, setExporting, setFirstRunClosed, openGuide, ratio, canvasRef, openPreviewMenu, previewDown, previewMove, dragPreview, titleAt, setPickedInPreview, setSelectedId, setEditingTitle, placing, pickingKey, selected, selectedLayer, shaping, drawing, now, sourceFor, local, updateSelected, seek, selectedText, updateSelectedText, pickedInPreview, titleRect, editingTitle, selectedBlur, updateSelectedBlur, followTarget, followJob, ownBox, followHere, renderJob, reframeJob, sceneJob, faceJob, faceNote, followNote, setRenderJob, setHeavy, setReframeJob, setSceneJob, setFaceJob, setFollowJob, setFaceNote, setFollowNote, setShaping, finishShape, frameAt, drawStart, setDrawing, finishDrawing, drawnBox, safeArea, isEmpty, choosingFormat, clockRef, togglePlay, playing, toggleFullScreen } satisfies EditorPreviewStageBindings), toolbar: ({ dispatch, history, clipboard, selectedId, split, total, freeze, timeline, snapshot, removeSelected, selected, selectedSound, selectedText, selectedBlur, selectedCaption, selectedLayer, fitZoom, snapping, setSnapping, setZoom, zoom, openViewMenu } satisfies EditorTimelineToolbarBindings), inspector: ({ layerSettings, inspectorOpen, selectedIdentity, selected, settingsLayer, mediaById, change, timeline, moreIds, mixedSettings, setMoreIds, selectedLayer, selectedText, scopeBar, selectedCaption, textTiming, setSelectedId, selectedBlur, blurLocal, updateSelectedBlur, seek, pauseEngine, followPanel, setKaraoke, decorateTitle, effectBusy, saveStyle, engineRef, setShaping, shaping, showEnter, setKeepClearNote, clipUnderTitle, setNote, setMedia, setError, placing, setPlacing, placeInScene, pinProgress, pinTitle, stayProgress, stayNote, stayWithPeople, setStayNote, clearProgress, keepClearNote, keepTitleClear, updateSelectedText, showExit, selectedSound, loopSelectedSound, looping, soundTiming, updateSelectedSound, stems, stemJob, separate, reframeClip, reframeJob, moveSelected, media, newBackground, sourceFor, updateSelected, hasSound, detach, preparedReady, splitScreen, pickingKey, startPicking, clipTiming, clipsInOrder, clipIndex, introProgress, addBrandIntro, firstClipFormat, setLeftTab, setPanelOpen } satisfies EditorInspectorRailBindings) } }}><SimpleContext.Provider value={layout.simple}><div className={`ed ${layout.simple ? 'ed-simple' : ''} `} ref={rootRef} data-ed-theme={theme} style={shellStyle} onClick={releaseClickedButton} onContextMenu={openGeneralMenu} role="application" aria-label="Video editor">
    {error && <ErrorBanner message={error} onDismiss={() => setError('')}/>}
    {heavy && !isRendered && <div className="ed-heavy" role="status"><span>This project is too heavy to play smoothly here. Your export isn't affected.</span><button className="ed-button" disabled={Boolean(renderJob)} onClick={() => { void renderPreview(); }}>Render smooth preview</button><button className="ed-icon small" aria-label="Dismiss" onClick={() => setHeavy(false)}><X size={14}/></button></div>}
    {note && <div className="ed-note" role="status">{note}<button className="ed-icon small" aria-label="Dismiss" onClick={() => setNote('')}><X size={13}/></button></div>}
    {isRendered && <div className="ed-note" role="status">Playing a rendered preview. Any edit returns to the live preview.</div>}
    <div className="ed-workspace"><div className="ed-body">
      <EditorLeftRail/>
      {panelOpen ? <Splitter label="Resize media panel" axis="x" value={layout.media} min={LIMITS.media[0]} max={LIMITS.media[1]} sign={1} onChange={(media) => updateLayout({ media })} onReset={() => updateLayout({ media: DEFAULT_LAYOUT.media })}/> : <div className="ed-rail"/>}
      <EditorPreviewStage/>
      {inspectorOpen ? <Splitter label="Resize settings panel" axis="x" value={layout.inspector} min={LIMITS.inspector[0]} max={LIMITS.inspector[1]} sign={-1} onChange={(inspector) => updateLayout({ inspector })} onReset={() => updateLayout({ inspector: DEFAULT_LAYOUT.inspector })}/> : <div className="ed-rail"/>}
      <HelpContext.Provider value={openGuide}>
      <RailContext.Provider value={{ folded: !inspectorOpen, setOpen: (open) => updateLayout({ inspectorOpen: open }), tools: <div className="ed-rail-tools" role="group" aria-label="Edit and export">
            <JobTray/>
            <button onClick={() => setShowingHelp(true)} aria-label={t('Guide and shortcuts')} data-tip={`${t('Guide and shortcuts')} (?)`}><CircleHelp size={17}/></button>
            <TopSettings appearance={themeChoice} onAppearance={(choice) => { if (setTheme) setTheme(choice); else nextTheme(); }} simple={layout.simple} onSimple={(simple) => updateLayout({ simple })}
              format={timeline ? `${timeline.format.width} × ${timeline.format.height} · ${timeline.format.fps} fps` : 'Format'} onProject={() => { setSelectedId(null); updateLayout({ inspectorOpen: true }); }}/>
            <button className="ed-rail-export" disabled={!total} onClick={() => { engineRef.current?.pause(); setExporting(true); try { localStorage.setItem('kanaa-exported-once', '1'); } catch { /* ignore */ } setExportedOnce(true); }} aria-label={t('Export')} data-tip={t('Export')}><Download size={17}/></button>
          </div> }}>
      <EditorInspectorRail/>
      </RailContext.Provider>
      </HelpContext.Provider>
    </div>
    <Splitter label="Resize timeline" axis="y" value={Math.min(layout.timeline, Math.round(window.innerHeight * 0.55))} min={LIMITS.timeline[0]} max={Math.round(window.innerHeight * 0.55)} sign={-1} onChange={(height) => updateLayout({ timeline: height })} onReset={() => updateLayout({ timeline: DEFAULT_LAYOUT.timeline })}/>
    <div className="ed-lower"><EditorTimelineToolbar/>
    {timeline && <TimelineView timeline={timeline} selectedId={layerSettings ? null : selectedId} zoom={zoom} theme={theme} onItemMenu={openItemMenu} playhead={playhead} source={facts} visuals={(id) => visuals.current.get(id) ?? {}} soundPeaks={soundPeaks} snapping={snapping} onSelectMany={(ids) => { setLayerSettings(null); setPickedInPreview(null); setEditingTitle(null); if (!ids.length) { setSelectedId(null); return; } setSelectedId(ids[0]); setMoreIds(new Set(ids.slice(1))); }} onSelect={(id, how) => { setLayerSettings(null); setPickedInPreview(null); setEditingTitle(null); pick(id, how); }} selectedIds={moreIds} onLayerSettings={openLayerSettings} layerSettingsId={layerSettings} onSeek={seek} onChange={change} onScrubStart={() => engineRef.current?.pause()} onDropPayload={onDropPayload}
      onSplitAt={(id, t) => { if (!timeline || isLocked(timeline, id)) return; const sound = findSound(timeline, id); const layer = layerOf(timeline, id); const next = sound ? splitSound(timeline, id, t, newId()) : layer === mainLayer(timeline) ? splitClip(timeline, t, newId()) : splitSound(timeline, id, t, newId()); if (next !== timeline) { change(next); seek(t); } }}
      fileName={(clip) => mediaById.get(clip.media_id)?.filename ?? `Media ${clip.media_id}`} renaming={renamingClip}
      onRenamed={(id, name) => { setRenamingClip(null); const clip = timeline && findClip(timeline, id); if (clip && (clip.name ?? null) !== name) change(updateClip(timeline!, id, { name })); }}
      onZoom={(factor) => setZoom((value) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value * factor)))}
      onCut={(clipId, anchor) => setCutOpen((open) => open?.clipId === clipId ? null : { clipId, anchor })} openCut={cutOpen?.clipId ?? null}/>}
    {cutOpen && timeline && (() => {
      const items = mainLayer(timeline).items; const index = items.findIndex((clip) => clip.id === cutOpen.clipId);
      if (index < 1) return null;
      const before = items[index - 1]; const after = items[index]; const transition = after.transition_in ?? null;
      const picture = (clip: Clip, at: number) => {
        const strip = visuals.current.get(clip.media_id)?.filmstrip; const span = (facts(clip.media_id)?.duration ?? clip.out) || 1;
        return strip?.image.src ? { image: strip.image.src, tiles: strip.tiles, tile: Math.min(strip.tiles - 1, Math.max(0, Math.floor(((clip.freeze ?? at) / span) * strip.tiles))) } : null;
      };
      const set = (next: Transition | null, group?: string) => change(updateClip(timeline, after.id, { transition_in: next }), group);
      const longest = Math.min(2, clipLength(before), clipLength(after));
      return <TransitionPopover key={after.id} transition={transition} anchor={cutOpen.anchor} longest={longest} locked={Boolean(mainLayer(timeline).locked)}
        before={picture(before, before.reverse ? before.in : before.out - 0.05)} after={picture(after, after.reverse ? after.out - 0.05 : after.in)}
        onPick={(kind) => { setTransitionPick(kind); set({ kind, duration: transition?.duration ?? Math.min(0.6, longest), direction: transition?.direction ?? null }); }}
        onLength={(duration, group) => transition && set({ ...transition, duration: Math.min(duration, longest) }, group ?? 'transition-length')}
        onDirection={(direction) => transition && set({ ...transition, direction: direction === 'left' ? null : direction })} onColour={(color) => transition && set({ ...transition, color })}
        onRemove={() => { set(null); setCutOpen(null); }}
        onEveryCut={() => transition && change(transitionEverywhere(timeline, transition.kind, transition.duration), 'transition-all')}
        onPreview={() => { const half = (transition?.duration ?? 0) / 2; engineRef.current?.playRange(Math.max(0, after.start - half - 0.8), after.start + half + 0.8); }}
        onGestureStart={pauseEngine} onClose={() => setCutOpen(null)}/>;
    })()}
    </div></div>
    {confirmingClear && timeline && (() => { const count = mainLayer(timeline).items.filter((clip) => clip.transition_in).length; return <div className="ed-modal" role="dialog" aria-modal="true" aria-label="Remove all transitions"><div className="ed-card small">
      <h2 className="ed-confirm-title"><TriangleAlert size={18}/>Remove all transitions?</h2>
      <p className="ed-tip">{count === 1 ? 'One transition comes' : `${count} transitions come`} off the main track, and each cut becomes a plain jump. One Undo brings them all back.</p>
      <div className="ed-pair">
        <button className="ed-button" onClick={() => setConfirmingClear(false)}>Keep them</button>
        <button className="ed-button ed-danger" autoFocus onClick={() => { change(clearTransitions(timeline), 'transition-all'); setConfirmingClear(false); }}><Trash2 size={14}/>Remove all</button>
      </div>
    </div></div>; })()}
    {menu && <ContextMenu menu={menu} onClose={closeMenu}/>}
    {filing && <FolderDialog item={filing} folders={folders} onClose={() => setFiling(null)} onSaved={(saved) => setMedia((current) => current.map((item) => (item.id === filing.id ? { ...item, folder: saved } : item)))}/>}
    {deleting && <DeleteMediaDialog item={deleting} onClose={() => setDeleting(null)} onDeleted={() => setMedia((current) => current.filter((item) => item.id !== deleting.id))}/>}
    {palette && createPortal(<div data-ed-theme={theme}><CommandPalette commands={paletteCommands()} onClose={() => setPalette(false)} onSettings={findSetting}/></div>, rootRef.current ?? document.body)}
    {showingHelp && createPortal(<div className="ed-guide-layer" data-ed-theme={theme}><Guide article={guideArticle} shortcuts={SHORTCUTS} onClose={() => setShowingHelp(false)} onResetLayout={resetLayout}/></div>, rootRef.current ?? document.body)}
    {choosingFormat && timeline && <FormatDialog clipFormat={firstClipFormat} current={timeline.format} onChoose={chooseFormat}/>}
    {exporting && timeline && <ExportDialog timeline={timeline} projectId={projectId} withSound={hasAudibleAudio} onNormalize={(normalize_audio) => change({ ...timeline, normalize_audio })} onClose={() => setExporting(false)} onOpen={onOpenOutput}/>}
    {creatingAIImage && timeline && <AIImageGenerator
      projectId={projectId}
      canvas={timeline.format.width === timeline.format.height ? 'square' : timeline.format.width > timeline.format.height ? 'landscape' : 'portrait'}
      onClose={() => setCreatingAIImage(false)}
      onCreated={(item) => { setMedia((current) => current.some((entry) => entry.id === item.id) ? current : [item, ...current]); setLeftTab('media'); }}/>
    }
  </div></SimpleContext.Provider></EditorContext.Provider>;
}
