/**
 * Use these looks on every clip: the Cinematic tab's looks, given to every clip on the main track at once, so a whole
 * song edit gets one film look in one click. Each clip keeps its own colour match (who it matches is its own choice);
 * shake on the beat takes the beats inside each clip (none: no shake there). Clips that cannot have looks (reversed,
 * ramped, frozen) are left alone. Clips that already have exactly these looks are skipped, so nothing is made twice.
 */
import { hitsFor } from './beatsync.ts';
import { mainLayer, type Timeline } from './model.ts';
import { cannotLook, looksOf, withLook, withoutLook, type Look } from './stack.ts';

export function looksForEvery(timeline: Timeline, looks: Look[], beats: number[]): { clipId: string; looks: Look[] }[] {
  const shared = withoutLook(looks, 'match');
  return mainLayer(timeline).items.flatMap((clip) => {
    if (cannotLook(clip, 'atmosphere')) return [];
    let mine = shared;
    const own = looksOf(clip).find((look) => look.kind === 'match');
    if (own) mine = withLook(mine, own);
    const shake = mine.find((look) => look.kind === 'shake');
    if (shake?.kind === 'shake' && shake.preset === 'beat') {
      const hits = hitsFor(clip, beats);
      mine = hits.length ? withLook(mine, { ...shake, hits }) : withoutLook(mine, 'shake');
    }
    return JSON.stringify(mine) === JSON.stringify(looksOf(clip)) ? [] : [{ clipId: clip.id, looks: mine }];
  });
}
