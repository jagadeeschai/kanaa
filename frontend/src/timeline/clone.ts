/**
 * Clone a person: the same person several times in one shot, from cut-outs of the person (the clip's people masks),
 * so the scene behind must stay still (a tripod shot).
 * - Follow me: copies of the person from a moment earlier walk behind them, each a little further back in time.
 * - From my takes: other clips of the same scene, the person cut out of each, layered into one shot.
 * The live person stays in front of their clones. Each clone is its own layer; ⌘Z undoes it.
 */
import { MAX_VIDEO_LAYERS, clipLength, mainLayer, type Clip, type Timeline, type VideoLayer } from './model.ts';

export const CLONE_LAYER = 'Clone';
const round = (value: number) => Math.round(value * 1000) / 1000;

const cutOut = (clip: Clip, id: string, name: string, changes: Partial<Clip> = {}): Clip => ({
  ...clip, id, name, cutout: 'remove', cutout_pick: null, depth_gap: 0, focus_pull: null, popout: null, muted: true, volume: 0,
  transition_in: null, enter: null, exit: null, fade_in: 0, fade_out: 0, frame_locked: true, ...changes,
});

function withLayers(timeline: Timeline, clipId: string, made: Clip[], ids: () => string): Timeline {
  const main = mainLayer(timeline);
  const used = timeline.layers.filter((layer) => layer.kind === 'video').length;
  if (used + made.length > MAX_VIDEO_LAYERS) throw new Error(`Cloning needs ${made.length} more video layers; use up to ${MAX_VIDEO_LAYERS}. Delete a layer you no longer use, or make fewer clones.`);
  // This clip's earlier clones go first, so cloning again replaces them.
  const kept = timeline.layers.filter((layer) => !(layer.kind === 'video' && layer.name?.startsWith(CLONE_LAYER) && layer.items.every((item) => item.id.startsWith(`${clipId}~`))));
  const at = kept.findIndex((layer) => layer.id === main.id) + 1;
  const layers: VideoLayer[] = made.map((clip, k) => ({ id: ids(), kind: 'video', name: `${CLONE_LAYER} ${k + 1}`, items: [clip] }));
  return { ...timeline, layers: [...kept.slice(0, at), ...layers, ...kept.slice(at)] };
}

/** Follow me: `copies` clones, each `gap` seconds behind the one before, then the live person on top. */
export function cloneFollow(timeline: Timeline, clipId: string, copies: number, gap: number, ids: () => string): Timeline {
  const clip = mainLayer(timeline).items.find((item) => item.id === clipId);
  if (!clip) throw new Error('Clone works on a clip on the main track.');
  if (clip.reverse || clip.ramp || clip.freeze != null) throw new Error('Clone a clip that plays normally (not reversed, ramped or frozen).');
  const length = clipLength(clip);
  const made: Clip[] = [];
  // Oldest first, lowest: the further back in time, the further behind.
  for (let k = copies; k >= 1; k -= 1) {
    const back = k * gap * clip.speed;  // Source seconds earlier.
    const late = Math.max(0, back - clip.in) / clip.speed;  // Not enough clip before it: the clone starts later.
    if (late >= length - 0.2) continue;
    made.push(cutOut(clip, `${clipId}~${k}`, `Clone ${k} (${round(k * gap)} s behind)`, { start: round(clip.start + late), in: round(Math.max(0, clip.in - back)), out: round(clip.out - back) }));
  }
  if (!made.length) throw new Error('This clip is too short for clones that far behind. Choose a shorter gap.');
  made.push(cutOut(clip, `${clipId}~0`, 'You (in front)'));
  return withLayers(timeline, clipId, made, ids);
}

/** From my takes: each of `takes` (other clips of the same scene) cut out over this clip, starting together. */
export function cloneTakes(timeline: Timeline, clipId: string, takes: Clip[], ids: () => string): Timeline {
  const clip = mainLayer(timeline).items.find((item) => item.id === clipId);
  if (!clip) throw new Error('Clone works on a clip on the main track.');
  if (!takes.length) throw new Error('Choose at least one other take.');
  const length = clipLength(clip);
  const made = takes.map((take, k) => {
    const span = Math.min(length, clipLength(take));
    return cutOut(take, `${clipId}~t${k}`, `Clone ${k + 1}`, { start: clip.start, out: round(take.in + span * take.speed) });
  });
  return withLayers(timeline, clipId, made, ids);
}

/** Whether a clip has clones, and how to take them away. */
export const hasClones = (timeline: Timeline, clipId: string) => timeline.layers.some((layer) => layer.kind === 'video' && layer.items.some((item) => item.id.startsWith(`${clipId}~`)));
export function removeClones(timeline: Timeline, clipId: string): Timeline {
  return { ...timeline, layers: timeline.layers.filter((layer) => !(layer.kind === 'video' && layer.name?.startsWith(CLONE_LAYER) && layer.items.every((item) => item.id.startsWith(`${clipId}~`)))) };
}
