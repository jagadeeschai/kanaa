import { useState } from 'react';
import { Check, Film, FolderOpen, Music2, ArrowRight } from 'lucide-react';
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
  const needsStartingMedia = false;
  const usable = (item: Photo) => item.media_type === 'video' || item.media_type === 'image';
  const available = media.filter((item) => usable(item) && item.filename.toLowerCase().includes(search.toLowerCase()));
  // A video project can start from a whole folder: its videos and photos in name order.
  const byName = (a: Photo, b: Photo) => a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' });
  const folders = kind === 'edit' ? [...new Set(media.filter(usable).map((item) => item.folder).filter((folder): folder is string => Boolean(folder)))].sort() : [];
  const inFolder = (folder: string) => media.filter((item) => usable(item) && item.folder === folder).sort(byName);
  const order = (item: Photo) => selected.findIndex((entry) => entry.id === item.id) + 1;
  const select = (item: Photo) => {
    setAIStart(false);
    setSelected((previous) => previous.some((entry) => entry.id === item.id) ? previous.filter((entry) => entry.id !== item.id)
      : kind === 'edit' ? [...previous, item].slice(0, 200)
      : item.media_type === 'video' || previous[0]?.media_type === 'video' ? [item] : [...previous, item].slice(0, 50));
  };
  const create = async () => { if (busy || needsStartingMedia || !name.trim()) return; setBusy(true); setError(''); try { onCreated(await createProject(name, kind, aiStart ? [] : selected.map((item) => item.id))); } catch (problem) { setError((problem as Error).message); } finally { setBusy(false); } };
  return <Dialog title={kind === 'edit' ? 'New video project' : 'New lyric video'} onClose={onClose} className="new-project-dialog">
    <div className="dialog-intro"><span className={`round-icon ${kind}`}>{kind === 'edit' ? <Film/> : <Music2/>}</span><p>{kind === 'edit' ? 'Start blank, or pick videos and photos in the order you want them, or use a whole folder. You can add more inside.' : 'Open a blank lyric project, or optionally choose a video or up to 50 images now.'}</p></div>
    <label className="field-label">Project name<input autoComplete="off" maxLength={120} aria-label="Project name" value={name} onChange={(event) => setName(event.target.value)} /></label>
    {kind === 'lyric' && <div className="project-start-options"><button className={`project-start-card ${!aiStart && !selected.length ? 'selected' : ''}`} type="button" aria-pressed={!aiStart && !selected.length} onClick={() => { setAIStart(false); setSelected([]); }}><Music2 size={18}/><span><strong>Blank project</strong><small>Add media inside the editor</small></span>{!aiStart && !selected.length && <Check size={16}/>}</button><button className={`project-start-card ${aiStart ? 'selected' : ''}`} type="button" aria-pressed={aiStart} onClick={() => { setAIStart(true); setSelected([]); }}><span className="project-sparkle">✦</span><span><strong>AI images</strong><small>Generate scenes after adding lyrics</small></span>{aiStart && <Check size={16}/>}</button></div>}
    {kind === 'edit' && <div className="project-start-options"><button className={`project-start-card ${!selected.length ? 'selected' : ''}`} type="button" aria-pressed={!selected.length} onClick={() => setSelected([])}><Film size={18}/><span><strong>Blank project</strong><small>Add clips inside the editor</small></span>{!selected.length && <Check size={16}/>}</button>
      <div className="project-start-card static"><span className="project-step">{selected.length || '1+'}</span><span><strong>Pick clips below</strong><small>Click them in the order they should play</small></span></div></div>}
    {folders.length > 0 && <div className="project-folders" role="group" aria-label="Start from a folder"><span><FolderOpen size={14}/>Use a folder</span>{folders.map((folder) => { const items = inFolder(folder); const on = selected.length === items.length && items.every((item, index) => selected[index]?.id === item.id); return <button key={folder} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => setSelected(items.slice(0, 200))}>{folder} <em>{items.length}</em></button>; })}</div>}
    <div className="project-import"><ImportArea compact videoOnly={false} onImported={(items) => { setAIStart(false); onImported(items); const valid = items.filter(usable); if (kind === 'edit') { setSelected((previous) => [...previous, ...valid.filter((item) => !previous.some((entry) => entry.id === item.id))].slice(0, 200)); return; } setSelected(valid[0]?.media_type === 'video' ? valid.slice(0, 1) : valid.filter((item) => item.media_type === 'image').slice(0, 50)); }}/></div>
    <div className="picker-heading"><h3>Your media</h3><input aria-label="Search project media" placeholder="Search files…" value={search} onChange={(event) => setSearch(event.target.value)}/></div>
    <div className="media-picker">{available.map((item) => <button key={item.id} className={selected.some((entry) => entry.id === item.id) ? 'selected' : ''} onClick={() => select(item)} aria-pressed={selected.some((entry) => entry.id === item.id)} aria-label={`Choose ${item.filename}`}><img src={photoThumbUrl(item.id)} alt=""/>{selected.some((entry) => entry.id === item.id) && (kind === 'edit' ? <span className="check order">{order(item)}</span> : <span className="check"><Check size={14}/></span>)}<span>{item.filename}</span></button>)}{available.length === 0 && <p className="muted">Import {kind === 'edit' ? 'videos or photos' : 'images or a video'} above, or start blank.</p>}</div>
    {error && <p role="alert" className="studio-error">{error}</p>}
    <footer><span className="muted">{aiStart ? 'AI backgrounds · add lyrics in the editor' : selected.length ? (kind === 'edit' ? `${selected.length} ${selected.length === 1 ? 'clip' : 'clips'}, in the numbered order` : `${selected.length} file${selected.length === 1 ? '' : 's'} selected`) : kind === 'lyric' ? 'Blank project · add media in the editor' : 'Blank project · add clips in the editor'}</span><button className="primary" disabled={busy || needsStartingMedia || !name.trim()} onClick={() => { void create(); }}>{busy ? 'Creating…' : 'Open editor'}<ArrowRight size={17}/></button></footer>
  </Dialog>;
}
