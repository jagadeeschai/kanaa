/**
 * ⌘K: find any action, panel, title style, guide page or setting by typing, in English or Tamil. Arrows move, Enter
 * runs, Esc closes. When nothing fits, the last line searches the settings panel for the words typed.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { searchText, t } from '../i18n';

export type Command = { id: string; label: string; group: string; hint?: string; keywords?: string; run: () => void };

export default function CommandPalette({ commands, onSettings, onClose }: { commands: Command[]; onSettings: (query: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  // The pointer only moves the highlight when it really moves, not when arrow keys scroll the list under it.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const found = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const scored = commands.map((command) => {
      const hay = `${command.label} ${command.group} ${searchText(command.keywords ?? '')}`.toLowerCase();
      if (!words.every((word) => hay.includes(word))) return null;
      return { command, score: words.length && command.label.toLowerCase().startsWith(words[0]) ? 0 : 1 };
    }).filter((entry): entry is { command: Command; score: number } => entry !== null);
    return scored.sort((a, b) => a.score - b.score).slice(0, 60).map((entry) => entry.command);
  }, [commands, query]);
  const rows: Command[] = query.trim() ? [...found, { id: 'settings', label: `${t('Find in settings')}: “${query.trim()}”`, group: t('Settings'), run: () => onSettings(query.trim()) }] : found;
  useEffect(() => { setAt(0); }, [query]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [at]);
  const run = (command: Command | undefined) => { if (!command) return; onClose(); command.run(); };
  return <div className="ed-palette-layer" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="ed-palette" role="dialog" aria-label={t('Find any action')}>
      <label className="ed-palette-search"><Search size={15}/><input autoFocus value={query} placeholder={t('Type what you want to do…')} aria-label={t('Find any action')} role="combobox" aria-expanded aria-controls="ed-palette-list"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') { event.preventDefault(); onClose(); }
          else if (event.key === 'ArrowDown') { event.preventDefault(); setAt((value) => (rows.length ? Math.min(rows.length - 1, value + 1) : 0)); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setAt((value) => Math.max(0, value - 1)); }
          else if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); run(rows[at]); }
        }}/><kbd>Esc</kbd></label>
      <ul id="ed-palette-list" ref={list} role="listbox">
        {rows.map((command, index) => <li key={command.id} role="option" aria-selected={index === at} className={index === at ? 'on' : ''} onPointerMove={(event) => { const last = pointer.current; pointer.current = { x: event.clientX, y: event.clientY }; if (last && (last.x !== event.clientX || last.y !== event.clientY)) setAt(index); }} onClick={() => run(command)}>
          <span>{command.label}</span><small>{command.group}</small>{command.hint && <kbd>{command.hint}</kbd>}
        </li>)}
        {!rows.length && <li className="ed-palette-empty">{t('Type to search actions, panels, title styles, guide pages and settings.')}</li>}
      </ul>
    </div>
  </div>;
}
