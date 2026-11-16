import { addGraphic, clipLength, REST_TRANSFORM, type Clip, type ExplainerGraphic, type GraphicKind, type TextItem, type Timeline, type VideoLayer } from '../../timeline/model';
import { newId } from '../editor-constants';
import { graphicStateCount } from '../../timeline/graphics';
export { graphicBox } from '../../timeline/graphics';
import { fetchTextImage, graphicOutline } from '../../api/client';
import { frameToSource, sourceToFrame } from '../../timeline/tracking';
import { sourceAt } from '../../timeline/ramp';

type Size = { width: number; height: number };
type Input = {
  timelineRef: React.MutableRefObject<Timeline | null>;
  engineRef: React.MutableRefObject<{ currentTime: number; seek: (at: number) => void } | null>;
  change: (timeline: Timeline) => void;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  sourceFor: (mediaId: number) => Size | undefined;
  setError: (message: string) => void;
};

const HIGHLIGHTS: GraphicKind[] = ['circle', 'box'];
const clampShare = (value: number) => Math.round(Math.max(-0.05, Math.min(1.05, value)) * 10000) / 10000;

/** The top picture or video at time t whose frame covers `point`, with where the point is in its source. */
export function pictureAt(timeline: Timeline, t: number, point: [number, number], sourceFor: (mediaId: number) => Size | undefined): { clip: Clip; source: Size; at: [number, number] } | null {
  for (const layer of [...timeline.layers].reverse()) {
    if (layer.kind !== 'video' || layer.hidden) continue;
    for (const clip of (layer as VideoLayer).items) {
      if (t < clip.start - 1e-3 || t >= clip.start + clipLength(clip)) continue;
      const source = sourceFor(clip.media_id);
      const at = source && frameToSource(clip, source, timeline.format, t - clip.start, point[0], point[1]);
      if (source && at) return { clip, source, at };
    }
  }
  return null;
}

export function createGraphicActions(getInput: () => Input) {
  const place = (graphic: ExplainerGraphic, label: string, colour: string, at: number) => {
    const { timelineRef, engineRef, change, setSelectedId } = getInput();
    const current = timelineRef.current;
    if (!current) return;
    const id = newId();
    const text: TextItem = { id, start: at, length: 3, text: label, style: 'plain', position: 'center', color: colour, size: 44,
      enter: { preset: graphic.kind === 'callout' || graphic.kind === 'icon' ? 'pop' : 'reveal', duration: graphic.kind === 'spotlight' ? .8 : .65 },
      ...(graphic.kind === 'lower-third' ? { exit: { preset: 'reveal' as const, duration: .45 } } : ['count-up', 'chapter-card', 'bar-chart', 'line-chart', 'pie-chart'].includes(graphic.kind) ? { exit: { preset: 'fade' as const, duration: .4 } } : {}), transform: REST_TRANSFORM, graphic };
    change(addGraphic(current, text, newId()));
    setSelectedId(id);
    setTimeout(() => engineRef.current?.seek(at + 1), 0);
  };
  const now = () => Math.round((getInput().engineRef.current?.currentTime ?? 0) * 1000) / 1000;

  const addExplainerGraphic = (kind: GraphicKind, point: [number, number]) => {
    if (kind === 'icon') {
      const format=getInput().timelineRef.current?.format;
      place({kind,style:'clean',from:point,to:point,width:.22*(format ? format.height/format.width : .5625),height:.22,line_width:.006,icon:'pin',icon_badge:true},'Icon','#ffffff',now());
      return;
    }
    if (kind === 'timeline-bar') {
      place({ kind, style: 'documentary', from: [.5,.5], to: [.5,.5], width: .84, height: .64, line_width: .006,
        points: [{date:'300 BCE',label:'சங்க காலம்'},{date:'1947',label:'விடுதலை'},{date:'இன்று',label:'புதிய தொடக்கம்'}] }, 'Timeline bar', '#ffffff', now());
      return;
    }
    if (kind === 'step-list') {
      place({ kind, style: 'documentary', from: [.5, .5], to: [.5, .5], width: .78, height: .78, line_width: .006,
        steps: ['திட்டமிடுங்கள்', 'உருவாக்குங்கள்', 'பகிருங்கள்'], highlight_current: true }, 'Step list', '#ffffff', now());
      return;
    }
    if (kind === 'lower-third') {
      place({ kind, style: 'clean', from: [.07, .78], to: [.07, .78], width: .42, height: .14, line_width: .006, role: 'Role or organisation' }, 'Name', '#ffffff', now());
      return;
    }
    if (kind === 'count-up') {
      place({ kind, style: 'clean', from: [.5, .5], to: [.5, .5], width: .34, height: .2, line_width: .006, count_from: 0, count_to: 2000, label: 'years', prefix: '', suffix: '', indian_grouping: false, tamil_numerals: false }, 'Count-up number', '#ffffff', now());
      return;
    }
    if (kind === 'chapter-card') {
      place({ kind, style: 'documentary', from: [.5, .5], to: [.08, .12], width: .42, height: .22, line_width: .006, card_mode: 'full' }, 'Part 2 — சங்க காலம்', '#f5c11b', now());
      return;
    }
    if (kind === 'bar-chart') {
      place({ kind, style: 'documentary', from: [.5, .5], to: [.5, .5], width: .72, height: .62, line_width: .006,
        data: [{ label: 'சென்னை', value: 82 }, { label: 'மதுரை', value: 61 }, { label: 'கோவை', value: 74 }], chart_orientation: 'horizontal', highlight_index: 0, show_values: true, indian_grouping: true }, 'Bar chart', '#ffffff', now());
      return;
    }
    if (kind === 'line-chart') {
      place({ kind, style: 'documentary', from: [.5, .5], to: [.5, .5], width: .76, height: .62, line_width: .007,
        data: [{ label: '2022', value: 42 }, { label: '2023', value: 68 }, { label: '2024', value: 57 }, { label: '2025', value: 84 }], show_values: true, indian_grouping: true }, 'Line chart', '#ffffff', now());
      return;
    }
    if (kind === 'pie-chart') {
      place({ kind, style: 'documentary', from: [.5, .5], to: [.5, .5], width: .74, height: .64, line_width: .006,
        data: [{ label: 'கல்வி', value: 42 }, { label: 'சுகாதாரம்', value: 31 }, { label: 'போக்குவரத்து', value: 27 }], donut: true, show_values: true }, 'Pie chart', '#ffffff', now());
      return;
    }
    const x = Math.max(.04, Math.min(.96, point[0])), y = Math.max(.04, Math.min(.96, point[1]));
    // Keep a useful arrow length at every edge instead of clamping a fixed top-left tail into a tiny line.
    const tailX = x < .28 ? Math.min(.96, x + .2) : x - .2;
    const tailY = y < .24 ? Math.min(.96, y + .16) : y - .16;
    const spot = kind === 'spotlight';
    place({ kind, style: HIGHLIGHTS.includes(kind) ? 'documentary' : 'clean', from: [tailX, tailY], to: [x, y], width: spot ? .3 : .25, height: spot ? .42 : .18, line_width: .006, ...(spot ? { dim: .6 } : {}) },
      kind === 'callout' ? 'Type your label' : kind.replace('arrow-', '').replace('-', ' '), HIGHLIGHTS.includes(kind) ? '#f5c11b' : '#ffffff', now());
  };

  /** Glow outline: Click to choose finds the thing under the click in that moment's picture; its edge becomes the graphic. */
  const addGlowOutline = async (point: [number, number]) => {
    const { timelineRef, sourceFor, setError } = getInput();
    const current = timelineRef.current;
    if (!current) return;
    const t = now();
    const under = pictureAt(current, t, point, sourceFor);
    if (!under) { setError('Right-click on a picture or video to outline something in it.'); return; }
    const local = t - under.clip.start;
    try {
      const { shape } = await graphicOutline(under.clip.media_id, under.at[0], under.at[1], Math.max(0, sourceAt(under.clip, local)));
      const framed = shape.map(([u, v]) => sourceToFrame(under.clip, under.source, current.format, local, u, v)).map(([x, y]) => [clampShare(x), clampShare(y)] as [number, number]);
      const xs = framed.map((p) => p[0]), ys = framed.map((p) => p[1]);
      const centre: [number, number] = [Math.max(0, Math.min(1, (Math.min(...xs) + Math.max(...xs)) / 2)), Math.max(0, Math.min(1, (Math.min(...ys) + Math.max(...ys)) / 2))];
      place({ kind: 'outline', style: 'neon', from: centre, to: centre, width: .25, height: .18, line_width: .005, shape: framed }, 'glow outline', '#42f5e9', t);
    } catch (problem) { setError((problem as Error).message); }
  };
  return { addExplainerGraphic, addGlowOutline };
}

export function queueGraphicFrames(texts: TextItem[], format: Timeline['format'], keyOf: (text: TextItem, format: Timeline['format']) => string, images: Map<string, string | 'loading'>, ready: () => void) {
  for (const text of texts) {
    if (!text.graphic || (text.enter?.preset !== 'reveal' && !['step-list','timeline-bar'].includes(text.graphic.kind))) continue;
    for (let frame = 0; frame < graphicStateCount(text, format.fps); frame += 1) {
      const key = `${keyOf(text, format)}|graphic${frame}`;
      if (images.has(key)) continue;
      images.set(key, 'loading');
      void fetchTextImage(text, format, null, frame).then((url) => { images.set(key, url); ready(); }).catch(() => images.delete(key));
    }
  }
}
