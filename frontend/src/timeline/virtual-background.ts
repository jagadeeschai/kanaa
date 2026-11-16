import { clipLength, mainLayer, newClip, type Clip, type SourceFacts, type Timeline, type VideoLayer } from './model.ts';
import { DEFAULT_CHROMA } from './chroma.ts';
import { DEFAULT_COMPOSITE } from './composite.ts';

/**
 * Puts a main-track clip of someone on a new background in one step. The background takes the clip's place on the
 * main track (same start and length, so nothing after it moves; silent); the person moves to a new layer just above,
 * keyed by its screen colour when it has one, otherwise cut out by the AI, with its edges blended in.
 */
export function withVirtualBackground(timeline: Timeline, clipId: string, background: SourceFacts, screen: string | null, ids: { layer: string; person: string }): Timeline {
  const main = mainLayer(timeline);
  const person = main.items.find((clip) => clip.id === clipId);
  if (!person) return timeline;
  const length = clipLength(person);
  const fresh = newClip(background, person.id);
  const available = background.media_type === 'image' ? length : background.duration ?? length;
  const behind: Clip = { ...fresh, start: person.start, in: 0, out: Math.round(Math.min(length, available) * 1000) / 1000,
    // A background video shorter than the person plays slower rather than leaving a gap.
    speed: available >= length ? 1 : Math.max(.05, Math.round(available / length * 1000) / 1000),
    muted: true, transition_in: person.transition_in ?? null, fade_in: person.fade_in, fade_out: person.fade_out, enter: person.enter ?? null, exit: person.exit ?? null };
  const front: Clip = { ...person, id: ids.person, transition_in: null, chroma: screen ? { ...DEFAULT_CHROMA, color: screen } : null,
    cutout: screen ? person.cutout ?? null : 'remove', cutout_pick: screen ? person.cutout_pick ?? null : null, composite: DEFAULT_COMPOSITE };
  const layer: VideoLayer = { id: ids.layer, kind: 'video', name: 'Presenter', ripple: true, items: [front] };
  const at = timeline.layers.indexOf(main);
  const layers = timeline.layers.map((each) => each === main ? { ...main, items: main.items.map((clip) => clip.id === clipId ? behind : clip) } : each);
  layers.splice(at + 1, 0, layer);
  return { ...timeline, layers };
}
