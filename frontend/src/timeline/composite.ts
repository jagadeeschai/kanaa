import type { Composite } from './model';

/** Mirrors timeline_service.py: WRAP_EDGE, WRAP_BLUR, WRAP_GAIN and CHOKE_REACH, CHOKE_LOW, CHOKE_HIGH. */
export const WRAP_EDGE = .003, WRAP_BLUR = .012, WRAP_GAIN = 1.4;
export const CHOKE_REACH = .01, CHOKE_LOW = .84, CHOKE_HIGH = .977;
export const DEFAULT_COMPOSITE: Composite = { choke: .35, wrap: .5, match: 0, match_gain: null };

/** The colour gains applied: the measured gains scaled by how much of the match is wanted (match_gain in Python). */
export function matchGain(composite: Composite | null | undefined): [number, number, number] {
  if (!composite?.match_gain || !composite.match) return [1, 1, 1];
  return composite.match_gain.map((gain) => 1 + (gain - 1) * composite.match) as [number, number, number];
}
