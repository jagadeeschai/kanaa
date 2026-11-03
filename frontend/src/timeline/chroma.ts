export type Chroma = { color: string; similarity: number; softness: number; spill: number };
export const DEFAULT_CHROMA: Chroma = { color: '#00b140', similarity: 0.08, softness: 0.06, spill: 0.5 };

const channels = (color: string) => [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16) / 255);

/** Chroma in the BT.709 limited-range scale, 0 to 1. Matches chroma_yuv in animation.py and the preview shader. */
export function keyChroma(color: string): [number, number] {
  const [r, g, b] = channels(color);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [(128 + (224 * (b - luma)) / 1.8556) / 255, (128 + (224 * (r - luma)) / 1.5748) / 255];
}

/** 0 for no spill channel, 1 for a green screen, 2 for a blue one. */
export function keyKind(color: string) {
  const [, g, b] = channels(color);
  return b > g ? 2 : 1;
}

export const toHex = (rgb: number[]) => `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
