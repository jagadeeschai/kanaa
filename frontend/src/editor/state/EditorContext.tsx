/**
 * What every settings panel needs from the editor, shared through context instead of being passed to each panel:
 * the timeline, how to change it, pausing playback and opening the guide. Panels read it with useEditor().
 */
import type { Photo } from '../../types/photo';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Timeline } from '../../timeline/model';

export type EditorPanelName = 'left' | 'preview' | 'toolbar' | 'inspector' | 'text' | 'clip' | 'sound' | 'caption' | 'blur' | 'project' | 'follow';

export type EditorShared = {
  panels?: Partial<Record<EditorPanelName, unknown>>;
  timeline: Timeline;
  /** Applies a new timeline; `group` merges quick successive changes into one undo step. */
  change: (next: Timeline, group?: string) => void;
  /** The project being edited, and opening a finished export (a Short) in the library. */
  projectId: number;
  openOutput: (id: number) => void;
  pause: () => void;
  previewLook?: (clipId: string, look: string | null) => void;
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

export type EditorStore = Omit<EditorShared, 'timeline'> & { timeline: Timeline | null };
export const EditorContext = createContext<EditorStore | null>(null);

/** The playhead within an item that starts at `start` and lasts `length` seconds, and seeking within it. */
export function useItemTime(start: number, length: number): { local: number; seekLocal: (t: number) => void } {
  const { now, seek } = useEditor();
  return { local: Math.max(0, Math.min(now - start, length)), seekLocal: (t: number) => seek(start + t) };
}

export function useEditor(): EditorShared {
  const shared = useContext(EditorContext);
  if (!shared?.timeline) throw new Error('useEditor needs an EditorContext.Provider with a timeline.');
  return shared as EditorShared;
}

/** Reads a panel's selected state and actions from the same store as history and playback. */
export function useEditorPanel<T>(name: EditorPanelName): T {
  const store = useContext(EditorContext);
  const panel = store?.panels?.[name];
  if (panel === undefined) throw new Error('Missing editor panel: ' + name);
  return panel as T;
}

/** A selection binds its panel data without copying timeline/history state. */
export function InspectorBindingsProvider({ name, bindings, children }: { name: EditorPanelName; bindings: unknown; children: ReactNode }) {
  const store = useContext(EditorContext);
  if (!store) throw new Error('InspectorBindingsProvider needs the editor store.');
  const value = useMemo(() => ({ ...store, panels: { ...store.panels, [name]: bindings } }), [store, name, bindings]);
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useSelection() {
  const { selectedId, select } = useEditor();
  return { selectedId, select };
}
