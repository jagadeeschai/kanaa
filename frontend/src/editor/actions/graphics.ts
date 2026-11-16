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
      enter: { preset: graphic.kind === 'callout' ? 'pop' : 'reveal', duration: graphic.kind === 'spotlight' ? .8 : .65 },
      ...(graphic.kind === 'lower-third' ? { exit: { preset: 'reveal' as const, duration: .45 } } : graphic.kind === 'count-up' || graphic.kind === 'chapter-card' ? { exit: { preset: 'fade' as const, duration: .4 } } : {}), transform: REST_TRANSFORM, graphic };
    change(addGraphic(current, text, newId()));
    setSelectedId(id);
    setTimeout(() => engineRef.current?.seek(at + 1), 0);
  };
  const now = () => Math.round((getInput().engineRef.current?.currentTime ?? 0) * 1000) / 1000;

  const addExplainerGraphic = (kind: GraphicKind, point: [number, number]) => {
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
    if (!text.graphic || text.enter?.preset !== 'reveal') continue;
    for (let frame = 0; frame < graphicStateCount(text, format.fps); frame += 1) {
      const key = `${keyOf(text, format)}|graphic${frame}`;
      if (images.has(key)) continue;
      images.set(key, 'loading');
      void fetchTextImage(text, format, null, frame).then((url) => { images.set(key, url); ready(); }).catch(() => images.delete(key));
    }
  }
}
