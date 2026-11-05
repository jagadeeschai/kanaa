import { useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { createMediaFolder, deleteMedia, deleteMediaFolder, moveMediaToFolder, renameMediaFolder, setMediaFolder, type MediaFolderSummary } from '../api/client';
import type { Photo } from '../types/photo';
import Dialog from './Dialog';
import KanaaSelect from './KanaaSelect';

export const folderNames = (media: Photo[]) => [...new Set(media.flatMap((item) => item.folder ?? []))].sort((a, b) => a.localeCompare(b));

export function FolderDialog({ item, folders, onClose, onSaved }: { item: Photo; folders: MediaFolderSummary[] | string[]; onClose: () => void; onSaved: (folder: string | null) => void }) {
  const [name, setName] = useState('');
  const [destination, setDestination] = useState(item.folder ?? '');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const destinations: MediaFolderSummary[] = folders.map((folder) => typeof folder === 'string' ? { name: folder, count: 0 } : folder);
  const save = async (folder: string) => {
    if (busy) return; setBusy(true); setError('');
    try { const result = await setMediaFolder(item.id, folder.trim() || null); onSaved(result.folder); onClose(); } catch (problem) { setError((problem as Error).message); setBusy(false); }
  };
  return <Dialog title="Move to folder" onClose={onClose}>
    <p className="dialog-description">{item.filename}</p>
    <label className="field-label folder-picker-label">Choose destination<KanaaSelect aria-label="Destination folder" searchable searchPlaceholder="Search folders" value={destination} disabled={busy} onChange={(event) => setDestination(event.target.value)}><option value="">Unfiled</option>{destinations.map((folder) => <option key={folder.name} value={folder.name}>{folder.name}{folder.count > 0 ? ` · ${folder.count}` : ''}</option>)}</KanaaSelect></label>
    {!creating ? <button className="new-folder-row" onClick={() => setCreating(true)}><FolderPlus size={17}/>Create a new folder</button> : <label className="field-label folder-name-field">New folder name<input aria-label="Folder name" autoFocus value={name} maxLength={60} placeholder="For example, Parade" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) void save(name); }}/></label>}
    {error && <p role="alert" className="studio-error">{error}</p>}
    <footer><button className="secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy || (creating ? !name.trim() : destination === (item.folder ?? ''))} onClick={() => { void save(creating ? name : destination); }}>{creating ? 'Create and move' : 'Move'}</button></footer>
  </Dialog>;
}

export function ManageFolderDialog({ folder, onClose, onChanged }: { folder: MediaFolderSummary; onClose: () => void; onChanged: (next: string | null) => void }) {
  const [name, setName] = useState(folder.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rename = async () => { if (busy || !name.trim()) return; setBusy(true); try { const result = await renameMediaFolder(folder.name, name.trim()); onChanged(result.name); onClose(); } catch (problem) { setError((problem as Error).message); setBusy(false); } };
  const remove = async () => { if (busy) return; setBusy(true); try { await deleteMediaFolder(folder.name); onChanged(null); onClose(); } catch (problem) { setError((problem as Error).message); setBusy(false); } };
  return <Dialog title="Manage folder" onClose={onClose}><p className="dialog-description">{folder.count} item{folder.count === 1 ? '' : 's'} in this folder</p><label className="field-label">Folder name<input aria-label="Folder name" autoFocus value={name} maxLength={60} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void rename(); }}/></label>{error && <p role="alert" className="studio-error">{error}</p>}<footer><button className="secondary" disabled={busy} onClick={() => { void remove(); }}>Remove folder</button><button className="primary" disabled={busy || !name.trim() || name.trim() === folder.name} onClick={() => { void rename(); }}>Rename</button></footer><p className="folder-remove-note">Removing a folder keeps its media and moves those items to Unfiled.</p></Dialog>;
}

export function CreateFolderDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const create = async () => { if (busy || !name.trim()) return; setBusy(true); try { const result = await createMediaFolder(name.trim()); onCreated(result.name); onClose(); } catch (problem) { setError((problem as Error).message); setBusy(false); } };
  return <Dialog title="New media folder" onClose={onClose}><p className="dialog-description">Create a folder now, then move media into it whenever you need.</p><label className="field-label">Folder name<input aria-label="Folder name" autoFocus value={name} maxLength={60} placeholder="For example, Client interviews" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void create(); }}/></label>{error && <p role="alert" className="studio-error">{error}</p>}<footer><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !name.trim()} onClick={() => { void create(); }}>Create folder</button></footer></Dialog>;
}

export function BulkFolderDialog({ ids, folders, onClose, onSaved }: { ids: number[]; folders: MediaFolderSummary[]; onClose: () => void; onSaved: (folder: string | null) => void }) {
  const [name, setName] = useState(''); const [destination, setDestination] = useState(''); const [creating, setCreating] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const move = async (folder: string | null) => { if (busy) return; setBusy(true); try { const result = await moveMediaToFolder(ids, folder); onSaved(result.folder); onClose(); } catch (problem) { setError((problem as Error).message); setBusy(false); } };
  return <Dialog title={`Move ${ids.length} items`} onClose={onClose}><label className="field-label folder-picker-label">Choose destination<KanaaSelect aria-label="Destination folder" searchable searchPlaceholder="Search folders" value={destination} disabled={busy} onChange={(event) => setDestination(event.target.value)}><option value="">Unfiled</option>{folders.map((folder) => <option key={folder.name} value={folder.name}>{folder.name} · {folder.count}</option>)}</KanaaSelect></label>{!creating ? <button className="new-folder-row" onClick={() => setCreating(true)}><FolderPlus size={17}/>Create a new folder</button> : <label className="field-label folder-name-field">New folder name<input aria-label="Folder name" autoFocus value={name} maxLength={60} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) void move(name.trim()); }}/></label>}{error && <p role="alert" className="studio-error">{error}</p>}<footer><button className="secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy || (creating ? !name.trim() : false)} onClick={() => { void move(creating ? name.trim() : destination || null); }}>{creating ? 'Create and move' : 'Move'}</button></footer></Dialog>;
}

export function DeleteMediaDialog({ item, onClose, onDeleted }: { item: Photo; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try { await deleteMedia(item.id); onDeleted(); onClose(); } catch (problem) { setError((problem as Error).message); setBusy(false); }
  };
  return <Dialog title="Delete from Kanaa?" onClose={onClose}>
    <p className="dialog-description">“{item.filename}” will be permanently removed from Kanaa. This can't be undone. The original file you imported from stays where it is.</p>
    {error && <p role="alert" className="studio-error">{error}</p>}
    <footer><button className="secondary" onClick={onClose}>Cancel</button><button className="danger" disabled={busy || Boolean(error)} onClick={() => { void remove(); }}>Delete</button></footer>
  </Dialog>;
}
