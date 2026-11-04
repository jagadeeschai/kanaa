import { useState } from 'react';
import { ImagePlus, LoaderCircle, Sparkles, X } from 'lucide-react';
import { generateImageScenes, getAISettings, getImageScenes, getJobStatus, getPhoto, planImageScenes } from '../api/client';
import type { Photo } from '../types/photo';

const styles = ['cinematic', 'photographic', 'illustration', 'watercolor', 'dreamlike'] as const;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function CoverArtGenerator({ projectId, canvas, onClose, onCreated }: { projectId: number; canvas: 'portrait' | 'square' | 'landscape'; onClose: () => void; onCreated: (photo: Photo) => void }) {
  const [brief, setBrief] = useState('');
  const [style, setStyle] = useState<(typeof styles)[number]>('cinematic');
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generate = async () => {
    if (busy || !brief.trim()) return;
    setBusy(true); setError('');
    try {
      const config = await getAISettings();
      if (!config.configured) throw new Error('Add an image API key in Kanaa settings first.');
      const batch = await planImageScenes(projectId, { lyrics: 'Cover art', cues: [], count: 1, style, brief, canvas, purpose: 'cover' });
      const scene = batch.scenes[0];
      const started = await generateImageScenes(projectId, batch.id, [{ id: scene.id, prompt: scene.prompt }], quality);
      for (;;) {
        const job = await getJobStatus(started.job_id);
        if (job.done) { if (job.error) throw new Error(job.error); break; }
        await wait(800);
      }
      const finished = await getImageScenes(projectId);
      const mediaId = finished.batch?.scenes[0]?.media_id;
      if (!mediaId) throw new Error('The provider did not return cover art.');
      onCreated(await getPhoto(mediaId)); onClose();
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="ed-modal" role="dialog" aria-modal="true" aria-label="Create AI cover art"><div className="ed-card small">
    <button className="ed-close" aria-label="Close AI cover art" onClick={onClose}><X size={17}/></button><h2>Create AI cover art</h2>
    <p className="ed-tip">Write the visual prompt in English. The generated image is saved in Media and can be added as an opening card, background, or thumbnail.</p>
    <label className="ed-label">English visual prompt<textarea className="ed-text" rows={4} maxLength={1500} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="The same singer on a moonlit Chennai rooftop, cinematic blue and gold lighting, space for a title"/></label>
    <div className="ed-pair"><label className="ed-label">Style<select value={style} onChange={(event) => setStyle(event.target.value as typeof style)}>{styles.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></label><label className="ed-label">Quality<select value={quality} onChange={(event) => setQuality(event.target.value as typeof quality)}><option value="low">Draft</option><option value="medium">Balanced</option><option value="high">High</option></select></label></div>
    {error && <p className="ed-bad" role="alert">{error}</p>}<button className="ed-primary wide" disabled={busy || !brief.trim()} onClick={() => { void generate(); }}>{busy ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>} {busy ? 'Creating cover art…' : 'Create cover art'}</button>
    <p className="ed-tip"><ImagePlus size={13}/> Uses one image-generation request and your provider credits.</p>
  </div></div>;
}
