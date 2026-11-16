/**
 * The Media panel's hover preview: rest on a tile and a larger card opens beside the panel, with the picture (or the
 * video playing, muted) and what it is: name, size, length, folder, whether it is in the video. Gone on leave.
 */
import { createPortal } from 'react-dom';
import { photoThumbUrl, photoVideoUrl } from '../api/client';
import { timecode } from '../timeline/model';
import type { Photo } from '../types/photo';
import { t } from '../i18n';

export type Peek = { item: Photo; top: number; left: number; used: boolean };
export const PEEK_DELAY = 350;  // ms resting on a tile before the card opens: quick, but not while sweeping past.
const WIDTH = 320;

export function MediaPeek({ peek }: { peek: Peek | null }) {
  if (!peek) return null;
  const { item } = peek;
  const video = item.media_type === 'video';
  const ratio = item.width && item.height ? item.height / item.width : 10 / 16;
  const height = Math.min(320, WIDTH * ratio);
  const top = Math.max(8, Math.min(peek.top, window.innerHeight - height - 90));
  const facts = [item.width && item.height ? `${item.width} × ${item.height}` : null, video && item.duration ? timecode(item.duration).replace(/\.\d+$/, '') : null, item.folder ?? null].filter(Boolean).join(' · ');
  return createPortal(<div className="ed-media-peek" role="tooltip" style={{ top, left: peek.left, width: WIDTH }} data-ed-theme={document.querySelector('.ed')?.getAttribute('data-ed-theme') ?? undefined}>
    {video ? <video src={photoVideoUrl(item.id)} poster={photoThumbUrl(item.id)} autoPlay muted loop playsInline style={{ height }}/> : <img src={photoThumbUrl(item.id)} alt="" style={{ height }}/>}
    <b>{item.filename}</b>
    <small>{facts}{peek.used ? ` · ${t('In your video')}` : ''}</small>
  </div>, document.querySelector('.ed') ?? document.body);
}
