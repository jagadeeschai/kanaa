import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ArrowLeft, AudioLines, Check, Download, FlipHorizontal, FlipVertical, LoaderCircle, Maximize, Minimize, Minus, Music, Pause, Play, Plus, Redo2, RotateCcw, RotateCw, Scissors, ShieldCheck, Trash2, Undo2, Volume2, VolumeX, X } from 'lucide-react';
import { cancelRenderJob, clipFilmstripUrl, clipProxyUrl, exportProjectTimeline, getClipAssets, getClipPeaks, getJobStatus, getProjectTimeline, getSongPeaks, getStemsStatus, getVideoProject, listPhotos, photoImageUrl, photoThumbUrl, photoVideoUrl, saveVideoProject, songUrl, startStems, uploadVideoAudio, type Stems } from '../api/client';
import ImportArea from '../components/ImportArea';
import type { Photo } from '../types/photo';
import { commit, redo, startHistory, undo, type History } from '../timeline/history';
import { addSound, audioLayers, clipLength, detachAudio, duration, exportFormat, fillScale, findSound, FORMATS, insertClip, mainLayer, MUSIC_VOLUME, newClip, normalizeTimeline, removeClip, removeSound, soundLength, splitClip, splitSound, timecode, trimClip, updateClip, updateLayer, updateSound, type Adjust, type AudioLayer, type Clip, type Format, type Sound, type SourceFacts, type Timeline } from '../timeline/model';
import { PlaybackEngine, type PlaybackSource } from './playback';
import TimelineView, { type ClipVisuals } from './TimelineView';

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
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

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
      } catch (problem) { if (!cancelled) setError((problem as Error).message); }
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
      };
      engine.onPlayingChange = setPlaying;
      engineRef.current = engine;
      return () => { engine.destroy(); engineRef.current = null; };
    } catch (problem) { setError((problem as Error).message); }
  }, [playhead]);

  useEffect(() => { if (timeline) engineRef.current?.setTimeline(timeline, sourceFor, soundUrl); }, [timeline, sourceFor, soundUrl]);

  const usedMedia = useMemo(() => [...new Set(timeline ? [...mainLayer(timeline).items.map((clip) => clip.media_id), ...audioLayers(timeline).flatMap((layer) => layer.items.flatMap((sound) => sound.media_id ?? []))] : [])].join(','), [timeline]);

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
  const selected = timeline && selectedId ? mainLayer(timeline).items.find((clip) => clip.id === selectedId) ?? null : null;
  const selectedSound = timeline ? findSound(timeline, selectedId) : null;
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
    const next = findSound(timeline, selectedId) ? splitSound(timeline, selectedId!, playhead.current, newId()) : splitClip(timeline, playhead.current, newId());
    if (next !== timeline) change(next);
  }, [timeline, selectedId, playhead, change]);
  const removeSelected = useCallback(() => {
    if (!timeline || !selectedId) return;
    change(findSound(timeline, selectedId) ? removeSound(timeline, selectedId) : removeClip(timeline, selectedId));
    setSelectedId(null);
  }, [timeline, selectedId, change]);
  const addMedia = (item: Photo) => {
    if (!timeline) return;
    const source: SourceFacts = { media_id: item.id, media_type: item.media_type === 'video' ? 'video' : 'image', duration: item.duration, width: item.width, height: item.height };
    const clip = newClip(source, newId());
    change(insertClip(timeline, clip));
    setSelectedId(clip.id);
  };
  const chooseFormat = (format: Format) => {
    if (!timeline) return;
    change({ ...timeline, format });
    setChoosingFormat(false);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || !timeline || exporting || choosingFormat) return;
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
        case 'i': { const item = clip(); if (item) change(trimClip(timeline, item.id, 'in', item.in + (playhead.current - item.start) * item.speed, facts(item.media_id))); break; }
        case 'o': { const item = clip(); if (item) change(trimClip(timeline, item.id, 'out', item.in + (playhead.current - item.start) * item.speed, facts(item.media_id))); break; }
        case 'Delete': case 'Backspace': event.preventDefault(); removeSelected(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [timeline, exporting, choosingFormat, togglePlay, split, removeSelected, seek, change, playhead, facts]);

  const dragPreview = useRef<{ x: number; y: number; clipX: number; clipY: number; group: string } | null>(null);
  const previewDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!selected) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragPreview.current = { x: event.clientX, y: event.clientY, clipX: selected.transform.x, clipY: selected.transform.y, group: `move-${Date.now()}` };
  };
  const previewMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragPreview.current;
    if (!drag || !selected) return;
    const rect = event.currentTarget.getBoundingClientRect();
    updateSelected({ transform: { ...selected.transform, x: drag.clipX + (event.clientX - drag.x) / rect.width, y: drag.clipY + (event.clientY - drag.y) / rect.height } }, drag.group);
  };

  const total = timeline ? duration(timeline) : 0;
  const aspect = timeline ? `${timeline.format.width} / ${timeline.format.height}` : '16 / 9';
  const isEmpty = timeline && !mainLayer(timeline).items.length;
  return <div className="ed" role="application" aria-label="Video editor">
    <header className="ed-top">
      <button className="ed-icon" onClick={onClose} aria-label="Back to projects"><ArrowLeft size={18}/></button>
      <div className="ed-title"><strong>{projectName}</strong><span>{saved === 'saving' ? 'Saving…' : saved === 'failed' ? 'Could not save' : 'Saved'}</span></div>
      <div className="ed-spacer"/>
      <button className="ed-icon" disabled={!history.past.length} onClick={() => dispatch({ type: 'undo' })} aria-label="Undo" title="Undo (⌘Z)"><Undo2 size={17}/></button>
      <button className="ed-icon" disabled={!history.future.length} onClick={() => dispatch({ type: 'redo' })} aria-label="Redo" title="Redo (⇧⌘Z)"><Redo2 size={17}/></button>
      <button className="ed-button" onClick={() => setChoosingFormat(true)}>{timeline ? `${timeline.format.width} × ${timeline.format.height}` : 'Format'}</button>
      <button className="ed-primary" disabled={!total} onClick={() => { engineRef.current?.pause(); setExporting(true); }}><Download size={16}/>Export</button>
    </header>
    {error && <div className="ed-error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={15}/></button></div>}
    <div className="ed-body">
      <aside className="ed-media" aria-label="Media">
        <h2>Media</h2>
        <ImportArea compact onImported={(items) => { setMedia((current) => [...items, ...current]); }}/>
        <label className={`ed-button wide ed-music ${addingMusic ? 'busy' : ''}`}>{addingMusic ? <LoaderCircle className="spin" size={15}/> : <Music size={15}/>}{addingMusic ? 'Adding music…' : 'Add music'}
          <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg" disabled={addingMusic} aria-label="Add music" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void addMusic(file); }}/></label>
        <div className="ed-media-grid">{media.filter((item) => !item.filename.startsWith('Blank canvas')).map((item) => <button key={item.id} onClick={() => addMedia(item)} title={`Add ${item.filename}`}>
          <img src={photoThumbUrl(item.id)} alt="" loading="lazy"/><span><Plus size={13}/>{item.filename}</span></button>)}</div>
      </aside>
      <main className="ed-stage">
        <div className="ed-frame" style={{ aspectRatio: aspect }}>
          <canvas ref={canvasRef} aria-label="Preview" onPointerDown={previewDown} onPointerMove={previewMove} onPointerUp={() => { dragPreview.current = null; }} className={selected ? 'movable' : ''}/>
          {safeArea && <div className="ed-safe" aria-hidden="true"><span>Keep titles and faces inside this box</span></div>}
          {isEmpty && !choosingFormat && <div className="ed-empty"><strong>Add a clip to start</strong><span>Choose something from Media on the left</span></div>}
        </div>
        <div className="ed-transport">
          <span className="ed-clock"><span ref={clockRef}>0:00.00</span> / {timecode(total)}</span>
          <button className="ed-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button>
          <button className={`ed-icon ${safeArea ? 'on' : ''}`} aria-pressed={safeArea} onClick={() => setSafeArea((value) => !value)} aria-label="Show safe area" title="Show safe area"><ShieldCheck size={17}/></button>
        </div>
      </main>
      <aside className="ed-inspector" aria-label="Clip settings">{selectedSound ? <SoundInspector sound={selectedSound.sound} layer={selectedSound.layer} onChange={updateSelectedSound} onLayer={(changes) => change(updateLayer(timeline!, selectedSound.layer.id, changes))}
        stems={stems} job={stemJob?.soundId === selectedSound.sound.id ? stemJob : null} busy={Boolean(stemJob)} onSeparate={(choice) => { void separate(choice); }} onCancelStems={() => { if (stemJob) void cancelRenderJob(stemJob.jobId); }}/>
        : selected ? <Inspector clip={selected} source={sourceFor(selected.media_id)} format={timeline!.format} onChange={updateSelected} canDetach={!selected.muted && hasSound(selected.media_id)} onDetach={detach}/> : <div className="ed-hint"><h2>Clip settings</h2><p>Select a clip on the timeline to reframe it, change its speed, or adjust its picture and sound.</p></div>}</aside>
    </div>
    <div className="ed-tools">
      <button className="ed-button" onClick={split} disabled={!total} title="Split at playhead (S)"><Scissors size={15}/>Split</button>
      <button className="ed-button" onClick={removeSelected} disabled={!selected && !selectedSound} title="Delete (⌫)"><Trash2 size={15}/>Delete</button>
      <div className="ed-spacer"/>
      <button className="ed-icon" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value / ZOOM_STEP))}><Minus size={15}/></button>
      <button className="ed-icon" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value * ZOOM_STEP))}><Plus size={15}/></button>
    </div>
    {timeline && <TimelineView timeline={timeline} selectedId={selectedId} zoom={zoom} playhead={playhead} source={facts} visuals={(id) => visuals.current.get(id) ?? {}} soundPeaks={soundPeaks} onSelect={setSelectedId} onSeek={seek} onChange={change} onScrubStart={() => engineRef.current?.pause()}/>}
    {choosingFormat && timeline && <FormatDialog clipFormat={photo.width && photo.height ? { width: photo.width - photo.width % 2, height: photo.height - photo.height % 2, fps: 30 } : null} current={timeline.format} onChoose={chooseFormat}/>}
    {exporting && timeline && <ExportDialog timeline={timeline} projectId={projectId} onNormalize={(normalize_audio) => change({ ...timeline, normalize_audio })} onClose={() => setExporting(false)} onOpen={onOpenOutput}/>}
  </div>;
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
  return <label className="ed-slider" onDoubleClick={onReset} title="Double-click to reset"><span>{label}<em>{shown}</em></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))}/></label>;
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

function Inspector({ clip, source, format, onChange, canDetach, onDetach }: { clip: Clip; source?: PlaybackSource; format: Format; onChange: (changes: Partial<Clip>, group?: string) => void; canDetach: boolean; onDetach: () => void }) {
  const adjust = (changes: Partial<Adjust>) => onChange({ adjust: { ...clip.adjust, ...changes } }, `adjust-${clip.id}`);
  const fill = source ? fillScale(source, clip.adjust.rotation, format) : 1;
  const filling = Math.abs(clip.transform.scale - fill) < 0.01;
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return <>
    <h2>Framing</h2>
    <div className="ed-pair">
      <button className={`ed-button ${!filling && clip.transform.scale === 1 ? 'on' : ''}`} onClick={() => onChange({ transform: { ...clip.transform, x: 0.5, y: 0.5, scale: 1 } })}><Minimize size={14}/>Fit</button>
      <button className={`ed-button ${filling ? 'on' : ''}`} onClick={() => onChange({ transform: { ...clip.transform, x: 0.5, y: 0.5, scale: fill } })}><Maximize size={14}/>Fill</button>
    </div>
    <Slider label="Size" value={clip.transform.scale} min={0.2} max={4} shown={percent(clip.transform.scale)} onChange={(scale) => onChange({ transform: { ...clip.transform, scale } }, `scale-${clip.id}`)} onReset={() => onChange({ transform: { ...clip.transform, scale: 1 } })}/>
    <p className="ed-tip">Drag the picture in the preview to position it.</p>
    <div className="ed-pair">
      <button className="ed-icon" aria-label="Rotate left" onClick={() => adjust({ rotation: ((clip.adjust.rotation + 270) % 360) as Adjust['rotation'] })}><RotateCcw size={16}/></button>
      <button className="ed-icon" aria-label="Rotate right" onClick={() => adjust({ rotation: ((clip.adjust.rotation + 90) % 360) as Adjust['rotation'] })}><RotateCw size={16}/></button>
      <button className={`ed-icon ${clip.adjust.flip_horizontal ? 'on' : ''}`} aria-label="Flip horizontally" onClick={() => adjust({ flip_horizontal: !clip.adjust.flip_horizontal })}><FlipHorizontal size={16}/></button>
      <button className={`ed-icon ${clip.adjust.flip_vertical ? 'on' : ''}`} aria-label="Flip vertically" onClick={() => adjust({ flip_vertical: !clip.adjust.flip_vertical })}><FlipVertical size={16}/></button>
    </div>
    <h2>Picture</h2>
    <Slider label="Brightness" value={clip.adjust.brightness} min={0.25} max={2} shown={percent(clip.adjust.brightness)} onChange={(brightness) => adjust({ brightness })} onReset={() => adjust({ brightness: 1 })}/>
    <Slider label="Contrast" value={clip.adjust.contrast} min={0.25} max={2} shown={percent(clip.adjust.contrast)} onChange={(contrast) => adjust({ contrast })} onReset={() => adjust({ contrast: 1 })}/>
    <Slider label="Saturation" value={clip.adjust.saturation} min={0} max={2} shown={percent(clip.adjust.saturation)} onChange={(saturation) => adjust({ saturation })} onReset={() => adjust({ saturation: 1 })}/>
    {source?.kind === 'video' && <>
      <h2>Speed</h2>
      <Slider label="Speed" value={clip.speed} min={0.25} max={4} step={0.05} shown={`${clip.speed.toFixed(2)}×`} onChange={(speed) => onChange({ speed }, `speed-${clip.id}`)} onReset={() => onChange({ speed: 1 })}/>
      <h2>Sound</h2>
      <button className={`ed-button wide ${clip.muted ? 'on' : ''}`} onClick={() => onChange({ muted: !clip.muted })}>{clip.muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}{clip.muted ? 'Muted' : 'Mute this clip'}</button>
      <SoundControls item={clip} id={clip.id} length={(clip.out - clip.in) / clip.speed} onChange={onChange}/>
      {canDetach && <button className="ed-button wide" onClick={onDetach}><AudioLines size={15}/>Detach sound</button>}
    </>}
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
