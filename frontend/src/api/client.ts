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

export type AISettings = { configured: boolean; base_url: string; model: string; text_model: string; text_configured: boolean; local: boolean; key_source: 'environment' | 'local' | null };
export const getAISettings = () => requestJson<AISettings>('/api/ai-settings');
export const saveAISettings = (data: { api_key?: string; base_url: string; model: string; text_model?: string; clear_key?: boolean }) => requestJson<AISettings>('/api/ai-settings', { method: 'PUT', body: JSON.stringify(data) });
export type ImageScene = { id: number; position: number; lyric: string; prompt: string; start: number | null; end: number | null; status: 'draft' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; media_id: number | null; error: string | null };
export type ImageBatch = { id: string; project_id: number; lyrics: string; style: string; brief: string; canvas: 'portrait' | 'square' | 'landscape'; job_id: string | null; active: boolean; scenes: ImageScene[] };
export const getImageScenes = (id: number) => requestJson<{ batch: ImageBatch | null }>(`/api/projects/${id}/image-scenes`);
export const planImageScenes = (id: number, data: { lyrics: string; cues: { text: string; start: number; end: number }[]; count: number; style: string; brief: string; canvas: string; purpose?: 'scenes' | 'image' }) => requestJson<ImageBatch>(`/api/projects/${id}/image-scenes/plan`, { method: 'POST', body: JSON.stringify(data) });
export const directImageScenes = (id: number, data: { lyrics: string; cues: { text: string; start: number; end: number }[]; count: number; style: string; brief: string; canvas: string; purpose?: 'scenes' | 'image' }) => requestJson<ImageBatch>(`/api/projects/${id}/image-scenes/direct`, { method: 'POST', body: JSON.stringify(data) });
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
export const fetchCaptionImage = async (caption: unknown, layer: unknown, lit: number | null, format: unknown) => {
  const response = await fetch('/api/caption-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caption, layer, lit, format }) });
  if (!response.ok) throw new Error('This caption could not be drawn.');
  return URL.createObjectURL(await response.blob());
};
export const previewRenderUrl = (id: number) => `/api/projects/${id}/preview-render`;
export const startPreviewRender = (id: number, timeline: unknown) => requestJson<{ job_id: string }>(previewRenderUrl(id), { method: 'POST', body: JSON.stringify(timeline) });
export const setMediaFolder = (id: number, folder: string | null) => requestJson<{ folder: string | null }>(`/api/photos/${id}`, { method: 'PATCH', body: JSON.stringify({ folder }) });
export type MediaFolderSummary = { name: string; count: number };
export type MediaFolderIndex = { total: number; unfiled: number; folders: MediaFolderSummary[] };
export const listMediaFolders = () => requestJson<MediaFolderIndex>('/api/media-folders');
export const createMediaFolder = (name: string) => requestJson<MediaFolderSummary>('/api/media-folders', { method: 'POST', body: JSON.stringify({ name }) });
export const renameMediaFolder = (name: string, next: string) => requestJson<{ name: string }>(`/api/media-folders/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify({ name: next }) });
export const deleteMediaFolder = (name: string) => requestJson<void>(`/api/media-folders/${encodeURIComponent(name)}`, { method: 'DELETE' });
export const moveMediaToFolder = (ids: number[], folder: string | null) => requestJson<{ folder: string | null; updated: number }>('/api/photos/folder', { method: 'PATCH', body: JSON.stringify({ ids, folder }) });
export const deleteMedia = (id: number) => requestJson(`/api/photos/${id}`, { method: 'DELETE' });
export const getWords = (id: number, language: string) => requestJson<{ words: { w: string; s: number; e: number }[] | null }>(`/api/photos/${id}/words?language=${language}`);
export const getFocus = (id: number, at = 0) => requestJson<{ x: number | null; y: number | null; faces: number; model?: boolean }>(`/api/photos/${id}/focus?at=${at.toFixed(2)}`);
export const planEdits = (body: { request: string; project: unknown; options: unknown }) => requestJson<{ summary: string; commands: unknown[]; dropped: { reason: string }[] }>('/api/ai/plan', { method: 'POST', body: JSON.stringify(body) });
export const translateLines = (lines: string[], to: 'ta' | 'en') => requestJson<{ lines: string[] }>('/api/ai/translate', { method: 'POST', body: JSON.stringify({ lines, to }) });
export const describeVideo = (project: unknown, language: 'ta' | 'en' | 'both') => requestJson<{ title: string; description: string; hashtags: string[] }>('/api/ai/describe', { method: 'POST', body: JSON.stringify({ project, language }) });
export type SoundEffectInfo = { id: string; kind: 'whoosh' | 'hit' | 'thunder'; name: string; seconds: number; own?: boolean };
export const listSoundEffects = () => requestJson<{ effects: SoundEffectInfo[] }>('/api/sound-effects');
export const useSoundEffect = (id: string) => requestJson<{ asset_id: string; duration: number; name: string; kind: 'whoosh' | 'hit' | 'thunder'; peak: number }>(`/api/sound-effects/${id}/use`, { method: 'POST' });
export type MapPlace = { id?: number; name: string; tamil: string; country?: string; lat: number; lon: number };
export const travelMapStatus = () => requestJson<{ ready: boolean; missing: string[]; size_mb: number; sources: string }>('/api/travel-map/status');
export const downloadTravelMapData = () => requestJson<{ job_id: string }>('/api/travel-map/download', { method: 'POST' });
export const searchPlaces = (q: string) => requestJson<{ places: MapPlace[] }>(`/api/travel-map/places?q=${encodeURIComponent(q)}`);
export const makeTravelMap = (body: { stops: MapPlace[]; modes: string[]; style: string; language: string; width: number; height: number }) => requestJson<{ job_id: string }>('/api/travel-map', { method: 'POST', body: JSON.stringify(body) });
export const startBestMoments = (items: { media_id: number; length: number }[]) => requestJson<{ job_id: string }>('/api/best-moments', { method: 'POST', body: JSON.stringify({ items }) });
/** Waits for a background job, reporting its progress, and returns its final fields. */
export async function waitForJob<T>(id: string, onProgress: (progress: number) => void = () => {}): Promise<T> {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const status = await getJobStatus(id) as unknown as { status?: string; progress: number; error?: string | null };
    if (status.status === 'failed') throw new Error(status.error ?? 'That did not work.');
    if (status.status === 'cancelled') throw new Error('Cancelled.');
    if (status.status === 'done') return status as unknown as T;
    onProgress(status.progress);
  }
}
export const faceFinderReady = () => requestJson<{ ready: boolean }>('/api/face-finder');
export const startReframe = (id: number, body: { start: number; end: number; allow_download: boolean }) => requestJson<{ job_id: string }>(`/api/photos/${id}/reframe`, { method: 'POST', body: JSON.stringify(body) });
export const startScenes = (id: number, body: { start: number; end: number }) => requestJson<{ job_id: string }>(`/api/photos/${id}/scenes`, { method: 'POST', body: JSON.stringify(body) });
export type EffectInfo = { id: string; label: string; tamil: string; mood: string; about: string; placement?: 'overlay' | 'start' };
export const listEffects = () => requestJson<EffectInfo[]>('/api/effects');
export type EffectOptions = { density?: number; direction?: number; speed?: number; frequency?: number; brightness?: number; seed?: number };
export const makeEffect = (id: string, size: { width: number; height: number }, options?: EffectOptions) => requestJson<{ media?: Photo; job_id?: string }>(`/api/effects/${id}`, { method: 'POST', body: JSON.stringify({ ...size, options }) });
export type LutInfo = { id: string; name: string };
export const listLuts = () => requestJson<{ folder: string; luts: LutInfo[] }>('/api/luts');
export const lutAtlasUrl = (id: string) => `/api/luts/${encodeURIComponent(id)}/atlas`;
export const startFaces = (id: number, body: { start: number; end: number }) => requestJson<{ job_id: string }>(`/api/photos/${id}/faces`, { method: 'POST', body: JSON.stringify(body) });
/** A steadied and/or reversed copy of a video, made once on the server. */
export const requestPrepared = (id: number, steady: boolean, backwards: boolean, echo: string, cutout: string) => requestJson<{ status: 'ready' | 'preparing'; progress?: number }>(`/api/photos/${id}/prepared?steady=${steady}&backwards=${backwards}&cutout=${encodeURIComponent(cutout)}&echo=${encodeURIComponent(echo)}`, { method: 'POST' });
export const preparedProxyUrl = (id: number, steady: boolean, backwards: boolean, echo: string, cutout: string) => `/api/photos/${id}/prepared-proxy?steady=${steady}&backwards=${backwards}&cutout=${encodeURIComponent(cutout)}&echo=${encodeURIComponent(echo)}`;
/** The person's own music from the Music app, sorted into moods. */
export type Mood = 'romantic' | 'happy' | 'birthday' | 'calm' | 'energetic' | 'cinematic' | 'inspiring' | 'songs';
export type LibraryTrack = { id: string; name: string; artist: string | null; genre: string | null; seconds: number; mood: Mood };
export const getMusicLibrary = () => requestJson<{ tracks: LibraryTrack[]; folder: string }>('/api/music-library');
export const musicListenUrl = (id: string) => `/api/music-library/${id}/listen`;
export const takeLibraryTrack = (id: string) => requestJson<{ asset_id: string; duration: number; name: string }>(`/api/music-library/${id}/use`, { method: 'POST' });
/** Each person, or object, found in a video, for choosing who stays in front of a title. */
export type FoundOne = { id: number; label: number; colour: string; centre: [number, number] | null };
export const requestInstances = (id: number, kind: 'people' | 'objects', steady: boolean, backwards: boolean) => requestJson<{ status: 'ready' | 'preparing'; progress?: number; tracks?: FoundOne[] }>(`/api/photos/${id}/instances?kind=${kind}&steady=${steady}&backwards=${backwards}`, { method: 'POST' });
export const instancesPictureUrl = (id: number, kind: 'people' | 'objects', steady: boolean, backwards: boolean) => `/api/photos/${id}/instances/picture?kind=${kind}&steady=${steady}&backwards=${backwards}`;
/** The cleaned copy of a clip's or song's sound, made once on the server. */
const voiceQuery = (source: { media_id?: number; asset_id?: string }) => (source.asset_id ? `asset_id=${source.asset_id}` : `media_id=${source.media_id}`);
export const requestCleanVoice = (source: { media_id?: number; asset_id?: string }) => requestJson<{ status: 'ready' | 'preparing' }>(`/api/clean-voice?${voiceQuery(source)}`, { method: 'POST' });
export const cleanVoiceUrl = (source: { media_id?: number; asset_id?: string }) => `/api/clean-voice?${voiceQuery(source)}`;
export const fetchShapeMask = async (mask: unknown, format: unknown) => {
  const response = await fetch('/api/shape-mask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mask, format }) });
  if (!response.ok) throw new Error('This shape could not be drawn.');
  return URL.createObjectURL(await response.blob());
};
export const startPeopleGrid = (id: number, body: { start: number; end: number; pick: import('../timeline/model').CutoutPick | null; steady: boolean; backwards: boolean }) => requestJson<{ status: 'ready' | 'preparing'; job_id?: string; grid?: import('../timeline/keepClear').PeopleGrid }>(`/api/photos/${id}/people-grid`, { method: 'POST', body: JSON.stringify(body) });
export const startSceneTrack = (id: number, body: { at: number; start: number; end: number; horizon?: boolean }) => requestJson<{ status: 'ready' | 'preparing'; job_id?: string; track?: import('../timeline/title3d').SceneTrack }>(`/api/photos/${id}/scene-track`, { method: 'POST', body: JSON.stringify(body) });
export const startTracking = (id: number, body: { at: number; start: number; end: number; box: [number, number, number, number] }) => requestJson<{ job_id: string }>(`/api/photos/${id}/track`, { method: 'POST', body: JSON.stringify(body) });
export const startWords = (id: number, language: string) => requestJson<{ job_id: string }>(`/api/photos/${id}/words?language=${language}`, { method: 'POST' });
export const clipFilmstripUrl = (id: number) => `/api/photos/${id}/filmstrip`;
export const getClipPeaks = (id: number) => requestJson<{ peaks_per_second: number; peaks: number[] }>(`/api/photos/${id}/peaks`);
export const getProjectTimeline = <T>(id: number) => requestJson<T>(`/api/projects/${id}/timeline`);
export const exportProjectTimeline = (id: number, timeline: unknown, hardware = true) => requestJson<{ job_id: string }>(`/api/projects/${id}/export?hardware=${hardware}`, { method: 'POST', body: JSON.stringify(timeline) });
/** Phone access on the home Wi-Fi, with a PIN. Only the Mac can read or change it. */
export type PhoneAccess = { enabled: boolean; pin: string | null; locked: boolean; address: string | null; port: number; listening: boolean; phones: number };
export const getPhoneAccess = () => requestJson<PhoneAccess>('/api/phone');
export const setPhoneAccess = (enabled: boolean) => requestJson<PhoneAccess>('/api/phone', { method: 'POST', body: JSON.stringify({ enabled }) });
export const newPhonePin = () => requestJson<PhoneAccess>('/api/phone/new-pin', { method: 'POST' });
