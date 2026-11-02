import type { Photo, PhotoListResponse, JobStatusResponse, VideoEditSettings, RenderJob } from '../types/photo';
export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`); }
  return response.json();
}
export const photoImageUrl = (id: number) => `/api/photos/${id}/image`;
export const photoThumbUrl = (id: number) => `/api/photos/${id}/thumbnail`;
export const photoVideoUrl = (id: number) => `/api/photos/${id}/video`;
export const videoAudioUrl = (id: string) => `/api/video-audio/${id}`;
export const getPhoto = (id: number) => requestJson<Photo>(`/api/photos/${id}`);
export const listPhotos = (filter: Record<string, string | number | undefined> = {}) => {
  const params = new URLSearchParams(); Object.entries(filter).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)); });
  return requestJson<PhotoListResponse>(`/api/photos?${params}`);
};
async function upload<T>(url: string, file: File): Promise<T> {
  const body = new FormData(); body.append('file', file);
  const response = await fetch(url, { method: 'POST', body });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(typeof data.detail === 'string' ? data.detail : 'Import failed. Please try again.'); }
  return response.json();
}
export const uploadMedia = (file: File) => upload<Photo>('/api/media', file);
export const uploadVideoAudio = (file: File) => upload<{ asset_id: string; duration: number; embedded_lyrics?: string }>('/api/video-audio', file);
export const getSongBeats = (id: string) => requestJson<{ beats: number[]; bpm: number }>(`/api/video-audio/${id}/beats`);
export const getJobStatus = (id: string) => requestJson<JobStatusResponse>(`/api/jobs/${id}/status`);
export const cancelRenderJob = (id: string) => requestJson(`/api/jobs/${id}/cancel`, { method: 'POST' });
export const getRenderJobs = () => requestJson<RenderJob[]>('/api/render-jobs');
export const startVideoExport = (id: number, edit: VideoEditSettings) => requestJson<{ job_id: string }>(`/api/photos/${id}/video-export`, { method: 'POST', body: JSON.stringify(edit) });
export const startLyricSync = (id: string, lyrics: string, language: string | null) => requestJson<{ job_id: string }>('/api/lyric-sync', { method: 'POST', body: JSON.stringify({ audio_asset_id: id, lyrics, language }) });
export const getVideoProject = <T,>(id: number, _kind: string) => requestJson<{ recipe: T | null }>(`/api/projects/${id}`);
export const saveVideoProject = (id: number, _kind: string, recipe: unknown) => requestJson(`/api/projects/${id}/recipe`, { method: 'PUT', body: JSON.stringify({ recipe }) });
export const deleteVideoProject = (id: number, kind: string) => saveVideoProject(id, kind, null);
export type Project = { id: number; name: string; kind: 'edit' | 'lyric'; media_id: number; updated_at: string; recipe?: unknown };
export const listProjects = () => requestJson<Project[]>('/api/projects');
export const createProject = (name: string, kind: 'edit' | 'lyric', mediaIds: number[]) => requestJson<Project>('/api/projects', { method: 'POST', body: JSON.stringify({ name, kind, media_id: mediaIds[0], media_ids: mediaIds }) });
export const renameProject = (id: number, name: string) => requestJson(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
export const duplicateProject = (id: number) => requestJson<Project>(`/api/projects/${id}/duplicate`, { method: 'POST' });
export const deleteProject = (id: number) => requestJson(`/api/projects/${id}`, { method: 'DELETE' });

export type AISettings = { configured: boolean; base_url: string; model: string; key_source: 'environment' | 'local' | null };
export const getAISettings = () => requestJson<AISettings>('/api/ai-settings');
export const saveAISettings = (data: { api_key?: string; base_url: string; model: string; clear_key?: boolean }) => requestJson<AISettings>('/api/ai-settings', { method: 'PUT', body: JSON.stringify(data) });
export type ImageScene = { id: number; position: number; lyric: string; prompt: string; start: number | null; end: number | null; status: 'draft' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; media_id: number | null; error: string | null };
export type ImageBatch = { id: string; project_id: number; lyrics: string; style: string; brief: string; canvas: 'portrait' | 'square' | 'landscape'; job_id: string | null; active: boolean; scenes: ImageScene[] };
export const getImageScenes = (id: number) => requestJson<{ batch: ImageBatch | null }>(`/api/projects/${id}/image-scenes`);
export const planImageScenes = (id: number, data: { lyrics: string; cues: { text: string; start: number; end: number }[]; count: number; style: string; brief: string; canvas: string }) => requestJson<ImageBatch>(`/api/projects/${id}/image-scenes/plan`, { method: 'POST', body: JSON.stringify(data) });
export const generateImageScenes = (id: number, batchId: string, scenes: { id: number; prompt: string }[], quality: string) => requestJson<{ job_id: string }>(`/api/projects/${id}/image-scenes/generate`, { method: 'POST', body: JSON.stringify({ batch_id: batchId, scenes, quality }) });

export const saveImageScenePrompts = (id: number, batchId: string, scenes: { id: number; prompt: string }[]) => requestJson(`/api/projects/${id}/image-scenes/${batchId}`, { method: 'PATCH', body: JSON.stringify({ scenes }) });

export type ClipAssets = { status: 'ready' | 'preparing' | 'unavailable'; key?: string; job_id?: string; progress?: number; filmstrip?: { tiles: number; tile_width: number; tile_height: number } };
export const getClipAssets = (id: number) => requestJson<ClipAssets>(`/api/photos/${id}/assets`);
export const clipProxyUrl = (id: number) => `/api/photos/${id}/proxy`;
export const getSongPeaks = (id: string) => requestJson<{ peaks_per_second: number; peaks: number[] }>(`/api/video-audio/${id}/peaks`);
export const songUrl = (id: string) => `/api/video-audio/${id}`;
export type Stems = { vocals: string; music: string };
export const getStemsStatus = () => requestJson<{ available: boolean; install_command: string }>('/api/stems');
export const startStems = (source: { asset_id?: string; media_id?: number }) => requestJson<{ job_id: string }>('/api/stems', { method: 'POST', body: JSON.stringify(source) });
export const fetchTextImage = async (text: unknown, format: unknown) => {
  const response = await fetch('/api/text-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, format }) });
  if (!response.ok) throw new Error('This text could not be drawn.');
  return URL.createObjectURL(await response.blob());
};
export const previewRenderUrl = (id: number) => `/api/projects/${id}/preview-render`;
export const startPreviewRender = (id: number, timeline: unknown) => requestJson<{ job_id: string }>(previewRenderUrl(id), { method: 'POST', body: JSON.stringify(timeline) });
export const clipFilmstripUrl = (id: number) => `/api/photos/${id}/filmstrip`;
export const getClipPeaks = (id: number) => requestJson<{ peaks_per_second: number; peaks: number[] }>(`/api/photos/${id}/peaks`);
export const getProjectTimeline = <T>(id: number) => requestJson<T>(`/api/projects/${id}/timeline`);
export const exportProjectTimeline = (id: number, timeline: unknown) => requestJson<{ job_id: string }>(`/api/projects/${id}/export`, { method: 'POST', body: JSON.stringify(timeline) });
