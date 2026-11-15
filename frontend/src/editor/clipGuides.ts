/** Clip guides: dashed lines down the whole timeline at every main-track cut, switched on and off from the timeline bar. */
import { useEffect, useState } from 'react';

const KEY = 'kanaa.clipGuides';
const EVENT = 'kanaa-clip-guides';

export function clipGuidesOn(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setClipGuides(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* Private window: just this session. */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

export function useClipGuides(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(clipGuidesOn);
  useEffect(() => {
    const changed = (event: Event) => setOn(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener(EVENT, changed);
    return () => window.removeEventListener(EVENT, changed);
  }, []);
  return [on, setClipGuides];
}
