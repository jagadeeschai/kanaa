import type { ChartRow } from './model';

export function chartDataText(rows: ChartRow[] | null | undefined): string {
  return (rows ?? []).map((row) => `${row.label}, ${row.value}`).join('\n');
}

export function parseChartData(text: string, limit: number): { rows?: ChartRow[]; error?: string } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { error: 'Add at least one row as label, value.' };
  if (lines.length > limit) return { error: `Use no more than ${limit} rows.` };
  const rows: ChartRow[] = [];
  for (const line of lines) {
    const match = line.match(/^(.*?)(?:\t|,\s*)([-+]?\d[\d,]*(?:\.\d+)?)$/);
    if (!match || !match[1].trim()) return { error: `“${line}” needs a label and a number.` };
    const value = Number(match[2].replace(/,/g, ''));
    if (!Number.isFinite(value)) return { error: `“${line}” does not end in a number.` };
    rows.push({ label: match[1].trim(), value });
  }
  return { rows };
}
