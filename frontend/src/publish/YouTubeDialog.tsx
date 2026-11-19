/**
 * Publish to YouTube: the details come filled in from the project (title, credits, lyrics as captions), so it is one
 * click. First time only: add your Google client file, then Connect YouTube. Details beyond the basics are under More.
 */
import { useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ExternalLink, LoaderCircle, Upload, X } from 'lucide-react';
import { cancelRenderJob, getJobStatus, requestJson } from '../api/client';
import KanaaSelect from '../components/KanaaSelect';
import { t } from '../i18n';
import { duration, type Timeline } from '../timeline/model';
import { EditorContext } from '../editor/state/EditorContext';
import { useEscape } from '../editor/useEscape';
import { connectYouTube, disconnectYouTube, getPlaylists, getYouTube, publishToYouTube, saveYouTubeClient, type PublishResult, type YouTubeStatus } from './youtube-api';
import { youtubeDetails } from './youtube-details';
import './youtube.css';

const PRIVACY = [{ id: 'private', label: 'Private', note: 'Only you' }, { id: 'unlisted', label: 'Unlisted', note: 'Anyone with the link' }, { id: 'public', label: 'Public', note: 'Everyone' }] as const;
const CATEGORIES = [['music', 'Music'], ['film', 'Film & animation'], ['entertainment', 'Entertainment'], ['people', 'People & blogs'], ['education', 'Education'], ['travel', 'Travel & events']] as const;
const SETUP_URL = 'https://console.cloud.google.com/apis/library/youtube.googleapis.com';
type Job = { id: string; progress: number; phase?: string | null; status?: string | null; error?: string | null; result?: PublishResult };

export function YouTubeDialog({ mediaId, projectName, timeline, seconds, onClose }: { mediaId: number; projectName: string; timeline: Timeline; seconds: number; onClose: () => void }) {
  const filled = useMemo(() => youtubeDetails(projectName, timeline, seconds), [projectName, timeline, seconds]);
  const [account, setAccount] = useState<YouTubeStatus | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [title, setTitle] = useState(filled.title), [description, setDescription] = useState(filled.description);
  const [tags, setTags] = useState(filled.tags.join(', '));
  const [privacy, setPrivacy] = useState<'private' | 'unlisted' | 'public'>('private');
  const [captions, setCaptions] = useState(filled.captions.length > 0);
  const [category, setCategory] = useState('music'), [schedule, setSchedule] = useState(''), [kids, setKids] = useState(false);
  const [playlists, setPlaylists] = useState<{ id: string; title: string }[] | null>(null), [playlist, setPlaylist] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const running = Boolean(job && !['done', 'failed', 'cancelled'].includes(job.status ?? ''));
  useEscape(true, () => { if (!running) onClose(); });

  useEffect(() => { getYouTube().then(setAccount).catch((problem) => setError((problem as Error).message)); }, []);
  // After Connect YouTube, the sign-in happens in the browser: look for it until it lands.
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => { void getYouTube().then((found) => { if (found.connected) { setAccount(found); setWaiting(false); } }).catch(() => {}); }, 2000);
    return () => window.clearInterval(timer);
  }, [waiting]);
  useEffect(() => {
    if (!job || !running) return;
    const timer = window.setTimeout(async () => {
      try {
        const found = await getJobStatus(job.id) as unknown as Job & PublishResult & { notes?: string[] };
        setJob({ id: job.id, progress: found.progress, phase: found.phase, status: found.status, error: found.error, result: found });
      } catch (problem) { setError((problem as Error).message); }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [job, running]);

  const chooseClient = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try { setAccount(await saveYouTubeClient(await file.text())); } catch (problem) { setError((problem as Error).message); }
  };
  const connect = async () => {
    setError('');
    try { const { url } = await connectYouTube(); window.open(url, '_blank'); setWaiting(true); } catch (problem) { setError((problem as Error).message); }
  };
  const loadPlaylists = () => { if (playlists === null) { setPlaylists([]); getPlaylists().then(setPlaylists).catch(() => setPlaylists([])); } };
  const publish = async () => {
    setError('');
    const when = schedule ? new Date(schedule) : null;
    if (when && when.getTime() < Date.now() + 15 * 60 * 1000) { setError(t('Pick a publish time at least 15 minutes from now.')); return; }
    try {
      const { job_id } = await publishToYouTube({ media_id: mediaId, title: title.trim() || filled.title, description, category, language: filled.language, privacy: when ? 'private' : privacy,
        publish_at: when ? when.toISOString() : null, made_for_kids: kids, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        captions: captions ? filled.captions : [], playlist_id: playlist || null });
      setJob({ id: job_id, progress: 0, status: 'queued' });
    } catch (problem) { setError((problem as Error).message); }
  };

  const close = <button className="ed-close" aria-label={t('Close')} disabled={running} onClick={onClose}><X size={17}/></button>;
  return <div className="ed-modal" role="dialog" aria-modal="true" aria-label={t('Publish to YouTube')}><div className="ed-card small ed-youtube">
    {close}
    <h2>{t('Publish to YouTube')}</h2>
    {!account && !error && <p className="ed-tip"><LoaderCircle className="spin" size={13}/> {t('Checking YouTube…')}</p>}

    {account && !account.client && <>
      <p>{t('One-time setup: Kanaa uploads through your own Google project, so your channel stays yours.')}</p>
      <ol className="ed-youtube-steps">
        <li>{t('Open Google Cloud and turn on the YouTube Data API v3.')} <a href={SETUP_URL} target="_blank" rel="noreferrer">{t('Open Google Cloud')} <ExternalLink size={11}/></a></li>
        <li>{t('Under OAuth consent screen, choose External and add your own Google account as a test user.')}</li>
        <li>{t('Under Credentials, create an OAuth client of type Desktop app and download its JSON file.')}</li>
      </ol>
      <label className="ed-primary wide ed-youtube-file"><Upload size={15}/>{t('Choose the downloaded file')}<input type="file" accept=".json,application/json" onChange={(event) => { void chooseClient(event.target.files?.[0]); event.target.value = ''; }}/></label>
    </>}

    {account?.client && !account.connected && <>
      <p>{t('Sign in with the Google account that owns your channel. Kanaa keeps the sign-in in this Mac’s Keychain.')}</p>
      <button className="ed-primary wide" onClick={() => { void connect(); }}>{t('Connect YouTube')}</button>
      {waiting && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Finish signing in in your browser…')}</p>}
    </>}

    {account?.connected && !job && <>
      <p className="ed-tip">{t('Publishing to')} <b>{account.channel}</b></p>
      <label className="ed-label">{t('Title')}<input className="ed-youtube-input" value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)}/></label>
      <label className="ed-label">{t('Description')}<textarea rows={4} value={description} maxLength={5000} onChange={(event) => setDescription(event.target.value)}/></label>
      <div className="ed-qualities" role="group" aria-label={t('Who can watch')}>{PRIVACY.map((item) => <button key={item.id} className={privacy === item.id && !schedule ? 'on' : ''} aria-pressed={privacy === item.id && !schedule} onClick={() => { setPrivacy(item.id); setSchedule(''); }}><strong>{t(item.label)}</strong><span>{t(item.note)}</span></button>)}</div>
      {filled.captions.length > 0 && <label className="ed-check"><input type="checkbox" checked={captions} onChange={(event) => setCaptions(event.target.checked)}/><span>{t('Add the lyrics as captions')}<small>{filled.captions.map((track) => track.name).join(' + ')} · {t('timed to the song, helps people find it')}</small></span></label>}
      <details className="ed-youtube-more" onToggle={(event) => { if ((event.target as HTMLDetailsElement).open) loadPlaylists(); }}><summary>{t('More')}</summary>
        <label className="ed-label">{t('Tags')}<input className="ed-youtube-input" value={tags} onChange={(event) => setTags(event.target.value)}/></label>
        <label className="ed-label">{t('Category')}<KanaaSelect aria-label={t('Category')} value={category} onChange={(event) => setCategory(event.target.value)}>{CATEGORIES.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}</KanaaSelect></label>
        <label className="ed-label">{t('Playlist')}<KanaaSelect aria-label={t('Playlist')} value={playlist} onChange={(event) => setPlaylist(event.target.value)}><option value="">{t('None')}</option>{(playlists ?? []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</KanaaSelect></label>
        <label className="ed-label">{t('Schedule (goes public at this time)')}<input className="ed-youtube-input" type="datetime-local" value={schedule} onChange={(event) => setSchedule(event.target.value)}/></label>
        <label className="ed-check"><input type="checkbox" checked={kids} onChange={(event) => setKids(event.target.checked)}/><span>{t('Made for kids')}<small>{t('YouTube requires this answer by law (COPPA).')}</small></span></label>
        <button className="ed-button" onClick={() => { void disconnectYouTube().then(setAccount); }}>{t('Disconnect YouTube')}</button>
      </details>
      <button className="ed-primary wide" onClick={() => { void publish(); }}><Upload size={16}/>{schedule ? t('Schedule on YouTube') : t('Publish')}</button>
    </>}

    {job && running && <><div className="ed-progress"><i style={{ width: `${job.progress}%` }}/></div>
      <p role="status">{job.status === 'queued' ? t('Waiting its turn') : `${t(job.phase || 'Uploading to YouTube')}… ${job.progress}%`}</p>
      <p className="ed-tip">{t('You can close this and keep editing. It continues in Jobs.')}</p>
      <div className="ed-pair"><button className="ed-button" onClick={onClose}>{t('Keep editing')}</button><button className="ed-button" onClick={() => { void cancelRenderJob(job.id); }}>{t('Cancel upload')}</button></div></>}
    {job?.status === 'done' && <>
      <p className="ed-good"><Check size={16}/>{t('It’s on YouTube')}</p>
      {(job.result?.notes ?? []).map((note) => <p key={note} className="ed-tip" role="note">{note}</p>)}
      <div className="ed-pair">
        <a className="ed-button" href={job.result?.youtube_url} target="_blank" rel="noreferrer">{t('Watch')} <ExternalLink size={12}/></a>
        <a className="ed-button" href={job.result?.studio_url} target="_blank" rel="noreferrer">{t('Open in YouTube Studio')} <ExternalLink size={12}/></a>
      </div>
    </>}
    {job?.status === 'failed' && <><p role="alert" className="ed-bad">{job.error}</p><button className="ed-button wide" onClick={() => setJob(null)}>{t('Back')}</button></>}
    {job?.status === 'cancelled' && <><p>{t('Upload cancelled.')}</p><button className="ed-button wide" onClick={() => setJob(null)}>{t('Back')}</button></>}
    {error && <p role="alert" className="ed-bad">{error}</p>}
  </div></div>;
}

const OPEN = 'kanaa:youtube';
/** Publishes a video from the library (an earlier export), with this project's details filled in. */
export function openYouTube(mediaId: number) { window.dispatchEvent(new CustomEvent(OPEN, { detail: mediaId })); }

export function YouTubeHost() {
  const store = useContext(EditorContext);
  const [mediaId, setMediaId] = useState<number | null>(null);
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      setName(null); setMediaId((event as CustomEvent<number>).detail);
      if (store) requestJson<{ name: string }>(`/api/projects/${store.projectId}`).then((project) => setName(project.name)).catch(() => setName(''));
    };
    window.addEventListener(OPEN, open);
    return () => window.removeEventListener(OPEN, open);
  }, []);
  if (mediaId === null || name === null || !store?.timeline) return null;
  // Inside the editor's own layer, so it sits over the editor like Export does.
  return createPortal(<YouTubeDialog mediaId={mediaId} projectName={name} timeline={store.timeline} seconds={duration(store.timeline)} onClose={() => setMediaId(null)}/>, document.querySelector('.ed') ?? document.body);
}
