import { useState } from 'react';
import { Check, Film, Music2, ArrowRight } from 'lucide-react';
import Dialog from './Dialog';
import ImportArea from './ImportArea';
import { createProject, photoThumbUrl, type Project } from '../api/client';
import type { Photo } from '../types/photo';
export default function NewProjectDialog({ kind, media, onClose, onCreated, onImported }: { kind: 'edit' | 'lyric'; media: Photo[]; onClose: () => void; onCreated: (project: Project) => void; onImported: (items: Photo[]) => void }) {
  const [name, setName] = useState(kind === 'edit' ? 'Untitled video' : 'Untitled lyric video');
  const [aiStart, setAIStart] = useState(false);
  const [selected, setSelected] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const needsStartingMedia = kind === 'edit' && !selected.length;
  const available = media.filter((item) => (kind === 'lyric' || item.media_type === 'video') && item.filename.toLowerCase().includes(search.toLowerCase()));
  const select = (item: Photo) => {
    setAIStart(false);
    setSelected((previous) => previous.some((entry) => entry.id === item.id) ? previous.filter((entry) => entry.id !== item.id) : kind === 'edit' || item.media_type === 'video' || previous[0]?.media_type === 'video' ? [item] : [...previous, item].slice(0, 50));
  };
  const create = async () => { if (busy || needsStartingMedia || !name.trim()) return; setBusy(true); setError(''); try { onCreated(await createProject(name, kind, aiStart ? [] : selected.map((item) => item.id))); } catch (problem) { setError((problem as Error).message); } finally { setBusy(false); } };
  return <Dialog title={kind === 'edit' ? 'New video project' : 'New lyric video'} onClose={onClose} className="new-project-dialog">
    <div className="dialog-intro"><span className={`round-icon ${kind}`}>{kind === 'edit' ? <Film/> : <Music2/>}</span><p>{kind === 'edit' ? 'Start with a clip. Shape the moment.' : 'Open a blank lyric project, or optionally choose a video or up to 50 images now.'}</p></div>
    <label className="field-label">Project name<input autoComplete="off" maxLength={120} aria-label="Project name" value={name} onChange={(event) => setName(event.target.value)} /></label>
    {kind === 'lyric' && <div className="project-start-options"><button className={`project-start-card ${!aiStart && !selected.length ? 'selected' : ''}`} type="button" aria-pressed={!aiStart && !selected.length} onClick={() => { setAIStart(false); setSelected([]); }}><Music2 size={18}/><span><strong>Blank project</strong><small>Add media inside the editor</small></span>{!aiStart && !selected.length && <Check size={16}/>}</button><button className={`project-start-card ${aiStart ? 'selected' : ''}`} type="button" aria-pressed={aiStart} onClick={() => { setAIStart(true); setSelected([]); }}><span className="project-sparkle">✦</span><span><strong>AI images</strong><small>Generate scenes after adding lyrics</small></span>{aiStart && <Check size={16}/>}</button></div>}
    <div className="project-import"><ImportArea compact videoOnly={kind === 'edit'} onImported={(items) => { setAIStart(false); onImported(items); const valid = items.filter((item) => kind === 'lyric' || item.media_type === 'video'); setSelected(kind === 'edit' || valid[0]?.media_type === 'video' ? valid.slice(0, 1) : valid.filter((item) => item.media_type === 'image').slice(0, 50)); }}/></div>
    <div className="picker-heading"><h3>Your media</h3><input aria-label="Search project media" placeholder="Search files…" value={search} onChange={(event) => setSearch(event.target.value)}/></div>
    <div className="media-picker">{available.map((item) => <button key={item.id} className={selected.some((entry) => entry.id === item.id) ? 'selected' : ''} onClick={() => select(item)} aria-pressed={selected.some((entry) => entry.id === item.id)} aria-label={`Choose ${item.filename}`}><img src={photoThumbUrl(item.id)} alt=""/>{selected.some((entry) => entry.id === item.id) && <span className="check"><Check size={14}/></span>}<span>{item.filename}</span></button>)}{available.length === 0 && <p className="muted">Import {kind === 'edit' ? 'a video' : 'images or a video'} above to get started.</p>}</div>
    {error && <p role="alert" className="studio-error">{error}</p>}
    <footer><span className="muted">{aiStart ? 'AI backgrounds · add lyrics in the editor' : selected.length ? `${selected.length} file${selected.length === 1 ? '' : 's'} selected` : kind === 'lyric' ? 'Blank project · add media in the editor' : 'Choose your starting media'}</span><button className="primary" disabled={busy || needsStartingMedia || !name.trim()} onClick={() => { void create(); }}>{busy ? 'Creating…' : 'Open editor'}<ArrowRight size={17}/></button></footer>
  </Dialog>;
}
