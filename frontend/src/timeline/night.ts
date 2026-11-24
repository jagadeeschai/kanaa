/** Day for night: the moods (night_service.py makes the copy; it stacks with the other looks, timeline/stack.ts). */
export type NightMood = 'moonlit' | 'dark';
export const NIGHT_MOODS: { id: NightMood; label: string; about: string }[] = [
  { id: 'moonlit', label: 'Moonlit', about: 'A soft blue night: the people readable, the distance fading into dark' },
  { id: 'dark', label: 'Deep night', about: 'Close to midnight: much darker, only what is near still shows' },
];
