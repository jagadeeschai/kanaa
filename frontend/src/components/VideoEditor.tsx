import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FlipHorizontal, FlipVertical, RotateCcw, RotateCw, X } from 'lucide-react';
import { cancelRenderJob, getJobStatus, photoThumbUrl, photoVideoUrl, startVideoExport } from '../api/client';
import type { Photo, VideoEditSettings } from '../types/photo';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useVideoProject } from '../hooks/useVideoProject';

const defaults = (): VideoEditSettings => ({ trim_start: 0, trim_end: null, rotation: 0, flip_horizontal: false, flip_vertical: false, brightness: 1, contrast: 1, saturation: 1, volume: 1, mute: false });
const inputClass = 'theme-control w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100';
const buttonClass = 'theme-control rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10 disabled:opacity-50';
const time = (seconds: number) => `${Math.floor(Math.round(seconds * 10) / 600)}:${((Math.round(seconds * 10) % 600) / 10).toFixed(1).padStart(4, '0')}`;

// Stored as a list of clips from the start, so multi-clip editing won't need a migration.
type EditRecipe = {
  version: 1;
  clips: { photo_id: number; in: number; out: number | null }[];
  settings: Omit<VideoEditSettings, 'trim_start' | 'trim_end'>;
};

const toRecipe = (photoId: number, edit: VideoEditSettings): EditRecipe => {
  const { trim_start, trim_end, ...settings } = edit;
  return { version: 1, clips: [{ photo_id: photoId, in: trim_start, out: trim_end }], settings };
};

type Props = { photo: Photo; projectId: number; projectName: string; onClose: () => void; onOpenOutput?: (id: number) => void };

export default function VideoEditor({ photo, projectId, projectName, onClose, onOpenOutput }: Props) {
  const [edit, setEdit] = useState(defaults);
  const [duration, setDuration] = useState(photo.duration ?? 0);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<{ id: string; progress: number; done: boolean; outputId?: number | null; error?: string | null } | null>(null);
  const [size, setSize] = useState({ width: 640, height: 360 });
  const [natural, setNatural] = useState({ width: photo.width || 1920, height: photo.height || 1080 });
  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const startLockRef = useRef(false);
  const previewRangeRef = useRef(false);
  const closeRef = useRef(() => {});
  useFocusTrap(dialogRef, true);
  const end = edit.trim_end ?? duration;
  const dirty = JSON.stringify(edit) !== JSON.stringify(defaults());
  const exporting = starting || Boolean(job && !job.done);
  const valid = duration > 0 && end <= duration + 0.05 && Math.min(end, duration) - edit.trim_start >= 0.1 - 1e-6;
  const rotated = edit.rotation === 90 || edit.rotation === 270;
  const scale = Math.min(size.width / (rotated ? natural.height : natural.width), size.height / (rotated ? natural.width : natural.height));
  const update = (changes: Partial<VideoEditSettings>) => setEdit((previous) => ({ ...previous, ...changes }));

  // Edits autosave and exports keep running in the Exports page, so leaving is always safe.
  const close = onClose;
  closeRef.current = close;
  const project = useVideoProject<EditRecipe>(projectId, 'edit', dirty ? toRecipe(photo.id, edit) : null, (recipe) => {
    const clip = recipe.clips[0];
    if (clip) setEdit({ ...defaults(), ...recipe.settings, trim_start: clip.in, trim_end: clip.out });
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopImmediatePropagation(); closeRef.current(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => setSize({ width: Math.max(1, stage.clientWidth - 32), height: Math.max(1, stage.clientHeight - 32) }));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (video) { video.muted = edit.mute; video.volume = Math.min(1, edit.volume); }
  }, [edit.mute, edit.volume]);

  useEffect(() => {
    if (!job || job.done) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const status = await getJobStatus(job.id);
        if (cancelled) return;
        setJob({ id: job.id, progress: status.progress, done: status.done, outputId: status.output_photo_id, error: status.error });
        if (status.done) return;
      } catch (problem) {
        if (cancelled) return;
        const message = problem instanceof Error ? problem.message : 'Could not check export progress.';
        if (message.toLowerCase().includes('not found')) { setJob({ id: job.id, progress: 0, done: true, error: 'Export status is no longer available. Check Exports before retrying.' }); return; }
        setError(message);
      }
      if (!cancelled) timer = setTimeout(poll, 800);
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [job?.id, job?.done]);

  const exportCopy = async () => {
    if (!valid || startLockRef.current || exporting) return;
    startLockRef.current = true;
    setStarting(true);
    setError(null);
    try {
      const result = await startVideoExport(photo.id, edit);
      setJob({ id: result.job_id, progress: 0, done: false });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not start video export.');
    } finally { setStarting(false); startLockRef.current = false; }
  };

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video && previewRangeRef.current && video.currentTime >= end) {
        video.pause(); video.currentTime = end; setPosition(end); previewRangeRef.current = false;
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, end]);
  const seek = (value: number) => { previewRangeRef.current = false; if (videoRef.current) videoRef.current.currentTime = value; setPosition(value); };

  return createPortal(
    <>
      <div className="theme-overlay fixed inset-0 z-[110] bg-black/70 sm:p-4">
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Video editor" tabIndex={-1} className="theme-modal flex h-full w-full flex-col overflow-hidden border border-white/10 bg-slate-950 shadow-2xl outline-none sm:rounded-2xl">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div className="min-w-0"><h2 className="text-base font-semibold text-slate-100">{projectName}</h2><p className="truncate text-xs text-slate-400">{photo.filename}</p></div>
            <button onClick={close} aria-label="Close video editor" className={buttonClass}><span className="flex items-center gap-2"><span className="hidden sm:inline">Back to studio</span><X className="h-4 w-4" /></span></button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
            <div className="sticky top-0 z-10 flex min-h-0 shrink-0 flex-col bg-white lg:static lg:flex-1">
              <div ref={stageRef} className="relative flex h-[30dvh] min-h-40 items-center justify-center overflow-hidden bg-black lg:h-auto lg:flex-1">
                <video ref={videoRef} src={photoVideoUrl(photo.id)} poster={photoThumbUrl(photo.id)} preload="metadata" aria-label="Video edit preview"
                  onLoadedMetadata={(event) => { const video = event.currentTarget; if (Number.isFinite(video.duration)) setDuration(video.duration); setNatural({ width: video.videoWidth || 1920, height: video.videoHeight || 1080 }); }}
                  onError={() => setError('This browser cannot play the video. You can still export it if the server supports its format.')}
                  onPause={() => setPlaying(false)}
                  onPlay={() => setPlaying(true)}
                  onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
                  style={{ width: natural.width * scale, height: natural.height * scale, maxWidth: 'none', maxHeight: 'none', flexShrink: 0, filter: `brightness(${edit.brightness}) contrast(${edit.contrast}) saturate(${edit.saturation})`, transform: `scaleX(${edit.flip_horizontal ? -1 : 1}) scaleY(${edit.flip_vertical ? -1 : 1}) rotate(${edit.rotation}deg)` }} />
              </div>
              <div className="border-t border-white/10 px-4 py-3">
                <div className="mb-2 flex justify-between text-xs text-slate-400"><span>{time(position)}</span><span>{time(duration)}</span></div>
                <input aria-label="Video playhead" type="range" min={0} max={duration || 1} step={0.05} value={Math.min(position, duration || 1)} onChange={(event) => seek(Number(event.target.value))} className="w-full accent-brand-400" />
                <button onClick={() => { const video = videoRef.current; if (video?.paused) void video.play().catch(() => {}); else video?.pause(); }} className={`${buttonClass} mr-2 mt-2`}>{playing ? 'Pause preview' : 'Play preview'}</button>
                <button onClick={() => { seek(edit.trim_start); previewRangeRef.current = true; void videoRef.current?.play().catch(() => {}); }} className={`${buttonClass} mt-2`}>Preview selected range</button>
              </div>
            </div>
            <aside aria-label="Video adjustments" className="space-y-5 border-t border-white/10 p-4 lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
              <fieldset disabled={exporting || !project.loaded} className="space-y-5 disabled:opacity-60">
                <div><h3 className="mb-3 text-sm font-semibold text-slate-100">Trim</h3><div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-slate-400">Start (seconds)<input aria-label="Trim start" type="number" min={0} max={Math.max(0, end - 0.1)} step={0.1} value={edit.trim_start} onChange={(event) => update({ trim_start: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label>
                  <label className="text-xs text-slate-400">End (seconds)<input aria-label="Trim end" type="number" min={edit.trim_start + 0.1} max={duration} step={0.1} value={Number(end.toFixed(3))} onChange={(event) => update({ trim_end: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label>
                </div><div className="mt-2 flex gap-2"><button onClick={() => update({ trim_start: Math.min(position, end - 0.1) })} className={buttonClass}>Set start here</button><button onClick={() => update({ trim_end: Math.max(position, edit.trim_start + 0.1) })} className={buttonClass}>Set end here</button></div>
                <p className="mt-2 text-xs text-slate-400">{valid ? `${time(end - edit.trim_start)} selected` : 'Select at least 0.1 seconds inside the video.'}</p></div>
                <div><h3 className="mb-3 text-sm font-semibold text-slate-100">Transform</h3><div className="grid grid-cols-2 gap-2">
                  <button onClick={() => update({ rotation: ((edit.rotation + 270) % 360) as VideoEditSettings['rotation'] })} className={buttonClass} aria-label="Rotate video left"><RotateCcw className="mx-auto h-4 w-4" /></button>
                  <button onClick={() => update({ rotation: ((edit.rotation + 90) % 360) as VideoEditSettings['rotation'] })} className={buttonClass} aria-label="Rotate video right"><RotateCw className="mx-auto h-4 w-4" /></button>
                  <button onClick={() => update({ flip_horizontal: !edit.flip_horizontal })} aria-pressed={edit.flip_horizontal} className={buttonClass}><FlipHorizontal className="mr-1 inline h-4 w-4" />Flip H</button>
                  <button onClick={() => update({ flip_vertical: !edit.flip_vertical })} aria-pressed={edit.flip_vertical} className={buttonClass}><FlipVertical className="mr-1 inline h-4 w-4" />Flip V</button>
                </div><p className="mt-2 text-xs text-slate-400">Rotation: {edit.rotation}°</p></div>
                <Slider label="Brightness" value={edit.brightness} min={0.25} max={2} onChange={(brightness) => update({ brightness })} />
                <Slider label="Contrast" value={edit.contrast} min={0.25} max={2} onChange={(contrast) => update({ contrast })} />
                <Slider label="Saturation" value={edit.saturation} min={0} max={2} onChange={(saturation) => update({ saturation })} />
                <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={edit.mute} onChange={(event) => update({ mute: event.target.checked })} className="accent-brand-400" />Mute audio</label>
                <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={Boolean(edit.keep_location)} onChange={(event) => update({ keep_location: event.target.checked })} className="accent-brand-400" />Keep GPS location in the export</label>
                <Slider label="Volume" value={edit.volume} min={0} max={1} disabled={edit.mute} onChange={(volume) => update({ volume })} />
                <button onClick={() => { setEdit(defaults()); seek(0); }} className={buttonClass}>Reset video edits</button>
              </fieldset>
            </aside>
          </div>
          <footer className="shrink-0 space-y-2 border-t border-white/10 px-4 py-3">
            {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
            {job?.error && <p role="alert" className="text-sm text-rose-300">{job.error}</p>}
            {exporting && <div role="status"><p className="mb-1 text-xs text-slate-300">{starting ? 'Starting export…' : `Exporting MP4… ${job?.progress ?? 0}%`}</p><progress aria-label="Video export progress" max={100} value={job?.progress ?? 0} className="h-2 w-full accent-brand-400" /></div>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-400">H.264 MP4 · New copy in Exports · {project.saveFailed ? 'Could not save edits' : project.saving ? 'Saving…' : 'All changes saved'}</p>
              <div className="flex gap-2">
                {job?.done && !job.error && job.outputId != null && <button onClick={() => { onOpenOutput?.(job.outputId!); onClose(); }} className={buttonClass}>Open exported video</button>}
                {job && !job.done && <button onClick={() => { void cancelRenderJob(job.id).catch(() => {}); }} className={buttonClass}>Cancel export</button>}
                <button onClick={() => { void exportCopy(); }} disabled={!valid || exporting} className="theme-action-brand flex items-center gap-2 rounded-xl border border-brand-400/30 bg-brand-500/15 px-4 py-2 text-sm font-medium text-brand-100 disabled:opacity-50"><Download className="h-4 w-4" />Export MP4 copy</button>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </>, document.body
  );
}

function Slider({ label, value, min, max, disabled, onChange }: { label: string; value: number; min: number; max: number; disabled?: boolean; onChange: (value: number) => void }) {
  return <label className="block text-sm text-slate-300"><span className="mb-2 flex justify-between"><span>{label}</span><span className="text-xs text-slate-400">{Math.round(value * 100)}%</span></span><input aria-label={`Video ${label.toLowerCase()}`} type="range" min={min} max={max} step={0.05} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-brand-400" /></label>;
}
