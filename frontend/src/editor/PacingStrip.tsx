import { useEffect, useMemo, useRef, useState } from 'react';
import { getSongBeats } from '../api/client';
import { t } from '../i18n';
import { beatSound, timelineBeats } from '../timeline/beats';
import { clipLength, mainLayer, soundLength, type Clip, type Sound, type Timeline } from '../timeline/model';
import type { ClipVisuals } from './TimelineView';

const PAD = 16;
const STRIP_HEIGHT = 34;
const MIN_SLOW_SECONDS = 4;
const beatCache = new Map<string, number[]>();

type Props = {
  timeline: Timeline;
  selectedId: string | null;
  zoom: number;
  theme: string;
  soundPeaks: (sound: Sound) => ClipVisuals['peaks'];
  onSelect: (id: string | null) => void;
  onSeek: (t: number) => void;
  scrollRef?: React.RefObject<HTMLDivElement>;
  onScroll?: (scrollLeft: number) => void;
  fileName?: (clip: Clip) => string;
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export default function PacingStrip({ timeline, selectedId, zoom, theme, soundPeaks, onSelect, onSeek, scrollRef, onScroll, fileName }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const localScrollRef = useRef<HTMLDivElement>(null);
  const scroller = scrollRef ?? localScrollRef;
  const [beats, setBeats] = useState<number[]>([]);

  const song = useMemo(() => beatSound(timeline), [timeline]);
  const mainClips = useMemo(() => [...mainLayer(timeline).items].sort((a, b) => a.start - b.start), [timeline]);
  const slowThreshold = useMemo(() => {
    const lengths = mainClips.map((c) => clipLength(c));
    return Math.max(MIN_SLOW_SECONDS, median(lengths) * 1.5);
  }, [mainClips]);

  useEffect(() => {
    if (!song?.asset_id) { setBeats([]); return; }
    const cached = beatCache.get(song.asset_id);
    if (cached) { setBeats(cached); return; }
    let cancelled = false;
    getSongBeats(song.asset_id).then((res) => {
      beatCache.set(song.asset_id, res.beats);
      if (!cancelled) setBeats(res.beats);
    }).catch(() => {
      if (!cancelled) setBeats([]);
    });
    return () => { cancelled = true; };
  }, [song?.asset_id]);

  const beatTimes = useMemo(() => (song ? timelineBeats(song, beats) : []), [song, beats]);
  const total = useMemo(() => mainClips.reduce((m, c) => Math.max(m, c.start + clipLength(c)), 0), [mainClips]);
  const contentWidth = Math.max(320, Math.ceil(PAD * 2 + total * zoom));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = contentWidth;
    const h = STRIP_HEIGHT;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const style = getComputedStyle(canvas);
    const accent = style.getPropertyValue('--accent-text').trim() || '#3b82f6';
    const isDark = theme === 'dark';

    // 1. Clip length bars (highlight slow/long clips)
    for (const clip of mainClips) {
      const len = clipLength(clip);
      const x = PAD + clip.start * zoom;
      const cw = Math.max(2, len * zoom - 1);
      const slow = len >= slowThreshold;
      const isSelected = clip.id === selectedId;

      ctx.fillStyle = slow
        ? (isDark ? 'rgba(245, 158, 11, 0.36)' : 'rgba(245, 158, 11, 0.32)')
        : (isDark ? 'rgba(148, 163, 184, 0.18)' : 'rgba(100, 116, 139, 0.14)');
      ctx.fillRect(x, 3, cw, h - 6);

      if (slow) {
        ctx.fillStyle = isDark ? 'rgba(251, 191, 36, 0.85)' : 'rgba(217, 119, 6, 0.85)';
        ctx.fillRect(x, 3, cw, 2.5);
      }
      if (isSelected) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.75, 3.75, Math.max(1, cw - 1.5), h - 7.5);
      }
    }

    // 2. Music loudness (soundPeaks)
    if (song) {
      const peaksData = soundPeaks(song);
      if (peaksData?.peaks.length) {
        const { peaks, peaks_per_second } = peaksData;
        const sStart = song.start;
        const sLen = soundLength(song);
        const x0 = PAD + sStart * zoom;
        const x1 = PAD + (sStart + sLen) * zoom;
        ctx.beginPath();
        ctx.moveTo(x0, h - 3);
        const stepPx = 2;
        for (let px = x0; px <= x1; px += stepPx) {
          const tSec = (px - PAD) / zoom;
          const srcSec = song.in + (tSec - sStart) * song.speed;
          const idx = Math.min(peaks.length - 1, Math.max(0, Math.floor(srcSec * peaks_per_second)));
          const amp = peaks[idx] ?? 0;
          const y = h - 3 - amp * (h - 10);
          ctx.lineTo(px, y);
        }
        ctx.lineTo(x1, h - 3);
        ctx.closePath();
        ctx.fillStyle = isDark ? 'rgba(56, 189, 248, 0.28)' : 'rgba(14, 165, 233, 0.24)';
        ctx.fill();
      }
    }

    // 3. Beat positions
    if (beatTimes.length) {
      ctx.strokeStyle = isDark ? 'rgba(244, 114, 182, 0.75)' : 'rgba(219, 39, 119, 0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const bt of beatTimes) {
        const bx = Math.round(PAD + bt * zoom) + 0.5;
        ctx.moveTo(bx, 2);
        ctx.lineTo(bx, h - 2);
      }
      ctx.stroke();
    }
  }, [beatTimes, contentWidth, mainClips, selectedId, slowThreshold, song, soundPeaks, theme, zoom]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const tSec = Math.max(0, (x - PAD) / zoom);
    const hit = mainClips.find((c) => tSec >= c.start && tSec <= c.start + clipLength(c));
    if (hit) {
      onSelect(hit.id);
    } else {
      onSeek(tSec);
    }
  };

  const slowCount = mainClips.filter((c) => clipLength(c) >= slowThreshold).length;
  const tip = slowCount
    ? `${t('Pacing')}: ${slowCount} ${t('Slow clip')}`
    : t('Pacing');

  return (
    <div className="tl-pacing" role="region" aria-label={t('Pacing')}>
      <div className="tl-pacing-head" title={tip}>
        <span>{t('Pacing')}</span>
      </div>
      <div
        className="tl-pacing-scroll"
        ref={scroller}
        onScroll={(e) => onScroll?.(e.currentTarget.scrollLeft)}
      >
        <canvas
          ref={canvasRef}
          className="tl-pacing-canvas"
          onClick={handleClick}
          title={fileName && selectedId ? undefined : tip}
        />
      </div>
    </div>
  );
}
