/** How the corner handles resize a picture: keeping its shape, or freely (width and height apart). Remembered on this Mac. */
import { useEffect, useState } from 'react';

export type ResizeShape = 'keep' | 'free';
const KEY = 'kanaa.resize-shape';
const listeners = new Set<(shape: ResizeShape) => void>();
let current: ResizeShape = (() => { try { return localStorage.getItem(KEY) === 'free' ? 'free' : 'keep'; } catch { return 'keep'; } })();

export function setResizeShape(shape: ResizeShape) {
  current = shape;
  try { localStorage.setItem(KEY, shape); } catch { /* Private window: it still works for now. */ }
  listeners.forEach((listener) => listener(shape));
}

export function useResizeShape(): ResizeShape {
  const [shape, setShape] = useState(current);
  useEffect(() => { listeners.add(setShape); return () => { listeners.delete(setShape); }; }, []);
  return shape;
}
