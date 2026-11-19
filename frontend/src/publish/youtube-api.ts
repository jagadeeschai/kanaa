import { requestJson } from '../api/client';

export type YouTubeStatus = { client: boolean; connected: boolean; channel: string | null; channel_id: string | null };
export type PublishRequest = { media_id: number; title: string; description: string; tags: string[]; category: string; language?: string | null;
  privacy: 'private' | 'unlisted' | 'public'; publish_at?: string | null; made_for_kids: boolean; captions: { language: string; name: string; srt: string }[]; playlist_id?: string | null };
export type PublishResult = { youtube_id?: string; youtube_url?: string; studio_url?: string; notes?: string[] };

export const getYouTube = () => requestJson<YouTubeStatus>('/api/youtube');
export const saveYouTubeClient = (json_text: string) => requestJson<YouTubeStatus>('/api/youtube/client', { method: 'PUT', body: JSON.stringify({ json_text }) });
export const connectYouTube = () => requestJson<{ url: string }>('/api/youtube/connect', { method: 'POST' });
export const disconnectYouTube = () => requestJson<YouTubeStatus>('/api/youtube', { method: 'DELETE' });
export const getPlaylists = () => requestJson<{ id: string; title: string }[]>('/api/youtube/playlists');
export const publishToYouTube = (body: PublishRequest) => requestJson<{ job_id: string }>('/api/youtube/publish', { method: 'POST', body: JSON.stringify(body) });
