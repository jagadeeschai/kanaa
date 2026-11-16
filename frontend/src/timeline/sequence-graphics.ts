import type { TextItem } from './model';

export function parseSteps(value: string): { steps?: string[]; error?: string } {
  const steps = value.split('\n').map((line) => line.replace(/^\s*(?:\d+[.)]\s*|[•●\-]\s*)?/, '').trim()).filter(Boolean);
  return steps.length < 2 || steps.length > 8 || steps.some((step) => step.length > 300)
    ? { error: 'Add 2–8 steps, one per line.' } : { steps };
}

/** Mirrored in step_graphics.py: events are cached at their exact local times. */
export function stepStarts(item: TextItem): number[] {
  const count = item.graphic?.steps?.length ?? 2;
  const duration = item.enter ? Math.min(item.length, item.enter.duration) : .65;
  const timed = item.graphic?.step_times ?? [];
  if (timed.length) {
    const remaining = count - timed.length, last = timed[timed.length - 1];
    return [...timed, ...Array.from({ length: remaining }, (_, i) => last + (item.length - last) * (i + 1) / (remaining + 1))];
  }
  return Array.from({ length: count }, (_, i) => i * Math.max(0, duration - .18) / Math.max(1, count - 1));
}

export function stepStates(item: TextItem): number[] {
  const starts = stepStarts(item), times = new Set([0]);
  starts.forEach((at, i) => {
    const end = Math.min(item.length - 1e-8, at + .18, starts[i + 1] ?? item.length);
    for (let n = 0; n < 10; n++) times.add(at + (end - at) * n / 9);
  });
  return [...times].sort((a, b) => a - b);
}
