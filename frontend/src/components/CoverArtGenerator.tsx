import { useState } from 'react';
import { ImagePlus, LoaderCircle, Sparkles, X } from 'lucide-react';
import { generateImageScenes, getAISettings, getImageScenes, getJobStatus, getPhoto, planImageScenes } from '../api/client';
import type { Photo } from '../types/photo';
import KanaaSelect from './KanaaSelect';

const styles = ['cinematic', 'photographic', 'illustration', 'watercolor', 'dreamlike'] as const;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function AIImageGenerator({ projectId, canvas, onClose, onCreated }: { projectId: number; canvas: 'portrait' | 'square' | 'landscape'; onClose: () => void; onCreated: (photo: Photo) => void }) {
  const [brief, setBrief] = useState('');
  const [use, setUse] = useState<'general' | 'background' | 'thumbnail' | 'poster'>('general');
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
      const direction = use === 'general' ? brief : `${{ background: 'Create this as a clean video background with room for overlays.', thumbnail: 'Create this as a bold, instantly readable thumbnail composition.', poster: 'Create this as a polished poster composition with intentional negative space.' }[use]} ${brief}`;
      const batch = await planImageScenes(projectId, { lyrics: 'Standalone image', cues: [], count: 1, style, brief: direction, canvas, purpose: 'image' });
      const scene = batch.scenes[0];
      const started = await generateImageScenes(projectId, batch.id, [{ id: scene.id, prompt: scene.prompt }], quality);
      for (;;) {
        const job = await getJobStatus(started.job_id);
        if (job.done) { if (job.error) throw new Error(job.error); break; }
        await wait(800);
      }
      const finished = await getImageScenes(projectId);
      const mediaId = finished.batch?.scenes[0]?.media_id;
      if (!mediaId) throw new Error('The provider did not return an image.');
      onCreated(await getPhoto(mediaId)); onClose();
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="ed-modal" role="dialog" aria-modal="true" aria-label="Create image with AI"><div className="ed-card small">
    <button className="ed-close" aria-label="Close AI image creator" onClick={onClose}><X size={17}/></button><h2>Create image with AI</h2>
    <p className="ed-tip">Generate any image from an English visual prompt. It is saved in Media, separate from the timeline, so you decide how to use it.</p>
    <label className="ed-label">Image use<KanaaSelect aria-label="Image use" value={use} onChange={(event) => setUse(event.target.value as typeof use)}><option value="general">General image</option><option value="background">Video background</option><option value="thumbnail">Thumbnail</option><option value="poster">Poster or opening card</option></KanaaSelect></label>
    <label className="ed-label">English visual prompt<textarea className="ed-text" rows={4} maxLength={1500} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="A singer on a moonlit Chennai rooftop, cinematic blue and gold lighting"/></label>
    <div className="ed-pair"><label className="ed-label">Style<KanaaSelect aria-label="Image style" value={style} onChange={(event) => setStyle(event.target.value as typeof style)}>{styles.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</KanaaSelect></label><label className="ed-label">Quality<KanaaSelect aria-label="Image quality" value={quality} onChange={(event) => setQuality(event.target.value as typeof quality)}><option value="low">Draft</option><option value="medium">Balanced</option><option value="high">High</option></KanaaSelect></label></div>
    {error && <p className="ed-bad" role="alert">{error}</p>}<button className="ed-primary wide" disabled={busy || !brief.trim()} onClick={() => { void generate(); }}>{busy ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>} {busy ? 'Creating image…' : 'Create image'}</button>
    <p className="ed-tip"><ImagePlus size={13}/> Uses one image-generation request and your provider credits.</p>
  </div></div>;
}
