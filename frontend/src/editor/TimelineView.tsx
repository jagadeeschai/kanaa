import { useEffect, useLayoutEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, LockOpen, Volume2, VolumeX } from 'lucide-react';
import { isFollowed, keyTimes } from '../timeline/keyframes';
import { clipAt, dropHint, activeDrag, decodePayload, setActiveDrag, DRAG_TYPE, type DragPayload, type DropTarget } from '../timeline/drop';
import { clipLength, isClip, itemLength, MAX_PHOTO_SECONDS, mainLayer, moveItem, snap, snapPoints, soundLength, timecode, overlayLayers, reorderLayer, trackLayers, updateLayer, trimClip, trimSound, trimText, moveClip, captionText, type Clip, type BlurBox, type Caption, type Sound, type TrackLayer, type VideoLayer, type SourceFacts, type TextItem, type Timeline, type TrackItem } from '../timeline/model';

export type ClipVisuals = { filmstrip?: { image: HTMLImageElement; tiles: number; tile_width: number; tile_height: number }; peaks?: { peaks_per_second: number; peaks: number[] } };
type Props = {
  timeline: Timeline; selectedId: string | null; zoom: number; theme: string;
  visuals: (mediaId: number) => ClipVisuals; soundPeaks: (sound: Sound) => ClipVisuals['peaks']; source: (mediaId: number) => SourceFacts | undefined;
  playhead: { current: number };
  onSelect: (id: string | null) => void; onSeek: (t: number) => void;
  onChange: (next: Timeline, group: string) => void; onScrubStart: () => void;
  onItemMenu: (id: string | null, t: number, x: number, y: number) => void;
  /** Something from the side panel was dropped on the timeline. */
  onDropPayload?: (payload: DragPayload, target: DropTarget) => void;
};
type Drag = { kind: 'soundMove'; id: string; startX: number; origin: TrackItem; base: Timeline; group: string } | { kind: 'soundTrim'; id: string; edge: 'in' | 'out'; startX: number; origin: TrackItem; base: Timeline; group: string } | { kind: 'seek' } | { kind: 'trim'; id: string; edge: 'in' | 'out'; startX: number; origin: Clip; base: Timeline; group: string } | { kind: 'move'; id: string; startX: number; moved: boolean; base: Timeline; group: string };

const RULER = 26; const TRACK_TOP = 34; const TRACK_HEIGHT = 74; const SOUND_HEIGHT = 36; const SOUND_GAP = 4; const BASE_HEIGHT = 128; const HANDLE = 9; const PAD = 16; const SNAP_PIXELS = 8;
type Colors = Record<'ruler' | 'rulerBg' | 'tick' | 'clip' | 'clipEdge' | 'selected' | 'wave' | 'band' | 'veil' | 'sound' | 'soundEdge' | 'text' | 'textEdge' | 'soundWave' | 'fade' | 'name' | 'head', string>;
const TOKENS: Colors = { ruler: '--ruler-text', rulerBg: '--ruler-bg', tick: '--hairline', clip: '--clip', clipEdge: '--clip-edge', selected: '--accent-text', wave: '--clip-wave', band: '--wave-band', veil: '--veil', sound: '--sound', soundEdge: '--sound-edge', text: '--text-item', textEdge: '--text-item-edge', soundWave: '--sound-wave', fade: '--fade', name: '--clip-label', head: '--playhead' };
/** The canvas can't use CSS variables directly, so they are read once per theme. */
const readColors = (element: HTMLElement) => {
  const style = getComputedStyle(element);
  return Object.fromEntries(Object.entries(TOKENS).map(([key, token]) => [key, style.getPropertyValue(token).trim()])) as Colors;
};

const rowHeight = (layer: TrackLayer) => layer.kind === 'video' ? TRACK_HEIGHT : SOUND_HEIGHT;
const rowTop = (layers: TrackLayer[], row: number) => TRACK_TOP + TRACK_HEIGHT + SOUND_GAP + layers.slice(0, row).reduce((sum, layer) => sum + rowHeight(layer) + SOUND_GAP, 0);

export default function TimelineView({ timeline, selectedId, zoom, theme, visuals, soundPeaks, source, playhead, onSelect, onSeek, onChange, onScrubStart, onItemMenu, onDropPayload }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const props = useRef({ timeline, selectedId, zoom, visuals, soundPeaks, source });
  props.current = { timeline, selectedId, zoom, visuals, soundPeaks, source };
  const dragRef = useRef<Drag | null>(null);
  const colors = useRef(TOKENS);
  useLayoutEffect(() => { colors.current = readColors(hostRef.current!); }, [theme]);
  const groupCount = useRef(0);
  /** Where a dragged tile would land, drawn as a line and a hint while it hovers. */
  const dropRef = useRef<{ x: number; zone: DropTarget['zone']; hint: string; clipId: string | null } | null>(null);

  const xOf = (t: number) => PAD + t * props.current.zoom;
  const timeOf = (x: number) => Math.max(0, (x - PAD) / props.current.zoom);
  const topOf = (row: number) => rowTop(trackLayers(props.current.timeline), row);

  useEffect(() => {
    const canvas = canvasRef.current!; const host = hostRef.current!; const context = canvas.getContext('2d')!;
    let frame = 0;
    const drawClip = (clip: Clip, x: number, width: number) => {
      const { selectedId: selected, visuals: look } = props.current;
      const y = TRACK_TOP; const h = TRACK_HEIGHT;
      context.save();
      context.beginPath(); context.roundRect(x, y, Math.max(2, width), h, 7); context.clip();
      context.fillStyle = colors.current.clip; context.fillRect(x, y, width, h);
      context.globalAlpha = clip.enabled === false ? 0.24 : 1;
      const { filmstrip, peaks: allPeaks } = look(clip.media_id);
      const peaks = clip.muted ? undefined : allPeaks;
      if (filmstrip?.image.complete && filmstrip.image.naturalWidth) {
        const tileWidth = (h * 0.72) * (filmstrip.tile_width / filmstrip.tile_height);
        for (let left = 0; left < width; left += tileWidth) {
          if (x + left > host.scrollLeft + host.clientWidth || x + left + tileWidth < host.scrollLeft) continue;
          const sourceTime = clip.freeze ?? (clip.reverse ? clip.out - (left / width) * (clip.out - clip.in) : clip.in + (left / width) * (clip.out - clip.in));
          const span = (props.current.source(clip.media_id)?.duration ?? clip.out) || 1;
          const tile = Math.min(filmstrip.tiles - 1, Math.floor((sourceTime / span) * filmstrip.tiles));
          context.drawImage(filmstrip.image, tile * filmstrip.tile_width, 0, filmstrip.tile_width, filmstrip.tile_height, x + left, y, tileWidth, h * 0.72);
        }
      }
      if (peaks?.peaks.length) {
        context.fillStyle = colors.current.band; context.fillRect(x, y + h * 0.72, width, h * 0.28);
        context.fillStyle = colors.current.wave;
        const base = y + h - 2; const room = h * 0.26;
        for (let px = 0; px < width; px += 2) {
          if (x + px > host.scrollLeft + host.clientWidth || x + px < host.scrollLeft) continue;
          const index = Math.floor((clip.in + (px / width) * (clip.out - clip.in)) * peaks.peaks_per_second);
          context.fillRect(x + px, base - ((peaks.peaks[index] ?? 0) / 255) * room, 1, ((peaks.peaks[index] ?? 0) / 255) * room + 1);
        }
      }
      context.restore();
      if (clip.enabled === false) { context.save(); context.globalAlpha = 0.58; context.fillStyle = colors.current.veil; context.fillRect(x, y, width, h); context.globalAlpha = 1; context.fillStyle = colors.current.name; context.font = '600 11px Inter, system-ui, sans-serif'; context.fillText('Inactive', x + 8, y + 13); context.restore(); }
      context.lineWidth = clip.id === selected ? 2 : 1;
      context.strokeStyle = clip.id === selected ? colors.current.selected : colors.current.clipEdge;
      context.beginPath(); context.roundRect(x + .5, y + .5, Math.max(2, width - 1), h - 1, 7); context.stroke();
      if (clip.id === selected) {
        context.fillStyle = colors.current.selected;
        for (const left of [x, x + width - 6]) { context.beginPath(); context.roundRect(left, y + 2, 6, h - 4, 3); context.fill(); }
      }
    };
    const drawSound = (sound: Sound, row: number, layerMuted: boolean) => {
      const { selectedId: selected, zoom: scale, soundPeaks: look } = props.current;
      const x = xOf(sound.start); const width = Math.max(2, soundLength(sound) * scale); const y = topOf(row); const h = SOUND_HEIGHT;
      const quiet = sound.muted || layerMuted;
      context.save();
      context.beginPath(); context.roundRect(x, y, width, h, 6); context.clip();
      context.fillStyle = colors.current.sound; context.fillRect(x, y, width, h);
      context.globalAlpha = quiet ? 0.3 : 1;
      const peaks = look(sound);
      if (peaks?.peaks.length) {
        context.fillStyle = colors.current.soundWave;
        const middle = y + h / 2;
        for (let px = Math.max(0, -x); px < Math.min(width, host.scrollLeft + host.clientWidth - x); px += 2) {
          const index = Math.floor((sound.in + (px / width) * (sound.out - sound.in)) * peaks.peaks_per_second);
          const size = ((peaks.peaks[index] ?? 0) / 255) * (h / 2 - 2) * Math.min(1, sound.volume);
          context.fillRect(x + px, middle - size, 1, size * 2 + 1);
        }
      }
      context.globalAlpha = 1;
      context.fillStyle = colors.current.fade;
      if (sound.fade_in) { context.beginPath(); context.moveTo(x, y); context.lineTo(x + sound.fade_in * scale, y); context.lineTo(x, y + h); context.fill(); }
      if (sound.fade_out) { context.beginPath(); context.moveTo(x + width, y); context.lineTo(x + width - sound.fade_out * scale, y); context.lineTo(x + width, y + h); context.fill(); }
      context.fillStyle = colors.current.name; context.font = '10px Inter, system-ui, sans-serif';
      context.fillText(`${quiet ? 'Muted · ' : ''}${sound.duck ? 'Dips · ' : ''}${sound.name}`, x + 8, y + 9);
      context.restore();
      context.lineWidth = sound.id === selected ? 2 : 1;
      context.strokeStyle = sound.id === selected ? colors.current.selected : colors.current.soundEdge;
      context.beginPath(); context.roundRect(x + .5, y + .5, width - 1, h - 1, 6); context.stroke();
      if (sound.id === selected) {
        context.fillStyle = colors.current.selected;
        for (const left of [x, x + width - 6]) { context.beginPath(); context.roundRect(left, y + 2, 6, h - 4, 3); context.fill(); }
      }
    };
    const drawBlur = (blur: BlurBox, row: number) => {
      const { selectedId: selected, zoom: scale } = props.current;
      const x = xOf(blur.start); const width = Math.max(2, blur.length * scale); const y = topOf(row); const h = SOUND_HEIGHT;
      context.save();
      context.beginPath(); context.roundRect(x, y, width, h, 6); context.clip();
      context.fillStyle = colors.current.text; context.fillRect(x, y, width, h);
      context.fillStyle = colors.current.band;
      for (let left = x - h; left < x + width; left += 10) { context.beginPath(); context.moveTo(left, y + h); context.lineTo(left + h, y); context.lineTo(left + h + 4, y); context.lineTo(left + 4, y + h); context.fill(); }
      context.fillStyle = colors.current.name; context.font = '12px Inter, system-ui, sans-serif';
      context.fillText(blur.style === 'pixelate' ? 'Pixelate' : 'Blur', x + 8, y + h / 2);
      context.restore();
      context.lineWidth = blur.id === selected ? 2 : 1;
      context.strokeStyle = blur.id === selected ? colors.current.selected : colors.current.textEdge;
      context.beginPath(); context.roundRect(x + .5, y + .5, width - 1, h - 1, 6); context.stroke();
      if (blur.id === selected) {
        context.fillStyle = colors.current.selected;
        for (const left of [x, x + width - 6]) { context.beginPath(); context.roundRect(left, y + 2, 6, h - 4, 3); context.fill(); }
      }
      drawKeys(blur.id, blur.transform, blur.length, x, y + h);
    };
    const drawCaption = (caption: Caption, row: number) => drawText({ id: caption.id, start: caption.start, length: caption.length, text: captionText(caption) } as TextItem, row);
    const drawText = (text: TextItem, row: number) => {
      const { selectedId: selected, zoom: scale } = props.current;
      const x = xOf(text.start); const width = Math.max(2, text.length * scale); const y = topOf(row); const h = SOUND_HEIGHT;
      context.save();
      context.beginPath(); context.roundRect(x, y, width, h, 6); context.clip();
      context.fillStyle = colors.current.text; context.fillRect(x, y, width, h);
      context.fillStyle = colors.current.name; context.font = '12px "Noto Sans Tamil", Inter, system-ui, sans-serif';
      context.fillText(text.text, x + 8, y + h / 2);
      context.restore();
      context.lineWidth = text.id === selected ? 2 : 1;
      context.strokeStyle = text.id === selected ? colors.current.selected : colors.current.textEdge;
      context.beginPath(); context.roundRect(x + .5, y + .5, width - 1, h - 1, 6); context.stroke();
      if (text.id === selected) {
        context.fillStyle = colors.current.selected;
        for (const left of [x, x + width - 6]) { context.beginPath(); context.roundRect(left, y + 2, 6, h - 4, 3); context.fill(); }
      }
      if (text.transform) drawKeys(text.id, text.transform, text.length, x, y + h);
    };
    const drawKeys = (id: string, transform: Clip['transform'], length: number, x: number, bottom: number) => {
      if (id !== props.current.selectedId) return;
      context.fillStyle = colors.current.head;
      if (isFollowed(transform)) {
        // Following puts a key on every frame: one thin bar shows where it follows instead of a row of diamonds.
        const times = keyTimes(transform, 'position').filter((t) => t <= length);
        context.globalAlpha = 0.7; context.fillRect(x + times[0] * props.current.zoom, bottom - 8, Math.max(2, (times[times.length - 1] - times[0]) * props.current.zoom), 2); context.globalAlpha = 1;
        return;
      }
      for (const t of keyTimes(transform)) {
        if (t > length) continue;
        const middle = x + t * props.current.zoom;
        context.beginPath(); context.moveTo(middle, bottom - 11); context.lineTo(middle + 4, bottom - 7); context.lineTo(middle, bottom - 3); context.lineTo(middle - 4, bottom - 7); context.fill();
      }
    };
    const drawOverlay = (clip: Clip, row: number) => {
      const { selectedId: selected, zoom: scale, visuals: look } = props.current;
      const x = xOf(clip.start); const width = Math.max(2, clipLength(clip) * scale); const y = topOf(row); const h = TRACK_HEIGHT;
      context.save();
      context.beginPath(); context.roundRect(x, y, width, h, 6); context.clip();
      context.fillStyle = colors.current.clip; context.fillRect(x, y, width, h);
      context.globalAlpha = clip.enabled === false ? 0.24 : 1;
      const { filmstrip } = look(clip.media_id);
      if (filmstrip?.image.complete && filmstrip.image.naturalWidth) {
        const tile = h * (filmstrip.tile_width / filmstrip.tile_height);
        for (let left = 0; left < width; left += tile) context.drawImage(filmstrip.image, 0, 0, filmstrip.tile_width, filmstrip.tile_height, x + left, y, tile, h);
      }
      context.restore();
      if (clip.enabled === false) { context.save(); context.globalAlpha = 0.58; context.fillStyle = colors.current.veil; context.fillRect(x, y, width, h); context.globalAlpha = 1; context.fillStyle = colors.current.name; context.font = '600 11px Inter, system-ui, sans-serif'; context.fillText('Inactive', x + 8, y + 13); context.restore(); }
      context.lineWidth = clip.id === selected ? 2 : 1;
      context.strokeStyle = clip.id === selected ? colors.current.selected : colors.current.clipEdge;
      context.beginPath(); context.roundRect(x + .5, y + .5, width - 1, h - 1, 6); context.stroke();
      if (clip.id === selected) {
        context.fillStyle = colors.current.selected;
        for (const left of [x, x + width - 6]) { context.beginPath(); context.roundRect(left, y + 2, 6, h - 4, 3); context.fill(); }
      }
      drawKeys(clip.id, clip.transform, clipLength(clip), x, y + h);
    };
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const shown = props.current.timeline;
      const dpr = window.devicePixelRatio || 1;
      const clips = mainLayer(shown).items;
      const tracks = trackLayers(shown);
      const end = Math.max(clips.reduce((longest, clip) => Math.max(longest, clip.start + clipLength(clip)), 0),
        ...tracks.flatMap((layer) => (layer.items as TrackItem[]).map((item) => item.start + itemLength(item))));
      const width = Math.max(host.clientWidth, xOf(end) + 240); const height = host.clientHeight;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const { zoom: scale } = props.current;
      context.fillStyle = colors.current.rulerBg; context.fillRect(0, 0, width, RULER);
      const step = [1, 2, 5, 10, 30, 60, 300].find((seconds) => seconds * scale >= 70) ?? 600;
      context.font = '11px Inter, system-ui, sans-serif'; context.textBaseline = 'middle';
      for (let t = 0; xOf(t) < width; t += step) {
        context.fillStyle = colors.current.tick; context.fillRect(xOf(t), RULER - 8, 1, 8);
        context.fillStyle = colors.current.ruler; context.fillText(timecode(t).replace(/\.\d+$/, ''), xOf(t) + 4, 11);
      }
      for (const clip of clips) { drawClip(clip, xOf(clip.start), clipLength(clip) * scale); drawKeys(clip.id, clip.transform, clipLength(clip), xOf(clip.start), TRACK_TOP + TRACK_HEIGHT); }
      const veil = (hidden: boolean | undefined, y: number, h: number) => { if (hidden) { context.fillStyle = colors.current.veil; context.fillRect(0, y, width, h); } };
      veil(mainLayer(shown).hidden, TRACK_TOP, TRACK_HEIGHT);
      tracks.forEach((layer, row) => {
        if (layer.kind === 'video') for (const clip of layer.items) drawOverlay(clip, row);
        else if (layer.kind === 'text') for (const text of layer.items) drawText(text, row);
        else if (layer.kind === 'blur') for (const blur of layer.items) drawBlur(blur, row);
        else if (layer.kind === 'captions') for (const caption of layer.items) drawCaption(caption, row);
        else for (const sound of layer.items) drawSound(sound, row, Boolean(layer.muted));
        veil(layer.hidden, rowTop(tracks, row), rowHeight(layer));
      });
      const drop = dropRef.current;
      if (drop) {
        context.fillStyle = colors.current.selected;
        const target = drop.clipId ? [mainLayer(shown), ...overlayLayers(shown)].flatMap((layer) => layer.items).find((clip) => clip.id === drop.clipId) : undefined;
        if (target && drop.zone === 'main' && drop.hint !== 'Insert here') {
          context.globalAlpha = 0.25; context.fillRect(xOf(target.start), TRACK_TOP, clipLength(target) * scale, TRACK_HEIGHT); context.globalAlpha = 1;
        } else {
          const y = drop.zone === 'main' ? TRACK_TOP : TRACK_TOP + TRACK_HEIGHT;
          context.fillRect(drop.x - 1.5, drop.zone === 'main' ? y : RULER, 3, drop.zone === 'main' ? TRACK_HEIGHT : height - RULER);
        }
        context.font = '600 12px Inter, system-ui, sans-serif';
        const label = drop.hint; const w = context.measureText(label).width + 14;
        const lx = Math.min(Math.max(drop.x + 6, 4), width - w - 4);
        context.beginPath(); context.roundRect(lx, RULER + 2, w, 20, 6); context.fill();
        context.fillStyle = colors.current.rulerBg; context.fillText(label, lx + 7, RULER + 12);
      }
      const head = xOf(playhead.current);
      context.fillStyle = colors.current.head; context.fillRect(head - 1, 0, 2, height);
      context.beginPath(); context.moveTo(head - 6, 0); context.lineTo(head + 6, 0); context.lineTo(head, 9); context.fill();
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [playhead]);

  const pointerTime = (event: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return event.clientX - rect.left;
  };
  const rowAt = (y: number) => {
    const layers = trackLayers(props.current.timeline);
    return layers.findIndex((layer, row) => y >= rowTop(layers, row) && y < rowTop(layers, row) + rowHeight(layer));
  };
  const hitSound = (x: number, y: number) => {
    const layer = trackLayers(props.current.timeline)[rowAt(y)];
    if (!layer || y < TRACK_TOP + TRACK_HEIGHT) return null;
    for (const sound of layer.items as TrackItem[]) {
      const left = xOf(sound.start); const right = left + itemLength(sound) * props.current.zoom;
      if (x < left - 2 || x > right + 2) continue;
      const reach = Math.min(HANDLE, (right - left) / 3);
      return { sound, zone: x - left <= reach ? 'in' as const : right - x <= reach ? 'out' as const : 'body' as const };
    }
    return null;
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
    // Right-click, and Control-click on a Mac, open the menu. They must never drag or trim.
    if (event.button !== 0 || event.ctrlKey) return;
    const x = pointerTime(event); const y = event.nativeEvent.offsetY;
    event.currentTarget.setPointerCapture(event.pointerId);
    onScrubStart();
    const found = hit(x, y);
    const group = `drag-${groupCount.current += 1}`;
    const foundSound = hitSound(x, y);
    if (foundSound) {
      const { sound, zone } = foundSound;
      onSelect(sound.id);
      if (trackLayers(props.current.timeline)[rowAt(y)]?.locked) return;
      dragRef.current = zone === 'body' ? { kind: 'soundMove', id: sound.id, startX: x, origin: sound, base: props.current.timeline, group }
        : { kind: 'soundTrim', id: sound.id, edge: zone, startX: x, origin: sound, base: props.current.timeline, group };
      return;
    }
    if (!found) {
      // The ruler only moves the playhead, so a clip stays selected while setting keyframes.
      if (y >= TRACK_TOP) onSelect(null);
      dragRef.current = { kind: 'seek' }; onSeek(timeOf(x)); return;
    }
    onSelect(found.clip.id);
    if (mainLayer(props.current.timeline).locked) { onSeek(timeOf(x)); return; }
    if (found.zone === 'body') { dragRef.current = { kind: 'move', id: found.clip.id, startX: x, moved: false, base: props.current.timeline, group }; onSeek(timeOf(x)); }
    else dragRef.current = { kind: 'trim', id: found.clip.id, edge: found.zone, startX: x, origin: found.clip, base: props.current.timeline, group };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const x = pointerTime(event); const drag = dragRef.current;
    if (!drag) {
      const zone = (hit(x, event.nativeEvent.offsetY) ?? hitSound(x, event.nativeEvent.offsetY))?.zone;
      event.currentTarget.style.cursor = zone === 'in' || zone === 'out' ? 'ew-resize' : zone === 'body' ? 'grab' : 'default';
      return;
    }
    const reach = SNAP_PIXELS / props.current.zoom;
    if (drag.kind === 'seek') onSeek(snap(timeOf(x), snapPoints(props.current.timeline, -1), reach));
    else if (drag.kind === 'soundMove') {
      const shift = (x - drag.startX) / props.current.zoom;
      const layer = trackLayers(drag.base)[rowAt(event.nativeEvent.offsetY)];
      const length = itemLength(drag.origin);
      const points = snapPoints(drag.base, playhead.current, drag.id);
      const fromStart = snap(drag.origin.start + shift, points, reach);
      const fromEnd = snap(drag.origin.start + shift + length, points, reach) - length;
      const start = fromStart !== drag.origin.start + shift ? fromStart : fromEnd;
      const next = moveItem(drag.base, drag.id, start, layer?.id);
      if (next !== props.current.timeline) onChange(next, drag.group);
    } else if (drag.kind === 'soundTrim') {
      const { origin, edge, base, id } = drag;
      const end = origin.start + itemLength(origin);
      const edgeTime = (edge === 'in' ? origin.start : end) + (x - drag.startX) / props.current.zoom;
      const snapped = snap(edgeTime, snapPoints(base, playhead.current, id), reach);
      if ('length' in origin) onChange(trimText(base, id, edge, snapped), drag.group);
      else {
        const facts = isClip(origin) ? props.current.source(origin.media_id) : undefined;
        const limit = facts ? (facts.media_type === 'image' ? MAX_PHOTO_SECONDS : facts.duration ?? undefined) : undefined;
        onChange(trimSound(base, id, edge, edge === 'in' ? origin.in + (snapped - origin.start) * origin.speed : origin.out + (snapped - end) * origin.speed, limit), drag.group);
      }
    } else if (drag.kind === 'trim') {
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
  const onContextMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault(); event.stopPropagation();
    const x = event.clientX - canvasRef.current!.getBoundingClientRect().left; const y = event.nativeEvent.offsetY;
    const item = hitSound(x, y)?.sound.id ?? hit(x, y)?.clip.id ?? null;
    if (item) onSelect(item);
    onItemMenu(item, timeOf(x), event.clientX, event.clientY);
  };
  const onPointerUp = () => { dragRef.current = null; };
  /** Main track (and the ruler above it) inserts; anything below goes on top as an overlay, title or sound. */
  const dropTarget = (event: React.DragEvent<HTMLCanvasElement>): DropTarget => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = event.clientX - rect.left; const y = event.clientY - rect.top;
    const zone = y <= TRACK_TOP + TRACK_HEIGHT ? 'main' as const : 'above' as const;
    const time = timeOf(x);
    const timeline = props.current.timeline;
    const clip = clipAt(timeline, time, zone) ?? (zone === 'above' ? clipAt(timeline, time, 'main') : null);
    return { zone, time, clipId: clip?.id ?? null };
  };
  const onDragOver = (event: React.DragEvent<HTMLCanvasElement>) => {
    const payload = activeDrag();
    if (!payload || !onDropPayload) return;
    const target = dropTarget(event);
    const hint = dropHint(props.current.timeline, payload, target);
    if (!hint) { dropRef.current = null; event.dataTransfer.dropEffect = 'none'; return; }
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
    dropRef.current = { x: xOf(target.time), zone: target.zone, hint, clipId: target.clipId };
  };
  const onDrop = (event: React.DragEvent<HTMLCanvasElement>) => {
    const payload = decodePayload(event.dataTransfer.getData(DRAG_TYPE)) ?? activeDrag();
    dropRef.current = null; setActiveDrag(null);
    if (!payload || !onDropPayload) return;
    event.preventDefault();
    const target = dropTarget(event);
    if (dropHint(props.current.timeline, payload, target)) onDropPayload(payload, target);
  };

  const tracks = trackLayers(timeline);
  const main = mainLayer(timeline);
  const change = (next: Timeline) => onChange(next, `layer-${groupCount.current += 1}`);
  const head = (layer: VideoLayer | TrackLayer, top: number, height: number) => <LayerHead key={layer.id} layer={layer} top={top} height={height} isMain={layer === main}
    position={layer.kind === 'video' && layer !== main ? overlayLayers(timeline).findIndex((entry) => entry.id === layer.id) : -1} overlays={overlayLayers(timeline).length}
    onToggle={(changes) => change(updateLayer(timeline, layer.id, changes))} onMove={(direction) => change(reorderLayer(timeline, layer.id, direction))}/>;
  return <div className="tl-host">
    <div className="tl-rows" style={{ height: BASE_HEIGHT + tracks.reduce((sum, layer) => sum + rowHeight(layer) + SOUND_GAP, 0) }}>
      <div className="tl-heads">{head(main, TRACK_TOP, TRACK_HEIGHT)}{tracks.map((layer, row) => head(layer, rowTop(tracks, row), rowHeight(layer)))}</div>
      <div className="tl-scroll" ref={hostRef}>
        <canvas ref={canvasRef} aria-label="Timeline. Drop media, looks, transitions, titles or music here. Drag clip edges to trim, drag a clip to reorder, click to move the playhead." onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onContextMenu={onContextMenu}
          onDragOver={onDragOver} onDragLeave={() => { dropRef.current = null; }} onDrop={onDrop}/>
      </div>
    </div>
  </div>;
}

function LayerHead({ layer, top, height, isMain, position, overlays, onToggle, onMove }: { layer: TrackLayer; top: number; height: number; isMain: boolean; position: number; overlays: number; onToggle: (changes: { hidden?: boolean; locked?: boolean; muted?: boolean }) => void; onMove: (direction: 'forward' | 'back') => void }) {
  const name = isMain ? 'Main' : layer.kind === 'video' ? `Overlay ${position + 1}` : layer.kind === 'text' ? 'Text' : layer.kind === 'blur' ? 'Blur' : layer.kind === 'captions' ? 'Captions' : 'Sound';
  return <div className="tl-head" style={{ top, height }} role="group" aria-label={`${name} layer`}>
    {height > SOUND_HEIGHT && <span>{name}</span>}
    <div>
      {position >= 0 && <>
        <button aria-label={`Bring ${name} forward`} title="Bring forward" disabled={position === overlays - 1} onClick={() => onMove('forward')}><ChevronUp size={13}/></button>
        <button aria-label={`Send ${name} back`} title="Send back" disabled={position === 0} onClick={() => onMove('back')}><ChevronDown size={13}/></button>
      </>}
      {layer.kind !== 'audio' && <button className={layer.hidden ? 'on' : ''} aria-pressed={Boolean(layer.hidden)} aria-label={`Hide ${name}`} title={layer.hidden ? 'Show this layer' : 'Hide this layer'} onClick={() => onToggle({ hidden: !layer.hidden })}>{layer.hidden ? <EyeOff size={13}/> : <Eye size={13}/>}</button>}
      {(layer.kind === 'video' || layer.kind === 'audio') && <button className={layer.muted ? 'on' : ''} aria-pressed={Boolean(layer.muted)} aria-label={`Mute ${name}`} title={layer.muted ? 'Turn sound on' : 'Mute this layer'} onClick={() => onToggle({ muted: !layer.muted })}>{layer.muted ? <VolumeX size={13}/> : <Volume2 size={13}/>}</button>}
      <button className={layer.locked ? 'on' : ''} aria-pressed={Boolean(layer.locked)} aria-label={`Lock ${name}`} title={layer.locked ? 'Unlock this layer' : 'Lock this layer'} onClick={() => onToggle({ locked: !layer.locked })}>{layer.locked ? <Lock size={13}/> : <LockOpen size={13}/>}</button>
    </div>
  </div>;
}
