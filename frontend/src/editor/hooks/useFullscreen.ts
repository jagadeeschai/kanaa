import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';

/** The existing window-filling preview and native full-screen toggle. */
export function useFullscreen(stageRef: RefObject<HTMLElement>, setFullScreen: Dispatch<SetStateAction<boolean>>) {
  useEffect(() => {
    // Leaving the screen's full screen (Esc, or the green button) leaves this too.
    const changed = () => { if (!document.fullscreenElement) setFullScreen(false); };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  const toggleFullScreen = useCallback(() => {
    setFullScreen((on) => {
      if (on) { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); return false; }
      void stageRef.current?.requestFullscreen?.().catch(() => { /* The window-filling view still works. */ });
      return true;
    });
  }, []);
  return toggleFullScreen;
}
