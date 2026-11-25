/** The AI director's plan (director_service.py) as the looks the stack makes (timeline/stack.ts): its reasons kept
 *  for showing, dropped from what is made. */
import type { Look } from './stack.ts';

export type PlannedLook = Look & { why?: string };
export type Plan = { looks: PlannedLook[]; summary: string; verdict?: 'good' | 'adjust' };

const NAMES: Record<string, string> = { new_sky: 'New sky', night: 'Day for night', rays: 'God rays', atmosphere: 'Atmosphere', lens: 'Cinematic lens', slowmo: 'Slow motion' };

/** The looks to make: the plan without its reasons. */
export const looksToMake = (plan: Plan): Look[] => plan.looks.map(({ why: _why, ...look }) => look as Look);

/** One line naming a planned look and its choices, e.g. "Atmosphere · mist, light · tuned". */
export function describeLook(look: PlannedLook): string {
  const choices = Object.entries(look).filter(([key]) => !['kind', 'tune', 'why'].includes(key)).map(([, value]) => String(value));
  return `${NAMES[look.kind] ?? look.kind}${choices.length ? ` · ${choices.join(', ')}` : ''}${'tune' in look && look.tune && Object.keys(look.tune).length ? ' · tuned' : ''}`;
}
