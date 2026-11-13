/**
 * What every settings panel needs from the editor, shared through context instead of being passed to each panel:
 * the timeline, how to change it, pausing playback and opening the guide. Panels read it with useEditor().
 */
import type { Photo } from '../../types/photo';
import { createContext, useContext } from 'react';
import type { Timeline } from '../../timeline/model';

export type EditorShared = {
  timeline: Timeline;
  /** Applies a new timeline; `group` merges quick successive changes into one undo step. */
  change: (next: Timeline, group?: string) => void;
  pause: () => void;
  /** Opens the guide, at an article when one is given. */
  openGuide: (article?: string) => void;
  /** The playhead, in timeline seconds, and moving it. */
  now: number;
  seek: (t: number) => void;
  /** The selected item (titles, clips, sounds…), and choosing another (or none). */
  selectedId: string | null;
  select: (id: string | null) => void;
  /** A new file made for this project (an effect, a night sky…), so the preview can play it at once. */
  addMedia: (item: Photo) => void;
  /** Lets the person drag a box on the preview; `onBox` gets it as [centre x, centre y, width, height], shares of the frame. */
  drawBox: (onBox: (box: [number, number, number, number]) => void) => void;
};

export const EditorContext = createContext<EditorShared | null>(null);

/** The playhead within an item that starts at `start` and lasts `length` seconds, and seeking within it. */
export function useItemTime(start: number, length: number): { local: number; seekLocal: (t: number) => void } {
  const { now, seek } = useEditor();
  return { local: Math.max(0, Math.min(now - start, length)), seekLocal: (t: number) => seek(start + t) };
}

export function useEditor(): EditorShared {
  const shared = useContext(EditorContext);
  if (!shared) throw new Error('useEditor needs an EditorContext.Provider with a timeline.');
  return shared;
}
