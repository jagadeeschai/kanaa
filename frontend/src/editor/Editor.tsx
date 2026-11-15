import { useEditorShortcuts } from './hooks/useEditorShortcuts';
import { LEFT_TABS, RAIL_BREAK_BEFORE, LITE_TABS, LEFT_TAB_LABELS, TAB_ICONS, TAB_TIPS, QUALITIES, ESTIMATED_MB_PER_SECOND_1080, hardwareMbps, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, FAST_RATES, MIN_MUSIC_SECONDS, PREVIEW_SHORT_SIDE, RENDERED_ID, CLIP_EFFECT_PRESETS, FIT_MARGIN, TEXT_SECONDS, TEXT_TYPE_DELAY_MS, CAPTION_FETCHES, STYLE_NAMES, BRAND_FOLDER, isBrandImage, FREEZE_SECONDS, THUMB_FORMAT, SHAPE_FEATHER, voiceKey, preparedWant, preparedKey, MOODS, MOOD_LABELS, ON_ITEM, MIN_DRAWN_BOX, newId, isTyping, buttonTakesSpace, releaseClickedButton, draggableAs, RESTART_MESSAGE, SHORTCUTS } from './editor-constants';
import { createThemeActions } from './actions/themes-and-stories';
import { EditorLeftRail } from './panels/EditorLeftRail';
import { createTitleSceneActions } from './actions/title-scene';
import { BlurInspector } from './inspectors/BlurInspector';
import { CaptionInspector } from './inspectors/CaptionInspector';
import { FollowPanel } from './preview/FollowPanel';
import { SoundInspector } from './inspectors/SoundInspector';
import { TopSettings } from './TopSettings';
import { FormatDialog } from './dialogs/FormatDialog';
import { ExportDialog } from './dialogs/ExportDialog';
import { createPortal } from 'react-dom';
import { ProjectInspector } from './inspectors/ProjectInspector';
import { Inspector } from './inspectors/ClipInspector';
import { CORNERS, LOOK_NAMES, SoundControls } from './inspectors/clip-parts';
import { TextInspector } from './inspectors/TextInspector';
import { ASSET_POLL_MS, AnimationPicker, Chips, useFoundInClip } from './inspectors/parts';
import TravelMapPanel from './TravelMapPanel';
import { LANGUAGE, setLanguage, t } from '../i18n';
import LyricSyncFix from '../components/LyricSyncFix';
import { loopSound, needsLoop } from '../timeline/loop';
import { placeEffects, removeEffects, titleTimes, transitionTimes } from '../timeline/sfx';
import AskPanel from './AskPanel';
import { applyPure, describeCommand, translateCaptions, type Options, type Proposed } from '../timeline/commands';
import { keepCaptionsClear, type FacePath } from '../timeline/clear-faces';
import { canReframe, reframeTransform, type SubjectPoint } from '../timeline/reframe';
import { splitAtCuts } from '../timeline/scenes';
import { beatSound, cutToBeats, timelineBeats } from '../timeline/beats';
import { placeEffect, applyClipDrop, clipEffectChanges, dropClip, encodePayload, setActiveDrag, DRAG_TYPE, EFFECT_LAYER, type DragPayload, type DropTarget } from '../timeline/drop';
import { Fragment, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { BadgeCheck, Camera, Magnet, ChevronRight, Link2, Eye, Shuffle, Crop, Palette, WandSparkles, Move, Mic, Expand, Shrink, ArrowLeft, AudioLines, Bookmark, Captions, Car, Check, Mountain, PenTool, Users, Crosshair, EyeOff, ScanFace, Snowflake, Pipette, CircleHelp, Layers, Lock, Unlock, Monitor, Moon, Sun, Type, Download, FlipHorizontal, FlipVertical, LoaderCircle, Maximize, Minimize, Minus, MoreHorizontal, Music, Pause, PanelRightClose, PanelRightOpen, Play, Plus, Redo2, RotateCcw, RotateCw, Scissors, Trash2, Undo2, Volume2, VolumeX, X, TriangleAlert, Image as ImageIcon, Sparkles, Wind, SlidersHorizontal, ALargeSmall, Quote, Wallpaper, MessageSquareText } from 'lucide-react';
import { Search, Settings2, Paintbrush, X as Close } from 'lucide-react';
import { useClipboard } from './useClipboard';
import { asVideo } from './photoToVideo';
import { wheelFactor, zoomBy } from '../timeline/zoom';
import { setKaraoke as setKaraokeFor } from '../timeline/karaoke';
import { drawnPoints } from '../timeline/shapeEdit';
import { ShapeDrawing } from './ShapeDrawing';
import { TRANSITIONS, TRANSITION_DIRECTIONS, TRANSITION_ICONS } from './transition-catalog';
import TransitionPopover from './TransitionPopover';
import { clipPlacement, invert, pinStretch, pinTrackOptions, sceneMatrix, type SceneTrack } from '../timeline/title3d';
import { fetchRecorded, getSurface, moveMediaToFolder, startPeopleGrid, startSceneTrack } from '../api/client';
import type { KeepClear } from '../timeline/model';
import { removeStay, stayWith } from '../timeline/stayWith';
import { KEEP_CLEAR_ROOM, keepClear, removeKeepClear, roomOf, type PeopleGrid, type Room } from '../timeline/keepClear';
import { startBrandIntro, listSoundEffects, useSoundEffect as fetchSoundEffect, type SoundEffectInfo, listLuts, type LutInfo, translateLines, startBestMoments, waitForJob, faceFinderReady, startReframe, getPhoto, listEffects, makeEffect, type EffectInfo, startScenes, getFocus, getSongBeats, cancelRenderJob, clipFilmstripUrl, clipProxyUrl, exportProjectTimeline, fetchTextImage, fetchTextLetters, fetchCaptionImage, fetchShapeMask, requestCleanVoice, cleanVoiceUrl, requestPrepared, preparedProxyUrl, getMusicLibrary, musicListenUrl, takeLibraryTrack, type LibraryTrack, type Mood, requestInstances, instancesPictureUrl, type FoundOne, startFaces, startTracking, getWords, startWords, getClipAssets, previewRenderUrl, startPreviewRender, getClipPeaks, getJobStatus, getProjectTimeline, getSongPeaks, getStemsStatus, getVideoProject, listPhotos, photoImageUrl, photoThumbUrl, photoVideoUrl, saveVideoProject, songUrl, startStems, uploadVideoAudio, type Stems } from '../api/client';
import ImportArea from '../components/ImportArea';
import KanaaSelect from '../components/KanaaSelect';
import AIImageGenerator from '../components/CoverArtGenerator';
import { DeleteMediaDialog, FolderDialog, folderNames } from '../components/MediaDialogs';
import type { Photo } from '../types/photo';
import type { Animation, LookName, Preset, Transition, TransitionDirection, TransitionKind } from '../timeline/animation';
import { LETTER_PRESETS } from '../timeline/animation';
import { CINEMA_REVEALS, TITLE_SPACE, titleSpaceOf, cinemaReveal, cinemaRevealFront, cinemaRevealShape, removeCinemaReveal, DEFAULT_TITLE_DEPTH, type CinemaReveal } from '../timeline/model';
import { DEFAULT_BEAT_PULSE, DEFAULT_COLOUR_SPLASH, DEFAULT_DREAMY_GLOW, DEFAULT_ECHO, DEFAULT_LENS_SURFACE, DEFAULT_MIRROR, DEFAULT_OLD_FILM, DEFAULT_SIGNAL_DAMAGE, DEFAULT_TILT_SHIFT, DEFAULT_TONE_GRADE, DEFAULT_ZOOM_BLUR, TONE_PRESETS } from '../timeline/model';
import { onSkyline, snapshotFrame, TITLE_DESIGNS, type TitleDesign } from '../timeline/model';
import { applyTitleMove, stillTitle, TITLE_MOVES } from '../timeline/titleMoves';
import { applyLayerStyles, layerLines, retimeLayerLines, followsLayer, setFollowLayer, overrideLayerItems, overriddenCount, groundRiseBehind, groundRiseGap, markOwn, ownOverLayer, setGroundRiseGap, setLayerStyle, sharedKeys, styledLayerOf, useLayerStyle } from '../timeline/model';
import { commit, redo, startHistory, undo, type History } from '../timeline/history';
import type { CoverKind } from '../timeline/model';
import { barShare, CINEMATIC, type Finish, groundShape, putBehindShape, putBehindObject, replaceBackground, cutoutToken, focusAt, focusLocal, type CutoutPick, type BlurAmount, type ShapeMask, captionLayers, captionStates, captionText, findCaption, removeCaption, setCaptions, updateCaption, updateCaptionLook, type Caption, type CaptionLayer, type CaptionLook, freezeFrame, putBehindPerson, trimAtPlayhead, REST_TRANSFORM, addBlur, findBlur, removeBlur, updateBlur, BLUR_SECONDS, DEFAULT_BLUR, type BlurBox, cornerPlacement, MIN_CLIP_SECONDS, moveItem, setSpeed, trimSound, trimText, MAX_PHOTO_SECONDS, MAX_VIDEO_LAYERS, removeMedia, duplicateItem, isLocked, layerOf, reorderLayer, overlayLayers, addOverlay, addSound, addText, audioLayers, clipLength, detachAudio, duration, exportFormat, fillScale, findClip, findSound, findText, FORMATS, insertClip, mainLayer, MUSIC_VOLUME, newClip, OVERLAY_SCALE, normalizeTimeline, removeClip, removeSound, removeText, soundLength, splitClip, splitSound, timecode, trimClip, textLayers, updateClip, updateLayer, updateSound, updateText, type Adjust, type AudioLayer, type BlendMode, type Corner, type VideoLayer, type Clip, type Format, type Sound, type SourceFacts, type TextItem, type Timeline, type TitlePin, type SurfaceKind } from '../timeline/model';
import { PlaybackEngine, type PlaybackSource } from './playback';
import { ContextMenu, isEditable, type MenuItem, type MenuState } from './ContextMenu';
import { TimeField, ValueSlider, type TimeFieldProps } from './controls';
import { buildTokens, cutTokens, tidyUp, type Word } from '../timeline/words';
import { LANGUAGES, WordsPanel } from './Words';
import { explainError } from './errors';
import { EditorContext } from './state/EditorContext';
import { TitleEditBox, TitleToolbar } from './preview/TitleEditing';
import ErrorBanner from './ErrorBanner';
import { Timing, timingSummary } from './Timing';
import JobTray from './JobTray';
import CommandPalette, { type Command } from './CommandPalette';
import { ARTICLES } from './guide-articles';
import { DEFAULT_CHROMA } from '../timeline/chroma';
import { DEFAULT_LAYOUT, Group, HelpContext, LayerModeContext, RailContext, SimpleContext, LIMITS, More, Panel, Splitter, useEditorLayout, type ThemeChoice } from './layout';
import { Guide } from './Guide';
import { MotionPanel, MotionPath } from './Keyframes';
import { ResizeBox } from './ResizeBox';
import { clipBox } from '../timeline/resize';
import TimelineView, { type ClipVisuals } from './TimelineView';
import { valueAt } from '../timeline/evaluate';
import { isFollowed, writeValue } from '../timeline/keyframes';
import { clearTransitions, transitionEverywhere } from '../timeline/transitions';
import { applyCinematicPreset, activeCinematicPreset, clearCinematicPreset, CINEMATIC_PRESETS } from '../timeline/cinematic';
import { applyBrand, brandClip, brandOnClip, brandsOnClip, BRAND_SIZES, coverBrand, fadeBrand, moveBrand, removeBrand, removeClipBrand, resizeBrand } from '../timeline/brand';
import { applyMove, focusOnScreen, slotPlacement, type Focus, type MovePreset } from '../timeline/presets';
import { activeTheme, addThemeMusic, applyTheme, openingWords, pickTrack, removeTheme, removeThemeMusic, themeMusic, THEMES, type Theme as VideoTheme } from '../timeline/themes';
import { buildStory, fillRest, STORIES, storySeconds, type Story } from '../timeline/stories';
import { applyBypass, clipEffects, playingTimeline, removeEffect, toggleAllEffects, toggleEffect } from '../timeline/effects';
import { cinematicJoinFor, cinematicJoinTime, addTemplateEffects, dateWords, defocusBox, ENGLISH_FONTS, fromTemplate, isDateTemplate, lookOf, MAX_SAVED, motionOf, savedStyles, saveStyles, TAMIL_FONTS, TEMPLATES, type FontChoice, type Template } from '../timeline/templates';
import { buildCaptions, retypeCaption, DEFAULT_CAPTION_OPTIONS } from '../timeline/captions';
import { localAt, RAMPS, rampSpeed, sourceAt, type RampName, type RampPoint } from '../timeline/ramp';
import { blurForFace, boxInSource, faceUnder, followPath, unfollow, videoAt, videoUnder, type TrackPoint } from '../timeline/tracking';
import { ProjectSaveQueue, type SaveState } from './project-save';
import { exportSpec } from './export-spec';
import { nextTabIndex } from './tab-navigation';

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
  useEffect(() => {
    // Leaving the screen's full screen (Esc, or the green button) leaves this too.
    const changed = () => { if (!document.fullscreenElement) setFullScreen(false); };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  /** Fills the window at once, and the whole screen where the system allows it. */
  const toggleFullScreen = useCallback(() => {
    setFullScreen((on) => {
      if (on) { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); return false; }
      void stageRef.current?.requestFullscreen?.().catch(() => { /* The window-filling view still works. */ });
      return true;
    });
  }, []);
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
  const { pinTarget, pinTitle, placeInScene, clipUnderTitle, keepTitleClear, addBrandIntro, stayWithPeople } = createTitleSceneActions(() => ({ sceneTrackKey, timelineRef, change, engineRef, mediaById, setError, setPinProgress, setSceneTracks, setPlacing, newId, setNote, setClearProgress, setKeepClearNote, sceneTracks, setIntroProgress, setMedia, setStayProgress, setStayNote, setSelectedId }));
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
  const renderPreview = async () => {
    if (!timeline) return;
    engineRef.current?.pause();
    try {
      const { job_id } = await startPreviewRender(projectId, { ...coverBrand(timeline), format: exportFormat(timeline.format, PREVIEW_SHORT_SIDE) });
      setRenderJob({ id: job_id, key: JSON.stringify(timeline), progress: 0 });
    } catch (problem) { setError((problem as Error).message); }
  };
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
  const addBlurBox = (style: BlurBox['style'], at?: [number, number]) => {
    if (!timeline) return;
    const blur: BlurBox = { ...DEFAULT_BLUR, style, id: newId(), start: Math.round((engineRef.current?.currentTime ?? 0) * 1000) / 1000, length: BLUR_SECONDS, transform: { ...DEFAULT_BLUR.transform, ...(at ? { x: at[0], y: at[1] } : {}) } };
    change(addBlur(timeline, blur, newId()));
    setSelectedId(blur.id);
  };
  const textLocal = selectedText ? Math.max(0, Math.min(now - selectedText.start, selectedText.length)) : 0;
  // Edits go to this item alone (and become its own, over the layer's style), or to the whole layer's style.
  // The settings panel can show a whole text or video layer (its icon on the timeline): edits then go to the layer's style.
  const styleScope: 'item' | 'layer' = layerSettings ? 'layer' : 'item';
  const [layerWins, setLayerWins] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);  // The layer panel's Fix lyric timing, unfolded.
  const openLayerSettings = (layerId: string, open?: 'sync') => {
    setSyncOpen(open === 'sync');
    const layer = timeline?.layers.find((l) => l.id === layerId);
    if (!layer || (layer.kind !== 'text' && layer.kind !== 'video') || !layer.items.length) return;
    // The panel shows an item that follows the layer, so it reads the layer's own settings.
    const items = layer.items as (Clip | TextItem)[];
    setSelectedId((items.find((item) => !item.own?.length) ?? items[0]).id);
    setLayerSettings(layerId);
  };
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
  const scopeBar = (id: string, noun: 'title' | 'clip') => {
    const layer = timeline ? styledLayerOf(timeline, id) : null;
    if (!timeline || !layer) return null;
    if (layerSettings) {
      const overridden = overriddenCount(timeline, layerSettings);
      return <div className="ed-scope">
        <p className="ed-tip">{t('Every item on this layer follows, except settings an item sets itself.')} ({layer.items.length})</p>
        <label className="ed-check"><input type="checkbox" checked={layerWins} onChange={(event) => setLayerWins(event.target.checked)}/>{t('Changes here override every clip')}</label>
        {overridden > 0 && <button type="button" className="ed-button wide" title={t("Every item drops its own settings and takes the layer's")} onClick={() => change(overrideLayerItems(timeline, layerSettings))}>{t('Override all ({count} set their own)', { count: overridden })}</button>}
        {layer.kind === 'text' && layer.items.length > 1 && <details className="ed-sync-fold" open={syncOpen} onToggle={(event) => setSyncOpen((event.currentTarget as HTMLDetailsElement).open)}><summary>{t('Fix lyric timing')}</summary><LyricSyncFix cues={layerLines(timeline, layer.id)} duration={Math.max(duration(timeline), ...layerLines(timeline, layer.id).map((line) => line.end))} position={now}
          onSeek={seek} onChange={(lines) => change(retimeLayerLines(timeline, layer.id, lines))}/></details>}
      </div>;
    }
    const own = ownOverLayer(timeline, id);
    const item = (layer.items as (Clip | TextItem)[]).find((entry) => entry.id === id);
    const following = !item || followsLayer(item);
    if (!Object.keys(layer.style ?? {}).length && following) return null;
    return <div className="ed-scope">
      {(following ? Object.keys(layer.style ?? {}).length > 0 : true) && <label className="ed-check ed-follow" title={t(following ? "Follows the layer's settings. Turn off to keep this one as it is" : "Layer settings don't apply here. Turn on to follow the layer")}><input type="checkbox" checked={following} onChange={() => change(setFollowLayer(timeline, id, !following))}/><Link2 size={13}/>{t('Use layer style')}</label>}
      {following && own.length > 0 && <p className="ed-tip">{t(noun === 'title' ? 'This title sets its own:' : 'This clip sets its own:')} {own.map((key) => t(STYLE_NAMES[key] ?? key.replace(/_/g, ' '))).join(', ')}. <button type="button" className="ed-link" onClick={() => change(useLayerStyle(timeline, id))}>{t("Use the layer's")}</button></p>}
    </div>;
  };
  const pick = (id: string | null, how?: 'add' | 'range') => {
    if (!how || !id || !selectedId || !timeline) { setMoreIds(new Set()); setSelectedId(id); return; }
    if (how === 'add') {
      if (id === selectedId) {  // ⌘-click on the main one passes the lead to another picked item.
        const [next, ...rest] = [...moreIds];
        if (next) { setSelectedId(next); setMoreIds(new Set(rest)); } else setSelectedId(null);
        return;
      }
      const next = new Set(moreIds); if (next.has(id)) next.delete(id); else next.add(id);
      setMoreIds(next); return;
    }
    // A range: every item on the same layer from the selected one to this one, by time.
    const layer = timeline.layers.find((l) => (l.items as { id: string }[]).some((item) => item.id === id));
    const items = layer ? [...(layer.items as { id: string; start: number }[])].sort((a, b) => a.start - b.start) : [];
    const from = items.findIndex((item) => item.id === selectedId), to = items.findIndex((item) => item.id === id);
    if (from < 0 || to < 0) { setMoreIds(new Set()); setSelectedId(id); return; }
    setMoreIds(new Set(items.slice(Math.min(from, to), Math.max(from, to) + 1).map((item) => item.id).filter((other) => other !== selectedId)));
  };
  // Everything ⌘K can find: actions, panels, title styles, layers and guide pages.
  const paletteCommands = (): Command[] => {
    const list: Command[] = [];
    // Labels and groups are translated here, with the English kept as keywords so English search still finds them.
    const add = (id: string, label: string, group: string, run: () => void, hint?: string, keywords?: string) => list.push({ id, label: t(label), group: t(group), run, hint, keywords: `${label} ${group} ${keywords ?? ''}` });
    const named = (id: string, english: string, name: string, group: string, run: () => void, keywords?: string) => list.push({ id, label: t(english, { name }), group: t(group), run, keywords: `${english.replace('{name}', name)} ${group} ${keywords ?? ''}` });
    const busy = !timeline || !total;
    if (!busy) {
      add('play', 'Play or pause', 'Playback', () => togglePlay(), 'Space');
      add('split', 'Split at the playhead', 'Edit', () => split(), 'S', 'cut');
      add('freeze', 'Freeze frame', 'Edit', () => freeze(), undefined, 'hold still');
      add('snapshot', 'Snapshot', 'Edit', () => { void snapshot(); }, undefined, 'photo capture');
      add('render', 'Render smooth preview', 'View', () => { void renderPreview(); });
      add('export', 'Export', 'Video', () => { engineRef.current?.pause(); setExporting(true); }, undefined, 'save mp4 share download');
    }
    add('undo', 'Undo', 'Edit', () => dispatch({ type: 'undo' }), '⌘Z');
    if (selectedId) { add('copy', 'Copy', 'Edit', () => clipboard.copy(), '⌘C'); add('cut', 'Cut', 'Edit', () => clipboard.copy(true), '⌘X'); add('duplicate', 'Duplicate', 'Edit', () => clipboard.duplicate(), '⌘D');
      add('copy-style', 'Copy style', 'Edit', () => clipboard.copyStyleOf(), '⌥⌘C', 'format painter look'); if (clipboard.styleCopy) add('paste-style', 'Paste style', 'Edit', () => clipboard.pasteStyleOnto(), '⌥⌘V', 'format painter look'); }
    if (clipboard.hasCopy()) add('paste', 'Paste at the playhead', 'Edit', () => clipboard.pasteAt(playhead.current), '⌘V');
    add('redo', 'Redo', 'Edit', () => dispatch({ type: 'redo' }), '⇧⌘Z');
    add('full', 'Full screen preview', 'View', () => toggleFullScreen(), 'F');
    add('guide', 'Guide and shortcuts', 'Help', () => setShowingHelp(true), '?');
    add('project', 'Project settings', 'Settings', () => { setLayerSettings(null); setSelectedId(null); updateLayout({ inspectorOpen: true }); }, undefined, 'format shape frame rate loudness brand');
    add('lite', layout.simple ? 'Switch to Pro (every control)' : 'Switch to Lite (main choices only)', 'Settings', () => updateLayout({ simple: !layout.simple }));
    add('language', LANGUAGE === 'ta' ? 'Switch to English' : 'Switch to Tamil (தமிழ்)', 'Settings', () => setLanguage(LANGUAGE === 'ta' ? 'en' : 'ta'), undefined, 'language tamil english');
    for (const tab of LEFT_TABS) named(`tab-${tab}`, 'Open {name}', t(LEFT_TAB_LABELS[tab]), 'Panels', () => { setLeftTab(tab); setPanelOpen(true); }, `${LEFT_TAB_LABELS[tab]} ${TAB_TIPS[tab]}`);
    if (timeline) for (const layer of timeline.layers) if ((layer.kind === 'text' || layer.kind === 'video') && layer.items.length) {
      named(`layer-${layer.id}`, 'Layer settings: {name}', layer.name || layer.kind, 'Layers', () => openLayerSettings(layer.id), 'whole layer style');
      if (layer.kind === 'text' && layer.items.length > 1) named(`sync-${layer.id}`, 'Fix lyric timing: {name}', layer.name || 'Text', 'Layers', () => openLayerSettings(layer.id, 'sync'), 'sync shift stretch lyrics offset');
    }
    if (timeline) for (const title of TEMPLATES) named(`title-${title.id}`, 'Add title: {name}', t(title.label), 'Titles', () => { void addTitle(title); }, 'text heading');
    for (const article of ARTICLES) named(`guide-${article.id}`, 'Guide: {name}', LANGUAGE === 'ta' && article.tamil ? article.tamil : article.title, 'Help', () => openGuide(article.id), `${article.title} ${article.tamil ?? ''} ${article.summary}`);
    return list;
  };
  // "Find in settings": the settings panel searches for the words, as its own search box does.
  const findSetting = (query: string) => {
    updateLayout({ inspectorOpen: true });
    window.setTimeout(() => {
      const box = document.querySelector<HTMLInputElement>('.ed-inspector input[aria-label="Find a setting"], .ed-inspector .ed-find input');
      if (!box) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, query);
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.focus();
    }, 60);
  };
  // The settings that differ among the picked items (shown as Mixed); only settings a change would make the same.
  const mixedSettings = (): string[] => {
    if (!timeline || !selectedId || !moreIds.size) return [];
    const ids = [selectedId, ...moreIds];
    const items = ids.map((id) => findText(timeline, id)?.text ?? findClip(timeline, id)).filter(Boolean) as Record<string, unknown>[];
    if (items.length < 2) return [];
    const keys = sharedKeys(Object.assign({}, ...items)).filter((key) => key !== 'transform' && key !== 'adjust');
    return keys.filter((key) => new Set(items.map((item) => JSON.stringify(item[key] ?? null))).size > 1).slice(0, 6);
  };
  // In a text layer's settings, karaoke goes on (or off) for every title on the layer, each timed to its own words.
  const setKaraoke = (colour: string | null) => { if (timeline && selectedText) change(setKaraokeFor(timeline, settingsLayer?.kind === 'text' ? settingsLayer.items.map((item) => item.id) : [selectedText.id, ...moreIds], colour)); };
  const updateSelectedText = (changes: Partial<TextItem>, group?: string) => {
    if (timeline && selectedText && moreIds.size && styleScope === 'item') {
      // Several titles picked: the change goes to each of them (never their words or timing).
      const shared = Object.fromEntries(Object.entries(changes).filter(([key]) => sharedKeys({ [key]: 0 }).length)) as Partial<TextItem>;
      let next = updateText(timeline, selectedText.id, changes);
      for (const id of moreIds) if (findText(next, id) && Object.keys(shared).length) next = markOwn(updateText(next, id, shared), id, shared);
      change(markOwn(next, selectedText.id, changes), group);
      return;
    }
    if (timeline && selectedText) scopedUpdate(selectedText.id, changes, (t) => updateText(t, selectedText.id, changes), group);
  };
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
  const { listen, librarySong, chooseTheme, makeStory, buildStoryVideo, changeThemeMusic, addLibraryTrack } = createThemeActions(() => ({ listenRef, listening, setListening, timeline, setError, themeBusy, projectName, setThemeBusy, mediaById, aimFor, newId, themeWithMusic, loadLibrary, setThemeTrack, change, story, facts, timelineRef, setMomentProgress, setStory, library, themeTrack, setAddingMusic, engineRef, MIN_MUSIC_SECONDS, setSelectedId }));
  useEffect(() => () => { listenRef.current?.pause(); }, []);
  const storyMedia = media.filter((item) => item.media_type === 'video' || item.media_type === 'image');
  const saveStyle = (text: TextItem) => {
    const style: Template = { id: `mine-${Date.now().toString(36)}`, label: text.text.slice(0, 18), look: lookOf(text), motion: motionOf(text) };
    const next = [style, ...myStyles].slice(0, MAX_SAVED);
    setMyStyles(next); saveStyles(next);
  };
  const forgetStyle = (id: string) => { const next = myStyles.filter((style) => style.id !== id); setMyStyles(next); saveStyles(next); };
  const addTitle = async (title: Template, dropAt?: number, words?: string) => {
    if (!timeline) return;
    const at = dropAt ?? engineRef.current?.currentTime ?? 0;
    // A date title says when the clip under it was filmed (or the photo taken); today when the file doesn't say.
    let dated: Partial<TextItem> = {};
    if (isDateTemplate(title.id) && !words) {
      const under = mainLayer(timeline).items.find((item) => item.start <= at && at < item.start + clipLength(item));
      const recorded = under ? await fetchRecorded(under.media_id).catch(() => null) : null;
      dated = dateWords(recorded, title.id === 'date-tamil' ? 'ta' : 'en');
      if (!recorded) setError(under ? 'This clip doesn\'t say when it was filmed, so the title shows today\'s date. Type the right one.' : 'No clip here, so the title shows today\'s date.');
    }
    const current = timelineRef.current ?? timeline;
    const text: TextItem = { ...fromTemplate(title, newId(), title.extra?.transition ? cinematicJoinTime(current,at) : Math.round(at * 1000) / 1000, TEXT_SECONDS), ...dated, ...(words ? { text: words, subtitle: '' } : {}) };
    let next = cinematicJoinFor(title, addText(current, text, newId()), text.start);
    // Pull focus: the picture behind softens while the title sharpens.
    if (title.extra?.defocus) next = addBlur(next, defocusBox(newId(), text.start, text.length, text.enter?.duration ?? 1, text.exit?.duration ?? 0.6), newId());
    change(next);
    // A title that brings an effect (lens flare, sparkles, bokeh) lays it over the video for the title's length.
    void addTemplateEffects(title, text.start, text.length, addEffect, current, getSongBeats);
    setSelectedId(text.id);
    // A title starts hidden behind its enter animation, so show it at rest.
    setTimeout(() => engineRef.current?.seek(text.start + TEXT_SECONDS / 2), 0);
  };
  const showEnter = (start: number, seconds: number) => engineRef.current?.playRange(start, start + seconds);
  const showExit = (end: number, seconds: number) => engineRef.current?.playRange(Math.max(0, end - seconds), Math.max(0, end - 0.02));
  const clipsInOrder = timeline ? [...mainLayer(timeline).items].sort((a, b) => a.start - b.start) : [];
  const clipIndex = selected ? clipsInOrder.findIndex((clip) => clip.id === selected.id) : -1;
  const applyStems = (result: Stems) => {
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
  const separate = async (choice: StemChoice) => {
    if (!selectedSound) return;
    const { sound } = selectedSound;
    try {
      const { job_id } = await startStems(sound.asset_id ? { asset_id: sound.asset_id } : { media_id: sound.media_id });
      setStemJob({ soundId: sound.id, jobId: job_id, choice, progress: 0 });
    } catch (problem) { setError((problem as Error).message); }
  };
  const updateSelectedSound = (changes: Partial<Sound>, group?: string) => { if (timeline && selectedSound) change(changes.speed !== undefined ? setSpeed(timeline, selectedSound.sound.id, changes.speed) : updateSound(timeline, selectedSound.sound.id, changes), group); };
  const hasSound = (id: number) => Boolean(visuals.current.get(id)?.peaks?.peaks.some(Boolean));
  const hasAudibleAudio = Boolean(timeline?.layers.some((layer) => {
    if (layer.muted) return false;
    if (layer.kind === 'audio') return layer.items.some((sound) => !sound.muted && sound.volume > 0);
    if (layer.kind === 'video') return layer.items.some((clip) => !clip.muted && clip.volume > 0 && hasSound(clip.media_id));
    return false;
  }));
  const detach = (clip = selected) => {
    if (!timeline || !clip) return;
    const soundId = newId();
    change(detachAudio(timeline, clip.id, soundId, newId(), `${mediaById.get(clip.media_id)?.filename ?? 'Clip'} sound`.slice(0, 120), mediaById.get(clip.media_id)?.duration ?? undefined));
    setSelectedId(soundId);
  };
  const addMusic = async (file: File) => {
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
  const updateSelected = (changes: Partial<Clip>, group?: string) => {
    if (timeline && selected && moreIds.size && styleScope === 'item' && changes.speed === undefined) {
      const shared = Object.fromEntries(Object.entries(changes).filter(([key]) => sharedKeys({ [key]: 0 }).length)) as Partial<Clip>;
      let next = updateClip(timeline, selected.id, changes);
      for (const id of moreIds) if (findClip(next, id) && Object.keys(shared).length) next = markOwn(updateClip(next, id, shared), id, shared);
      change(markOwn(next, selected.id, changes), group);
      return;
    }
    if (timeline && selected) scopedUpdate(selected.id, changes, (t) => changes.speed !== undefined ? setSpeed(t, selected.id, changes.speed) : updateClip(t, selected.id, changes), group); };
  const clipEffectApplied = (id: (typeof CLIP_EFFECT_PRESETS)[number]['id']) => Boolean(selected && (
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
  const applyClipEffect = async (id: (typeof CLIP_EFFECT_PRESETS)[number]['id']) => {
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
  const fps = timeline?.format.fps ?? 30;
  const sourceLimit = (mediaId: number) => { const item = mediaById.get(mediaId); return item?.media_type === 'video' ? item.duration ?? undefined : MAX_PHOTO_SECONDS; };
  const clipTiming = (clip: Clip): TimeFieldProps[] => {
    if (!timeline) return [];
    const length = clipLength(clip);
    const main = selectedLayer === mainLayer(timeline);
    const edit = (edge: 'in' | 'out', seconds: number) => change(main ? trimClip(timeline, clip.id, edge, seconds, facts(clip.media_id)) : trimSound(timeline, clip.id, edge, seconds, sourceLimit(clip.media_id)));
    const isVideo = mediaById.get(clip.media_id)?.media_type === 'video';
    return [
      main ? { label: 'Start', value: clip.start, fps } : { label: 'Start', value: clip.start, fps, onChange: (t: number) => change(moveItem(timeline, clip.id, t)) },
      { label: 'Duration', value: length, fps, onChange: (t: number) => edit('out', clip.in + t * clip.speed) },
      ...(isVideo ? [{ label: 'In', value: clip.in, fps, onChange: (t: number) => edit('in', t) }, { label: 'Out', value: clip.out, fps, onChange: (t: number) => edit('out', t) }] : []),
    ];
  };
  const soundTiming = (sound: Sound): TimeFieldProps[] => (timeline ? [
    { label: 'Start', value: sound.start, fps, onChange: (t) => change(moveItem(timeline, sound.id, t)) },
    { label: 'Duration', value: soundLength(sound), fps, onChange: (t) => change(trimSound(timeline, sound.id, 'out', sound.in + t * sound.speed)) },
    { label: 'In', value: sound.in, fps, onChange: (t) => change(trimSound(timeline, sound.id, 'in', t)) },
    { label: 'Out', value: sound.out, fps, onChange: (t) => change(trimSound(timeline, sound.id, 'out', t)) },
  ] : []);
  const textTiming = (text: TextItem | BlurBox | Caption): TimeFieldProps[] => (timeline ? [
    { label: 'Start', value: text.start, fps, onChange: (t) => change(moveItem(timeline, text.id, t)) },
    { label: 'Duration', value: text.length, fps, onChange: (t) => change(trimText(timeline, text.id, 'out', text.start + t)) },
    { label: 'End', value: text.start + text.length, fps, onChange: (t) => change(trimText(timeline, text.id, 'out', t)) },
  ] : []);
  const pauseEngine = () => engineRef.current?.pause();
  const seek = useCallback((t: number) => engineRef.current?.seek(t), []);
  // What the settings panels share (state/EditorContext). Null until the project has loaded.
  const editorShared = useMemo(() => timeline ? { timeline, change, pause: () => engineRef.current?.pause(), openGuide: (article?: string) => { if (article) openGuide(article); else setShowingHelp(true); },
    now, seek, selectedId, select: (id: string | null) => { setMoreIds(new Set()); setSelectedId(id); },
    addMedia: (item: Photo) => setMedia((current) => (current.some((each) => each.id === item.id) ? current : [item, ...current])),
    drawBox: (onBox: (box: Box) => void) => { engineRef.current?.pause(); setDrawing({ mode: 'start', onBox }); } } : null, [timeline, change, openGuide, now, seek, selectedId]);
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
  const snapshot = async (t = playhead.current) => {
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
  /** A picture or video behind a cut-out clip, filling the frame. */
  const newBackground = (clip: Clip, item: Photo) => {
    if (!timeline) return;
    const source = { media_id: item.id, media_type: item.media_type === 'video' ? 'video' as const : 'image' as const, duration: item.duration, width: item.width || 1920, height: item.height || 1080 };
    try {
      const next = replaceBackground(timeline, clip.id, source, [newId(), newId()]);
      if (next === timeline) setError('Put the cut-out clip over the main track first.');
      else change(next);
    } catch (problem) { setError((problem as Error).message); }
  };

  /** Puts the title behind what was drawn: a line along the ground or mountains, or the outline of a shape. */
  const finishShape = () => {
    if (!timeline || !shaping) return;
    const enough = shaping.mode === 'ground' ? shaping.points.length >= 2 : shaping.points.length >= 3;
    if (!enough) { setError(shaping.mode === 'ground' ? 'Click at least two points along the top of the ground.' : 'Click at least three points around the shape.'); return; }
    const mask: ShapeMask = { points: shaping.mode === 'ground' ? groundShape(shaping.points) : shaping.points, feather: SHAPE_FEATHER };
    const next = shaping.reveal
      ? cinemaRevealShape(timeline, shaping.textId, shaping.reveal, mask, [newId(), newId()])
      : putBehindShape(timeline, shaping.textId, mask, [newId(), newId()]);
    setShaping(null);
    if (next === timeline) setError('Put the title over a video clip or picture on the main track first.'); else change(next);
  };
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
  const addMedia = (item: Photo) => {
    if (!timeline) return;
    const source: SourceFacts = { media_id: item.id, media_type: item.media_type === 'video' ? 'video' : 'image', duration: item.duration, width: item.width, height: item.height };
    const clip = newClip(source, newId());
    change(insertClip(timeline, clip));
    setSelectedId(clip.id);
  };
  const addOverlayMedia = (item: Photo, dropAt?: number) => {
    if (!timeline) return;
    const source: SourceFacts = { media_id: item.id, media_type: item.media_type === 'video' ? 'video' : 'image', duration: item.duration, width: item.width, height: item.height };
    const base = newClip(source, newId());
    const clip = { ...base, start: Math.round((dropAt ?? engineRef.current?.currentTime ?? 0) * 1000) / 1000, transform: { ...base.transform, scale: OVERLAY_SCALE } };
    try {
      change(addOverlay(timeline, clip, newId()));
      setSelectedId(clip.id);
    } catch (problem) { setError((problem as Error).message); }
  };
  /** Something dragged from the side panel landed on the timeline. */
  const onDropPayload = (payload: DragPayload, target: DropTarget) => {
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
  /** Where faces are in each picture (0 to 1), found once per picture and moment. Null: none, or the face finder isn't on this Mac yet. */
  const focusCache = useRef(new Map<string, Focus | null>());
  const aimFor = async (clip: Clip, base: Timeline): Promise<Focus | null> => {
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
  /** Quick moves on the selected clip. Push in and Pull out aim at faces when there are any. */
  const moveSelected = async (move: MovePreset) => {
    if (!timeline || !selected) return;
    const clip = selected;
    const aim = move === 'push-in' || move === 'pull-out' ? await aimFor(clip, timeline) : null;
    updateSelected({ transform: applyMove(clip.transform, move, local, (clip.out - clip.in) / clip.speed, aim) });
  };
  const [effects, setEffects] = useState<EffectInfo[]>([]);
  const [effectBusy, setEffectBusy] = useState<{ id: string; progress: number } | null>(null);
  const [effectSection, setEffectSection] = useState<string | null>('clip-Film');
  const [effectSearch, setEffectSearch] = useState('');
  const [weather, setWeather] = useState({ rainDensity: 1, rainSpeed: 1, rainDirection: 'left' as 'left' | 'straight' | 'right', frequency: 3, brightness: 0.8,
    fogDensity: 0.65, fogSpeed: 0.55, fogDirection: 'right' as 'left' | 'straight' | 'right', snowDensity: 0.8, snowSpeed: 0.8, snowDirection: 'right' as 'left' | 'straight' | 'right', seed: 0 });
  useEffect(() => { if (leftTab === 'effects' && !effects.length) listEffects().then(setEffects).catch((problem) => setError((problem as Error).message)); }, [leftTab, effects.length]);
  /** Makes the effect once in this project's shape (later uses are instant), then lays it over the video at `dropAt` or the playhead. */
  const addEffect = async (effectId: string, dropAt?: number, length?: number, around?: Partial<Clip['transform']>) => {
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
  const [momentProgress, setMomentProgress] = useState<number | null>(null);
  const [clearNote, setClearNote] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  /** Moves each caption that would cover a face to the top (or middle), for that caption only. */
  const keepClearOfFaces = async () => {
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
  const [soundEffects, setSoundEffects] = useState<SoundEffectInfo[] | null>(null);
  const [sfxChoice, setSfxChoice] = useState<{ whoosh: string; hit: string }>({ whoosh: 'kanaa-whoosh', hit: 'kanaa-hit' });
  const [sfxBusy, setSfxBusy] = useState<'whoosh' | 'hit' | null>(null);
  const [sfxNote, setSfxNote] = useState<string | null>(null);
  useEffect(() => { if (leftTab === 'audio' && soundEffects === null) listSoundEffects().then((found) => setSoundEffects(found.effects)).catch(() => setSoundEffects([])); }, [leftTab, soundEffects]);
  /** Whooshes on every transition, or hits on every title reveal, peaking on the moment. Again replaces the earlier ones. */
  const addSoundEffects = async (kind: 'whoosh' | 'hit') => {
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
  const [thunderBusy, setThunderBusy] = useState(false);
  /** Adds Kanaa's locally generated thunder at the playhead as a normal, editable sound clip. */
  const addThunder = async () => {
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
  const [looping, setLooping] = useState(false);
  /** Repeats a short song on the beat until the picture ends. */
  const loopSelectedSound = async (soundId: string) => {
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
  const [beatBusy, setBeatBusy] = useState(false);
  const [beatNote, setBeatNote] = useState<string | null>(null);
  /** Ends every main-track clip on the music's nearest beat, in one Undo. */
  const cutClipsToBeat = async () => {
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
  /** Clicking a look or transition tile applies it to the selected clip; dragging puts it on any clip. */
  const applyToSelected = (payload: DragPayload) => {
    if (!timeline || !selected) { setError('Select a clip first, or drag this onto a clip in the timeline.'); return; }
    if (isLocked(timeline, selected.id)) return;
    const next = applyClipDrop(timeline, payload, selected.id);
    if (next === timeline) setError('A transition goes on a clip that comes after another one on the main track.'); else change(next);
  };
  /** "Same as my clip": the first clip on the main track, not the project's starting file (a blank project has none). */
  const firstClip = timeline ? [...mainLayer(timeline).items].sort((a, b) => a.start - b.start)[0] : undefined;
  const firstMedia = firstClip ? mediaById.get(firstClip.media_id) : undefined;
  const firstClipFormat: Format | null = firstMedia?.width && firstMedia.height ? { width: firstMedia.width - firstMedia.width % 2, height: firstMedia.height - firstMedia.height % 2, fps: 30 } : null;
  const chooseFormat = (format: Format) => {
    if (!timeline) return;
    change({ ...timeline, format });
    setChoosingFormat(false);
  };

  // What Alt+arrows nudge: set below, once the selection's transform is known.
  const movingRef = useRef<{ transform: Clip['transform']; update: (transform: Clip['transform'], group?: string) => void } | null>(null);
  useEditorShortcuts(() => ({ setPalette, setShowingHelp, fullScreen, toggleFullScreen, pickingKey, stopPicking, drawing, setDrawing, shaping, setShaping, finishShape, timeline, exporting, choosingFormat, showingHelp, menu, engineRef, playhead, dispatch, selectedId, setMoreIds, clipboard, togglePlay, fastRate, seek, movingRef, split, setSnapping, change, facts, wordSelection, cutWords, removeSelected, setWordSelection, setSelectedId, selectedText }), [toggleFullScreen, fullScreen, timeline, exporting, choosingFormat, showingHelp, menu, pickingKey, drawing, shaping, stopPicking, wordSelection, cutWords, togglePlay, split, removeSelected, seek, change, playhead, facts, selectedId, selectedText, clipboard]);

  const dragPreview = useRef<{ x: number; y: number; clipX: number; clipY: number; group: string } | null>(null);
  const moving = selected ? { transform: selected.transform, local, update: (transform: Clip['transform'], group?: string) => updateSelected({ transform }, group) }
    : selectedBlur ? { transform: selectedBlur.transform, local: blurLocal, update: (transform: Clip['transform'], group?: string) => updateSelectedBlur({ transform }, group) }
    : selectedText ? { transform: selectedText.transform ?? REST_TRANSFORM, local: textLocal, update: (transform: Clip['transform'], group?: string) => updateSelectedText({ transform }, group) } : null;
  movingRef.current = moving;
  /** The selected overlay takes one half of the frame and the main clip under it the other. */
  const splitScreen = (layout: 'side' | 'stack') => {
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
  const startPicking = () => { if (selected) { engineRef.current?.pause(); engineRef.current?.showUnkeyed(selected.id); setPickingKey(true); } };
  // Titles in the preview: where each visible title's letters sit in the frame (shares), for picking and editing it there.
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  // The title picked by clicking it in the preview: only then does the preview show its box and toolbar.
  const [pickedInPreview, setPickedInPreview] = useState<string | null>(null);
  const titleRect = (text: TextItem): { left: number; top: number; right: number; bottom: number } | null => {
    const box = engineRef.current?.titleBox(text);
    if (!box) return null;
    const transform = text.transform ?? REST_TRANSFORM, at = Math.max(0, Math.min(text.length, now - text.start));
    const x = valueAt(transform, 'x', at), y = valueAt(transform, 'y', at), size = valueAt(transform, 'scale', at);
    return { left: x + (box[0] - 0.5) * size, top: y + (box[1] - 0.5) * size, right: x + (box[2] - 0.5) * size, bottom: y + (box[3] - 0.5) * size };
  };
  /** Bubbles or a shine around the selected title's words, for as long as it shows. */
  const decorateTitle = (effectId: 'bubbles' | 'shine') => {
    if (!selectedText) return;
    const rect = titleRect(selectedText);
    const [cx, cy, wide] = rect ? [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2, rect.right - rect.left] : [selectedText.transform?.x ?? 0.5, selectedText.position === 'bottom' ? 0.85 : selectedText.position === 'top' ? 0.15 : 0.5, 0.5];
    // Bubbles rise from a little below the words and need room; the shine only crosses the letters.
    const scale = Math.min(1, Math.max(0.2, wide * (effectId === 'bubbles' ? 1.4 : 1.15)));
    void addEffect(effectId, selectedText.start, selectedText.length, { x: Math.round(cx * 1000) / 1000, y: Math.round((effectId === 'bubbles' ? cy - 0.05 : cy) * 1000) / 1000, scale: Math.round(scale * 1000) / 1000 });
  };
  const titleAt = (fx: number, fy: number): TextItem | null => {
    if (!timeline) return null;
    const layers = timeline.layers.filter((layer): layer is Extract<typeof layer, { kind: 'text' }> => layer.kind === 'text' && !layer.hidden).reverse();  // Topmost first.
    for (const layer of layers) for (const text of layer.items) {
      if (now < text.start || now >= text.start + text.length) continue;
      const rect = titleRect(text);
      if (rect && fx >= rect.left - 0.01 && fx <= rect.right + 0.01 && fy >= rect.top - 0.01 && fy <= rect.bottom + 0.01) return text;
    }
    return null;
  };
  const previewDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
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
  const previewMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragPreview.current;
    if (!drag || !moving) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const moved = writeValue(moving.transform, 'x', moving.local, drag.clipX + (event.clientX - drag.x) / rect.width);
    moving.update(writeValue(moved, 'y', moving.local, drag.clipY + (event.clientY - drag.y) / rect.height), drag.group);
  };

  // Follow movement: the item's position (and size) become keys from a box tracked in the video under it.
  const followTarget = selected && selectedLayer && timeline && selectedLayer !== mainLayer(timeline) ? { id: selected.id, start: selected.start, length: clipLength(selected), transform: selected.transform }
    : selectedBlur ? { id: selectedBlur.id, start: selectedBlur.start, length: selectedBlur.length, transform: selectedBlur.transform }
    : selectedText ? { id: selectedText.id, start: selectedText.start, length: selectedText.length, transform: selectedText.transform ?? REST_TRANSFORM } : null;
  const isVideo = useCallback((id: number) => mediaById.get(id)?.media_type === 'video', [mediaById]);
  // Blur faces: every face in the clip at the playhead gets its own blur box that follows it.
  /** The face finder is fetched once, from OpenCV's model zoo, only after asking (the owner's rule: ask before downloading). */
  const askForFaceFinder = async (what: string) => {
    if ((await faceFinderReady()).ready) return true;
    return window.confirm(`${what} uses OpenCV's face finder (YuNet, about 230 KB). It isn't on this Mac yet. Download it once now? It stays on this Mac and Blur faces uses it too.`);
  };
  /** Auto-reframe: the clip fills the frame and pans to keep the main person in the middle. */
  const reframeClip = async (clipId: string) => {
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
  useEffect(() => {
    if (!reframeJob) return;
    const timer = setTimeout(async () => {
      try {
        const status = await getJobStatus(reframeJob.jobId) as unknown as { status?: string; progress: number; error?: string | null; path?: SubjectPoint[] };
        if (status.status === 'failed' || status.status === 'cancelled') { if (status.status === 'failed') setError(status.error ?? 'Could not follow anyone in this clip.'); setReframeJob(null); return; }
        if (status.status !== 'done' || !status.path) { setReframeJob({ ...reframeJob, progress: status.progress }); return; }
        setReframeJob(null);
        const current = timelineRef.current;
        const clip = current && findClip(current, reframeJob.clipId);
        const item = clip && mediaById.get(clip.media_id);
        if (!current || !clip || !item?.width || !item.height) return;
        const transform = reframeTransform(clip, status.path, { width: item.width, height: item.height }, current.format);
        if (!transform) { setFaceNote(clip.adjust.rotation % 360 ? 'Turn the clip back upright to follow someone in it.' : 'No faces found in this clip, so it stays as it is.'); return; }
        change(updateClip(current, clip.id, { transform }));
        setSelectedId(clip.id);
        setFaceNote('Following the person. The frame now pans with them; drag the picture or use Motion to adjust, or ⌘Z to undo.');
      } catch (problem) { setError((problem as Error).message); setReframeJob(null); }
    }, 700);
    return () => clearTimeout(timer);
  }, [reframeJob, change, mediaById]);
  /** Finds where a long video changes shot, then splits it there, so dull parts can be deleted. */
  const splitScenes = async (clipId: string) => {
    const clip = timeline && findClip(timeline, clipId);
    if (!clip || !isVideo(clip.media_id)) return;
    engineRef.current?.pause();
    setFaceNote('');
    try {
      const { job_id } = await startScenes(clip.media_id, { start: clip.in, end: clip.out });
      setSceneJob({ jobId: job_id, clipId, progress: 0 });
    } catch (problem) { setError((problem as Error).message); }
  };
  useEffect(() => {
    if (!sceneJob) return;
    const timer = setTimeout(async () => {
      try {
        const status = await getJobStatus(sceneJob.jobId) as unknown as { status?: string; progress: number; error?: string | null; cuts?: number[] };
        if (status.status === 'failed' || status.status === 'cancelled') { if (status.status === 'failed') setError(status.error ?? 'Could not look for scene changes.'); setSceneJob(null); return; }
        if (status.status !== 'done' || !status.cuts) { setSceneJob({ ...sceneJob, progress: status.progress }); return; }
        setSceneJob(null);
        const current = timelineRef.current;
        if (!current) return;
        const result = splitAtCuts(current, sceneJob.clipId, status.cuts, newId);
        if (result.splits) change(result.timeline);
        setFaceNote(result.splits ? `Split into ${result.splits + 1} scenes. Select one and press Delete to drop it; ⌘Z puts them back together.` : 'No scene changes found in this clip.');
      } catch (problem) { setError((problem as Error).message); setSceneJob(null); }
    }, 700);
    return () => clearTimeout(timer);
  }, [sceneJob, change]);
  const blurFaces = async () => {
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
  useEffect(() => {
    if (!faceJob) return;
    const timer = setTimeout(async () => {
      try {
        const status = await getJobStatus(faceJob.jobId) as unknown as { status?: string; progress: number; error?: string | null; faces?: TrackPoint[][]; more?: number };
        if (status.status === 'failed' || status.status === 'cancelled') { if (status.status === 'failed') setError(status.error ?? 'Could not look for faces.'); setFaceJob(null); return; }
        if (status.status !== 'done' || !status.faces) { setFaceJob({ ...faceJob, progress: status.progress }); return; }
        setFaceJob(null);
        const current = timelineRef.current;
        const clip = current && findClip(current, faceJob.clipId);
        const source = clip && sourceFor(clip.media_id);
        if (!current || !clip || !source) return;
        const boxes = status.faces.map((path) => blurForFace(path, clip, source, current.format, newId())).filter((box): box is BlurBox => Boolean(box));
        if (!boxes.length) { setFaceNote('No faces found in this clip. You can still add a blur box and draw around a face to follow it.'); return; }
        change(boxes.reduce((next, box) => addBlur(next, box, newId()), current));
        setSelectedId(boxes[0].id);
        const more = status.more ? ` ${status.more} smaller ${status.more === 1 ? 'face was' : 'faces were'} left out; add blur boxes for them by hand.` : '';
        setFaceNote(`Blurred ${boxes.length} ${boxes.length === 1 ? 'face' : 'faces'}. Play it back to check: each has its own blur box, so delete any face you want to show.${more}`);
      } catch (problem) { setError((problem as Error).message); setFaceJob(null); }
    }, 700);
    return () => clearTimeout(timer);
  });
  const startDrawing = (mode: 'start' | 'continue') => {
    if (!timeline || !followTarget) return;
    engineRef.current?.pause();
    const t = playhead.current;
    if (t < followTarget.start || t >= followTarget.start + followTarget.length) { setError('Move the playhead onto the selected item first.'); return; }
    if (!videoUnder(timeline, followTarget.id, t, isVideo)) { setError('There is no video under this item at the playhead to follow.'); return; }
    setFollowNote(null);
    setDrawing({ mode });
  };
  const frameAt = (event: React.PointerEvent<HTMLElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))];
  };
  const drawnBox = (state: typeof drawing): Box | null => {
    if (!state?.from || !state.to) return null;
    const [x0, y0] = state.from; const [x1, y1] = state.to;
    return [(x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0)];
  };
  const startFollowing = async (box: Box, mode: 'start' | 'continue', own = false, until?: number) => {
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
  /** Where the selected blur box or overlay sits now, so it can follow whatever is under it without drawing. Titles have none. */
  const ownBox = (): Box | null => {
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
  /** Follow what is under the blur box or overlay: no drawing, it starts from where the item sits. */
  const followHere = async (mode: 'start' | 'continue') => {
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
  const finishDrawing = (event: React.PointerEvent<HTMLElement>) => {
    const box = drawnBox({ mode: 'start', from: drawStart.current ?? undefined, to: frameAt(event) });
    const mode = drawing?.mode ?? 'start';
    const onBox = drawing?.onBox;
    drawStart.current = null;
    setDrawing(null);
    if (!box || box[2] <= MIN_DRAWN_BOX || box[3] <= MIN_DRAWN_BOX) return;
    if (onBox) onBox(box); else void startFollowing(box, mode);  // A panel asked for a box (marking lamps), or Follow did.
  };
  useEffect(() => {
    if (!followJob) return;
    const timer = setTimeout(async () => {
      try {
        const status = await getJobStatus(followJob.jobId) as unknown as { status?: string; progress: number; error?: string | null; track?: { points: TrackPoint[]; lost_before: boolean; lost_after: boolean }; faces?: TrackPoint[][] };
        if (status.status === 'failed' || status.status === 'cancelled') { if (status.status === 'failed') setError(status.error ?? 'Could not follow that.'); setFollowJob(null); return; }
        if (followJob.faces && status.status === 'done') { setFollowJob(null); applyFaces(followJob, status.faces ?? []); return; }
        if (status.status !== 'done' || !status.track) { setFollowJob({ ...followJob, progress: status.progress, queued: status.status === 'queued' }); return; }
        setFollowJob(null);
        applyFollow(followJob, status.track);
      } catch (problem) { setError((problem as Error).message); setFollowJob(null); }
    }, 600);
    return () => clearTimeout(timer);
  });
  /** A blur on a face takes that face's path; on anything else it follows what is in its square instead. */
  const applyFaces = (job: FollowJob, faces: TrackPoint[][]) => {
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
  const applyFollow = (job: FollowJob, track: { points: TrackPoint[]; lost_before: boolean; lost_after: boolean }) => {
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

  const generalItems = (): MenuItem[] => [
    { label: 'Undo', hint: '⌘Z', disabled: !history.past.length, onSelect: () => dispatch({ type: 'undo' }) },
    { label: 'Redo', hint: '⇧⌘Z', disabled: !history.future.length, onSelect: () => dispatch({ type: 'redo' }) },
  ];
  const openGeneralMenu = (event: React.MouseEvent) => {
    if (isEditable(event.target)) return;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, items: generalItems() });
  };
  const openViewMenu = (event: React.MouseEvent) => {
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
  const openPreviewMenu = (event: React.MouseEvent) => {
    event.preventDefault(); event.stopPropagation();
    const items: MenuItem[] = [{ label: playing ? 'Pause' : 'Play', hint: 'Space', disabled: !total, onSelect: togglePlay }, { label: safeArea ? 'Hide safe area' : 'Show safe area', onSelect: () => setSafeArea((value) => !value) }, { label: 'Render smooth preview', disabled: !total || Boolean(renderJob) || isRendered, onSelect: () => { void renderPreview(); } }];
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const at: [number, number] = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
    if (total) items.push('divider', { label: 'Blur this spot', onSelect: () => addBlurBox('blur', at) }, { label: 'Pixelate this spot', onSelect: () => addBlurBox('pixelate', at) }, { label: 'Blur all faces in this clip', disabled: Boolean(faceJob), onSelect: () => { void blurFaces(); } });
    if (followTarget && ownBox() && !followJob) items.push('divider', { label: selectedBlur ? 'Follow what is under this blur' : 'Follow what is under this', onSelect: () => { void followHere('start'); } });
    setMenu({ x: event.clientX, y: event.clientY, items });
  };
  const openMediaMenu = (event: React.MouseEvent, item: Photo) => {
    event.preventDefault(); event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items: [
      { label: 'Add to timeline', onSelect: () => addMedia(item) }, { label: 'Add as overlay', onSelect: () => addOverlayMedia(item) }, { label: 'Move to folder…', onSelect: () => setFiling(item) },
      ...(usedIds.has(item.id) ? ['divider' as const, { label: 'Remove from this video', onSelect: () => { if (timeline) { change(removeMedia(timeline, item.id)); setSelectedId(null); } } }] : []),
      'divider', { label: 'Delete from Kanaa…', danger: true, onSelect: () => setDeleting(item) },
    ] });
  };
  const openItemMenu = (id: string | null, t: number, x: number, y: number) => {
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
    const items: MenuItem[] = [];
    if (clip || sound) items.push({ label: 'Split here', hint: 'S', onSelect: () => { const next = sound ? splitSound(timeline, id, t, newId()) : layer === mainLayer(timeline) ? splitClip(timeline, t, newId()) : splitSound(timeline, id, t, newId()); if (next !== timeline) change(next); } });
    const clipItem = clip ? mediaById.get(clip.media_id) : undefined;
    if (clip) items.push({ label: 'Rename clip…', onSelect: () => setRenamingClip(id) });
    if (clip) items.push({ label: clip.enabled === false ? 'Turn clip on' : 'Turn clip off', onSelect: () => change(updateClip(timeline, id, { enabled: clip.enabled === false })) });
    // The tools that study the picture (and take a while) sit together under Smart tools.
    const smart: MenuItem[] = [];
    if (clip && clipItem?.width && clipItem.height && isVideo(clip.media_id) && !layer.locked && canReframe({ width: clipItem.width, height: clipItem.height }, clip.adjust.rotation, timeline.format)) smart.push({ label: reframeJob ? `Finding who to follow… ${reframeJob.progress}%` : 'Follow the person (reframe)', disabled: Boolean(reframeJob), onSelect: () => { void reframeClip(clip.id); } });
    if (clip && layer === mainLayer(timeline) && isVideo(clip.media_id) && !layer.locked) smart.push({ label: sceneJob ? `Finding scenes… ${sceneJob.progress}%` : 'Split at scene changes', disabled: Boolean(sceneJob), onSelect: () => { void splitScenes(clip.id); } });
    if (smart.length) items.push({ label: 'Smart tools', submenu: smart });
    items.push(...clipboard.menuItems(id, t));
    if (clip && layer === mainLayer(timeline) && clip.freeze == null && mediaById.get(clip.media_id)?.media_type === 'video') items.push({ label: 'Freeze frame here', onSelect: () => freeze(t) }, { label: 'Snapshot freeze here', onSelect: () => { void snapshot(t); } });
    if (clip) {
      if (!clip.muted && hasSound(clip.media_id)) items.push({ label: 'Detach sound', onSelect: () => detach(clip) });
      items.push({ label: clip.muted ? 'Turn sound on' : 'Mute clip', onSelect: () => change(updateClip(timeline, id, { muted: !clip.muted })) });
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
    if (sound) items.push({ label: sound.muted ? 'Turn sound on' : 'Mute sound', onSelect: () => change(updateSound(timeline, id, { muted: !sound.muted })) }, { label: sound.duck ? 'Stop dipping under speech' : 'Dip under speech', onSelect: () => change(updateSound(timeline, id, { duck: !sound.duck })) });
    items.push('divider');
    const overlays = overlayLayers(timeline);
    const stack = overlays.findIndex((entry) => entry.id === layer.id);
    if (stack >= 0) items.push({ label: 'Bring forward', disabled: stack === overlays.length - 1, onSelect: () => change(reorderLayer(timeline, layer.id, 'forward')) }, { label: 'Send back', disabled: stack === 0, onSelect: () => change(reorderLayer(timeline, layer.id, 'back')) });
    items.push(lockItem, 'divider', { label: 'Delete', hint: '⌫', danger: true, onSelect: () => { change(findSound(timeline, id) ? removeSound(timeline, id) : findText(timeline, id) ? removeText(timeline, id) : findBlur(timeline, id) ? removeBlur(timeline, id) : findCaption(timeline, id) ? removeCaption(timeline, id) : removeClip(timeline, id)); setSelectedId(null); } });
    setMenu({ ...place, items });
  };
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
  /** What the AI is told about the project: shape, clips, titles and captions as text. Never the media itself. */
  const askProject = () => {
    const current = timelineRef.current;
    if (!current) return {};
    const clips = [...mainLayer(current).items].sort((a, b) => a.start - b.start);
    const format = FORMATS.find((item) => item.width === current.format.width && item.height === current.format.height);
    const theme = activeTheme(current);
    return {
      format: format ? `${format.label} (${format.ratio})` : `${current.format.width}×${current.format.height}`, duration: duration(current), clip_count: clips.length,
      clips: clips.map((clip) => ({ kind: mediaById.get(clip.media_id)?.media_type ?? 'clip', name: mediaById.get(clip.media_id)?.filename ?? '', length: clipLength(clip), start: clip.start })),
      theme: theme?.label ?? '', music: audioLayers(current).flatMap((layer) => layer.items.map((sound) => sound.name)),
      titles: textLayers(current).flatMap((layer) => layer.items.map((text) => text.text)),
      captions: captionLayers(current).flatMap((layer) => layer.items.slice(0, 30).map((caption) => captionText(caption))),
      media: media.filter((item) => !usedIds.has(item.id) && item.folder !== 'Effects').slice(0, 20).map((item) => item.filename),
    };
  };
  const actions = useRef({ chooseTheme, addTitle, addEffect, cutClipsToBeat, makeCaptions, keepClearOfFaces, buildStoryVideo, storyMedia, facts, change });
  actions.current = { chooseTheme, addTitle, addEffect, cutClipsToBeat, makeCaptions, keepClearOfFaces, buildStoryVideo, storyMedia, facts, change };
  /** Runs Ask AI's ticked edits one by one, each on the timeline as the edit before left it. */
  const runAsk = async (commands: Proposed[]): Promise<string[]> => {
    const done: string[] = [];
    const settle = () => new Promise((resolve) => setTimeout(resolve, 120)); // Lets the editor redraw with the last edit before the next.
    for (const command of commands) {
      const current = timelineRef.current;
      const act = actions.current;
      if (!current) break;
      try {
        const pure = applyPure(current, command);
        if (pure) { if (pure !== current) act.change(pure); done.push(`✓ ${describeCommand(command, askOptions)}`); }
        else if (command.name === 'set_theme') { const theme = THEMES.find((item) => item.id === command.args.theme); if (theme) { await act.chooseTheme(theme, current); done.push(`✓ ${theme.label} theme`); } }
        else if (command.name === 'add_title') { act.addTitle(TEMPLATES.find((item) => item.id === command.args.style) ?? TEMPLATES[0], command.args.at, command.args.text); done.push(`✓ Title “${command.args.text}”`); }
        else if (command.name === 'add_effect') { await act.addEffect(command.args.effect, command.args.at); done.push(`✓ ${describeCommand(command, askOptions)}`); }
        else if (command.name === 'cut_to_beat') { await act.cutClipsToBeat(); done.push('✓ Cut to the beat (see the Audio tab for details)'); }
        else if (command.name === 'add_captions') { setCaptionWords(command.args.words); act.makeCaptions(command.args.words); done.push('✓ Captions: they appear once Kanaa has listened to the speech'); }
        else if (command.name === 'keep_captions_clear') { await act.keepClearOfFaces(); done.push('✓ Captions checked against faces'); }
        else if (command.name === 'make_story') {
          const chosen = STORIES.find((item) => item.id === command.args.story);
          const pool = act.storyMedia.map((item) => act.facts(item.id)).filter((item): item is SourceFacts => Boolean(item));
          if (chosen) { await act.buildStoryVideo(chosen, fillRest(chosen, chosen.slots.map(() => null), pool)); done.push(`✓ Made as “${chosen.label}”`); }
        } else if (command.name === 'translate_captions') {
          const captions = captionLayers(current).flatMap((layer) => layer.items);
          const { lines } = await translateLines(captions.map((caption) => captionText(caption)), command.args.to);
          act.change(translateCaptions(timelineRef.current ?? current, new Map(captions.map((caption, index) => [caption.id, lines[index]]))));
          done.push(`✓ ${captions.length} captions translated`);
        }
      } catch (problem) { done.push(`✗ ${(problem as Error).message}`); }
      await settle();
    }
    return done;
  };
const followPanel = followTarget && <FollowPanel blur={Boolean(selectedBlur)} own={Boolean(selectedBlur || (selected && selectedLayer && timeline && selectedLayer !== mainLayer(timeline)))} onDraw={() => startDrawing('start')} drawing={Boolean(drawing)} job={followJob?.itemId === followTarget.id ? followJob : null} busy={Boolean(followJob)} note={followNote?.itemId === followTarget.id ? followNote.text : null}
    following={Boolean(followTarget.transform.keyframes?.x?.length)} size={followSize} onSize={setFollowSize} onStart={() => { void followHere('start'); }} onContinue={() => { void followHere('continue'); }}
    onCancel={() => { if (followJob) void cancelRenderJob(followJob.jobId); setFollowJob(null); }} onStop={() => { if (selected) updateSelected({ transform: unfollow(selected.transform, local) }); else if (selectedBlur) updateSelectedBlur({ transform: unfollow(selectedBlur.transform, blurLocal) }); else if (selectedText) updateSelectedText({ transform: unfollow(selectedText.transform ?? REST_TRANSFORM, textLocal) }); setFollowNote(null); }}/>;
  const effectNeedle = effectSearch.trim().toLocaleLowerCase();
  const matchingClipEffects = CLIP_EFFECT_PRESETS.filter((preset) => !effectNeedle || `${preset.label} ${preset.group} ${preset.about}`.toLocaleLowerCase().includes(effectNeedle));
  const matchingOverlayEffects = effects.filter((effect) => !effectNeedle || `${effect.label} ${effect.tamil} ${effect.mood} ${effect.about}`.toLocaleLowerCase().includes(effectNeedle));
  const activeClipEffects = selected ? clipEffects(selected) : [];
  return <SimpleContext.Provider value={layout.simple}><div className={`ed ${layout.simple ? 'ed-simple' : ''} `} ref={rootRef} data-ed-theme={theme} style={shellStyle} onClick={releaseClickedButton} onContextMenu={openGeneralMenu} role="application" aria-label="Video editor">
    {error && <ErrorBanner message={error} onDismiss={() => setError('')}/>}
    {heavy && !isRendered && <div className="ed-heavy" role="status"><span>This project is too heavy to play smoothly here. Your export isn't affected.</span><button className="ed-button" disabled={Boolean(renderJob)} onClick={() => { void renderPreview(); }}>Render smooth preview</button><button className="ed-icon small" aria-label="Dismiss" onClick={() => setHeavy(false)}><X size={14}/></button></div>}
    {note && <div className="ed-note" role="status">{note}<button className="ed-icon small" aria-label="Dismiss" onClick={() => setNote('')}><X size={13}/></button></div>}
    {isRendered && <div className="ed-note" role="status">Playing a rendered preview. Any edit returns to the live preview.</div>}
    <div className="ed-workspace"><div className="ed-body">
      <EditorLeftRail bindings={{ saved, closeEditor, projectName, layout, LEFT_TABS, LITE_TABS, panelOpen, leftTab, RAIL_BREAK_BEFORE, LEFT_TAB_LABELS, TAB_TIPS, setPanelOpen, setLeftTab, TAB_ICONS, updateLayout, timeline, setCreatingAIImage, setMedia, folders, media, folder, setFolder, inVideo, otherMedia, draggableAs, addMedia, openMediaMenu, usedIds, addOverlayMedia, tokens, mainClips, language, setLanguage, setWordSelection, missingWords, wordJob, transcribeClips, seek, cutWords, playhead, wordSelection, tidy, pauseLength, setPauseLength, removeFillers, setRemoveFillers, removePauses, setMenu, story, setStory, mediaById, storyMedia, facts, themeBusy, momentProgress, makeStory, chooseTheme, thumbs, themeWithMusic, setThemeWithMusic, library, changeThemeMusic, change, transitionPick, setTransitionPick, applyToSelected, setConfirmingClear, askOptions, askProject, runAsk, effectSearch, setEffectSearch, selected, activeClipEffects, matchingClipEffects, effectNeedle, effectSection, setEffectSection, clipEffectApplied, applyClipEffect, timelineRef, newId, engineRef, setSelectedId, matchingOverlayEffects, weather, setWeather, effectBusy, total, addEffect, thunderBusy, addThunder, effects, addBlurBox, faceJob, setFaceJob, blurFaces, faceNote, addTitle, myStyles, forgetStyle, captionsWaiting, makeCaptions, captionWords, setCaptionWords, clearing, keepClearOfFaces, clearNote, libraryFolder, musicSearch, musicMood, setMusicSearch, MOODS, setMusicMood, MOOD_LABELS, listening, listen, addingMusic, addLibraryTrack, addMusic, soundEffects, sfxChoice, setSfxChoice, sfxBusy, addSoundEffects, sfxNote, beatBusy, cutClipsToBeat, beatNote }}/>
      {panelOpen ? <Splitter label="Resize media panel" axis="x" value={layout.media} min={LIMITS.media[0]} max={LIMITS.media[1]} sign={1} onChange={(media) => updateLayout({ media })} onReset={() => updateLayout({ media: DEFAULT_LAYOUT.media })}/> : <div className="ed-rail"/>}
      <main className={`ed-stage ${fullScreen ? 'full' : ''}`} ref={stageRef}>
      {!fullScreen && <div className={`ed-stage-title ${saved}`} role="status" title={projectName}><b>{projectName}</b><span>{t(saved === 'saving' ? 'Saving…' : saved === 'failed' ? 'Could not save' : 'Saved')}</span></div>}
    {timeline && !firstRunClosed && !fullScreen && (() => {
      const steps = [
        { done: total > 0, label: 'Add your clips or photos', go: () => { setLeftTab('media'); setPanelOpen(true); }, guide: 'getting-started' },
        { done: timeline.layers.some((layer) => layer.kind === 'text' && layer.items.length > 0), label: 'Add a title', go: () => { setLeftTab('text'); setPanelOpen(true); }, guide: 'titles' },
        { done: exportedOnce, label: 'Export your video', go: () => { if (total) { engineRef.current?.pause(); setExporting(true); } }, guide: 'getting-started' },
      ];
      if (steps.every((step) => step.done)) return null;
      const close = () => { setFirstRunClosed(true); try { localStorage.setItem('kanaa-first-run-closed', '1'); } catch { /* ignore */ } };
      return <aside className="ed-first-run" aria-label={t('First steps')}>
        <div className="ed-first-run-head"><b>{t('First steps')}</b><button className="ed-icon small" aria-label={t('Close')} onClick={close}><X size={12}/></button></div>
        <ol>{steps.map((step) => <li key={step.label} className={step.done ? 'done' : ''}><span className="ed-first-run-tick">{step.done ? <Check size={11}/> : null}</span>
          <button className="ed-link" disabled={step.done} onClick={step.go}>{t(step.label)}</button>
          <button className="ed-icon small" aria-label={t('How')} title={t('How')} onClick={() => openGuide(ARTICLES.some((article) => article.id === step.guide) ? step.guide : 'getting-started')}><CircleHelp size={11}/></button></li>)}</ol>
        <p>{t('Press ⌘K any time to find an action.')}</p>
      </aside>;
    })()}
        <div className="ed-frame" style={{ aspectRatio: `${ratio}`, '--ar': ratio } as React.CSSProperties}>
          <canvas ref={canvasRef} aria-label="Preview" onContextMenu={openPreviewMenu} onPointerDown={previewDown} onPointerMove={previewMove} onPointerUp={() => { dragPreview.current = null; }} onDoubleClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const hit = titleAt((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height); if (hit) { engineRef.current?.pause(); setPickedInPreview(hit.id); setSelectedId(hit.id); setEditingTitle(hit.id); } }} className={(placing && !placing.busy) || pickingKey ? 'picking' : selected && selected.enabled !== false && !selected.frame_locked ? 'movable' : ''}/>
          {selected && selected.enabled !== false && !selectedLayer?.locked && !selected.frame_locked && !pickingKey && !shaping && !drawing && timeline && now >= selected.start && now < selected.start + clipLength(selected) && (() => { const source = sourceFor(selected.media_id); return source && <ResizeBox clip={selected} source={source} format={timeline.format} local={local} onChange={(transform, group) => updateSelected({ transform }, group)}/>; })()}
          {selected && selected.enabled !== false && !selectedLayer?.locked && !selected.frame_locked && <MotionPath transform={selected.transform} length={clipLength(selected)} onChange={(transform, group) => updateSelected({ transform }, group)} onSeek={(t) => seek(selected.start + t)}/>}
          {selectedText && !selectedLayer?.locked && !isFollowed(selectedText.transform ?? REST_TRANSFORM) && <MotionPath transform={selectedText.transform ?? REST_TRANSFORM} length={selectedText.length} onChange={(transform, group) => updateSelectedText({ transform }, group)} onSeek={(t) => seek(selectedText.start + t)}/>}
          {selectedText && pickedInPreview === selectedText.id && !selectedLayer?.locked && now >= selectedText.start && now < selectedText.start + selectedText.length && (() => {
            const rect = titleRect(selectedText);
            if (!rect) return null;
            const box = { left: `${rect.left * 100}%`, top: `${rect.top * 100}%`, width: `${(rect.right - rect.left) * 100}%`, height: `${(rect.bottom - rect.top) * 100}%` };
            return <>
              {editingTitle === selectedText.id
                ? <TitleEditBox key={selectedText.id} text={selectedText} style={box} onDone={(words) => { setEditingTitle(null); if (words !== null && words.trim() && words !== selectedText.text) updateSelectedText({ text: words }, `text-${selectedText.id}`); }}/>
                : <div className="ed-title-box" style={box} onDoubleClick={() => { engineRef.current?.pause(); setEditingTitle(selectedText.id); }} title={t('Double-click to type')}/>}
              <TitleToolbar text={selectedText} top={rect.top} left={(rect.left + rect.right) / 2} onChange={(changes, group) => updateSelectedText(changes, group)} onEdit={() => { engineRef.current?.pause(); setEditingTitle(selectedText.id); }}/>
            </>;
          })()}
          {selectedBlur && !selectedLayer?.locked && <MotionPath transform={selectedBlur.transform} length={selectedBlur.length} onChange={(transform, group) => updateSelectedBlur({ transform }, group)} onSeek={(t) => seek(selectedBlur.start + t)}/>}
          {followTarget && !selectedLayer?.locked && !selected?.frame_locked && !followJob && !drawing && !shaping && !pickingKey && now >= followTarget.start - ON_ITEM && now < followTarget.start + followTarget.length && !isFollowed(followTarget.transform) && (() => {
            const box = ownBox();
            if (!box) return null;
            return <button className="ed-follow-chip" style={{ left: `clamp(48px, ${box[0] * 100}%, calc(100% - 48px))`, top: `clamp(20px, ${(box[1] + box[3] / 2) * 100}%, calc(100% - 20px))` }} onPointerDown={(event) => event.stopPropagation()} onClick={() => { void followHere('start'); }} title="Kanaa finds what is under it and keeps it covered as it moves"><Crosshair size={13}/>Follow</button>;
          })()}
          {(renderJob || reframeJob || sceneJob || faceJob || followJob || faceNote || (followNote && followTarget?.id === followNote.itemId)) && <div className="ed-status" role="status">
            {renderJob ? <><span>Rendering preview… {renderJob.progress}%</span><i className="ed-status-bar"><b style={{ width: `${renderJob.progress}%` }}/></i><button onClick={() => { void cancelRenderJob(renderJob.id); setRenderJob(null); setHeavy(false); }}>Cancel</button></>
            : reframeJob ? <><span>Finding who to follow… {reframeJob.progress}%</span><i className="ed-status-bar"><b style={{ width: `${reframeJob.progress}%` }}/></i><button onClick={() => { void cancelRenderJob(reframeJob.jobId); setReframeJob(null); }}>Cancel</button></>
            : sceneJob ? <><span>Finding scene changes… {sceneJob.progress}%</span><i className="ed-status-bar"><b style={{ width: `${sceneJob.progress}%` }}/></i><button onClick={() => { void cancelRenderJob(sceneJob.jobId); setSceneJob(null); }}>Cancel</button></>
            : faceJob ? <><span>Finding faces… {faceJob.progress}%</span><i className="ed-status-bar"><b style={{ width: `${faceJob.progress}%` }}/></i><button onClick={() => { void cancelRenderJob(faceJob.jobId); setFaceJob(null); }}>Cancel</button></>
              : followJob ? <><span>{followJob.queued ? 'Waiting for the job ahead of it to finish…' : `Following… ${followJob.progress}%`}</span><i className="ed-status-bar"><b style={{ width: `${followJob.progress}%` }}/></i><button onClick={() => { void cancelRenderJob(followJob.jobId); setFollowJob(null); }}>Cancel</button></>
              : <><span>{faceNote || followNote?.text}</span><button aria-label="Close" onClick={() => { setFaceNote(''); setFollowNote(null); }}>×</button></>}
          </div>}
          {pickingKey && <div className="ed-pick-note" role="status">Click the colour to remove</div>}
          {shaping && <ShapeDrawing mode={shaping.mode} points={shaping.points} onPoints={(points) => setShaping({ ...shaping, points })} onDone={finishShape} onCancel={() => setShaping(null)}/>}
          {drawing && <div className="ed-draw" aria-label={drawing.onBox ? "Drag a box around the light" : "Drag a box around what to follow"} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const at = frameAt(event); drawStart.current = at; setDrawing({ ...drawing, from: at, to: at }); }}
            onPointerMove={(event) => { const from = drawStart.current; const to = frameAt(event); if (from) setDrawing((state) => state && { ...state, from, to }); }} onPointerUp={finishDrawing}>
            <div className="ed-pick-note" role="status">Drag a box around what to follow. Esc cancels.</div>
            {(() => { const box = drawnBox(drawing); return box && <i style={{ left: `${(box[0] - box[2] / 2) * 100}%`, top: `${(box[1] - box[3] / 2) * 100}%`, width: `${box[2] * 100}%`, height: `${box[3] * 100}%` }}/>; })()}
          </div>}
          {safeArea && <div className="ed-safe" aria-hidden="true"><span>Keep titles and faces inside this box</span></div>}
          {isEmpty && !choosingFormat && <div className="ed-empty"><strong>Add a clip to start</strong><span>Pick videos or photos in the Media panel</span></div>}
        </div>
        <div className="ed-transport">
          <span className="ed-clock"><span ref={clockRef}>0:00.00</span> / {timecode(total)}</span>
          <button className="ed-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button>
          <span className="ed-transport-end">
            <button className="ed-icon ed-safe-toggle" aria-pressed={fullScreen} onClick={toggleFullScreen} title={fullScreen ? 'Leave full screen (F or Esc)' : 'Full screen preview (F)'} aria-label={fullScreen ? 'Leave full screen' : 'Full screen preview'}>{fullScreen ? <Shrink size={15}/> : <Expand size={15}/>}{fullScreen ? 'Exit' : 'Full screen'}</button>
          </span>
        </div>
      </main>
      {inspectorOpen ? <Splitter label="Resize settings panel" axis="x" value={layout.inspector} min={LIMITS.inspector[0]} max={LIMITS.inspector[1]} sign={-1} onChange={(inspector) => updateLayout({ inspector })} onReset={() => updateLayout({ inspector: DEFAULT_LAYOUT.inspector })}/> : <div className="ed-rail"/>}
      <HelpContext.Provider value={openGuide}>
      <RailContext.Provider value={{ folded: !inspectorOpen, setOpen: (open) => updateLayout({ inspectorOpen: open }), tools: <div className="ed-rail-tools" role="group" aria-label="Edit and export">
            <JobTray/>
            <button onClick={() => setShowingHelp(true)} aria-label={t('Guide and shortcuts')} data-tip={`${t('Guide and shortcuts')} (?)`}><CircleHelp size={17}/></button>
            <TopSettings appearance={themeChoice} onAppearance={(choice) => { if (setTheme) setTheme(choice); else nextTheme(); }} simple={layout.simple} onSimple={(simple) => updateLayout({ simple })}
              format={timeline ? `${timeline.format.width} × ${timeline.format.height} · ${timeline.format.fps} fps` : 'Format'} onProject={() => { setSelectedId(null); updateLayout({ inspectorOpen: true }); }}/>
            <button className="ed-rail-export" disabled={!total} onClick={() => { engineRef.current?.pause(); setExporting(true); try { localStorage.setItem('kanaa-exported-once', '1'); } catch { /* ignore */ } setExportedOnce(true); }} aria-label={t('Export')} data-tip={t('Export')}><Download size={17}/></button>
          </div> }}>
      <aside className="ed-inspector" aria-label="Clip settings"><EditorContext.Provider value={editorShared}><LayerModeContext.Provider value={Boolean(layerSettings)}>{inspectorOpen && <>{selectedIdentity && <div className="ed-selection"><span>{t(selectedIdentity.kind)}</span>{selected && !settingsLayer ? <input key={selected.id} className="ed-selection-name" aria-label="Clip name" title="What this clip is for; shown on it in the timeline" maxLength={80} defaultValue={selected.name ?? ''} placeholder={mediaById.get(selected.media_id)?.filename ?? 'Clip name'}
        onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter' || event.key === 'Escape') { if (event.key === 'Escape') event.currentTarget.value = selected.name ?? ''; event.currentTarget.blur(); } }}
        onBlur={(event) => { const name = event.currentTarget.value.trim() || null; if ((selected.name ?? null) !== name) change(updateClip(timeline!, selected.id, { name })); }}/> : <strong title={selectedIdentity.name}>{selectedIdentity.name}</strong>}</div>}{moreIds.size > 0 && !layerSettings && <div className="ed-scope ed-multi"><b>{t('{count} items picked', { count: moreIds.size + 1 })}</b><span>{t('Changes apply to all of them (not their words or timing).')}</span>{(() => { const mixed = mixedSettings(); return mixed.length > 0 && <span className="ed-multi-mixed">{t('Mixed:')} {mixed.map((key) => t(STYLE_NAMES[key] ?? key.replace(/_/g, ' '))).join(', ')} — {t('the panel shows the first; a change makes them all the same.')}</span>; })()}<button className="ed-link" onClick={() => setMoreIds(new Set())}>{t('Just this one')}</button></div>}{!selectedLayer?.locked && (selectedText ? scopeBar(selectedText.id, 'title') : selected ? scopeBar(selected.id, 'clip') : null)}</>}{selectedLayer?.locked ? <div className="ed-hint"><h2>Layer locked</h2><p>Unlock this layer on the timeline to change it.</p></div>
        : selectedCaption ? <CaptionInspector caption={selectedCaption.caption} layer={selectedCaption.layer} timing={textTiming(selectedCaption.caption)}
          onText={(text) => change(updateCaption(timeline!, selectedCaption.caption.id, { words: retypeCaption(selectedCaption.caption, text) }), `caption-${selectedCaption.caption.id}`)}
          onLook={(changes, group) => change(updateCaptionLook(timeline!, selectedCaption.layer.id, changes), group)} onRemoveAll={() => { change(setCaptions(timeline!, [], '')); setSelectedId(null); }}/>
        : selectedBlur ? <BlurInspector blur={selectedBlur} timing={textTiming(selectedBlur)} local={blurLocal} onChange={updateSelectedBlur} onSeekLocal={(t) => seek(selectedBlur.start + t)} onPause={pauseEngine} follow={followPanel}/>
        : selectedText ? <TextInspector text={selectedText} onKaraoke={setKaraoke} onDecorate={decorateTitle} decorating={effectBusy?.id === 'bubbles' || effectBusy?.id === 'shine'} groundGap={groundRiseGap(timeline!, selectedText.id)} onGroundGap={(depth_gap) => change(setGroundRiseGap(timeline!, selectedText.id, depth_gap), `ground-gap-${selectedText.id}`)} onSaveStyle={() => saveStyle(selectedText)} onBehindShape={(reveal, mode) => { engineRef.current?.pause(); setShaping({ textId: selectedText.id, mode, points: drawnPoints(timeline!, selectedText.id, mode) ?? [], reveal }); }} cover={(() => { const index = timeline ? timeline.layers.findIndex((layer) => layer.kind === 'text' && (layer.items as TextItem[]).some((item) => item.id === selectedText.id)) : -1; const next = index >= 0 ? timeline!.layers[index + 1] : null; if (next?.kind === 'video') { if (next.name === 'Person') return 'people' as const; if (next.name === 'Object') return 'object' as const; if (next.name === 'Land') return 'land' as const; if (next.name === 'In front') return 'drawn' as const; } return 'front' as const; })()} shapingMode={shaping && shaping.textId === selectedText.id ? shaping.mode : null} onCinemaClear={() => change(removeCinemaReveal(timeline!, selectedText.id), `cinema-clear-${selectedText.id}`)} onCinemaFront={(reveal) => { const next = cinemaRevealFront(timeline!, selectedText.id, reveal); change(next, `cinema-front-${selectedText.id}`); setSelectedId(selectedText.id); showEnter(selectedText.start, reveal === 'push' ? 1.4 : 1.2); }} onCinema={(reveal, what) => { const ids: [string, string] = [newId(), newId()]; // People or an object in front, and keeping clear of them, pull opposite ways: the title would dodge every frame.
            const base = selectedText.keep_clear && what !== 'land' ? updateText(timeline!, selectedText.id, removeKeepClear(selectedText)) : timeline!; if (base !== timeline) setKeepClearNote(null); void (async () => { const title = selectedText; let ready = base; const under = clipUnderTitle(base, title); if (under && mediaById.get(under.media_id)?.media_type === 'image') { setNote('Preparing the picture so people can be found in it…'); try { const made = await asVideo(base, under); setMedia((current) => (current.some((each) => each.id === made.video.id) ? current : [made.video, ...current])); ready = made.timeline; } catch (problem) { setError((problem as Error).message); return; } } const next = cinemaReveal(ready, title.id, reveal, what, ids); if (next === ready) setError(ready.layers.filter((layer) => layer.kind === 'video').length >= MAX_VIDEO_LAYERS ? `This song already uses ${MAX_VIDEO_LAYERS} video layers, the most it can have. Delete or merge one (an unused effects or overlay layer), then try again.` : 'Put the title over a picture or video clip on the main track first.'); else { change(next, `cinema-${title.id}`); setSelectedId(title.id); showEnter(title.start, reveal === 'push' ? 1.4 : 1.2); } })(); }} placing={placing?.textId === selectedText.id ? (placing.busy ? 'busy' : 'waiting') : null} onPlace={() => setPlacing((now) => now?.textId === selectedText.id ? null : { textId: selectedText.id, busy: false })} onSurface={(kind) => { void placeInScene(selectedText, null, kind); }} pinning={pinProgress} onPin={(on) => { void pinTitle(selectedText, on); }} staying={stayProgress} onStayCover={(banner) => { const next = banner ? setGroundRiseGap(putBehindPerson(timeline!, selectedText.id, [newId(), newId()]), selectedText.id, TITLE_SPACE.close) : cinemaRevealFront(timeline!, selectedText.id, 'pass'); change(next, `stay-cover-${selectedText.id}`); setSelectedId(selectedText.id); }} stayNote={stayNote?.textId === selectedText.id ? stayNote.text : null} onStay={() => { void stayWithPeople(selectedText); }} onStopStay={() => { change(updateText(timeline!, selectedText.id, removeStay(selectedText)), `stay-${selectedText.id}`); setStayNote(null); }} clearing={clearProgress} clearUnder={timeline ? clipUnderTitle(timeline, selectedText) : null} clearNote={keepClearNote?.textId === selectedText.id ? keepClearNote.text : null} onKeepClear={(settings) => { void keepTitleClear(selectedText, settings); }} onRemoveClear={() => { change(updateText(timeline!, selectedText.id, removeKeepClear(selectedText)), `keep-clear-${selectedText.id}`); setKeepClearNote(null); }} timing={textTiming(selectedText)} follow={followPanel} onChange={updateSelectedText} onEnter={() => showEnter(selectedText.start, selectedText.enter?.duration ?? 0.5)} onExit={() => showExit(selectedText.start + selectedText.length, selectedText.exit?.duration ?? 0.5)}/>
        : selectedSound ? <SoundInspector onLoop={timeline && needsLoop(timeline, selectedSound.sound) && !selectedSound.layer.locked ? () => { void loopSelectedSound(selectedSound.sound.id); } : null} looping={looping} sound={selectedSound.sound} timing={soundTiming(selectedSound.sound)} layer={selectedSound.layer} onChange={updateSelectedSound} onLayer={(changes) => change(updateLayer(timeline!, selectedSound.layer.id, changes))}
        stems={stems} job={stemJob?.soundId === selectedSound.sound.id ? stemJob : null} busy={Boolean(stemJob)} onSeparate={(choice) => { void separate(choice); }} onCancelStems={() => { if (stemJob) void cancelRenderJob(stemJob.jobId); }}/>
        : selected ? <Inspector onReframe={(() => { const item = mediaById.get(selected.media_id); return item?.media_type === 'video' && item.width && item.height && timeline && canReframe({ width: item.width, height: item.height }, selected.adjust.rotation, timeline.format) ? () => { void reframeClip(selected.id); } : null; })()} reframing={Boolean(reframeJob)} onMove={(move) => { void moveSelected(move); }} backgrounds={media.filter((item) => item.id !== selected.media_id && (item.media_type === 'video' || item.media_type === 'image'))} onBackground={(item) => newBackground(selected, item)} logos={media.filter((item) => isBrandImage(item) && item.id !== selected.media_id)} clipBrandMarks={brandsOnClip(timeline!, selected).map((mark) => ({ id: mark.id, name: mediaById.get(mark.media_id)?.filename ?? `Media ${mark.media_id}` }))} onClipBrand={(item) => change(brandOnClip(timeline!, selected, { media_id: item.id, width: item.width || 800, height: item.height || 800 }, 'top-right', BRAND_SIZES[1].scale, newId()), 'brand')} onRemoveClipBrand={(id) => change(removeClipBrand(timeline!, id), 'brand')} clip={selected} source={sourceFor(selected.media_id)} onChange={updateSelected} canDetach={!selected.muted && hasSound(selected.media_id)} onDetach={() => detach()}
          follow={followPanel} isMain={selectedLayer === mainLayer(timeline!)} copyReady={Boolean(preparedWant(selected, timeline!.format.fps) && preparedReady[preparedKey(selected.media_id, ...preparedWant(selected, timeline!.format.fps)!)])} onLayout={splitScreen} picking={pickingKey} onPick={startPicking} timing={clipTiming(selected)} overlay={selectedLayer?.kind === 'video' && !selectedLayer.magnetic && selectedLayer !== mainLayer(timeline!) ? selectedLayer : null} onLayer={(changes) => change(updateLayer(timeline!, selectedLayer!.id, changes))} closesWithTransition={Boolean(clipsInOrder[clipIndex + 1]?.transition_in)}
          onShowEnter={() => showEnter(selected.start, selected.enter?.duration ?? 0.5)} onShowExit={() => showExit(selected.start + clipLength(selected), selected.exit?.duration ?? 0.5)}/> : timeline ? <ProjectInspector introBusy={introProgress} onBrandIntro={(item, tamil, english) => { void addBrandIntro(item, tamil, english); }} clipFormat={firstClipFormat && { ...firstClipFormat, fps: timeline.format.fps }} logos={media.filter(isBrandImage)} logo={(() => { const item = brandClip(timeline); return item ? media.find((entry) => entry.id === item.media_id) ?? null : null; })()} onBrand={(item) => change(applyBrand(timeline, { media_id: item.id, width: item.width || 800, height: item.height || 800 }, 'top-right', BRAND_SIZES[1].scale, newId()), 'brand')} onImported={(items) => {
            // A logo imported here is a brand picture: it goes into the Brand folder.
            const images = items.filter((item) => item.media_type === 'image');
            const filed = items.map((item) => item.media_type === 'image' ? { ...item, folder: BRAND_FOLDER } : item);
            setMedia((current) => [...filed, ...current]);
            if (images.length) void moveMediaToFolder(images.map((item) => item.id), BRAND_FOLDER).catch(() => {});
          }} onRemoveBrand={() => change(removeBrand(timeline), 'brand')} onThemes={() => { setLeftTab('themes'); setPanelOpen(true); }}/>
          : <div className="ed-hint"><h2>Project settings</h2><p>Loading your project…</p></div>}</LayerModeContext.Provider></EditorContext.Provider></aside>
      </RailContext.Provider>
      </HelpContext.Provider>
    </div>
    <Splitter label="Resize timeline" axis="y" value={Math.min(layout.timeline, Math.round(window.innerHeight * 0.55))} min={LIMITS.timeline[0]} max={Math.round(window.innerHeight * 0.55)} sign={-1} onChange={(height) => updateLayout({ timeline: height })} onReset={() => updateLayout({ timeline: DEFAULT_LAYOUT.timeline })}/>
    <div className="ed-lower"><div className="ed-tools">
      <span className="ed-tool-group" role="group" aria-label="Edit tools">
        <button className="ed-button ed-icon-button" onClick={() => dispatch({ type: 'undo' })} disabled={!history.past.length} aria-label={t('Undo')} title={`${t('Undo')} (⌘Z)`}><Undo2 size={15}/></button>
        <button className="ed-button ed-icon-button" onClick={() => dispatch({ type: 'redo' })} disabled={!history.future.length} aria-label={t('Redo')} title={`${t('Redo')} (⇧⌘Z)`}><Redo2 size={15}/></button>
        {clipboard.styleCopy && <span className="ed-brush"><button className="ed-button ed-icon-button on" onClick={() => clipboard.pasteStyleOnto()} disabled={!selectedId} aria-label={t('Paste style')} title={`${t('Paste style')} (⌥⌘V)`}><Paintbrush size={15}/></button><button className="ed-brush-off" onClick={clipboard.clearStyle} aria-label={t('Stop pasting style')} title={t('Stop pasting style')}><Close size={11}/></button></span>}
        <span className="ed-tool-sep" aria-hidden="true"/>
        <button className="ed-button" onClick={split} disabled={!total} title="Split at playhead (S)"><Scissors size={15}/>Split</button>
        <button className="ed-button" onClick={() => freeze()} disabled={!total || Boolean(timeline && mainLayer(timeline).locked)} title="Hold the frame at the playhead for 2 seconds"><Snowflake size={15}/>Freeze</button>
        <button className="ed-button" onClick={() => { void snapshot(); }} disabled={!total || Boolean(timeline && mainLayer(timeline).locked)} title="Flash, shutter sound and a two-second printed-photo freeze"><Camera size={15}/>Snapshot</button>
        <button className="ed-button" onClick={removeSelected} disabled={(!selected && !selectedSound && !selectedText && !selectedBlur && !selectedCaption) || Boolean(selectedLayer?.locked)} title="Delete (⌫)"><Trash2 size={15}/>Delete</button>
      </span>
      <div className="ed-spacer"/>
      <span className="ed-tool-group" role="group" aria-label="Timeline view">
        <button className="ed-button" disabled={!total} onClick={fitZoom} title="Show the whole video on the timeline">Fit</button>
        <button className={`ed-button ${snapping ? 'on' : ''}`} aria-pressed={snapping} onClick={() => setSnapping(!snapping)} title={`${t(snapping ? 'Snapping on: edges lock to clips, the playhead and beats' : 'Snapping off')} (N)`}><Magnet size={14}/></button>
        <button className="ed-icon" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value / ZOOM_STEP))}><Minus size={15}/></button>
        <input className="ed-zoom" type="range" min={Math.log(ZOOM_MIN)} max={Math.log(ZOOM_MAX)} step={0.01} value={Math.log(zoom)} onChange={(event) => setZoom(Math.exp(Number(event.target.value)))} aria-label={t('Timeline zoom')} title={t('Timeline zoom')}/>
        <button className="ed-icon" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value * ZOOM_STEP))}><Plus size={15}/></button>
        <button className="ed-button" aria-label="View" onClick={openViewMenu}><MoreHorizontal size={15}/>{t('View')}</button>
      </span>
    </div>
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
  </div></SimpleContext.Provider>;
}
