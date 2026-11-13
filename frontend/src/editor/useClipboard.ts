/**
 * Copy, cut, paste, duplicate and the style painter, for the editor. The copied items are kept for this Mac (so they
 * can go from one project into another); a copied style lasts while the editor is open.
 */
import { useCallback, useState } from 'react';
import { t } from '../i18n';
import { clipboardEnd, copyItems, copyStyle, pasteItems, pasteStyle, styleFor, type Clipboard, type CopiedStyle, type StyleKind } from '../timeline/clipboard';
import { duplicateItem, findBlur, findSound, findText, isLocked, removeBlur, removeClip, removeSound, removeText, type Timeline } from '../timeline/model';
import type { MenuItem } from './ContextMenu';

type Deps = {
  timeline: Timeline | null; selectedId: string | null; moreIds: ReadonlySet<string>;
  select: (ids: string[]) => void; change: (next: Timeline) => void; removeSelected: () => void;
  newId: () => string; note: (text: string) => void; fail: (message: string) => void;
};

const KEY = 'kanaa.clipboard';
let inMemory: Clipboard | null = null;
export function writeClipboard(copied: Clipboard) {
  inMemory = copied;
  try { localStorage.setItem(KEY, JSON.stringify(copied)); } catch { /* kept in memory */ }
}
export function readClipboard(): Clipboard | null {
  try { const saved = localStorage.getItem(KEY); if (saved) return JSON.parse(saved) as Clipboard; } catch { /* fall back */ }
  return inMemory;
}
const kindOfItem = (timeline: Timeline, id: string): StyleKind => (findText(timeline, id) ? 'title' : findBlur(timeline, id) ? 'blur' : findSound(timeline, id) ? 'sound' : 'clip');
const STYLE_COPIED = 'Style copied. Select items and press ⌥⌘V, or click the brush.';

export function useClipboard({ timeline, selectedId, moreIds, select, change, removeSelected, newId, note, fail }: Deps) {
  const [styleCopy, setStyleCopy] = useState<CopiedStyle | null>(null);
  const picked = useCallback(() => (selectedId ? [selectedId, ...moreIds] : []), [selectedId, moreIds]);
  const copy = useCallback((cut = false) => {
    if (!timeline) return;
    const copied = copyItems(timeline, picked());
    if (!copied) return;
    writeClipboard(copied);
    note(t(cut ? 'Cut {count}' : 'Copied {count}', { count: copied.items.length }));
    if (cut) removeSelected();
  }, [timeline, picked, removeSelected, note]);
  const pasteAt = useCallback((at: number, copied: Clipboard | null = readClipboard()) => {
    if (!timeline || !copied) return;
    try {
      const pasted = pasteItems(timeline, copied, at, newId);
      change(pasted.timeline);
      if (pasted.ids.length) select(pasted.ids);
    } catch (problem) { fail((problem as Error).message); }
  }, [timeline, change, newId, select, fail]);
  const duplicate = useCallback(() => {
    if (!timeline) return;
    const ids = picked();
    pasteAt(clipboardEnd(timeline, ids), copyItems(timeline, ids));
  }, [timeline, picked, pasteAt]);
  const copyStyleOf = useCallback((id: string | null = selectedId) => {
    if (!timeline || !id) return;
    const style = copyStyle(timeline, id);
    if (style) { setStyleCopy(style); note(t(STYLE_COPIED)); }
  }, [timeline, selectedId, note]);
  const pasteStyleOnto = useCallback((ids: string[] = picked()) => {
    if (!timeline || !styleCopy || !ids.length) return;
    const next = pasteStyle(timeline, styleCopy, ids.filter((id) => !isLocked(timeline, id)));
    if (next === timeline) { note(t('That style does not fit what is selected.')); return; }
    change(next);
  }, [timeline, styleCopy, picked, change, note]);

  /** The right-click menu's copy and paste part, for item `id` clicked at `at` seconds. */
  const menuItems = (id: string, at: number): MenuItem[] => {
    if (!timeline) return [];
    const many = selectedId === id || moreIds.has(id);
    const copyOne = (cut: boolean) => {
      if (many) { copy(cut); return; }
      select([id]);
      const copied = copyItems(timeline, [id]);
      if (!copied) return;
      writeClipboard(copied);
      if (cut) change(findSound(timeline, id) ? removeSound(timeline, id) : findText(timeline, id) ? removeText(timeline, id) : findBlur(timeline, id) ? removeBlur(timeline, id) : removeClip(timeline, id));
    };
    return ['divider', { label: 'Cut', hint: '⌘X', onSelect: () => copyOne(true) }, { label: 'Copy', hint: '⌘C', onSelect: () => copyOne(false) },
      { label: 'Paste', hint: '⌘V', disabled: !readClipboard(), onSelect: () => pasteAt(at) },
      { label: 'Duplicate', hint: '⌘D', onSelect: () => { if (many) duplicate(); else { try { change(duplicateItem(timeline, id, newId(), newId())); } catch (problem) { fail((problem as Error).message); } } } },
      { label: 'Copy style', hint: '⌥⌘C', onSelect: () => copyStyleOf(id) },
      { label: 'Paste style', hint: '⌥⌘V', disabled: !styleCopy || !styleFor(styleCopy, kindOfItem(timeline, id)).length, onSelect: () => pasteStyleOnto(many ? picked() : [id]) }, 'divider'];
  };

  return { styleCopy, clearStyle: () => setStyleCopy(null), copy, pasteAt, duplicate, copyStyleOf, pasteStyleOnto, menuItems, hasCopy: () => Boolean(readClipboard()) };
}
