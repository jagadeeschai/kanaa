import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ArrowLeft, AudioLines, Check, CircleHelp, Layers, Monitor, Moon, PanelLeft, PanelRight, Sun, Type, Download, FlipHorizontal, FlipVertical, LoaderCircle, Maximize, Minimize, Minus, Music, Pause, Play, Plus, Redo2, RotateCcw, RotateCw, Scissors, ShieldCheck, Trash2, Undo2, Volume2, VolumeX, X } from 'lucide-react';
import { cancelRenderJob, clipFilmstripUrl, clipProxyUrl, exportProjectTimeline, fetchTextImage, getClipAssets, previewRenderUrl, startPreviewRender, getClipPeaks, getJobStatus, getProjectTimeline, getSongPeaks, getStemsStatus, getVideoProject, listPhotos, photoImageUrl, photoThumbUrl, photoVideoUrl, saveVideoProject, songUrl, startStems, uploadVideoAudio, type Stems } from '../api/client';
import ImportArea from '../components/ImportArea';
import type { Photo } from '../types/photo';
import type { Animation, LookName, Preset, Transition, TransitionKind } from '../timeline/animation';
import { commit, redo, startHistory, undo, type History } from '../timeline/history';
import { cornerPlacement, isLocked, layerOf, addOverlay, addSound, addText, audioLayers, clipLength, detachAudio, duration, exportFormat, fillScale, findClip, findSound, findText, FORMATS, insertClip, mainLayer, MUSIC_VOLUME, newClip, OVERLAY_SCALE, normalizeTimeline, removeClip, removeSound, removeText, soundLength, splitClip, splitSound, timecode, trimClip, textLayers, updateClip, updateLayer, updateSound, updateText, type Adjust, type AudioLayer, type BlendMode, type Corner, type VideoLayer, type Clip, type Format, type Sound, type SourceFacts, type TextItem, type Timeline } from '../timeline/model';
import { PlaybackEngine, type PlaybackSource } from './playback';
import { DEFAULT_LAYOUT, Group, LIMITS, Splitter, useEditorLayout, useEditorTheme } from './layout';
import { MotionPanel, MotionPath } from './Keyframes';
import TimelineView, { type ClipVisuals } from './TimelineView';
import { valueAt } from '../timeline/evaluate';
import { writeValue } from '../timeline/keyframes';

type Props = { projectId: number; projectName: string; photo: Photo; onClose: () => void; onOpenOutput: (id: number) => void };
type Action = { type: 'load'; timeline: Timeline } | { type: 'change'; timeline: Timeline; group?: string | null } | { type: 'undo' } | { type: 'redo' };
const EMPTY = startHistory<Timeline | null>(null);
const SAVE_DELAY_MS = 650;
const ASSET_POLL_MS = 2000;
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
const PRESETS: { id: Preset; label: string }[] = [{ id: 'fade', label: 'Fade' }, { id: 'slide-up', label: 'Slide up' }, { id: 'slide-down', label: 'Slide down' }, { id: 'slide-left', label: 'Slide left' }, { id: 'slide-right', label: 'Slide right' }, { id: 'zoom', label: 'Zoom' }, { id: 'pop', label: 'Pop' }, { id: 'blur', label: 'Blur' }, { id: 'bounce', label: 'Bounce' }];
const TRANSITIONS: { id: TransitionKind; label: string }[] = [{ id: 'crossfade', label: 'Crossfade' }, { id: 'wipe', label: 'Wipe' }, { id: 'slide', label: 'Slide' }, { id: 'zoom', label: 'Zoom' }];
const LOOK_NAMES: { id: LookName; label: string }[] = [{ id: 'none', label: 'Original' }, { id: 'warm', label: 'Warm' }, { id: 'cool', label: 'Cool' }, { id: 'vivid', label: 'Vivid' }, { id: 'film', label: 'Film' }, { id: 'mono', label: 'Mono' }];
const TITLES: { label: string; text: Omit<TextItem, 'id' | 'start' | 'length'> }[] = [
  { label: 'Big title', text: { text: 'Your title', style: 'outline', position: 'center', color: '#ffffff', size: 72, enter: { preset: 'pop', duration: 0.5 }, exit: { preset: 'fade', duration: 0.4 } } },
  { label: 'Lower third', text: { text: 'Name or place', style: 'band', position: 'bottom', color: '#ffffff', size: 40, enter: { preset: 'slide-left', duration: 0.5 }, exit: { preset: 'fade', duration: 0.3 } } },
  { label: 'Caption', text: { text: 'Your caption', style: 'shadow', position: 'bottom', color: '#ffffff', size: 36, enter: { preset: 'fade', duration: 0.3 }, exit: { preset: 'fade', duration: 0.3 } } },
  { label: 'Top note', text: { text: 'Your note', style: 'band', position: 'top', color: '#ffffff', size: 36, enter: { preset: 'slide-down', duration: 0.4 }, exit: { preset: 'fade', duration: 0.3 } } },
];
type StemChoice = 'music' | 'vocals' | 'both';
type StemJob = { soundId: string; jobId: string; choice: StemChoice; progress: number };

function reducer(state: History<Timeline | null>, action: Action): History<Timeline | null> {
  if (action.type === 'load') return startHistory(action.timeline);
  if (action.type === 'change') return commit(state, action.timeline, action.group ?? null);
  const next = action.type === 'undo' ? undo(state) : redo(state);
  return next.present === null ? state : next;
}
let idCounter = 0;
const newId = () => `clip-${Date.now().toString(36)}-${(idCounter += 1)}`;
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable || target.getAttribute('role') === 'separator');
/** A button keeps focus only when reached by keyboard (see releaseClickedButton), so then it takes Space itself. */
const buttonTakesSpace = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('button') !== null;
/** Without this, Space after clicking a media tile would add the clip again instead of playing. */
const releaseClickedButton = (event: React.MouseEvent) => { if (event.detail > 0 && document.activeElement instanceof HTMLButtonElement) document.activeElement.blur(); };
const RESTART_MESSAGE = 'Motion was updated and needs a restart. Stop it in its terminal with Ctrl+C, then run ./start.sh again.';

export default function Editor({ projectId, projectName, photo, onClose, onOpenOutput }: Props) {
  const [history, dispatch] = useReducer(reducer, EMPTY);
  const timeline = history.present;
  const [choosingFormat, setChoosingFormat] = useState(false);
  const [media, setMedia] = useState<Photo[]>([photo]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(40);
  const [playing, setPlaying] = useState(false);
  const [saved, setSaved] = useState<'saved' | 'saving' | 'failed'>('saved');
  const [ready, setReady] = useState<Record<number, boolean>>({});
  const [error, setError] = useState('');
  const [safeArea, setSafeArea] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [addingMusic, setAddingMusic] = useState(false);
  const [stemJob, setStemJob] = useState<StemJob | null>(null);
  const [now, setNow] = useState(0);
  const { choice: themeChoice, next: nextTheme, theme } = useEditorTheme();
  const { layout, update: updateLayout, reset: resetLayout } = useEditorLayout();
  const [leftTab, setLeftTab] = useState<'media' | 'text' | 'audio'>('media');
  const [showingHelp, setShowingHelp] = useState(false);
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
  const lastSaved = useRef('');
  const visuals = useRef(new Map<number, ClipVisuals>());

  const mediaById = useMemo(() => new Map(media.map((item) => [item.id, item])), [media]);
  const facts = useCallback((id: number): SourceFacts | undefined => {
    const item = mediaById.get(id);
    return item && { media_id: id, media_type: item.media_type === 'video' ? 'video' : 'image', duration: item.duration, width: item.width, height: item.height };
  }, [mediaById]);
  const sourceFor = useCallback((id: number): PlaybackSource | undefined => {
    const item = mediaById.get(id);
    if (!item) return undefined;
    const size = { width: item.width || 1920, height: item.height || 1080 };
    if (item.media_type !== 'video') return { url: photoImageUrl(id), kind: 'image', ...size };
    return { url: ready[id] ? clipProxyUrl(id) : photoVideoUrl(id), kind: 'video', ...size };
  }, [mediaById, ready]);

  const textImages = useRef(new Map<string, string | 'loading'>());
  const [textVersion, redrawText] = useReducer((count: number) => count + 1, 0);
  const textKey = (text: TextItem, format: Format) => JSON.stringify([text.text, text.style, text.position, text.color, text.size, format.width, format.height]);
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
  const soundUrl = useCallback((sound: Sound) => {
    if (sound.asset_id) return songUrl(sound.asset_id);
    const item = sound.media_id === undefined ? undefined : mediaById.get(sound.media_id);
    return item ? (ready[item.id] ? clipProxyUrl(item.id) : photoVideoUrl(item.id)) : undefined;
  }, [mediaById, ready]);
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
        lastSaved.current = started ? JSON.stringify(loaded) : '';
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
    if (!flat) { engineRef.current?.setTimeline(timeline, sourceFor, soundUrl, textUrl); return; }
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
    const serialized = JSON.stringify(timeline);
    if (serialized === lastSaved.current) { setSaved('saved'); return; }
    setSaved('saving');
    const timer = setTimeout(() => {
      lastSaved.current = serialized;
      saveVideoProject(projectId, 'edit', timeline).then(() => setSaved('saved')).catch(() => { lastSaved.current = ''; setSaved('failed'); });
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [timeline, projectId, choosingFormat]);

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
  const updateSelectedText = (changes: Partial<TextItem>, group?: string) => { if (timeline && selectedText) change(updateText(timeline, selectedText.id, changes), group); };
  const addTitle = (title: typeof TITLES[number]) => {
    if (!timeline) return;
    const text: TextItem = { ...title.text, id: newId(), start: Math.round((engineRef.current?.currentTime ?? 0) * 1000) / 1000, length: TEXT_SECONDS };
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
  const updateSelectedSound = (changes: Partial<Sound>, group?: string) => { if (timeline && selectedSound) change(updateSound(timeline, selectedSound.sound.id, changes), group); };
  const hasSound = (id: number) => Boolean(visuals.current.get(id)?.peaks?.peaks.some(Boolean));
  const detach = () => {
    if (!timeline || !selected) return;
    const soundId = newId();
    change(detachAudio(timeline, selected.id, soundId, newId(), `${mediaById.get(selected.media_id)?.filename ?? 'Clip'} sound`.slice(0, 120), mediaById.get(selected.media_id)?.duration ?? undefined));
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
  const updateSelected = (changes: Partial<Clip>, group?: string) => { if (timeline && selected) change(updateClip(timeline, selected.id, changes), group); };
  const seek = useCallback((t: number) => engineRef.current?.seek(t), []);
  const togglePlay = useCallback(() => { const engine = engineRef.current; if (!engine) return; if (engine.playing) engine.pause(); else engine.play(); }, []);
  const split = useCallback(() => {
    if (!timeline) return;
    if (selectedId && isLocked(timeline, selectedId)) return;
    const next = findSound(timeline, selectedId) ? splitSound(timeline, selectedId!, playhead.current, newId()) : splitClip(timeline, playhead.current, newId());
    if (next !== timeline) change(next);
  }, [timeline, selectedId, playhead, change]);
  const removeSelected = useCallback(() => {
    if (!timeline || !selectedId || isLocked(timeline, selectedId)) return;
    change(findSound(timeline, selectedId) ? removeSound(timeline, selectedId) : findText(timeline, selectedId) ? removeText(timeline, selectedId) : removeClip(timeline, selectedId));
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
      if (isTyping(event.target) || !timeline || exporting || choosingFormat || showingHelp) return;
      if (event.key === ' ' && buttonTakesSpace(event.target)) return;
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
        case 'i': { const item = clip(); if (item && !mainLayer(timeline).locked) change(trimClip(timeline, item.id, 'in', item.in + (playhead.current - item.start) * item.speed, facts(item.media_id))); break; }
        case 'o': { const item = clip(); if (item && !mainLayer(timeline).locked) change(trimClip(timeline, item.id, 'out', item.in + (playhead.current - item.start) * item.speed, facts(item.media_id))); break; }
        case 'Delete': case 'Backspace': event.preventDefault(); removeSelected(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [timeline, exporting, choosingFormat, showingHelp, togglePlay, split, removeSelected, seek, change, playhead, facts]);

  const dragPreview = useRef<{ x: number; y: number; clipX: number; clipY: number; group: string } | null>(null);
  const previewDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!selected || selectedLayer?.locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragPreview.current = { x: event.clientX, y: event.clientY, clipX: valueAt(selected.transform, 'x', local), clipY: valueAt(selected.transform, 'y', local), group: `move-${Date.now()}` };
  };
  const previewMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragPreview.current;
    if (!drag || !selected) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const moved = writeValue(selected.transform, 'x', local, drag.clipX + (event.clientX - drag.x) / rect.width);
    updateSelected({ transform: writeValue(moved, 'y', local, drag.clipY + (event.clientY - drag.y) / rect.height) }, drag.group);
  };

  const total = timeline ? duration(timeline) : 0;
  const fitZoom = useCallback(() => {
    const width = rootRef.current?.querySelector('.tl-scroll')?.clientWidth;
    if (width && total) setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (width - FIT_MARGIN) / total)));
  }, [total]);
  useEffect(() => { if (total && !fitted.current) { fitted.current = true; fitZoom(); } }, [total, fitZoom]);
  const usedIds = useMemo(() => new Set(timeline ? timeline.layers.flatMap((layer) => (layer.kind === 'video' ? layer.items.map((clip) => clip.media_id) : [])) : []), [timeline]);
  const mediaOpen = layout.mediaOpen; const inspectorOpen = layout.inspectorOpen;
  const shellStyle = { '--media-col': mediaOpen ? `${layout.media}px` : '0px', '--media-gap': mediaOpen ? '6px' : '0px', '--inspector-col': inspectorOpen ? `${layout.inspector}px` : '0px', '--inspector-gap': inspectorOpen ? '6px' : '0px', '--timeline-h': `${Math.min(layout.timeline, Math.round(window.innerHeight * 0.55))}px` } as React.CSSProperties;
  const ratio = timeline ? timeline.format.width / timeline.format.height : 16 / 9;
  const isEmpty = timeline && !mainLayer(timeline).items.length;
  return <div className="ed" ref={rootRef} data-ed-theme={theme} style={shellStyle} onClick={releaseClickedButton} role="application" aria-label="Video editor">
    <header className="ed-top">
      <button className="ed-icon" onClick={onClose} aria-label="Back to projects"><ArrowLeft size={18}/></button>
      <div className="ed-title"><strong>{projectName}</strong><span>{saved === 'saving' ? 'Saving…' : saved === 'failed' ? 'Could not save' : 'Saved'}</span></div>
      <div className="ed-spacer"/>
      <button className={`ed-icon ed-hide-small ${mediaOpen ? '' : 'on'}`} aria-pressed={!mediaOpen} aria-label="Hide media panel" title={mediaOpen ? 'Hide the media panel' : 'Show the media panel'} onClick={() => updateLayout({ mediaOpen: !mediaOpen })}><PanelLeft size={17}/></button>
      <button className={`ed-icon ed-hide-small ${inspectorOpen ? '' : 'on'}`} aria-pressed={!inspectorOpen} aria-label="Hide settings panel" title={inspectorOpen ? 'Hide the settings panel' : 'Show the settings panel'} onClick={() => updateLayout({ inspectorOpen: !inspectorOpen })}><PanelRight size={17}/></button>
      <button className="ed-icon" aria-label={`Theme: ${themeChoice}. Change theme`} title={`Theme: ${themeChoice === 'system' ? 'same as this Mac' : themeChoice}`} onClick={nextTheme}>{themeChoice === 'system' ? <Monitor size={17}/> : themeChoice === 'light' ? <Sun size={17}/> : <Moon size={17}/>}</button>
      <button className="ed-icon ed-hide-small" aria-label="Shortcuts and layout" title="Shortcuts and layout (?)" onClick={() => setShowingHelp(true)}><CircleHelp size={17}/></button>
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
        <div className="ed-tabs" role="tablist" aria-label="Add to your video">{(['media', 'text', 'audio'] as const).map((tab) => <button key={tab} role="tab" aria-selected={leftTab === tab} onClick={() => setLeftTab(tab)}>{tab === 'media' ? 'Media' : tab === 'text' ? 'Text' : 'Audio'}</button>)}</div>
        {leftTab === 'media' && <>
          <ImportArea compact onImported={(items) => { setMedia((current) => [...items, ...current]); }}/>
          <div className="ed-media-grid">{media.filter((item) => !item.filename.startsWith('Blank canvas')).map((item) => <div className="ed-tile" key={item.id}>
            <button className="ed-tile-add" onClick={() => addMedia(item)} title={`Add ${item.filename}`}><img src={photoThumbUrl(item.id)} alt=""  loading="lazy"/><span className="ed-tile-label"><b>{item.filename}</b>{item.duration ? <em>{timecode(item.duration).replace(/\.\d+$/, '')}</em> : null}</span></button>
            {usedIds.has(item.id) && <span className="ed-tile-used" title="In your video"><Check size={11}/></span>}
            <button className="ed-tile-over" onClick={() => addOverlayMedia(item)} title="Add on top of your video, like a logo" aria-label={`Add ${item.filename} as an overlay`}><Layers size={12}/></button></div>)}</div>
        </>}
        {leftTab === 'text' && <><p className="ed-tip">Adds a title at the playhead.</p><div className="ed-titles" role="group" aria-label="Add a title">{TITLES.map((title) => <button key={title.label} className="ed-button" onClick={() => addTitle(title)}><Type size={13}/>{title.label}</button>)}</div></>}
        {leftTab === 'audio' && <><p className="ed-tip">Adds a song at the playhead. It dips under speech automatically.</p><label className={`ed-button wide ed-music ${addingMusic ? 'busy' : ''}`}>{addingMusic ? <LoaderCircle className="spin" size={15}/> : <Music size={15}/>}{addingMusic ? 'Adding music…' : 'Add music'}
          <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg" disabled={addingMusic} aria-label="Add music" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void addMusic(file); }}/></label></>}
      </aside>
      {mediaOpen ? <Splitter label="Resize media panel" axis="x" value={layout.media} min={LIMITS.media[0]} max={LIMITS.media[1]} sign={1} onChange={(media) => updateLayout({ media })} onReset={() => updateLayout({ media: DEFAULT_LAYOUT.media })}/> : <span/>}
      <main className="ed-stage">
        <div className="ed-frame" style={{ aspectRatio: `${ratio}`, '--ar': ratio } as React.CSSProperties}>
          <canvas ref={canvasRef} aria-label="Preview" onPointerDown={previewDown} onPointerMove={previewMove} onPointerUp={() => { dragPreview.current = null; }} className={selected ? 'movable' : ''}/>
          {selected && !selectedLayer?.locked && <MotionPath transform={selected.transform} length={clipLength(selected)} onChange={(transform, group) => updateSelected({ transform }, group)} onSeek={(t) => seek(selected.start + t)}/>}
          {safeArea && <div className="ed-safe" aria-hidden="true"><span>Keep titles and faces inside this box</span></div>}
          {isEmpty && !choosingFormat && <div className="ed-empty"><strong>Add a clip to start</strong><span>Pick a video in the Media panel</span></div>}
        </div>
        <div className="ed-transport">
          <span className="ed-clock"><span ref={clockRef}>0:00.00</span> / {timecode(total)}</span>
          <button className="ed-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button>
          <button className={`ed-icon ed-safe-toggle ${safeArea ? 'on' : ''}`} aria-pressed={safeArea} onClick={() => setSafeArea((value) => !value)} title="Show where platform buttons may cover your video"><ShieldCheck size={15}/>Safe area</button>
        </div>
      </main>
      {inspectorOpen ? <Splitter label="Resize settings panel" axis="x" value={layout.inspector} min={LIMITS.inspector[0]} max={LIMITS.inspector[1]} sign={-1} onChange={(inspector) => updateLayout({ inspector })} onReset={() => updateLayout({ inspector: DEFAULT_LAYOUT.inspector })}/> : <span/>}
      <aside className={`ed-inspector ${inspectorOpen ? '' : 'ed-panel-closed'}`} aria-label="Clip settings">{selectedLayer?.locked ? <div className="ed-hint"><h2>Layer locked</h2><p>Unlock this layer on the timeline to change it.</p></div>
        : selectedText ? <TextInspector text={selectedText} onChange={updateSelectedText} onEnter={() => showEnter(selectedText.start, selectedText.enter?.duration ?? 0.5)} onExit={() => showExit(selectedText.start + selectedText.length, selectedText.exit?.duration ?? 0.5)}/>
        : selectedSound ? <SoundInspector sound={selectedSound.sound} layer={selectedSound.layer} onChange={updateSelectedSound} onLayer={(changes) => change(updateLayer(timeline!, selectedSound.layer.id, changes))}
        stems={stems} job={stemJob?.soundId === selectedSound.sound.id ? stemJob : null} busy={Boolean(stemJob)} onSeparate={(choice) => { void separate(choice); }} onCancelStems={() => { if (stemJob) void cancelRenderJob(stemJob.jobId); }}/>
        : selected ? <Inspector clip={selected} source={sourceFor(selected.media_id)} format={timeline!.format} onChange={updateSelected} canDetach={!selected.muted && hasSound(selected.media_id)} onDetach={detach}
          local={local} onSeekLocal={(t) => seek(selected.start + t)} overlay={selectedLayer?.kind === 'video' && !selectedLayer.magnetic && selectedLayer !== mainLayer(timeline!) ? selectedLayer : null} onLayer={(changes) => change(updateLayer(timeline!, selectedLayer!.id, changes))} canTransition={clipIndex > 0} closesWithTransition={Boolean(clipsInOrder[clipIndex + 1]?.transition_in)}
          onShowEnter={() => showEnter(selected.start, selected.enter?.duration ?? 0.5)} onShowExit={() => showExit(selected.start + clipLength(selected), selected.exit?.duration ?? 0.5)}
          onShowTransition={() => showEnter(Math.max(0, selected.start - (selected.transition_in?.duration ?? 0.6)), 2 * (selected.transition_in?.duration ?? 0.6))}/> : <div className="ed-hint"><h2>Clip settings</h2><p>Select a clip on the timeline to reframe it, animate it, or change its look, speed and sound.</p><button className="ed-button wide" onClick={() => setShowingHelp(true)}><CircleHelp size={14}/>Shortcuts and layout</button></div>}</aside>
    </div>
    <Splitter label="Resize timeline" axis="y" value={Math.min(layout.timeline, Math.round(window.innerHeight * 0.55))} min={LIMITS.timeline[0]} max={Math.round(window.innerHeight * 0.55)} sign={-1} onChange={(height) => updateLayout({ timeline: height })} onReset={() => updateLayout({ timeline: DEFAULT_LAYOUT.timeline })}/>
    <div className="ed-lower"><div className="ed-tools">
      <button className="ed-button" onClick={split} disabled={!total} title="Split at playhead (S)"><Scissors size={15}/>Split</button>
      <button className="ed-button" onClick={removeSelected} disabled={(!selected && !selectedSound && !selectedText) || Boolean(selectedLayer?.locked)} title="Delete (⌫)"><Trash2 size={15}/>Delete</button>
      <div className="ed-spacer"/>
      <button className="ed-button ed-hide-small" onClick={() => { void renderPreview(); }} disabled={!total || Boolean(renderJob) || isRendered} title="Make a quick copy that always plays smoothly">{renderJob ? `Rendering… ${renderJob.progress}%` : 'Render preview'}</button>
      <button className="ed-button" disabled={!total} onClick={fitZoom} title="Show the whole video on the timeline">Fit</button>
      <button className="ed-icon" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value / ZOOM_STEP))}><Minus size={15}/></button>
      <button className="ed-icon" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value * ZOOM_STEP))}><Plus size={15}/></button>
    </div>
    {timeline && <TimelineView timeline={timeline} selectedId={selectedId} zoom={zoom} theme={theme} playhead={playhead} source={facts} visuals={(id) => visuals.current.get(id) ?? {}} soundPeaks={soundPeaks} onSelect={setSelectedId} onSeek={seek} onChange={change} onScrubStart={() => engineRef.current?.pause()}/>}
    </div></div>
    {showingHelp && <HelpDialog onClose={() => setShowingHelp(false)} onResetLayout={resetLayout}/>}
    {choosingFormat && timeline && <FormatDialog clipFormat={photo.width && photo.height ? { width: photo.width - photo.width % 2, height: photo.height - photo.height % 2, fps: 30 } : null} current={timeline.format} onChoose={chooseFormat}/>}
    {exporting && timeline && <ExportDialog timeline={timeline} projectId={projectId} onNormalize={(normalize_audio) => change({ ...timeline, normalize_audio })} onClose={() => setExporting(false)} onOpen={onOpenOutput}/>}
  </div>;
}

const SHORTCUTS: [string, string][] = [['Space', 'Play or pause'], ['S', 'Split at the playhead'], ['Delete', 'Delete the selected item'], ['I / O', 'Trim the clip start or end to the playhead'], ['← →', 'Move one frame (Shift for ten)'], ['J / K / L', 'Back a second, pause, play faster'], ['⌘Z / ⇧⌘Z', 'Undo and redo'], ['?', 'Show this guide']];

function HelpDialog({ onClose, onResetLayout }: { onClose: () => void; onResetLayout: () => void }) {
  return <div className="ed-modal" role="dialog" aria-modal="true" aria-label="Shortcuts and layout" onClick={onClose}><div className="ed-card small" onClick={(event) => event.stopPropagation()}>
    <button className="ed-close" aria-label="Close" onClick={onClose}><X size={17}/></button>
    <h2>Shortcuts and layout</h2>
    <div className="ed-keys">{SHORTCUTS.flatMap(([keys, action]) => [<kbd key={keys}>{keys}</kbd>, <span key={action}>{action}</span>])}</div>
    <p>Drag the gaps between panels to resize them. Double-click a gap to reset it.</p>
    <button className="ed-button wide" onClick={() => { onResetLayout(); onClose(); }}>Reset layout</button>
  </div></div>;
}

function FormatDialog({ clipFormat, current, onChoose }: { clipFormat: Format | null; current: Format; onChoose: (format: Format) => void }) {
  return <div className="ed-modal" role="dialog" aria-modal="true" aria-label="Choose a format"><div className="ed-card">
    <h2>Where will you post this?</h2><p>You can change this at any time.</p>
    <div className="ed-formats">{FORMATS.map((format) => <button key={format.id} onClick={() => onChoose({ ...current, width: format.width, height: format.height })}>
      <i style={{ aspectRatio: `${format.width} / ${format.height}` }}/><strong>{format.label}</strong><span>{format.ratio}</span></button>)}
      {clipFormat && <button onClick={() => onChoose({ ...clipFormat, width: Math.min(clipFormat.width, 3840), height: Math.min(clipFormat.height, 3840) })}><i style={{ aspectRatio: `${clipFormat.width} / ${clipFormat.height}` }}/><strong>Same as my clip</strong><span>{clipFormat.width} × {clipFormat.height}</span></button>}
    </div></div></div>;
}

function Slider({ label, value, min, max, step = 0.01, shown, onChange, onReset }: { label: string; value: number; min: number; max: number; step?: number; shown: string; onChange: (value: number) => void; onReset: () => void }) {
  return <label className="ed-slider" onDoubleClick={onReset} title="Double-click to reset"><span>{label}<em>{shown}</em></span> <input aria-label={label} type="range" style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties} min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))}/></label>;
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
    {value && <Slider label="Length" value={value.duration} min={0.1} max={3} step={0.1} shown={`${value.duration.toFixed(1)}s`} onChange={(duration) => onChange({ ...value, duration }, `length-${label}`)} onReset={() => onChange({ ...value, duration: 0.5 })}/>}
  </>;
}

function TextInspector({ text, onChange, onEnter, onExit }: { text: TextItem; onChange: (changes: Partial<TextItem>, group?: string) => void; onEnter: () => void; onExit: () => void }) {
  return <>
    <h2>Text</h2>
    <textarea className="ed-text" aria-label="Text" lang="ta" value={text.text} maxLength={500} rows={3} onChange={(event) => { if (event.target.value.trim()) onChange({ text: event.target.value }, `text-${text.id}`); }}/>
    <h3 className="ed-sub">Style</h3>
    <Chips label="Style" options={[{ id: 'band', label: 'Band' }, { id: 'shadow', label: 'Shadow' }, { id: 'outline', label: 'Outline' }]} value={text.style} onPick={(style) => onChange({ style })}/>
    <h3 className="ed-sub">Position</h3>
    <Chips label="Position" options={[{ id: 'top', label: 'Top' }, { id: 'center', label: 'Middle' }, { id: 'bottom', label: 'Bottom' }]} value={text.position} onPick={(position) => onChange({ position })}/>
    <Slider label="Size" value={text.size} min={20} max={100} step={1} shown={`${text.size}`} onChange={(size) => onChange({ size }, `size-${text.id}`)} onReset={() => onChange({ size: 44 })}/>
    <label className="ed-color"><span>Color</span><input type="color" aria-label="Text color" value={text.color} onChange={(event) => onChange({ color: event.target.value }, `color-${text.id}`)}/></label>
    <AnimationPicker label="Enter" value={text.enter} onChange={(enter, group) => onChange({ enter }, group)} onShow={onEnter}/>
    <AnimationPicker label="Exit" value={text.exit} onChange={(exit, group) => onChange({ exit }, group)} onShow={onExit}/>
  </>;
}

function SoundControls({ item, length, onChange, id }: { item: { volume: number; fade_in: number; fade_out: number }; length: number; id: string; onChange: (changes: { volume?: number; fade_in?: number; fade_out?: number }, group?: string) => void }) {
  const longest = Math.min(MAX_FADE_SECONDS, length);
  return <>
    <Slider label="Volume" value={item.volume} min={0} max={2} shown={`${Math.round(item.volume * 100)}%`} onChange={(volume) => onChange({ volume }, `volume-${id}`)} onReset={() => onChange({ volume: 1 })}/>
    <Slider label="Fade in" value={Math.min(item.fade_in, longest)} min={0} max={longest} step={0.1} shown={`${item.fade_in.toFixed(1)}s`} onChange={(fade_in) => onChange({ fade_in }, `fade-${id}`)} onReset={() => onChange({ fade_in: 0 })}/>
    <Slider label="Fade out" value={Math.min(item.fade_out, longest)} min={0} max={longest} step={0.1} shown={`${item.fade_out.toFixed(1)}s`} onChange={(fade_out) => onChange({ fade_out }, `fade-${id}`)} onReset={() => onChange({ fade_out: 0 })}/>
  </>;
}

function SoundInspector({ sound, layer, onChange, onLayer, stems, job, busy, onSeparate, onCancelStems }: { sound: Sound; layer: AudioLayer; onChange: (changes: Partial<Sound>, group?: string) => void; onLayer: (changes: Partial<AudioLayer>) => void;
  stems: { available: boolean; install_command: string } | null; job: StemJob | null; busy: boolean; onSeparate: (choice: StemChoice) => void; onCancelStems: () => void }) {
  return <>
    <h2>Sound</h2>
    <p className="ed-name" title={sound.name}>{sound.name}</p>
    <div className="ed-pair">
      <button className={`ed-button ${sound.muted ? 'on' : ''}`} aria-pressed={sound.muted} onClick={() => onChange({ muted: !sound.muted })}>{sound.muted ? <VolumeX size={14}/> : <Volume2 size={14}/>}Mute</button>
      <button className={`ed-button ${layer.muted ? 'on' : ''}`} aria-pressed={Boolean(layer.muted)} onClick={() => onLayer({ muted: !layer.muted })}>Mute track</button>
    </div>
    <SoundControls item={sound} id={sound.id} length={soundLength(sound)} onChange={onChange}/>
    <Slider label="Speed" value={sound.speed} min={0.25} max={4} step={0.05} shown={`${sound.speed.toFixed(2)}×`} onChange={(speed) => onChange({ speed }, `speed-${sound.id}`)} onReset={() => onChange({ speed: 1 })}/>
    <label className="ed-check"><input type="checkbox" checked={sound.duck} onChange={(event) => onChange({ duck: event.target.checked })}/><span>Dip under speech<small>Lowers this sound while your clips or other sounds play.</small></span></label>
    <h2>Voice and music</h2>
    {!stems?.available ? <p className="ed-tip">Voice separation is an optional add-on. To install it, run <code>{stems?.install_command ?? './install-stems.sh'}</code> in the Motion folder, then restart Motion.</p>
      : job ? <><div className="ed-progress"><i style={{ width: `${job.progress}%` }}/></div><p className="ed-tip">Separating… {job.progress}%. This can take a few minutes, and you can keep editing.</p><button className="ed-button wide" onClick={onCancelStems}>Cancel</button></>
        : <div className="ed-stack">
          <button className="ed-button wide" disabled={busy} onClick={() => onSeparate('music')}>Remove vocals</button>
          <button className="ed-button wide" disabled={busy} onClick={() => onSeparate('vocals')}>Keep only vocals</button>
          <button className="ed-button wide" disabled={busy} onClick={() => onSeparate('both')}>Split into two tracks</button>
        </div>}
  </>;
}

function Inspector({ clip, source, format, onChange, canDetach, onDetach, local, onSeekLocal, overlay, onLayer, canTransition, closesWithTransition, onShowEnter, onShowExit, onShowTransition }: { clip: Clip; source?: PlaybackSource; format: Format; onChange: (changes: Partial<Clip>, group?: string) => void; canDetach: boolean; onDetach: () => void; local: number; onSeekLocal: (t: number) => void; overlay: VideoLayer | null; onLayer: (changes: Partial<VideoLayer>) => void; canTransition: boolean; closesWithTransition: boolean; onShowEnter: () => void; onShowExit: () => void; onShowTransition: () => void }) {
  const transition: Transition | null = clip.transition_in ?? null;
  const adjust = (changes: Partial<Adjust>) => onChange({ adjust: { ...clip.adjust, ...changes } }, `adjust-${clip.id}`);
  const fill = source ? fillScale(source, clip.adjust.rotation, format) : 1;
  const size = valueAt(clip.transform, 'scale', local);
  const filling = Math.abs(size - fill) < 0.01;
  const place = (scale: number) => writeValue(writeValue(writeValue(clip.transform, 'x', local, 0.5), 'y', local, 0.5), 'scale', local, scale);
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return <>
    <Group title="Framing" startOpen>
    <div className="ed-pair">
      <button className={`ed-button ${!filling && size === 1 ? 'on' : ''}`} onClick={() => onChange({ transform: place(1) })}><Minimize size={14}/>Fit</button>
      <button className={`ed-button ${filling ? 'on' : ''}`} onClick={() => onChange({ transform: place(fill) })}><Maximize size={14}/>Fill</button>
    </div>
    <p className="ed-tip">Drag the picture in the preview to position it.</p>
    {overlay && source && <>
      <h3 className="ed-sub">Corner</h3>
      <Chips label="Corner" options={CORNERS} value={null} onPick={(corner) => { const spot = cornerPlacement(source, clip.adjust.rotation, format, size, corner); onChange({ transform: writeValue(writeValue(clip.transform, 'x', local, spot.x), 'y', local, spot.y) }); }}/>
      <h3 className="ed-sub">Blend</h3>
      <Chips label="Blend" options={BLENDS} value={overlay.blend ?? 'normal'} onPick={(blend) => onLayer({ blend })}/>
    </>}
    <div className="ed-pair">
      <button className="ed-icon" aria-label="Rotate left" onClick={() => adjust({ rotation: ((clip.adjust.rotation + 270) % 360) as Adjust['rotation'] })}><RotateCcw size={16}/></button>
      <button className="ed-icon" aria-label="Rotate right" onClick={() => adjust({ rotation: ((clip.adjust.rotation + 90) % 360) as Adjust['rotation'] })}><RotateCw size={16}/></button>
      <button className={`ed-icon ${clip.adjust.flip_horizontal ? 'on' : ''}`} aria-label="Flip horizontally" onClick={() => adjust({ flip_horizontal: !clip.adjust.flip_horizontal })}><FlipHorizontal size={16}/></button>
      <button className={`ed-icon ${clip.adjust.flip_vertical ? 'on' : ''}`} aria-label="Flip vertically" onClick={() => adjust({ flip_vertical: !clip.adjust.flip_vertical })}><FlipVertical size={16}/></button>
    </div>
    </Group>
    <Group title="Motion" startOpen={Object.keys(clip.transform.keyframes ?? {}).length > 0} changed={Object.keys(clip.transform.keyframes ?? {}).length > 0}>
    <MotionPanel transform={clip.transform} local={local} length={(clip.out - clip.in) / clip.speed} id={clip.id} onChange={(transform, group) => onChange({ transform }, group)} onSeek={onSeekLocal}/>
    </Group>
    <Group title="Colour" startOpen changed={(clip.look ?? 'none') !== 'none' || clip.adjust.brightness !== 1 || clip.adjust.contrast !== 1 || clip.adjust.saturation !== 1}>
    <Chips label="Look" options={LOOK_NAMES} value={clip.look ?? 'none'} onPick={(look) => onChange({ look })}/>
    <h3 className="ed-sub">Adjust</h3>
    <Slider label="Brightness" value={clip.adjust.brightness} min={0.25} max={2} shown={percent(clip.adjust.brightness)} onChange={(brightness) => adjust({ brightness })} onReset={() => adjust({ brightness: 1 })}/>
    <Slider label="Contrast" value={clip.adjust.contrast} min={0.25} max={2} shown={percent(clip.adjust.contrast)} onChange={(contrast) => adjust({ contrast })} onReset={() => adjust({ contrast: 1 })}/>
    <Slider label="Saturation" value={clip.adjust.saturation} min={0} max={2} shown={percent(clip.adjust.saturation)} onChange={(saturation) => adjust({ saturation })} onReset={() => adjust({ saturation: 1 })}/>
    </Group>
    <Group title="Animation" changed={Boolean(clip.enter || clip.exit || clip.transition_in)}>
    {canTransition && <>
      <h3 className="ed-sub">Transition from the last clip</h3>
      <Chips label="Transition" options={[{ id: 'none' as const, label: 'None' }, ...TRANSITIONS]} value={transition?.kind ?? 'none'} onPick={(kind) => { onChange({ transition_in: kind === 'none' ? null : { kind, duration: transition?.duration ?? 0.6 } }); if (kind !== 'none') setTimeout(onShowTransition, 60); }}/>
      {transition && <Slider label="Length" value={transition.duration} min={0.2} max={2} step={0.1} shown={`${transition.duration.toFixed(1)}s`} onChange={(duration) => onChange({ transition_in: { ...transition, duration } }, `transition-${clip.id}`)} onReset={() => onChange({ transition_in: { ...transition, duration: 0.6 } })}/>}
    </>}
    {transition ? <p className="ed-tip">The transition replaces this clip's enter animation.</p> : <AnimationPicker label="Enter" value={clip.enter} onChange={(enter, group) => onChange({ enter }, group)} onShow={onShowEnter}/>}
    {closesWithTransition ? <p className="ed-tip">The next clip's transition replaces this clip's exit animation.</p> : <AnimationPicker label="Exit" value={clip.exit} onChange={(exit, group) => onChange({ exit }, group)} onShow={onShowExit}/>}
    </Group>
    {source?.kind === 'video' && <Group title="Speed and sound" changed={clip.speed !== 1 || clip.muted || clip.volume !== 1 || clip.fade_in > 0 || clip.fade_out > 0}>
      <Slider label="Speed" value={clip.speed} min={0.25} max={4} step={0.05} shown={`${clip.speed.toFixed(2)}×`} onChange={(speed) => onChange({ speed }, `speed-${clip.id}`)} onReset={() => onChange({ speed: 1 })}/>
      <h3 className="ed-sub">Sound</h3>
      <button className={`ed-button wide ${clip.muted ? 'on' : ''}`} onClick={() => onChange({ muted: !clip.muted })}>{clip.muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}{clip.muted ? 'Muted' : 'Mute this clip'}</button>
      <SoundControls item={clip} id={clip.id} length={(clip.out - clip.in) / clip.speed} onChange={onChange}/>
      {canDetach && <button className="ed-button wide" onClick={onDetach}><AudioLines size={15}/>Detach sound</button>}
    </Group>}
  </>;
}

function ExportDialog({ timeline, projectId, onNormalize, onClose, onOpen }: { timeline: Timeline; projectId: number; onNormalize: (on: boolean) => void; onClose: () => void; onOpen: (id: number) => void }) {
  const shortest = Math.min(timeline.format.width, timeline.format.height);
  const [quality, setQuality] = useState(shortest >= 2160 ? 2160 : Math.max(720, Math.min(1080, shortest)));
  const [job, setJob] = useState<{ id: string; progress: number; status?: string | null; error?: string | null; output?: number | null } | null>(null);
  const [error, setError] = useState('');
  const seconds = duration(timeline);
  const megabytes = Math.round(seconds * ESTIMATED_MB_PER_SECOND_1080 * (quality / 1080) ** 2);
  const start = async () => {
    setError('');
    try {
      const { job_id } = await exportProjectTimeline(projectId, { ...timeline, format: exportFormat(timeline.format, quality) });
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
