import { t } from "../../i18n";
import { useEffect, useState } from "react";
import { Check, Download, LoaderCircle, X } from "lucide-react";
import { cancelRenderJob, exportProjectTimeline, getJobStatus } from "../../api/client";
import { duration, exportFormat, timecode, type Timeline } from "../../timeline/model";
import { coverBrand } from "../../timeline/brand";
import { exportSpec } from "../export-spec";
import { missingSources } from "../../timeline/sources";

const QUALITIES = [{ id: 720, label: '720p', note: 'Smallest file' }, { id: 1080, label: '1080p', note: 'Best for most posts' }, { id: 2160, label: '4K', note: 'Slower, larger file' }];

const ESTIMATED_MB_PER_SECOND_1080 = 1.1;

const hardwareMbps = (shortSide: number) => ({ 720: 9, 1080: 16, 1440: 28 } as Record<number, number>)[shortSide] ?? (shortSide >= 2160 ? 50 : Math.round(shortSide * 0.015));

export function ExportDialog({ timeline, projectId, withSound, onNormalize, onClose, onOpen }: { timeline: Timeline; projectId: number; withSound: boolean; onNormalize: (on: boolean) => void; onClose: () => void; onOpen: (id: number) => void }) {
  const shortest = Math.min(timeline.format.width, timeline.format.height);
  const [quality, setQuality] = useState(shortest >= 2160 ? 2160 : Math.max(720, Math.min(1080, shortest)));
  const [job, setJob] = useState<{ id: string; progress: number; status?: string | null; error?: string | null; output?: number | null } | null>(null);
  const [error, setError] = useState('');
  const seconds = duration(timeline);
  const uncited=missingSources(timeline);
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
    {!job && uncited.length>0 && <p role="alert" className="ed-tip">{uncited.length} {t('numbers or quotes need a source')}. {t('Add Source footnotes before sharing this documentary.')}</p>}
    {!job && <><p>{timecode(seconds)} long · about {megabytes >= 1000 ? `${(megabytes / 1000).toFixed(1)} GB` : `${megabytes} MB`}</p>
      <div className="ed-qualities">{QUALITIES.map((item) => <button key={item.id} className={quality === item.id ? 'on' : ''} aria-pressed={quality === item.id} onClick={() => setQuality(item.id)}><strong>{item.label}</strong><span>{item.note}</span></button>)}</div>
      <p className="ed-export-spec">{exportSpec(outputFormat, withSound)}</p>
      <label className="ed-check"><input type="checkbox" checked={hardware} onChange={(event) => setHardware(event.target.checked)}/><span>Fast export<small>Uses this Mac's hardware encoder — several times faster, same resolution. Off gives the smallest file.</small></span></label>
      <label className="ed-check"><input type="checkbox" checked={Boolean(timeline.normalize_audio)} onChange={(event) => onNormalize(event.target.checked)}/><span>Even out loudness<small>{t('The same setting as Project settings › Sound.')} Matches the level social apps expect. Applied to the export, not the preview.</small></span></label>
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
