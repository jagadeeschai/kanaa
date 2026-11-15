/** Skimming: moving the mouse over the timeline shows that moment in the preview, without moving the playhead. */
import { useEffect, useState } from 'react';

const KEY = 'kanaa.skim';
const TOGGLE = 'kanaa-skim-toggle';
const AT = 'kanaa-skim-at';

export function skimOn(): boolean {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}

export function useSkim(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(skimOn);
  useEffect(() => {
    const changed = (event: Event) => setOn(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener(TOGGLE, changed);
    return () => window.removeEventListener(TOGGLE, changed);
  }, []);
  const set = (next: boolean) => {
    try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* Just this session. */ }
    if (!next) skimTo(null);
    window.dispatchEvent(new CustomEvent(TOGGLE, { detail: next }));
  };
  return [on, set];
}

/** The timeline asks the preview to show `t` (null: back to the playhead). */
export function skimTo(t: number | null) {
  window.dispatchEvent(new CustomEvent(AT, { detail: t }));
}

/** The preview listens and shows it. */
export function useSkimListener(show: (t: number | null) => void) {
  useEffect(() => {
    const at = (event: Event) => show((event as CustomEvent<number | null>).detail);
    window.addEventListener(AT, at);
    return () => window.removeEventListener(AT, at);
  }, [show]);
}
