/** Turning what people type into values. Pure, so it can be tested without a browser. */
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function snapValue(value: number, min: number, max: number, step: number) {
  const snapped = min + Math.round((value - min) / step) * step;
  return clamp(Number(snapped.toFixed(6)), min, max);
}

/** The stored value for typed text, or null if it isn't a number. `factor` is 100 for a percentage. */
export function parseValue(text: string, factor: number, min: number, max: number, step: number): number | null {
  const cleaned = text.trim().replace(/[%°×xXsS]+$/, '').trim().replace(',', '.').replace('−', '-');
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? snapValue(number / factor, min, max, step) : null;
}

/** Seconds from "2.5", or from "1:02.15", which is minutes, seconds and frames. Snaps to a frame. */
export function parseTime(text: string, fps: number): number | null {
  const cleaned = text.trim().replace(/s$/i, '').replace(',', '.');
  const clock = cleaned.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
  let seconds: number;
  if (clock) seconds = Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3] ?? 0) / fps;
  else if (/^\d*\.?\d+$/.test(cleaned)) seconds = Number(cleaned);
  else return null;
  return Math.round(seconds * fps) / fps;
}

export function formatTime(seconds: number, fps: number) {
  const frames = Math.round(seconds * fps);
  const whole = Math.floor(frames / fps);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${String(frames % fps).padStart(2, '0')}`;
}
