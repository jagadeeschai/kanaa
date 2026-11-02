import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ImagePlus, LoaderCircle, Sparkles } from 'lucide-react';
import { cancelRenderJob, saveImageScenePrompts, generateImageScenes, getAISettings, getImageScenes, getPhoto, photoThumbUrl, planImageScenes, type AISettings, type ImageBatch } from '../api/client';
import type { Photo } from '../types/photo';
import type { LyricCue } from '../utils/lyrics';
import AISettingsFields from './AISettingsFields';

const sceneWrites = new Map<number, Promise<unknown>>();

const control = 'theme-control w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100';
const button = 'theme-control rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 disabled:opacity-40';
export default function LyricImageGenerator({ projectId, lyrics, cues, canvas, disabled, onUse, initiallyOpen = false }: {
  initiallyOpen?: boolean; projectId: number; lyrics: string; cues: LyricCue[]; canvas: 'portrait' | 'square' | 'landscape'; disabled: boolean;
  onUse: (images: Photo[], starts: number[] | null) => void;
}) {
  const [batch, setBatch] = useState<ImageBatch | null>(null);
  const [prompts, setPrompts] = useState<Record<number, string>>({});
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [config, setConfig] = useState<AISettings | null>(null);
  const [expanded, setExpanded] = useState(initiallyOpen);
  const [count, setCount] = useState(4);
  const [style, setStyle] = useState('cinematic');
  const [brief, setBrief] = useState('');
  const [quality, setQuality] = useState('medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  const drafts = useRef<{ batchId: string; scenes: { id: number; prompt: string }[] } | null>(null);
  const savedDraft = useRef('');
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const draft = batch && !batch.active ? { batchId: batch.id, scenes: batch.scenes.filter((scene) => scene.status !== 'done').map((scene) => ({ id: scene.id, prompt: prompts[scene.id] ?? scene.prompt })) } : null;
  drafts.current = draft;
  const saveDraft = () => {
    const value = drafts.current;
    if (!value?.scenes.length || value.scenes.some((scene) => !scene.prompt.trim())) return writes.current;
    const serialized = JSON.stringify(value);
    if (serialized === savedDraft.current) return writes.current;
    savedDraft.current = serialized;
    writes.current = (sceneWrites.get(projectId) ?? writes.current).catch(() => {}).then(() => saveImageScenePrompts(projectId, value.batchId, value.scenes)).catch((problem) => { savedDraft.current = ''; if (mounted.current) setError(`Could not save scene prompts: ${problem.message}`); });
    const pending = writes.current; sceneWrites.set(projectId, pending);
    void pending.finally(() => { if (sceneWrites.get(projectId) === pending) sceneWrites.delete(projectId); }).catch(() => {});
    return writes.current;
  };
  const saveDraftRef = useRef(saveDraft); saveDraftRef.current = saveDraft;
  const draftKey = JSON.stringify(draft);
  useEffect(() => { const timer = setTimeout(() => { if (!lock.current) void saveDraftRef.current(); }, 650); return () => clearTimeout(timer); }, [draftKey]);
  useEffect(() => () => { if (!lock.current) void saveDraftRef.current(); }, []);

  useEffect(() => {
    mounted.current = true; let cancelled = false;
    void (sceneWrites.get(projectId) ?? Promise.resolve()).catch(() => {}).then(() => Promise.allSettled([getAISettings(), getImageScenes(projectId)])).then(([settingsResult, batchResult]) => {
      if (cancelled) return;
      if (settingsResult.status === 'fulfilled') setConfig(settingsResult.value);
      else setError('Could not load AI settings. Reopen this project to retry.');
      if (batchResult.status === 'fulfilled' && batchResult.value.batch) {
        const saved = batchResult.value.batch; setBatch(saved); setPrompts(Object.fromEntries(saved.scenes.map((scene) => [scene.id, scene.prompt]))); setCount(saved.scenes.length); setStyle(saved.style); setBrief(saved.brief); setExpanded(true);
      } else if (batchResult.status === 'rejected') setError('Could not load saved scene prompts. Reopen this project to retry.');
    });
    return () => { cancelled = true; mounted.current = false; };
  }, [projectId]);
  useEffect(() => {
    if (!batch?.active) return;
    let cancelled = false;
    const poll = async () => { try { const result = await getImageScenes(projectId); if (!cancelled && result.batch?.id === batch.id) { setBatch(result.batch); setError(''); } } catch (problem) { if (!cancelled) setError((problem as Error).message); } };
    const timer = setInterval(() => { void poll(); }, 1200); return () => { cancelled = true; clearInterval(timer); };
  }, [batch?.id, batch?.active, projectId]);
  const plan = async () => {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { const next = await planImageScenes(projectId, { lyrics, cues: cues.map(({ text, start, end }) => ({ text, start, end })), count, style, brief, canvas }); if (!mounted.current) return; setBatch(next); setPrompts(Object.fromEntries(next.scenes.map((scene) => [scene.id, scene.prompt]))); setExcluded(new Set()); }
    catch (problem) { if (mounted.current) setError((problem as Error).message); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const unfinished = batch?.scenes.filter((scene) => scene.status !== 'done') ?? [];
  const generated = batch?.scenes.filter((scene) => scene.status === 'done' && scene.media_id) ?? [];
  const chosen = generated.filter((scene) => !excluded.has(scene.id));
  const generate = async () => {
    if (lock.current || !batch || disabled) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await writes.current.catch(() => {}); await generateImageScenes(projectId, batch.id, unfinished.map((scene) => ({ id: scene.id, prompt: prompts[scene.id] ?? scene.prompt })), quality); const result = await getImageScenes(projectId); if (mounted.current) setBatch(result.batch); }
    catch (problem) { if (mounted.current) setError((problem as Error).message); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const useImages = async () => {
    if (lock.current || !chosen.length) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const images = await Promise.all(chosen.map((scene) => getPhoto(scene.media_id!)));
      if (!mounted.current) return;
      const starts = batch?.lyrics === lyrics && chosen.every((scene) => scene.start !== null) ? chosen.map((scene, index) => index === 0 ? 0 : scene.start!) : null;
      onUse(images, starts); setNotice(`Added ${images.length} generated image${images.length === 1 ? '' : 's'} to the slideshow.`);
    } catch (problem) { if (mounted.current) setError((problem as Error).message); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const working = busy || Boolean(batch?.active);
  return <details className="ai-scene-builder" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}><summary><span><Sparkles size={17}/>Create images from lyrics</span>{generated.length > 0 && <small>{generated.length} ready</small>}</summary><div className="ai-scene-body">
    <p className="text-xs text-slate-400">Give each part of your song its own scene. Review the prompts, generate images, then choose which ones to use.</p>
    <fieldset disabled={working || disabled} className="space-y-3">
      <div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-400">Visual style<select aria-label="AI image style" className={`${control} mt-1`} value={style} onChange={(event) => setStyle(event.target.value)}><option value="cinematic">Cinematic</option><option value="photographic">Photography</option><option value="watercolor">Watercolor</option><option value="illustration">Illustration</option><option value="dreamlike">Dreamlike</option></select></label><label className="text-xs text-slate-400">Scenes<input aria-label="Number of AI scenes" className={`${control} mt-1`} type="number" min={1} max={8} value={count} onChange={(event) => setCount(Math.min(8, Math.max(1, Number(event.target.value) || 1)))}/></label></div>
      <label className="block text-xs text-slate-400">Shared creative direction<textarea aria-label="AI image creative direction" rows={2} maxLength={1500} placeholder="e.g. A quiet coastal village, warm dawn colors, a hopeful mood" className={`${control} mt-1`} value={brief} onChange={(event) => setBrief(event.target.value)}/></label>
      <button type="button" className={button} disabled={!lyrics.trim()} onClick={() => { void plan(); }}>{busy ? 'Working…' : batch ? 'Build a new scene plan' : 'Build scene prompts'}</button>
      {!lyrics.trim() && <p className="text-xs text-slate-400">Paste your lyrics below to build the scenes.</p>}
    </fieldset>
    {batch && <div className="ai-scenes"><p className="text-xs text-slate-400">{batch.scenes.length} scenes · {batch.canvas} · {batch.style}. Prompts include the lyrics to guide the image model. Prompt edits autosave.</p>{batch.lyrics !== lyrics && <p className="ai-note">These scenes use an earlier version of your lyrics. Build a new plan to update them.</p>}
      {batch.scenes.map((scene) => <article className="ai-scene" key={scene.id}><div className="ai-scene-title"><strong>Scene {scene.position + 1}</strong><span>{scene.status === 'running' ? <><LoaderCircle size={12} className="spin"/>Generating…</> : scene.status === 'done' ? <><CheckCircle2 size={12}/>Ready</> : scene.status}</span></div><p className="ai-scene-lyric">{scene.lyric}</p>
        {scene.media_id ? <><img src={photoThumbUrl(scene.media_id)} alt={`Generated scene ${scene.position + 1}`}/><label className="ai-scene-checkbox"><input type="checkbox" aria-label={`Use AI scene ${scene.position + 1}`} checked={!excluded.has(scene.id)} disabled={working || disabled} onChange={() => setExcluded((previous) => { const next = new Set(previous); if (next.has(scene.id)) next.delete(scene.id); else next.add(scene.id); return next; })}/>Use this image</label></> : <label className="block text-xs text-slate-400">Visual prompt<textarea aria-label={`AI scene ${scene.position + 1} prompt`} rows={3} className={`${control} mt-1`} maxLength={12000} value={prompts[scene.id] ?? scene.prompt} disabled={working || disabled} onChange={(event) => setPrompts((previous) => ({ ...previous, [scene.id]: event.target.value }))}/></label>}
        {scene.error && <p className="ai-scene-error">{scene.error}</p>}
      </article>)}
      {unfinished.length > 0 && <><label className="block text-xs text-slate-400">Generation quality<select aria-label="AI generation quality" value={quality} disabled={working || disabled} onChange={(event) => setQuality(event.target.value)} className={`${control} mt-1`}><option value="low">Draft</option><option value="medium">Balanced</option><option value="high">High</option></select></label><button type="button" className="primary small ai-generate" disabled={working || disabled || !config?.configured || unfinished.some((scene) => !(prompts[scene.id] ?? scene.prompt).trim())} onClick={() => { void generate(); }}><Sparkles size={15}/>{batch.active ? 'Generating images…' : generated.length ? `Retry ${unfinished.length} unfinished scene${unfinished.length === 1 ? '' : 's'}` : `Generate ${unfinished.length} image${unfinished.length === 1 ? '' : 's'}`}</button><p className="text-xs text-slate-400">Uses your provider’s API credits. Lyrics and prompts are sent to {config?.base_url === 'https://api.openai.com/v1' ? 'OpenAI' : 'your configured provider'}. No automatic paid retries.</p></>}
      {batch.active && <><p className="text-xs text-slate-400">You can leave the editor; completed images stay in Media. A submitted request may still be charged when stopped.</p><button type="button" className={button} disabled={busy || disabled} onClick={() => { void cancelRenderJob(batch.job_id!).then(() => getImageScenes(projectId)).then((result) => { if (mounted.current) setBatch(result.batch); }).catch((problem) => setError(problem.message)); }}>Stop generation</button></>}
      {generated.length > 0 && <><button type="button" className="secondary small ai-generate" disabled={working || disabled || !chosen.length} onClick={() => { void useImages(); }}><ImagePlus size={16}/>Use {chosen.length} generated image{chosen.length === 1 ? '' : 's'}</button><p className="text-xs text-slate-400">Replaces the current backgrounds. All generated images stay in Media.</p></>}
    </div>}
    <details className="ai-connection" open={config !== null && !config.configured}><summary>AI connection {config?.configured ? '· key configured' : '· add an API key'}</summary><AISettingsFields onSaved={setConfig}/></details>
    {error && <p role="alert" className="studio-error">{error}</p>}{notice && <p role="status" className="ai-note">{notice}</p>}
  </div></details>;
}
