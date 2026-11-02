import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ArrowLeft, Check, Download, FlipHorizontal, FlipVertical, LoaderCircle, Maximize, Minimize, Minus, Pause, Play, Plus, Redo2, RotateCcw, RotateCw, Scissors, ShieldCheck, Trash2, Undo2, Volume2, VolumeX, X } from 'lucide-react';
import { cancelRenderJob, clipFilmstripUrl, clipProxyUrl, exportProjectTimeline, getClipAssets, getClipPeaks, getJobStatus, getProjectTimeline, getVideoProject, listPhotos, photoImageUrl, photoThumbUrl, photoVideoUrl, saveVideoProject } from '../api/client';
import ImportArea from '../components/ImportArea';
import type { Photo } from '../types/photo';
import { commit, redo, startHistory, undo, type History } from '../timeline/history';
import { clipLength, duration, exportFormat, fillScale, FORMATS, insertClip, mainLayer, newClip, normalizeTimeline, removeClip, splitClip, timecode, trimClip, updateClip, type Adjust, type Clip, type Format, type SourceFacts, type Timeline } from '../timeline/model';
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

  useEffect(() => { if (timeline) engineRef.current?.setTimeline(timeline, sourceFor); }, [timeline, sourceFor]);

  const usedMedia = useMemo(() => [...new Set(timeline ? mainLayer(timeline).items.map((clip) => clip.media_id) : [])].join(','), [timeline]);
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
  const updateSelected = (changes: Partial<Clip>, group?: string) => { if (timeline && selected) change(updateClip(timeline, selected.id, changes), group); };
  const seek = useCallback((t: number) => engineRef.current?.seek(t), []);
  const togglePlay = useCallback(() => { const engine = engineRef.current; if (!engine) return; if (engine.playing) engine.pause(); else engine.play(); }, []);
  const split = useCallback(() => { if (timeline) { const next = splitClip(timeline, playhead.current, newId()); if (next !== timeline) change(next); } }, [timeline, playhead, change]);
  const removeSelected = useCallback(() => { if (timeline && selectedId) { change(removeClip(timeline, selectedId)); setSelectedId(null); } }, [timeline, selectedId, change]);
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
      <aside className="ed-inspector" aria-label="Clip settings">{selected ? <Inspector clip={selected} source={sourceFor(selected.media_id)} format={timeline!.format} onChange={updateSelected}/> : <div className="ed-hint"><h2>Clip settings</h2><p>Select a clip on the timeline to reframe it, change its speed, or adjust its picture and sound.</p></div>}</aside>
    </div>
    <div className="ed-tools">
      <button className="ed-button" onClick={split} disabled={!total} title="Split at playhead (S)"><Scissors size={15}/>Split</button>
      <button className="ed-button" onClick={removeSelected} disabled={!selected} title="Delete (⌫)"><Trash2 size={15}/>Delete</button>
      <div className="ed-spacer"/>
      <button className="ed-icon" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value / ZOOM_STEP))}><Minus size={15}/></button>
      <button className="ed-icon" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value * ZOOM_STEP))}><Plus size={15}/></button>
    </div>
    {timeline && <TimelineView timeline={timeline} selectedId={selectedId} zoom={zoom} playhead={playhead} source={facts} visuals={(id) => visuals.current.get(id) ?? {}} onSelect={setSelectedId} onSeek={seek} onChange={change} onScrubStart={() => engineRef.current?.pause()}/>}
    {choosingFormat && timeline && <FormatDialog clipFormat={photo.width && photo.height ? { width: photo.width - photo.width % 2, height: photo.height - photo.height % 2, fps: 30 } : null} current={timeline.format} onChoose={chooseFormat}/>}
    {exporting && timeline && <ExportDialog timeline={timeline} projectId={projectId} onClose={() => setExporting(false)} onOpen={onOpenOutput}/>}
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

function Inspector({ clip, source, format, onChange }: { clip: Clip; source?: PlaybackSource; format: Format; onChange: (changes: Partial<Clip>, group?: string) => void }) {
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
      <Slider label="Volume" value={clip.volume} min={0} max={1} shown={percent(clip.volume)} onChange={(volume) => onChange({ volume }, `volume-${clip.id}`)} onReset={() => onChange({ volume: 1 })}/>
    </>}
  </>;
}

function ExportDialog({ timeline, projectId, onClose, onOpen }: { timeline: Timeline; projectId: number; onClose: () => void; onOpen: (id: number) => void }) {
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
