import { useState } from 'react';
import { Folder, FolderOpen, Inbox, MoreHorizontal, Plus, Search } from 'lucide-react';
import type { MediaFolderIndex, MediaFolderSummary } from '../api/client';

export const UNFILED = '__unfiled__';

export default function MediaFolderSidebar({ index, active, onSelect, onNew, onManage }: {
  index: MediaFolderIndex; active: string | null; onSelect: (folder: string | null) => void; onNew: () => void; onManage: (folder: MediaFolderSummary) => void;
}) {
  const [query, setQuery] = useState('');
  const folders = index.folders.filter((folder) => folder.name.toLowerCase().includes(query.toLowerCase()));
  return <aside className="media-folders" aria-label="Media folders">
    <div className="media-folders-title"><strong>Library</strong><button aria-label="New folder" title="New folder" onClick={onNew}><Plus size={15}/></button></div>
    <nav>
      <button className={active === null ? 'on' : ''} onClick={() => onSelect(null)}><FolderOpen size={16}/><span>All media</span><b>{index.total}</b></button>
      <button className={active === UNFILED ? 'on' : ''} onClick={() => onSelect(UNFILED)}><Inbox size={16}/><span>Unfiled</span><b>{index.unfiled}</b></button>
    </nav>
    {index.folders.length > 8 && <label className="media-folder-search"><Search size={14}/><input aria-label="Search folders" placeholder="Find folder" value={query} onChange={(event) => setQuery(event.target.value)}/></label>}
    <div className="media-folder-list">
      {folders.map((folder) => <div className={active === folder.name ? 'on' : ''} key={folder.name}><button className="media-folder-open" onClick={() => onSelect(folder.name)}><Folder size={16}/><span title={folder.name}>{folder.name}</span><b>{folder.count}</b></button><button className="media-folder-more" aria-label={`Manage ${folder.name}`} title="Rename or remove folder" onClick={() => onManage(folder)}><MoreHorizontal size={15}/></button></div>)}
      {!folders.length && query && <p>No matching folders</p>}
    </div>
  </aside>;
}
