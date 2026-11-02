import { useState } from 'react';
import { deleteMedia, setMediaFolder } from '../api/client';
import type { Photo } from '../types/photo';
import Dialog from './Dialog';

export const folderNames = (media: Photo[]) => [...new Set(media.flatMap((item) => item.folder ?? []))].sort((a, b) => a.localeCompare(b));

export function FolderDialog({ item, folders, onClose, onSaved }: { item: Photo; folders: string[]; onClose: () => void; onSaved: (folder: string | null) => void }) {
  const [name, setName] = useState(item.folder ?? '');
  const [error, setError] = useState('');
  const save = async (folder: string) => {
    try { const result = await setMediaFolder(item.id, folder.trim() || null); onSaved(result.folder); onClose(); } catch (problem) { setError((problem as Error).message); }
  };
  return <Dialog title="Move to folder" onClose={onClose}>
    <p className="dialog-description">{item.filename}</p>
    {folders.length > 0 && <div className="folder-chips">{folders.map((folder) => <button key={folder} className={folder === item.folder ? 'on' : ''} onClick={() => { void save(folder); }}>{folder}</button>)}</div>}
    <label className="field-label">Or a new folder<input aria-label="Folder name" autoFocus value={name} maxLength={60} placeholder="For example, Parade" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void save(name); }}/></label>
    {error && <p role="alert" className="studio-error">{error}</p>}
    <footer>{item.folder ? <button className="secondary" onClick={() => { void save(''); }}>Take out of folder</button> : <span/>}<button className="primary" disabled={!name.trim()} onClick={() => { void save(name); }}>Save</button></footer>
  </Dialog>;
}

export function DeleteMediaDialog({ item, onClose, onDeleted }: { item: Photo; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try { await deleteMedia(item.id); onDeleted(); onClose(); } catch (problem) { setError((problem as Error).message); setBusy(false); }
  };
  return <Dialog title="Delete from Motion?" onClose={onClose}>
    <p className="dialog-description">“{item.filename}” will be permanently removed from Motion. This can't be undone. The original file you imported from stays where it is.</p>
    {error && <p role="alert" className="studio-error">{error}</p>}
    <footer><button className="secondary" onClick={onClose}>Cancel</button><button className="danger" disabled={busy || Boolean(error)} onClick={() => { void remove(); }}>Delete</button></footer>
  </Dialog>;
}
