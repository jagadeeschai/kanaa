import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRight, CheckCircle2, Clapperboard, Copy, Film, FolderOpen, HardDrive, Image as ImageIcon, LayoutDashboard, LoaderCircle, Monitor, Moon, MoreHorizontal, Music2, Pencil, Play, Plus, Search, Sparkles, Settings2, Smartphone, Sun, Trash2, X } from 'lucide-react';
import { cancelRenderJob, deleteProject, duplicateProject, getPhoto, getRenderJobs, listPhotos, listProjects, photoThumbUrl, photoVideoUrl, renameProject, type Project } from './api/client';
import type { Photo, RenderJob } from './types/photo';
import Editor from './editor/Editor';
import { ContextMenu, type MenuState } from './editor/ContextMenu';
import { useAppTheme } from './editor/layout';
import LyricalVideoCreator from './components/LyricalVideoCreator';
import NewProjectDialog from './components/NewProjectDialog';
import ImportArea from './components/ImportArea';
import Dialog from './components/Dialog';
import AISettingsFields from './components/AISettingsFields';
import PhoneAccessFields from './components/PhoneAccessFields';
import { DeleteMediaDialog, FolderDialog, folderNames } from './components/MediaDialogs';

type Section = 'studio' | 'projects' | 'media' | 'exports';
const HOME_PROJECTS = 4;
const date = (value: string) => new Date(value.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export default function App() {
  const [section, setSection] = useState<Section>('studio');
  const [projects, setProjects] = useState<Project[]>([]);
  const [media, setMedia] = useState<Photo[]>([]);
  const [mediaTotal, setMediaTotal] = useState(0);
  const [outputs, setOutputs] = useState<Photo[]>([]);
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [newKind, setNewKind] = useState<'edit' | 'lyric' | null>(null);
  const [active, setActive] = useState<{ project: Project; photo: Photo } | null>(null);
  const [preview, setPreview] = useState<Photo | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<{ project: Project; action: 'rename' | 'delete' } | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiSettingsOpen, setAISettingsOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const { choice: themeChoice, next: nextTheme, theme } = useAppTheme();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [filing, setFiling] = useState<Photo | null>(null);
  const [deleting, setDeleting] = useState<Photo | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const refresh = useCallback(async () => {
    try { const [nextProjects, assets, exports] = await Promise.all([listProjects(), listPhotos({ collection: 'imports', limit: 100 }), listPhotos({ collection: 'workspace', limit: 100 })]); setProjects(nextProjects); setMedia(assets.photos); setMediaTotal(assets.total); setOutputs(exports.photos); }
    catch (problem) { setError((problem as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => { try { const next = await getRenderJobs(); if (!cancelled) setJobs(next); } catch { /* Main requests show server errors. */ } };
    void poll(); const timer = setInterval(poll, 2000); return () => { cancelled = true; clearInterval(timer); };
  }, []);
  const completed = jobs.filter((job) => job.status === 'done').length;
  useEffect(() => { if (completed) void refresh(); }, [completed, refresh]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 4000); return () => clearTimeout(timer); }, [message]);
  const open = async (project: Project) => { try { setActive({ project, photo: await getPhoto(project.media_id) }); setNewKind(null); } catch (problem) { setError((problem as Error).message); } };
  const imported = (items: Photo[]) => { setMedia((previous) => [...items, ...previous]); setMediaTotal((total) => total + items.length); setMessage(`${items.length} file${items.length === 1 ? '' : 's'} imported`); };
  const openOutput = async (id: number) => { try { setPreview(await getPhoto(id)); void refresh(); } catch (problem) { setError((problem as Error).message); } };
  const changeSection = (next: Section) => { setSection(next); setSearch(''); setFolder(null); };
  const saveProjectAction = async () => { if (!editing || saving) return; setSaving(true); try { if (editing.action === 'rename') await renameProject(editing.project.id, name); else await deleteProject(editing.project.id); setEditing(null); await refresh(); } catch (problem) { setError((problem as Error).message); } finally { setSaving(false); } };
  const projectMenu = (event: React.MouseEvent, project: Project) => {
    event.preventDefault();
    // A keyboard press on the ⋯ button has no pointer position.
    const rect = event.currentTarget.getBoundingClientRect();
    const fromButton = event.type === 'click';
    setMenu({ x: fromButton ? rect.left : event.clientX, y: fromButton ? rect.bottom + 4 : event.clientY, items: [
      { label: 'Open', onSelect: () => { void open(project); } },
      { label: 'Rename', onSelect: () => { setEditing({ project, action: 'rename' }); setName(project.name); } },
      { label: 'Duplicate', onSelect: () => { void duplicateProject(project.id).then(() => refresh()).catch((problem) => setError(problem.message)); } },
      'divider', { label: 'Delete', danger: true, onSelect: () => setEditing({ project, action: 'delete' }) },
    ] });
  };
  const mediaMenu = (event: React.MouseEvent, item: Photo) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, items: [{ label: 'Open', onSelect: () => setPreview(item) }, ...(section === 'media' ? [{ label: 'Move to folder…', onSelect: () => setFiling(item) }] : []), 'divider', { label: 'Delete from Kanaa…', danger: true, onSelect: () => setDeleting(item) }] });
  };
  const folders = folderNames(media);
  const activeJobs = jobs.filter((job) => !job.done);
  const completedJobs = jobs.filter((job) => job.done);
  const filteredProjects = projects.filter((project) => project.name.toLowerCase().includes(search.toLowerCase()));
  const visibleMedia = (section === 'exports' ? outputs : media).filter((item) => item.filename.toLowerCase().includes(search.toLowerCase()) && (section === 'exports' || !folder || item.folder === folder));
  return <div className="studio-shell" data-ed-theme={theme}>
    <aside className="studio-sidebar"><a href="/" className="studio-brand" aria-label="Kanaa home"><span className="brand-mark"><Play size={21} fill="currentColor"/></span><span className="brand-family"><small lang="ta">கனா</small>Kanaa<span className="brand-dot">.</span></span></a><nav>{([{ id: 'studio', label: 'Studio', Icon: LayoutDashboard }, { id: 'projects', label: 'Projects', Icon: FolderOpen }, { id: 'media', label: 'Media', Icon: ImageIcon }, { id: 'exports', label: 'Exports', Icon: ArrowDownToLine }] as const).map(({ id, label, Icon }) => <button key={id} className={section === id ? 'active' : ''} onClick={() => changeSection(id)}><Icon size={19}/><span>{label}</span>{id === 'exports' && activeJobs.length > 0 && <b>{activeJobs.length}</b>}</button>)}</nav><div className="sidebar-bottom"><HardDrive size={19}/><div><strong>Saved on this Mac</strong></div></div></aside>
    <main className="studio-main"><header className="studio-topbar"><strong className="topbar-title">{{ studio: 'Studio', projects: 'Projects', media: 'Media', exports: 'Exports' }[section]}</strong><div>{activeJobs.length > 0 && <button className="job-pill" title="See exports" onClick={() => changeSection('exports')}><LoaderCircle className="spin" size={14}/><b>{activeJobs[0].label}</b><em>{activeJobs[0].progress > 0 ? `${activeJobs[0].progress}%` : 'Queued'}</em>{activeJobs.length > 1 && <em>+{activeJobs.length - 1}</em>}<i style={{ width: `${activeJobs[0].progress}%` }}/></button>}<button className="icon-button studio-theme" aria-label={`Theme: ${themeChoice}. Change theme`} title={`Theme: ${themeChoice === 'system' ? 'same as this Mac' : themeChoice}`} onClick={nextTheme}>{themeChoice === 'system' ? <Monitor size={19}/> : themeChoice === 'light' ? <Sun size={19}/> : <Moon size={19}/>}</button><button className="icon-button" aria-label="Phone access" title="Use Kanaa from your phone" onClick={() => setPhoneOpen(true)}><Smartphone size={19}/></button><button className="icon-button" aria-label="AI settings" title="AI image generation settings" onClick={() => setAISettingsOpen(true)}><Settings2 size={19}/></button><button className="primary small" onClick={() => setNewKind('edit')}><Plus size={17}/>New video</button></div></header>
      <div className="studio-content">
        {error && <div className="studio-error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div>}
        {section === 'studio' && !loading && !projects.length && <><div className="welcome"><span className="eyebrow">A LITTLE IDEA. A GREAT VIDEO.</span><h1>Your story, in motion.</h1><p>Turn your clips, images, and favorite words into something worth sharing.</p></div><div className="creation-grid">
          <button className="creation-card video-card" onClick={() => setNewKind('edit')}><div className="card-overline"><span><Film size={18}/> VIDEO EDITOR</span><ArrowRight size={21}/></div><div className="clip-art" aria-hidden="true"><div className="clip-frame frame-back"/><div className="clip-frame frame-front"><div className="sun"/><div className="mountain one"/><div className="mountain two"/><span><Play size={20} fill="currentColor"/></span></div><div className="mini-timeline"><i/><i/><i/><b/></div></div><h2>Make the cut.</h2><p>Trim, transform, and give your clips a new perspective.</p><div className="card-bottom"><span>Start a video</span><span className="round-arrow"><ArrowRight size={18}/></span></div></button>
          <button className="creation-card lyric-card" onClick={() => setNewKind('lyric')}><div className="card-overline"><span><Music2 size={18}/> LYRIC VIDEO</span><Sparkles size={21}/></div><div className="lyric-art" aria-hidden="true"><div className="lyric-orbit"/><div className="lyric-words">Let the words<br/><em>move you.</em></div><div className="waveform">{Array.from({ length: 35 }, (_, i) => <i key={i} style={{ height: 5 + ((i * 13 + i * i) % 29) }}/>)}</div></div><h2>Give your song a scene.</h2><p>Sync lyrics, add your imagery, and bring every line to life.</p><div className="card-bottom"><span>Create a lyric video</span><span className="round-arrow"><ArrowRight size={18}/></span></div></button>
        </div><div className="workflow-note"><CheckCircle2 size={17}/><span>Autosaved projects</span><span className="note-dot">·</span><span>Originals stay untouched</span><span className="note-dot">·</span><span>No account needed</span></div></>}
        {(section === 'studio' || section === 'projects') && <section><div className="section-heading"><div><h2>{section === 'studio' ? 'Recent projects' : 'Projects'}</h2>{section === 'projects' && <p>{projects.length ? `${projects.length} project${projects.length === 1 ? '' : 's'}` : 'A home for your next idea.'}</p>}</div>{section === 'studio' ? projects.length > HOME_PROJECTS && <button className="text-button" onClick={() => changeSection('projects')}>View all <ArrowRight size={16}/></button> : <label className="studio-search"><Search size={17}/><input aria-label="Search projects" placeholder="Search projects" value={search} onChange={(event) => setSearch(event.target.value)}/></label>}</div>
          {loading ? <div className="empty-state"><LoaderCircle className="spin"/><p>Opening your studio…</p></div> : filteredProjects.length ? <div className={`project-grid ${section === 'studio' && filteredProjects.length === 1 ? 'single' : ''}`}>{filteredProjects.slice(0, section === 'studio' ? HOME_PROJECTS : undefined).map((project) => <article className="project-card" key={project.id} onContextMenu={(event) => projectMenu(event, project)}><button className="project-cover" onClick={() => { void open(project); }} aria-label={`Open ${project.name}`}><img src={photoThumbUrl(project.media_id)} alt=""/><span className="project-play"><span><Play size={20} fill="currentColor"/></span></span></button><div className="project-info"><div><button onClick={() => { void open(project); }}><h3>{project.name}</h3></button><span>{project.kind === 'lyric' ? 'Lyric video' : 'Video'} · Edited {date(project.updated_at)}</span></div>{section === 'studio' && filteredProjects.length === 1 && <button className="primary small project-continue" onClick={() => { void open(project); }}>Continue</button>}<button className="project-more" aria-label={`More actions for ${project.name}`} title="More" onClick={(event) => projectMenu(event, project)}><MoreHorizontal size={17}/></button></div></article>)}</div> : <div className="empty-state"><span className="empty-icon"><Clapperboard size={26}/></span><h3>{search ? 'No matching projects' : 'Your first story starts here'}</h3><p>{search ? 'Try a different project name.' : 'Choose Video Editor or Lyric Video above. We’ll save your progress as you go.'}</p>{!search && <button className="secondary" onClick={() => setNewKind('lyric')}>Create a lyric video <ArrowRight size={16}/></button>}</div>}
        </section>}
        {section === 'studio' && !loading && projects.length > 0 && <div className="action-tiles">
          <button className="action-tile" onClick={() => setNewKind('edit')}><span className="tile-icon video"><Film size={20}/></span><span><strong>New video</strong><small>Trim and edit clips</small></span></button>
          <button className="action-tile" onClick={() => setNewKind('lyric')}><span className="tile-icon lyric"><Music2 size={20}/></span><span><strong>New lyric video</strong><small>Sync lyrics to a song</small></span></button>
        </div>}
        {(section === 'media' || section === 'exports') && <section><div className="section-heading"><div><h1>{section === 'media' ? 'Media' : 'Exports'}</h1><p>{section === 'media' ? 'Import once. Create something new, again and again.' : 'Finished videos and the work happening behind the scenes.'}</p></div><label className="studio-search"><Search size={17}/><input aria-label="Search media" placeholder="Search files" value={search} onChange={(event) => setSearch(event.target.value)}/></label></div>
          {section === 'media' && <ImportArea onImported={imported}/>}
          {section === 'media' && folders.length > 0 && <div className="folder-chips" role="group" aria-label="Folders"><button className={folder === null ? 'on' : ''} onClick={() => setFolder(null)}>All media</button>{folders.map((name) => <button key={name} className={folder === name ? 'on' : ''} onClick={() => setFolder(name)}>{name}</button>)}</div>}
          <div className="media-grid">{visibleMedia.map((item) => <button key={item.id} onClick={() => setPreview(item)} onContextMenu={(event) => mediaMenu(event, item)} className="media-tile"><div><img src={photoThumbUrl(item.id)} alt=""/>{item.media_type === 'video' && <Play size={23}/>}</div><strong>{item.filename}</strong><span>{item.folder ? `${item.folder} · ` : ''}{item.media_type === 'video' ? `${Math.round(item.duration || 0)} sec · Video` : `${item.width} × ${item.height} · Image`}</span></button>)}</div>
          {!visibleMedia.length && section === 'media' && <div className="empty-state"><FolderOpen size={28}/><h3>A fresh canvas</h3><p>Drop in your clips and images to get started.</p></div>}
          {section === 'exports' && activeJobs.length > 0 && <section className="job-section" aria-label="Work in progress"><h2>Work in progress</h2><div className="job-list">{activeJobs.map((job) => <div className="job-row" key={job.job_id}><span className="job-symbol"><LoaderCircle className="spin" size={20}/></span><div><strong>{job.label}</strong><span>{job.phase || job.status} · {job.progress}%</span><progress max={100} value={job.progress}/></div><button className="secondary small" onClick={() => { void cancelRenderJob(job.job_id).catch((problem) => setError(problem.message)); }}>Cancel</button></div>)}</div></section>}
          {section === 'exports' && completedJobs.length > 0 && <details className="job-activity"><summary>Activity · {completedJobs.length} completed</summary><div className="job-list">{completedJobs.map((job) => <div className="job-row" key={job.job_id}><span className="job-symbol"><CheckCircle2 size={20}/></span><div><strong>{job.label}</strong><span>{job.error || (job.kind === 'lyric_images' ? 'Finished · review scenes in your lyric project' : 'Completed')}</span></div>{job.output_photo_id && <button className="secondary small" onClick={() => { void openOutput(job.output_photo_id!); }}>Open</button>}</div>)}</div></details>}
          {section === 'exports' && !visibleMedia.length && !activeJobs.length && <div className="empty-state"><FolderOpen size={28}/><h3>Your finished videos will appear here</h3><p>Export from either editor. You can keep creating while it renders.</p></div>}
          {section === 'media' && media.length < mediaTotal && <button className="secondary" onClick={() => { void listPhotos({ collection: 'imports', offset: media.length, limit: 100 }).then((result) => setMedia((previous) => [...previous, ...result.photos])).catch((problem) => setError(problem.message)); }}>Load more media</button>}
        </section>}
      </div>
    </main>
    {phoneOpen && <Dialog title="Phone access" onClose={() => setPhoneOpen(false)}><PhoneAccessFields/></Dialog>}
    {aiSettingsOpen && <Dialog title="AI image generation" onClose={() => setAISettingsOpen(false)}><AISettingsFields/></Dialog>}
    {newKind && <NewProjectDialog kind={newKind} media={media} onClose={() => setNewKind(null)} onImported={imported} onCreated={(project) => { void refresh(); void open(project); }}/>} 
    {active && (active.project.kind === 'edit' ? <Editor key={active.project.id} projectId={active.project.id} projectName={active.project.name} photo={active.photo} onClose={() => { setActive(null); void refresh(); }} onOpenOutput={(id) => { void openOutput(id); }} theme={theme} themeChoice={themeChoice} nextTheme={nextTheme}/> : <LyricalVideoCreator key={active.project.id} projectId={active.project.id} projectName={active.project.name} photo={active.photo} onClose={() => { setActive(null); void refresh(); }} onOpenOutput={(id) => { void openOutput(id); }}/>) }
    {preview && <Dialog title={preview.filename} wide onClose={() => setPreview(null)}><div className="media-preview">{preview.media_type === 'video' ? <video src={photoVideoUrl(preview.id)} controls autoPlay/> : <img src={`/api/photos/${preview.id}/image`} alt={preview.filename}/>}</div><footer><span className="muted">{preview.width} × {preview.height}</span><a className="primary" href={`/api/photos/${preview.id}/download`} download><ArrowDownToLine size={17}/>Download</a></footer></Dialog>}
    {editing && <Dialog title={editing.action === 'rename' ? 'Rename project' : 'Delete project?'} onClose={() => setEditing(null)}>{editing.action === 'rename' ? <label className="field-label">Project name<input aria-label="New project name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)}/></label> : <p className="dialog-description">Delete “{editing.project.name}”? Its editing recipe will be removed. Imported media and finished exports will stay.</p>}<footer><button className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className={editing.action === 'delete' ? 'danger' : 'primary'} disabled={saving || (editing.action === 'rename' && !name.trim())} onClick={() => { void saveProjectAction(); }}>{saving ? 'Saving…' : editing.action === 'rename' ? 'Save name' : 'Delete project'}</button></footer></Dialog>}
    {menu && <ContextMenu menu={menu} onClose={closeMenu}/>}
    {filing && <FolderDialog item={filing} folders={folders} onClose={() => setFiling(null)} onSaved={(saved) => { setMedia((current) => current.map((item) => (item.id === filing.id ? { ...item, folder: saved } : item))); setMessage(saved ? `Moved to ${saved}` : 'Taken out of folder'); }}/>}
    {deleting && <DeleteMediaDialog item={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setMessage('Deleted from Kanaa'); void refresh(); }}/>}
    {message && <div role="status" className="studio-toast"><CheckCircle2 size={17}/>{message}</div>}
  </div>;
}
