import { useRef, useState } from 'react';
import { UploadCloud, LoaderCircle } from 'lucide-react';
import { uploadMedia } from '../api/client';
import type { Photo } from '../types/photo';
export default function ImportArea({ onImported, videoOnly = false, compact = false }: { onImported: (media: Photo[]) => void; videoOnly?: boolean; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const lock = useRef(false);
  const importFiles = async (files: FileList | File[]) => {
    if (lock.current || !files.length) return;
    const queue = Array.from(files);
    lock.current = true; setError(''); const imported: Photo[] = [], failures: string[] = [];
    try {
      for (let index = 0; index < queue.length; index++) {
        setProgress(`Importing ${index + 1} of ${queue.length} · ${queue[index].name}`);
        try { imported.push(await uploadMedia(queue[index])); } catch (problem) { failures.push(`${queue[index].name}: ${(problem as Error).message}`); }
      }
      if (imported.length) onImported(imported);
      if (failures.length) setError(failures.join('\n'));
    } finally { lock.current = false; setProgress(''); }
  };
  return <div><button disabled={Boolean(progress)} className={`import-area ${compact ? 'compact' : ''} ${dragging ? 'dragging' : ''}`} onClick={() => input.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void importFiles(event.dataTransfer.files); }}>
    {progress ? <LoaderCircle className="spin" size={24}/> : <UploadCloud size={28}/>}<strong>{progress || 'Drop your media here, or browse files'}</strong><span>{videoOnly ? 'MP4, MOV, WebM and more' : 'Images and video · multiple files welcome'} · up to 2 GB each</span>
  </button><input ref={input} type="file" aria-label="Import media files" multiple accept={videoOnly ? 'video/*,.mkv,.avi' : 'image/jpeg,image/png,image/webp,image/tiff,video/*,.mkv,.avi'} hidden onChange={(event) => { if (event.target.files) void importFiles(event.target.files); event.target.value = ''; }}/>{error && <p className="studio-error" role="alert">{error}</p>}</div>;
}
