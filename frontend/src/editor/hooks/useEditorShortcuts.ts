import type { Clipboard } from '../../timeline/clipboard';
import type { DependencyList } from 'react';
import { useEffect } from "react";
import type { CopiedStyle } from '../../timeline/clipboard';
import { clipLength,mainLayer,trimAtPlayhead,type CinemaReveal,type Clip,type SourceFacts,type TextItem,type Timeline } from "../../timeline/model";
import { type MenuItem,type MenuState } from "../ContextMenu";
import { buttonTakesSpace,FAST_RATES,isTyping,newId } from "../editor-constants";
import { PlaybackEngine } from "../playback";
type Action = { type: 'load'; timeline: Timeline } | { type: 'change'; timeline: Timeline; group?: string | null } | { type: 'undo' } | { type: 'redo' };
type Box = [number, number, number, number];

type Input = {
  setPalette: React.Dispatch<React.SetStateAction<boolean>>;
  setShowingHelp: React.Dispatch<React.SetStateAction<boolean>>;
  fullScreen: boolean;
  toggleFullScreen: () => void;
  pickingKey: boolean;
  stopPicking: () => void;
  drawing: { mode: "start" | "continue"; from?: [number, number]; to?: [number, number]; onBox?: (box: Box) => void; } | null;
  setDrawing: React.Dispatch<React.SetStateAction<{ mode: "start" | "continue"; from?: [number, number]; to?: [number, number]; onBox?: (box: Box) => void; } | null>>;
  shaping: { textId: string; mode: "ground" | "outline"; points: [number, number][]; reveal?: CinemaReveal; } | null;
  setShaping: React.Dispatch<React.SetStateAction<{ textId: string; mode: "ground" | "outline"; points: [number, number][]; reveal?: CinemaReveal; } | null>>;
  finishShape: () => void;
  timeline: Timeline | null;
  exporting: boolean;
  choosingFormat: boolean;
  showingHelp: boolean;
  menu: MenuState | null;
  engineRef: React.MutableRefObject<PlaybackEngine | null>;
  playhead: { current: number; };
  dispatch: React.Dispatch<Action>;
  selectedId: string | null;
  setMoreIds: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  clipboard: { styleCopy: CopiedStyle | null; clearStyle: () => void; copy: (cut?: boolean) => void; pasteAt: (at: number, copied?: Clipboard | null) => void; duplicate: () => void; copyStyleOf: (id?: string | null) => void; pasteStyleOnto: (ids?: string[]) => void; menuItems: (id: string, at: number) => MenuItem[]; hasCopy: () => boolean; };
  togglePlay: () => void;
  fastRate: React.MutableRefObject<number>;
  seek: (t: number) => void | undefined;
  movingRef: React.MutableRefObject<{ transform: Clip["transform"]; update: (transform: Clip["transform"], group?: string) => void; } | null>;
  split: () => void;
  setSnapping: React.Dispatch<React.SetStateAction<boolean>>;
  change: (next: Timeline, group?: string | null) => void;
  facts: (id: number) => SourceFacts | undefined;
  wordSelection: Set<string>;
  cutWords: (keys: Set<string>) => void;
  removeSelected: () => void;
  setWordSelection: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedText: TextItem | null;
  setComparing: (value: boolean) => void;
};

export function useEditorShortcuts(getInput: () => Input, dependencies: DependencyList) {
  useEffect(() => {
    const { setPalette, setShowingHelp, fullScreen, toggleFullScreen, pickingKey, stopPicking, drawing, setDrawing, shaping, setShaping, finishShape, timeline, exporting, choosingFormat, showingHelp, menu, engineRef, playhead, dispatch, selectedId, setMoreIds, clipboard, togglePlay, fastRate, seek, movingRef, split, setSnapping, change, facts, wordSelection, cutWords, removeSelected, setWordSelection, setSelectedId, selectedText } = getInput();
    const invoke = () => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette((value) => !value); return; }
      if (event.key === '?' && !isTyping(event.target)) { setShowingHelp((value) => !value); return; }
      if (event.key === 'Escape' && fullScreen) { toggleFullScreen(); return; }
      if (event.key === 'Escape' && pickingKey) { stopPicking(); return; }
      if (event.key === 'Escape' && drawing) { setDrawing(null); return; }
      if (shaping && event.key === 'Escape') { setShaping(null); return; }
      if (shaping && event.key === 'Enter') { event.preventDefault(); finishShape(); return; }
      if (shaping && event.key === 'Backspace') { event.preventDefault(); setShaping({ ...shaping, points: shaping.points.slice(0, -1) }); return; }
      if (isTyping(event.target) || !timeline || exporting || choosingFormat || showingHelp || menu) return;
      if (event.key === ' ' && buttonTakesSpace(event.target)) return;
      // Arrows on a focused slider change the slider, not the playhead.
      if (event.target instanceof HTMLInputElement && event.target.type === 'range' && event.key.startsWith('Arrow')) return;
      const command = event.metaKey || event.ctrlKey;
      const engine = engineRef.current;
      const frame = 1 / timeline.format.fps;
      const clip = () => mainLayer(timeline).items.find((item) => playhead.current >= item.start && playhead.current < item.start + clipLength(item));
      if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); dispatch({ type: event.shiftKey ? 'redo' : 'undo' }); return; }
      if (command && event.key.toLowerCase() === 'a' && selectedId) {
        // ⌘A: everything on the selected item's layer.
        const layer = timeline.layers.find((l) => (l.items as { id: string }[]).some((item) => item.id === selectedId));
        if (layer) { event.preventDefault(); setMoreIds(new Set((layer.items as { id: string }[]).map((item) => item.id).filter((id) => id !== selectedId))); }
        return;
      }
      if (command && !event.altKey && (event.key === 'c' || event.key === 'x') && selectedId) { event.preventDefault(); clipboard.copy(event.key === 'x'); return; }
      if (command && !event.altKey && event.key === 'v') { event.preventDefault(); clipboard.pasteAt(playhead.current); return; }
      if (command && event.key === 'd' && selectedId) { event.preventDefault(); clipboard.duplicate(); return; }
      // ⌥⌘C / ⌥⌘V: Option changes the letter on a Mac keyboard, so read the key's place.
      if (command && event.altKey && (event.code === 'KeyC' || event.key.toLowerCase() === 'c')) { event.preventDefault(); clipboard.copyStyleOf(); return; }
      if (command && event.altKey && (event.code === 'KeyV' || event.key.toLowerCase() === 'v')) { event.preventDefault(); clipboard.pasteStyleOnto(); return; }
      if (command) return;
      switch (event.key) {
        case ' ': event.preventDefault(); togglePlay(); break;
        case 'k': engine?.pause(); fastRate.current = 0; break;
        case 'l': fastRate.current = Math.min(FAST_RATES.length - 1, engine?.playing ? fastRate.current + 1 : 0); engine?.play(FAST_RATES[fastRate.current]); break;
        case 'j': engine?.pause(); seek(playhead.current - 1); break;
        case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
          if (!event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) break;
          event.preventDefault();
          if (event.altKey) {
            // Alt+arrows nudge the selected title, clip or blur in the frame (Shift: further).
            const moving = movingRef.current;
            if (!moving) break;
            const step = event.shiftKey ? 0.05 : 0.01;
            const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
            const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
            moving.update({ ...moving.transform, x: Math.round((moving.transform.x + dx) * 1000) / 1000, y: Math.round((moving.transform.y + dy) * 1000) / 1000 }, `nudge-${selectedId}`);
            break;
          }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') break;
          engine?.pause(); seek(playhead.current + (event.key === 'ArrowLeft' ? -1 : 1) * frame * (event.shiftKey ? 10 : 1)); break;
        }
        case 's': split(); break;
        case 'n': setSnapping((value) => !value); break;
        case 'f': toggleFullScreen(); break;
        case '\\': if (!event.repeat && !event.defaultPrevented) getInput().setComparing(true); break;  // The Cinematic tab's own compare goes first.
        case 'i': case 'o': { const item = clip(); if (item && !mainLayer(timeline).locked) change(trimAtPlayhead(timeline, item, event.key === 'i' ? 'in' : 'out', playhead.current - item.start, newId, facts(item.media_id))); break; }
        case 'Delete': case 'Backspace': event.preventDefault(); if (wordSelection.size) cutWords(wordSelection); else removeSelected(); break;
        case 'Escape': setWordSelection(new Set()); setSelectedId(null); break;
        case 'Enter': case 'F2': {
          // Type into the selected title.
          const box = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Title"]');
          if (selectedText && box) { event.preventDefault(); box.focus(); box.select(); }
          break;
        }
        default: break;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === '\\') getInput().setComparing(false);
    };
    const onBlur = () => getInput().setComparing(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  };
    return invoke();
  }, dependencies);
}
