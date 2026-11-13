import { Children, createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { searchText, t } from '../i18n';
import { ChevronRight, ChevronsDownUp, Info, Search, X, type LucideIcon } from 'lucide-react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const THEME_KEY = 'wa.editorTheme';
const LAYOUT_KEY = 'wa.editorLayout';
const STEP = 16;

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* A private window keeps it for this visit only. */ } };

const systemIsDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/** One theme for the whole app. Set on <html>, which the lyric editor's styles already follow. */
export function useAppTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(() => { const saved = read(THEME_KEY); return saved === 'light' || saved === 'dark' ? saved : 'system'; });
  const [dark, setDark] = useState(systemIsDark);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const next = () => { const value = choice === 'system' ? 'light' : choice === 'light' ? 'dark' : 'system'; setChoice(value); write(THEME_KEY, value); };
  const theme = choice === 'system' ? (dark ? 'dark' : 'light') : choice;
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const set = (value: ThemeChoice) => { setChoice(value); write(THEME_KEY, value); };
  return { choice, next, set, theme };
}

/** `simple` hides rarely used controls (keyframes, More sections, Pro-only groups) for an easier editor. */
export type Layout = { media: number; inspector: number; timeline: number; mediaOpen: boolean; inspectorOpen: boolean; simple: boolean; hideTop?: boolean };
export const DEFAULT_LAYOUT: Layout = { media: 240, inspector: 280, timeline: 230, mediaOpen: true, inspectorOpen: true, simple: false };
export const LIMITS = { media: [180, 360], inspector: [240, 420], timeline: [128, 620] } as const;

export function useEditorLayout() {
  const [layout, setLayout] = useState<Layout>(() => {
    try { return { ...DEFAULT_LAYOUT, ...JSON.parse(read(LAYOUT_KEY) ?? '{}') }; } catch { return DEFAULT_LAYOUT; }
  });
  const update = useCallback((changes: Partial<Layout>) => setLayout((current) => { const next = { ...current, ...changes }; write(LAYOUT_KEY, JSON.stringify(next)); return next; }), []);
  const reset = useCallback(() => setLayout((current) => { const next = { ...DEFAULT_LAYOUT, simple: current.simple }; write(LAYOUT_KEY, JSON.stringify(next)); return next; }), []);
  return { layout, update, reset };
}

/** A drag handle between panels. `sign` is -1 when dragging toward the start makes the panel larger. */
export function Splitter({ label, axis, value, min, max, sign, onChange, onReset }: { label: string; axis: 'x' | 'y'; value: number; min: number; max: number; sign: 1 | -1; onChange: (value: number) => void; onReset: () => void }) {
  const drag = useRef<{ from: number; value: number } | null>(null);
  const limit = (next: number) => Math.round(Math.max(min, Math.min(max, next)));
  const at = (event: React.PointerEvent) => (axis === 'x' ? event.clientX : event.clientY);
  return <div className={`ed-split ${axis}`} role="separator" aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'} aria-label={label} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} tabIndex={0} title="Drag to resize. Double-click to reset."
    onDoubleClick={onReset}
    onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { from: at(event), value }; }}
    onPointerMove={(event) => { if (drag.current) onChange(limit(drag.current.value + (at(event) - drag.current.from) * sign)); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onKeyDown={(event) => {
      const grow = axis === 'x' ? (sign === 1 ? 'ArrowRight' : 'ArrowLeft') : (sign === 1 ? 'ArrowDown' : 'ArrowUp');
      const shrink = axis === 'x' ? (sign === 1 ? 'ArrowLeft' : 'ArrowRight') : (sign === 1 ? 'ArrowUp' : 'ArrowDown');
      if (event.key === grow) onChange(limit(value + STEP));
      else if (event.key === shrink) onChange(limit(value - STEP));
      else if (event.key === 'Home') onChange(min);
      else if (event.key === 'End') onChange(max);
      else return;
      event.preventDefault();
    }}/>;
}

const opened = new Map<string, boolean>();
// Collapse all: every open section closes at once, so the one wanted is quick to find.
const closers = new Set<() => void>();
export function collapseAllGroups() {
  for (const key of opened.keys()) opened.set(key, false);
  closers.forEach((close) => close());
}

/** A settings group. Several can stay open, and each remembers its state until the page reloads. */
/** Opens the guide at an article. Set by the editor; panels call it from their ⓘ buttons. */
/** True in Simple mode: Pro-only groups, More sections and keyframes are hidden. */
export const SimpleContext = createContext(false);
export const HelpContext = createContext<(article: string) => void>(() => {});

/** Which tab of a settings panel shows, and what's being searched for. Groups read it to decide whether they show. */
type PanelState = { tab: string; query: string };
const PanelContext = createContext<PanelState | null>(null);
export type PanelTab = { id: string; label: string; Icon: LucideIcon; changed?: boolean };
const lastTab = new Map<string, string>();

/** The right-hand settings panel folds to its icon rail. Provided by the editor around the workspace. */
export const RailContext = createContext<{ folded: boolean; setOpen: (open: boolean) => void; tools?: ReactNode }>({ folded: false, setOpen: () => {} });

/**
 * A gentle settings panel: its tabs become a slim icon rail on the panel's right edge, like the left media rail.
 * Clicking the open tab's icon folds the panel to the rail; clicking any icon on the folded rail unfolds it.
 * The search box and every group behave exactly as before.
 */
/** Set while the settings panel shows a whole layer: only groups a layer can style are shown. */
export const LayerModeContext = createContext(false);
const LAYER_TABS = new Set(['style', 'motion', 'frame', 'look', 'effects', 'sound']);
const LAYER_GROUPS = new Set(['Text', 'Layout and look', 'Subtitle', 'Simple animation', 'Moves', 'Keyframes', 'Frame', 'Colour', 'Colour splash', 'Dreamy glow', 'Old film', 'Signal damage', 'Lens surface', 'Mirror and kaleidoscope', 'Duotone and split-tone', 'Tilt-shift', 'Beat pulse', 'Echo trail', 'Zoom blur', 'Animation', 'Moves', 'Speed and sound']);

export function Panel({ id, tabs: allTabs, header, children }: { id: string; tabs: PanelTab[]; header?: ReactNode; children: ReactNode }) {
  // A whole layer shows only the tabs a layer can style.
  const layerMode = useContext(LayerModeContext);
  const tabs = layerMode ? allTabs.filter((item) => LAYER_TABS.has(item.id)) : allTabs;
  const remembered = lastTab.get(id);
  const [tab, setTab] = useState(remembered && tabs.some((item) => item.id === remembered) ? remembered : tabs[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const rail = useContext(RailContext);
  const folded = rail.folded;
  const shown = tabs.some((item) => item.id === tab) ? tab : tabs[0]?.id ?? '';
  const pick = (next: string) => { lastTab.set(id, next); setTab(next); setQuery(''); };
  return <PanelContext.Provider value={{ tab: shown, query: query.trim().toLowerCase() }}>
    <div className="ed-panel-rail-host">
      {!folded && <div className="ed-panel-main">
        <div className="ed-find-row"><label className="ed-find"><Search size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Find a setting…')} aria-label={t('Find a setting')}/>{query && <button className="ed-icon small" aria-label="Clear search" onClick={() => setQuery('')}><X size={12}/></button>}</label><button className="ed-icon" aria-label={t('Collapse all')} data-tip={t('Collapse all')} onClick={collapseAllGroups}><ChevronsDownUp size={15}/></button></div>
        {header}
        <div className="ed-panel-body">{children}</div>
        {query && <p className="ed-tip ed-find-none">{t('Matching “{query}”.', { query })} <button className="ed-link" onClick={() => setQuery('')}>{t('Show all')}</button></p>}
      </div>}
      <div className="ed-rail-tabs right" role="group" aria-label="Settings sections">{tabs.map(({ id: key, label, Icon, changed }) => {
        const active = !folded && shown === key;
        return <button key={key} className={active ? 'on' : ''} aria-pressed={active} aria-label={t(label)} data-tip={t(label)}
          onClick={() => { if (active) rail.setOpen(false); else { if (folded) rail.setOpen(true); pick(key); } }}>
          <Icon size={17}/>{changed && <i className="ed-rail-dot" title="Has changes"/>}
        </button>;
      })}{rail.tools}</div>
    </div>
  </PanelContext.Provider>;
}

/**
 * A section of settings. In a Panel it shows on its own tab, or when its title or keywords match the search (then open).
 * `tip` is one plain sentence under the title; `help` opens the guide's article on it.
 */
/** A small heading between groups on one tab, hidden on other tabs and while searching. */
export function TabHeading({ tab, children }: { tab: string; children: ReactNode }) {
  const panel = useContext(PanelContext);
  if (panel && (panel.query || panel.tab !== tab)) return null;
  return <h4 className="ed-tab-heading">{children}</h4>;
}

export function Group({ title, startOpen = false, changed = false, tab, keywords = '', tip, help, pro = false, summary, children }: { title: string; startOpen?: boolean; changed?: boolean; tab?: string; keywords?: string; tip?: string; help?: string; pro?: boolean; /** A one-line look at the values, shown in the heading. */ summary?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(opened.get(title) ?? startOpen);
  useEffect(() => {
    const close = () => { opened.set(title, false); setOpen(false); };
    closers.add(close);
    return () => { closers.delete(close); };
  }, [title]);
  const panel = useContext(PanelContext);
  const openHelp = useContext(HelpContext);
  const simple = useContext(SimpleContext);
  if (useContext(LayerModeContext) && !LAYER_GROUPS.has(title)) return null;
  // A Pro group already in use stays visible, so Simple mode never hides a setting that is changing the video.
  if (simple && pro && !changed) return null;
  const matches = panel?.query ? `${searchText(title)} ${keywords} ${tip ? searchText(tip) : ''}`.toLowerCase().includes(panel.query) : null;
  if (panel && (matches === false || (matches === null && tab && tab !== panel.tab))) return null;
  const showing = open || Boolean(matches);
  return <section className={`ed-group ${showing ? 'open' : ''}`}>
    <div className="ed-group-top">
      <button className="ed-group-head" aria-expanded={showing} onClick={() => { opened.set(title, !open); setOpen(!open); }}><ChevronRight size={14}/><span>{t(title)}</span>{summary && <small className="ed-group-summary">{summary}</small>}{changed && <i title="Changed from the default"/>}</button>
      {help && <button className="ed-icon small ed-help-button" aria-label={`${t('Learn more')}: ${t(title)}`} title={t('Learn more')} onClick={() => openHelp(help)}><Info size={13}/></button>}
    </div>
    {showing && <div className="ed-group-body">{tip && <p className="ed-group-tip">{t(tip)}</p>}{children}</div>}
  </section>;
}

/** Advanced settings, folded away until wanted. A search opens it. */
export function More({ label = 'More options', children }: { label?: string; children: ReactNode }) {
  const panel = useContext(PanelContext);
  const [open, setOpen] = useState(false);
  const simple = useContext(SimpleContext);
  // Nothing inside for this clip (say, a photo on the main track): no empty "More options" to open.
  if (simple || Children.toArray(children).length === 0) return null;
  const showing = open || Boolean(panel?.query);
  return <div className={`ed-more ${showing ? 'open' : ''}`}>
    <button className="ed-more-head" aria-expanded={showing} onClick={() => setOpen(!open)}><ChevronRight size={13}/>{t(label)}</button>
    {showing && <div className="ed-more-body">{children}</div>}
  </div>;
}
