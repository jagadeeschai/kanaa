import { useEffect, useRef } from 'react';
import { clipLength, mainLayer, snap, snapPoints, timecode, trimClip, moveClip, type Clip, type SourceFacts, type Timeline } from '../timeline/model';

export type ClipVisuals = { filmstrip?: { image: HTMLImageElement; tiles: number; tile_width: number; tile_height: number }; peaks?: { peaks_per_second: number; peaks: number[] } };
type Props = {
  timeline: Timeline; selectedId: string | null; zoom: number;
  visuals: (mediaId: number) => ClipVisuals; source: (mediaId: number) => SourceFacts | undefined;
  playhead: { current: number };
  onSelect: (id: string | null) => void; onSeek: (t: number) => void;
  onChange: (next: Timeline, group: string) => void; onScrubStart: () => void;
};
type Drag = { kind: 'seek' } | { kind: 'trim'; id: string; edge: 'in' | 'out'; startX: number; origin: Clip; base: Timeline; group: string } | { kind: 'move'; id: string; startX: number; moved: boolean; base: Timeline; group: string };

const RULER = 26; const TRACK_TOP = 34; const TRACK_HEIGHT = 74; const HANDLE = 9; const PAD = 16; const SNAP_PIXELS = 8;
const COLORS = { ruler: '#8e8aa3', tick: '#3b3850', clip: '#2c2940', clipEdge: '#4a4566', selected: '#a78bfa', wave: '#c4b5fd', head: '#fbbf24', name: '#f4f2ff' };

export default function TimelineView({ timeline, selectedId, zoom, visuals, source, playhead, onSelect, onSeek, onChange, onScrubStart }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const props = useRef({ timeline, selectedId, zoom, visuals, source });
  props.current = { timeline, selectedId, zoom, visuals, source };
  const dragRef = useRef<Drag | null>(null);
  const groupCount = useRef(0);

  const xOf = (t: number) => PAD + t * props.current.zoom;
  const timeOf = (x: number) => Math.max(0, (x - PAD) / props.current.zoom);

  useEffect(() => {
    const canvas = canvasRef.current!; const host = hostRef.current!; const context = canvas.getContext('2d')!;
    let frame = 0;
    const drawClip = (clip: Clip, x: number, width: number) => {
      const { selectedId: selected, visuals: look } = props.current;
      const y = TRACK_TOP; const h = TRACK_HEIGHT;
      context.save();
      context.beginPath(); context.roundRect(x, y, Math.max(2, width), h, 7); context.clip();
      context.fillStyle = COLORS.clip; context.fillRect(x, y, width, h);
      const { filmstrip, peaks } = look(clip.media_id);
      if (filmstrip?.image.complete && filmstrip.image.naturalWidth) {
        const tileWidth = (h * 0.72) * (filmstrip.tile_width / filmstrip.tile_height);
        for (let left = 0; left < width; left += tileWidth) {
          if (x + left > host.scrollLeft + host.clientWidth || x + left + tileWidth < host.scrollLeft) continue;
          const sourceTime = clip.in + (left / width) * (clip.out - clip.in);
          const span = (props.current.source(clip.media_id)?.duration ?? clip.out) || 1;
          const tile = Math.min(filmstrip.tiles - 1, Math.floor((sourceTime / span) * filmstrip.tiles));
          context.drawImage(filmstrip.image, tile * filmstrip.tile_width, 0, filmstrip.tile_width, filmstrip.tile_height, x + left, y, tileWidth, h * 0.72);
        }
      }
      if (peaks?.peaks.length) {
        context.fillStyle = 'rgba(16,14,26,.72)'; context.fillRect(x, y + h * 0.72, width, h * 0.28);
        context.fillStyle = COLORS.wave;
        const base = y + h - 2; const room = h * 0.26;
        for (let px = 0; px < width; px += 2) {
          if (x + px > host.scrollLeft + host.clientWidth || x + px < host.scrollLeft) continue;
          const index = Math.floor((clip.in + (px / width) * (clip.out - clip.in)) * peaks.peaks_per_second);
          context.fillRect(x + px, base - ((peaks.peaks[index] ?? 0) / 255) * room, 1, ((peaks.peaks[index] ?? 0) / 255) * room + 1);
        }
      }
      context.restore();
      context.lineWidth = clip.id === selected ? 2 : 1;
      context.strokeStyle = clip.id === selected ? COLORS.selected : COLORS.clipEdge;
      context.beginPath(); context.roundRect(x + .5, y + .5, Math.max(2, width - 1), h - 1, 7); context.stroke();
      if (clip.id === selected) {
        context.fillStyle = COLORS.selected;
        for (const left of [x, x + width - 6]) { context.beginPath(); context.roundRect(left, y + 2, 6, h - 4, 3); context.fill(); }
      }
    };
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const shown = props.current.timeline;
      const dpr = window.devicePixelRatio || 1;
      const clips = mainLayer(shown).items;
      const end = clips.reduce((longest, clip) => Math.max(longest, clip.start + clipLength(clip)), 0);
      const width = Math.max(host.clientWidth, xOf(end) + 240); const height = host.clientHeight;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const { zoom: scale } = props.current;
      const step = [1, 2, 5, 10, 30, 60, 300].find((seconds) => seconds * scale >= 70) ?? 600;
      context.font = '11px Inter, system-ui, sans-serif'; context.textBaseline = 'middle';
      for (let t = 0; xOf(t) < width; t += step) {
        context.fillStyle = COLORS.tick; context.fillRect(xOf(t), RULER - 8, 1, 8);
        context.fillStyle = COLORS.ruler; context.fillText(timecode(t).replace(/\.\d+$/, ''), xOf(t) + 4, 11);
      }
      for (const clip of clips) drawClip(clip, xOf(clip.start), clipLength(clip) * scale);
      const head = xOf(playhead.current);
      context.fillStyle = COLORS.head; context.fillRect(head - 1, 0, 2, height);
      context.beginPath(); context.moveTo(head - 6, 0); context.lineTo(head + 6, 0); context.lineTo(head, 9); context.fill();
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [playhead]);

  const pointerTime = (event: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return event.clientX - rect.left;
  };
  const hit = (x: number, y: number) => {
    if (y < TRACK_TOP || y > TRACK_TOP + TRACK_HEIGHT) return null;
    for (const clip of mainLayer(props.current.timeline).items) {
      const left = xOf(clip.start); const right = left + clipLength(clip) * props.current.zoom;
      if (x < left - 2 || x > right + 2) continue;
      const reach = Math.min(HANDLE, (right - left) / 3);
      return { clip, zone: x - left <= reach ? 'in' as const : right - x <= reach ? 'out' as const : 'body' as const };
    }
    return null;
  };
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const x = pointerTime(event); const y = event.nativeEvent.offsetY;
    event.currentTarget.setPointerCapture(event.pointerId);
    onScrubStart();
    const found = hit(x, y);
    const group = `drag-${groupCount.current += 1}`;
    if (!found) { onSelect(null); dragRef.current = { kind: 'seek' }; onSeek(timeOf(x)); return; }
    onSelect(found.clip.id);
    if (found.zone === 'body') { dragRef.current = { kind: 'move', id: found.clip.id, startX: x, moved: false, base: props.current.timeline, group }; onSeek(timeOf(x)); }
    else dragRef.current = { kind: 'trim', id: found.clip.id, edge: found.zone, startX: x, origin: found.clip, base: props.current.timeline, group };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const x = pointerTime(event); const drag = dragRef.current;
    if (!drag) {
      const zone = hit(x, event.nativeEvent.offsetY)?.zone;
      event.currentTarget.style.cursor = zone === 'in' || zone === 'out' ? 'ew-resize' : zone === 'body' ? 'grab' : 'default';
      return;
    }
    const reach = SNAP_PIXELS / props.current.zoom;
    if (drag.kind === 'seek') onSeek(snap(timeOf(x), snapPoints(props.current.timeline, -1), reach));
    else if (drag.kind === 'trim') {
      const { origin, edge, base, id } = drag;
      const shift = ((x - drag.startX) / props.current.zoom) * origin.speed;
      // In the magnetic track, the trimmed edge's timeline position decides what it snaps to.
      const end = origin.start + clipLength(origin);
      const edgeTime = edge === 'out' ? end + shift / origin.speed : origin.start;
      const snapped = edge === 'out' ? (snap(edgeTime, snapPoints(base, playhead.current, id), reach) - origin.start) * origin.speed + origin.in : origin.in + shift;
      const next = trimClip(base, id, edge, snapped, props.current.source(origin.media_id));
      onChange(next, drag.group);
    } else {
      if (Math.abs(x - drag.startX) > 6) drag.moved = true;
      if (!drag.moved) return;
      const others = mainLayer(drag.base).items.filter((clip) => clip.id !== drag.id);
      const t = timeOf(x);
      const index = others.filter((clip) => clip.start + clipLength(clip) / 2 < t).length;
      const next = moveClip(drag.base, drag.id, index);
      if (next !== props.current.timeline) onChange(next, drag.group);
    }
  };
  const onPointerUp = () => { dragRef.current = null; };

  return <div className="tl-host" ref={hostRef}>
    <canvas ref={canvasRef} aria-label="Timeline. Drag clip edges to trim, drag a clip to reorder, click to move the playhead." onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}/>
  </div>;
}
