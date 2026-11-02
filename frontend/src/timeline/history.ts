export type History<T> = { past: T[]; present: T; future: T[]; group: string | null };

const LIMIT = 200;

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [], group: null });

/** Records a change. Changes sharing a group, like one drag, undo as a single step. */
export function commit<T>(history: History<T>, next: T, group: string | null = null): History<T> {
  if (next === history.present) return history;
  if (group && group === history.group) return { ...history, present: next, future: [] };
  return { past: [...history.past, history.present].slice(-LIMIT), present: next, future: [], group };
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future], group: null };
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest, group: null };
}
