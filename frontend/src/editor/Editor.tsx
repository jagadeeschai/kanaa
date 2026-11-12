import { createPortal } from 'react-dom';
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
import { Search, Settings2 } from 'lucide-react';
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
import { barShare, CINEMATIC, type Finish, groundShape, putBehindShape, putBehindObject, replaceBackground, cutoutToken, focusAt, focusLocal, type CutoutPick, type BlurAmount, type ShapeMask, captionLayers, captionStates, captionText, findCaption, removeCaption, setCaptions, updateCaption, updateCaptionLook, type Caption, type CaptionLayer, type CaptionLook, freezeFrame, putBehindPerson, trimAtPlayhead, REST_TRANSFORM, addBlur, findBlur, removeBlur, updateBlur, BLUR_SECONDS, DEFAULT_BLUR, type BlurBox, cornerPlacement, MIN_CLIP_SECONDS, moveItem, setSpeed, trimSound, trimText, MAX_PHOTO_SECONDS, removeMedia, duplicateItem, isLocked, layerOf, reorderLayer, overlayLayers, addOverlay, addSound, addText, audioLayers, clipLength, detachAudio, duration, exportFormat, fillScale, findClip, findSound, findText, FORMATS, insertClip, mainLayer, MUSIC_VOLUME, newClip, OVERLAY_SCALE, normalizeTimeline, removeClip, removeSound, removeText, soundLength, splitClip, splitSound, timecode, trimClip, textLayers, updateClip, updateLayer, updateSound, updateText, type Adjust, type AudioLayer, type BlendMode, type Corner, type VideoLayer, type Clip, type Format, type Sound, type SourceFacts, type TextItem, type Timeline, type TitlePin, type SurfaceKind } from '../timeline/model';
import { PlaybackEngine, type PlaybackSource } from './playback';
import { ContextMenu, isEditable, type MenuItem, type MenuState } from './ContextMenu';
import { TimeField, ValueSlider, type TimeFieldProps } from './controls';
import { buildTokens, cutTokens, tidyUp, type Word } from '../timeline/words';
import { LANGUAGES, WordsPanel } from './Words';
import { explainError } from './errors';
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
import { dateWords, defocusBox, ENGLISH_FONTS, isDateTemplate, lookOf, MAX_SAVED, savedStyles, saveStyles, TAMIL_FONTS, TEMPLATES, type FontChoice, type Template } from '../timeline/templates';
import { buildCaptions, retypeCaption, DEFAULT_CAPTION_OPTIONS } from '../timeline/captions';
import { localAt, RAMPS, rampSpeed, sourceAt, type RampName, type RampPoint } from '../timeline/ramp';
import { blurForFace, boxInSource, faceUnder, followPath, unfollow, videoAt, videoUnder, type TrackPoint } from '../timeline/tracking';
import { ProjectSaveQueue, type SaveState } from './project-save';
import { exportSpec } from './export-spec';
import { nextTabIndex } from './tab-navigation';

type Props = { projectId: number; projectName: string; photo: Photo; onClose: () => void; onOpenOutput: (id: number) => void; theme: string; themeChoice: ThemeChoice; nextTheme: () => void; setTheme?: (choice: ThemeChoice) => void };
type Action = { type: 'load'; timeline: Timeline } | { type: 'change'; timeline: Timeline; group?: string | null } | { type: 'undo' } | { type: 'redo' };
const EMPTY = startHistory<Timeline | null>(null);
const LEFT_TABS = ['media', 'audio', 'text', 'words', 'transitions', 'effects', 'templates', 'themes', 'ask'] as const;
/** Where a thin line separates the rail into groups: add · words · style · ask. */
const RAIL_BREAK_BEFORE = new Set<string>(['text', 'transitions', 'ask']);
const LITE_TABS = new Set<string>(['media', 'audio', 'text', 'templates', 'themes']);
const LEFT_TAB_LABELS: Record<(typeof LEFT_TABS)[number], string> = { media: 'Media', ask: 'Ask AI', templates: 'Stories', themes: 'Themes', transitions: 'Transitions', effects: 'Effects', text: 'Text', audio: 'Audio', words: 'Words' };
const TAB_ICONS: Record<(typeof LEFT_TABS)[number], React.ReactNode> = { media: <ImageIcon size={17}/>, ask: <Sparkles size={17}/>, templates: <Bookmark size={17}/>, themes: <Palette size={17}/>, transitions: <Shuffle size={17}/>, effects: <WandSparkles size={17}/>, text: <Type size={17}/>, audio: <Music size={17}/>, words: <MessageSquareText size={17}/> };
const TAB_TIPS: Record<(typeof LEFT_TABS)[number], string> = { media: 'Media — your clips, photos, folders and travel maps', ask: 'Ask AI — describe an edit in words', templates: 'Stories — ready-made stories with music and titles', themes: 'Themes — dress the whole video in one click', transitions: 'Transitions — how clips join each other', effects: 'Effects — clip effects, weather and light overlays, and privacy blur', text: 'Text — titles and captions', audio: 'Audio — music library, songs and whooshes', words: 'Words — transcript, pauses and caption cuts' };
const QUALITIES = [{ id: 720, label: '720p', note: 'Smallest file' }, { id: 1080, label: '1080p', note: 'Best for most posts' }, { id: 2160, label: '4K', note: 'Slower, larger file' }];
const ESTIMATED_MB_PER_SECOND_1080 = 1.1;
/** The hardware encoder's bitrate at a given short side, in megabits — mirrors the export's encoder table. */
const hardwareMbps = (shortSide: number) => ({ 720: 9, 1080: 16, 1440: 28 } as Record<number, number>)[shortSide] ?? (shortSide >= 2160 ? 50 : Math.round(shortSide * 0.015));
const ZOOM_MIN = 8; const ZOOM_MAX = 300; const ZOOM_STEP = 1.4;
const FAST_RATES = [1, 2, 4];
const MAX_FADE_SECONDS = 5;
const MIN_MUSIC_SECONDS = 1;
const PREVIEW_SHORT_SIDE = 540;
const RENDERED_ID = -1;
const CLIP_EFFECT_PRESETS = [
  { id: 'colour-splash', group: 'Stylise', label: 'Colour splash', about: 'Keep one chosen colour while everything else turns monochrome.' },
  { id: 'dreamy-glow', group: 'Stylise', label: 'Dreamy glow', about: 'Soft, warm highlight bloom for weddings and portraits.' },
  { id: 'split-tone', group: 'Stylise', label: 'Split-tone', about: 'Tint shadows and highlights with two colours, keeping the real colours.' },
  { id: 'duotone', group: 'Stylise', label: 'Duotone', about: 'Paint the picture in two colours, dark to light.' },
  { id: 'zoom-blur', group: 'Motion', label: 'Zoom blur', about: 'Streaks rushing towards a centre, like a fast push in.' },
  { id: 'echo', group: 'Motion', label: 'Echo trail', about: 'Ghosts of the last moments trailing movement, for dance and action.' },
  { id: 'tilt-shift', group: 'Lens', label: 'Tilt-shift', about: 'A sharp band with soft blur above and below: a toy-town miniature.' },
  { id: 'mirror', group: 'Shape', label: 'Mirror', about: 'Reflect the left or top half, or all four quarters.' },
  { id: 'kaleidoscope', group: 'Shape', label: 'Kaleidoscope', about: 'Mirrored wedges turning round the centre.' },
  { id: 'beat-pulse', group: 'Motion', label: 'Beat pulse', about: 'A quick camera push synchronized to the music.' },
  { id: 'old-film', group: 'Film', label: 'Old film', about: 'Warm faded stock, grain, scratches and gate weave.' },
  { id: 'glitch', group: 'Signal', label: 'Digital glitch', about: 'RGB separation, broken bands and digital noise.' },
  { id: 'vhs', group: 'Signal', label: 'VHS tape', about: 'Tape jitter, scanlines, softness and analogue noise.' },
  { id: 'raindrops', group: 'Lens', label: 'Raindrops', about: 'Water drops that bend and highlight the picture.' },
  { id: 'lens-dirt', group: 'Lens', label: 'Lens dirt', about: 'Soft optical dirt and dark lens contamination.' },
] as const;
const BLENDS: { id: BlendMode; label: string }[] = [{ id: 'normal', label: 'Normal' }, { id: 'multiply', label: 'Multiply' }, { id: 'screen', label: 'Screen' }, { id: 'overlay', label: 'Overlay' }, { id: 'darken', label: 'Darken' }, { id: 'lighten', label: 'Lighten' }];
const CORNERS: { id: Corner; label: string }[] = [{ id: 'top-left', label: 'Top left' }, { id: 'top-right', label: 'Top right' }, { id: 'bottom-left', label: 'Bottom left' }, { id: 'bottom-right', label: 'Bottom right' }];
const EFFECT_INTENSITIES = [{ id: 'subtle', label: 'Subtle' }, { id: 'medium', label: 'Medium' }, { id: 'strong', label: 'Strong' }];
const EFFECT_INTENSITY_VALUE: Record<string, number> = { subtle: 0.4, medium: 0.7, strong: 1 };
const FIT_MARGIN = 48;
const TEXT_SECONDS = 3;
const TEXT_TYPE_DELAY_MS = 250;
const CAPTION_FETCHES = 3;
/** How an item's own settings read, in the note that it sets them over its layer's style. */
const STYLE_NAMES: Record<string, string> = { size: 'Size', color: 'Colour', font: 'Font', tamil_font: 'Tamil font', style: 'Style', position: 'Position', enter: 'Enter', exit: 'Exit',
  transform: 'Place and motion', align: 'Alignment', band_color: 'Band colour', design: 'Design', spacing: 'Letter spacing', subtitle_size: 'Subtitle size', subtitle_color: 'Subtitle colour',
  look: 'Look', adjust: 'Colour adjustments', volume: 'Volume', muted: 'Mute', fade_in: 'Fade in', fade_out: 'Fade out' };
/** Logos and other brand pictures: images in a Media folder named Brand (or with "brand" in its name), or named as a logo. */
const BRAND_FOLDER = 'Brand';
const isBrandImage = (item: Photo) => item.media_type === 'image' && (/brand/i.test(item.folder ?? '') || /logo/i.test(item.filename));
const MOVES: { id: MovePreset; label: string; tip: string }[] = [{ id: 'push-in', label: 'Push in', tip: 'Slowly moves closer over the whole clip' }, { id: 'pull-out', label: 'Pull out', tip: 'Slowly moves away over the whole clip' },
  { id: 'punch-in', label: 'Punch in here', tip: 'Jumps closer at the playhead, for a word or a beat' }, { id: 'shake', label: 'Shake here', tip: 'A short camera shake at the playhead' }];
const FREEZE_SECONDS = 2;
const THUMB_FORMAT = { width: 480, height: 270, fps: 30 };
const SHAPE_FEATHER = 0.004;
const SHAPE_CLOSE = 0.03; // Clicking this near the first point closes an outline.
/** Which cleaned copy a clip or sound plays: one per song, or per video. */
const voiceKey = (item: { media_id?: number; asset_id?: string }) => (item.asset_id ? `a:${item.asset_id}` : `m:${item.media_id}`);
/** Which prepared copy a clip needs: [steadied, reversed, echo, cut-out], or null for the original. A frozen frame is never reversed or echoed.
 * An echo is made at the timeline's rate of source frames, the rate the export blends at. A cut-out clip previews without its echo. */
const preparedWant = (clip: Clip, fps: number): [boolean, boolean, string, string] | null => {
  const steady = Boolean(clip.stabilise); const backwards = Boolean(clip.reverse) && clip.freeze == null; const cutout = cutoutToken(clip);
  const echo = clip.echo && clip.freeze == null && !cutout ? `${clip.echo.mode}.${clip.echo.trails}.${clip.echo.decay.toFixed(2)}@${Number((fps * clip.speed).toFixed(3))}` : '';
  return steady || backwards || cutout || echo ? [steady, backwards, echo, cutout] : null;
};
const preparedKey = (id: number, steady: boolean, backwards: boolean, echo: string, cutout: string) => `${id}:${steady ? 1 : 0}:${backwards ? 1 : 0}:${echo}:${cutout}`;
const MOODS: Mood[] = ['romantic', 'happy', 'birthday', 'calm', 'energetic', 'cinematic', 'inspiring', 'songs'];
const MOOD_LABELS: Record<Mood, string> = { romantic: 'Romantic', happy: 'Happy', birthday: 'Birthday', calm: 'Calm', energetic: 'Energetic', cinematic: 'Cinematic', inspiring: 'Inspiring', songs: 'Songs' };
const PULL_SPEEDS: { id: string; label: string }[] = [{ id: '0.4', label: 'Quick' }, { id: '1', label: 'Smooth' }, { id: '2', label: 'Slow' }];
const BLUR_AMOUNTS: { id: BlurAmount; label: string }[] = [{ id: 'subtle', label: 'Subtle' }, { id: 'medium', label: 'Medium' }, { id: 'strong', label: 'Strong' }];
const LOOK_NAMES: { id: LookName; label: string }[] = [{ id: 'none', label: 'Original' }, { id: 'warm', label: 'Warm' }, { id: 'cool', label: 'Cool' }, { id: 'vivid', label: 'Vivid' }, { id: 'film', label: 'Film' }, { id: 'mono', label: 'Mono' }];
type StemChoice = 'music' | 'vocals' | 'both';
type StemJob = { soundId: string; jobId: string; choice: StemChoice; progress: number };
type Box = [number, number, number, number];
/** `drawnAt` and `from` are the item's own seconds. A blur box drawn fresh is first placed on the drawn box. */
/** An item added at the playhead can start a hair after it, from rounding; the playhead still counts as on it. */
const ON_ITEM = 0.05;
type FollowJob = { itemId: string; underId: string; jobId: string; progress: number; queued?: boolean; drawnAt: number; from: number; size: boolean; place: Box | null; own: boolean; grew: boolean;
  /** Set while looking for a face under a blur box: where the box is in the source, and what to follow instead when no face is there. */
  faces?: { box: Box; at: number; own: Box; grow?: number } };
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
/** Makes a side-panel tile draggable onto the timeline. Clicking still works as before. */
const draggableAs = (payload: DragPayload) => ({
  draggable: true,
  onDragStart: (event: React.DragEvent) => { setActiveDrag(payload); event.dataTransfer.setData(DRAG_TYPE, encodePayload(payload)); event.dataTransfer.effectAllowed = 'copy'; },
  onDragEnd: () => setActiveDrag(null),
});

const RESTART_MESSAGE = 'Kanaa was updated and needs a restart. Stop it in its terminal with Ctrl+C, then run ./start.sh again.';

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
  const [drawing, setDrawing] = useState<{ mode: 'start' | 'continue'; from?: [number, number]; to?: [number, number] } | null>(null);
  const drawStart = useRef<[number, number] | null>(null); // Pointer events can arrive before a re-render, so the corner is kept here too.
  const [followSize, setFollowSize] = useState(false);
  const [followJob, setFollowJob] = useState<FollowJob | null>(null);
  // Scene tracks for titles locked to the scene, by media and source stretch, and how far one being made has got.
  const [sceneTracks, setSceneTracks] = useState<Record<string, SceneTrack>>({});
  const [pinProgress, setPinProgress] = useState<number | null>(null);
  const sceneTrackKey = (mediaId: number, stretch: { start: number; end: number; at: number; horizon?: boolean; region?: [number, number] | null; upright?: boolean }) => `${mediaId}:${Math.round(stretch.start * 30)}:${Math.round(stretch.end * 30)}:${Math.round(stretch.at * 30)}${stretch.horizon ? ':horizon' : ''}${stretch.region ? `:${stretch.region[0].toFixed(3)},${stretch.region[1].toFixed(3)}` : ''}${stretch.upright ? ':upright' : ''}`;
  /** The clip a title is locked to, its source stretch, and the key of its scene track. */
  const pinTarget = (current: Timeline, text: TextItem) => {
    if (!text.pin) return null;
    for (const layer of current.layers) if (layer.kind === 'video') for (const clip of layer.items) {
      if (clip.id !== text.pin.clip_id) continue;
      // With Sky only in front, the title rides the skyline: a different track, asked for when the cover changes too.
      const stretch = { ...pinStretch(clip, text), ...pinTrackOptions(onSkyline(current, text.id), text) };
      return { clip, stretch, key: sceneTrackKey(clip.media_id, stretch) };
    }
    return null;
  };
  /** Locks the title to the scene of the video under it, at the playhead, and follows the camera (made once, in the background). */
  const pinTitle = async (text: TextItem, on: boolean, placedPin?: TitlePin) => {
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
  /** Place in scene: waiting for a click on the preview for this title, or working out the surface. */
  const [placing, setPlacing] = useState<{ textId: string; busy: boolean } | null>(null);
  /**
   * Puts a title on the surface at a spot of the preview: it moves there, tilts to lie on it (floor or wall) or stays
   * upright, locks to that surface as the camera moves, and goes behind people. `kind` re-places it on the same spot
   * as a floor, wall, upright sign or on the sky, when the guess was wrong.
   */
  const placeInScene = async (text: TextItem, spot: { x: number; y: number } | null, kind: SurfaceKind | null) => {
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
  useEffect(() => {
    if (!placing || placing.busy) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setPlacing(null); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [placing]);
  const [clearProgress, setClearProgress] = useState<number | null>(null);
  const [keepClearNote, setKeepClearNote] = useState<{ textId: string; text: string } | null>(null);
  /** Moves the title aside, as x/y keys, so no person comes within its gap (people masks of the clip under it). */
  /** The main-track clip a title sits over: the one at its middle, else any it overlaps. */
  const clipUnderTitle = (current: Timeline, text: TextItem) => {
    const main = mainLayer(current);
    const middle = text.start + text.length / 2;
    return main.items.find((item) => item.start <= middle && middle < item.start + clipLength(item))
      ?? main.items.find((item) => item.start < text.start + text.length && text.start < item.start + clipLength(item)) ?? null;
  };
  const keepTitleClear = async (text: TextItem, settings: Pick<KeepClear, 'gap' | 'direction' | 'max_move' | 'who'>) => {
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
  const [introProgress, setIntroProgress] = useState<number | null>(null);
  /** Makes the brand intro for a logo at this video's size and puts it at the very start (replacing an earlier one). */
  const addBrandIntro = async (logo: Photo, tamil: string, english: string) => {
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
  const [stayProgress, setStayProgress] = useState<number | null>(null);
  const [stayNote, setStayNote] = useState<{ textId: string; text: string } | null>(null);
  /**
   * Stay with people: the title keeps its distance from the people nearest it at the playhead, and grows as they come
   * nearer and shrinks as they walk away. Locking to the scene and moving aside from people pull other ways, so both come off.
   */
  const stayWithPeople = async (text: TextItem) => {
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
  const textKey = (text: TextItem, format: Format) => JSON.stringify([text.text, text.style, text.position, text.color, text.size, text.subtitle ?? null, text.subtitle_size ?? null, text.subtitle_color ?? null, Boolean(text.subtitle_above), text.subtitle_spacing ?? 0, text.spacing ?? 0, text.align ?? 'center', text.band_color ?? null, text.font ?? null, text.tamil_font ?? null, text.design ?? null, format.width, format.height]);
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
      if (!recipe || canonical(recipe) === canonical(JSON.parse(queue.saved))) return;
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
            if (message.startsWith('Only videos can be steadied')) setNote('That title sits over a photo — cut-outs and behind-people need a video clip under them.');
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
    const isPhoto = (clip: Clip) => mediaById.get(clip.media_id)?.media_type === 'image';
    const aims = new Map(await Promise.all(mainLayer(base).items.filter(isPhoto).map(async (clip) => [clip.id, await aimFor(clip, base)] as const)));
    let next = applyTheme(base, look, words, isPhoto, [newId(), newId(), newId()], (clip) => aims.get(clip.id) ?? null);
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
    await buildStoryVideo(story.story, story.fills.map((id) => (id === null ? null : facts(id) ?? null)));
  };
  /** A story's video from its filled moments: best moments, then its theme and music. */
  const buildStoryVideo = async (chosenStory: (typeof STORIES)[number], fills: (SourceFacts | null)[]) => {
    const base = timelineRef.current;
    if (!base) return;
    const story = { story: chosenStory };
    if (!fills.some(Boolean)) { setError('Put a clip or photo in at least one moment.'); return; }
    const look = THEMES.find((item) => item.id === story.story.theme) ?? THEMES[0];
    // Each video's best stretch (sharp, steady, well lit, with faces) instead of its middle. If that fails, the middle still works.
    let best: (number | null)[] = [];
    const wanted = story.story.slots.map((slot, index) => ({ slot, source: fills[index] })).filter(({ slot, source }) => source?.media_type === 'video' && (source.duration ?? 0) > slot.seconds);
    if (wanted.length) {
      setMomentProgress(0);
      try {
        const { job_id } = await startBestMoments(wanted.map(({ slot, source }) => ({ media_id: source!.media_id, length: slot.seconds })));
        const { starts } = await waitForJob<{ starts: (number | null)[] }>(job_id, setMomentProgress);
        best = story.story.slots.map((slot) => { const at = wanted.findIndex((entry) => entry.slot === slot); return at < 0 ? null : starts[at]; });
      } catch { best = []; } finally { setMomentProgress(null); }
    }
    await chooseTheme(look, buildStory(base, story.story, fills, newId, best), `story-${story.story.id}`);
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
  const addLibraryTrack = async (track: LibraryTrack, dropAt?: number) => {
    if (!timeline) return;
    setAddingMusic(true);
    try {
      const song = await librarySong(track);
      const at = Math.round((dropAt ?? engineRef.current?.currentTime ?? 0) * 1000) / 1000;
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
    const text: TextItem = { ...title.look, ...dated, ...(words ? { text: words, subtitle: '' } : {}), id: newId(), start: Math.round(at * 1000) / 1000, length: TEXT_SECONDS };
    let next = addText(current, text, newId());
    // Pull focus: the picture behind softens while the title sharpens.
    if (title.extra?.defocus) next = addBlur(next, defocusBox(newId(), text.start, text.length, text.enter?.duration ?? 1, text.exit?.duration ?? 0.6), newId());
    change(next);
    // A title that brings an effect (lens flare, sparkles, bokeh) lays it over the video for the title's length.
    if (title.extra?.effect) void addEffect(title.extra.effect, text.start, text.length);
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
  const addEffect = async (effectId: string, dropAt?: number, length?: number) => {
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette((value) => !value); return; }
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
      if (command && event.key.toLowerCase() === 'a' && selectedId) {
        // ⌘A: everything on the selected item's layer.
        const layer = timeline.layers.find((l) => (l.items as { id: string }[]).some((item) => item.id === selectedId));
        if (layer) { event.preventDefault(); setMoreIds(new Set((layer.items as { id: string }[]).map((item) => item.id).filter((id) => id !== selectedId))); }
        return;
      }
      if (command) return;
      switch (event.key) {
        case ' ': event.preventDefault(); togglePlay(); break;
        case 'k': engine?.pause(); fastRate.current = 0; break;
        case 'l': fastRate.current = Math.min(FAST_RATES.length - 1, engine?.playing ? fastRate.current + 1 : 0); engine?.play(FAST_RATES[fastRate.current]); break;
        case 'j': engine?.pause(); seek(playhead.current - 1); break;
        case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
          if (!event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) break;
          event.preventDefault();
          if (event.altKey) {
            // Alt+arrows nudge the selected title, clip or blur in the frame (Shift: further).
            const moving = movingRef.current;
            if (!moving) break;
            const step = event.shiftKey ? 0.05 : 0.01;
            const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
            const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
            moving.update({ ...moving.transform, x: Math.round((moving.transform.x + dx) * 1000) / 1000, y: Math.round((moving.transform.y + dy) * 1000) / 1000 }, `nudge-${selectedId}`);
            break;
          }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') break;
          engine?.pause(); seek(playhead.current + (event.key === 'ArrowLeft' ? -1 : 1) * frame * (event.shiftKey ? 10 : 1)); break;
        }
        case 's': split(); break;
        case 'n': setSnapping((value) => !value); break;
        case 'f': toggleFullScreen(); break;
        case 'i': case 'o': { const item = clip(); if (item && !mainLayer(timeline).locked) change(trimAtPlayhead(timeline, item, event.key === 'i' ? 'in' : 'out', playhead.current - item.start, newId, facts(item.media_id))); break; }
        case 'Delete': case 'Backspace': event.preventDefault(); if (wordSelection.size) cutWords(wordSelection); else removeSelected(); break;
        case 'Escape': setWordSelection(new Set()); setSelectedId(null); break;
        case 'Enter': case 'F2': {
          // Type into the selected title.
          const box = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Title"]');
          if (selectedText && box) { event.preventDefault(); box.focus(); box.select(); }
          break;
        }
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullScreen, fullScreen, timeline, exporting, choosingFormat, showingHelp, menu, pickingKey, drawing, shaping, stopPicking, wordSelection, cutWords, togglePlay, split, removeSelected, seek, change, playhead, facts, selectedId, selectedText, removeSelected]);

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
    drawStart.current = null;
    setDrawing(null);
    if (box && box[2] > MIN_DRAWN_BOX && box[3] > MIN_DRAWN_BOX) void startFollowing(box, mode);
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
    const clipItem = clip ? mediaById.get(clip.media_id) : undefined;
    if (clip) items.push({ label: 'Rename clip…', onSelect: () => setRenamingClip(id) });
    if (clip) items.push({ label: clip.enabled === false ? 'Turn clip on' : 'Turn clip off', onSelect: () => change(updateClip(timeline, id, { enabled: clip.enabled === false })) });
    // The tools that study the picture (and take a while) sit together under Smart tools.
    const smart: MenuItem[] = [];
    if (clip && clipItem?.width && clipItem.height && isVideo(clip.media_id) && !layer.locked && canReframe({ width: clipItem.width, height: clipItem.height }, clip.adjust.rotation, timeline.format)) smart.push({ label: reframeJob ? `Finding who to follow… ${reframeJob.progress}%` : 'Follow the person (reframe)', disabled: Boolean(reframeJob), onSelect: () => { void reframeClip(clip.id); } });
    if (clip && layer === mainLayer(timeline) && isVideo(clip.media_id) && !layer.locked) smart.push({ label: sceneJob ? `Finding scenes… ${sceneJob.progress}%` : 'Split at scene changes', disabled: Boolean(sceneJob), onSelect: () => { void splitScenes(clip.id); } });
    if (smart.length) items.push({ label: 'Smart tools', submenu: smart });
    items.push({ label: 'Duplicate', onSelect: () => { try { change(duplicateItem(timeline, id, newId(), newId())); } catch (problem) { setError((problem as Error).message); } } });
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
      <aside className="ed-media" aria-label="Add to your video">
        <div className="ed-rail-tabs" role="group" aria-label="Add to your video"><button className={`ed-rail-back ${saved === 'failed' ? 'failed' : ''}`} onClick={() => { void closeEditor(); }} aria-label={t('Back to projects')} data-tip={`${t('Back to projects')} · ${projectName} · ${t(saved === 'saving' ? 'Saving…' : saved === 'failed' ? 'Could not save' : 'Saved')}`}><ArrowLeft size={17}/></button><span className="ed-rail-divider" role="separator"/>{(layout.simple ? LEFT_TABS.filter((tab) => LITE_TABS.has(tab)) : LEFT_TABS).map((tab, index) => { const on = panelOpen && leftTab === tab; return <Fragment key={tab}>{index > 0 && RAIL_BREAK_BEFORE.has(tab) && <span className="ed-rail-divider" role="separator"/>}<button className={on ? 'on' : ''} aria-pressed={on} aria-label={t(LEFT_TAB_LABELS[tab])} data-tip={t(TAB_TIPS[tab])} onClick={() => { if (panelOpen && leftTab === tab) setPanelOpen(false); else { setLeftTab(tab); setPanelOpen(true); } }}>{TAB_ICONS[tab]}</button></Fragment>; })}{layout.simple && <button className="ed-rail-pro" onClick={() => updateLayout({ simple: false })} aria-label={t('More tools in Pro')} data-tip={t('Switch to Pro for transitions, effects, words and Ask AI')}><Sparkles size={15}/></button>}
</div>
        {panelOpen && <div className="ed-panel-content">
        {leftTab === 'media' && <>
          <div className="ed-media-create"><span>Create media</span><button className="ed-button wide" disabled={!timeline} onClick={() => setCreatingAIImage(true)}><WandSparkles size={15}/>Create image with AI</button></div>
          <ImportArea compact onImported={(items) => { setMedia((current) => [...items, ...current]); }}/>
          {folders.length > 0 && (() => {
            // One picker, however many folders there are: this video's own folder first, then the rest A to Z, each with its count.
            const own = projectName.replace(/\s*[–—-]\s*(3D\s+)?lyric\s+video\s*$/i, '').trim();
            const count = (name: string) => media.filter((item) => item.folder === name).length;
            const ordered = [...folders].sort((x, y) => (x === own ? -1 : y === own ? 1 : x.localeCompare(y)));
            return <label className="ed-folder-pick" data-keep-panel><span>{t('Folder')}</span><KanaaSelect aria-label={t('Folder')} searchable searchPlaceholder={t('Search folders')} value={folder ?? ''} onChange={(event) => setFolder(event.target.value || null)}>
              <option value="">{t('All media')} ({media.length})</option>
              {ordered.map((name) => <option key={name} value={name}>{name === own ? `★ ${name}` : name} ({count(name)})</option>)}
            </KanaaSelect></label>;
          })()}
          {([['In this video', inVideo], ['Other media', otherMedia]] as const).map(([heading, items]) => items.length > 0 && <div key={heading}><h3 className="ed-sub">{heading}</h3><div className="ed-media-grid">{items.map((item) => <div className="ed-tile" key={item.id}>
            <button className="ed-tile-add" {...draggableAs({ kind: 'media', id: item.id })} onClick={() => addMedia(item)} onContextMenu={(event) => openMediaMenu(event, item)} title={`Add ${item.filename}, or drag it onto the timeline. Right-click for more.`}><img src={photoThumbUrl(item.id)} alt=""  loading="lazy"/><span className="ed-tile-label"><b>{item.filename}</b>{item.duration ? <em>{timecode(item.duration).replace(/\.\d+$/, '')}</em> : null}</span></button>
            {usedIds.has(item.id) && <span className="ed-tile-used" title="In your video"><Check size={11}/></span>}
            <button className="ed-tile-over" onClick={() => addOverlayMedia(item)} title="Add on top of your video, like a logo" aria-label={`Add ${item.filename} as an overlay`}><Layers size={12}/></button></div>)}</div></div>)}
        </>}
        {leftTab === 'words' && <div data-keep-panel><WordsPanel tokens={tokens} clips={mainClips} language={language} onLanguage={(next) => { setLanguage(next); setWordSelection(new Set()); try { localStorage.setItem('wa.wordsLanguage', next); } catch { /* It just won't be remembered. */ } }} missing={missingWords.length} locked={Boolean(timeline && mainLayer(timeline).locked)}
          busy={wordJob ? `Listening to your video… ${wordJob.progress}%` : null} hasTracks={Boolean(timeline && timeline.layers.length > 1)} onTranscribe={() => { void transcribeClips(); }} onCancel={() => { if (wordJob) void cancelRenderJob(wordJob.id); }} onSeek={seek} onCut={cutWords} playhead={playhead} selection={wordSelection} onSelection={setWordSelection} tidy={tidy} pauseLength={pauseLength} onPauseLength={setPauseLength} fillers={removeFillers} onFillers={setRemoveFillers} onTidy={removePauses}
          onMenu={(event, keys) => setMenu({ x: event.clientX, y: event.clientY, items: [{ label: keys.size === 1 ? 'Cut' : `Cut ${keys.size} items`, hint: '⌫', danger: true, onSelect: () => cutWords(keys) }] })}/></div>}
        {leftTab === 'templates' && timeline && <div data-keep-panel>{(() => {
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
              <button className="ed-primary wide" disabled={!filled || Boolean(themeBusy) || momentProgress !== null} onClick={() => { void makeStory(); }}>{themeBusy || momentProgress !== null ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>}{momentProgress !== null ? `Picking the best moments… ${momentProgress}%` : 'Make my video'}</button>
              <p className="ed-tip">Each moment takes the sharpest, steadiest, best-lit part of its clip. {mainLayer(timeline).items.length ? 'This replaces the clips on your main track; undo with ⌘Z.' : ''}</p>
            </section>;
          }
          return <section className="ed-add" aria-label="Story templates">
            <p className="ed-tip">Fill each moment with a clip or photo; Kanaa makes the video, theme and music included.</p>
            <div className="ed-stories">{STORIES.map((item) => <button key={item.id} className="ed-story" onClick={() => setStory({ story: item, fills: item.slots.map(() => null), choosing: null })} title={`${item.slots.map((each) => each.label).join(' → ')}`}>
              <b>{item.label}</b><em lang="ta">{item.tamil}</em><small>{item.slots.length} moments · about {storySeconds(item)}s · {THEMES.find((look) => look.id === item.theme)?.label}</small></button>)}</div>
          </section>;
        })()}</div>}
        {leftTab === 'themes' && timeline && (() => {
          const current = activeTheme(timeline);
          return <section className="ed-add" aria-label="Themes">
            <p className="ed-tip">One click: colours, transitions, photo movement, opening and ending titles. Your clips and words stay.</p>
            <div className="ed-themes">{THEMES.map((look) => <button key={look.id} className={`ed-theme ${current?.id === look.id ? 'on' : ''}`} aria-pressed={current?.id === look.id} onClick={() => { void chooseTheme(look); }} disabled={Boolean(themeBusy)} title={`${look.label}: ${look.about}`}>
              <span className="ed-theme-art" style={{ background: `linear-gradient(135deg, ${look.swatch[0]}, ${look.swatch[1]})` }}>{thumbs[`theme-${look.id}`] && <img src={thumbs[`theme-${look.id}`]} alt=""/>}</span>
              <span className="ed-theme-name"><b>{themeBusy === look.id ? <LoaderCircle className="spin" size={11}/> : null}{look.label}</b><em lang="ta">{look.tamil}</em></span><small>{look.about}</small></button>)}</div>
            <label className="ed-check"><input type="checkbox" checked={themeWithMusic} onChange={(event) => setThemeWithMusic(event.target.checked)}/><span>Add music from your library<small>{library === null ? 'Reading your music…' : library.length ? `${library.length} tracks, matched to each theme's mood.` : 'No music found in your Music app folder.'}</small></span></label>
            {current && (() => { const music = themeMusic(timeline); return <div className="ed-add-row"><span>{music ? <>Music: <b>{music.name.replace(/^Theme music · /, '')}</b></> : 'No music'}</span>
              <span className="ed-pair-small">{library && library.length > 0 && <button className="ed-button" onClick={() => { void changeThemeMusic(true); }}>{music ? 'Another track' : 'Add music'}</button>}{music && <button className="ed-icon small" aria-label="Remove theme music" title="No music" onClick={() => { void changeThemeMusic(false); }}><X size={13}/></button>}</span></div>; })()}
            {current && <button className="ed-button wide" onClick={() => change(removeTheme(timeline))}><X size={14}/>Remove theme</button>}
            <p className="ed-tip">{t('Themes dress the whole video. To colour one clip, select it and open Colour; for a grade over everything, Project settings › Colour & finish.')}</p>
            <p className="ed-tip">Click the opening or ending title on the timeline to edit its words; a new theme keeps them.</p></section>;
        })()}
        {leftTab === 'transitions' && <>
          <p className="ed-tip">Drag onto a clip, or click to apply to the selected clip.</p>
          <div className="ed-quick" role="group" aria-label="Transitions">{TRANSITIONS.map((item) => <button key={item.id} className={`ed-quick-tile transition ${transitionPick === item.id ? 'on' : ''}`} {...draggableAs({ kind: 'transition', transition: item.id })} onClick={() => { setTransitionPick(item.id); applyToSelected({ kind: 'transition', transition: item.id }); }} title={`${item.label} into a clip`}>{TRANSITION_ICONS[item.id]}{item.label}</button>)}</div>
          {timeline && mainLayer(timeline).items.length > 1 && !mainLayer(timeline).locked && <>
            <button className="ed-button wide" onClick={() => change(transitionEverywhere(timeline, transitionPick, 0.6), 'transition-all')} title={`Put a ${transitionPick} on every cut`}><Shuffle size={14}/>Every cut: {TRANSITIONS.find((item) => item.id === transitionPick)?.label ?? transitionPick}</button>
            {mainLayer(timeline).items.some((clip) => clip.transition_in) && <button className="ed-button wide" onClick={() => setConfirmingClear(true)}><X size={14}/>Remove all transitions</button>}
          </>}
          {selected?.transition_in ? <ValueSlider label="Length" value={selected.transition_in.duration} min={0.2} max={2} step={0.05} defaultValue={0.6} unit="s" decimals={2} onGestureStart={pauseEngine} onChange={(duration, group) => change(updateClip(timeline!, selected.id, { transition_in: { ...selected.transition_in!, duration } }), group ?? 'transition-length')}/>
            : <p className="ed-tip">Select a clip with a transition to adjust its length.</p>}
          {selected?.transition_in && (selected.transition_in.kind === 'wipe' || selected.transition_in.kind === 'slide') &&
            <Chips label="Direction" options={TRANSITION_DIRECTIONS} value={selected.transition_in.direction ?? 'left'} onPick={(direction) => change(updateClip(timeline!, selected.id, { transition_in: { ...selected.transition_in!, direction: direction === 'left' ? null : direction } }))}/>}
        </>}
        {leftTab === 'ask' && timeline && <div data-keep-panel><AskPanel timeline={timeline} options={askOptions} project={askProject} onApply={runAsk}/></div>}
        {leftTab === 'effects' && <div className="ed-effect-search"><Search size={14}/><input type="search" value={effectSearch} onChange={(event) => setEffectSearch(event.target.value)} placeholder="Search effects…" aria-label="Search effects"/>{effectSearch && <button className="ed-icon small" aria-label="Clear effect search" onClick={() => setEffectSearch('')}><X size={12}/></button>}</div>}
        {leftTab === 'effects' && <section className="ed-add ed-clip-effect-browser" aria-label="Clip effects">
          <div className="ed-effect-browser-head"><div><h3>Apply to selected clip</h3><p>Changes the clip itself. Fine-tune it in Settings on the right.</p></div>{selected && <span className="ed-selected-pill">{activeClipEffects.length ? `${activeClipEffects.length} applied` : 'Clip selected'}</span>}</div>
          {!selected && <div className="ed-effect-empty"><b>Select a clip first</b><span>Click a photo or video on the timeline, then apply an effect here.</span></div>}
          {(['Stylise', 'Motion', 'Shape', 'Film', 'Signal', 'Lens'] as const).map((group) => { const matches = matchingClipEffects.filter((preset) => preset.group === group); if (!matches.length) return null; const section = `clip-${group}`; const open = Boolean(effectNeedle) || effectSection === section; return <div key={group} className="ed-effect-category">
            <button className="ed-effect-category-head" aria-expanded={open} onClick={() => { if (!effectNeedle) setEffectSection(open ? null : section); }}><span><b>{group}</b><small>{matches.map((preset) => preset.label).join(' · ')}</small></span>{open ? <Minus size={14}/> : <Plus size={14}/>}</button>
            {open && <div className="ed-clip-effect-grid">{matches.map((preset) => { const applied = clipEffectApplied(preset.id); return <button key={preset.id} className={`ed-clip-effect-card fx-clip-${preset.id} ${applied ? 'on' : ''}`} {...draggableAs({ kind: 'clip_effect', effect: preset.id })} aria-pressed={applied} onClick={() => applyClipEffect(preset.id)} title={selected ? `${applied ? 'Edit' : 'Apply'} ${preset.label} on the selected clip, or drag it onto another clip` : `Drag ${preset.label} onto a timeline clip`}>
              <span className="ed-clip-effect-art">{applied ? <Check size={15}/> : <WandSparkles size={15}/>}</span><span><b>{preset.label}</b><small>{preset.about}</small><em>{applied ? 'Applied · edit on right' : 'Apply to clip'}</em></span></button>; })}</div>
            }
          </div>; })}
        </section>}
        {leftTab === 'media' && timeline && <section className="ed-add ed-effect-tool" data-keep-panel><button className="ed-effect-category-head" aria-expanded={Boolean(effectNeedle) || effectSection === 'travel-map'} onClick={() => { if (!effectNeedle) setEffectSection(effectSection === 'travel-map' ? null : 'travel-map'); }}><span><b>Travel map</b><small>Animated route between places</small></span>{Boolean(effectNeedle) || effectSection === 'travel-map' ? <Minus size={14}/> : <Plus size={14}/>}</button>{(Boolean(effectNeedle) || effectSection === 'travel-map') && <TravelMapPanel compact format={timeline.format} onMade={async (mediaId) => {
          const item = await getPhoto(mediaId);
          setMedia((current) => [item, ...current.filter((each) => each.id !== item.id)]);
          const current = timelineRef.current;
          if (!current) return;
          const clip = newClip({ media_id: item.id, media_type: 'video', duration: item.duration, width: item.width, height: item.height }, newId());
          change(dropClip(current, clip, engineRef.current?.currentTime ?? 0));
          setSelectedId(clip.id);
        }}/>}</section>}
        {leftTab === 'effects' && (!effectNeedle || matchingOverlayEffects.length > 0 || 'thunder weather sound'.includes(effectNeedle)) && <section className="ed-add" aria-label="Special effects">
          <h3>Add an overlay</h3><p className="ed-tip">Effects sit above your video as layers. Click to add at the playhead, or drag onto the timeline.</p>
          {(['weather', 'celebration', 'wedding', 'festival', 'travel', 'vlog'] as const).map((mood) => { const group = matchingOverlayEffects.filter((effect) => effect.mood === mood); const thunderMatches = mood === 'weather' && (!effectNeedle || 'thunder weather sound'.includes(effectNeedle)); const label = { weather: 'Weather', celebration: 'Celebration', wedding: 'Wedding', festival: 'Festival', travel: 'Travel', vlog: 'Vlog and film' }[mood]; const section = `overlay-${mood}`; const open = Boolean(effectNeedle) || effectSection === section; return (group.length > 0 || thunderMatches) && <div key={mood} className="ed-effect-category">
            <button className="ed-effect-category-head" aria-expanded={open} onClick={() => { if (!effectNeedle) setEffectSection(open ? null : section); }}><span><b>{label}</b><small>{group.length + (thunderMatches ? 1 : 0)} effects</small></span>{open ? <Minus size={14}/> : <Plus size={14}/>}</button>
            {open && <>{mood === 'weather' && <details className="ed-weather-custom" data-keep-panel><summary>Customize weather</summary><div className="ed-weather-settings">
              <details className="ed-weather-block"><summary>Rain</summary>
                <ValueSlider label="Amount" value={weather.rainDensity} min={0.25} max={2} step={0.25} defaultValue={1} unit="%" factor={100} onChange={(rainDensity) => setWeather({ ...weather, rainDensity })}/>
                <ValueSlider label="Fall speed" value={weather.rainSpeed} min={0.6} max={1.6} step={0.1} defaultValue={1} unit="×" decimals={1} onChange={(rainSpeed) => setWeather({ ...weather, rainSpeed })}/>
                <Chips label="Wind" options={[{ id: 'left' as const, label: 'Left' }, { id: 'straight' as const, label: 'Still' }, { id: 'right' as const, label: 'Right' }]} value={weather.rainDirection} onPick={(rainDirection) => setWeather({ ...weather, rainDirection })}/></details>
              <details className="ed-weather-block"><summary>Fog</summary>
                <ValueSlider label="Density" value={weather.fogDensity} min={0.2} max={1.25} step={0.05} defaultValue={0.65} unit="%" factor={100} onChange={(fogDensity) => setWeather({ ...weather, fogDensity })}/>
                <ValueSlider label="Drift speed" value={weather.fogSpeed} min={0.2} max={1.4} step={0.1} defaultValue={0.55} unit="×" decimals={1} onChange={(fogSpeed) => setWeather({ ...weather, fogSpeed })}/>
                <Chips label="Drift" options={[{ id: 'left' as const, label: 'Left' }, { id: 'straight' as const, label: 'Still' }, { id: 'right' as const, label: 'Right' }]} value={weather.fogDirection} onPick={(fogDirection) => setWeather({ ...weather, fogDirection })}/></details>
              <details className="ed-weather-block"><summary>Lightning</summary>
                <ValueSlider label="Flashes" value={weather.frequency} min={1} max={6} step={1} defaultValue={3} onChange={(frequency) => setWeather({ ...weather, frequency })}/>
                <ValueSlider label="Brightness" value={weather.brightness} min={0.25} max={1.25} step={0.05} defaultValue={0.8} unit="%" factor={100} onChange={(brightness) => setWeather({ ...weather, brightness })}/></details>
              <details className="ed-weather-block"><summary>Snow</summary>
                <ValueSlider label="Amount" value={weather.snowDensity} min={0.25} max={1.75} step={0.25} defaultValue={0.8} unit="%" factor={100} onChange={(snowDensity) => setWeather({ ...weather, snowDensity })}/>
                <ValueSlider label="Fall speed" value={weather.snowSpeed} min={0.4} max={1.5} step={0.1} defaultValue={0.8} unit="×" decimals={1} onChange={(snowSpeed) => setWeather({ ...weather, snowSpeed })}/>
                <Chips label="Wind" options={[{ id: 'left' as const, label: 'Left' }, { id: 'straight' as const, label: 'Still' }, { id: 'right' as const, label: 'Right' }]} value={weather.snowDirection} onPick={(snowDirection) => setWeather({ ...weather, snowDirection })}/></details>
              <button className="ed-button wide" disabled={Boolean(effectBusy)} onClick={() => setWeather({ ...weather, seed: (weather.seed + 1) % 100 })}><Shuffle size={13}/>New variation · {weather.seed + 1}</button>
              <p className="ed-tip">Optional controls for the next weather effect you add.</p>
            </div></details>}
            <div className="ed-quick ed-effects">{group.map((effect) => <button key={effect.id} className={`ed-quick-tile fx-${effect.id}`} {...draggableAs({ kind: 'effect', effect: effect.id })} disabled={!total || Boolean(effectBusy)} onClick={() => { void addEffect(effect.id); }} title={`${effect.about}. Click to add at the playhead, or drag onto the timeline.`}>
              <span className="ed-quick-art">{effectBusy?.id === effect.id && <LoaderCircle className="spin" size={14}/>}</span><b>{effect.label}</b><em lang="ta">{effect.tamil}</em></button>)}{thunderMatches && <button className="ed-quick-tile fx-thunder" disabled={!total || thunderBusy} onClick={() => { void addThunder(); }} title="Add locally generated thunder at the playhead. It is an editable sound clip.">
                <span className="ed-quick-art">{thunderBusy && <LoaderCircle className="spin" size={14}/>}</span><b>Thunder</b><em lang="ta">இடி</em></button>}</div></>}
          </div>; })}
          {effectBusy && <p className="ed-tip" role="status">Making the effect for this video's shape… {effectBusy.progress}%. Next time it's instant.</p>}
          {!effects.length && <p className="ed-tip">Loading effects…</p>}
        </section>}
        {leftTab === 'effects' && effectNeedle && !matchingClipEffects.length && !matchingOverlayEffects.length && !'thunder weather sound hide blur pixelate face privacy'.includes(effectNeedle) && <div className="ed-effect-empty"><b>No effects found</b><span>Try a name such as film, rain, VHS, wedding or light.</span></div>}
        {leftTab === 'effects' && (!effectNeedle || 'privacy hide blur pixelate face'.includes(effectNeedle)) && <section className="ed-add" aria-label="Privacy"><h3 className="ed-sub">{t('Privacy')}</h3><p className="ed-tip">Covers a face, a number plate or a screen. It can follow what it covers.</p>
            <div className="ed-add-grid">
              <button className="ed-button" disabled={!total} onClick={() => addBlurBox('blur')}><EyeOff size={13}/>Blur box</button>
              <button className="ed-button" disabled={!total} onClick={() => addBlurBox('pixelate')}><EyeOff size={13}/>Pixelate box</button>
              {faceJob ? <div className="ed-add-span"><div className="ed-progress"><i style={{ width: `${faceJob.progress}%` }}/></div><p className="ed-tip">Finding faces… {faceJob.progress}%</p><button className="ed-button wide" onClick={() => { void cancelRenderJob(faceJob.jobId); setFaceJob(null); }}>Cancel</button></div>
                : <button className="ed-button ed-add-span" disabled={!total} onClick={() => { void blurFaces(); }} title="Finds every face in the clip at the playhead and blurs each one"><ScanFace size={14}/>Blur faces</button>}
            </div>
            {faceNote && <p className="ed-tip" role="status">{faceNote}</p>}</section>}
        {leftTab === 'text' && <>
          <section className="ed-add" aria-label="Titles"><h3 className="ed-sub">Titles</h3><p className="ed-tip">Click to add at the playhead, or drag onto the timeline, then type your words.</p>
            <div className="ed-templates">{TEMPLATES.map((template) => <button key={template.id} className="ed-template" {...draggableAs({ kind: 'title', template: template.id })} onClick={() => addTitle(template)} title={`Add a ${template.label} title`}>
              <span className="ed-template-art">{thumbs[template.id] ? <img src={thumbs[template.id]} alt=""/> : <Type size={16}/>}</span><span>{template.label}</span></button>)}</div>
            {myStyles.length > 0 && <><h3 className="ed-sub">My styles</h3><div className="ed-templates">{myStyles.map((style) => <div key={style.id} className="ed-template-wrap">
              <button className="ed-template" {...draggableAs({ kind: 'title', template: style.id })} onClick={() => addTitle(style)} title="Add a title in this style"><span className="ed-template-art">{thumbs[style.id] ? <img src={thumbs[style.id]} alt=""/> : <Type size={16}/>}</span><span>{style.label}</span></button>
              <button className="ed-icon small ed-template-forget" aria-label={`Forget the style ${style.label}`} title="Forget this style" onClick={() => forgetStyle(style.id)}><X size={12}/></button></div>)}</div></>}</section>
          <section className="ed-add" aria-label="Captions"><h3 className="ed-sub">Captions</h3>
            {layout.simple ? <>
              <p className="ed-tip">Writes the words people say, timed to their speech.</p>
              {captionsWaiting && wordJob ? <p className="ed-tip" role="status">Listening to your video… {wordJob.progress}%</p>
                : <button className="ed-button wide" disabled={!total} onClick={() => makeCaptions()}><Captions size={14}/>{timeline && captionLayers(timeline).length ? 'Make captions again' : 'Add captions'}</button>}
            </> : <>
            <p className="ed-tip">Turns the speech in your main track into captions{timeline && captionLayers(timeline).length ? '. Making them again replaces the old ones.' : '.'}</p>
            <label className="ed-words-language"><span>{t('Spoken language')}</span><KanaaSelect aria-label={t('Spoken language')} value={language} onChange={(event) => { setLanguage(event.target.value); try { localStorage.setItem('wa.wordsLanguage', event.target.value); } catch { /* the choice just isn't remembered */ } }}>{LANGUAGES.map((option) => <option key={option.id} value={option.id}>{t(option.label)}</option>)}</KanaaSelect></label>
            <div className="ed-add-row"><span>Words per caption</span><div className="ed-chips ed-even" role="group" aria-label="Words per caption">{[1, 2, 3, 4].map((count) => <button key={count} className={captionWords === count ? 'on' : ''} aria-pressed={captionWords === count} onClick={() => setCaptionWords(count)}>{count}</button>)}</div></div>
            {captionsWaiting && wordJob ? <><div className="ed-progress"><i style={{ width: `${wordJob.progress}%` }}/></div><p className="ed-tip">Listening to your video… {wordJob.progress}%. The captions follow.</p></>
              : <button className="ed-button wide" disabled={!total} onClick={() => makeCaptions()}><Captions size={14}/>{timeline && captionLayers(timeline).length ? 'Make captions again' : 'Add captions'}</button>}
            {timeline && captionLayers(timeline).some((layer) => layer.items.length) && <button className="ed-button wide" disabled={clearing} onClick={() => { void keepClearOfFaces(); }} title="A caption that would cover someone's face moves to the top for that moment"><ScanFace size={14}/>{clearing ? 'Looking for faces…' : 'Keep captions clear of faces'}</button>}
            {clearNote && <p className="ed-tip" role="status">{clearNote}</p>}</>}</section>
        </>}
        {leftTab === 'audio' && <>
          <section className="ed-add" aria-label="Your music"><h3 className="ed-sub">Your music library</h3>
            {library === null ? <p className="ed-tip">Reading your Music library…</p> : !library.length ? <p className="ed-tip">No music found in {libraryFolder || 'your Music app folder'}.</p> : (() => {
              const query = musicSearch.trim().toLowerCase();
              const visible = library.filter((track) => (!musicMood || track.mood === musicMood) && (!query || track.name.toLowerCase().includes(query) || (track.genre ?? '').toLowerCase().includes(query)));
              return <>
              <div className="ed-effect-search" data-keep-panel><Search size={14}/><input type="search" value={musicSearch} onChange={(event) => setMusicSearch(event.target.value)} placeholder="Search songs or genres…" aria-label="Search music"/>{musicSearch && <button className="ed-icon small" aria-label="Clear music search" onClick={() => setMusicSearch('')}><X size={12}/></button>}</div>
              <div className="ed-chips" role="group" aria-label="Mood" data-keep-panel>{([null, ...MOODS] as (Mood | null)[]).map((mood) => <button key={mood ?? 'all'} className={musicMood === mood ? 'on' : ''} aria-pressed={musicMood === mood} onClick={() => setMusicMood(mood)}>{mood ? MOOD_LABELS[mood] : 'All'}</button>)}</div>
              {visible.length ? <ul className="ed-tracks" data-keep-panel>{visible.map((track) => <li key={track.id} className={listening === track.id ? 'playing' : ''} {...draggableAs({ kind: 'track', track: track.id })} title="Drag onto the timeline to add it there">
                <button className="ed-icon small" aria-label={`${listening === track.id ? 'Stop' : 'Listen to'} ${track.name}`} onClick={() => listen(track.id)}>{listening === track.id ? <Pause size={13}/> : <Play size={13}/>}</button>
                <span><b title={track.name}>{track.name}</b><small>{[track.genre, timecode(track.seconds).replace(/\.\d+$/, '')].filter(Boolean).join(' · ')}</small></span>
                <button className="ed-icon small" aria-label={`Add ${track.name} at the playhead`} title="Add at the playhead" disabled={addingMusic} onClick={() => { void addLibraryTrack(track); }}><Plus size={14}/></button></li>)}</ul>
              : <p className="ed-tip">No tracks match {musicSearch ? `“${musicSearch}”` : 'this filter'}{musicMood ? ` in ${MOOD_LABELS[musicMood]}` : ''}.</p>}
              <p className="ed-tip">+ adds at the playhead, drag goes to the timeline, play previews. From {libraryFolder}; your files are only read.</p>
              </>;
            })()}
          </section>
          <section className="ed-add" aria-label="Your own song"><h3 className="ed-sub">Add your own song</h3><p className="ed-tip">Any audio file, added at the playhead; it dips under speech.</p>
            <label className={`ed-button wide ed-music ${addingMusic ? 'busy' : ''}`}>{addingMusic ? <LoaderCircle className="spin" size={15}/> : <Music size={15}/>}{addingMusic ? 'Adding music…' : 'Choose an audio file'}
              <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg" disabled={addingMusic} aria-label="Add music" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void addMusic(file); }}/></label>
          </section>
          {!layout.simple && <section className="ed-add" aria-label="Whooshes and hits"><h3 className="ed-sub">Whooshes and hits</h3><p className="ed-tip">A whoosh on each cut and a hit on each title, landed on the moment.</p>
            {(['whoosh', 'hit'] as const).map((kind) => { const choices = (soundEffects ?? []).filter((effect) => effect.kind === kind); const placed = timeline ? timeline.layers.some((layer) => layer.kind === 'audio' && layer.items.some((sound) => sound.name === (kind === 'whoosh' ? 'Whoosh' : 'Hit'))) : false; return <div key={kind} className="ed-sfx">
              <label className="ed-field">{kind === 'whoosh' ? 'Whoosh' : 'Hit'}<select value={sfxChoice[kind]} onChange={(event) => setSfxChoice({ ...sfxChoice, [kind]: event.target.value })}>{choices.length ? choices.map((effect) => <option key={effect.id} value={effect.id}>{effect.name}{effect.own ? '' : ' · your library'}</option>) : <option value={`kanaa-${kind}`}>{kind === 'whoosh' ? "Kanaa's whoosh" : "Kanaa's hit"}</option>}</select></label>
              <div className="ed-pair-small"><button className="ed-button" disabled={!total || sfxBusy !== null} onClick={() => { void addSoundEffects(kind); }}>{sfxBusy === kind ? <LoaderCircle className="spin" size={13}/> : <AudioLines size={13}/>}{kind === 'whoosh' ? 'On transitions' : 'On titles'}</button>
                {placed && <button className="ed-icon small" aria-label={`Remove the ${kind === 'whoosh' ? 'whooshes' : 'hits'}`} title="Remove them" onClick={() => { if (timeline) change(removeEffects(timeline, kind)); }}><X size={13}/></button>}</div></div>; })}
            {sfxNote && <p className="ed-tip" role="status">{sfxNote}</p>}
            {soundEffects && soundEffects.every((effect) => effect.own) && <p className="ed-tip">Whooshes and hits in your music library (by name, under 30 seconds) show here too.</p>}</section>}
          {!layout.simple && <section className="ed-add" aria-label="Cut to the beat"><h3 className="ed-sub">Cut to the beat</h3><p className="ed-tip">Each clip on the main track ends on the song's nearest beat, so cuts land with the music.</p>
            <button className="ed-button wide" disabled={!total || beatBusy || Boolean(timeline && mainLayer(timeline).locked)} onClick={() => { void cutClipsToBeat(); }}>{beatBusy ? <LoaderCircle className="spin" size={14}/> : <AudioLines size={14}/>}{beatBusy ? 'Listening for the beat…' : 'Cut clips to the beat'}</button>
            {beatNote && <p className="ed-tip" role="status">{beatNote}</p>}</section>}
        </>}
        </div>}
      </aside>
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
      <aside className="ed-inspector" aria-label="Clip settings"><LayerModeContext.Provider value={Boolean(layerSettings)}>{inspectorOpen && <>{selectedIdentity && <div className="ed-selection"><span>{t(selectedIdentity.kind)}</span>{selected && !settingsLayer ? <input key={selected.id} className="ed-selection-name" aria-label="Clip name" title="What this clip is for; shown on it in the timeline" maxLength={80} defaultValue={selected.name ?? ''} placeholder={mediaById.get(selected.media_id)?.filename ?? 'Clip name'}
        onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter' || event.key === 'Escape') { if (event.key === 'Escape') event.currentTarget.value = selected.name ?? ''; event.currentTarget.blur(); } }}
        onBlur={(event) => { const name = event.currentTarget.value.trim() || null; if ((selected.name ?? null) !== name) change(updateClip(timeline!, selected.id, { name })); }}/> : <strong title={selectedIdentity.name}>{selectedIdentity.name}</strong>}</div>}{moreIds.size > 0 && !layerSettings && <div className="ed-scope ed-multi"><b>{t('{count} items picked', { count: moreIds.size + 1 })}</b><span>{t('Changes apply to all of them (not their words or timing).')}</span><button className="ed-link" onClick={() => setMoreIds(new Set())}>{t('Just this one')}</button></div>}{!selectedLayer?.locked && (selectedText ? scopeBar(selectedText.id, 'title') : selected ? scopeBar(selected.id, 'clip') : null)}</>}{selectedLayer?.locked ? <div className="ed-hint"><h2>Layer locked</h2><p>Unlock this layer on the timeline to change it.</p></div>
        : selectedCaption ? <CaptionInspector caption={selectedCaption.caption} layer={selectedCaption.layer} timing={textTiming(selectedCaption.caption)}
          onText={(text) => change(updateCaption(timeline!, selectedCaption.caption.id, { words: retypeCaption(selectedCaption.caption, text) }), `caption-${selectedCaption.caption.id}`)}
          onLook={(changes, group) => change(updateCaptionLook(timeline!, selectedCaption.layer.id, changes), group)} onRemoveAll={() => { change(setCaptions(timeline!, [], '')); setSelectedId(null); }}/>
        : selectedBlur ? <BlurInspector blur={selectedBlur} timing={textTiming(selectedBlur)} local={blurLocal} onChange={updateSelectedBlur} onSeekLocal={(t) => seek(selectedBlur.start + t)} onPause={pauseEngine} follow={followPanel}/>
        : selectedText ? <TextInspector text={selectedText} groundGap={groundRiseGap(timeline!, selectedText.id)} onGroundGap={(depth_gap) => change(setGroundRiseGap(timeline!, selectedText.id, depth_gap), `ground-gap-${selectedText.id}`)} onSaveStyle={() => saveStyle(selectedText)} onBehindShape={(reveal, mode) => { engineRef.current?.pause(); setShaping({ textId: selectedText.id, mode, points: [], reveal }); }} cover={(() => { const index = timeline ? timeline.layers.findIndex((layer) => layer.kind === 'text' && (layer.items as TextItem[]).some((item) => item.id === selectedText.id)) : -1; const next = index >= 0 ? timeline!.layers[index + 1] : null; if (next?.kind === 'video') { if (next.name === 'Person') return 'people' as const; if (next.name === 'Object') return 'object' as const; if (next.name === 'Land') return 'land' as const; if (next.name === 'In front') return 'drawn' as const; } return 'front' as const; })()} shapingMode={shaping && shaping.textId === selectedText.id ? shaping.mode : null} onCinemaClear={() => change(removeCinemaReveal(timeline!, selectedText.id), `cinema-clear-${selectedText.id}`)} onCinemaFront={(reveal) => { const next = cinemaRevealFront(timeline!, selectedText.id, reveal); change(next, `cinema-front-${selectedText.id}`); setSelectedId(selectedText.id); showEnter(selectedText.start, reveal === 'push' ? 1.4 : 1.2); }} onCinema={(reveal, what) => { const ids: [string, string] = [newId(), newId()]; // People or an object in front, and keeping clear of them, pull opposite ways: the title would dodge every frame.
            const base = selectedText.keep_clear && what !== 'land' ? updateText(timeline!, selectedText.id, removeKeepClear(selectedText)) : timeline!; if (base !== timeline) setKeepClearNote(null); const next = cinemaReveal(base, selectedText.id, reveal, what, ids); if (next === base) setError('Put the title over a video clip on the main track first.'); else { change(next, `cinema-${selectedText.id}`); setSelectedId(selectedText.id); showEnter(selectedText.start, reveal === 'push' ? 1.4 : 1.2); } }} placing={placing?.textId === selectedText.id ? (placing.busy ? 'busy' : 'waiting') : null} onPlace={() => setPlacing((now) => now?.textId === selectedText.id ? null : { textId: selectedText.id, busy: false })} onSurface={(kind) => { void placeInScene(selectedText, null, kind); }} pinning={pinProgress} onPin={(on) => { void pinTitle(selectedText, on); }} staying={stayProgress} onStayCover={(banner) => { const next = banner ? setGroundRiseGap(putBehindPerson(timeline!, selectedText.id, [newId(), newId()]), selectedText.id, TITLE_SPACE.close) : cinemaRevealFront(timeline!, selectedText.id, 'pass'); change(next, `stay-cover-${selectedText.id}`); setSelectedId(selectedText.id); }} stayNote={stayNote?.textId === selectedText.id ? stayNote.text : null} onStay={() => { void stayWithPeople(selectedText); }} onStopStay={() => { change(updateText(timeline!, selectedText.id, removeStay(selectedText)), `stay-${selectedText.id}`); setStayNote(null); }} clearing={clearProgress} clearUnder={timeline ? clipUnderTitle(timeline, selectedText) : null} clearNote={keepClearNote?.textId === selectedText.id ? keepClearNote.text : null} onKeepClear={(settings) => { void keepTitleClear(selectedText, settings); }} onRemoveClear={() => { change(updateText(timeline!, selectedText.id, removeKeepClear(selectedText)), `keep-clear-${selectedText.id}`); setKeepClearNote(null); }} timing={textTiming(selectedText)} local={textLocal} onSeekLocal={(t) => seek(selectedText.start + t)} onPause={pauseEngine} follow={followPanel} onChange={updateSelectedText} onEnter={() => showEnter(selectedText.start, selectedText.enter?.duration ?? 0.5)} onExit={() => showExit(selectedText.start + selectedText.length, selectedText.exit?.duration ?? 0.5)}/>
        : selectedSound ? <SoundInspector onLoop={timeline && needsLoop(timeline, selectedSound.sound) && !selectedSound.layer.locked ? () => { void loopSelectedSound(selectedSound.sound.id); } : null} looping={looping} sound={selectedSound.sound} timing={soundTiming(selectedSound.sound)} layer={selectedSound.layer} onChange={updateSelectedSound} onLayer={(changes) => change(updateLayer(timeline!, selectedSound.layer.id, changes))}
        stems={stems} job={stemJob?.soundId === selectedSound.sound.id ? stemJob : null} busy={Boolean(stemJob)} onSeparate={(choice) => { void separate(choice); }} onCancelStems={() => { if (stemJob) void cancelRenderJob(stemJob.jobId); }}/>
        : selected ? <Inspector onReframe={(() => { const item = mediaById.get(selected.media_id); return item?.media_type === 'video' && item.width && item.height && timeline && canReframe({ width: item.width, height: item.height }, selected.adjust.rotation, timeline.format) ? () => { void reframeClip(selected.id); } : null; })()} reframing={Boolean(reframeJob)} onMove={(move) => { void moveSelected(move); }} backgrounds={media.filter((item) => item.id !== selected.media_id && (item.media_type === 'video' || item.media_type === 'image'))} onBackground={(item) => newBackground(selected, item)} logos={media.filter((item) => isBrandImage(item) && item.id !== selected.media_id)} clipBrandMarks={brandsOnClip(timeline!, selected).map((mark) => ({ id: mark.id, name: mediaById.get(mark.media_id)?.filename ?? `Media ${mark.media_id}` }))} onClipBrand={(item) => change(brandOnClip(timeline!, selected, { media_id: item.id, width: item.width || 800, height: item.height || 800 }, 'top-right', BRAND_SIZES[1].scale, newId()), 'brand')} onRemoveClipBrand={(id) => change(removeClipBrand(timeline!, id), 'brand')} clip={selected} source={sourceFor(selected.media_id)} format={timeline!.format} onChange={updateSelected} canDetach={!selected.muted && hasSound(selected.media_id)} onDetach={() => detach()}
          local={local} onSeekLocal={(t) => seek(selected.start + t)} onPause={pauseEngine} follow={followPanel} isMain={selectedLayer === mainLayer(timeline!)} copyReady={Boolean(preparedWant(selected, timeline!.format.fps) && preparedReady[preparedKey(selected.media_id, ...preparedWant(selected, timeline!.format.fps)!)])} onLayout={splitScreen} picking={pickingKey} onPick={startPicking} timing={clipTiming(selected)} overlay={selectedLayer?.kind === 'video' && !selectedLayer.magnetic && selectedLayer !== mainLayer(timeline!) ? selectedLayer : null} onLayer={(changes) => change(updateLayer(timeline!, selectedLayer!.id, changes))} closesWithTransition={Boolean(clipsInOrder[clipIndex + 1]?.transition_in)}
          onShowEnter={() => showEnter(selected.start, selected.enter?.duration ?? 0.5)} onShowExit={() => showExit(selected.start + clipLength(selected), selected.exit?.duration ?? 0.5)}/> : timeline ? <ProjectInspector introBusy={introProgress} onBrandIntro={(item, tamil, english) => { void addBrandIntro(item, tamil, english); }} timeline={timeline} clipFormat={firstClipFormat && { ...firstClipFormat, fps: timeline.format.fps }} logos={media.filter(isBrandImage)} logo={(() => { const item = brandClip(timeline); return item ? media.find((entry) => entry.id === item.media_id) ?? null : null; })()} onBrand={(item) => change(applyBrand(timeline, { media_id: item.id, width: item.width || 800, height: item.height || 800 }, 'top-right', BRAND_SIZES[1].scale, newId()), 'brand')} onImported={(items) => {
            // A logo imported here is a brand picture: it goes into the Brand folder.
            const images = items.filter((item) => item.media_type === 'image');
            const filed = items.map((item) => item.media_type === 'image' ? { ...item, folder: BRAND_FOLDER } : item);
            setMedia((current) => [...filed, ...current]);
            if (images.length) void moveMediaToFolder(images.map((item) => item.id), BRAND_FOLDER).catch(() => {});
          }} onRemoveBrand={() => change(removeBrand(timeline), 'brand')} onChange={change} onPause={pauseEngine} onThemes={() => { setLeftTab('themes'); setPanelOpen(true); }} onGuide={() => setShowingHelp(true)}/>
          : <div className="ed-hint"><h2>Project settings</h2><p>Loading your project…</p></div>}</LayerModeContext.Provider></aside>
      </RailContext.Provider>
      </HelpContext.Provider>
    </div>
    <Splitter label="Resize timeline" axis="y" value={Math.min(layout.timeline, Math.round(window.innerHeight * 0.55))} min={LIMITS.timeline[0]} max={Math.round(window.innerHeight * 0.55)} sign={-1} onChange={(height) => updateLayout({ timeline: height })} onReset={() => updateLayout({ timeline: DEFAULT_LAYOUT.timeline })}/>
    <div className="ed-lower"><div className="ed-tools">
      <span className="ed-tool-group" role="group" aria-label="Edit tools">
        <button className="ed-button ed-icon-button" onClick={() => dispatch({ type: 'undo' })} disabled={!history.past.length} aria-label={t('Undo')} title={`${t('Undo')} (⌘Z)`}><Undo2 size={15}/></button>
        <button className="ed-button ed-icon-button" onClick={() => dispatch({ type: 'redo' })} disabled={!history.future.length} aria-label={t('Redo')} title={`${t('Redo')} (⇧⌘Z)`}><Redo2 size={15}/></button>
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
    {timeline && <TimelineView timeline={timeline} selectedId={layerSettings ? null : selectedId} zoom={zoom} theme={theme} onItemMenu={openItemMenu} playhead={playhead} source={facts} visuals={(id) => visuals.current.get(id) ?? {}} soundPeaks={soundPeaks} snapping={snapping} onSelect={(id, how) => { setLayerSettings(null); setPickedInPreview(null); setEditingTitle(null); pick(id, how); }} selectedIds={moreIds} onLayerSettings={openLayerSettings} layerSettingsId={layerSettings} onSeek={seek} onChange={change} onScrubStart={() => engineRef.current?.pause()} onDropPayload={onDropPayload}
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

/** The editor's less-used top-bar controls behind one gear: theme, Lite or Pro, and the project's format. */
function TopSettings({ appearance, onAppearance, simple, onSimple, format, onProject }: { appearance: ThemeChoice; onAppearance: (choice: ThemeChoice) => void; simple: boolean; onSimple: (simple: boolean) => void; format: string; onProject: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key); };
  }, [open]);
  return <div className="ed-top-settings" ref={box}>
    <button className={open ? 'on' : ''} aria-label={t('Settings')} aria-haspopup="menu" aria-expanded={open} data-tip={t('Settings')} onClick={() => setOpen((value) => !value)}><Settings2 size={17}/></button>
    {open && <div className="ed-top-menu" role="menu">
      <div className="ed-top-row"><span>{t('Editor')}</span><div className="ed-mode" role="group" aria-label={t('Editor')}>
        <button aria-pressed={simple} className={simple ? 'on' : ''} onClick={() => onSimple(true)} title={t('Main choices only')}>Lite</button>
        <button aria-pressed={!simple} className={simple ? '' : 'on'} onClick={() => onSimple(false)} title={t('Every control')}>Pro</button>
      </div></div>
      <div className="ed-top-row"><span>{t('Language')}</span><div className="ed-mode" role="group" aria-label={t('Language')}>
        <button aria-pressed={LANGUAGE === 'en'} className={LANGUAGE === 'en' ? 'on' : ''} onClick={() => { if (LANGUAGE !== 'en') setLanguage('en'); }}>English</button>
        <button aria-pressed={LANGUAGE === 'ta'} className={LANGUAGE === 'ta' ? 'on' : ''} lang="ta" onClick={() => { if (LANGUAGE !== 'ta') setLanguage('ta'); }}>தமிழ்</button>
      </div></div>
      <div className="ed-top-row"><span>{t('Appearance')}</span><div className="ed-mode" role="group" aria-label={t('Appearance')}>
        {([['system', <Monitor key="m" size={15}/>, 'Same as this Mac'], ['light', <Sun key="s" size={15}/>, 'Light'], ['dark', <Moon key="d" size={15}/>, 'Dark']] as const).map(([choice, icon, label]) =>
          <button key={choice} aria-pressed={appearance === choice} className={appearance === choice ? 'on' : ''} onClick={() => onAppearance(choice)} title={t(label)} aria-label={t(label)}>{icon}</button>)}
      </div></div>
      <button className="ed-top-item" role="menuitem" onClick={() => { onProject(); setOpen(false); }}><SlidersHorizontal size={15}/><span>{t('Project settings')}</span><em>{format}</em></button>
    </div>}
  </div>;
}

const SHORTCUTS: [string, string][] = [['⌘K', 'Find any action or setting'], ['Space', 'Play or pause'], ['F', 'Full screen preview'], ['S', 'Split at the playhead'], ['Delete', 'Delete the selected item'], ['I / O', 'Trim the clip start or end to the playhead'], ['← →', 'Move one frame (Shift for ten)'], ['J / K / L', 'Back a second, pause, play faster'], ['⌘Z / ⇧⌘Z', 'Undo and redo'], ['?', 'Show this guide']];


/** What is active on this clip, each with a switch to compare with and without it, and Remove. */
let effectsOpen = false;  // Whether the list of a clip's effects is unfolded; kept while moving between clips.
function ActiveEffects({ clip, onChange }: { clip: Clip; onChange: (changes: Partial<Clip>) => void }) {
  const effects = clipEffects(clip);
  const [open, setOpen] = useState(effectsOpen);
  // A folded panel is only its tab rail: there is no room for the list.
  const folded = useContext(RailContext).folded;
  if (!effects.length || folded) return null;
  const allOff = effects.every((effect) => !effect.on);
  const on = effects.filter((effect) => effect.on).length;
  // One line until unfolded, so the settings below keep their room.
  return <section className={`ed-effects ${open ? 'open' : ''}`} aria-label="Active on this clip">
    <div className="ed-effects-head">
      <button className="ed-effects-toggle" aria-expanded={open} onClick={() => { effectsOpen = !open; setOpen(!open); }}><ChevronRight size={13}/>
        <span>{t('Effects')} ({on}/{effects.length})</span>{!open && <small>{effects.map((effect) => t(effect.label)).join(' · ')}</small>}</button>
      {open && effects.length > 1 && <button className="ed-link" onClick={() => onChange(toggleAllEffects(clip))}>{allOff ? t('All back on') : t('All off')}</button>}
    </div>
    {open && <ul>{effects.map((effect) => <li key={effect.id} className={effect.on ? '' : 'off'}>
      <button className="ed-effect-switch" role="switch" aria-checked={effect.on} aria-label={`${effect.label}: ${effect.on ? 'on' : 'off'}`} title={effect.on ? 'Turn off to compare; its settings are kept' : 'Turn back on'} onClick={() => onChange(toggleEffect(clip, effect.id))}>{effect.on ? <Eye size={13}/> : <EyeOff size={13}/>}</button>
      <span className="ed-effect-name"><b>{effect.label}</b><small>{effect.on ? effect.detail : `off · ${effect.detail}`}</small></span>
      <button className="ed-icon small" aria-label={`Remove ${effect.label}`} title="Remove it (undo brings it back)" onClick={() => onChange(removeEffect(clip, effect.id))}><X size={12}/></button>
    </li>)}</ul>}
  </section>;
}

/** Settings for the whole film: its shape and frame rate, its look, and its sound. Shown when nothing is selected. */
const FRAME_RATES = [24, 25, 30, 50, 60] as const;
const RATE_TIPS: Record<number, string> = { 24: 'the film look', 25: 'TV in India and Europe', 30: 'most phones; a safe choice', 50: 'smooth motion, PAL', 60: 'smoothest; sport and action' };
/** The animated brand intro: a leaf falls among music notes and becomes the logo, with Tamil and English lines beneath. */
function BrandIntroGroup({ logos, logo, busy, has, onMake }: { logos: Photo[]; logo: Photo | null; busy: number | null; has: boolean; onMake: (logo: Photo, tamil: string, english: string) => void }) {
  const [chosen, setChosen] = useState<number | null>(logo?.id ?? null);
  const [tamil, setTamil] = useState('வழங்கும்');
  const [english, setEnglish] = useState('PRESENTS');
  const picked = logos.find((item) => item.id === (chosen ?? logo?.id)) ?? null;
  return <Group title="Brand intro" tab="brand" startOpen={has} changed={has} keywords="brand intro logo animation opening presents vazhangum leaf notes channel" tip="Your logo comes to life at the start: a leaf falls among music notes and becomes it, with வழங்கும் and PRESENTS beneath." help="brand-watermark">
    <label className="ed-lut-field"><span>Logo</span><KanaaSelect aria-label="Logo for the brand intro" value={picked ? String(picked.id) : ''} onChange={(event) => setChosen(Number(event.target.value) || null)}>
      <option value="">Choose a logo…</option>{logos.map((item) => <option key={item.id} value={item.id}>{item.filename}</option>)}
    </KanaaSelect></label>
    <label className="ed-lut-field"><span>Tamil line</span><input className="ed-text" lang="ta" value={tamil} maxLength={40} onChange={(event) => setTamil(event.target.value)} aria-label="Tamil line under the logo"/></label>
    <label className="ed-lut-field"><span>English line</span><input className="ed-text" value={english} maxLength={40} onChange={(event) => setEnglish(event.target.value)} aria-label="English line under the logo"/></label>
    <button className="ed-button wide primary" disabled={!picked || busy !== null} onClick={() => picked && onMake(picked, tamil.trim(), english.trim())}>{busy !== null ? `Making the intro… ${busy}%` : has ? 'Replace the brand intro' : 'Add brand intro at the start'}</button>
    <p className="ed-group-tip">A logo with a transparent background (PNG) works best: its largest shape falls as the leaf, and anything cut out of it appears when it strikes the notes. 5.5 seconds, made once.</p>
  </Group>;
}

function ProjectInspector({ introBusy, onBrandIntro, timeline, clipFormat, logos, logo, onBrand, onImported, onRemoveBrand, onChange, onPause, onThemes, onGuide }: { introBusy: number | null; onBrandIntro: (logo: Photo, tamil: string, english: string) => void; timeline: Timeline; clipFormat: Format | null; logos: Photo[]; logo: Photo | null; onBrand: (item: Photo) => void; onImported: (items: Photo[]) => void; onRemoveBrand: () => void; onChange: (next: Timeline, group?: string) => void; onPause: () => void; onThemes: () => void; onGuide: () => void }) {
  const format = timeline.format;
  const finish = timeline.finish ?? null;
  const brand = brandClip(timeline);
  const brandSource = logo ? { width: logo.width || 800, height: logo.height || 800 } : null;
  const nearSize = brand ? BRAND_SIZES.reduce((best, entry) => Math.abs(entry.scale - brand.transform.scale) < Math.abs(best.scale - brand.transform.scale) ? entry : best, BRAND_SIZES[1]).id : 'medium';
  const cinematicOn = Boolean(finish && (finish.grade || finish.glow || finish.vignette || finish.grain));
  const theme = activeTheme(timeline);
  const [luts, setLuts] = useState<LutInfo[]>([]);
  const [lutFolder, setLutFolder] = useState('');
  useEffect(() => { void listLuts().then((found) => { setLuts(found.luts); setLutFolder(found.folder); }).catch(() => setLuts([])); }, []);
  const ratio = (width: number, height: number) => { const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a); const d = gcd(width, height); return `${width / d}:${height / d}`; };
  const setFormat = (next: Partial<Format>) => onChange({ ...timeline, format: { ...format, ...next } });
  const setFinish = (next: Finish | null, group?: string) => onChange({ ...timeline, finish: next }, group);
  const part = (key: 'grade' | 'glow' | 'vignette' | 'grain', label: string) => <ValueSlider key={key} label={label} value={finish?.[key] ?? 0} min={0} max={1} step={0.05} defaultValue={CINEMATIC[key]} unit="%" factor={100}
    onGestureStart={onPause} onChange={(value, group) => setFinish({ ...(finish ?? { ...CINEMATIC, letterbox: false, grade: 0, glow: 0, vignette: 0, grain: 0 }), [key]: value }, group ?? `finish-${key}`)}/>;
  const shapes = [...FORMATS.map((item) => ({ id: item.id as string, label: item.label, width: item.width, height: item.height })), ...(clipFormat ? [{ id: 'clip', label: 'Same as my clip', width: Math.min(clipFormat.width, 3840), height: Math.min(clipFormat.height, 3840) }] : [])];
  return <>
    {!useContext(RailContext).folded && <div className="ed-project-head"><h2>Project settings</h2><span>{format.width} × {format.height} · {ratio(format.width, format.height)} · {format.fps} fps</span></div>}
    <Panel id="project" tabs={[{ id: 'format', label: 'Format', Icon: Monitor }, { id: 'look', label: 'Colour & finish', Icon: SlidersHorizontal, changed: Boolean(finish || theme || timeline.lut) }, { id: 'brand', label: 'Brand', Icon: BadgeCheck, changed: Boolean(brand) }, { id: 'sound', label: 'Sound', Icon: Volume2, changed: Boolean(timeline.normalize_audio) }]}>
      <Group title="Shape and size" tab="format" startOpen keywords="canvas aspect ratio resolution size vertical reels youtube square portrait" tip="Where will you post it? Clips refit to the new shape." help="project-settings">
        <div className="ed-shapes">{shapes.map((item) => { const on = item.width === format.width && item.height === format.height; return <button key={item.id} className={on ? 'on' : ''} aria-pressed={on} onClick={() => setFormat({ width: item.width, height: item.height })} title={`${item.width} × ${item.height}`}>
          <i style={{ aspectRatio: `${item.width} / ${item.height}` }}/><span><b>{item.label}</b><small>{ratio(item.width, item.height)} · {item.width} × {item.height}</small></span></button>; })}</div>
        <p className="ed-group-tip">Export can still make it 720p, 1080p or 4K; this sets the shape.</p>
      </Group>
      <Group pro title="Frame rate" tab="format" startOpen keywords="fps frame rate frames per second smooth 24 25 30 50 60" tip="How many pictures a second. Clips keep their timing when you change it." help="project-settings">
        <Chips label="Frame rate" options={FRAME_RATES.map((rate) => ({ id: String(rate), label: `${rate} fps` }))} value={String(format.fps)} onPick={(id) => setFormat({ fps: Number(id) })}/>
        <p className="ed-group-tip">{format.fps} fps: {RATE_TIPS[format.fps] ?? ''}.</p>
      </Group>
      <Group title="Theme" tab="look" startOpen keywords="theme look style wedding festival travel birthday" tip="One click dresses the whole video: colours, transitions, titles and music." help="themes">
        <div className="ed-add-row"><span>{theme ? <>Now: <b>{theme.label}</b></> : 'No theme'}</span><button className="ed-button" onClick={onThemes}>{theme ? 'Change theme' : 'Choose a theme'}</button></div>
      </Group>
      <Group title="Cinematic finish" tab="look" startOpen changed={cinematicOn || Boolean(finish?.letterbox)} keywords="cinematic film grade teal orange glow vignette grain preset bars letterbox widescreen 2.39 framing" tip="A film look over the whole video, and cinema bars if you want them." help="cinematic-finish">
        <h4 className="ed-finish-head">Look</h4>
        {(() => {
          const active = activeCinematicPreset(timeline);
          const custom = cinematicOn && !active;
          const bars = Boolean(finish?.letterbox);
          return <div className="ed-chips" role="group" aria-label="Cinematic look">
            <button className={!cinematicOn ? 'on' : ''} aria-pressed={!cinematicOn} title="No film look; your clips' own colours" onClick={() => onChange(clearCinematicPreset(timeline), 'cinematic-off')}>None</button>
            {CINEMATIC_PRESETS.map((preset) => { const on = active?.id === preset.id; return <button key={preset.id} className={on ? 'on' : ''} aria-pressed={on} title={preset.about}
              onClick={() => { if (on) return; const next = applyCinematicPreset(timeline, preset); onChange(bars ? { ...next, finish: { ...next.finish!, letterbox: true } } : next, `cinematic-${preset.id}`); }}>{preset.label}</button>; })}
            <button className={custom ? 'on' : ''} aria-pressed={custom} title="Teal and orange grade, glow, darker edges and grain, set by the sliders" onClick={() => { if (!custom) setFinish({ ...CINEMATIC, letterbox: bars }, 'cinematic-custom'); }}>Custom</button>
          </div>;
        })()}
        <p className="ed-group-tip">A preset sets the grade below and a colour look on every clip, on every video layer but the watermark; changing a slider makes it your own.</p>
        {cinematicOn && <>
          <h4 className="ed-finish-head">Adjust</h4>
          {part('grade', 'Teal and orange')}{part('glow', 'Glow')}{part('vignette', 'Dark edges')}{part('grain', 'Film grain')}
        </>}
        <h4 className="ed-finish-head">Frame</h4>
        {barShare(format) > 0 ? <label className="ed-check"><input type="checkbox" checked={Boolean(finish?.letterbox)} onChange={(event) => { const next = { ...(finish ?? { ...CINEMATIC, grade: 0, glow: 0, vignette: 0, grain: 0 }), letterbox: event.target.checked }; setFinish(event.target.checked || next.grade || next.glow || next.vignette || next.grain ? next : null); }}/><span>Widescreen bars<small>Black bars to the 2.39:1 cinema shape, with or without a look.</small></span></label>
          : <p className="ed-group-tip">Widescreen bars are for landscape and square projects.</p>}
      </Group>
      <Group title="Brand watermark" tab="brand" startOpen changed={Boolean(brand)} keywords="logo watermark brand mark corner badge" tip="Your logo stays over the whole video, preview and export alike. A PNG with a transparent background looks best." help="brand-watermark">
        {!brand ? <>
          <ImportArea compact onImported={onImported}/>
          <label className="ed-lut-field"><span>Logo</span><KanaaSelect aria-label="Choose a logo image" value="" onChange={(event) => { const item = logos.find((entry) => String(entry.id) === event.target.value); if (item) onBrand(item); }}>
            <option value="">{logos.length ? t('Choose a logo…') : t('No logos yet')}</option>{logos.map((item) => <option key={item.id} value={item.id}>{item.filename}</option>)}
          </KanaaSelect></label>
          <p className="ed-group-tip">{t('Import your logo above, or pick one from the Brand folder in Media.')}</p>
        </> : <>
          <div className="ed-add-row"><span>Now: <b>{logo?.filename ?? 'Logo'}</b></span><button className="ed-button small" onClick={onRemoveBrand}>Remove</button></div>
          {brand && brandSource && <>
            <Chips label="Corner" options={CORNERS} value={null} onPick={(corner) => onChange(moveBrand(timeline, brandSource, corner), 'brand-corner')}/>
            <Chips label="Size" options={BRAND_SIZES.map(({ id, label }) => ({ id, label }))} value={nearSize} onPick={(id) => onChange(resizeBrand(timeline, brandSource, BRAND_SIZES.find((entry) => entry.id === id)?.scale ?? 0.18), `brand-size-${id}`)}/>
            <ValueSlider label="Opacity" value={brand.transform.opacity} min={0.1} max={1} step={0.05} defaultValue={0.9} unit="%" factor={100} onGestureStart={onPause} onChange={(value, group) => onChange(fadeBrand(timeline, value), group ?? 'brand-opacity')}/>
          </>}
        </>}
      </Group>
      <BrandIntroGroup logos={logos} logo={logo} busy={introBusy} has={mainLayer(timeline).items.some((clip) => clip.id.startsWith('brand-intro'))} onMake={onBrandIntro}/>
      <Group pro title="LUT colour grade" tab="look" startOpen changed={Boolean(timeline.lut)} keywords="lut cube color colour grade pack cinematic wedding" tip="A professional colour lookup over the whole film. Captions stay unchanged." help="cinematic-finish">
        <label className="ed-lut-field"><span>LUT</span><KanaaSelect searchable searchPlaceholder={`Search ${luts.length || ''} LUTs…`} aria-label="Project LUT" value={timeline.lut ?? ''} onChange={(event) => onChange({ ...timeline, lut: event.target.value || null, lut_amount: timeline.lut_amount ?? 1 })}>
          <option value="">None</option>{luts.map((lut) => <option key={lut.id} value={lut.id}>{lut.name}</option>)}
        </KanaaSelect></label>
        {timeline.lut && <ValueSlider label="Intensity" value={timeline.lut_amount ?? 1} min={0} max={1} step={0.05} defaultValue={1} unit="%" factor={100} onGestureStart={onPause} onChange={(value, group) => onChange({ ...timeline, lut_amount: value }, group ?? 'project-lut')}/>}
        <p className="ed-group-tip">{luts.length ? `${luts.length} LUTs from ${lutFolder}. The source files stay read-only.` : `No .cube LUTs found in ${lutFolder || 'your LUT folder'}.`}</p>
      </Group>
      <Group title="Loudness" tab="sound" startOpen changed={Boolean(timeline.normalize_audio)} keywords="loudness normalize volume level even out audio" tip="Makes the whole video as loud as social apps expect." help="music-volume-ducking">
        {(() => {
          const ends = audioLayers(timeline).flatMap((layer) => layer.items.filter((sound) => !sound.muted).map((sound) => sound.start + soundLength(sound)));
          if (!ends.length) return null;
          const silentTail = Math.max(0, duration(timeline) - Math.max(...ends));
          return silentTail > 1
            ? <p className="ed-tip" role="status">Music stops at {timecode(Math.max(...ends))}; the last {silentTail >= 10 ? `${Math.round(silentTail)}s` : `${silentTail.toFixed(1)}s`} have no music. Select the song and use Loop to the end in its panel.</p>
            : <p className="ed-tip">Music covers the whole video.</p>;
        })()}
        <label className="ed-check"><input type="checkbox" checked={Boolean(timeline.normalize_audio)} onChange={(event) => onChange({ ...timeline, normalize_audio: event.target.checked })}/><span>Even out loudness<small>Applied when you export.</small></span></label>
      </Group>
    </Panel>
    {void onGuide}
  </>;
}

function FormatDialog({ clipFormat, current, onChoose }: { clipFormat: Format | null; current: Format; onChoose: (format: Format) => void }) {
  return <div className="ed-modal" role="dialog" aria-modal="true" aria-label="Choose a format"><div className="ed-card">
    <h2>Where will you post this?</h2><p>You can change this at any time.</p>
    <div className="ed-formats">{FORMATS.map((format) => <button key={format.id} onClick={() => onChoose({ ...current, width: format.width, height: format.height })}>
      <i style={{ aspectRatio: `${format.width} / ${format.height}` }}/><strong>{format.label}</strong><span>{format.ratio}</span></button>)}
      {clipFormat && <button onClick={() => onChoose({ ...clipFormat, width: Math.min(clipFormat.width, 3840), height: Math.min(clipFormat.height, 3840) })}><i style={{ aspectRatio: `${clipFormat.width} / ${clipFormat.height}` }}/><strong>Same as my clip</strong><span>{clipFormat.width} × {clipFormat.height}</span></button>}
    </div></div></div>;
}


function WhoStays({ clip, onChange, local, sourceDuration }: { clip: Clip; onChange: (changes: Partial<Clip>) => void; local: number; sourceDuration?: number | null }) {
  const kind = clip.cutout_pick?.kind === 'objects' ? 'objects' : 'people';  // Never land: that cover has nothing to number.
  const ids = clip.cutout_pick?.ids ?? null;
  const { found, key, steady, backwards, tracks } = useFoundInClip(clip, kind);
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








function SoundControls({ item, length, onChange }: { item: { volume: number; fade_in: number; fade_out: number }; length: number; onChange: (changes: { volume?: number; fade_in?: number; fade_out?: number }, group?: string) => void }) {
  const longest = Math.min(MAX_FADE_SECONDS, length);
  return <>
    <ValueSlider label="Volume" value={item.volume} min={0} max={2} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(volume, group) => onChange({ volume }, group)}/>
    <ValueSlider label="Fade in" value={Math.min(item.fade_in, longest)} min={0} max={longest} step={0.1} defaultValue={0} unit="s" decimals={1} onChange={(fade_in, group) => onChange({ fade_in }, group)}/>
    <ValueSlider label="Fade out" value={Math.min(item.fade_out, longest)} min={0} max={longest} step={0.1} defaultValue={0} unit="s" decimals={1} onChange={(fade_out, group) => onChange({ fade_out }, group)}/>
  </>;
}

function SoundInspector({ onLoop, looping, sound, timing, layer, onChange, onLayer, stems, job, busy, onSeparate, onCancelStems }: { onLoop: (() => void) | null; looping: boolean; sound: Sound; timing: TimeFieldProps[]; layer: AudioLayer; onChange: (changes: Partial<Sound>, group?: string) => void; onLayer: (changes: Partial<AudioLayer>) => void;
  stems: { available: boolean; install_command: string } | null; job: StemJob | null; busy: boolean; onSeparate: (choice: StemChoice) => void; onCancelStems: () => void }) {
  return <Panel id="sound" tabs={[{ id: 'volume', label: 'Volume', Icon: Volume2, changed: sound.muted || sound.volume !== 1 }, { id: 'voice', label: 'Voice', Icon: Mic, changed: Boolean(sound.clean_voice) }]}>
    <p className="ed-name" title={sound.name}>{sound.name}</p>
    <Group title="Timing" summary={timingSummary(timing)} keywords="when start length duration trim loop repeat" help="timing-and-trimming">
    <Timing fields={timing}/>
    {onLoop && <><button className="ed-button wide" disabled={looping} onClick={onLoop} title="Repeats the song by whole bars, on the beat, until the video ends, then fades out">{looping ? <LoaderCircle className="spin" size={14}/> : <Music size={14}/>}{looping ? 'Finding the beat…' : 'Loop to the end of the video'}</button>
      <p className="ed-tip">The song ends early. Looping repeats it on the beat and fades at the end.</p></>}
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
    <Group pro title="Voice" tab="voice" startOpen keywords="clean voice noise karaoke vocals instrumental singing remove" tip="Clean up a voice, or take the singing out of a song." help="voice-and-vocals">
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

function Inspector({ onReframe, reframing, onMove, backgrounds, onBackground, logos, clipBrandMarks, onClipBrand, onRemoveClipBrand, clip, source, format, onChange, canDetach, onDetach, local, onSeekLocal, onPause, follow, isMain, copyReady, onLayout, picking, onPick, timing, overlay, onLayer, closesWithTransition, onShowEnter, onShowExit }: { onReframe: (() => void) | null; reframing: boolean; onMove: (move: MovePreset) => void; backgrounds: Photo[]; onBackground: (item: Photo) => void; logos: Photo[]; clipBrandMarks: { id: string; name: string }[]; onClipBrand: (item: Photo) => void; onRemoveClipBrand: (id: string) => void; clip: Clip; source?: PlaybackSource; format: Format; onChange: (changes: Partial<Clip>, group?: string) => void; canDetach: boolean; onDetach: () => void; local: number; onSeekLocal: (t: number) => void; onPause: () => void; follow: React.ReactNode; isMain: boolean; copyReady: boolean; onLayout: (layout: 'side' | 'stack') => void; picking: boolean; onPick: () => void; timing: TimeFieldProps[]; overlay: VideoLayer | null; onLayer: (changes: Partial<VideoLayer>) => void; closesWithTransition: boolean; onShowEnter: () => void; onShowExit: () => void }) {
  const transition: Transition | null = clip.transition_in ?? null;
  const adjust = (changes: Partial<Adjust>, group?: string) => onChange({ adjust: { ...clip.adjust, ...changes } }, group);
  const fill = source ? fillScale(source, clip.adjust.rotation, format) : 1;
  const size = valueAt(clip.transform, 'scale', local);
  const filling = Math.abs(size - fill) < 0.01;
  const place = (scale: number) => writeValue(writeValue(writeValue(clip.transform, 'x', local, 0.5), 'y', local, 0.5), 'scale', local, scale);
  const isEffect = overlay?.name === EFFECT_LAYER;
  const effectFadeMax = Math.min(2, clipLength(clip) / 2);
  return <>
    <ActiveEffects clip={clip} onChange={onChange}/>
    <Panel id="clip" tabs={[{ id: 'frame', label: 'Frame', Icon: Crop }, { id: 'look', label: 'Colour', Icon: SlidersHorizontal, changed: (clip.look ?? 'none') !== 'none' }, { id: 'effects', label: 'Effects', Icon: WandSparkles, changed: clipEffects(clip).length > 0 }, { id: 'background', label: 'Backdrop', Icon: Wallpaper, changed: Boolean(clip.cutout || clip.chroma) },
      { id: 'motion', label: 'Motion', Icon: Move, changed: Boolean(clip.enter || clip.exit || clip.transition_in || Object.keys(clip.transform.keyframes ?? {}).length) }, ...(source?.kind === 'video' && clip.freeze == null ? [{ id: 'sound', label: 'Sound', Icon: Volume2, changed: clip.speed !== 1 || clip.muted || Boolean(clip.ramp) }] : [])]}>
    <Group title="Timing" summary={timingSummary(timing)} keywords="trim cut shorten length start end from to" help="timing-and-trimming"><Timing fields={timing}/></Group>
    <Group title="Clip visibility" tab="frame" startOpen changed={clip.enabled === false} keywords="active inactive disable hide camera angle multicam" tip="Deactivate an angle without deleting or moving it.">
      <label className="ed-check"><input type="checkbox" checked={clip.enabled !== false} onChange={(event) => onChange({ enabled: event.target.checked })}/><span>Active clip<small>{clip.enabled === false ? 'Kept on the timeline, but absent from preview, sound and export.' : 'This clip contributes picture and sound.'}</small></span></label>
    </Group>
    {isEffect && <Group pro title="Effect controls" tab="frame" startOpen changed={clip.transform.opacity !== 1 || clip.speed !== 1 || Boolean(clip.enter || clip.exit) || overlay?.blend !== 'screen'} keywords="effect intensity opacity strength speed fade blend" tip="Fine-tune this effect without changing your original video." help="special-effects">
      <Chips label="Intensity" options={EFFECT_INTENSITIES} value={clip.transform.opacity <= 0.5 ? 'subtle' : clip.transform.opacity <= 0.85 ? 'medium' : 'strong'} onPick={(strength) => onChange({ transform: { ...clip.transform, opacity: EFFECT_INTENSITY_VALUE[strength] } })}/>
      <More><ValueSlider label="Fine intensity" value={clip.transform.opacity} min={0} max={1} step={0.01} defaultValue={1} unit="%" factor={100} onGestureStart={onPause} onChange={(opacity, group) => onChange({ transform: { ...clip.transform, opacity } }, group)}/></More>
      <ValueSlider label="Speed" value={clip.speed} min={0.25} max={4} step={0.05} defaultValue={1} unit="×" decimals={2} onGestureStart={onPause} onChange={(speed, group) => onChange({ speed }, group)}/>
      <ValueSlider label="Fade in" value={clip.enter?.preset === 'fade' ? clip.enter.duration : 0} min={0} max={effectFadeMax} step={0.1} defaultValue={0} unit="s" decimals={1} onChange={(duration, group) => onChange({ enter: duration ? { preset: 'fade', duration } : null }, group)}/>
      <ValueSlider label="Fade out" value={clip.exit?.preset === 'fade' ? clip.exit.duration : 0} min={0} max={effectFadeMax} step={0.1} defaultValue={0} unit="s" decimals={1} onChange={(duration, group) => onChange({ exit: duration ? { preset: 'fade', duration } : null }, group)}/>
      <Chips label="Blend" options={BLENDS} value={overlay?.blend ?? 'screen'} onPick={(blend) => onLayer({ blend })}/>
      <p className="ed-group-tip">Timing sets its span. Slower speed stretches the pattern.</p>
    </Group>}
    <Group title="Frame" tab="frame" startOpen keywords="fit fill crop zoom rotate turn sideways mirror flip resize size bigger smaller corner picture in picture pip" tip="Fit shows everything; Fill covers the screen. Drag the picture to move it, or a corner to resize it." help="framing-and-rotating">
    <div className="ed-pair">
      <button className={`ed-button ${!filling && size === 1 ? 'on' : ''}`} disabled={clip.frame_locked} onClick={() => onChange({ transform: place(1) })}><Minimize size={14}/>Fit</button>
      <button className={`ed-button ${filling ? 'on' : ''}`} disabled={clip.frame_locked} onClick={() => onChange({ transform: place(fill) })}><Maximize size={14}/>Fill</button>
    </div>
    <button className={`ed-button wide ${clip.frame_locked ? 'on' : ''}`} aria-pressed={Boolean(clip.frame_locked)} onClick={() => onChange({ frame_locked: !clip.frame_locked })} title={clip.frame_locked ? 'Allow this picture to be moved and resized again' : 'Prevent accidental movement and resizing'}>{clip.frame_locked ? <Lock size={14}/> : <Unlock size={14}/>} {clip.frame_locked ? 'Frame locked' : 'Lock frame'}</button>
    {onReframe && <button className="ed-button wide" disabled={reframing || clip.frame_locked} onClick={onReframe} title="Fills the frame and pans with the main person, for a reel from a landscape video"><ScanFace size={14}/>{reframing ? 'Finding who to follow…' : 'Follow the person'}</button>}
    <div className="ed-pair">
      <button className="ed-icon" disabled={clip.frame_locked} aria-label="Rotate left" onClick={() => adjust({ rotation: ((clip.adjust.rotation + 270) % 360) as Adjust['rotation'] })}><RotateCcw size={16}/></button>
      <button className="ed-icon" disabled={clip.frame_locked} aria-label="Rotate right" onClick={() => adjust({ rotation: ((clip.adjust.rotation + 90) % 360) as Adjust['rotation'] })}><RotateCw size={16}/></button>
      <button className={`ed-icon ${clip.adjust.flip_horizontal ? 'on' : ''}`} disabled={clip.frame_locked} aria-label="Flip horizontally" onClick={() => adjust({ flip_horizontal: !clip.adjust.flip_horizontal })}><FlipHorizontal size={16}/></button>
      <button className={`ed-icon ${clip.adjust.flip_vertical ? 'on' : ''}`} disabled={clip.frame_locked} aria-label="Flip vertically" onClick={() => adjust({ flip_vertical: !clip.adjust.flip_vertical })}><FlipVertical size={16}/></button>
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
    <Group title="Colour" tab="look" startOpen changed={(clip.look ?? 'none') !== 'none' || clip.adjust.brightness !== 1 || clip.adjust.contrast !== 1 || clip.adjust.saturation !== 1 || clip.adjust.gamma !== 1 || clip.adjust.temperature !== 1 || clip.adjust.tint !== 1 || clip.adjust.fade !== 0} keywords="filter colour color brighter dark black and white warm vintage look fade gamma temperature tint" tip="Pick a look, then fine-tune brightness and, under More options, gamma, white balance and a film fade." help="colour-and-looks">
    <Chips label="Look" options={LOOK_NAMES} value={clip.look ?? 'none'} onPick={(look) => onChange({ look })}/>
    <ValueSlider label="Brightness" value={clip.adjust.brightness} min={0.25} max={2} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(brightness, group) => adjust({ brightness }, group)}/>
    <More>
    <ValueSlider label="Contrast" value={clip.adjust.contrast} min={0.25} max={2} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(contrast, group) => adjust({ contrast }, group)}/>
    <ValueSlider label="Colour strength" value={clip.adjust.saturation} min={0} max={2} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(saturation, group) => adjust({ saturation }, group)}/>
    <ValueSlider label="Gamma" value={clip.adjust.gamma} min={0.5} max={2} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(gamma, group) => adjust({ gamma }, group)}/>
    <ValueSlider label="Temperature" value={clip.adjust.temperature} min={0.7} max={1.4} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(temperature, group) => adjust({ temperature }, group)}/>
    <ValueSlider label="Tint" value={clip.adjust.tint} min={0.75} max={1.33} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(tint, group) => adjust({ tint }, group)}/>
    <ValueSlider label="Film fade" value={clip.adjust.fade} min={0} max={0.6} step={0.01} defaultValue={0} unit="%" factor={100} onChange={(fade, group) => adjust({ fade }, group)}/>
    <p className="ed-group-tip">Above 100% warms, below cools. Tint leans green or magenta. Fade lifts blacks into a soft matte.</p>
    </More>
    </Group>
    <Group title="Colour splash" tab="effects" startOpen={Boolean(clip.colour_splash)} changed={Boolean(clip.colour_splash)} keywords="colour splash color selective red saree black white monochrome wedding" tip="Keep one colour while the rest of the picture becomes black and white.">
    {clip.colour_splash ? <>
      <label className="ed-color"><span>Colour to keep</span><input type="color" aria-label="Colour to keep" value={clip.colour_splash.color} onChange={(event) => onChange({ colour_splash: { ...clip.colour_splash!, color: event.target.value } }, `splash-color-${clip.id}`)}/></label>
      <ValueSlider label="Black and white strength" value={clip.colour_splash.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_COLOUR_SPLASH.intensity} unit="%" factor={100} onChange={(intensity, group) => onChange({ colour_splash: { ...clip.colour_splash!, intensity } }, group)}/>
      <More>
        <ValueSlider label="Colour range" value={clip.colour_splash.tolerance} min={0.01} max={0.5} step={0.01} defaultValue={DEFAULT_COLOUR_SPLASH.tolerance} unit="%" factor={100} onChange={(tolerance, group) => onChange({ colour_splash: { ...clip.colour_splash!, tolerance } }, group)}/>
        <ValueSlider label="Edge softness" value={clip.colour_splash.softness} min={0.001} max={0.3} step={0.005} defaultValue={DEFAULT_COLOUR_SPLASH.softness} unit="%" factor={100} decimals={1} onChange={(softness, group) => onChange({ colour_splash: { ...clip.colour_splash!, softness } }, group)}/>
      </More>
      <button className="ed-button wide" onClick={() => onChange({ colour_splash: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ colour_splash: { ...DEFAULT_COLOUR_SPLASH } })}>Add colour splash</button>}
    </Group>
    <Group title="Dreamy glow" tab="effects" startOpen={Boolean(clip.dreamy_glow)} changed={Boolean(clip.dreamy_glow)} keywords="dreamy glow soft focus bloom portrait skin wedding romantic" tip="Add a gentle warm bloom to highlights while keeping faces readable.">
    {clip.dreamy_glow ? <>
      <ValueSlider label="Glow" value={clip.dreamy_glow.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_DREAMY_GLOW.intensity} unit="%" factor={100} onChange={(intensity, group) => onChange({ dreamy_glow: { ...clip.dreamy_glow!, intensity } }, group)}/>
      <ValueSlider label="Softness" value={clip.dreamy_glow.softness} min={0} max={1} step={0.01} defaultValue={DEFAULT_DREAMY_GLOW.softness} unit="%" factor={100} onChange={(softness, group) => onChange({ dreamy_glow: { ...clip.dreamy_glow!, softness } }, group)}/>
      <More><ValueSlider label="Warmth" value={clip.dreamy_glow.warmth} min={0} max={1} step={0.01} defaultValue={DEFAULT_DREAMY_GLOW.warmth} unit="%" factor={100} onChange={(warmth, group) => onChange({ dreamy_glow: { ...clip.dreamy_glow!, warmth } }, group)}/></More>
      <button className="ed-button wide" onClick={() => onChange({ dreamy_glow: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ dreamy_glow: { ...DEFAULT_DREAMY_GLOW } })}>Add dreamy glow</button>}
    </Group>
    <Group pro title="Duotone and split-tone" tab="effects" startOpen={Boolean(clip.tone_grade)} changed={Boolean(clip.tone_grade)} keywords="duotone split tone grade teal orange gold sepia colour two colours" tip="Split-tone tints shadows and highlights; duotone paints the whole picture in two colours.">
    {clip.tone_grade ? <>
      <Chips label="Style" options={[{ id: 'split' as const, label: 'Split-tone' }, { id: 'duotone' as const, label: 'Duotone' }]} value={clip.tone_grade.mode} onPick={(mode) => onChange({ tone_grade: { ...clip.tone_grade!, mode } })}/>
      <Chips label="Colours" options={TONE_PRESETS.map((preset) => ({ id: preset.id as string, label: preset.label }))} value={TONE_PRESETS.find((preset) => preset.shadow === clip.tone_grade!.shadow && preset.highlight === clip.tone_grade!.highlight)?.id ?? null} onPick={(id) => { const preset = TONE_PRESETS.find((each) => each.id === id)!; onChange({ tone_grade: { ...clip.tone_grade!, shadow: preset.shadow, highlight: preset.highlight } }); }}/>
      <ValueSlider label="Strength" value={clip.tone_grade.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_TONE_GRADE.intensity} unit="%" factor={100} onChange={(intensity, group) => onChange({ tone_grade: { ...clip.tone_grade!, intensity } }, group)}/>
      <More>
        <label className="ed-field">Shadows <input type="color" value={clip.tone_grade.shadow} onChange={(event) => onChange({ tone_grade: { ...clip.tone_grade!, shadow: event.target.value } }, 'tone-shadow')}/></label>
        <label className="ed-field">Highlights <input type="color" value={clip.tone_grade.highlight} onChange={(event) => onChange({ tone_grade: { ...clip.tone_grade!, highlight: event.target.value } }, 'tone-highlight')}/></label>
        <ValueSlider label="Balance" value={clip.tone_grade.balance} min={0} max={1} step={0.01} defaultValue={DEFAULT_TONE_GRADE.balance} unit="%" factor={100} onChange={(balance, group) => onChange({ tone_grade: { ...clip.tone_grade!, balance } }, group)}/>
      </More>
      <button className="ed-button wide" onClick={() => onChange({ tone_grade: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ tone_grade: { ...DEFAULT_TONE_GRADE } })}>Add a two-colour grade</button>}
    </Group>
    <Group pro title="Tilt-shift" tab="effects" startOpen={Boolean(clip.tilt_shift)} changed={Boolean(clip.tilt_shift)} keywords="tilt shift miniature toy model blur band city" tip="Works best on scenes filmed from high up: city streets, markets, trains.">
    {clip.tilt_shift ? <>
      <ValueSlider label="Sharp at" value={clip.tilt_shift.focus_y} min={0} max={1} step={0.01} defaultValue={DEFAULT_TILT_SHIFT.focus_y} unit="%" factor={100} onChange={(focus_y, group) => onChange({ tilt_shift: { ...clip.tilt_shift!, focus_y } }, group)}/>
      <ValueSlider label="Sharp band" value={clip.tilt_shift.band} min={0.02} max={0.8} step={0.01} defaultValue={DEFAULT_TILT_SHIFT.band} unit="%" factor={100} onChange={(band, group) => onChange({ tilt_shift: { ...clip.tilt_shift!, band } }, group)}/>
      <ValueSlider label="Blur" value={clip.tilt_shift.blur} min={0} max={1} step={0.01} defaultValue={DEFAULT_TILT_SHIFT.blur} unit="%" factor={100} onChange={(blur, group) => onChange({ tilt_shift: { ...clip.tilt_shift!, blur } }, group)}/>
      <More><ValueSlider label="Colour boost" value={clip.tilt_shift.saturation} min={0} max={1} step={0.01} defaultValue={DEFAULT_TILT_SHIFT.saturation} unit="%" factor={100} onChange={(saturation, group) => onChange({ tilt_shift: { ...clip.tilt_shift!, saturation } }, group)}/></More>
      <button className="ed-button wide" onClick={() => onChange({ tilt_shift: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ tilt_shift: { ...DEFAULT_TILT_SHIFT } })}>Add tilt-shift</button>}
    </Group>
    <Group pro title="Mirror and kaleidoscope" tab="effects" startOpen={Boolean(clip.mirror)} changed={Boolean(clip.mirror)} keywords="mirror reflect symmetry kaleidoscope pattern wedges" tip="Mirror reflects one half onto the other; kaleidoscope turns the picture into mirrored wedges.">
    {clip.mirror ? <>
      <Chips label="Kind" options={[{ id: 'left' as const, label: 'Left' }, { id: 'top' as const, label: 'Top' }, { id: 'quad' as const, label: 'Four ways' }, { id: 'kaleido' as const, label: 'Kaleidoscope' }]} value={clip.mirror.mode} onPick={(mode) => onChange({ mirror: { ...clip.mirror!, mode } })}/>
      {clip.mirror.mode === 'kaleido' && <>
        <ValueSlider label="Wedges" value={clip.mirror.segments} min={3} max={12} step={1} defaultValue={DEFAULT_MIRROR.segments} onChange={(segments, group) => onChange({ mirror: { ...clip.mirror!, segments: Math.round(segments) } }, group)}/>
        <ValueSlider label="Turn" value={clip.mirror.angle} min={-180} max={180} step={1} defaultValue={0} unit="°" onChange={(angle, group) => onChange({ mirror: { ...clip.mirror!, angle } }, group)}/>
      </>}
      <button className="ed-button wide" onClick={() => onChange({ mirror: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ mirror: { ...DEFAULT_MIRROR } })}>Add mirror</button>}
    </Group>
    <Group pro title="Zoom blur" tab="effects" startOpen={Boolean(clip.zoom_blur)} changed={Boolean(clip.zoom_blur)} keywords="zoom blur radial rush speed punch" tip="Streaks towards a centre. Short clips and quick cuts suit it best.">
    {clip.zoom_blur ? <>
      <ValueSlider label="Strength" value={clip.zoom_blur.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_ZOOM_BLUR.intensity} unit="%" factor={100} onChange={(intensity, group) => onChange({ zoom_blur: { ...clip.zoom_blur!, intensity } }, group)}/>
      <More>
        <ValueSlider label="Centre across" value={clip.zoom_blur.center_x} min={0} max={1} step={0.01} defaultValue={0.5} unit="%" factor={100} onChange={(center_x, group) => onChange({ zoom_blur: { ...clip.zoom_blur!, center_x } }, group)}/>
        <ValueSlider label="Centre down" value={clip.zoom_blur.center_y} min={0} max={1} step={0.01} defaultValue={0.5} unit="%" factor={100} onChange={(center_y, group) => onChange({ zoom_blur: { ...clip.zoom_blur!, center_y } }, group)}/>
      </More>
      <button className="ed-button wide" onClick={() => onChange({ zoom_blur: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ zoom_blur: { ...DEFAULT_ZOOM_BLUR } })}>Add zoom blur</button>}
    </Group>
    <Group pro title="Echo trail" tab="effects" startOpen={Boolean(clip.echo)} changed={Boolean(clip.echo)} keywords="echo ghost trail smear dance motion blur light trails" tip="Ghosts of the last moments follow movement. The preview shows it once its copy is made in the background.">
    {clip.echo ? <>
      <Chips label="Kind" options={[{ id: 'echo' as const, label: 'Echo' }, { id: 'smear' as const, label: 'Light smear' }]} value={clip.echo.mode} onPick={(mode) => onChange({ echo: { ...clip.echo!, mode } })}/>
      {clip.echo.mode === 'echo' && <ValueSlider label="Trails" value={clip.echo.trails} min={2} max={8} step={1} defaultValue={DEFAULT_ECHO.trails} onChange={(trails, group) => onChange({ echo: { ...clip.echo!, trails: Math.round(trails) } }, group)}/>}
      <ValueSlider label="Linger" value={clip.echo.decay} min={0.2} max={0.95} step={0.05} defaultValue={DEFAULT_ECHO.decay} unit="%" factor={100} onChange={(decay, group) => onChange({ echo: { ...clip.echo!, decay: Math.round(decay * 100) / 100 } }, group)}/>
      {!copyReady && <p className="ed-tip" role="status">Preparing the echo trail… the preview shows it when ready; the export always has it.</p>}
      {Boolean(clip.cutout) && <p className="ed-tip">With a background effect on, the preview leaves out the echo; the export has both.</p>}
      <button className="ed-button wide" onClick={() => onChange({ echo: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ echo: { ...DEFAULT_ECHO } })}>Add echo trail</button>}
    </Group>
    <Group pro title="Beat pulse" tab="effects" startOpen={Boolean(clip.beat_pulse)} changed={Boolean(clip.beat_pulse)} keywords="beat pulse music rhythm zoom reels bpm" tip="Push the picture gently on each beat. Match Tempo to the song for clean synchronization.">
    {clip.beat_pulse ? <>
      <ValueSlider label="Strength" value={clip.beat_pulse.strength} min={0} max={1} step={0.01} defaultValue={DEFAULT_BEAT_PULSE.strength} unit="%" factor={100} onChange={(strength, group) => onChange({ beat_pulse: { ...clip.beat_pulse!, strength } }, group)}/>
      <ValueSlider label="Tempo" value={clip.beat_pulse.bpm} min={30} max={300} step={1} defaultValue={DEFAULT_BEAT_PULSE.bpm} unit=" BPM" onChange={(bpm, group) => onChange({ beat_pulse: { ...clip.beat_pulse!, bpm } }, group)}/>
      <More>
        <ValueSlider label="Pulse size" value={clip.beat_pulse.size} min={0.005} max={0.15} step={0.005} defaultValue={DEFAULT_BEAT_PULSE.size} unit="%" factor={100} decimals={1} onChange={(size, group) => onChange({ beat_pulse: { ...clip.beat_pulse!, size } }, group)}/>
        <ValueSlider label="First beat" value={clip.beat_pulse.offset} min={0} max={Math.min(60, clipLength(clip))} step={0.01} defaultValue={0} unit="s" decimals={2} onChange={(offset, group) => onChange({ beat_pulse: { ...clip.beat_pulse!, offset } }, group)}/>
      </More>
      <button className="ed-button wide" onClick={() => onChange({ beat_pulse: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ beat_pulse: { ...DEFAULT_BEAT_PULSE } })}>Add beat pulse</button>}
    </Group>
    <Group title="Old film" tab="effects" startOpen={Boolean(clip.old_film)} changed={Boolean(clip.old_film)} keywords="old film vintage grain scratches dust gate weave projector" tip="Distress the picture like aged film stock. Preview and export use the same clip settings.">
    {clip.old_film ? <>
      <ValueSlider label="Intensity" value={clip.old_film.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_OLD_FILM.intensity} unit="%" factor={100} onChange={(intensity, group) => onChange({ old_film: { ...clip.old_film!, intensity } }, group)}/>
      <ValueSlider label="Grain" value={clip.old_film.grain} min={0} max={1} step={0.01} defaultValue={DEFAULT_OLD_FILM.grain} unit="%" factor={100} onChange={(grain, group) => onChange({ old_film: { ...clip.old_film!, grain } }, group)}/>
      <More>
        <ValueSlider label="Scratches" value={clip.old_film.scratches} min={0} max={1} step={0.01} defaultValue={DEFAULT_OLD_FILM.scratches} unit="%" factor={100} onChange={(scratches, group) => onChange({ old_film: { ...clip.old_film!, scratches } }, group)}/>
        <ValueSlider label="Dust" value={clip.old_film.dust} min={0} max={1} step={0.01} defaultValue={DEFAULT_OLD_FILM.dust} unit="%" factor={100} onChange={(dust, group) => onChange({ old_film: { ...clip.old_film!, dust } }, group)}/>
        <ValueSlider label="Gate weave" value={clip.old_film.weave} min={0} max={1} step={0.01} defaultValue={DEFAULT_OLD_FILM.weave} unit="%" factor={100} onChange={(weave, group) => onChange({ old_film: { ...clip.old_film!, weave } }, group)}/>
      </More>
      <button className="ed-button wide" onClick={() => onChange({ old_film: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ old_film: DEFAULT_OLD_FILM })}>Add old film</button>}
    </Group>
    <Group title="Signal damage" tab="effects" startOpen={Boolean(clip.signal_damage)} changed={Boolean(clip.signal_damage)} keywords="glitch rgb split vhs tape scanlines jitter noise retro" tip="Break up the clip like a digital signal or worn VHS tape.">
    {clip.signal_damage ? <>
      <Chips label="Style" options={[{ id: 'glitch' as const, label: 'Glitch' }, { id: 'vhs' as const, label: 'VHS' }]} value={clip.signal_damage.mode} onPick={(mode) => onChange({ signal_damage: { ...clip.signal_damage!, mode } })}/>
      <ValueSlider label="Intensity" value={clip.signal_damage.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_SIGNAL_DAMAGE.intensity} unit="%" factor={100} onChange={(intensity, group) => onChange({ signal_damage: { ...clip.signal_damage!, intensity } }, group)}/>
      <ValueSlider label="RGB separation" value={clip.signal_damage.rgb_split} min={0} max={1} step={0.01} defaultValue={DEFAULT_SIGNAL_DAMAGE.rgb_split} unit="%" factor={100} onChange={(rgb_split, group) => onChange({ signal_damage: { ...clip.signal_damage!, rgb_split } }, group)}/>
      <More>
        <ValueSlider label="Horizontal jitter" value={clip.signal_damage.jitter} min={0} max={1} step={0.01} defaultValue={DEFAULT_SIGNAL_DAMAGE.jitter} unit="%" factor={100} onChange={(jitter, group) => onChange({ signal_damage: { ...clip.signal_damage!, jitter } }, group)}/>
        <ValueSlider label="Scanlines" value={clip.signal_damage.scanlines} min={0} max={1} step={0.01} defaultValue={DEFAULT_SIGNAL_DAMAGE.scanlines} unit="%" factor={100} onChange={(scanlines, group) => onChange({ signal_damage: { ...clip.signal_damage!, scanlines } }, group)}/>
        <ValueSlider label="Noise" value={clip.signal_damage.noise} min={0} max={1} step={0.01} defaultValue={DEFAULT_SIGNAL_DAMAGE.noise} unit="%" factor={100} onChange={(noise, group) => onChange({ signal_damage: { ...clip.signal_damage!, noise } }, group)}/>
      </More>
      <button className="ed-button wide" onClick={() => onChange({ signal_damage: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ signal_damage: DEFAULT_SIGNAL_DAMAGE })}>Add signal damage</button>}
    </Group>
    <Group title="Lens surface" tab="effects" startOpen={Boolean(clip.lens_surface)} changed={Boolean(clip.lens_surface)} keywords="lens dirt raindrops water glass refraction droplets" tip="Put dirt or refracting water drops on the camera lens.">
    {clip.lens_surface ? <>
      <Chips label="Surface" options={[{ id: 'raindrops' as const, label: 'Raindrops' }, { id: 'dirt' as const, label: 'Lens dirt' }]} value={clip.lens_surface.mode} onPick={(mode) => onChange({ lens_surface: { ...clip.lens_surface!, mode } })}/>
      <ValueSlider label="Intensity" value={clip.lens_surface.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_LENS_SURFACE.intensity} unit="%" factor={100} onChange={(intensity, group) => onChange({ lens_surface: { ...clip.lens_surface!, intensity } }, group)}/>
      <ValueSlider label="Amount" value={clip.lens_surface.amount} min={0} max={1} step={0.01} defaultValue={DEFAULT_LENS_SURFACE.amount} unit="%" factor={100} onChange={(amount, group) => onChange({ lens_surface: { ...clip.lens_surface!, amount } }, group)}/>
      <More>
        <ValueSlider label="Refraction" value={clip.lens_surface.refraction} min={0} max={1} step={0.01} defaultValue={DEFAULT_LENS_SURFACE.refraction} unit="%" factor={100} onChange={(refraction, group) => onChange({ lens_surface: { ...clip.lens_surface!, refraction } }, group)}/>
        <ValueSlider label="Softness" value={clip.lens_surface.softness} min={0} max={1} step={0.01} defaultValue={DEFAULT_LENS_SURFACE.softness} unit="%" factor={100} onChange={(softness, group) => onChange({ lens_surface: { ...clip.lens_surface!, softness } }, group)}/>
      </More>
      <button className="ed-button wide" onClick={() => onChange({ lens_surface: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ lens_surface: DEFAULT_LENS_SURFACE })}>Add lens surface</button>}
    </Group>
    {source?.kind === 'video' && <Group pro title="Background" tab="background" startOpen changed={Boolean(clip.cutout)} keywords="blur background portrait remove replace focus bokeh cut out person who stays" tip="Blur or remove what's behind people, and choose who stays sharp." help="background-blur-remove">
      <Chips label="Background" options={[{ id: 'keep' as const, label: 'Keep' }, { id: 'blur' as const, label: 'Blur' }, { id: 'remove' as const, label: 'Remove' }]} value={clip.cutout ?? 'keep'} onPick={(id) => onChange(id === 'keep' ? { cutout: null, cutout_pick: null, focus_pull: null } : id === 'remove' ? { cutout: id, focus_pull: null } : { cutout: id })}/>
      {clip.cutout === 'blur' && <div className="ed-strength"><span className="ed-who-title">Blur strength</span><Chips label="Blur strength" options={BLUR_AMOUNTS} value={clip.blur_amount ?? 'medium'} onPick={(blur_amount) => onChange({ blur_amount })}/></div>}
      {clip.cutout && (clip.cutout_pick?.kind === 'land' ? <p className="ed-tip">Everything but the sky stays, found in every frame.</p> : <WhoStays clip={clip} onChange={onChange} local={local} sourceDuration={source?.duration}/>)}
      {clip.cutout === 'remove' && <div className="ed-strength"><span className="ed-who-title">New background</span>
        {backgrounds.length ? <div className="ed-media-grid ed-backgrounds">{backgrounds.map((item) => <button key={item.id} className="ed-tile-add" onClick={() => onBackground(item)} title={`Put ${item.filename} behind, filling the frame`}><img src={photoThumbUrl(item.id)} alt="" loading="lazy"/><span className="ed-tile-label"><b>{item.filename}</b></span></button>)}</div>
          : <p className="ed-tip">Import a picture or video in Media, then choose it here.</p>}
        <p className="ed-tip">It fills the whole frame, behind {isMain ? 'this clip' : 'the cut-out'}. A shorter video plays slower to cover it.</p></div>}
      {clip.cutout && <p className="ed-tip">{!copyReady ? `${clip.cutout === 'blur' ? `Making the ${clip.focus_pull ? 'focus pull' : `${clip.blur_amount ?? 'medium'} blur`}` : `Finding ${clip.cutout_pick?.kind === 'objects' ? 'the objects' : clip.cutout_pick?.ids ? 'the chosen people' : 'the person'}`}… This runs in the background${clip.cutout === 'blur' ? '; the preview keeps the previous blur until the new one is ready' : ', and the preview shows the original until it is ready'}.`
        : clip.cutout === 'blur' ? 'Who you choose stays sharp and everything else is softened, like a film camera focused on them.' : isMain ? 'The person shows over black until you choose a new background below.' : 'The person shows over whatever is under this layer.'}</p>}
    </Group>}
    <Group pro title="Brand watermark" tab="background" changed={clipBrandMarks.length > 0} keywords="logo watermark brand mark corner badge overlay" tip="A logo shown only while this clip plays. On the timeline it is an ordinary overlay: drag it, trim it or delete it." help="brand-watermark">
      {clipBrandMarks.length > 0 && <div className="ed-add-row"><span>{clipBrandMarks.length === 1 ? `1 logo over this clip` : `${clipBrandMarks.length} logos over this clip`}</span></div>}
      {clipBrandMarks.map((mark) => <div className="ed-add-row" key={mark.id}><span>{mark.name}</span><button className="ed-button small" onClick={() => onRemoveClipBrand(mark.id)}>Remove</button></div>)}
      {logos.length ? <div className="ed-media-grid ed-backgrounds">{logos.map((item) => <button key={item.id} className="ed-tile-add" onClick={() => onClipBrand(item)} title={`Put ${item.filename} over this clip`}><img src={photoThumbUrl(item.id)} alt="" loading="lazy"/><span className="ed-tile-label"><b>{item.filename}</b></span></button>)}</div>
        : <p className="ed-tip">Import the logo in Media, then pick it here. A transparent PNG looks best.</p>}
      {logos.length > 0 && <p className="ed-tip">Top right, for this clip's length. A whole-video mark lives in Project settings.</p>}
    </Group>
    <Group pro title="Green screen" tab="background" startOpen={Boolean(clip.chroma) || source?.kind !== 'video'} changed={Boolean(clip.chroma)} keywords="green screen chroma key transparent blue" tip="Click the green or blue in the preview to make it see-through." help="green-screen">
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
    <Group title="Animation" tab="motion" startOpen changed={Boolean(clip.enter || clip.exit)} keywords="animation entrance exit enter fade slide" tip="How the clip appears and leaves." help="animations-and-moves">
    {transition && <p className="ed-tip">This clip opens with a {transition.kind} transition — set in the Transitions tab.</p>}
    {transition ? <p className="ed-tip">The transition replaces this clip's enter animation.</p> : <AnimationPicker label="Enter" value={clip.enter} onChange={(enter, group) => onChange({ enter }, group)} onShow={onShowEnter}/>}
    {closesWithTransition ? <p className="ed-tip">The next clip's transition replaces this clip's exit animation.</p> : <AnimationPicker label="Exit" value={clip.exit} onChange={(exit, group) => onChange({ exit }, group)} onShow={onShowExit}/>}
    </Group>
    <Group title="Moves" tab="motion" startOpen changed={Object.keys(clip.transform.keyframes ?? {}).length > 0} keywords="zoom in push pull shake move keyframe position size tilt see-through animate" tip="A gentle zoom in one click; More lets you animate anything." help="animations-and-moves">
    <div className="ed-chips" role="group" aria-label="Quick moves">{MOVES.map((move) => <button key={move.id} title={move.tip} onClick={() => onMove(move.id)}>{move.label}</button>)}</div>
    <More label="Animate position, size and more">
    <MotionPanel transform={clip.transform} local={local} length={(clip.out - clip.in) / clip.speed} onChange={(transform, group) => onChange({ transform }, group)} onSeek={onSeekLocal} onGestureStart={onPause}/>
    </More>
    </Group>
    {follow && <Group title="Follow movement" tab="motion" startOpen keywords="track follow stick moving person" tip="Draw a box around something and this follows it as it moves." help="follow-movement">{follow}</Group>}
    {source?.kind === 'video' && clip.freeze == null && <Group title="Speed and sound" tab="sound" startOpen changed={clip.speed !== 1 || clip.muted || clip.volume !== 1 || clip.fade_in > 0 || clip.fade_out > 0 || Boolean(clip.reverse)} keywords="volume mute louder quiet slow motion fast reverse backwards noise clean voice speed" tip="Loudness and speed; Clean voice removes fan and AC hum." help="speed-and-sound">
      <button className={`ed-button wide ${clip.muted ? 'on' : ''}`} onClick={() => onChange({ muted: !clip.muted })}>{clip.muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}{clip.muted ? 'Muted' : 'Mute this clip'}</button>
      <SoundControls item={clip} length={(clip.out - clip.in) / clip.speed} onChange={onChange}/>
      <ValueSlider label={clip.ramp ? 'Overall speed' : 'Speed'} value={clip.speed} min={0.25} max={4} step={0.05} defaultValue={1} unit="×" decimals={2} onChange={(speed, group) => onChange({ speed }, group)}/>
      <More>
      <h3 className="ed-sub">Speed effect</h3>
      <Chips label="Speed ramp" options={RAMP_CHOICES} value={rampName(clip.ramp)} onPick={(id) => onChange({ ramp: id === 'off' ? null : RAMPS[id] })}/>
      {clip.ramp && <><RampCurve ramp={clip.ramp} at={local / ((clip.out - clip.in) / clip.speed)}/><p className="ed-tip">A ramp has no sound. Slow parts smoothen best from 60 or 120 fps footage.</p></>}
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

function FollowPanel({ blur, own, drawing, job, busy, note, following, size, onSize, onStart, onDraw, onContinue, onCancel, onStop }: { blur: boolean; own: boolean; drawing: boolean; job: FollowJob | null; busy: boolean; note: string | null; following: boolean; size: boolean;
  onSize: (on: boolean) => void; onStart: () => void; onDraw: () => void; onContinue: () => void; onCancel: () => void; onStop: () => void }) {
  if (job) return <><div className="ed-progress"><i style={{ width: `${job.progress}%` }}/></div><p className="ed-tip">{job.queued ? 'Waiting for the job ahead of it to finish…' : `Following… ${job.progress}%`}</p><button className="ed-button wide" onClick={onCancel}>Cancel</button></>;
  const what = blur ? 'the blur' : 'it';
  return <>
    <p className="ed-tip">{drawing ? 'Drag a box around it in the preview. Esc cancels.' : own ? `Put ${what} over what should be followed, a face or a number plate, then click Follow. Kanaa keeps ${what} on it as it moves.` : 'Place the title where it should sit, then click Follow and drag a box around the person or thing it should move with.'}</p>
    <button className={`ed-button wide primary ${drawing ? 'on' : ''}`} disabled={busy} onClick={onStart}><Crosshair size={14}/>{own ? (following ? 'Follow again from here' : 'Follow') : following ? 'Track a different subject' : 'Track person or object'}</button>
    {following && <div className="ed-pair"><button className="ed-button" disabled={busy} onClick={onContinue}>Continue from here</button><button className="ed-button" disabled={busy} onClick={onStop}>Stop following</button></div>}
    {note && <p className="ed-tip ed-follow-note" role="status">{note}</p>}
    <More>
      <label className="ed-check"><input type="checkbox" checked={size} onChange={(event) => onSize(event.target.checked)}/><span>Follow its size too<small>Grows and shrinks as the subject comes closer or moves away.</small></span></label>
      {own && <button className="ed-button wide" disabled={busy} onClick={onDraw}>Draw around something else</button>}
    </More>
  </>;
}

function CaptionInspector({ caption, layer, timing, onText, onLook, onRemoveAll }: { caption: Caption; layer: CaptionLayer; timing: TimeFieldProps[]; onText: (text: string) => void; onLook: (changes: Partial<CaptionLook>, group?: string) => void; onRemoveAll: () => void }) {
  const [draft, setDraft] = useState(captionText(caption));
  useEffect(() => setDraft(captionText(caption)), [caption.id]);
  return <Panel id="caption" tabs={[{ id: 'words', label: 'Words', Icon: Captions }, { id: 'style', label: 'Style', Icon: ALargeSmall }]}>
    <Group title="Timing" summary={timingSummary(timing)} keywords="when start length duration" help="timing-and-trimming">
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
    <Group title="Timing" summary={timingSummary(timing)} keywords="when start length duration" help="timing-and-trimming"><Timing fields={timing}/></Group>
    <Group title="Hide" tab="hide" startOpen keywords="hide face number plate pixelate censor blur strength oval box" tip="Hide a face or number plate. Drag the box in the preview to move it." help="hide-faces-plates">
      <Chips label="Style" options={[{ id: 'blur' as const, label: 'Blur' }, { id: 'pixelate' as const, label: 'Pixelate' }]} value={blur.style} onPick={(style) => onChange({ style })}/>
      <Chips label="Shape" options={[{ id: 'oval' as const, label: 'Oval' }, { id: 'box' as const, label: 'Box' }]} value={blur.shape} onPick={(shape) => onChange({ shape })}/>
      <ValueSlider label="Strength" value={blur.amount} min={0.05} max={1} step={0.01} defaultValue={DEFAULT_BLUR.amount} unit="%" factor={100} onChange={(amount, group) => onChange({ amount }, group)}/>
      <More>
      <ValueSlider label="Width" value={blur.width} min={0.02} max={1} step={0.005} defaultValue={DEFAULT_BLUR.width} unit="%" factor={100} decimals={1} onChange={(width, group) => onChange({ width }, group)}/>
      <ValueSlider label="Height" value={blur.height} min={0.02} max={1} step={0.005} defaultValue={DEFAULT_BLUR.height} unit="%" factor={100} decimals={1} onChange={(height, group) => onChange({ height }, group)}/>
      </More>
    </Group>
    <Group title="Follow movement" tab="hide" startOpen keywords="track follow stick moving person face plate" tip="Put the blur on a face, click Follow, and it stays on the face." help="follow-movement">{follow}</Group>
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
  const [hardware, setHardware] = useState(true);
  const megabytes = Math.round(seconds * (hardware ? hardwareMbps(quality) / 8 : ESTIMATED_MB_PER_SECOND_1080) * (quality / 1080) ** 2);
  const outputFormat = exportFormat(timeline.format, quality);
  const start = async () => {
    setError('');
    try {
      const { job_id } = await exportProjectTimeline(projectId, { ...coverBrand(timeline), format: outputFormat }, hardware);
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
      <label className="ed-check"><input type="checkbox" checked={hardware} onChange={(event) => setHardware(event.target.checked)}/><span>Fast export<small>Uses this Mac's hardware encoder — several times faster, same resolution. Off gives the smallest file.</small></span></label>
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
