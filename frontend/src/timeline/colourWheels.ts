/**
 * Colour wheels: lift (shadows), gamma (midtones) and gain (highlights), after a clip's look and adjustments.
 * Mirrors backend/app/services/colour_wheels.py; both are checked against timeline/fixtures/wheels.expected.json.
 */
export type Wheel = { hue: number; amount: number; brightness: number };
export type ColourWheels = { shadows: Wheel; midtones: Wheel; highlights: Wheel };
export type WheelVectors = { lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number] };

export const LIFT_REACH = 0.25;
export const GAMMA_REACH = 0.5;
export const GAIN_REACH = 0.5;
export const FLAT_WHEEL: Wheel = { hue: 0, amount: 0, brightness: 0 };
export const FLAT_WHEELS: ColourWheels = { shadows: FLAT_WHEEL, midtones: FLAT_WHEEL, highlights: FLAT_WHEEL };

const wheels = (spec: Partial<Record<keyof ColourWheels, [number, number, number]>>): ColourWheels => ({
  ...FLAT_WHEELS, ...Object.fromEntries(Object.entries(spec).map(([name, [hue, amount, brightness]]) => [name, { hue, amount, brightness }])) });

/** One-click looks, as colour_wheels.PRESETS. Reset is none. */
export const WHEEL_PRESETS: { id: string; label: string; wheels: ColourWheels | null }[] = [
  { id: 'warm-shadows', label: 'Warm shadows', wheels: wheels({ shadows: [30, 0.5, 0] }) },
  { id: 'teal-orange', label: 'Teal and orange', wheels: wheels({ shadows: [190, 0.55, 0], highlights: [30, 0.45, 0] }) },
  { id: 'cool-highlights', label: 'Cool highlights', wheels: wheels({ highlights: [205, 0.5, 0] }) },
  { id: 'golden-hour', label: 'Golden hour', wheels: wheels({ midtones: [40, 0.4, 0.05], highlights: [45, 0.4, 0.05] }) },
  { id: 'reset', label: 'Reset', wheels: null },
];

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Python's colorsys.hsv_to_rgb at full saturation and value. */
function hueRgb(hue: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360 / 360; const i = Math.floor(h * 6); const f = h * 6 - i;
  const q = 1 - f; const t = f;
  return ([[1, t, 0], [q, 1, 0], [0, 1, t], [0, q, 1], [t, 0, 1], [1, 0, q]] as [number, number, number][])[i % 6];
}

export function hueOffset(hue: number, amount: number): [number, number, number] {
  const rgb = hueRgb(hue); const mean = (rgb[0] + rgb[1] + rgb[2]) / 3;
  return rgb.map((c) => round6((c - mean) * amount)) as [number, number, number];
}

export function wheelVectors(w: ColourWheels | null | undefined): WheelVectors | null {
  if (!w) return null;
  const ls = hueOffset(w.shadows.hue, w.shadows.amount); const ms = hueOffset(w.midtones.hue, w.midtones.amount); const hs = hueOffset(w.highlights.hue, w.highlights.amount);
  const lift = ls.map((o) => round6((o + w.shadows.brightness) * LIFT_REACH)) as [number, number, number];
  const gamma = ms.map((o) => round6(Math.max(0.2, 1 + (o + w.midtones.brightness) * GAMMA_REACH))) as [number, number, number];
  const gain = hs.map((o) => round6(Math.max(0, 1 + (o + w.highlights.brightness) * GAIN_REACH))) as [number, number, number];
  if (lift.every((v) => v === 0) && gamma.every((v) => v === 1) && gain.every((v) => v === 1)) return null;
  return { lift, gamma, gain };
}

/** One channel value (0..1) through the wheels, as colour_wheels.apply and the preview shader. */
export function applyWheels(value: number, channel: 0 | 1 | 2, v: WheelVectors): number {
  const c = value + v.lift[channel] * (1 - value);
  return Math.min(1, Math.max(0, Math.max(c, 0) ** (1 / v.gamma[channel]) * v.gain[channel]));
}
