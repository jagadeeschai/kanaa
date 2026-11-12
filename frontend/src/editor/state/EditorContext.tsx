/**
 * What every settings panel needs from the editor, shared through context instead of being passed to each panel:
 * the timeline, how to change it, pausing playback and opening the guide. Panels read it with useEditor().
 */
import { createContext, useContext } from 'react';
import type { Timeline } from '../../timeline/model';

export type EditorShared = {
  timeline: Timeline;
  /** Applies a new timeline; `group` merges quick successive changes into one undo step. */
  change: (next: Timeline, group?: string) => void;
  pause: () => void;
  /** Opens the guide, at an article when one is given. */
  openGuide: (article?: string) => void;
};

export const EditorContext = createContext<EditorShared | null>(null);

export function useEditor(): EditorShared {
  const shared = useContext(EditorContext);
  if (!shared) throw new Error('useEditor needs an EditorContext.Provider with a timeline.');
  return shared;
}
