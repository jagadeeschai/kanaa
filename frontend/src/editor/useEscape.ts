import { useEffect } from 'react';

/** Esc calls `close` while `open` (the dialogs opened from a key close by one too). */
export function useEscape(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const press = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
    window.addEventListener('keydown', press, true);
    return () => window.removeEventListener('keydown', press, true);
  });
}
