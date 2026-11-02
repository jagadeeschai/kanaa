import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRight, CheckCircle2, ChevronRight, Clapperboard, Copy, Film, FolderOpen, HardDrive, Image as ImageIcon, LayoutDashboard, LoaderCircle, Music2, Pencil, Play, Plus, Search, Sparkles, Settings2, Trash2, X } from 'lucide-react';
import { cancelRenderJob, deleteProject, duplicateProject, getPhoto, getRenderJobs, listPhotos, listProjects, photoThumbUrl, photoVideoUrl, renameProject, type Project } from './api/client';
import type { Photo, RenderJob } from './types/photo';
import Editor from './editor/Editor';
import LyricalVideoCreator from './components/LyricalVideoCreator';
import NewProjectDialog from './components/NewProjectDialog';
import ImportArea from './components/ImportArea';
import Dialog from './components/Dialog';
import AISettingsFields from './components/AISettingsFields';

type Section = 'studio' | 'projects' | 'media' | 'exports';
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
  const changeSection = (next: Section) => { setSection(next); setSearch(''); };
  const saveProjectAction = async () => { if (!editing || saving) return; setSaving(true); try { if (editing.action === 'rename') await renameProject(editing.project.id, name); else await deleteProject(editing.project.id); setEditing(null); await refresh(); } catch (problem) { setError((problem as Error).message); } finally { setSaving(false); } };
  const activeJobs = jobs.filter((job) => !job.done);
  const filteredProjects = projects.filter((project) => project.name.toLowerCase().includes(search.toLowerCase()));
  const visibleMedia = (section === 'exports' ? outputs : media).filter((item) => item.filename.toLowerCase().includes(search.toLowerCase()));
  return <div className="studio-shell">
    <aside className="studio-sidebar"><a href="/" className="studio-brand" aria-label="WideAngle Motion home"><span className="brand-mark"><Play size={21} fill="currentColor"/></span><span className="brand-family"><small>WIDEANGLE</small>Motion<span className="brand-dot">.</span></span></a><span className="nav-caption">YOUR WORKSPACE</span><nav>{([{ id: 'studio', label: 'Studio', Icon: LayoutDashboard }, { id: 'projects', label: 'Projects', Icon: FolderOpen }, { id: 'media', label: 'Media', Icon: ImageIcon }, { id: 'exports', label: 'Exports', Icon: ArrowDownToLine }] as const).map(({ id, label, Icon }) => <button key={id} className={section === id ? 'active' : ''} onClick={() => changeSection(id)}><Icon size={19}/><span>{label}</span>{id === 'exports' && activeJobs.length > 0 && <b>{activeJobs.length}</b>}</button>)}</nav><div className="sidebar-bottom"><HardDrive size={19}/><div><strong>Made here. Saved here.</strong><span>Media stays local. AI generation uses your provider.</span></div></div></aside>
    <main className="studio-main"><header className="studio-topbar"><span>Workspace <ChevronRight size={15}/> <strong>{{ studio: 'Studio', projects: 'Projects', media: 'Media', exports: 'Exports' }[section]}</strong></span><div><span className="local-badge"><span/>Local studio</span><button className="icon-button" aria-label="AI settings" title="AI image generation settings" onClick={() => setAISettingsOpen(true)}><Settings2 size={19}/></button><button className="primary small" onClick={() => setNewKind('edit')}><Plus size={17}/>New project</button></div></header>
      <div className="studio-content">
        {error && <div className="studio-error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div>}
        {section === 'studio' && <><div className="welcome"><span className="eyebrow">A LITTLE IDEA. A GREAT VIDEO.</span><h1>Your story, in motion.</h1><p>Turn your clips, images, and favorite words into something worth sharing.</p></div><div className="creation-grid">
          <button className="creation-card video-card" onClick={() => setNewKind('edit')}><div className="card-overline"><span><Film size={18}/> VIDEO EDITOR</span><ArrowRight size={21}/></div><div className="clip-art" aria-hidden="true"><div className="clip-frame frame-back"/><div className="clip-frame frame-front"><div className="sun"/><div className="mountain one"/><div className="mountain two"/><span><Play size={20} fill="currentColor"/></span></div><div className="mini-timeline"><i/><i/><i/><b/></div></div><h2>Make the cut.</h2><p>Trim, transform, and give your clips a new perspective.</p><div className="card-bottom"><span>Start a video</span><span className="round-arrow"><ArrowRight size={18}/></span></div></button>
          <button className="creation-card lyric-card" onClick={() => setNewKind('lyric')}><div className="card-overline"><span><Music2 size={18}/> LYRIC VIDEO</span><Sparkles size={21}/></div><div className="lyric-art" aria-hidden="true"><div className="lyric-orbit"/><div className="lyric-words">Let the words<br/><em>move you.</em></div><div className="waveform">{Array.from({ length: 35 }, (_, i) => <i key={i} style={{ height: 5 + ((i * 13 + i * i) % 29) }}/>)}</div></div><h2>Give your song a scene.</h2><p>Sync lyrics, add your imagery, and bring every line to life.</p><div className="card-bottom"><span>Create a lyric video</span><span className="round-arrow"><ArrowRight size={18}/></span></div></button>
        </div><div className="workflow-note"><CheckCircle2 size={17}/><span>Autosaved projects</span><span className="note-dot">·</span><span>Originals stay untouched</span><span className="note-dot">·</span><span>No account needed</span></div></>}
        {(section === 'studio' || section === 'projects') && <section><div className="section-heading"><div><h2>{section === 'studio' ? 'Pick up where you left off' : 'Your projects'}</h2><p>{projects.length ? `${projects.length} project${projects.length === 1 ? '' : 's'} in your studio` : 'A home for your next idea.'}</p></div>{section === 'studio' && projects.length > 0 ? <button className="text-button" onClick={() => changeSection('projects')}>View all <ArrowRight size={16}/></button> : <label className="studio-search"><Search size={17}/><input aria-label="Search projects" placeholder="Search projects" value={search} onChange={(event) => setSearch(event.target.value)}/></label>}</div>
          {loading ? <div className="empty-state"><LoaderCircle className="spin"/><p>Opening your studio…</p></div> : filteredProjects.length ? <div className="project-grid">{filteredProjects.slice(0, section === 'studio' ? 6 : undefined).map((project) => <article className="project-card" key={project.id}><button className="project-cover" onClick={() => { void open(project); }} aria-label={`Open ${project.name}`}><img src={photoThumbUrl(project.media_id)} alt=""/><span className="project-type">{project.kind === 'lyric' ? <Music2 size={13}/> : <Film size={13}/>} {project.kind === 'lyric' ? 'Lyric video' : 'Video'}</span><span className="project-play"><Play size={20} fill="currentColor"/></span></button><div className="project-info"><button onClick={() => { void open(project); }}><h3>{project.name}</h3></button><span>Edited {date(project.updated_at)}</span></div><div className="project-actions"><button title="Rename" aria-label={`Rename ${project.name}`} onClick={() => { setEditing({ project, action: 'rename' }); setName(project.name); }}><Pencil size={15}/></button><button title="Duplicate" aria-label={`Duplicate ${project.name}`} onClick={() => { void duplicateProject(project.id).then(() => refresh()).catch((problem) => setError(problem.message)); }}><Copy size={15}/></button><button title="Delete project" aria-label={`Delete ${project.name}`} onClick={() => setEditing({ project, action: 'delete' })}><Trash2 size={15}/></button></div></article>)}</div> : <div className="empty-state"><span className="empty-icon"><Clapperboard size={26}/></span><h3>{search ? 'No matching projects' : 'Your first story starts here'}</h3><p>{search ? 'Try a different project name.' : 'Choose Video Editor or Lyric Video above. We’ll save your progress as you go.'}</p>{!search && <button className="secondary" onClick={() => setNewKind('lyric')}>Create a lyric video <ArrowRight size={16}/></button>}</div>}
        </section>}
        {(section === 'media' || section === 'exports') && <section><div className="section-heading"><div><h1>{section === 'media' ? 'Your creative ingredients.' : 'Ready for the world.'}</h1><p>{section === 'media' ? 'Import once. Create something new, again and again.' : 'Finished videos and the work happening behind the scenes.'}</p></div><label className="studio-search"><Search size={17}/><input aria-label="Search media" placeholder="Search files" value={search} onChange={(event) => setSearch(event.target.value)}/></label></div>
          {section === 'media' && <ImportArea onImported={imported}/>}
          {section === 'exports' && jobs.length > 0 && <div className="job-list">{jobs.map((job) => <div className="job-row" key={job.job_id}><span className="job-symbol">{job.done ? <CheckCircle2 size={20}/> : <LoaderCircle className="spin" size={20}/>}</span><div><strong>{job.label}</strong><span>{job.error || (job.done ? job.kind === 'lyric_images' ? 'Finished · review scenes in your lyric project' : 'Completed' : `${job.phase || job.status} · ${job.progress}%`)}</span>{!job.done && <progress max={100} value={job.progress}/>}</div>{!job.done && <button className="secondary small" onClick={() => { void cancelRenderJob(job.job_id).catch((problem) => setError(problem.message)); }}>Cancel</button>}{job.output_photo_id && <button className="secondary small" onClick={() => { void openOutput(job.output_photo_id!); }}>Open</button>}</div>)}</div>}
          <div className="media-grid">{visibleMedia.map((item) => <button key={item.id} onClick={() => setPreview(item)} className="media-tile"><div><img src={photoThumbUrl(item.id)} alt=""/>{item.media_type === 'video' && <Play size={23}/>}</div><strong>{item.filename}</strong><span>{item.media_type === 'video' ? `${Math.round(item.duration || 0)} sec · Video` : `${item.width} × ${item.height} · Image`}</span></button>)}</div>
          {!visibleMedia.length && <div className="empty-state"><FolderOpen size={28}/><h3>{section === 'media' ? 'A fresh canvas' : 'Your finished videos will appear here'}</h3><p>{section === 'media' ? 'Drop in your clips and images to get started.' : 'Export from either editor. You can keep creating while it renders.'}</p></div>}
          {section === 'media' && media.length < mediaTotal && <button className="secondary" onClick={() => { void listPhotos({ collection: 'imports', offset: media.length, limit: 100 }).then((result) => setMedia((previous) => [...previous, ...result.photos])).catch((problem) => setError(problem.message)); }}>Load more media</button>}
        </section>}
        <footer className="studio-footer"><span>WideAngle Motion · A space to make things.</span><span>Crafted for your next frame.</span></footer>
      </div>
    </main>
    {aiSettingsOpen && <Dialog title="AI image generation" onClose={() => setAISettingsOpen(false)}><AISettingsFields/></Dialog>}
    {newKind && <NewProjectDialog kind={newKind} media={media} onClose={() => setNewKind(null)} onImported={imported} onCreated={(project) => { void refresh(); void open(project); }}/>} 
    {active && (active.project.kind === 'edit' ? <Editor key={active.project.id} projectId={active.project.id} projectName={active.project.name} photo={active.photo} onClose={() => { setActive(null); void refresh(); }} onOpenOutput={(id) => { void openOutput(id); }}/> : <LyricalVideoCreator key={active.project.id} projectId={active.project.id} projectName={active.project.name} photo={active.photo} onClose={() => { setActive(null); void refresh(); }} onOpenOutput={(id) => { void openOutput(id); }}/>) }
    {preview && <Dialog title={preview.filename} wide onClose={() => setPreview(null)}><div className="media-preview">{preview.media_type === 'video' ? <video src={photoVideoUrl(preview.id)} controls autoPlay/> : <img src={`/api/photos/${preview.id}/image`} alt={preview.filename}/>}</div><footer><span className="muted">{preview.width} × {preview.height}</span><a className="primary" href={`/api/photos/${preview.id}/download`} download><ArrowDownToLine size={17}/>Download</a></footer></Dialog>}
    {editing && <Dialog title={editing.action === 'rename' ? 'Rename project' : 'Delete project?'} onClose={() => setEditing(null)}>{editing.action === 'rename' ? <label className="field-label">Project name<input aria-label="New project name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)}/></label> : <p className="dialog-description">Delete “{editing.project.name}”? Its editing recipe will be removed. Imported media and finished exports will stay.</p>}<footer><button className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className={editing.action === 'delete' ? 'danger' : 'primary'} disabled={saving || (editing.action === 'rename' && !name.trim())} onClick={() => { void saveProjectAction(); }}>{saving ? 'Saving…' : editing.action === 'rename' ? 'Save name' : 'Delete project'}</button></footer></Dialog>}
    {message && <div role="status" className="studio-toast"><CheckCircle2 size={17}/>{message}</div>}
  </div>;
}
