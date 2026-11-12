/**
 * Every long job in one place: exports, AI pictures, people tracking, brand intros, effects. A button shows how many
 * are running; it opens a list with progress, what each is doing, Cancel, and plain words when one fails. A short note
 * appears when a job finishes while the editor is open.
 */
import { useEffect, useRef, useState } from 'react';
import { ListChecks, X } from 'lucide-react';
import { cancelRenderJob, getRenderJobs } from '../api/client';
import type { RenderJob } from '../types/photo';
import { t } from '../i18n';
import { explainError } from './errors';

const ACTIVE = new Set(['queued', 'running', 'cancelling']);
const SHOWN_DONE = 8;  // Finished jobs kept in the list, newest first.

export default function JobTray() {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<{ id: string; text: string; failed: boolean }[]>([]);
  const seen = useRef<Map<string, string>>(new Map());
  const box = useRef<HTMLDivElement>(null);
  const active = jobs.filter((job) => ACTIVE.has(job.status));

  useEffect(() => {
    let stop = false, timer = 0;
    const poll = async () => {
      try {
        const next = await getRenderJobs();
        if (stop) return;
        // A job that was running when we last looked and has now finished gets a short note.
        const finished = next.filter((job) => ACTIVE.has(seen.current.get(job.job_id) ?? '') && !ACTIVE.has(job.status) && job.status !== 'cancelled');
        if (finished.length) setNotes((current) => [...current, ...finished.map((job) => ({ id: job.job_id, text: job.label, failed: job.status === 'failed' }))]);
        seen.current = new Map(next.map((job) => [job.job_id, job.status]));
        setJobs(next);
        timer = window.setTimeout(poll, next.some((job) => ACTIVE.has(job.status)) ? 1500 : 4000);
      } catch { timer = window.setTimeout(poll, 6000); }
    };
    void poll();
    return () => { stop = true; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!notes.length) return;
    const timer = window.setTimeout(() => setNotes((current) => current.slice(1)), 5000);
    return () => window.clearTimeout(timer);
  }, [notes]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key); };
  }, [open]);

  const listed = [...active, ...jobs.filter((job) => !ACTIVE.has(job.status)).slice(-SHOWN_DONE).reverse()];
  return <div className="ed-jobs" ref={box}>
    <button className={open ? 'on' : ''} aria-label={t('Jobs')} aria-haspopup="dialog" aria-expanded={open} data-tip={active.length ? t('{count} jobs running', { count: active.length }) : t('Jobs')} onClick={() => setOpen(!open)}>
      <ListChecks size={17}/>{active.length > 0 && <i className="ed-jobs-count">{active.length}</i>}
    </button>
    {open && <div className="ed-jobs-panel" role="dialog" aria-label={t('Jobs')}>
      <h3>{t('Jobs')}</h3>
      {!listed.length && <p className="ed-tip">{t('Nothing is running.')}</p>}
      <ul>{listed.map((job) => {
        const running = ACTIVE.has(job.status);
        const failed = job.status === 'failed';
        return <li key={job.job_id} className={failed ? 'failed' : running ? 'running' : ''}>
          <div className="ed-jobs-row"><b title={job.label}>{job.label}</b>
            {running && job.status !== 'cancelling' && <button className="ed-icon small" aria-label={`${t('Cancel')}: ${job.label}`} title={t('Cancel')} onClick={() => { void cancelRenderJob(job.job_id).catch(() => {}); }}><X size={12}/></button>}</div>
          {running ? <><div className="ed-jobs-bar"><span style={{ width: `${Math.max(3, Math.min(100, job.progress))}%` }}/></div>
              <small>{job.status === 'queued' ? t('Waiting its turn') : job.status === 'cancelling' ? t('Stopping…') : job.phase ? t(job.phase) : `${Math.round(job.progress)}%`}</small></>
            : <small>{failed ? (explainError(job.error ?? '').text || t('Could not finish')) : job.status === 'cancelled' ? t('Cancelled') : t('Done')}</small>}
        </li>;
      })}</ul>
    </div>}
    {notes.length > 0 && <div className="ed-jobs-note" role="status"><b>{t(notes[0].failed ? 'Could not finish' : 'Finished')}</b> {notes[0].text}</div>}
  </div>;
}
