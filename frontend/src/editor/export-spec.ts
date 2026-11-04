import type { Format } from '../timeline/model';

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export function aspectLabel(format: Format): string {
  const divisor = gcd(format.width, format.height);
  return `${format.width / divisor}:${format.height / divisor}`;
}

export function exportSpec(format: Format, withSound: boolean): string {
  return `${format.width} × ${format.height} · ${format.fps} fps · ${aspectLabel(format)} · ${withSound ? 'with sound' : 'no audible sound'} · MP4`;
}
