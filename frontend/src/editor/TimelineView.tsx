import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, MoreHorizontal, Power, SlidersHorizontal, Link2, Link2Off, Eye, EyeOff, Lock, LockOpen, Music, Plus, Trash2, Type, Video, Volume2, VolumeX, X } from 'lucide-react';
import { TRANSITION_ICONS, transitionLabel } from './transition-catalog';
import { ContextMenu, type MenuItem, type MenuState } from './ContextMenu';
import { t } from '../i18n';
import { isFollowed, keyTimes } from '../timeline/keyframes';
import { clipAt, dropHint, activeDrag, decodePayload, setActiveDrag, DRAG_TYPE, type DragPayload, type DropTarget } from '../timeline/drop';
import { addLayer, clipLength, isClip, itemLength, MAX_PHOTO_SECONDS, mainLayer, moveItem, removeLayer, clipToLayer, clipToMain, updateClip, snap, snapPoints, soundLength, timecode, overlayLayers, reorderLayer, trackLayers, updateLayer, trimClip, trimSound, trimText, moveClip, captionText, type AddableLayerKind, type Clip, type BlurBox, type Caption, type Sound, type TrackLayer, type VideoLayer, type SourceFacts, type TextItem, type Timeline, type TrackItem } from '../timeline/model';

export type ClipVisuals = { filmstrip?: { image: HTMLImageElement; tiles: number; tile_width: number; tile_height: number }; peaks?: { peaks_per_second: number; peaks: number[] } };
type Props = {
  timeline: Timeline; selectedId: string | null; zoom: number; theme: string;
  /** Opens the settings for a whole text or video layer; the layer shown there is marked. */
  onLayerSettings?: (layerId: string, open?: 'sync') => void; layerSettingsId?: string | null;
  visuals: (mediaId: number) => ClipVisuals; soundPeaks: (sound: Sound) => ClipVisuals['peaks']; source: (mediaId: number) => SourceFacts | undefined;
  playhead: { current: number };
  onSelect: (id: string | null) => void; onSeek: (t: number) => void;
  onChange: (next: Timeline, group: string) => void; onScrubStart: () => void;
  onItemMenu: (id: string | null, t: number, x: number, y: number) => void;
  /** Something from the side panel was dropped on the timeline. */
  onDropPayload?: (payload: DragPayload, target: DropTarget) => void;
  /** A cut's badge was clicked: the clip after the cut, and where the badge is on screen. */
  onCut?: (clipId: string, anchor: DOMRect) => void;
  /** The clip whose cut has its popover open. */
  openCut?: string | null;
  /** Double-click on an item: split it at time `t`. */
  onSplitAt?: (id: string, t: number) => void;
  /** A pinch or Ctrl/⌘ + scroll: multiply the zoom by `factor`. */
  onZoom?: (factor: number) => void;
  /** The file a clip shows, for its label when it has no name of its own. */
  fileName?: (clip: Clip) => string;
  /** The clip being renamed on the timeline, from the item menu; done with its new name (null for the file's). */
  renaming?: string | null;
  onRenamed?: (id: string, name: string | null) => void;
};
/** A held item: a picture of it follows the pointer, and where it would land. */
type Lift = { id: string; x: number; y: number; sx: number; sy: number; dx: number; dy: number; w: number; h: number; picture: HTMLCanvasElement | null;
  target: { kind: 'main'; index: number } | { kind: 'layer'; layerId: string; start: number } | null };
type Drag = { kind: 'soundMove'; id: string; startX: number; origin: TrackItem; base: Timeline; group: string } | { kind: 'soundTrim'; id: string; edge: 'in' | 'out'; startX: number; origin: TrackItem; base: Timeline; group: string } | { kind: 'seek' } | { kind: 'trim'; id: string; edge: 'in' | 'out'; startX: number; origin: Clip; base: Timeline; group: string } | { kind: 'move'; id: string; startX: number; moved: boolean; base: Timeline; group: string };

/** 0.6 → "0.6", 1.25 → "1.25", 1 → "1". */
const seconds = (value: number) => String(Number(value.toFixed(2)));
const RULER = 26; const TRACK_TOP = 34; const TRACK_HEIGHT = 74; const SOUND_HEIGHT = 36; const SOUND_GAP = 4; const BASE_HEIGHT = 128; const HANDLE = 9; const PAD = 16; const SNAP_PIXELS = 8;
type Colors = Record<'ruler' | 'rulerBg' | 'tick' | 'clip' | 'clipEdge' | 'selected' | 'wave' | 'band' | 'veil' | 'sound' | 'soundEdge' | 'text' | 'textEdge' | 'soundWave' | 'fade' | 'name' | 'head', string>;
const TOKENS: Colors = { ruler: '--ruler-text', rulerBg: '--ruler-bg', tick: '--hairline', clip: '--clip', clipEdge: '--clip-edge', selected: '--accent-text', wave: '--clip-wave', band: '--wave-band', veil: '--veil', sound: '--sound', soundEdge: '--sound-edge', text: '--text-item', textEdge: '--text-item-edge', soundWave: '--sound-wave', fade: '--fade', name: '--clip-label', head: '--playhead' };
/** The canvas can't use CSS variables directly, so they are read once per theme. */
const readColors = (element: HTMLElement) => {
  const style = getComputedStyle(element);
  return Object.fromEntries(Object.entries(TOKENS).map(([key, token]) => [key, style.getPropertyValue(token).trim()])) as Colors;
};

const COLLAPSED_HEIGHT = 24;
const rowHeight = (layer: TrackLayer, collapsed?: Set<string>) => collapsed?.has(layer.id) ? COLLAPSED_HEIGHT : layer.kind === 'video' ? TRACK_HEIGHT : SOUND_HEIGHT;
const rowTop = (layers: TrackLayer[], row: number, collapsed?: Set<string>) => TRACK_TOP + TRACK_HEIGHT + SOUND_GAP + layers.slice(0, row).reduce((sum, layer) => sum + rowHeight(layer, collapsed) + SOUND_GAP, 0);

export default function TimelineView({ timeline, selectedId, zoom, theme, visuals, soundPeaks, source, playhead, onSelect, onSeek, onChange, onScrubStart, onItemMenu, onDropPayload, onCut, openCut, onSplitAt, onZoom, fileName, renaming, onRenamed, onLayerSettings, layerSettingsId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const props = useRef({ timeline, selectedId, zoom, visuals, soundPeaks, source, fileName, renaming });
  props.current = { timeline, selectedId, zoom, visuals, soundPeaks, source, fileName, renaming };
  /** The clip under the pointer, for its hover card and on/off button. */
  const [hover, setHover] = useState<{ id: string; x: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const liftRef = useRef<Lift | null>(null);
  /** Time under the pointer when a zoom gesture began, kept there as the zoom changes. */
  const lastHead = useRef(Number.NaN);
  const barRef = useRef<HTMLDivElement>(null);
  const barInnerRef = useRef<HTMLDivElement>(null);
  const zoomAnchor = useRef<{ time: number; offset: number } | null>(null);
  const colors = useRef(TOKENS);
  useLayoutEffect(() => { colors.current = readColors(hostRef.current!); }, [theme]);
  const groupCount = useRef(0);
  /** Where a dragged tile would land, drawn as a line and a hint while it hovers. */
  const dropRef = useRef<{ x: number; zone: DropTarget['zone']; hint: string; clipId: string | null } | null>(null);
  const [addingLayer, setAddingLayer] = useState(false);
  const [collapsedLayers, setCollapsedLayers] = useState<Set<string>>(() => new Set(timeline.layers.filter((layer) => /brand|watermark|logo/i.test(layer.name ?? '')).map((layer) => layer.id)));

  const xOf = (t: number) => PAD + t * props.current.zoom;
  const timeOf = (x: number) => Math.max(0, (x - PAD) / props.current.zoom);
  const topOf = (row: number) => rowTop(trackLayers(props.current.timeline), row, collapsedLayers);

  useEffect(() => {
    const canvas = canvasRef.current!; const host = hostRef.current!; const context = canvas.getContext('2d')!;
    let frame = 0;
    /** The clip's name in a small dark pill at its top left, cut to fit; hidden while it is being renamed. */
    const drawName = (clip: Clip, x: number, y: number, width: number) => {
      const name = clip.name || props.current.fileName?.(clip) || '';
      if (!name || width < 44 || props.current.renaming === clip.id) return;
      context.save();
      context.font = '600 10.5px Inter, system-ui, sans-serif'; context.textBaseline = 'middle';
      const room = width - 34; let text = name;
      if (context.measureText(text).width > room) { while (text.length > 1 && context.measureText(`${text}…`).width > room) text = text.slice(0, -1); text = `${text}…`; }
      const w = context.measureText(text).width + 10;
      context.fillStyle = 'rgba(12,10,20,.62)'; context.beginPath(); context.roundRect(x + 4, y + 4, w, 16, 4); context.fill();
      context.fillStyle = clip.name ? '#fff' : 'rgba(255,255,255,.82)'; context.fillText(text, x + 9, y + 12.5);
      context.restore();
    };
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
      drawName(clip, x, y, width);
      if (clip.enabled === false) { context.save(); context.globalAlpha = 0.58; context.fillStyle = colors.current.veil; context.fillRect(x, y, width, h); context.globalAlpha = 1; context.fillStyle = colors.current.name; context.font = '600 11px Inter, system-ui, sans-serif'; context.fillText('Off', x + 8, y + h - 10); context.restore(); }
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
      const x = xOf(sound.start); const width = Math.max(2, soundLength(sound) * scale); const y = topOf(row); const h = rowHeight(trackLayers(props.current.timeline)[row], collapsedLayers);
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
      const x = xOf(blur.start); const width = Math.max(2, blur.length * scale); const y = topOf(row); const h = rowHeight(trackLayers(props.current.timeline)[row], collapsedLayers);
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
      const x = xOf(text.start); const width = Math.max(2, text.length * scale); const y = topOf(row); const h = rowHeight(trackLayers(props.current.timeline)[row], collapsedLayers);
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
      const x = xOf(clip.start); const width = Math.max(2, clipLength(clip) * scale); const y = topOf(row); const h = rowHeight(trackLayers(props.current.timeline)[row], collapsedLayers);
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
      drawName(clip, x, y, width);
      if (clip.enabled === false) { context.save(); context.globalAlpha = 0.58; context.fillStyle = colors.current.veil; context.fillRect(x, y, width, h); context.globalAlpha = 1; context.fillStyle = colors.current.name; context.font = '600 11px Inter, system-ui, sans-serif'; context.fillText('Off', x + 8, y + h - 10); context.restore(); }
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
      // Each transition's span, centred on its cut: a soft band over the clips' lower edge, as long as it lasts.
      clips.forEach((clip, index) => {
        if (!index || !clip.transition_in) return;
        const span = clip.transition_in.duration * scale; const left = xOf(clip.start) - span / 2;
        context.save(); context.globalAlpha = 0.85; context.fillStyle = colors.current.selected;
        context.beginPath(); context.roundRect(left, TRACK_TOP + TRACK_HEIGHT - 5, span, 3, 1.5); context.fill();
        context.globalAlpha = 0.16; context.fillRect(left, TRACK_TOP + 1, span, TRACK_HEIGHT - 2); context.restore();
      });
      const veil = (hidden: boolean | undefined, y: number, h: number) => { if (hidden) { context.fillStyle = colors.current.veil; context.fillRect(0, y, width, h); } };
      veil(mainLayer(shown).hidden, TRACK_TOP, TRACK_HEIGHT);
      tracks.forEach((layer, row) => {
        if (layer.kind === 'video') for (const clip of layer.items) drawOverlay(clip, row);
        else if (layer.kind === 'text') for (const text of layer.items) drawText(text, row);
        else if (layer.kind === 'blur') for (const blur of layer.items) drawBlur(blur, row);
        else if (layer.kind === 'captions') for (const caption of layer.items) drawCaption(caption, row);
        else for (const sound of layer.items) drawSound(sound, row, Boolean(layer.muted));
        veil(layer.hidden, rowTop(tracks, row, collapsedLayers), rowHeight(layer, collapsedLayers));
      });
      const lift = liftRef.current;
      if (lift?.picture) {
        // Its slot dims while it is carried; where it will land: a dashed outline. The item follows the pointer, lifted.
        context.save();
        const own = mainLayer(shown).items.find((clip) => clip.id === lift.id);
        const ownRow = own ? -1 : trackLayers(shown).findIndex((layer) => (layer.items as TrackItem[]).some((item) => item.id === lift.id));
        const ownItem = own ?? (ownRow >= 0 ? (trackLayers(shown)[ownRow].items as TrackItem[]).find((item) => item.id === lift.id) : undefined);
        if (ownItem) {
          context.globalAlpha = 0.55; context.fillStyle = colors.current.veil;
          context.beginPath(); context.roundRect(xOf(ownItem.start), own ? TRACK_TOP : topOf(ownRow), (own ? clipLength(own) : itemLength(ownItem as TrackItem)) * scale, own ? TRACK_HEIGHT : rowHeight(trackLayers(shown)[ownRow], collapsedLayers), 7); context.fill();
          context.globalAlpha = 1;
        }
        if (lift.target) {
          context.strokeStyle = colors.current.selected; context.lineWidth = 2; context.setLineDash([6, 4]);
          const landing = lift.target.kind === 'layer' ? (() => { const tracks2 = trackLayers(shown); const row = tracks2.findIndex((layer) => layer.id === (lift.target as { layerId: string }).layerId);
            return row < 0 ? null : [xOf((lift.target as { start: number }).start), topOf(row), lift.w, rowHeight(tracks2[row], collapsedLayers)] as const; })()
            : [xOf(mainLayer(shown).items.slice(0, lift.target.index).reduce((sum, clip) => sum + clipLength(clip), 0)) - 2, TRACK_TOP, 4, TRACK_HEIGHT] as const;
          if (landing) { context.beginPath(); context.roundRect(landing[0] + 1, landing[1] + 1, Math.max(4, landing[2] - 2), landing[3] - 2, 6); context.stroke(); }
        }
        context.setLineDash([]);
        const left = lift.x - lift.dx; const top = lift.y - lift.dy;
        context.shadowColor = 'rgba(0,0,0,.35)'; context.shadowBlur = 18; context.shadowOffsetY = 8; context.globalAlpha = 0.92;
        context.translate(left + lift.w / 2, top + lift.h / 2); context.rotate(-0.012); context.scale(1.04, 1.04);
        context.beginPath(); context.roundRect(-lift.w / 2, -lift.h / 2, lift.w, lift.h, 7); context.fillStyle = colors.current.clip; context.fill();
        context.shadowColor = 'transparent'; context.save(); context.clip();
        context.drawImage(lift.picture, -lift.w / 2, -lift.h / 2, lift.w, lift.h); context.restore();
        context.lineWidth = 2; context.strokeStyle = colors.current.selected; context.stroke();
        context.restore();
      }
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
      // Keep the playhead in view while it moves (playing or a jump): scroll only when it has just moved out of the
      // visible range. Never while it stands still, or scrolling the timeline away from it would snap straight back.
      const hostEl = hostRef.current!;
      const bar = barRef.current, inner = barInnerRef.current;
      if (bar && inner) {
        const wide = `${hostEl.scrollWidth}px`;
        if (inner.style.width !== wide) inner.style.width = wide;
        if (Math.abs(bar.scrollLeft - hostEl.scrollLeft) > 0.5) bar.scrollLeft = hostEl.scrollLeft;
      }
      const moved = Math.abs(playhead.current - lastHead.current) > 1e-4;
      lastHead.current = playhead.current;
      if (moved && (head < hostEl.scrollLeft + 8 || head > hostEl.scrollLeft + hostEl.clientWidth - 8)) hostEl.scrollLeft = Math.max(0, head - hostEl.clientWidth * 0.1);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [playhead, collapsedLayers]);

  /** Down from the canvas's top, from the pointer's place on screen (offsetY can be wrong for some events). */
  const pointerY = (event: { clientY: number }) => event.clientY - canvasRef.current!.getBoundingClientRect().top;
  const pointerTime = (event: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return event.clientX - rect.left;
  };
  const rowAt = (y: number) => {
    const layers = trackLayers(props.current.timeline);
    return layers.findIndex((layer, row) => y >= rowTop(layers, row, collapsedLayers) && y < rowTop(layers, row, collapsedLayers) + rowHeight(layer, collapsedLayers));
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
    if (pinch(event, 'down')) return;
    // Right-click, and Control-click on a Mac, open the menu. They must never drag or trim.
    if (event.button !== 0 || event.ctrlKey) return;
    const x = pointerTime(event); const y = pointerY(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    onScrubStart();
    const found = hit(x, y);
    const group = `drag-${groupCount.current += 1}`;
    const foundSound = hitSound(x, y);
    if (foundSound) {
      const { sound, zone } = foundSound;
      onSelect(sound.id);
      if (trackLayers(props.current.timeline)[rowAt(y)]?.locked) return;
      if (zone === 'body') liftRef.current = { id: sound.id, x, y, sx: x, sy: y, dx: x - xOf(sound.start), dy: y - topOf(rowAt(y)), w: Math.max(4, itemLength(sound) * props.current.zoom), h: rowHeight(trackLayers(props.current.timeline)[rowAt(y)], collapsedLayers), picture: null, target: null };
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
    if (found.zone === 'body') {
      dragRef.current = { kind: 'move', id: found.clip.id, startX: x, moved: false, base: props.current.timeline, group }; onSeek(timeOf(x));
      liftRef.current = { id: found.clip.id, x, y, sx: x, sy: y, dx: x - xOf(found.clip.start), dy: y - TRACK_TOP, w: Math.max(4, clipLength(found.clip) * props.current.zoom), h: TRACK_HEIGHT, picture: null, target: null };
    }
    else dragRef.current = { kind: 'trim', id: found.clip.id, edge: found.zone, startX: x, origin: found.clip, base: props.current.timeline, group };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (pinch(event, 'move')) return;
    const x = pointerTime(event); const drag = dragRef.current;
    if (!drag) {
      const over = hit(x, pointerY(event)) ?? hitSound(x, pointerY(event));
      const hovered = over && 'clip' in over ? over.clip : over && isClip(over.sound) ? over.sound : null;
      if ((hovered?.id ?? null) !== (hover?.id ?? null)) setHover(hovered ? { id: hovered.id, x } : null);
      const zone = over?.zone;
      event.currentTarget.style.cursor = zone === 'in' || zone === 'out' ? 'ew-resize' : zone === 'body' ? 'grab' : 'default';
      return;
    }
    const reach = SNAP_PIXELS / props.current.zoom;
    const y = pointerY(event); const lift = liftRef.current;
    if (lift && (drag.kind === 'move' || drag.kind === 'soundMove')) {
      lift.x = x; lift.y = y;
      if (!lift.picture && Math.hypot(x - lift.sx, y - lift.sy) > 5) lift.picture = snapshot({ ...lift, x: lift.sx, y: lift.sy });
      const inMain = y >= TRACK_TOP && y <= TRACK_TOP + TRACK_HEIGHT;
      const row = rowAt(y); const over = trackLayers(drag.base)[row];
      if (drag.kind === 'move' && !inMain) {
        // Off the main track: onto a video layer, or nowhere (it goes back).
        if (props.current.timeline !== drag.base) onChange(drag.base, drag.group);
        lift.target = over?.kind === 'video' && !mainLayer(drag.base).locked && !over.locked ? { kind: 'layer', layerId: over.id, start: snap(Math.max(0, timeOf(x - lift.dx)), snapPoints(drag.base, playhead.current, drag.id), reach) } : null;
        return;
      }
      if (drag.kind === 'soundMove' && inMain) {
        const fromVideo = overlayLayers(drag.base).some((layer) => layer.items.some((item) => item.id === drag.id));
        if (props.current.timeline !== drag.base) onChange(drag.base, drag.group);
        const t = timeOf(x);
        lift.target = fromVideo && !mainLayer(drag.base).locked ? { kind: 'main', index: mainLayer(drag.base).items.filter((clip) => clip.start + clipLength(clip) / 2 < t).length } : null;
        return;
      }
      lift.target = null;
    }
    if (drag.kind === 'seek') onSeek(snap(timeOf(x), snapPoints(props.current.timeline, -1), reach));
    else if (drag.kind === 'soundMove') {
      const shift = (x - drag.startX) / props.current.zoom;
      const layer = trackLayers(drag.base)[rowAt(pointerY(event))];
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
    const x = event.clientX - canvasRef.current!.getBoundingClientRect().left; const y = pointerY(event);
    const item = hitSound(x, y)?.sound.id ?? hit(x, y)?.clip.id ?? null;
    if (item) onSelect(item);
    onItemMenu(item, timeOf(x), event.clientX, event.clientY);
  };
  const onPointerUp = () => {
    const drag = dragRef.current; const lift = liftRef.current;
    dragRef.current = null; liftRef.current = null;
    if (!drag || !lift?.target || (drag.kind !== 'move' && drag.kind !== 'soundMove')) return;
    const next = lift.target.kind === 'layer' ? clipToLayer(drag.base, drag.id, lift.target.layerId, lift.target.start) : clipToMain(drag.base, drag.id, lift.target.index);
    if (next !== drag.base) onChange(next, drag.group);
  };
  /** The held item as it is drawn now, to carry under the pointer. */
  const snapshot = (lift: Lift) => {
    const canvas = canvasRef.current!; const dpr = window.devicePixelRatio || 1;
    const picture = document.createElement('canvas'); picture.width = Math.max(1, Math.round(lift.w * dpr)); picture.height = Math.max(1, Math.round(lift.h * dpr));
    const left = lift.x - lift.dx; const top = lift.y - lift.dy;
    picture.getContext('2d')!.drawImage(canvas, left * dpr, top * dpr, lift.w * dpr, lift.h * dpr, 0, 0, picture.width, picture.height);
    return picture;
  };
  const onDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSplitAt) return;
    const x = event.clientX - canvasRef.current!.getBoundingClientRect().left; const y = pointerY(event);
    const id = hitSound(x, y)?.sound.id ?? hit(x, y)?.clip.id;
    if (id) onSplitAt(id, timeOf(x));
  };
  // Zoom by pinching a trackpad (Ctrl + wheel in Chrome and Firefox, gesture events in Safari), Ctrl/⌘ + mouse wheel,
  // or two fingers on a touch screen; the time under the pointer stays under it.
  const pinchRef = useRef<{ pointers: Map<number, number>; distance: number } >({ pointers: new Map(), distance: 0 });
  useEffect(() => {
    const host = hostRef.current!;
    const anchorAt = (clientX: number) => { const offset = clientX - host.getBoundingClientRect().left; zoomAnchor.current = { time: timeOf(host.scrollLeft + offset), offset }; };
    const outer = host.closest('.tl-host') as HTMLElement | null;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        if (!onZoom) return;
        event.preventDefault(); anchorAt(event.clientX);
        onZoom(Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0025)));
        return;
      }
      // Scroll it ourselves: sideways from a trackpad swipe or Shift + wheel, and from the plain wheel when every layer
      // already fits; otherwise up and down through the layers.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientWidth : 1;
      const tall = outer ? outer.scrollHeight > outer.clientHeight + 1 : false;
      let dx = event.deltaX * unit, dy = event.deltaY * unit;
      if (event.shiftKey && !dx) { dx = dy; dy = 0; }
      if (!tall && Math.abs(dy) > Math.abs(dx)) { dx = dy; dy = 0; }
      if (!dx && !dy) return;
      event.preventDefault();
      if (dx) host.scrollLeft += dx;
      if (dy && outer) outer.scrollTop += dy;
    };
    let last = 1;
    const gestureStart = (event: Event) => { event.preventDefault(); last = 1; anchorAt((event as unknown as { clientX: number }).clientX); };
    const gestureChange = (event: Event) => { const scale = (event as unknown as { scale: number }).scale; event.preventDefault(); if (onZoom && scale > 0) onZoom(scale / last); last = scale; };
    (outer ?? host).addEventListener('wheel', wheel, { passive: false });
    host.addEventListener('gesturestart', gestureStart); host.addEventListener('gesturechange', gestureChange);
    return () => { (outer ?? host).removeEventListener('wheel', wheel); host.removeEventListener('gesturestart', gestureStart); host.removeEventListener('gesturechange', gestureChange); };
  }, [onZoom]);
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current; if (!anchor) return;
    hostRef.current!.scrollLeft = Math.max(0, PAD + anchor.time * zoom - anchor.offset);
  }, [zoom]);
  /** Two touches on the canvas: pinch to zoom. Returns true while pinching, so nothing else takes the touch. */
  const pinch = (event: React.PointerEvent<HTMLCanvasElement>, phase: 'down' | 'move' | 'up') => {
    if (event.pointerType !== 'touch') return false;
    const { pointers } = pinchRef.current;
    if (phase === 'up') { pointers.delete(event.pointerId); return pointers.size > 0 && pinchRef.current.distance > 0; }
    pointers.set(event.pointerId, event.clientX);
    if (pointers.size !== 2) return false;
    const [a, b] = [...pointers.values()]; const distance = Math.abs(a - b);
    if (phase === 'down' || !pinchRef.current.distance) {
      pinchRef.current.distance = distance; dragRef.current = null; liftRef.current = null;
      const host = hostRef.current!; const offset = (a + b) / 2 - host.getBoundingClientRect().left; zoomAnchor.current = { time: timeOf(host.scrollLeft + offset), offset };
      return true;
    }
    if (distance > 0 && onZoom) { onZoom(distance / pinchRef.current.distance); pinchRef.current.distance = distance; }
    return true;
  };
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
  const addTrack = (kind: AddableLayerKind) => {
    const id = `layer-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${groupCount.current += 1}`}`;
    const next = addLayer(timeline, kind, id);
    if (next !== timeline) change(next);
    setAddingLayer(false);
  };
  const deleteTrack = (layer: TrackLayer) => {
    const name = layer.name || (layer.kind === 'video' ? 'Overlay' : layer.kind === 'text' ? 'Text' : layer.kind === 'audio' ? 'Sound' : 'layer');
    const count = layer.items.length;
    if (!window.confirm(`Delete “${name}”${count ? ` and its ${count} item${count === 1 ? '' : 's'}` : ''}?\n\nThis can be undone.`)) return;
    change(removeLayer(timeline, layer.id));
    if ((layer.items as TrackItem[]).some((item) => item.id === selectedId)) onSelect(null);
  };
  const [layerMenu, setLayerMenu] = useState<MenuState | null>(null);
  const head = (layer: VideoLayer | TrackLayer, top: number, height: number) => <LayerHead key={layer.id} layer={layer} top={top} height={height} isMain={layer === main}
    position={layer.kind === 'video' && layer !== main ? overlayLayers(timeline).findIndex((entry) => entry.id === layer.id) : -1} overlays={overlayLayers(timeline).length}
    collapsed={collapsedLayers.has(layer.id)} onCollapse={() => setCollapsedLayers((current) => { const next = new Set(current); if (next.has(layer.id)) next.delete(layer.id); else next.add(layer.id); return next; })}
    onToggle={(changes) => change(updateLayer(timeline, layer.id, changes))} onMove={(direction) => change(reorderLayer(timeline, layer.id, direction))} onRename={(name) => change(updateLayer(timeline, layer.id, { name }))} onDelete={() => deleteTrack(layer)}
    onSettings={onLayerSettings && (layer.kind === 'text' || layer.kind === 'video') && layer.items.length ? () => onLayerSettings(layer.id) : undefined} settingsOpen={layerSettingsId === layer.id}
    onFixSync={onLayerSettings && layer.kind === 'text' && layer.items.length > 1 ? () => onLayerSettings(layer.id, 'sync') : undefined} onMenu={setLayerMenu}/>;
  return <div className="tl-host">
    {layerMenu && <ContextMenu menu={layerMenu} onClose={() => setLayerMenu(null)}/>}
    <div className="tl-rows" style={{ height: BASE_HEIGHT + tracks.reduce((sum, layer) => sum + rowHeight(layer, collapsedLayers) + SOUND_GAP, 0) }}>
      <div className="tl-heads">
        <button className="tl-add-layer" aria-label="Add a layer" title="Add a layer" aria-expanded={addingLayer} onClick={() => setAddingLayer((open) => !open)}>{addingLayer ? <X size={14}/> : <Plus size={14}/>}<span>Layer</span></button>
        {addingLayer && <div className="tl-add-menu" role="menu">
          <button role="menuitem" onClick={() => addTrack('video')}><Video size={14}/>Video</button>
          <button role="menuitem" onClick={() => addTrack('text')}><Type size={14}/>Title</button>
          <button role="menuitem" onClick={() => addTrack('audio')}><Music size={14}/>Sound</button>
        </div>}
        {head(main, TRACK_TOP, TRACK_HEIGHT)}{tracks.map((layer, row) => head(layer, rowTop(tracks, row, collapsedLayers), rowHeight(layer, collapsedLayers)))}</div>
      <div className="tl-scroll" ref={hostRef} onScroll={(event) => { const bar = barRef.current; if (bar && Math.abs(bar.scrollLeft - event.currentTarget.scrollLeft) > 0.5) bar.scrollLeft = event.currentTarget.scrollLeft; }}>
        <canvas ref={canvasRef} aria-label="Timeline. Drop media, looks, transitions, titles or music here. Drag clip edges to trim, drag a clip to reorder, click to move the playhead." onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(event) => { if (pinch(event, 'up')) return; if (!pinchRef.current.pointers.size) pinchRef.current.distance = 0; onPointerUp(); }} onPointerCancel={(event) => { pinch(event, 'up'); if (!pinchRef.current.pointers.size) pinchRef.current.distance = 0; onPointerUp(); }} onContextMenu={onContextMenu} onDoubleClick={onDoubleClick} onPointerLeave={(event) => { if (!(event.relatedTarget as Element | null)?.closest?.('.tl-clip-ui')) setHover(null); }}
          onDragOver={onDragOver} onDragLeave={() => { dropRef.current = null; }} onDrop={onDrop}/>
        <div className="tl-clip-layer">{(() => {
          // Each clip's place: on the main track or its video layer's row.
          const place = (id: string) => {
            const own = main.items.find((clip) => clip.id === id);
            if (own) return { clip: own, left: PAD + own.start * zoom, top: TRACK_TOP, height: TRACK_HEIGHT };
            const row = tracks.findIndex((layer) => layer.kind === 'video' && layer.items.some((clip) => clip.id === id));
            if (row < 0) return null;
            const clip = (tracks[row].items as Clip[]).find((item) => item.id === id)!;
            return { clip, left: PAD + clip.start * zoom, top: rowTop(tracks, row, collapsedLayers), height: rowHeight(tracks[row], collapsedLayers) };
          };
          const all = [...main.items, ...tracks.flatMap((layer) => layer.kind === 'video' ? layer.items as Clip[] : [])];
          const shown = all.filter((clip) => clip.id === hover?.id || clip.id === selectedId || clip.enabled === false);
          const card = hover && place(hover.id);
          const renamed = renaming ? place(renaming) : null;
          const length = (clip: Clip) => clipLength(clip);
          return <>
            {shown.map((clip) => { const at = place(clip.id); if (!at || length(clip) * zoom < 40 || at.height < 30) return null; const off = clip.enabled === false;
              return <button key={clip.id} className={`tl-clip-ui tl-clip-power ${off ? 'off' : ''}`} style={{ left: at.left + length(clip) * zoom - 24, top: at.top + 4 }}
                aria-label={`${off ? 'Turn on' : 'Turn off'} ${clip.name || fileName?.(clip) || 'clip'}`} aria-pressed={!off} title={off ? 'Off: not in the preview or the export. Click to turn on.' : 'On. Click to turn this clip off without deleting it.'}
                onPointerEnter={() => setHover({ id: clip.id, x: at.left })} onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onChange(updateClip(timeline, clip.id, { enabled: off }), `clip-power-${clip.id}`)}><Power size={11}/></button>; })}
            {card && card.clip.id !== renaming && !dragRef.current && (() => { const clip = card.clip; const file = fileName?.(clip) ?? '';
              return <div className={`tl-clip-card ${card.top === TRACK_TOP ? 'below' : ''}`} role="tooltip" style={{ left: Math.max(4, card.left), top: card.top === TRACK_TOP ? card.top + card.height + 6 : card.top - 6 }}>
                <b>{clip.name || file || 'Clip'}</b>
                {clip.name && file && <span>{file}</span>}
                <small>{timecode(length(clip))} long · from {timecode(clip.in)} to {timecode(clip.out)} of the file{clip.enabled === false ? ' · Off' : ''}</small>
              </div>; })()}
            {renamed && <input className="tl-clip-ui tl-clip-rename" autoFocus defaultValue={renamed.clip.name ?? ''} placeholder={fileName?.(renamed.clip) ?? 'Clip name'} maxLength={80} aria-label="Clip name"
              style={{ left: renamed.left + 4, top: renamed.top + 3, width: Math.max(120, Math.min(260, length(renamed.clip) * zoom - 8)) }}
              onPointerDown={(event) => event.stopPropagation()} onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = renamed.clip.name ?? ''; event.currentTarget.blur(); } }}
              onBlur={(event) => onRenamed?.(renamed.clip.id, event.currentTarget.value.trim() || null)}/>}
          </>;
        })()}</div>
        {onCut && <div className="tl-cuts" aria-label="Cuts">{main.items.map((clip, index) => {
          if (!index) return null;
          const transition = clip.transition_in; const room = Math.min(clipLength(main.items[index - 1]), clipLength(clip)) * zoom;
          const label = transition ? `${transitionLabel(transition.kind)}, ${seconds(transition.duration)} ${transition.duration === 1 ? "second" : "seconds"}. Change transition` : `Cut ${index}: add a transition`;
          return <button key={clip.id} className={`tl-cut ${transition ? '' : 'plain'} ${room < 64 ? 'narrow' : ''} ${openCut === clip.id ? 'open' : ''}`} style={{ left: PAD + clip.start * zoom, top: TRACK_TOP + TRACK_HEIGHT / 2 }}
            aria-label={label} title={transition ? `${transitionLabel(transition.kind)} · ${seconds(transition.duration)} s` : 'Add a transition'} aria-haspopup="dialog" aria-expanded={openCut === clip.id}
            onPointerDown={(event) => event.stopPropagation()} onClick={(event) => onCut(clip.id, event.currentTarget.getBoundingClientRect())}>
            {transition ? <>{TRANSITION_ICONS[transition.kind]}<span>{seconds(transition.duration)}s</span></> : <Plus size={11}/>}
          </button>;
        })}</div>}
      </div>
    </div>
    <div className="tl-hbar" ref={barRef} onScroll={(event) => { const host = hostRef.current; if (host && Math.abs(host.scrollLeft - event.currentTarget.scrollLeft) > 0.5) host.scrollLeft = event.currentTarget.scrollLeft; }} aria-hidden="true"><div ref={barInnerRef}/></div>
  </div>;
}

function LayerHead({ layer, top, height, isMain, position, overlays, collapsed, onCollapse, onToggle, onMove, onRename, onDelete, onSettings, settingsOpen, onFixSync, onMenu }: { onSettings?: () => void; settingsOpen: boolean; onFixSync?: () => void; onMenu: (menu: MenuState) => void; layer: TrackLayer; top: number; height: number; isMain: boolean; position: number; overlays: number; collapsed: boolean; onCollapse: () => void; onToggle: (changes: { hidden?: boolean; locked?: boolean; muted?: boolean; volume?: number; ripple?: boolean }) => void; onMove: (direction: 'forward' | 'back') => void; onRename: (name: string) => void; onDelete: () => void }) {
  const fallback = isMain ? 'Main' : layer.kind === 'video' ? `Overlay ${position + 1}` : layer.kind === 'text' ? 'Text' : layer.kind === 'blur' ? 'Blur' : layer.kind === 'captions' ? 'Captions' : 'Sound';
  const name = layer.name || fallback;
  const [editing, setEditing] = useState(false);
  const renaming = useRef(false);
  const [draft, setDraft] = useState('');
  const commit = () => { setEditing(false); const trimmed = draft.trim(); if (trimmed !== (layer.name ?? '')) onRename(trimmed); };
  return <div className={`tl-head ${height <= SOUND_HEIGHT ? 'tl-head-compact' : ''} ${collapsed ? 'tl-head-collapsed' : ''}`} style={{ top, height }} role="group" aria-label={`${name} layer`}>
    <div className="tl-layer-title">
      {!isMain && <button aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${name} layer`} title={collapsed ? 'Expand layer' : 'Collapse layer'} onClick={onCollapse}>{collapsed ? <ChevronDown size={13}/> : <ChevronUp size={13}/>}</button>}
      {editing
        ? <input className="tl-rename" autoFocus value={draft} maxLength={80} aria-label="Layer name" onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') commit(); if (event.key === 'Escape') setEditing(false); }} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}/>
        : <span className={onSettings ? 'tl-layer-name-link' : ''} title={onSettings ? t('Click for this layer\'s settings; double-click to rename') : t('Double-click to rename this layer')} onClick={(event) => { if (onSettings && event.detail === 1) { const open = onSettings; window.setTimeout(() => { if (!renaming.current) open(); }, 220); } }} onDoubleClick={(event) => { event.stopPropagation(); renaming.current = true; window.setTimeout(() => { renaming.current = false; }, 300); setDraft(layer.name ?? ''); setEditing(true); }}>{name}</span>}
    </div>
    <div className="tl-layer-actions">
      {layer.kind !== 'audio' && <button className={layer.hidden ? 'on' : ''} aria-pressed={Boolean(layer.hidden)} aria-label={`Hide ${name}`} title={layer.hidden ? 'Show this layer' : 'Hide this layer'} onClick={() => onToggle({ hidden: !layer.hidden })}>{layer.hidden ? <EyeOff size={13}/> : <Eye size={13}/>}</button>}
      {(layer.kind === 'video' || layer.kind === 'audio') && <button className={layer.muted ? 'on' : ''} aria-pressed={Boolean(layer.muted)} aria-label={`Mute ${name}`} title={layer.muted ? 'Turn sound on' : 'Mute this layer'} onClick={() => onToggle({ muted: !layer.muted })}>{layer.muted ? <VolumeX size={13}/> : <Volume2 size={13}/>}</button>}
      <button className={layer.locked ? 'on' : ''} aria-pressed={Boolean(layer.locked)} aria-label={`Lock ${name}`} title={layer.locked ? 'Unlock this layer' : 'Lock this layer'} onClick={() => onToggle({ locked: !layer.locked })}>{layer.locked ? <Lock size={13}/> : <LockOpen size={13}/>}</button>
      {layer.ripple === false && <span className="tl-layer-flag" title={t('Stays put when main clips are added or removed. Click to move with them')}><Link2Off size={12}/></span>}
      <button className={settingsOpen ? 'on' : ''} aria-label={`${name} layer menu`} aria-haspopup="menu" title={t('More for this layer')} onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const items: MenuItem[] = [];
        if (onSettings) items.push({ label: t('Layer settings'), onSelect: onSettings });
        if (onFixSync) items.push({ label: t('Fix lyric timing'), onSelect: onFixSync });
        if (items.length) items.push('divider');
        items.push({ label: t('Rename'), onSelect: () => { setDraft(layer.name ?? ''); setEditing(true); } });
        if (position >= 0) items.push({ label: t('Bring forward'), disabled: position === overlays - 1, onSelect: () => onMove('forward') }, { label: t('Send back'), disabled: position === 0, onSelect: () => onMove('back') });
        if (!isMain) items.push({ label: t('Move with main clips'), checked: layer.ripple !== false, onSelect: () => onToggle({ ripple: layer.ripple === false }) });
        if (!isMain) items.push('divider', { label: t('Delete layer'), danger: true, onSelect: onDelete });
        onMenu({ x: box.left, y: box.bottom + 4, items });
      }}><MoreHorizontal size={13}/></button>
    </div>
    {layer.kind === 'audio' && <input className="tl-layer-volume" type="range" min={0} max={1} step={0.05} value={layer.volume ?? 1} aria-label={`${name} volume`} title="This track's volume" onChange={(event) => onToggle({ volume: Number(event.target.value) })} onPointerDown={(event) => event.stopPropagation()}/>}
  </div>;
}
