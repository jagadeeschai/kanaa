import { useEffect, useState } from 'react';
import { shiftLyricCues, stretchLyricCues, type LyricCue } from '../utils/lyrics';
import KanaaSelect from './KanaaSelect';

const inputClass = 'theme-control w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100';
const buttonClass = 'theme-control rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-40';
const label = (cue: LyricCue, index: number) => `${index + 1}. ${cue.text.slice(0, 28)}${cue.text.length > 28 ? '…' : ''}`;

/**
 * Fix the sync of many lines at once, between a start and an end line.
 * Shift moves them all earlier or later. Stretch places the start line and the end line where they are really sung
 * (tap "Now" while the song plays) and spreads the lines between, which fixes lyrics that drift.
 */
export default function LyricSyncFix({ cues, duration, position, onChange, onSeek }: {
  cues: LyricCue[]; duration: number; position: number; onChange: (next: LyricCue[], note: string) => void; onSeek: (t: number) => void;
}) {
  const last = cues.length - 1;
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(last);
  const [mode, setMode] = useState<'shift' | 'stretch'>('shift');
  const [fromAt, setFromAt] = useState<number | null>(null);
  const [toAt, setToAt] = useState<number | null>(null);
  // Keep the range inside the lines when lines are added or removed.
  useEffect(() => { setFrom((value) => Math.min(value, last)); setTo((value) => Math.min(Math.max(value, 0), last)); }, [last]);
  const low = Math.min(from, to), high = Math.max(from, to);
  const span = low === 0 && high === last ? 'all lines' : `lines ${low + 1}–${high + 1}`;
  const shift = (seconds: number) => onChange(shiftLyricCues(cues, low, high, seconds, duration), `${span} ${seconds > 0 ? 'later' : 'earlier'} by ${Math.abs(seconds)}s.`);
  const time = (value: number | null) => value === null ? '—' : `${value.toFixed(2)}s`;
  const stretch = () => {
    const a = fromAt ?? cues[low].start, b = toAt ?? cues[high].start;
    onChange(stretchLyricCues(cues, low, high, a, b, duration), `Line ${low + 1} now starts at ${a.toFixed(2)}s and line ${high + 1} at ${b.toFixed(2)}s; the lines between follow.`);
    setFromAt(null); setToAt(null);
  };
  if (!cues.length) return null;
  return <section aria-label="Fix sync" className="space-y-2 rounded-xl border border-white/10 p-3">
    <div className="flex items-center justify-between"><h3 className="text-sm font-medium text-slate-200">Fix sync</h3>
      <div role="group" aria-label="Fix sync mode" className="flex gap-1 text-xs">{(['shift', 'stretch'] as const).map((id) => <button key={id} aria-pressed={mode === id} onClick={() => setMode(id)} className={`rounded-lg px-2 py-1 ${mode === id ? 'bg-brand-500/30 text-white' : 'text-slate-400'}`}>{id === 'shift' ? 'Shift' : 'Stretch'}</button>)}</div></div>
    <div className="grid grid-cols-2 gap-2">
      <label className="text-xs text-slate-400">Start line<KanaaSelect aria-label="Sync start line" value={String(from)} onChange={(event) => setFrom(Number(event.target.value))} className="mt-1">{cues.map((cue, index) => <option key={index} value={index}>{label(cue, index)}</option>)}</KanaaSelect></label>
      <label className="text-xs text-slate-400">End line<KanaaSelect aria-label="Sync end line" value={String(to)} onChange={(event) => setTo(Number(event.target.value))} className="mt-1">{cues.map((cue, index) => <option key={index} value={index}>{label(cue, index)}</option>)}</KanaaSelect></label>
    </div>
    {mode === 'shift' ? <>
      <p className="text-xs text-slate-400">Moves {span} together. Lyrics early? Make them later.</p>
      <div className="flex flex-wrap gap-2">{[-0.5, -0.1, 0.1, 0.5].map((seconds) => <button key={seconds} onClick={() => shift(seconds)} className={buttonClass} aria-label={`${seconds > 0 ? 'Later' : 'Earlier'} by ${Math.abs(seconds)} seconds`}>{seconds > 0 ? '+' : '−'}{Math.abs(seconds)}s</button>)}</div>
    </> : <>
      <p className="text-xs text-slate-400">Play the song and tap Now as each line is sung. The lines between are spread to fit, which fixes lyrics that drift.</p>
      {([[low, fromAt, setFromAt, 'Start'], [high, toAt, setToAt, 'End']] as const).map(([index, at, setAt, name]) => <div key={name} className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
        <button onClick={() => onSeek(Math.max(0, cues[index].start - 2))} className="text-brand-300" aria-label={`Play before line ${index + 1}`}>{name}: line {index + 1}</button>
        <span>now {cues[index].start.toFixed(2)}s → {time(at)}</span>
        <button onClick={() => setAt(Math.round(position * 100) / 100)} className={buttonClass} aria-label={`Line ${index + 1} is sung now`}>Now</button>
        <input aria-label={`Line ${index + 1} should start at`} type="number" min={0} max={duration} step={0.05} value={at ?? ''} placeholder="seconds" onChange={(event) => setAt(event.target.value === '' ? null : Number(event.target.value))} className={`${inputClass} w-24`} />
      </div>)}
      <button disabled={fromAt === null && toAt === null} onClick={stretch} className={buttonClass}>Apply</button>
    </>}
  </section>;
}
