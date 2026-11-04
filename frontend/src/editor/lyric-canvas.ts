export type LyricCanvas = 'portrait' | 'square' | 'landscape';

export function mediaCanvas(width?: number | null, height?: number | null): LyricCanvas {
  if (!width || !height) return 'portrait';
  const ratio = width / height;
  if (ratio > 1.15) return 'landscape';
  if (ratio < 0.87) return 'portrait';
  return 'square';
}
