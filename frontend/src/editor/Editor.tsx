import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Crop, Palette, WandSparkles, Move, Mic, Expand, Shrink, ArrowLeft, AudioLines, Bookmark, Captions, Car, Check, Mountain, PenTool, Users, Crosshair, EyeOff, ScanFace, Snowflake, Pipette, CircleHelp, Layers, Monitor, Moon, Sun, Type, Download, FlipHorizontal, FlipVertical, LoaderCircle, Maximize, Minimize, Minus, MoreHorizontal, Music, Pause, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Play, Plus, Redo2, RotateCcw, RotateCw, Scissors, Trash2, Undo2, Volume2, VolumeX, X } from 'lucide-react';
import { cancelRenderJob, clipFilmstripUrl, clipProxyUrl, exportProjectTimeline, fetchTextImage, fetchCaptionImage, fetchShapeMask, requestCleanVoice, cleanVoiceUrl, requestPrepared, preparedProxyUrl, getMusicLibrary, musicListenUrl, takeLibraryTrack, type LibraryTrack, type Mood, requestInstances, instancesPictureUrl, type FoundOne, startFaces, startTracking, getWords, startWords, getClipAssets, previewRenderUrl, startPreviewRender, getClipPeaks, getJobStatus, getProjectTimeline, getSongPeaks, getStemsStatus, getVideoProject, listPhotos, photoImageUrl, photoThumbUrl, photoVideoUrl, saveVideoProject, songUrl, startStems, uploadVideoAudio, type Stems } from '../api/client';
import ImportArea from '../components/ImportArea';
import CoverArtGenerator from '../components/CoverArtGenerator';
import { DeleteMediaDialog, FolderDialog, folderNames } from '../components/MediaDialogs';
import type { Photo } from '../types/photo';
import type { Animation, LookName, Preset, Transition, TransitionKind } from '../timeline/animation';
import { commit, redo, startHistory, undo, type History } from '../timeline/history';
import { barShare, CINEMATIC, type Finish, groundShape, putBehindShape, putBehindObject, replaceBackground, cutoutToken, focusAt, focusLocal, type CutoutPick, type BlurAmount, type ShapeMask, captionLayers, captionStates, captionText, findCaption, removeCaption, setCaptions, updateCaption, updateCaptionLook, type Caption, type CaptionLayer, type CaptionLook, freezeFrame, putBehindPerson, trimAtPlayhead, REST_TRANSFORM, addBlur, findBlur, removeBlur, updateBlur, BLUR_SECONDS, DEFAULT_BLUR, type BlurBox, cornerPlacement, moveItem, setSpeed, trimSound, trimText, MAX_PHOTO_SECONDS, removeMedia, duplicateItem, isLocked, layerOf, reorderLayer, overlayLayers, addOverlay, addSound, addText, audioLayers, clipLength, detachAudio, duration, exportFormat, fillScale, findClip, findSound, findText, FORMATS, insertClip, mainLayer, MUSIC_VOLUME, newClip, OVERLAY_SCALE, normalizeTimeline, removeClip, removeSound, removeText, soundLength, splitClip, splitSound, timecode, trimClip, textLayers, updateClip, updateLayer, updateSound, updateText, type Adjust, type AudioLayer, type BlendMode, type Corner, type VideoLayer, type Clip, type Format, type Sound, type SourceFacts, type TextItem, type Timeline } from '../timeline/model';
import { PlaybackEngine, type PlaybackSource } from './playback';
import { ContextMenu, isEditable, type MenuItem, type MenuState } from './ContextMenu';
import { TimeField, ValueSlider, type TimeFieldProps } from './controls';
import { buildTokens, cutTokens, tidyUp, type Word } from '../timeline/words';
import { WordsPanel } from './Words';
import { DEFAULT_CHROMA } from '../timeline/chroma';
import { DEFAULT_LAYOUT, Group, HelpContext, LIMITS, More, Panel, Splitter, useEditorLayout, type ThemeChoice } from './layout';
import { Guide } from './Guide';
import { MotionPanel, MotionPath } from './Keyframes';
import TimelineView, { type ClipVisuals } from './TimelineView';
import { valueAt } from '../timeline/evaluate';
import { writeValue } from '../timeline/keyframes';
import { applyMove, slotPlacement, type MovePreset } from '../timeline/presets';
import { activeTheme, addThemeMusic, applyTheme, openingWords, pickTrack, removeTheme, removeThemeMusic, themeMusic, THEMES, type Theme as VideoTheme } from '../timeline/themes';
import { buildStory, fillRest, STORIES, storySeconds, type Story } from '../timeline/stories';
import { ENGLISH_FONTS, lookOf, MAX_SAVED, savedStyles, saveStyles, TAMIL_FONTS, TEMPLATES, type FontChoice, type Template } from '../timeline/templates';
import { buildCaptions, retypeCaption, DEFAULT_CAPTION_OPTIONS } from '../timeline/captions';
import { localAt, RAMPS, rampSpeed, sourceAt, type RampName, type RampPoint } from '../timeline/ramp';
import { blurForFace, boxInSource, followPath, unfollow, videoAt, videoUnder, type TrackPoint } from '../timeline/tracking';
import { ProjectSaveQueue, type SaveState } from './project-save';
import { exportSpec } from './export-spec';
import { nextTabIndex } from './tab-navigation';

type Props = { projectId: number; projectName: string; photo: Photo; onClose: () => void; onOpenOutput: (id: number) => void; theme: string; themeChoice: ThemeChoice; nextTheme: () => void };
type Action = { type: 'load'; timeline: Timeline } | { type: 'change'; timeline: Timeline; group?: string | null } | { type: 'undo' } | { type: 'redo' };
const EMPTY = startHistory<Timeline | null>(null);
const ASSET_POLL_MS = 2000;
const LEFT_TABS = ['media', 'templates', 'themes', 'text', 'audio', 'words'] as const;
const LEFT_TAB_LABELS: Record<(typeof LEFT_TABS)[number], string> = { media: 'Media', templates: 'Templates', themes: 'Themes', text: 'Text', audio: 'Audio', words: 'Words' };
const QUALITIES = [{ id: 720, label: '720p', note: 'Smallest file' }, { id: 1080, label: '1080p', note: 'Best for most posts' }, { id: 2160, label: '4K', note: 'Slower, larger file' }];
const ESTIMATED_MB_PER_SECOND_1080 = 1.1;
const ZOOM_MIN = 8; const ZOOM_MAX = 300; const ZOOM_STEP = 1.4;
const FAST_RATES = [1, 2, 4];
const MAX_FADE_SECONDS = 5;
const MIN_MUSIC_SECONDS = 1;
const PREVIEW_SHORT_SIDE = 540;
const RENDERED_ID = -1;
const BLENDS: { id: BlendMode; label: string }[] = [{ id: 'normal', label: 'Normal' }, { id: 'multiply', label: 'Multiply' }, { id: 'screen', label: 'Screen' }, { id: 'overlay', label: 'Overlay' }, { id: 'darken', label: 'Darken' }, { id: 'lighten', label: 'Lighten' }];
const CORNERS: { id: Corner; label: string }[] = [{ id: 'top-left', label: 'Top left' }, { id: 'top-right', label: 'Top right' }, { id: 'bottom-left', label: 'Bottom left' }, { id: 'bottom-right', label: 'Bottom right' }];
const FIT_MARGIN = 48;
const TEXT_SECONDS = 3;
const TEXT_TYPE_DELAY_MS = 250;
const CAPTION_FETCHES = 3;
const PRESETS: { id: Preset; label: string }[] = [{ id: 'fade', label: 'Fade' }, { id: 'slide-up', label: 'Slide up' }, { id: 'slide-down', label: 'Slide down' }, { id: 'slide-left', label: 'Slide left' }, { id: 'slide-right', label: 'Slide right' }, { id: 'zoom', label: 'Zoom' }, { id: 'pop', label: 'Pop' }, { id: 'blur', label: 'Blur' }, { id: 'bounce', label: 'Bounce' }];
const TRANSITIONS: { id: TransitionKind; label: string }[] = [{ id: 'crossfade', label: 'Crossfade' }, { id: 'wipe', label: 'Wipe' }, { id: 'slide', label: 'Slide' }, { id: 'zoom', label: 'Zoom' }, { id: 'whip', label: 'Whip' }, { id: 'flash', label: 'Flash' }, { id: 'dip', label: 'Dip to black' }];
const MOVES: { id: MovePreset; label: string; tip: string }[] = [{ id: 'push-in', label: 'Push in', tip: 'Slowly moves closer over the whole clip' }, { id: 'pull-out', label: 'Pull out', tip: 'Slowly moves away over the whole clip' },
  { id: 'punch-in', label: 'Punch in here', tip: 'Jumps closer at the playhead, for a word or a beat' }, { id: 'shake', label: 'Shake here', tip: 'A short camera shake at the playhead' }];
const FREEZE_SECONDS = 2;
const THUMB_FORMAT = { width: 480, height: 270, fps: 30 };
const SHAPE_FEATHER = 0.004;
const SHAPE_CLOSE = 0.03; // Clicking this near the first point closes an outline.
/** Which cleaned copy a clip or sound plays: one per song, or per video. */
const voiceKey = (item: { media_id?: number; asset_id?: string }) => (item.asset_id ? `a:${item.asset_id}` : `m:${item.media_id}`);
/** Which prepared copy a clip needs: [steadied, reversed], or null for the original. A frozen frame is never reversed. */
const preparedWant = (clip: Clip): [boolean, boolean, string] | null => {
  const steady = Boolean(clip.stabilise); const backwards = Boolean(clip.reverse) && clip.freeze == null; const cutout = cutoutToken(clip);
  return steady || backwards || cutout ? [steady, backwards, cutout] : null;
};
const preparedKey = (id: number, steady: boolean, backwards: boolean, cutout: string) => `${id}:${steady ? 1 : 0}:${backwards ? 1 : 0}:${cutout}`;
const MOODS: Mood[] = ['romantic', 'happy', 'birthday', 'calm', 'energetic', 'cinematic', 'inspiring', 'songs'];
const MOOD_LABELS: Record<Mood, string> = { romantic: 'Romantic', happy: 'Happy', birthday: 'Birthday', calm: 'Calm', energetic: 'Energetic', cinematic: 'Cinematic', inspiring: 'Inspiring', songs: 'Songs' };
const PULL_SPEEDS: { id: string; label: string }[] = [{ id: '0.4', label: 'Quick' }, { id: '1', label: 'Smooth' }, { id: '2', label: 'Slow' }];
const BLUR_AMOUNTS: { id: BlurAmount; label: string }[] = [{ id: 'subtle', label: 'Subtle' }, { id: 'medium', label: 'Medium' }, { id: 'strong', label: 'Strong' }];
const LOOK_NAMES: { id: LookName; label: string }[] = [{ id: 'none', label: 'Original' }, { id: 'warm', label: 'Warm' }, { id: 'cool', label: 'Cool' }, { id: 'vivid', label: 'Vivid' }, { id: 'film', label: 'Film' }, { id: 'mono', label: 'Mono' }];
type StemChoice = 'music' | 'vocals' | 'both';
type StemJob = { soundId: string; jobId: string; choice: StemChoice; progress: number };
type Box = [number, number, number, number];
/** `drawnAt` and `from` are the item's own seconds. A blur box drawn fresh is first placed on the drawn box. */
type FollowJob = { itemId: string; underId: string; jobId: string; progress: number; drawnAt: number; from: number; size: boolean; place: Box | null };
const MIN_DRAWN_BOX = 0.015;

function reducer(state: History<Timeline | null>, action: Action): History<Timeline | null> {
  if (action.type === 'load') return startHistory(action.timeline);
  if (action.type === 'change') return commit(state, action.timeline, action.group ?? null);
  const next = action.type === 'undo' ? undo(state) : redo(state);
  return next.present === null ? state : next;
}
let idCounter = 0;
const newId = () => `clip-${Date.now().toString(36)}-${(idCounter += 1)}`;
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && ((['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && (target as HTMLInputElement).type !== 'range') || target.isContentEditable || target.getAttribute('role') === 'separator');
/** A button keeps focus only when reached by keyboard (see releaseClickedButton), so then it takes Space itself. */
const buttonTakesSpace = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('button') !== null;
/** Without this, Space after clicking a media tile would add the clip again instead of playing. */
const releaseClickedButton = (event: React.MouseEvent) => { if (event.detail > 0 && document.activeElement instanceof HTMLButtonElement) document.activeElement.blur(); };
const RESTART_MESSAGE = 'Kanaa was updated and needs a restart. Stop it in its terminal with Ctrl+C, then run ./start.sh again.';

export default function Editor({ projectId, projectName, photo, onClose, onOpenOutput, theme, themeChoice, nextTheme }: Props) {
  const [history, dispatch] = useReducer(reducer, EMPTY);
  const timeline = history.present;
  const [choosingFormat, setChoosingFormat] = useState(false);
  const [media, setMedia] = useState<Photo[]>([photo]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(40);
  const [playing, setPlaying] = useState(false);
  const [saved, setSaved] = useState<SaveState>('saved');
  const [ready, setReady] = useState<Record<number, boolean>>({});
  const [preparedReady, setPreparedReady] = useState<Record<string, boolean>>({});
  const [cleanReady, setCleanReady] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [safeArea, setSafeArea] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [addingMusic, setAddingMusic] = useState(false);
  const [creatingCoverArt, setCreatingCoverArt] = useState(false);
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
  const [listening, setListening] = useState<string | null>(null);
  const listenRef = useRef<HTMLAudioElement | null>(null);
  const [stemJob, setStemJob] = useState<StemJob | null>(null);
  const [now, setNow] = useState(0);
  const { layout, update: updateLayout, reset: resetLayout } = useEditorLayout();
  const [leftTab, setLeftTab] = useState<'media' | 'templates' | 'themes' | 'text' | 'audio' | 'words'>('media');
  const [language, setLanguage] = useState(() => { try { return localStorage.getItem('wa.wordsLanguage') ?? 'auto'; } catch { return 'auto'; } });
  const [transcripts, setTranscripts] = useState<Record<string, Word[]>>({});
  const [wordJob, setWordJob] = useState<{ mediaId: number; id: string; progress: number; left: number[] } | null>(null);
  const [wordSelection, setWordSelection] = useState<Set<string>>(new Set());
  const [showingHelp, setShowingHelp] = useState(false);
  // The guide's article to open at: an ⓘ in a settings panel picks one.
  const [guideArticle, setGuideArticle] = useState<string | null>(null);
  const openGuide = useCallback((article: string) => { setGuideArticle(article); setShowingHelp(true); }, []);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pickingKey, setPickingKey] = useState(false);
  const [drawing, setDrawing] = useState<{ mode: 'start' | 'continue'; from?: [number, number]; to?: [number, number] } | null>(null);
  const drawStart = useRef<[number, number] | null>(null); // Pointer events can arrive before a re-render, so the corner is kept here too.
  const [followSize, setFollowSize] = useState(false);
  const [followJob, setFollowJob] = useState<FollowJob | null>(null);
  const [followNote, setFollowNote] = useState<{ itemId: string; text: string } | null>(null);
  const [faceJob, setFaceJob] = useState<{ jobId: string; clipId: string; progress: number } | null>(null);
  const [faceNote, setFaceNote] = useState('');
  const [captionWords, setCaptionWords] = useState(DEFAULT_CAPTION_OPTIONS.words);
  const [captionsWaiting, setCaptionsWaiting] = useState(false);
  const [pauseLength, setPauseLength] = useState(0.7);
  const [shaping, setShaping] = useState<{ textId: string; mode: 'ground' | 'outline'; points: [number, number][] } | null>(null);
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
    const want = clip && preparedWant(clip);
    if (want && preparedReady[preparedKey(id, ...want)]) return { url: preparedProxyUrl(id, ...want), kind: 'video', ...size, duration: item.duration, reversed: want[1] };
    return { url: ready[id] ? clipProxyUrl(id) : photoVideoUrl(id), kind: 'video', ...size, duration: item.duration };
  }, [mediaById, ready, preparedReady]);

  const textImages = useRef(new Map<string, string | 'loading'>());
  const [textVersion, redrawText] = useReducer((count: number) => count + 1, 0);
  const textKey = (text: TextItem, format: Format) => JSON.stringify([text.text, text.style, text.position, text.color, text.size, text.subtitle ?? null, text.subtitle_size ?? null, text.subtitle_color ?? null, Boolean(text.subtitle_above), text.subtitle_spacing ?? 0, text.align ?? 'center', text.band_color ?? null, text.font ?? null, text.tamil_font ?? null, format.width, format.height]);
  const textUrl = useCallback((text: TextItem) => {
    const found = timelineRef.current && textImages.current.get(textKey(text, timelineRef.current.format));
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
    }, TEXT_TYPE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [timeline]);
  // Captions: one image per caption and lit word, drawn by the server like titles, fetched a few at a time.
  const captionImages = useRef(new Map<string, string | 'loading'>());
  const captionKey = (layer: CaptionLayer, caption: Caption, lit: number | null, format: Format) => JSON.stringify([captionText(caption), lit, layer.style, layer.position, layer.color, layer.highlight, layer.size, format.width, format.height]);
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
        const look = { style: job.layer.style, position: job.layer.position, color: job.layer.color, highlight: job.layer.highlight, size: job.layer.size };
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
        const [project, upgraded, library] = await Promise.all([getVideoProject<{ version?: number }>(projectId, 'edit'), getProjectTimeline<Timeline>(projectId), listPhotos({ collection: 'imports', limit: 500 })]);
        if (cancelled) return;
        setMedia((current) => [...current, ...library.photos.filter((item) => !current.some((entry) => entry.id === item.id))]);
        const started = project.recipe?.version === 2;
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
    if (!flat) { engineRef.current?.setTimeline(timeline, sourceFor, soundUrl, textUrl, captionUrl); return; }
    // The rendered copy plays as one clip, so nothing else has to keep up.
    const length = duration(timeline);
    const base = newClip({ media_id: RENDERED_ID, media_type: 'video', duration: length, ...timeline.format }, 'rendered');
    const single: Timeline = { version: 2, format: timeline.format, layers: [{ id: 'rendered', kind: 'video', magnetic: true, items: [{ ...base, out: length }] }] };
    engineRef.current?.setTimeline(single, (id) => (id === RENDERED_ID ? { url: flat.url, kind: 'video', ...timeline.format } : sourceFor(id)), soundUrl, textUrl);
  }, [timeline, sourceFor, soundUrl, textUrl, textVersion, rendered]);

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
    const want = mediaById.get(clip.media_id)?.media_type === 'video' && preparedWant(clip);
    return want ? [preparedKey(clip.media_id, ...want)] : [];
  }) : [])) : [])].join(','), [timeline, mediaById]);
  useEffect(() => {
    const keys = preparedNeeded ? preparedNeeded.split(',').filter((key) => !preparedReady[key]) : [];
    if (!keys.length) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      for (const key of keys) {
        const [id, steady, backwards, cutout] = key.split(':');
        try { if ((await requestPrepared(Number(id), steady === '1', backwards === '1', cutout)).status === 'ready' && !stopped) setPreparedReady((current) => ({ ...current, [key]: true })); } catch (problem) { if (!stopped && cutout) setError((problem as Error).message); }
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

  const change = useCallback((next: Timeline, group?: string | null) => dispatch({ type: 'change', timeline: next, group }), []);
  const selected = timeline ? findClip(timeline, selectedId) : null;
  const local = selected ? Math.max(0, Math.min(now - selected.start, clipLength(selected))) : 0;
  const selectedSound = timeline ? findSound(timeline, selectedId) : null;
  const selectedLayer = timeline ? layerOf(timeline, selectedId) : undefined;
  const isRendered = Boolean(timeline && rendered && rendered.key === JSON.stringify(timeline));
  const renderPreview = async () => {
    if (!timeline) return;
    engineRef.current?.pause();
    try {
      const { job_id } = await startPreviewRender(projectId, { ...timeline, format: exportFormat(timeline.format, PREVIEW_SHORT_SIDE) });
      setRenderJob({ id: job_id, key: JSON.stringify(timeline), progress: 0 });
    } catch (problem) { setError((problem as Error).message); }
  };
  const selectedText = timeline ? findText(timeline, selectedId)?.text ?? null : null;
  const selectedBlur = timeline ? findBlur(timeline, selectedId)?.blur ?? null : null;
  const selectedCaption = timeline ? findCaption(timeline, selectedId) : null;
  const selectedIdentity = selected ? { kind: 'Clip', name: mediaById.get(selected.media_id)?.filename ?? `Media ${selected.media_id}` }
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
  const updateSelectedText = (changes: Partial<TextItem>, group?: string) => { if (timeline && selectedText) change(updateText(timeline, selectedText.id, changes), group); };
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
  const listen = (id: string) => {
    const player = listenRef.current ?? (listenRef.current = new Audio());
    if (listening === id) { player.pause(); setListening(null); return; }
    player.src = musicListenUrl(id);
    player.onended = () => setListening(null);
    void player.play().catch(() => setListening(null));
    setListening(id);
  };
  useEffect(() => () => { listenRef.current?.pause(); }, []);
  /** A library track as a song: copied into Kanaa once, then used like an uploaded one. */
  const librarySong = async (track: LibraryTrack) => ({ ...(await takeLibraryTrack(track.id)), name: track.genre && /^track\b/i.test(track.name) ? `${track.name} · ${track.genre}` : track.name });
  /** Dresses the whole video in a theme. The opening title keeps the words already typed there, or the project's name. */
  const chooseTheme = async (look: VideoTheme, base = timeline, busy = look.id) => {
    if (!base || !mainLayer(base).items.length) { setError('Add a clip to your video first.'); return; }
    if (themeBusy) return;
    const words = openingWords(base) ?? projectName;
    setThemeBusy(busy);
    let next = applyTheme(base, look, words, (clip) => mediaById.get(clip.media_id)?.media_type === 'image', [newId(), newId(), newId()]);
    try {
      const track = themeWithMusic ? pickTrack(await loadLibrary(), look, duration(next)) : null;
      if (track) {
        try { next = addThemeMusic(next, await librarySong(track), [newId(), newId()]); setThemeTrack(track.id); } catch (problem) { setError((problem as Error).message); }
      }
      change(next);
    } finally { setThemeBusy(null); }
  };
  const storyMedia = media.filter((item) => item.media_type === 'video' || item.media_type === 'image');
  /** The story's clips in its order, then its theme and music, as one change. */
  const makeStory = async () => {
    if (!timeline || !story) return;
    const fills = story.fills.map((id) => (id === null ? null : facts(id) ?? null));
    if (!fills.some(Boolean)) { setError('Put a clip or photo in at least one moment.'); return; }
    const look = THEMES.find((item) => item.id === story.story.theme) ?? THEMES[0];
    await chooseTheme(look, buildStory(timeline, story.story, fills, newId), `story-${story.story.id}`);
    setStory(null);
  };
  /** The theme's music: the next suitable track, or none. */
  const changeThemeMusic = async (on: boolean) => {
    const look = timeline && activeTheme(timeline);
    if (!timeline || !look) return;
    if (!on) { change(removeThemeMusic(timeline)); return; }
    const track = library && pickTrack(library, look, duration(timeline), themeTrack);
    if (!track) { setError('No music in your library suits this theme yet.'); return; }
    try { change(addThemeMusic(timeline, await librarySong(track), [newId(), newId()])); setThemeTrack(track.id); } catch (problem) { setError((problem as Error).message); }
  };
  const addLibraryTrack = async (track: LibraryTrack) => {
    if (!timeline) return;
    setAddingMusic(true);
    try {
      const song = await librarySong(track);
      const at = Math.round(engineRef.current ? engineRef.current.currentTime * 1000 : 0) / 1000;
      const left = duration(timeline) - at;
      const length = left >= MIN_MUSIC_SECONDS ? Math.min(left, song.duration) : song.duration;
      const sound: Sound = { id: newId(), asset_id: song.asset_id, start: at, in: 0, out: length, speed: 1, volume: MUSIC_VOLUME, muted: false, fade_in: 0, fade_out: 0, duck: true, name: song.name.slice(0, 120), source_length: song.duration };
      change(addSound(timeline, sound, newId()));
      setSelectedId(sound.id);
    } catch (problem) { setError((problem as Error).message); } finally { setAddingMusic(false); }
  };
  const saveStyle = (text: TextItem) => {
    const style: Template = { id: `mine-${Date.now().toString(36)}`, label: text.text.slice(0, 18), look: lookOf(text) };
    const next = [style, ...myStyles].slice(0, MAX_SAVED);
    setMyStyles(next); saveStyles(next);
  };
  const forgetStyle = (id: string) => { const next = myStyles.filter((style) => style.id !== id); setMyStyles(next); saveStyles(next); };
  const addTitle = (title: Template) => {
    if (!timeline) return;
    const text: TextItem = { ...title.look, id: newId(), start: Math.round((engineRef.current?.currentTime ?? 0) * 1000) / 1000, length: TEXT_SECONDS };
    change(addText(timeline, text, newId()));
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
  const updateSelected = (changes: Partial<Clip>, group?: string) => { if (timeline && selected) change(changes.speed !== undefined ? setSpeed(timeline, selected.id, changes.speed) : updateClip(timeline, selected.id, changes), group); };
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
  const makeCaptions = useCallback(() => {
    if (!timeline) return;
    if (missingWords.length) { setCaptionsWaiting(true); if (!wordJob) void transcribeClips(); return; }
    setCaptionsWaiting(false);
    const items = buildCaptions(mainClips, (id) => transcripts[`${id}:${language}`], newId, { ...DEFAULT_CAPTION_OPTIONS, words: captionWords });
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
    const next = putBehindShape(timeline, shaping.textId, mask, [newId(), newId()]);
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
    change(findSound(timeline, selectedId) ? removeSound(timeline, selectedId) : findText(timeline, selectedId) ? removeText(timeline, selectedId) : findBlur(timeline, selectedId) ? removeBlur(timeline, selectedId) : findCaption(timeline, selectedId) ? removeCaption(timeline, selectedId) : removeClip(timeline, selectedId));
    setSelectedId(null);
  }, [timeline, selectedId, change]);
  const addMedia = (item: Photo) => {
    if (!timeline) return;
    const source: SourceFacts = { media_id: item.id, media_type: item.media_type === 'video' ? 'video' : 'image', duration: item.duration, width: item.width, height: item.height };
    const clip = newClip(source, newId());
    change(insertClip(timeline, clip));
    setSelectedId(clip.id);
  };
  const addOverlayMedia = (item: Photo) => {
    if (!timeline) return;
    const source: SourceFacts = { media_id: item.id, media_type: item.media_type === 'video' ? 'video' : 'image', duration: item.duration, width: item.width, height: item.height };
    const base = newClip(source, newId());
    const clip = { ...base, start: Math.round((engineRef.current?.currentTime ?? 0) * 1000) / 1000, transform: { ...base.transform, scale: OVERLAY_SCALE } };
    try {
      change(addOverlay(timeline, clip, newId()));
      setSelectedId(clip.id);
    } catch (problem) { setError((problem as Error).message); }
  };
  const chooseFormat = (format: Format) => {
    if (!timeline) return;
    change({ ...timeline, format });
    setChoosingFormat(false);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '?' && !isTyping(event.target)) { setShowingHelp((value) => !value); return; }
      if (event.key === 'Escape' && fullScreen) { toggleFullScreen(); return; }
      if (event.key === 'Escape' && pickingKey) { stopPicking(); return; }
      if (event.key === 'Escape' && drawing) { setDrawing(null); return; }
      if (shaping && event.key === 'Escape') { setShaping(null); return; }
      if (shaping && event.key === 'Enter') { event.preventDefault(); finishShape(); return; }
      if (shaping && event.key === 'Backspace') { event.preventDefault(); setShaping({ ...shaping, points: shaping.points.slice(0, -1) }); return; }
      if (isTyping(event.target) || !timeline || exporting || choosingFormat || showingHelp || menu) return;
      if (event.key === ' ' && buttonTakesSpace(event.target)) return;
      // Arrows on a focused slider change the slider, not the playhead.
      if (event.target instanceof HTMLInputElement && event.target.type === 'range' && event.key.startsWith('Arrow')) return;
      const command = event.metaKey || event.ctrlKey;
      const engine = engineRef.current;
      const frame = 1 / timeline.format.fps;
      const clip = () => mainLayer(timeline).items.find((item) => playhead.current >= item.start && playhead.current < item.start + clipLength(item));
      if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); dispatch({ type: event.shiftKey ? 'redo' : 'undo' }); return; }
      if (command) return;
      switch (event.key) {
        case ' ': event.preventDefault(); togglePlay(); break;
        case 'k': engine?.pause(); fastRate.current = 0; break;
        case 'l': fastRate.current = Math.min(FAST_RATES.length - 1, engine?.playing ? fastRate.current + 1 : 0); engine?.play(FAST_RATES[fastRate.current]); break;
        case 'j': engine?.pause(); seek(playhead.current - 1); break;
        case 'ArrowLeft': event.preventDefault(); engine?.pause(); seek(playhead.current - frame * (event.shiftKey ? 10 : 1)); break;
        case 'ArrowRight': event.preventDefault(); engine?.pause(); seek(playhead.current + frame * (event.shiftKey ? 10 : 1)); break;
        case 's': split(); break;
        case 'f': toggleFullScreen(); break;
        case 'i': case 'o': { const item = clip(); if (item && !mainLayer(timeline).locked) change(trimAtPlayhead(timeline, item, event.key === 'i' ? 'in' : 'out', playhead.current - item.start, newId, facts(item.media_id))); break; }
        case 'Delete': case 'Backspace': event.preventDefault(); if (wordSelection.size) cutWords(wordSelection); else removeSelected(); break;
        case 'Escape': setWordSelection(new Set()); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullScreen, fullScreen, timeline, exporting, choosingFormat, showingHelp, menu, pickingKey, drawing, shaping, stopPicking, wordSelection, cutWords, togglePlay, split, removeSelected, seek, change, playhead, facts]);

  const dragPreview = useRef<{ x: number; y: number; clipX: number; clipY: number; group: string } | null>(null);
  const moving = selected ? { transform: selected.transform, local, update: (transform: Clip['transform'], group?: string) => updateSelected({ transform }, group) }
    : selectedBlur ? { transform: selectedBlur.transform, local: blurLocal, update: (transform: Clip['transform'], group?: string) => updateSelectedBlur({ transform }, group) }
    : selectedText ? { transform: selectedText.transform ?? REST_TRANSFORM, local: textLocal, update: (transform: Clip['transform'], group?: string) => updateSelectedText({ transform }, group) } : null;
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
  const previewDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (pickingKey && selected) {
      const rect = event.currentTarget.getBoundingClientRect();
      const color = engineRef.current?.sampleColor((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
      if (color) updateSelected({ chroma: { ...(selected.chroma ?? DEFAULT_CHROMA), color } });
      stopPicking();
      return;
    }
    if (!moving || selectedLayer?.locked || event.button !== 0 || event.ctrlKey) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragPreview.current = { x: event.clientX, y: event.clientY, clipX: valueAt(moving.transform, 'x', moving.local), clipY: valueAt(moving.transform, 'y', moving.local), group: `move-${Date.now()}` };
  };
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
  const startFollowing = async (box: Box, mode: 'start' | 'continue') => {
    if (!timeline || !followTarget) return;
    const t = playhead.current;
    const under = videoUnder(timeline, followTarget.id, t, isVideo);
    const source = under && sourceFor(under.media_id);
    if (!under || !source) return;
    const sourceBox = boxInSource(under, source, timeline.format, t - under.start, box);
    if (!sourceBox) { setError('Draw the box on the video itself.'); return; }
    const toSource = (time: number) => sourceAt(under, time - under.start);
    const first = mode === 'continue' ? t : Math.max(followTarget.start, under.start);
    const last = Math.min(followTarget.start + followTarget.length, under.start + clipLength(under));
    try {
      const { job_id } = await startTracking(under.media_id, { at: toSource(t), start: Math.min(toSource(first), toSource(last)), end: Math.max(toSource(first), toSource(last)), box: sourceBox });
      const drawnAt = t - followTarget.start;
      setFollowJob({ itemId: followTarget.id, underId: under.id, jobId: job_id, progress: 0, drawnAt, from: mode === 'continue' ? drawnAt : 0, size: followSize, place: selectedBlur ? box : null });
    } catch (problem) { setError((problem as Error).message); }
  };
  const finishDrawing = (event: React.PointerEvent<HTMLElement>) => {
    const box = drawnBox({ mode: 'start', from: drawStart.current ?? undefined, to: frameAt(event) });
    const mode = drawing?.mode ?? 'start';
    drawStart.current = null;
    setDrawing(null);
    if (box && box[2] > MIN_DRAWN_BOX && box[3] > MIN_DRAWN_BOX) void startFollowing(box, mode);
  };
  useEffect(() => {
    if (!followJob) return;
    const timer = setTimeout(async () => {
      try {
        const status = await getJobStatus(followJob.jobId) as unknown as { status?: string; progress: number; error?: string | null; track?: { points: TrackPoint[]; lost_before: boolean; lost_after: boolean } };
        if (status.status === 'failed' || status.status === 'cancelled') { if (status.status === 'failed') setError(status.error ?? 'Could not follow that.'); setFollowJob(null); return; }
        if (status.status !== 'done' || !status.track) { setFollowJob({ ...followJob, progress: status.progress }); return; }
        setFollowJob(null);
        applyFollow(followJob, status.track);
      } catch (problem) { setError((problem as Error).message); setFollowJob(null); }
    }, 600);
    return () => clearTimeout(timer);
  });
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
    change(clip ? updateClip(current, clip.id, { transform: followed }) : blur ? updateBlur(current, blur.id, { ...placed, transform: followed }) : updateText(current, text!.id, { transform: followed }));
    const timeOf = (point: TrackPoint) => under.start + localAt(under, point[0]);
    const lost = track.lost_after ? `Lost it at ${timecode(timeOf(track.points[track.points.length - 1]))}. Move the playhead there, then choose Continue from here.`
      : track.lost_before ? `Lost it before ${timecode(timeOf(track.points[0]))}. It stays still until then.` : '';
    setFollowNote({ itemId: job.itemId, text: lost || 'Following. Play it back to check, and drag any keyframe that is off.' });
  };

  const generalItems = (): MenuItem[] => [
    { label: 'Undo', hint: '⌘Z', disabled: !history.past.length, onSelect: () => dispatch({ type: 'undo' }) },
    { label: 'Redo', hint: '⇧⌘Z', disabled: !history.future.length, onSelect: () => dispatch({ type: 'redo' }) },
    'divider', { label: 'Guide and shortcuts', hint: '?', onSelect: () => setShowingHelp(true) },
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
    const items: MenuItem[] = [{ label: playing ? 'Pause' : 'Play', hint: 'Space', disabled: !total, onSelect: togglePlay }, { label: safeArea ? 'Hide safe area' : 'Show safe area', onSelect: () => setSafeArea((value) => !value) }, { label: 'Render preview', disabled: !total || Boolean(renderJob) || isRendered, onSelect: () => { void renderPreview(); } }];
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const at: [number, number] = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
    if (total) items.push('divider', { label: 'Blur this spot', onSelect: () => addBlurBox('blur', at) }, { label: 'Pixelate this spot', onSelect: () => addBlurBox('pixelate', at) }, { label: 'Blur all faces in this clip', disabled: Boolean(faceJob), onSelect: () => { setLeftTab('text'); updateLayout({ mediaOpen: true }); void blurFaces(); } });
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
      setMenu({ ...place, items: [{ label: 'Move playhead here', onSelect: () => seek(t) }, { label: 'Fit timeline', disabled: !total, onSelect: fitZoom }, 'divider', ...generalItems()] });
      return;
    }
    const layer = layerOf(timeline, id)!;
    const lockItem: MenuItem = { label: layer.locked ? 'Unlock layer' : 'Lock layer', onSelect: () => change(updateLayer(timeline, layer.id, { locked: !layer.locked })) };
    if (layer.locked) { setMenu({ ...place, items: [lockItem] }); return; }
    const clip = findClip(timeline, id);
    const sound = findSound(timeline, id)?.sound;
    const items: MenuItem[] = [];
    if (clip || sound) items.push({ label: 'Split here', hint: 'S', onSelect: () => { const next = sound ? splitSound(timeline, id, t, newId()) : layer === mainLayer(timeline) ? splitClip(timeline, t, newId()) : splitSound(timeline, id, t, newId()); if (next !== timeline) change(next); } });
    items.push({ label: 'Duplicate', onSelect: () => { try { change(duplicateItem(timeline, id, newId(), newId())); } catch (problem) { setError((problem as Error).message); } } });
    if (clip && layer === mainLayer(timeline) && clip.freeze == null && mediaById.get(clip.media_id)?.media_type === 'video') items.push({ label: 'Freeze frame here', onSelect: () => freeze(t) });
    if (clip) {
      if (!clip.muted && hasSound(clip.media_id)) items.push({ label: 'Detach sound', onSelect: () => detach(clip) });
      items.push({ label: clip.muted ? 'Turn sound on' : 'Mute clip', onSelect: () => change(updateClip(timeline, id, { muted: !clip.muted })) });
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
  const mediaOpen = layout.mediaOpen; const inspectorOpen = layout.inspectorOpen;
  const shellStyle = { '--media-col': mediaOpen ? `${layout.media}px` : '0px', '--media-gap': mediaOpen ? '6px' : '32px', '--inspector-col': inspectorOpen ? `${layout.inspector}px` : '0px', '--inspector-gap': inspectorOpen ? '6px' : '32px', '--timeline-h': `${Math.min(layout.timeline, Math.round(window.innerHeight * 0.55))}px` } as React.CSSProperties;
  const ratio = timeline ? timeline.format.width / timeline.format.height : 16 / 9;
  const isEmpty = timeline && !mainLayer(timeline).items.length;
const followPanel = followTarget && <FollowPanel blur={Boolean(selectedBlur)} drawing={Boolean(drawing)} job={followJob?.itemId === followTarget.id ? followJob : null} busy={Boolean(followJob)} note={followNote?.itemId === followTarget.id ? followNote.text : null}
    following={Boolean(followTarget.transform.keyframes?.x?.length)} size={followSize} onSize={setFollowSize} onStart={() => startDrawing('start')} onContinue={() => startDrawing('continue')}
    onCancel={() => { if (followJob) void cancelRenderJob(followJob.jobId); setFollowJob(null); }} onStop={() => { if (selected) updateSelected({ transform: unfollow(selected.transform, local) }); else if (selectedBlur) updateSelectedBlur({ transform: unfollow(selectedBlur.transform, blurLocal) }); else if (selectedText) updateSelectedText({ transform: unfollow(selectedText.transform ?? REST_TRANSFORM, textLocal) }); setFollowNote(null); }}/>;
  return <div className="ed" ref={rootRef} data-ed-theme={theme} style={shellStyle} onClick={releaseClickedButton} onContextMenu={openGeneralMenu} role="application" aria-label="Video editor">
    <header className="ed-top">
      <button className="ed-icon" onClick={() => { void closeEditor(); }} aria-label="Back to projects"><ArrowLeft size={18}/></button>
      <div className="ed-title"><strong>{projectName}</strong><span>{saved === 'saving' ? 'Saving…' : saved === 'failed' ? 'Could not save' : 'Saved'}</span></div>
      <div className="ed-spacer"/>
      <button className="ed-icon" aria-label={`Theme: ${themeChoice}. Change theme`} title={`Theme: ${themeChoice === 'system' ? 'same as this Mac' : themeChoice}`} onClick={nextTheme}>{themeChoice === 'system' ? <Monitor size={17}/> : themeChoice === 'light' ? <Sun size={17}/> : <Moon size={17}/>}</button>
      <span className="ed-divide ed-hide-small"/>
      <button className="ed-icon" disabled={!history.past.length} onClick={() => dispatch({ type: 'undo' })} aria-label="Undo" title="Undo (⌘Z)"><Undo2 size={17}/></button>
      <button className="ed-icon" disabled={!history.future.length} onClick={() => dispatch({ type: 'redo' })} aria-label="Redo" title="Redo (⇧⌘Z)"><Redo2 size={17}/></button>
      <button className="ed-button" onClick={() => setChoosingFormat(true)}>{timeline ? `${timeline.format.width} × ${timeline.format.height}` : 'Format'}</button>
      <button className="ed-primary" disabled={!total} onClick={() => { engineRef.current?.pause(); setExporting(true); }}><Download size={16}/>Export</button>
    </header>
    {error && <div className="ed-error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={15}/></button></div>}
    {heavy && !isRendered && <div className="ed-heavy" role="status"><span>This project is too heavy to play smoothly here. Your export isn't affected.</span><button className="ed-button" disabled={Boolean(renderJob)} onClick={() => { void renderPreview(); }}>Render preview</button><button className="ed-icon small" aria-label="Dismiss" onClick={() => setHeavy(false)}><X size={14}/></button></div>}
    {isRendered && <div className="ed-note" role="status">Playing a rendered preview. Any edit returns to the live preview.</div>}
    <div className="ed-workspace"><div className="ed-body">
      <aside className={`ed-media ${mediaOpen ? '' : 'ed-panel-closed'}`} aria-label="Media">
        <div className="ed-panel-head"><div className="ed-tabs" role="tablist" aria-label="Add to your video">{LEFT_TABS.map((tab, index) => <button key={tab} role="tab" tabIndex={leftTab === tab ? 0 : -1} aria-selected={leftTab === tab} onClick={() => setLeftTab(tab)} onKeyDown={(event) => { const next = nextTabIndex(index, LEFT_TABS.length, event.key, 3); if (next === index) return; event.preventDefault(); setLeftTab(LEFT_TABS[next]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus(); }}>{LEFT_TAB_LABELS[tab]}</button>)}</div>
          <button className="ed-icon small ed-hide-small" aria-label="Hide media panel" title="Hide this panel" onClick={() => updateLayout({ mediaOpen: false })}><PanelLeftClose size={15}/></button></div>
        {leftTab === 'media' && <>
          <button className="ed-button wide" disabled={!timeline} onClick={() => setCreatingCoverArt(true)}><WandSparkles size={15}/>Create AI cover art</button>
          <ImportArea compact onImported={(items) => { setMedia((current) => [...items, ...current]); }}/>
          {folders.length > 0 && <div className="ed-chips ed-folders" role="group" aria-label="Folders"><button className={folder === null ? 'on' : ''} onClick={() => setFolder(null)}>All</button>{folders.map((name) => <button key={name} className={folder === name ? 'on' : ''} onClick={() => setFolder(name)}>{name}</button>)}</div>}
          {([['In this video', inVideo], ['Other media', otherMedia]] as const).map(([heading, items]) => items.length > 0 && <div key={heading}><h3 className="ed-sub">{heading}</h3><div className="ed-media-grid">{items.map((item) => <div className="ed-tile" key={item.id}>
            <button className="ed-tile-add" onClick={() => addMedia(item)} onContextMenu={(event) => openMediaMenu(event, item)} title={`Add ${item.filename}. Right-click for more.`}><img src={photoThumbUrl(item.id)} alt=""  loading="lazy"/><span className="ed-tile-label"><b>{item.filename}</b>{item.duration ? <em>{timecode(item.duration).replace(/\.\d+$/, '')}</em> : null}</span></button>
            {usedIds.has(item.id) && <span className="ed-tile-used" title="In your video"><Check size={11}/></span>}
            <button className="ed-tile-over" onClick={() => addOverlayMedia(item)} title="Add on top of your video, like a logo" aria-label={`Add ${item.filename} as an overlay`}><Layers size={12}/></button></div>)}</div></div>)}
        </>}
        {leftTab === 'words' && <WordsPanel tokens={tokens} clips={mainClips} language={language} onLanguage={(next) => { setLanguage(next); setWordSelection(new Set()); try { localStorage.setItem('wa.wordsLanguage', next); } catch { /* It just won't be remembered. */ } }} missing={missingWords.length} locked={Boolean(timeline && mainLayer(timeline).locked)}
          busy={wordJob ? `Listening to your video… ${wordJob.progress}%` : null} hasTracks={Boolean(timeline && timeline.layers.length > 1)} onTranscribe={() => { void transcribeClips(); }} onCancel={() => { if (wordJob) void cancelRenderJob(wordJob.id); }} onSeek={seek} onCut={cutWords} playhead={playhead} selection={wordSelection} onSelection={setWordSelection} tidy={tidy} pauseLength={pauseLength} onPauseLength={setPauseLength} fillers={removeFillers} onFillers={setRemoveFillers} onTidy={removePauses}
          onMenu={(event, keys) => setMenu({ x: event.clientX, y: event.clientY, items: [{ label: keys.size === 1 ? 'Cut' : `Cut ${keys.size} items`, hint: '⌫', danger: true, onSelect: () => cutWords(keys) }] })}/>}
        {leftTab === 'templates' && timeline && (() => {
          if (story) {
            const filled = story.fills.filter((id) => id !== null).length;
            const pick = (index: number, id: number | null) => setStory({ ...story, fills: story.fills.map((current, at) => (at === index ? id : current)), choosing: null });
            return <section className="ed-add" aria-label="Story">
              <div className="ed-add-row"><button className="ed-button" onClick={() => setStory(null)}><ArrowLeft size={13}/>All stories</button><span>{filled} of {story.story.slots.length} filled</span></div>
              <h3 className="ed-sub">{story.story.label} <em lang="ta" className="ed-tamil-note">{story.story.tamil}</em></h3>
              <ol className="ed-slots">{story.story.slots.map((item, index) => { const id = story.fills[index]; const chosen = id !== null ? mediaById.get(id) : undefined; return <li key={item.label} className={story.choosing === index ? 'on' : ''}>
                <button className="ed-slot" onClick={() => setStory({ ...story, choosing: story.choosing === index ? null : index })} title={item.hint}>
                  <span className="ed-slot-art">{chosen ? <img src={photoThumbUrl(chosen.id)} alt=""/> : <Plus size={14}/>}</span>
                  <span className="ed-slot-text"><b>{index + 1}. {item.label}</b><em lang="ta">{item.tamil} · {item.seconds}s</em><small>{chosen ? chosen.filename : item.hint}</small></span></button>
                {chosen && <button className="ed-icon small" aria-label={`Empty ${item.label}`} title="Empty this moment" onClick={() => pick(index, null)}><X size={12}/></button>}
                {story.choosing === index && <div className="ed-media-grid ed-backgrounds">{storyMedia.length ? storyMedia.map((item2) => <button key={item2.id} className="ed-tile-add" onClick={() => pick(index, item2.id)} title={`Use ${item2.filename}`}><img src={photoThumbUrl(item2.id)} alt="" loading="lazy"/><span className="ed-tile-label"><b>{item2.filename}</b></span></button>) : <p className="ed-tip">Import your clips and photos in Media first.</p>}</div>}
              </li>; })}</ol>
              <button className="ed-button wide" disabled={!storyMedia.length || filled === story.fills.length} onClick={() => setStory({ ...story, fills: fillRest(story.story, story.fills.map((id) => (id === null ? null : facts(id) ?? null)), storyMedia.map((item) => facts(item.id)!).filter(Boolean)).map((source) => source?.media_id ?? null), choosing: null })}>Fill the rest with my media</button>
              <button className="ed-primary wide" disabled={!filled || Boolean(themeBusy)} onClick={() => { void makeStory(); }}>{themeBusy ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>}Make my video</button>
              <p className="ed-tip">Each moment uses the middle of a longer clip. Empty moments are skipped. {mainLayer(timeline).items.length ? 'This replaces the clips on your main track; undo with ⌘Z.' : ''}</p>
            </section>;
          }
          return <section className="ed-add" aria-label="Story templates">
            <p className="ed-tip">Pick a story, put a clip or photo in each moment, and Kanaa makes the video with its theme and music.</p>
            <div className="ed-stories">{STORIES.map((item) => <button key={item.id} className="ed-story" onClick={() => setStory({ story: item, fills: item.slots.map(() => null), choosing: null })} title={`${item.slots.map((each) => each.label).join(' → ')}`}>
              <b>{item.label}</b><em lang="ta">{item.tamil}</em><small>{item.slots.length} moments · about {storySeconds(item)}s · {THEMES.find((look) => look.id === item.theme)?.label}</small></button>)}</div>
          </section>;
        })()}
        {leftTab === 'themes' && timeline && (() => {
          const current = activeTheme(timeline);
          const finish = timeline.finish ?? null;
          const setFinish = (next: Finish | null, group?: string) => change({ ...timeline, finish: next }, group);
          const part = (key: 'grade' | 'glow' | 'vignette' | 'grain', label: string) => <ValueSlider key={key} label={label} value={finish?.[key] ?? 0} min={0} max={1} step={0.05} defaultValue={CINEMATIC[key]} unit="%" factor={100}
            onGestureStart={pauseEngine} onChange={(value, group) => setFinish({ ...(finish ?? { ...CINEMATIC, letterbox: false, grade: 0, glow: 0, vignette: 0, grain: 0 }), [key]: value }, group ?? `finish-${key}`)}/>;
          return <section className="ed-add" aria-label="Themes">
            <p className="ed-tip">Dresses your whole video at once: colours, transitions, photo movement, an opening title and an ending card. Your clips and words stay.</p>
            <div className="ed-themes">{THEMES.map((look) => <button key={look.id} className={`ed-theme ${current?.id === look.id ? 'on' : ''}`} aria-pressed={current?.id === look.id} onClick={() => { void chooseTheme(look); }} disabled={Boolean(themeBusy)} title={`${look.label}: ${look.about}`}>
              <span className="ed-theme-art" style={{ background: `linear-gradient(135deg, ${look.swatch[0]}, ${look.swatch[1]})` }}>{thumbs[`theme-${look.id}`] && <img src={thumbs[`theme-${look.id}`]} alt=""/>}</span>
              <span className="ed-theme-name"><b>{themeBusy === look.id ? <LoaderCircle className="spin" size={11}/> : null}{look.label}</b><em lang="ta">{look.tamil}</em></span><small>{look.about}</small></button>)}</div>
            <label className="ed-check"><input type="checkbox" checked={themeWithMusic} onChange={(event) => setThemeWithMusic(event.target.checked)}/><span>Add music from your library<small>{library === null ? 'Reading your music…' : library.length ? `${library.length} tracks, matched to each theme's mood.` : 'No music found in your Music app folder.'}</small></span></label>
            {current && (() => { const music = themeMusic(timeline); return <div className="ed-add-row"><span>{music ? <>Music: <b>{music.name.replace(/^Theme music · /, '')}</b></> : 'No music'}</span>
              <span className="ed-pair-small">{library && library.length > 0 && <button className="ed-button" onClick={() => { void changeThemeMusic(true); }}>{music ? 'Another track' : 'Add music'}</button>}{music && <button className="ed-icon small" aria-label="Remove theme music" title="No music" onClick={() => { void changeThemeMusic(false); }}><X size={13}/></button>}</span></div>; })()}
            {current && <button className="ed-button wide" onClick={() => change(removeTheme(timeline))}><X size={14}/>Remove theme</button>}
            <div className="ed-cinematic">
              <label className="ed-check"><input type="checkbox" checked={Boolean(finish)} onChange={(event) => setFinish(event.target.checked ? { ...CINEMATIC, letterbox: barShare(timeline.format) > 0 } : null)}/><span>Cinematic finish<small>Optional finishing controls after your theme: teal and orange colour, glow, darker edges and grain{barShare(timeline.format) > 0 ? ', with widescreen bars' : ''}.</small></span></label>
              {finish && <>
                {barShare(timeline.format) > 0 ? <label className="ed-check"><input type="checkbox" checked={finish.letterbox} onChange={(event) => setFinish({ ...finish, letterbox: event.target.checked })}/><span>Widescreen bars<small>Black bars to the 2.39:1 cinema shape.</small></span></label>
                  : <p className="ed-tip">Widescreen bars are for landscape and square videos.</p>}
                {part('grade', 'Teal and orange')}{part('glow', 'Glow')}{part('vignette', 'Dark edges')}{part('grain', 'Film grain')}
              </>}
            </div>
            <p className="ed-tip">To change the opening or ending words, click them on the timeline. Choosing another theme keeps your opening words.</p></section>;
        })()}
        {leftTab === 'text' && <>
          <section className="ed-add" aria-label="Titles"><h3 className="ed-sub">Titles</h3><p className="ed-tip">Adds a title at the playhead. Then type your own words.</p>
            <div className="ed-templates">{TEMPLATES.map((template) => <button key={template.id} className="ed-template" onClick={() => addTitle(template)} title={`Add a ${template.label} title`}>
              <span className="ed-template-art">{thumbs[template.id] ? <img src={thumbs[template.id]} alt=""/> : <Type size={16}/>}</span><span>{template.label}</span></button>)}</div>
            {myStyles.length > 0 && <><h3 className="ed-sub">My styles</h3><div className="ed-templates">{myStyles.map((style) => <div key={style.id} className="ed-template-wrap">
              <button className="ed-template" onClick={() => addTitle(style)} title="Add a title in this style"><span className="ed-template-art">{thumbs[style.id] ? <img src={thumbs[style.id]} alt=""/> : <Type size={16}/>}</span><span>{style.label}</span></button>
              <button className="ed-icon small ed-template-forget" aria-label={`Forget the style ${style.label}`} title="Forget this style" onClick={() => forgetStyle(style.id)}><X size={12}/></button></div>)}</div></>}</section>
          <section className="ed-add" aria-label="Captions"><h3 className="ed-sub">Captions</h3><p className="ed-tip">Turns the speech in your main track into captions{timeline && captionLayers(timeline).length ? '. Making them again replaces the old ones.' : ', in the language chosen in Words.'}</p>
            <div className="ed-add-row"><span>Words per caption</span><div className="ed-chips ed-even" role="group" aria-label="Words per caption">{[1, 2, 3, 4].map((count) => <button key={count} className={captionWords === count ? 'on' : ''} aria-pressed={captionWords === count} onClick={() => setCaptionWords(count)}>{count}</button>)}</div></div>
            {captionsWaiting && wordJob ? <><div className="ed-progress"><i style={{ width: `${wordJob.progress}%` }}/></div><p className="ed-tip">Listening to your video… {wordJob.progress}%. The captions follow.</p></>
              : <button className="ed-button wide" disabled={!total} onClick={makeCaptions}><Captions size={14}/>{timeline && captionLayers(timeline).length ? 'Make captions again' : 'Add captions'}</button>}</section>
          <section className="ed-add" aria-label="Hide something"><h3 className="ed-sub">Hide something</h3><p className="ed-tip">Covers a face, a number plate or a screen. It can follow what it covers.</p>
            <div className="ed-add-grid">
              <button className="ed-button" disabled={!total} onClick={() => addBlurBox('blur')}><EyeOff size={13}/>Blur box</button>
              <button className="ed-button" disabled={!total} onClick={() => addBlurBox('pixelate')}><EyeOff size={13}/>Pixelate box</button>
              {faceJob ? <div className="ed-add-span"><div className="ed-progress"><i style={{ width: `${faceJob.progress}%` }}/></div><p className="ed-tip">Finding faces… {faceJob.progress}%</p><button className="ed-button wide" onClick={() => { void cancelRenderJob(faceJob.jobId); setFaceJob(null); }}>Cancel</button></div>
                : <button className="ed-button ed-add-span" disabled={!total} onClick={() => { void blurFaces(); }} title="Finds every face in the clip at the playhead and blurs each one"><ScanFace size={14}/>Blur faces</button>}
            </div>
            {faceNote && <p className="ed-tip" role="status">{faceNote}</p>}</section>
        </>}
        {leftTab === 'audio' && <><p className="ed-tip">Adds a song at the playhead. It dips under speech automatically.</p><label className={`ed-button wide ed-music ${addingMusic ? 'busy' : ''}`}>{addingMusic ? <LoaderCircle className="spin" size={15}/> : <Music size={15}/>}{addingMusic ? 'Adding music…' : 'Add music'}
          <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg" disabled={addingMusic} aria-label="Add music" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void addMusic(file); }}/></label>
          <section className="ed-add" aria-label="Your music"><h3 className="ed-sub">Your music</h3>
            {library === null ? <p className="ed-tip">Reading your Music library…</p> : !library.length ? <p className="ed-tip">No music found in {libraryFolder || 'your Music app folder'}.</p> : <>
              <div className="ed-chips" role="group" aria-label="Mood">{([null, ...MOODS] as (Mood | null)[]).map((mood) => <button key={mood ?? 'all'} className={musicMood === mood ? 'on' : ''} aria-pressed={musicMood === mood} onClick={() => setMusicMood(mood)}>{mood ? MOOD_LABELS[mood] : 'All'}</button>)}</div>
              <ul className="ed-tracks">{library.filter((track) => !musicMood || track.mood === musicMood).map((track) => <li key={track.id}>
                <button className="ed-icon small" aria-label={`${listening === track.id ? 'Stop' : 'Listen to'} ${track.name}`} onClick={() => listen(track.id)}>{listening === track.id ? <Pause size={13}/> : <Play size={13}/>}</button>
                <span><b>{track.name}</b><small>{[track.genre, timecode(track.seconds).replace(/\.\d+$/, '')].filter(Boolean).join(' · ')}</small></span>
                <button className="ed-icon small" aria-label={`Add ${track.name} at the playhead`} title="Add at the playhead" disabled={addingMusic} onClick={() => { void addLibraryTrack(track); }}><Plus size={14}/></button></li>)}</ul>
              <p className="ed-tip">From {libraryFolder}. Your files are only read; a track is copied into Kanaa when you use it.</p></>}
          </section></>}
      </aside>
      {mediaOpen ? <Splitter label="Resize media panel" axis="x" value={layout.media} min={LIMITS.media[0]} max={LIMITS.media[1]} sign={1} onChange={(media) => updateLayout({ media })} onReset={() => updateLayout({ media: DEFAULT_LAYOUT.media })}/> : <div className="ed-rail"><button className="ed-icon small" aria-label="Show media panel" title="Show the media panel" onClick={() => updateLayout({ mediaOpen: true })}><PanelLeftOpen size={15}/></button></div>}
      <main className={`ed-stage ${fullScreen ? 'full' : ''}`} ref={stageRef}>
        <div className="ed-frame" style={{ aspectRatio: `${ratio}`, '--ar': ratio } as React.CSSProperties}>
          <canvas ref={canvasRef} aria-label="Preview" onContextMenu={openPreviewMenu} onPointerDown={previewDown} onPointerMove={previewMove} onPointerUp={() => { dragPreview.current = null; }} className={pickingKey ? 'picking' : selected ? 'movable' : ''}/>
          {selected && !selectedLayer?.locked && <MotionPath transform={selected.transform} length={clipLength(selected)} onChange={(transform, group) => updateSelected({ transform }, group)} onSeek={(t) => seek(selected.start + t)}/>}
          {selectedText && !selectedLayer?.locked && <MotionPath transform={selectedText.transform ?? REST_TRANSFORM} length={selectedText.length} onChange={(transform, group) => updateSelectedText({ transform }, group)} onSeek={(t) => seek(selectedText.start + t)}/>}
          {selectedBlur && !selectedLayer?.locked && <MotionPath transform={selectedBlur.transform} length={selectedBlur.length} onChange={(transform, group) => updateSelectedBlur({ transform }, group)} onSeek={(t) => seek(selectedBlur.start + t)}/>}
          {pickingKey && <div className="ed-pick-note" role="status">Click the colour to remove</div>}
          {shaping && <svg className="ed-shape" viewBox="0 0 1 1" preserveAspectRatio="none" aria-label={shaping.mode === 'ground' ? 'Click along the top of the ground' : 'Click around the shape'}
            onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const point: [number, number] = [Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))];
              const first = shaping.points[0];
              if (shaping.mode === 'outline' && first && shaping.points.length >= 3 && Math.hypot(point[0] - first[0], point[1] - first[1]) < SHAPE_CLOSE) { finishShape(); return; }
              setShaping({ ...shaping, points: [...shaping.points, point] });
            }}>
            {shaping.points.length > 0 && (() => { const shape = shaping.mode === 'ground' && shaping.points.length >= 2 ? groundShape(shaping.points) : shaping.points; return <polygon points={shape.map(([x, y]) => `${x},${y}`).join(' ')} className={shaping.mode === 'ground' || shaping.points.length >= 3 ? 'fill' : ''}/>; })()}
            {shaping.points.map(([x, y], index) => <circle key={index} cx={x} cy={y} r="0.008" className={index === 0 && shaping.mode === 'outline' ? 'first' : ''}/>)}
          </svg>}
          {shaping && <div className="ed-pick-note ed-shape-note" role="status">{shaping.mode === 'ground' ? 'Click along the top of the mountain or ground, left to right.' : 'Click around what should stay in front. Click the first point to close.'} Enter finishes, Backspace undoes a point, Esc cancels.</div>}
          {drawing && <div className="ed-draw" aria-label="Drag a box around what to follow" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const at = frameAt(event); drawStart.current = at; setDrawing({ ...drawing, from: at, to: at }); }}
            onPointerMove={(event) => { const from = drawStart.current; const to = frameAt(event); if (from) setDrawing((state) => state && { ...state, from, to }); }} onPointerUp={finishDrawing}>
            <div className="ed-pick-note" role="status">Drag a box around what to follow. Esc cancels.</div>
            {(() => { const box = drawnBox(drawing); return box && <i style={{ left: `${(box[0] - box[2] / 2) * 100}%`, top: `${(box[1] - box[3] / 2) * 100}%`, width: `${box[2] * 100}%`, height: `${box[3] * 100}%` }}/>; })()}
          </div>}
          {safeArea && <div className="ed-safe" aria-hidden="true"><span>Keep titles and faces inside this box</span></div>}
          {isEmpty && !choosingFormat && <div className="ed-empty"><strong>Add a clip to start</strong><span>Pick a video in the Media panel</span></div>}
        </div>
        <div className="ed-transport">
          <span className="ed-clock"><span ref={clockRef}>0:00.00</span> / {timecode(total)}</span>
          <button className="ed-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button>
          <span className="ed-transport-end">
            <button className="ed-icon ed-safe-toggle" aria-pressed={fullScreen} onClick={toggleFullScreen} title={fullScreen ? 'Leave full screen (F or Esc)' : 'Full screen preview (F)'} aria-label={fullScreen ? 'Leave full screen' : 'Full screen preview'}>{fullScreen ? <Shrink size={15}/> : <Expand size={15}/>}{fullScreen ? 'Exit' : 'Full screen'}</button>
          </span>
        </div>
      </main>
      {inspectorOpen ? <Splitter label="Resize settings panel" axis="x" value={layout.inspector} min={LIMITS.inspector[0]} max={LIMITS.inspector[1]} sign={-1} onChange={(inspector) => updateLayout({ inspector })} onReset={() => updateLayout({ inspector: DEFAULT_LAYOUT.inspector })}/> : <div className="ed-rail"><button className="ed-icon small" aria-label="Show settings panel" title="Show the settings panel" onClick={() => updateLayout({ inspectorOpen: true })}><PanelRightOpen size={15}/></button></div>}
      <HelpContext.Provider value={openGuide}>
      <aside className={`ed-inspector ${inspectorOpen ? '' : 'ed-panel-closed'}`} aria-label="Clip settings"><div className="ed-panel-bar ed-hide-small"><button className="ed-icon small" aria-label="Hide settings panel" title="Hide this panel" onClick={() => updateLayout({ inspectorOpen: false })}><PanelRightClose size={15}/></button></div>{selectedIdentity && <div className="ed-selection"><span>{selectedIdentity.kind}</span><strong title={selectedIdentity.name}>{selectedIdentity.name}</strong></div>}{selectedLayer?.locked ? <div className="ed-hint"><h2>Layer locked</h2><p>Unlock this layer on the timeline to change it.</p></div>
        : selectedCaption ? <CaptionInspector caption={selectedCaption.caption} layer={selectedCaption.layer} timing={textTiming(selectedCaption.caption)}
          onText={(text) => change(updateCaption(timeline!, selectedCaption.caption.id, { words: retypeCaption(selectedCaption.caption, text) }), `caption-${selectedCaption.caption.id}`)}
          onLook={(changes, group) => change(updateCaptionLook(timeline!, selectedCaption.layer.id, changes), group)} onRemoveAll={() => { change(setCaptions(timeline!, [], '')); setSelectedId(null); }}/>
        : selectedBlur ? <BlurInspector blur={selectedBlur} timing={textTiming(selectedBlur)} local={blurLocal} onChange={updateSelectedBlur} onSeekLocal={(t) => seek(selectedBlur.start + t)} onPause={pauseEngine} follow={followPanel}/>
        : selectedText ? <TextInspector text={selectedText} onSaveStyle={() => saveStyle(selectedText)} onBehindShape={(mode) => { engineRef.current?.pause(); setShaping({ textId: selectedText.id, mode, points: [] }); }} shaping={Boolean(shaping)} onBehind={(what) => { const ids: [string, string] = [newId(), newId()]; const next = (what === 'person' ? putBehindPerson : putBehindObject)(timeline!, selectedText.id, ids); if (next === timeline) setError('Put the title over a video clip on the main track first.'); else { change(next); setSelectedId(ids[0]); } }} timing={textTiming(selectedText)} local={textLocal} onSeekLocal={(t) => seek(selectedText.start + t)} onPause={pauseEngine} follow={followPanel} onChange={updateSelectedText} onEnter={() => showEnter(selectedText.start, selectedText.enter?.duration ?? 0.5)} onExit={() => showExit(selectedText.start + selectedText.length, selectedText.exit?.duration ?? 0.5)}/>
        : selectedSound ? <SoundInspector sound={selectedSound.sound} timing={soundTiming(selectedSound.sound)} layer={selectedSound.layer} onChange={updateSelectedSound} onLayer={(changes) => change(updateLayer(timeline!, selectedSound.layer.id, changes))}
        stems={stems} job={stemJob?.soundId === selectedSound.sound.id ? stemJob : null} busy={Boolean(stemJob)} onSeparate={(choice) => { void separate(choice); }} onCancelStems={() => { if (stemJob) void cancelRenderJob(stemJob.jobId); }}/>
        : selected ? <Inspector backgrounds={media.filter((item) => item.id !== selected.media_id && (item.media_type === 'video' || item.media_type === 'image'))} onBackground={(item) => newBackground(selected, item)} clip={selected} source={sourceFor(selected.media_id)} format={timeline!.format} onChange={updateSelected} canDetach={!selected.muted && hasSound(selected.media_id)} onDetach={() => detach()}
          local={local} onSeekLocal={(t) => seek(selected.start + t)} onPause={pauseEngine} follow={followPanel} isMain={selectedLayer === mainLayer(timeline!)} copyReady={Boolean(preparedWant(selected) && preparedReady[preparedKey(selected.media_id, ...preparedWant(selected)!)])} onLayout={splitScreen} picking={pickingKey} onPick={startPicking} timing={clipTiming(selected)} overlay={selectedLayer?.kind === 'video' && !selectedLayer.magnetic && selectedLayer !== mainLayer(timeline!) ? selectedLayer : null} onLayer={(changes) => change(updateLayer(timeline!, selectedLayer!.id, changes))} canTransition={clipIndex > 0} closesWithTransition={Boolean(clipsInOrder[clipIndex + 1]?.transition_in)}
          onShowEnter={() => showEnter(selected.start, selected.enter?.duration ?? 0.5)} onShowExit={() => showExit(selected.start + clipLength(selected), selected.exit?.duration ?? 0.5)}
          onShowTransition={() => showEnter(Math.max(0, selected.start - (selected.transition_in?.duration ?? 0.6)), 2 * (selected.transition_in?.duration ?? 0.6))}/> : <div className="ed-hint"><h2>Clip settings</h2><p>Select a clip on the timeline to reframe it, animate it, or change its look, speed and sound.</p><button className="ed-button wide" onClick={() => setShowingHelp(true)}><CircleHelp size={14}/>Guide: how everything works</button></div>}</aside>
      </HelpContext.Provider>
    </div>
    <Splitter label="Resize timeline" axis="y" value={Math.min(layout.timeline, Math.round(window.innerHeight * 0.55))} min={LIMITS.timeline[0]} max={Math.round(window.innerHeight * 0.55)} sign={-1} onChange={(height) => updateLayout({ timeline: height })} onReset={() => updateLayout({ timeline: DEFAULT_LAYOUT.timeline })}/>
    <div className="ed-lower"><div className="ed-tools">
      <span className="ed-tool-group" role="group" aria-label="Edit tools">
        <button className="ed-button" onClick={split} disabled={!total} title="Split at playhead (S)"><Scissors size={15}/>Split</button>
        <button className="ed-button" onClick={() => freeze()} disabled={!total || Boolean(timeline && mainLayer(timeline).locked)} title="Hold the frame at the playhead for 2 seconds"><Snowflake size={15}/>Freeze</button>
        <button className="ed-button" onClick={removeSelected} disabled={(!selected && !selectedSound && !selectedText && !selectedBlur && !selectedCaption) || Boolean(selectedLayer?.locked)} title="Delete (⌫)"><Trash2 size={15}/>Delete</button>
      </span>
      <div className="ed-spacer"/>
      <span className="ed-tool-group" role="group" aria-label="Timeline view">
        <button className="ed-button" disabled={!total} onClick={fitZoom} title="Show the whole video on the timeline">Fit</button>
        <button className="ed-icon" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value / ZOOM_STEP))}><Minus size={15}/></button>
        <button className="ed-icon" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value * ZOOM_STEP))}><Plus size={15}/></button>
        <button className="ed-button" aria-label="More view and help actions" onClick={openViewMenu}><MoreHorizontal size={15}/>More</button>
      </span>
    </div>
    {timeline && <TimelineView timeline={timeline} selectedId={selectedId} zoom={zoom} theme={theme} onItemMenu={openItemMenu} playhead={playhead} source={facts} visuals={(id) => visuals.current.get(id) ?? {}} soundPeaks={soundPeaks} onSelect={setSelectedId} onSeek={seek} onChange={change} onScrubStart={() => engineRef.current?.pause()}/>}
    </div></div>
    {menu && <ContextMenu menu={menu} onClose={closeMenu}/>}
    {filing && <FolderDialog item={filing} folders={folders} onClose={() => setFiling(null)} onSaved={(saved) => setMedia((current) => current.map((item) => (item.id === filing.id ? { ...item, folder: saved } : item)))}/>}
    {deleting && <DeleteMediaDialog item={deleting} onClose={() => setDeleting(null)} onDeleted={() => setMedia((current) => current.filter((item) => item.id !== deleting.id))}/>}
    {showingHelp && <Guide article={guideArticle} shortcuts={SHORTCUTS} onClose={() => setShowingHelp(false)} onResetLayout={resetLayout}/>}
    {choosingFormat && timeline && <FormatDialog clipFormat={photo.width && photo.height ? { width: photo.width - photo.width % 2, height: photo.height - photo.height % 2, fps: 30 } : null} current={timeline.format} onChoose={chooseFormat}/>}
    {exporting && timeline && <ExportDialog timeline={timeline} projectId={projectId} withSound={hasAudibleAudio} onNormalize={(normalize_audio) => change({ ...timeline, normalize_audio })} onClose={() => setExporting(false)} onOpen={onOpenOutput}/>}
    {creatingCoverArt && timeline && <CoverArtGenerator
      projectId={projectId}
      canvas={timeline.format.width === timeline.format.height ? 'square' : timeline.format.width > timeline.format.height ? 'landscape' : 'portrait'}
      onClose={() => setCreatingCoverArt(false)}
      onCreated={(item) => { setMedia((current) => current.some((entry) => entry.id === item.id) ? current : [item, ...current]); setLeftTab('media'); }}/>
    }
  </div>;
}

const SHORTCUTS: [string, string][] = [['Space', 'Play or pause'], ['F', 'Full screen preview'], ['S', 'Split at the playhead'], ['Delete', 'Delete the selected item'], ['I / O', 'Trim the clip start or end to the playhead'], ['← →', 'Move one frame (Shift for ten)'], ['J / K / L', 'Back a second, pause, play faster'], ['⌘Z / ⇧⌘Z', 'Undo and redo'], ['?', 'Show this guide']];


function FormatDialog({ clipFormat, current, onChoose }: { clipFormat: Format | null; current: Format; onChoose: (format: Format) => void }) {
  return <div className="ed-modal" role="dialog" aria-modal="true" aria-label="Choose a format"><div className="ed-card">
    <h2>Where will you post this?</h2><p>You can change this at any time.</p>
    <div className="ed-formats">{FORMATS.map((format) => <button key={format.id} onClick={() => onChoose({ ...current, width: format.width, height: format.height })}>
      <i style={{ aspectRatio: `${format.width} / ${format.height}` }}/><strong>{format.label}</strong><span>{format.ratio}</span></button>)}
      {clipFormat && <button onClick={() => onChoose({ ...clipFormat, width: Math.min(clipFormat.width, 3840), height: Math.min(clipFormat.height, 3840) })}><i style={{ aspectRatio: `${clipFormat.width} / ${clipFormat.height}` }}/><strong>Same as my clip</strong><span>{clipFormat.width} × {clipFormat.height}</span></button>}
    </div></div></div>;
}

function Timing({ fields }: { fields: TimeFieldProps[] }) {
  return <div className="ed-timing">{fields.map((field) => <TimeField key={field.label} {...field}/>)}</div>;
}

/** Who stays: everyone, or the people or objects chosen from a numbered picture of the clip. */
function WhoStays({ clip, onChange, local, sourceDuration }: { clip: Clip; onChange: (changes: Partial<Clip>) => void; local: number; sourceDuration?: number | null }) {
  const kind = clip.cutout_pick?.kind ?? 'people';
  const ids = clip.cutout_pick?.ids ?? null;
  const steady = Boolean(clip.stabilise); const backwards = Boolean(clip.reverse) && clip.freeze == null;
  const [found, setFound] = useState<{ key: string; tracks: FoundOne[] | null; progress: number; problem?: string }>({ key: '', tracks: null, progress: 0 });
  const key = `${clip.media_id}:${kind}:${steady}:${backwards}`;
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const status = await requestInstances(clip.media_id, kind, steady, backwards);
        if (stopped) return;
        setFound({ key, tracks: status.status === 'ready' ? status.tracks ?? [] : null, progress: status.progress ?? 0 });
        if (status.status !== 'ready') timer = setTimeout(check, ASSET_POLL_MS);
      } catch (problem) { if (!stopped) setFound({ key, tracks: null, progress: 0, problem: (problem as Error).message }); }
    };
    void check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [key, clip.media_id, kind, steady, backwards]);
  const tracks = found.key === key ? found.tracks : null;
  const everyone = kind === 'people' ? 'Everyone' : 'All of them';
  const blur = clip.cutout === 'blur';
  const toggle = (id: number) => {
    const chosen = ids ?? [];
    const next = chosen.includes(id) ? chosen.filter((other) => other !== id) : [...chosen, id];
    pick({ kind, ids: next.length ? next.sort((a, b) => a - b) : null });
  };
  const pick = (cutout_pick: CutoutPick | null) => onChange({ cutout_pick });
  const pull = blur ? clip.focus_pull ?? null : null;
  const pullTo = (id: number | null) => {
    if (!pull) return;
    if (id === null) { onChange({ focus_pull: { ...pull, to: null } }); return; }
    const chosen = pull.to ?? [];
    const next = chosen.includes(id) ? chosen.filter((other) => other !== id) : [...chosen, id];
    onChange({ focus_pull: { ...pull, to: next.length ? next.sort((a, b) => a - b) : null } });
  };
  const startPull = () => {
    const other = tracks?.find((track) => !ids?.includes(track.id));
    onChange({ focus_pull: { to: ids ? (other ? [other.id] : null) : tracks?.[1] ? [tracks[1].id] : null, at: focusAt(clip, local, sourceDuration), length: 1 } });
  };
  return <div className="ed-who">
    <span className="ed-who-title">{blur ? 'Who stays in focus' : 'Who stays in front'}</span>
    <Chips label="Find" options={[{ id: 'people' as const, label: 'People' }, { id: 'objects' as const, label: 'Objects' }]} value={kind} onPick={(next) => onChange({ cutout_pick: next === 'people' ? null : { kind: next, ids: null }, focus_pull: null })}/>
    {found.key === key && found.problem ? <p className="ed-tip">{found.problem}</p>
      : !tracks ? <p className="ed-tip">Finding each {kind === 'people' ? 'person' : 'object'}… {found.progress ? `${found.progress}%` : ''}</p>
      : !tracks.length ? <p className="ed-tip">{kind === 'people' ? 'No people were found in this clip.' : 'No objects stood out in this clip. Try drawing around it instead.'}</p>
      : <>
        <img className="ed-who-picture" src={`${instancesPictureUrl(clip.media_id, kind, steady, backwards)}&v=${tracks.map((track) => track.id).join('-')}`} alt={`The clip with each ${kind === 'people' ? 'person' : 'object'} numbered`}/>
        <div className="ed-chips" role="group" aria-label={blur ? 'Who stays in focus' : 'Who stays in front'}>
          <button className={ids ? '' : 'on'} aria-pressed={!ids} onClick={() => pick(kind === 'people' ? null : { kind, ids: null })}>{everyone}</button>
          {tracks.map((track) => <button key={track.id} className={ids?.includes(track.id) ? 'on' : ''} aria-pressed={Boolean(ids?.includes(track.id))} onClick={() => toggle(track.id)}><i className="ed-who-dot" style={{ background: track.colour }}/>{track.label}</button>)}
        </div>
        {tracks.length > 1 && <p className="ed-tip">{blur ? 'The ones you choose stay sharp; the rest blur with the background.' : 'The ones you choose stay in front of the title; the rest go behind it.'}</p>}
        {blur && tracks.length > 0 && (!pull ? <button className="ed-button wide" onClick={startPull} title="Part way through, the focus moves to someone else, like a film camera"><Crosshair size={14}/>Pull focus at the playhead</button>
          : <div className="ed-pull">
            <span className="ed-who-title">Then the focus moves to</span>
            <div className="ed-chips" role="group" aria-label="Focus moves to">
              <button className={pull.to ? '' : 'on'} aria-pressed={!pull.to} onClick={() => pullTo(null)}>{everyone}</button>
              {tracks.map((track) => <button key={track.id} className={pull.to?.includes(track.id) ? 'on' : ''} aria-pressed={Boolean(pull.to?.includes(track.id))} onClick={() => pullTo(track.id)}><i className="ed-who-dot" style={{ background: track.colour }}/>{track.label}</button>)}
            </div>
            <div className="ed-add-row"><span>At {timecode(Math.max(0, focusLocal(clip, pull.at, sourceDuration)))}</span><button className="ed-button" onClick={() => onChange({ focus_pull: { ...pull, at: focusAt(clip, local, sourceDuration) } })}>Move to playhead</button></div>
            <Chips label="Focus speed" options={PULL_SPEEDS} value={PULL_SPEEDS.find((speed) => Number(speed.id) === pull.length)?.id ?? null} onPick={(id) => onChange({ focus_pull: { ...pull, length: Number(id) } })}/>
            <button className="ed-button wide" onClick={() => onChange({ focus_pull: null })}><X size={14}/>Remove focus pull</button>
          </div>)}
      </>}
  </div>;
}

function Chips<T extends string>({ label, options, value, onPick }: { label: string; options: { id: T; label: string }[]; value: T | null; onPick: (id: T) => void }) {
  return <div className="ed-chips" role="group" aria-label={label}>{options.map((option) => <button key={option.id} className={value === option.id ? 'on' : ''} aria-pressed={value === option.id} onClick={() => onPick(option.id)}>{option.label}</button>)}</div>;
}

function AnimationPicker({ label, value, onChange, onShow }: { label: string; value?: Animation | null; onChange: (value: Animation | null, group?: string) => void; onShow: () => void }) {
  const pick = (id: Preset | 'none') => {
    onChange(id === 'none' ? null : { preset: id, duration: value?.duration ?? 0.5 });
    if (id !== 'none') setTimeout(onShow, 60);
  };
  return <>
    <h3 className="ed-sub">{label}</h3>
    <Chips label={label} options={[{ id: 'none' as const, label: 'None' }, ...PRESETS]} value={value?.preset ?? 'none'} onPick={pick}/>
    {value && <ValueSlider label="Length" value={value.duration} min={0.1} max={3} step={0.1} defaultValue={0.5} unit="s" decimals={1} onChange={(duration, group) => onChange({ ...value, duration }, group)}/>}
  </>;
}

/** Bundled Tamil fonts load from Kanaa itself, so each button shows its font. English ones are already on the Mac. */
let fontsLoaded = false;
function loadBundledFonts() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  const rules = TAMIL_FONTS.filter((font) => font.file).map((font) => `@font-face{font-family:"${font.family}";src:url("/api/fonts/${font.file}") format("truetype");font-display:swap}`).join('');
  const style = document.createElement('style'); style.textContent = rules; document.head.appendChild(style);
}

function FontPicker({ label, fonts, value, sample, onPick }: { label: string; fonts: FontChoice[]; value: string; sample: string; onPick: (family: string) => void }) {
  useEffect(loadBundledFonts, []);
  return <><h3 className="ed-sub">{label}</h3><div className="ed-fonts" role="group" aria-label={label}>{fonts.map((font) => <button key={font.family} className={value === font.family ? 'on' : ''} aria-pressed={value === font.family} title={font.label} onClick={() => onPick(font.family)}>
    <b style={{ fontFamily: `"${font.family}"` }}>{sample}</b><span>{font.label}</span></button>)}</div></>;
}

function TextInspector({ text, onSaveStyle, onBehind, onBehindShape, shaping, timing, local, onSeekLocal, onPause, follow, onChange, onEnter, onExit }: { text: TextItem; onSaveStyle: () => void; onBehind: (what: 'person' | 'object') => void; onBehindShape: (mode: 'ground' | 'outline') => void; shaping: boolean; timing: TimeFieldProps[]; local: number; onSeekLocal: (t: number) => void; onPause: () => void; follow: React.ReactNode; onChange: (changes: Partial<TextItem>, group?: string) => void; onEnter: () => void; onExit: () => void }) {
  // The words as typed: they may be empty for a moment while retyping. A title can't be empty, so only words are
  // saved, and leaving the box empty puts the last words back.
  const [draft, setDraft] = useState(text.text);
  useEffect(() => { setDraft(text.text); }, [text.id, text.text]);
  return <Panel id="title" tabs={[{ id: 'words', label: 'Words', Icon: Type }, { id: 'style', label: 'Style', Icon: Palette }, { id: 'motion', label: 'Motion', Icon: Move, changed: Boolean(text.enter || text.exit || Object.keys(text.transform?.keyframes ?? {}).length) }]}>
    <Group title="Timing" startOpen keywords="when start length duration" help="timing-and-trimming">
      <Timing fields={timing}/>
    </Group>
    <Group title="Words" tab="words" startOpen keywords="text title words tamil english subtitle type" tip="Type in Tamil or English; a subtitle adds a small line." help="titles">
      <textarea className="ed-text" aria-label="Title" lang="ta" value={draft} placeholder="Type your title" maxLength={500} rows={2} onChange={(event) => { setDraft(event.target.value); if (event.target.value.trim()) onChange({ text: event.target.value }, `text-${text.id}`); }} onBlur={() => { if (!draft.trim()) setDraft(text.text); }}/>
      <textarea className="ed-text" aria-label="Subtitle" lang="ta" placeholder="Subtitle (optional)" value={text.subtitle ?? ''} maxLength={200} rows={1} onChange={(event) => onChange({ subtitle: event.target.value || null }, `subtitle-${text.id}`)}/>
    </Group>
    {text.subtitle && <Group title="Subtitle" tab="words" keywords="subtitle small line spacing">
      <ValueSlider label="Size" value={text.subtitle_size ?? Math.round(Math.max(20, text.size) * 0.55)} min={10} max={100} step={1} defaultValue={Math.round(Math.max(20, text.size) * 0.55)} onChange={(subtitle_size, group) => onChange({ subtitle_size: Math.round(subtitle_size) }, group)}/>
      <ValueSlider label="Letter spacing" value={text.subtitle_spacing ?? 0} min={0} max={30} step={1} defaultValue={0} onChange={(spacing, group) => onChange({ subtitle_spacing: Math.round(spacing) }, group)}/>
      <label className="ed-color"><span>Colour</span><input type="color" aria-label="Subtitle colour" value={text.subtitle_color ?? text.color} onChange={(event) => onChange({ subtitle_color: event.target.value }, `subcolor-${text.id}`)}/></label>
      <Chips label="Subtitle place" options={[{ id: 'below' as const, label: 'Below the title' }, { id: 'above' as const, label: 'Above it' }]} value={text.subtitle_above ? 'above' : 'below'} onPick={(place) => onChange({ subtitle_above: place === 'above' })}/>
    </Group>}
    <Group title="Style" tab="style" startOpen keywords="font bigger size colour color band shadow outline style look" tip="Choose a style, size and colour. Drag the title in the preview to move it." help="title-styles">
      <Chips label="Style" options={[{ id: 'band', label: 'Band' }, { id: 'shadow', label: 'Shadow' }, { id: 'outline', label: 'Outline' }]} value={text.style} onPick={(style) => onChange({ style })}/>
      <ValueSlider label="Size" value={text.size} min={20} max={100} step={1} defaultValue={44} onChange={(size, group) => onChange({ size }, group)}/>
      <label className="ed-color"><span>Colour</span><input type="color" aria-label="Text colour" value={text.color} onChange={(event) => onChange({ color: event.target.value }, `color-${text.id}`)}/></label>
      <More>
      <Chips label="Position" options={[{ id: 'top', label: 'Top' }, { id: 'center', label: 'Middle' }, { id: 'bottom', label: 'Bottom' }]} value={text.position} onPick={(position) => onChange({ position })}/>
      <Chips label="Alignment" options={[{ id: 'left' as const, label: 'Left' }, { id: 'center' as const, label: 'Centre' }, { id: 'right' as const, label: 'Right' }]} value={text.align ?? 'center'} onPick={(align) => onChange({ align })}/>
      <FontPicker label="English font" fonts={ENGLISH_FONTS} value={text.font ?? 'Noto Sans'} sample="Aa" onPick={(font) => onChange({ font: font === 'Noto Sans' ? null : font })}/>
      <FontPicker label="Tamil font" fonts={TAMIL_FONTS} value={text.tamil_font ?? 'Noto Sans Tamil'} sample="அ" onPick={(tamil_font) => onChange({ tamil_font: tamil_font === 'Noto Sans Tamil' ? null : tamil_font })}/>
      {text.style === 'band' && <label className="ed-color"><span>Band colour</span><input type="color" aria-label="Band colour" value={text.band_color ?? '#000000'} onChange={(event) => onChange({ band_color: event.target.value }, `band-${text.id}`)}/></label>}
    <button className="ed-button wide" onClick={onSaveStyle} title="Keep this look in Text, under My styles, for any video"><Bookmark size={14}/>Save as my style</button>
      </More>
    </Group>
    <Group title="Animation" tab="motion" startOpen changed={Boolean(text.enter || text.exit)} keywords="animation entrance exit fade slide pop" tip="How the title appears and leaves." help="animations-and-moves">
      <AnimationPicker label="Enter" value={text.enter} onChange={(enter, group) => onChange({ enter }, group)} onShow={onEnter}/>
      <AnimationPicker label="Exit" value={text.exit} onChange={(exit, group) => onChange({ exit }, group)} onShow={onExit}/>
    </Group>
    <Group title="Put the title behind…" tab="motion" startOpen keywords="behind depth mountain person in front object car skyline" tip="People, cars or hills stand in front of your title." help="title-behind">
    <div className="ed-add-grid">
      <button className="ed-button" onClick={() => onBehind('person')} title="People in the video stay in front of this title. With several, choose who."><Users size={14}/>People</button>
      <button className="ed-button" onClick={() => onBehind('object')} title="Found automatically: a car, a bus, an animal. Choose which stay in front."><Car size={14}/>An object</button>
      <button className={`ed-button ${shaping ? 'on' : ''}`} onClick={() => onBehindShape('ground')} title="Click along the top of a mountain, hill, skyline or the ground. Everything below stays in front."><Mountain size={14}/>Skyline / ground</button>
      <button className={`ed-button ${shaping ? 'on' : ''}`} onClick={() => onBehindShape('outline')} title="Draw around a building, tree or anything still. It stays in front of the title."><PenTool size={14}/>Draw around it</button>
    </div>
    <p className="ed-group-tip">People and objects are found and followed as they move. A drawn shape stays still, so it suits a tripod shot. Pick Slide up as the Enter animation to make the title rise from behind.</p>
    </Group>
    <Group title="Moves" tab="motion" changed={Object.keys(text.transform?.keyframes ?? {}).length > 0} keywords="move position size tilt see-through animate keyframe" help="animations-and-moves">
      <MotionPanel transform={text.transform ?? REST_TRANSFORM} local={local} length={text.length} onChange={(transform, group) => onChange({ transform }, group)} onSeek={onSeekLocal} onGestureStart={onPause}/>
    </Group>
    <Group title="Follow movement" tab="motion" startOpen={Boolean(text.transform?.keyframes?.x?.length)} keywords="track follow stick moving person" tip="Draw a box around something and the title follows it." help="follow-movement">{follow}</Group>
  </Panel>;
}

function SoundControls({ item, length, onChange }: { item: { volume: number; fade_in: number; fade_out: number }; length: number; onChange: (changes: { volume?: number; fade_in?: number; fade_out?: number }, group?: string) => void }) {
  const longest = Math.min(MAX_FADE_SECONDS, length);
  return <>
    <ValueSlider label="Volume" value={item.volume} min={0} max={2} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(volume, group) => onChange({ volume }, group)}/>
    <ValueSlider label="Fade in" value={Math.min(item.fade_in, longest)} min={0} max={longest} step={0.1} defaultValue={0} unit="s" decimals={1} onChange={(fade_in, group) => onChange({ fade_in }, group)}/>
    <ValueSlider label="Fade out" value={Math.min(item.fade_out, longest)} min={0} max={longest} step={0.1} defaultValue={0} unit="s" decimals={1} onChange={(fade_out, group) => onChange({ fade_out }, group)}/>
  </>;
}

function SoundInspector({ sound, timing, layer, onChange, onLayer, stems, job, busy, onSeparate, onCancelStems }: { sound: Sound; timing: TimeFieldProps[]; layer: AudioLayer; onChange: (changes: Partial<Sound>, group?: string) => void; onLayer: (changes: Partial<AudioLayer>) => void;
  stems: { available: boolean; install_command: string } | null; job: StemJob | null; busy: boolean; onSeparate: (choice: StemChoice) => void; onCancelStems: () => void }) {
  return <Panel id="sound" tabs={[{ id: 'volume', label: 'Volume', Icon: Volume2, changed: sound.muted || sound.volume !== 1 }, { id: 'voice', label: 'Voice', Icon: Mic, changed: Boolean(sound.clean_voice) }]}>
    <p className="ed-name" title={sound.name}>{sound.name}</p>
    <Group title="Timing" startOpen keywords="when start length duration trim" help="timing-and-trimming">
    <Timing fields={timing}/>
    </Group>
    <Group title="Volume" tab="volume" startOpen keywords="volume mute louder quiet fade speed dip duck music" tip="Set loudness and fades; music dips by itself while people talk." help="music-volume-ducking">
    <div className="ed-pair">
      <button className={`ed-button ${sound.muted ? 'on' : ''}`} aria-pressed={sound.muted} onClick={() => onChange({ muted: !sound.muted })}>{sound.muted ? <VolumeX size={14}/> : <Volume2 size={14}/>}Mute</button>
    </div>
    <SoundControls item={sound} length={soundLength(sound)} onChange={onChange}/>
    <label className="ed-check"><input type="checkbox" checked={sound.duck} onChange={(event) => onChange({ duck: event.target.checked })}/><span>Dip under speech<small>Lowers this sound while your clips or other sounds play.</small></span></label>
      <More>
    <ValueSlider label="Speed" value={sound.speed} min={0.25} max={4} step={0.05} defaultValue={1} unit="×" decimals={2} onChange={(speed, group) => onChange({ speed }, group)}/>
      <div className="ed-pair"><button className={`ed-button ${layer.muted ? 'on' : ''}`} aria-pressed={Boolean(layer.muted)} onClick={() => onLayer({ muted: !layer.muted })}>Mute track</button></div>
      </More>
    </Group>
    <Group title="Voice" tab="voice" startOpen keywords="clean voice noise karaoke vocals instrumental singing remove" tip="Clean up a voice, or take the singing out of a song." help="voice-and-vocals">
    <label className="ed-check"><input type="checkbox" checked={Boolean(sound.clean_voice)} onChange={(event) => onChange({ clean_voice: event.target.checked })}/><span>Clean voice<small>Removes steady background noise like fans, AC and hiss. Made once, in the background.</small></span></label>
    {!stems?.available ? <p className="ed-tip">Voice separation is an optional add-on. To install it, run <code>{stems?.install_command ?? './install-stems.sh'}</code> in the Kanaa folder, then restart Kanaa.</p>
      : job ? <><div className="ed-progress"><i style={{ width: `${job.progress}%` }}/></div><p className="ed-tip">Separating… {job.progress}%. This can take a few minutes, and you can keep editing.</p><button className="ed-button wide" onClick={onCancelStems}>Cancel</button></>
        : <div className="ed-stack">
          <button className="ed-button wide" disabled={busy} onClick={() => onSeparate('music')}>Remove vocals</button>
          <button className="ed-button wide" disabled={busy} onClick={() => onSeparate('vocals')}>Keep only vocals</button>
          <button className="ed-button wide" disabled={busy} onClick={() => onSeparate('both')}>Split into two tracks</button>
        </div>}
    </Group>
  </Panel>;
}

function Inspector({ backgrounds, onBackground, clip, source, format, onChange, canDetach, onDetach, local, onSeekLocal, onPause, follow, isMain, copyReady, onLayout, picking, onPick, timing, overlay, onLayer, canTransition, closesWithTransition, onShowEnter, onShowExit, onShowTransition }: { backgrounds: Photo[]; onBackground: (item: Photo) => void; clip: Clip; source?: PlaybackSource; format: Format; onChange: (changes: Partial<Clip>, group?: string) => void; canDetach: boolean; onDetach: () => void; local: number; onSeekLocal: (t: number) => void; onPause: () => void; follow: React.ReactNode; isMain: boolean; copyReady: boolean; onLayout: (layout: 'side' | 'stack') => void; picking: boolean; onPick: () => void; timing: TimeFieldProps[]; overlay: VideoLayer | null; onLayer: (changes: Partial<VideoLayer>) => void; canTransition: boolean; closesWithTransition: boolean; onShowEnter: () => void; onShowExit: () => void; onShowTransition: () => void }) {
  const transition: Transition | null = clip.transition_in ?? null;
  const adjust = (changes: Partial<Adjust>, group?: string) => onChange({ adjust: { ...clip.adjust, ...changes } }, group);
  const fill = source ? fillScale(source, clip.adjust.rotation, format) : 1;
  const size = valueAt(clip.transform, 'scale', local);
  const filling = Math.abs(size - fill) < 0.01;
  const place = (scale: number) => writeValue(writeValue(writeValue(clip.transform, 'x', local, 0.5), 'y', local, 0.5), 'scale', local, scale);
  return <>
    <Panel id="clip" tabs={[{ id: 'frame', label: 'Frame', Icon: Crop }, { id: 'look', label: 'Look', Icon: Palette, changed: (clip.look ?? 'none') !== 'none' }, { id: 'background', label: 'Backdrop', Icon: WandSparkles, changed: Boolean(clip.cutout || clip.chroma) },
      { id: 'motion', label: 'Motion', Icon: Move, changed: Boolean(clip.enter || clip.exit || clip.transition_in || Object.keys(clip.transform.keyframes ?? {}).length) }, ...(source?.kind === 'video' && clip.freeze == null ? [{ id: 'sound', label: 'Sound', Icon: Volume2, changed: clip.speed !== 1 || clip.muted || Boolean(clip.ramp) }] : [])]}>
    <Group title="Timing" startOpen keywords="trim cut shorten length start end from to" help="timing-and-trimming"><Timing fields={timing}/></Group>
    <Group title="Frame" tab="frame" startOpen keywords="fit fill crop zoom rotate turn sideways mirror flip" tip="Fit shows everything; Fill covers the screen. Drag the picture to move it." help="framing-and-rotating">
    <div className="ed-pair">
      <button className={`ed-button ${!filling && size === 1 ? 'on' : ''}`} onClick={() => onChange({ transform: place(1) })}><Minimize size={14}/>Fit</button>
      <button className={`ed-button ${filling ? 'on' : ''}`} onClick={() => onChange({ transform: place(fill) })}><Maximize size={14}/>Fill</button>
    </div>
    <div className="ed-pair">
      <button className="ed-icon" aria-label="Rotate left" onClick={() => adjust({ rotation: ((clip.adjust.rotation + 270) % 360) as Adjust['rotation'] })}><RotateCcw size={16}/></button>
      <button className="ed-icon" aria-label="Rotate right" onClick={() => adjust({ rotation: ((clip.adjust.rotation + 90) % 360) as Adjust['rotation'] })}><RotateCw size={16}/></button>
      <button className={`ed-icon ${clip.adjust.flip_horizontal ? 'on' : ''}`} aria-label="Flip horizontally" onClick={() => adjust({ flip_horizontal: !clip.adjust.flip_horizontal })}><FlipHorizontal size={16}/></button>
      <button className={`ed-icon ${clip.adjust.flip_vertical ? 'on' : ''}`} aria-label="Flip vertically" onClick={() => adjust({ flip_vertical: !clip.adjust.flip_vertical })}><FlipVertical size={16}/></button>
    </div>
    <More>
    {source?.kind === 'video' && <label className="ed-check"><input type="checkbox" checked={Boolean(clip.stabilise)} onChange={(event) => onChange({ stabilise: event.target.checked })}/><span>Steady shaky video<small>{clip.stabilise && !copyReady ? 'Making a steady copy… The preview shows the original until it is ready.' : 'Removes hand shake and zooms in a little to hide the moving edges.'}</small></span></label>}
    {overlay && source && <>
      <h3 className="ed-sub">Corner</h3>
      <Chips label="Corner" options={CORNERS} value={null} onPick={(corner) => { const spot = cornerPlacement(source, clip.adjust.rotation, format, size, corner); onChange({ transform: writeValue(writeValue(clip.transform, 'x', local, spot.x), 'y', local, spot.y) }); }}/>
      <h3 className="ed-sub">Split screen</h3>
      <Chips label="Split screen" options={[{ id: 'side' as const, label: 'Side by side' }, { id: 'stack' as const, label: 'Top and bottom' }]} value={null} onPick={onLayout}/>
      <h3 className="ed-sub">Blend</h3>
      <Chips label="Blend" options={BLENDS} value={overlay.blend ?? 'normal'} onPick={(blend) => onLayer({ blend })}/>
    </>}
    </More>
    </Group>
    {clip.freeze != null && <Group title="Frozen frame" tab="frame" startOpen keywords="still hold pause freeze"><p className="ed-tip">This holds one frame. Change how long with Duration in Timing. It has no sound.</p></Group>}
    <Group title="Colour" tab="look" startOpen changed={(clip.look ?? 'none') !== 'none' || clip.adjust.brightness !== 1 || clip.adjust.contrast !== 1 || clip.adjust.saturation !== 1} keywords="filter colour color brighter dark black and white warm vintage look" tip="Pick a look, then fine-tune the brightness." help="colour-and-looks">
    <Chips label="Look" options={LOOK_NAMES} value={clip.look ?? 'none'} onPick={(look) => onChange({ look })}/>
    <ValueSlider label="Brightness" value={clip.adjust.brightness} min={0.25} max={2} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(brightness, group) => adjust({ brightness }, group)}/>
    <More>
    <ValueSlider label="Contrast" value={clip.adjust.contrast} min={0.25} max={2} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(contrast, group) => adjust({ contrast }, group)}/>
    <ValueSlider label="Colour strength" value={clip.adjust.saturation} min={0} max={2} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(saturation, group) => adjust({ saturation }, group)}/>
    </More>
    </Group>
    {source?.kind === 'video' && <Group title="Background" tab="background" startOpen changed={Boolean(clip.cutout)} keywords="blur background portrait remove replace focus bokeh cut out person who stays" tip="Blur or remove what's behind people, and choose who stays sharp." help="background-blur-remove">
      <Chips label="Background" options={[{ id: 'keep' as const, label: 'Keep' }, { id: 'blur' as const, label: 'Blur' }, { id: 'remove' as const, label: 'Remove' }]} value={clip.cutout ?? 'keep'} onPick={(id) => onChange(id === 'keep' ? { cutout: null, cutout_pick: null, focus_pull: null } : id === 'remove' ? { cutout: id, focus_pull: null } : { cutout: id })}/>
      {clip.cutout === 'blur' && <div className="ed-strength"><span className="ed-who-title">Blur strength</span><Chips label="Blur strength" options={BLUR_AMOUNTS} value={clip.blur_amount ?? 'medium'} onPick={(blur_amount) => onChange({ blur_amount })}/></div>}
      {clip.cutout && <WhoStays clip={clip} onChange={onChange} local={local} sourceDuration={source?.duration}/>}
      {clip.cutout === 'remove' && <div className="ed-strength"><span className="ed-who-title">New background</span>
        {backgrounds.length ? <div className="ed-media-grid ed-backgrounds">{backgrounds.map((item) => <button key={item.id} className="ed-tile-add" onClick={() => onBackground(item)} title={`Put ${item.filename} behind, filling the frame`}><img src={photoThumbUrl(item.id)} alt="" loading="lazy"/><span className="ed-tile-label"><b>{item.filename}</b></span></button>)}</div>
          : <p className="ed-tip">Import a picture or video in Media, then choose it here.</p>}
        <p className="ed-tip">It fills the whole frame, behind {isMain ? 'this clip' : 'the cut-out'}. A shorter video plays slower to cover it.</p></div>}
      {clip.cutout && <p className="ed-tip">{!copyReady ? `${clip.cutout === 'blur' ? 'Blurring the background' : `Finding ${clip.cutout_pick?.kind === 'objects' ? 'the objects' : clip.cutout_pick?.ids ? 'the chosen people' : 'the person'}`}… This runs in the background, and the preview shows the original until it is ready.`
        : clip.cutout === 'blur' ? 'Who you choose stays sharp and everything else is softened, like a film camera focused on them.' : isMain ? 'The person shows over black until you choose a new background below.' : 'The person shows over whatever is under this layer.'}</p>}
    </Group>}
    <Group title="Green screen" tab="background" startOpen={Boolean(clip.chroma) || source?.kind !== 'video'} changed={Boolean(clip.chroma)} keywords="green screen chroma key transparent blue" tip="Click the green or blue in the preview to make it see-through." help="green-screen">
    {clip.chroma ? <>
      <div className="ed-key-color"><label><span className="ed-key-swatch" style={{ background: clip.chroma.color }}/><input type="color" aria-label="Colour to remove" value={clip.chroma.color} onChange={(event) => onChange({ chroma: { ...clip.chroma!, color: event.target.value } }, `key-colour-${clip.id}`)}/></label>
        <button className={`ed-button ${picking ? 'on' : ''}`} onClick={onPick}><Pipette size={14}/>{picking ? 'Click the preview' : 'Pick from preview'}</button></div>
      <ValueSlider label="Strength" value={clip.chroma.similarity} min={0.001} max={0.5} step={0.001} defaultValue={DEFAULT_CHROMA.similarity} unit="%" factor={100} decimals={1} onChange={(similarity, group) => onChange({ chroma: { ...clip.chroma!, similarity } }, group)}/>
      <ValueSlider label="Soft edges" value={clip.chroma.softness} min={0.001} max={0.5} step={0.001} defaultValue={DEFAULT_CHROMA.softness} unit="%" factor={100} decimals={1} onChange={(softness, group) => onChange({ chroma: { ...clip.chroma!, softness } }, group)}/>
      <ValueSlider label="Clean up green edges" value={clip.chroma.spill} min={0} max={1} step={0.01} defaultValue={DEFAULT_CHROMA.spill} unit="%" factor={100} onChange={(spill, group) => onChange({ chroma: { ...clip.chroma!, spill } }, group)}/>
      <button className="ed-button wide" onClick={() => onChange({ chroma: null })}>Turn off</button>
    </> : <>
      <p className="ed-tip">Removes a green or blue screen. Add the clip as an overlay to put something behind it.</p>
      <button className="ed-button wide" onClick={() => { onChange({ chroma: DEFAULT_CHROMA }); onPick(); }}><Pipette size={14}/>Remove a colour</button>
    </>}
    </Group>
    <Group title="Animation" tab="motion" startOpen changed={Boolean(clip.enter || clip.exit || clip.transition_in)} keywords="animation entrance exit transition fade slide" tip="How it appears, leaves, and joins the clip before." help="animations-and-moves">
    {canTransition && <>
      <h3 className="ed-sub">Transition from the last clip</h3>
      <Chips label="Transition" options={[{ id: 'none' as const, label: 'None' }, ...TRANSITIONS]} value={transition?.kind ?? 'none'} onPick={(kind) => { onChange({ transition_in: kind === 'none' ? null : { kind, duration: transition?.duration ?? 0.6 } }); if (kind !== 'none') setTimeout(onShowTransition, 60); }}/>
      {transition && <ValueSlider label="Length" value={transition.duration} min={0.2} max={2} step={0.1} defaultValue={0.6} unit="s" decimals={1} onChange={(duration, group) => onChange({ transition_in: { ...transition, duration } }, group)}/>}
    </>}
    {transition ? <p className="ed-tip">The transition replaces this clip's enter animation.</p> : <AnimationPicker label="Enter" value={clip.enter} onChange={(enter, group) => onChange({ enter }, group)} onShow={onShowEnter}/>}
    {closesWithTransition ? <p className="ed-tip">The next clip's transition replaces this clip's exit animation.</p> : <AnimationPicker label="Exit" value={clip.exit} onChange={(exit, group) => onChange({ exit }, group)} onShow={onShowExit}/>}
    </Group>
    <Group title="Moves" tab="motion" startOpen changed={Object.keys(clip.transform.keyframes ?? {}).length > 0} keywords="zoom in push pull shake move keyframe position size tilt see-through animate" tip="A gentle zoom in one click; More lets you animate anything." help="animations-and-moves">
    <div className="ed-chips" role="group" aria-label="Quick moves">{MOVES.map((move) => <button key={move.id} title={move.tip} onClick={() => onChange({ transform: applyMove(clip.transform, move.id, local, (clip.out - clip.in) / clip.speed) })}>{move.label}</button>)}</div>
    <More label="Animate position, size and more">
    <MotionPanel transform={clip.transform} local={local} length={(clip.out - clip.in) / clip.speed} onChange={(transform, group) => onChange({ transform }, group)} onSeek={onSeekLocal} onGestureStart={onPause}/>
    </More>
    </Group>
    {follow && <Group title="Follow movement" tab="motion" startOpen={Boolean(clip.transform.keyframes?.x?.length)} keywords="track follow stick moving person" tip="Draw a box around something and this follows it as it moves." help="follow-movement">{follow}</Group>}
    {source?.kind === 'video' && clip.freeze == null && <Group title="Speed and sound" tab="sound" startOpen changed={clip.speed !== 1 || clip.muted || clip.volume !== 1 || clip.fade_in > 0 || clip.fade_out > 0 || Boolean(clip.reverse)} keywords="volume mute louder quiet slow motion fast reverse backwards noise clean voice speed" tip="Loudness and speed; Clean voice removes fan and AC hum." help="speed-and-sound">
      <button className={`ed-button wide ${clip.muted ? 'on' : ''}`} onClick={() => onChange({ muted: !clip.muted })}>{clip.muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}{clip.muted ? 'Muted' : 'Mute this clip'}</button>
      <SoundControls item={clip} length={(clip.out - clip.in) / clip.speed} onChange={onChange}/>
      <ValueSlider label={clip.ramp ? 'Overall speed' : 'Speed'} value={clip.speed} min={0.25} max={4} step={0.05} defaultValue={1} unit="×" decimals={2} onChange={(speed, group) => onChange({ speed }, group)}/>
      <More>
      <h3 className="ed-sub">Speed effect</h3>
      <Chips label="Speed ramp" options={RAMP_CHOICES} value={rampName(clip.ramp)} onPick={(id) => onChange({ ramp: id === 'off' ? null : RAMPS[id] })}/>
      {clip.ramp && <><RampCurve ramp={clip.ramp} at={local / ((clip.out - clip.in) / clip.speed)}/><p className="ed-tip">Sound is off during a speed ramp. Slow parts look smoothest in footage filmed at 60 or 120 frames a second.</p></>}
      {isMain && <label className="ed-check"><input type="checkbox" checked={Boolean(clip.reverse)} onChange={(event) => onChange({ reverse: event.target.checked })}/><span>Play backwards<small>{clip.reverse && !copyReady ? 'Making a reversed copy… The preview plays forwards until it is ready.' : 'Sound is off while a clip plays backwards.'}</small></span></label>}
      <label className="ed-check"><input type="checkbox" checked={Boolean(clip.clean_voice)} onChange={(event) => onChange({ clean_voice: event.target.checked })}/><span>Clean voice<small>Removes steady background noise like fans, AC and hiss. Made once, in the background.</small></span></label>
      {canDetach && <button className="ed-button wide" onClick={onDetach}><AudioLines size={15}/>Move sound to its own track</button>}
      </More>
    </Group>}
    </Panel>
  </>;
}

const RAMP_CHOICES: { id: RampName | 'off'; label: string }[] = [{ id: 'off', label: 'Off' }, { id: 'hero', label: 'Hero' }, { id: 'bullet', label: 'Bullet' }, { id: 'montage', label: 'Montage' }, { id: 'speed-up', label: 'Speed up' }, { id: 'slow-down', label: 'Slow down' }];
/** Which preset a ramp is, if any. A split leaves each half with its own part of the curve, shown as none. */
const rampName = (ramp?: RampPoint[] | null): RampName | 'off' | null => (!ramp ? 'off' : (Object.keys(RAMPS) as RampName[]).find((name) => JSON.stringify(RAMPS[name]) === JSON.stringify(ramp)) ?? null);

/** The ramp's speed through the clip, with the playhead on it. Higher is faster. */
function RampCurve({ ramp, at }: { ramp: RampPoint[]; at: number }) {
  const samples = Array.from({ length: 61 }, (_, index) => rampSpeed(ramp, index / 60));
  const top = Math.max(...samples) * 1.1;
  const line = samples.map((value, index) => `${index === 0 ? 'M' : 'L'}${(index / 60) * 200},${56 - (value / top) * 52}`).join(' ');
  return <svg className="ed-ramp" viewBox="0 0 200 60" role="img" aria-label="Speed through the clip"><path d={`${line} L200,60 L0,60 Z`} className="fill"/><path d={line} className="line"/><line x1={at * 200} x2={at * 200} y1="0" y2="60" className="head"/></svg>;
}

function FollowPanel({ blur, drawing, job, busy, note, following, size, onSize, onStart, onContinue, onCancel, onStop }: { blur: boolean; drawing: boolean; job: FollowJob | null; busy: boolean; note: string | null; following: boolean; size: boolean;
  onSize: (on: boolean) => void; onStart: () => void; onContinue: () => void; onCancel: () => void; onStop: () => void }) {
  if (job) return <><div className="ed-progress"><i style={{ width: `${job.progress}%` }}/></div><p className="ed-tip">Following… {job.progress}%</p><button className="ed-button wide" onClick={onCancel}>Cancel</button></>;
  return <>
    <p className="ed-tip">{drawing ? 'Drag a box around it in the preview. Esc cancels.' : blur ? 'Put the playhead on a frame where the face or plate is clear, then draw a box around it.' : 'Put the playhead where the subject is clear, place this item where it should sit, then draw a box around the subject.'}</p>
    <label className="ed-check"><input type="checkbox" checked={size} onChange={(event) => onSize(event.target.checked)}/><span>Follow its size too<small>Grows and shrinks as the subject comes closer or moves away.</small></span></label>
    <button className={`ed-button wide ${drawing ? 'on' : ''}`} disabled={busy} onClick={onStart}><Crosshair size={14}/>{following ? 'Follow something else' : 'Follow something'}</button>
    {following && <div className="ed-pair"><button className="ed-button" disabled={busy} onClick={onContinue}>Continue from here</button><button className="ed-button" disabled={busy} onClick={onStop}>Stop following</button></div>}
    {note && <p className="ed-tip" role="status">{note}</p>}
  </>;
}

function CaptionInspector({ caption, layer, timing, onText, onLook, onRemoveAll }: { caption: Caption; layer: CaptionLayer; timing: TimeFieldProps[]; onText: (text: string) => void; onLook: (changes: Partial<CaptionLook>, group?: string) => void; onRemoveAll: () => void }) {
  const [draft, setDraft] = useState(captionText(caption));
  useEffect(() => setDraft(captionText(caption)), [caption.id]);
  return <Panel id="caption" tabs={[{ id: 'words', label: 'Words', Icon: Captions }, { id: 'style', label: 'Style', Icon: Palette }]}>
    <Group title="Timing" startOpen keywords="when start length duration" help="timing-and-trimming">
      <Timing fields={timing}/>
    </Group>
    <Group title="This caption" tab="words" startOpen keywords="subtitles captions words fix spelling text" tip="Fix a word by typing. Keep the same number of words to keep its timing." help="captions">
      <textarea className="ed-text" aria-label="Caption text" lang="ta" value={draft} maxLength={300} rows={2} onChange={(event) => { setDraft(event.target.value); if (event.target.value.trim()) onText(event.target.value); }}/>
    </Group>
    <Group title="All captions" tab="style" startOpen keywords="captions style size position colour highlight karaoke remove" tip="Changes every caption at once." help="captions">
      <Chips label="Caption style" options={[{ id: 'outline' as const, label: 'Outline' }, { id: 'shadow' as const, label: 'Shadow' }, { id: 'band' as const, label: 'Band' }]} value={layer.style} onPick={(style) => onLook({ style })}/>
      <ValueSlider label="Size" value={layer.size} min={20} max={100} step={1} defaultValue={48} onChange={(size, group) => onLook({ size: Math.round(size) }, group)}/>
      <Chips label="Caption position" options={[{ id: 'top' as const, label: 'Top' }, { id: 'center' as const, label: 'Middle' }, { id: 'bottom' as const, label: 'Bottom' }]} value={layer.position} onPick={(position) => onLook({ position })}/>
      <More>
      <label className="ed-color"><span>Colour</span><input type="color" aria-label="Caption colour" value={layer.color} onChange={(event) => onLook({ color: event.target.value }, `caption-colour-${layer.id}`)}/></label>
      <label className="ed-check"><input type="checkbox" checked={Boolean(layer.highlight)} onChange={(event) => onLook({ highlight: event.target.checked ? '#ffd400' : null })}/><span>Light up each word as it's spoken</span></label>
      {layer.highlight && <label className="ed-color"><span>Highlight colour</span><input type="color" aria-label="Lit word colour" value={layer.highlight} onChange={(event) => onLook({ highlight: event.target.value }, `caption-lit-${layer.id}`)}/></label>}
      <button className="ed-button wide" onClick={onRemoveAll}><Trash2 size={14}/>Remove all captions</button>
      </More>
    </Group>
  </Panel>;
}

function BlurInspector({ blur, timing, local, onChange, onSeekLocal, onPause, follow }: { blur: BlurBox; timing: TimeFieldProps[]; local: number; onChange: (changes: Partial<BlurBox>, group?: string) => void; onSeekLocal: (t: number) => void; onPause: () => void; follow: React.ReactNode }) {
  return <Panel id="blur" tabs={[{ id: 'hide', label: 'Hide', Icon: EyeOff }, { id: 'motion', label: 'Motion', Icon: Move, changed: Object.keys(blur.transform.keyframes ?? {}).length > 0 }]}>
    <Group title="Timing" startOpen keywords="when start length duration" help="timing-and-trimming"><Timing fields={timing}/></Group>
    <Group title="Hide" tab="hide" startOpen keywords="hide face number plate pixelate censor blur strength oval box" tip="Hide a face or number plate. Drag the box in the preview to move it." help="hide-faces-plates">
      <Chips label="Style" options={[{ id: 'blur' as const, label: 'Blur' }, { id: 'pixelate' as const, label: 'Pixelate' }]} value={blur.style} onPick={(style) => onChange({ style })}/>
      <Chips label="Shape" options={[{ id: 'oval' as const, label: 'Oval' }, { id: 'box' as const, label: 'Box' }]} value={blur.shape} onPick={(shape) => onChange({ shape })}/>
      <ValueSlider label="Strength" value={blur.amount} min={0.05} max={1} step={0.01} defaultValue={DEFAULT_BLUR.amount} unit="%" factor={100} onChange={(amount, group) => onChange({ amount }, group)}/>
      <More>
      <ValueSlider label="Width" value={blur.width} min={0.02} max={1} step={0.005} defaultValue={DEFAULT_BLUR.width} unit="%" factor={100} decimals={1} onChange={(width, group) => onChange({ width }, group)}/>
      <ValueSlider label="Height" value={blur.height} min={0.02} max={1} step={0.005} defaultValue={DEFAULT_BLUR.height} unit="%" factor={100} decimals={1} onChange={(height, group) => onChange({ height }, group)}/>
      </More>
    </Group>
    <Group title="Follow movement" tab="motion" startOpen keywords="track follow stick moving person" tip="Draw around a face, and the blur follows it as it moves." help="follow-movement">{follow}</Group>
    <Group title="Moves" tab="motion" keywords="move position size animate keyframe" help="animations-and-moves" changed={Object.keys(blur.transform.keyframes ?? {}).length > 0}>
      <MotionPanel transform={blur.transform} local={local} length={blur.length} controls={['position', 'scale']} onChange={(transform, group) => onChange({ transform }, group)} onSeek={onSeekLocal} onGestureStart={onPause}/>
    </Group>
  </Panel>;
}

function ExportDialog({ timeline, projectId, withSound, onNormalize, onClose, onOpen }: { timeline: Timeline; projectId: number; withSound: boolean; onNormalize: (on: boolean) => void; onClose: () => void; onOpen: (id: number) => void }) {
  const shortest = Math.min(timeline.format.width, timeline.format.height);
  const [quality, setQuality] = useState(shortest >= 2160 ? 2160 : Math.max(720, Math.min(1080, shortest)));
  const [job, setJob] = useState<{ id: string; progress: number; status?: string | null; error?: string | null; output?: number | null } | null>(null);
  const [error, setError] = useState('');
  const seconds = duration(timeline);
  const megabytes = Math.round(seconds * ESTIMATED_MB_PER_SECOND_1080 * (quality / 1080) ** 2);
  const outputFormat = exportFormat(timeline.format, quality);
  const start = async () => {
    setError('');
    try {
      const { job_id } = await exportProjectTimeline(projectId, { ...timeline, format: outputFormat });
      setJob({ id: job_id, progress: 0 });
    } catch (problem) { setError((problem as Error).message); }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return;
    const timer = setTimeout(async () => {
      try { const status = await getJobStatus(job.id); setJob({ id: job.id, progress: status.progress, status: status.status, error: status.error, output: status.output_photo_id }); }
      catch (problem) { setError((problem as Error).message); }
    }, 700);
    return () => clearTimeout(timer);
  }, [job]);
  const running = job && !['done', 'failed', 'cancelled'].includes(job.status ?? '');
  return <div className="ed-modal" role="dialog" aria-modal="true" aria-label="Export video"><div className="ed-card small">
    <button className="ed-close" aria-label="Close export" onClick={onClose}><X size={17}/></button>
    <h2>Export video</h2>
    {!job && <><p>{timecode(seconds)} long · about {megabytes >= 1000 ? `${(megabytes / 1000).toFixed(1)} GB` : `${megabytes} MB`}</p>
      <div className="ed-qualities">{QUALITIES.map((item) => <button key={item.id} className={quality === item.id ? 'on' : ''} aria-pressed={quality === item.id} onClick={() => setQuality(item.id)}><strong>{item.label}</strong><span>{item.note}</span></button>)}</div>
      <p className="ed-export-spec">{exportSpec(outputFormat, withSound)}</p>
      <label className="ed-check"><input type="checkbox" checked={Boolean(timeline.normalize_audio)} onChange={(event) => onNormalize(event.target.checked)}/><span>Even out loudness<small>Matches the level social apps expect. Applied to the export, not the preview.</small></span></label>
      {error && <p role="alert" className="ed-bad">{error}</p>}
      <button className="ed-primary wide" onClick={() => { void start(); }}><Download size={16}/>Export MP4</button></>}
    {running && <><div className="ed-progress"><i style={{ width: `${job.progress}%` }}/></div><p>{job.status === 'queued' ? 'Waiting for another job to finish…' : `Exporting… ${job.progress}%`}</p>
      <p className="ed-tip">You can keep editing. This continues in the background and appears in Exports.</p>
      <div className="ed-pair"><button className="ed-button" onClick={onClose}>Keep editing</button><button className="ed-button" onClick={() => { void cancelRenderJob(job.id); }}>Cancel export</button></div></>}
    {job?.status === 'done' && <><p className="ed-good"><Check size={16}/>Your video is ready</p><button className="ed-primary wide" onClick={() => { if (job.output) onOpen(job.output); onClose(); }}>Open video</button></>}
    {job?.status === 'failed' && <><p role="alert" className="ed-bad">{job.error}</p><button className="ed-button wide" onClick={() => setJob(null)}>Try again</button></>}
    {job?.status === 'cancelled' && <><p>Export cancelled.</p><button className="ed-button wide" onClick={() => setJob(null)}>Back</button></>}
    {running && job.status === 'queued' && <LoaderCircle className="spin" size={16}/>}
  </div></div>;
}
