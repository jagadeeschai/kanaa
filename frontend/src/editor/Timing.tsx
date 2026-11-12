import { TimeField, type TimeFieldProps } from './controls';

/** "0:04 → 0:09 · 5s": where the item sits, for the folded Timing heading. */
export function timingSummary(fields: TimeFieldProps[]): string {
  const find = (label: string) => fields.find((field) => field.label === label);
  const start = find('Start'), length = find('Duration') ?? find('Length');
  if (!start || !length) return '';
  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  return `${clock(start.value)} → ${clock(start.value + length.value)} · ${length.value < 10 ? length.value.toFixed(1) : Math.round(length.value)}s`;
}

export function Timing({ fields }: { fields: TimeFieldProps[] }) {
  return <div className="ed-timing">{fields.map((field) => <TimeField key={field.label} {...field}/>)}</div>;
}

