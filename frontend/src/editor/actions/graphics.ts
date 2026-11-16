import { addGraphic, REST_TRANSFORM, type GraphicKind, type TextItem, type Timeline } from '../../timeline/model';
import { newId } from '../editor-constants';
import { GRAPHIC_STATES } from '../../timeline/graphics';
import { fetchTextImage } from '../../api/client';

type Input = {
  timelineRef: React.MutableRefObject<Timeline | null>;
  engineRef: React.MutableRefObject<{ currentTime: number; seek: (at: number) => void } | null>;
  change: (timeline: Timeline) => void;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
};

export function createGraphicActions(getInput: () => Input) {
  const addExplainerGraphic = (kind: GraphicKind, point: [number, number]) => {
    const { timelineRef, engineRef, change, setSelectedId } = getInput();
    const current = timelineRef.current;
    if (!current) return;
    const at = Math.round((engineRef.current?.currentTime ?? 0) * 1000) / 1000;
    const x = Math.max(.04, Math.min(.96, point[0])), y = Math.max(.04, Math.min(.96, point[1]));
    // Keep a useful arrow length at every edge instead of clamping a fixed top-left tail into a tiny line.
    const tailX = x < .28 ? Math.min(.96, x + .2) : x - .2;
    const tailY = y < .24 ? Math.min(.96, y + .16) : y - .16;
    const id = newId();
    const text: TextItem = { id, start: at, length: 3, text: kind === 'callout' ? 'Type your label' : kind.replace('arrow-', '').replace('-', ' '), style: 'plain', position: 'center', color: kind === 'circle' || kind === 'box' ? '#f5c11b' : '#ffffff', size: 44,
      enter: { preset: kind === 'callout' ? 'pop' : 'reveal', duration: .65 }, transform: REST_TRANSFORM,
      graphic: { kind, style: kind === 'circle' || kind === 'box' ? 'documentary' : 'clean', from: [tailX, tailY], to: [x, y], width: .25, height: .18, line_width: .006 } };
    change(addGraphic(current, text, newId()));
    setSelectedId(id);
    setTimeout(() => engineRef.current?.seek(at + 1), 0);
  };
  return { addExplainerGraphic };
}

export function queueGraphicFrames(texts: TextItem[], format: Timeline['format'], keyOf: (text: TextItem, format: Timeline['format']) => string, images: Map<string, string | 'loading'>, ready: () => void) {
  for (const text of texts) {
    if (!text.graphic || text.enter?.preset !== 'reveal') continue;
    for (let frame = 0; frame < GRAPHIC_STATES; frame += 1) {
      const key = `${keyOf(text, format)}|graphic${frame}`;
      if (images.has(key)) continue;
      images.set(key, 'loading');
      void fetchTextImage(text, format, null, frame).then((url) => { images.set(key, url); ready(); }).catch(() => images.delete(key));
    }
  }
}
