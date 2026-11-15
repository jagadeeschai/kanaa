import { Link2 } from "lucide-react";
import LyricSyncFix from "../../components/LyricSyncFix";
import { LANGUAGE,t } from "../../i18n";
import type { Clipboard,CopiedStyle } from '../../timeline/clipboard';
import type { BlurLayer,TextLayer } from '../../timeline/model';
import { clipLength,duration,findClip,findText,followsLayer,layerLines,mainLayer,moveItem,overriddenCount,overrideLayerItems,ownOverLayer,retimeLayerLines,setFollowLayer,sharedKeys,soundLength,styledLayerOf,trimClip,trimSound,trimText,useLayerStyle,type AudioLayer,type BlurBox,type Caption,type CaptionLayer,type Clip,type Sound,type SourceFacts,type TextItem,type Timeline,type VideoLayer } from "../../timeline/model";
import { TEMPLATES,type Template } from "../../timeline/templates";
import type { Photo } from "../../types/photo";
import { type Command } from "../CommandPalette";
import { type MenuItem } from "../ContextMenu";
import { type TimeFieldProps } from "../controls";
import { LEFT_TAB_LABELS,LEFT_TABS,STYLE_NAMES,TAB_TIPS } from "../editor-constants";
import { ARTICLES } from "../guide-articles";
import type { Layout } from '../layout';
import { PlaybackEngine } from "../playback";
type Action = { type: 'load'; timeline: Timeline } | { type: 'change'; timeline: Timeline; group?: string | null } | { type: 'undo' } | { type: 'redo' };

type Input = {
  fps: number;
  addTitle: (title: Template, dropAt?: number | undefined, words?: string | undefined) => Promise<void>;
  change: (next: Timeline, group?: string | null) => void;
  clipboard: { styleCopy: CopiedStyle | null; clearStyle: () => void; copy: (cut?: boolean) => void; pasteAt: (at: number, copied?: Clipboard | null) => void; duplicate: () => void; copyStyleOf: (id?: string | null) => void; pasteStyleOnto: (ids?: string[]) => void; menuItems: (id: string, at: number) => MenuItem[]; hasCopy: () => boolean; };
  dispatch: React.Dispatch<Action>;
  engineRef: React.MutableRefObject<PlaybackEngine | null>;
  facts: (id: number) => SourceFacts | undefined;
  freeze: (t?: number) => void;
  layerSettings: string | null;
  layerWins: boolean;
  layout: Layout;
  mediaById: Map<number, Photo>;
  moreIds: ReadonlySet<string>;
  now: number;
  openGuide: (article: string) => void;
  playhead: { current: number; };
  renderPreview: () => Promise<void>;
  seek: (t: number) => void | undefined;
  selectedId: string | null;
  selectedLayer: VideoLayer | AudioLayer | TextLayer | CaptionLayer | BlurLayer | undefined;
  setExporting: React.Dispatch<React.SetStateAction<boolean>>;
  setLanguage: React.Dispatch<React.SetStateAction<string>>;
  setLayerSettings: React.Dispatch<React.SetStateAction<string | null>>;
  setLayerWins: React.Dispatch<React.SetStateAction<boolean>>;
  setLeftTab: React.Dispatch<React.SetStateAction<"audio" | "text" | "media" | "words" | "transitions" | "effects" | "templates" | "themes" | "ask">>;
  setMoreIds: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setShowingHelp: React.Dispatch<React.SetStateAction<boolean>>;
  setSyncOpen: React.Dispatch<React.SetStateAction<boolean>>;
  snapshot: (t?: number | undefined) => Promise<void>;
  sourceLimit: (mediaId: number) => number | undefined;
  split: () => void;
  syncOpen: boolean;
  timeline: Timeline | null;
  toggleFullScreen: () => void;
  togglePlay: () => void;
  total: number;
  updateLayout: (changes: Partial<Layout>) => void;
};

/** Existing editor actions; the input getter preserves render snapshots and forward references. */
export function createInspectorScopeActions(getInput: () => Input) {
  const openLayerSettings = (...args: Parameters<(layerId: string, open?: "sync") => void>) => {
    const { setSyncOpen, timeline, setSelectedId, setLayerSettings } = getInput();
    const invoke = (layerId: string, open?: 'sync') => {
    setSyncOpen(open === 'sync');
    const layer = timeline?.layers.find((l) => l.id === layerId);
    if (!layer || (layer.kind !== 'text' && layer.kind !== 'video') || !layer.items.length) return;
    // The panel shows an item that follows the layer, so it reads the layer's own settings.
    const items = layer.items as (Clip | TextItem)[];
    setSelectedId((items.find((item) => !item.own?.length) ?? items[0]).id);
    setLayerSettings(layerId);
  };
    return invoke(...args);
  };

  const scopeBar = (...args: Parameters<(id: string, noun: "title" | "clip") => React.JSX.Element | null>) => {
    const { timeline, layerSettings, layerWins, setLayerWins, change, syncOpen, setSyncOpen, now, seek } = getInput();
    const invoke = (id: string, noun: 'title' | 'clip') => {
    const layer = timeline ? styledLayerOf(timeline, id) : null;
    if (!timeline || !layer) return null;
    if (layerSettings) {
      const overridden = overriddenCount(timeline, layerSettings);
      return <div className="ed-scope">
        <p className="ed-tip">{t('Every item on this layer follows, except settings an item sets itself.')} ({layer.items.length})</p>
        <label className="ed-check"><input type="checkbox" checked={layerWins} onChange={(event) => setLayerWins(event.target.checked)}/>{t('Changes here override every clip')}</label>
        {overridden > 0 && <button type="button" className="ed-button wide" title={t("Every item drops its own settings and takes the layer's")} onClick={() => change(overrideLayerItems(timeline, layerSettings))}>{t('Override all ({count} set their own)', { count: overridden })}</button>}
        {layer.kind === 'text' && layer.items.length > 1 && <details className="ed-sync-fold" open={syncOpen} onToggle={(event) => setSyncOpen((event.currentTarget as HTMLDetailsElement).open)}><summary>{t('Fix lyric timing')}</summary><LyricSyncFix cues={layerLines(timeline, layer.id)} duration={Math.max(duration(timeline), ...layerLines(timeline, layer.id).map((line) => line.end))} position={now}
          onSeek={seek} onChange={(lines) => change(retimeLayerLines(timeline, layer.id, lines))}/></details>}
      </div>;
    }
    const own = ownOverLayer(timeline, id);
    const item = (layer.items as (Clip | TextItem)[]).find((entry) => entry.id === id);
    const following = !item || followsLayer(item);
    if (!Object.keys(layer.style ?? {}).length && following) return null;
    return <div className="ed-scope">
      {(following ? Object.keys(layer.style ?? {}).length > 0 : true) && <label className="ed-check ed-follow" title={t(following ? "Follows the layer's settings. Turn off to keep this one as it is" : "Layer settings don't apply here. Turn on to follow the layer")}><input type="checkbox" checked={following} onChange={() => change(setFollowLayer(timeline, id, !following))}/><Link2 size={13}/>{t('Use layer style')}</label>}
      {following && own.length > 0 && <p className="ed-tip">{t(noun === 'title' ? 'This title sets its own:' : 'This clip sets its own:')} {own.map((key) => t(STYLE_NAMES[key] ?? key.replace(/_/g, ' '))).join(', ')}. <button type="button" className="ed-link" onClick={() => change(useLayerStyle(timeline, id))}>{t("Use the layer's")}</button></p>}
    </div>;
  };
    return invoke(...args);
  };

  const pick = (...args: Parameters<(id: string | null, how?: "add" | "range") => void>) => {
    const { selectedId, timeline, setMoreIds, setSelectedId, moreIds } = getInput();
    const invoke = (id: string | null, how?: 'add' | 'range') => {
    if (!how || !id || !selectedId || !timeline) { setMoreIds(new Set()); setSelectedId(id); return; }
    if (how === 'add') {
      if (id === selectedId) {  // ⌘-click on the main one passes the lead to another picked item.
        const [next, ...rest] = [...moreIds];
        if (next) { setSelectedId(next); setMoreIds(new Set(rest)); } else setSelectedId(null);
        return;
      }
      const next = new Set(moreIds); if (next.has(id)) next.delete(id); else next.add(id);
      setMoreIds(next); return;
    }
    // A range: every item on the same layer from the selected one to this one, by time.
    const layer = timeline.layers.find((l) => (l.items as { id: string }[]).some((item) => item.id === id));
    const items = layer ? [...(layer.items as { id: string; start: number }[])].sort((a, b) => a.start - b.start) : [];
    const from = items.findIndex((item) => item.id === selectedId), to = items.findIndex((item) => item.id === id);
    if (from < 0 || to < 0) { setMoreIds(new Set()); setSelectedId(id); return; }
    setMoreIds(new Set(items.slice(Math.min(from, to), Math.max(from, to) + 1).map((item) => item.id).filter((other) => other !== selectedId)));
  };
    return invoke(...args);
  };

  const paletteCommands = (...args: Parameters<() => Command[]>) => {
    const { timeline, total, togglePlay, split, freeze, snapshot, renderPreview, engineRef, setExporting, dispatch, selectedId, clipboard, playhead, toggleFullScreen, setShowingHelp, setLayerSettings, setSelectedId, updateLayout, layout, setLanguage, setLeftTab, setPanelOpen, addTitle, openGuide } = getInput();
    const invoke = (): Command[] => {
    const list: Command[] = [];
    // Labels and groups are translated here, with the English kept as keywords so English search still finds them.
    const add = (id: string, label: string, group: string, run: () => void, hint?: string, keywords?: string) => list.push({ id, label: t(label), group: t(group), run, hint, keywords: `${label} ${group} ${keywords ?? ''}` });
    const named = (id: string, english: string, name: string, group: string, run: () => void, keywords?: string) => list.push({ id, label: t(english, { name }), group: t(group), run, keywords: `${english.replace('{name}', name)} ${group} ${keywords ?? ''}` });
    const busy = !timeline || !total;
    if (!busy) {
      add('play', 'Play or pause', 'Playback', () => togglePlay(), 'Space');
      add('split', 'Split at the playhead', 'Edit', () => split(), 'S', 'cut');
      add('freeze', 'Freeze frame', 'Edit', () => freeze(), undefined, 'hold still');
      add('snapshot', 'Snapshot', 'Edit', () => { void snapshot(); }, undefined, 'photo capture');
      add('render', 'Render smooth preview', 'View', () => { void renderPreview(); });
      add('export', 'Export', 'Video', () => { engineRef.current?.pause(); setExporting(true); }, undefined, 'save mp4 share download');
    }
    add('undo', 'Undo', 'Edit', () => dispatch({ type: 'undo' }), '⌘Z');
    if (selectedId) { add('copy', 'Copy', 'Edit', () => clipboard.copy(), '⌘C'); add('cut', 'Cut', 'Edit', () => clipboard.copy(true), '⌘X'); add('duplicate', 'Duplicate', 'Edit', () => clipboard.duplicate(), '⌘D');
      add('copy-style', 'Copy style', 'Edit', () => clipboard.copyStyleOf(), '⌥⌘C', 'format painter look'); if (clipboard.styleCopy) add('paste-style', 'Paste style', 'Edit', () => clipboard.pasteStyleOnto(), '⌥⌘V', 'format painter look'); }
    if (clipboard.hasCopy()) add('paste', 'Paste at the playhead', 'Edit', () => clipboard.pasteAt(playhead.current), '⌘V');
    add('redo', 'Redo', 'Edit', () => dispatch({ type: 'redo' }), '⇧⌘Z');
    add('full', 'Full screen preview', 'View', () => toggleFullScreen(), 'F');
    add('guide', 'Guide and shortcuts', 'Help', () => setShowingHelp(true), '?');
    add('project', 'Project settings', 'Settings', () => { setLayerSettings(null); setSelectedId(null); updateLayout({ inspectorOpen: true }); }, undefined, 'format shape frame rate loudness brand');
    add('lite', layout.simple ? 'Switch to Pro (every control)' : 'Switch to Lite (main choices only)', 'Settings', () => updateLayout({ simple: !layout.simple }));
    add('language', LANGUAGE === 'ta' ? 'Switch to English' : 'Switch to Tamil (தமிழ்)', 'Settings', () => setLanguage(LANGUAGE === 'ta' ? 'en' : 'ta'), undefined, 'language tamil english');
    for (const tab of LEFT_TABS) named(`tab-${tab}`, 'Open {name}', t(LEFT_TAB_LABELS[tab]), 'Panels', () => { setLeftTab(tab); setPanelOpen(true); }, `${LEFT_TAB_LABELS[tab]} ${TAB_TIPS[tab]}`);
    if (timeline) for (const layer of timeline.layers) if ((layer.kind === 'text' || layer.kind === 'video') && layer.items.length) {
      named(`layer-${layer.id}`, 'Layer settings: {name}', layer.name || layer.kind, 'Layers', () => openLayerSettings(layer.id), 'whole layer style');
      if (layer.kind === 'text' && layer.items.length > 1) named(`sync-${layer.id}`, 'Fix lyric timing: {name}', layer.name || 'Text', 'Layers', () => openLayerSettings(layer.id, 'sync'), 'sync shift stretch lyrics offset');
    }
    if (timeline) for (const title of TEMPLATES) named(`title-${title.id}`, 'Add title: {name}', t(title.label), 'Titles', () => { void addTitle(title); }, 'text heading');
    for (const article of ARTICLES) named(`guide-${article.id}`, 'Guide: {name}', LANGUAGE === 'ta' && article.tamil ? article.tamil : article.title, 'Help', () => openGuide(article.id), `${article.title} ${article.tamil ?? ''} ${article.summary}`);
    return list;
  };
    return invoke(...args);
  };

  const findSetting = (...args: Parameters<(query: string) => void>) => {
    const { updateLayout } = getInput();
    const invoke = (query: string) => {
    updateLayout({ inspectorOpen: true });
    window.setTimeout(() => {
      const box = document.querySelector<HTMLInputElement>('.ed-inspector input[aria-label="Find a setting"], .ed-inspector .ed-find input');
      if (!box) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, query);
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.focus();
    }, 60);
  };
    return invoke(...args);
  };

  const mixedSettings = (...args: Parameters<() => string[]>) => {
    const { timeline, selectedId, moreIds } = getInput();
    const invoke = (): string[] => {
    if (!timeline || !selectedId || !moreIds.size) return [];
    const ids = [selectedId, ...moreIds];
    const items = ids.map((id) => findText(timeline, id)?.text ?? findClip(timeline, id)).filter(Boolean) as Record<string, unknown>[];
    if (items.length < 2) return [];
    const keys = sharedKeys(Object.assign({}, ...items)).filter((key) => key !== 'transform' && key !== 'adjust');
    return keys.filter((key) => new Set(items.map((item) => JSON.stringify(item[key] ?? null))).size > 1).slice(0, 6);
  };
    return invoke(...args);
  };

  const clipTiming = (...args: Parameters<(clip: Clip) => TimeFieldProps[]>) => {
    const { fps, timeline, selectedLayer, change, facts, sourceLimit, mediaById } = getInput();
    const invoke = (clip: Clip): TimeFieldProps[] => {
    if (!timeline) return [];
    const length = clipLength(clip);
    const main = selectedLayer === mainLayer(timeline);
    const edit = (edge: 'in' | 'out', seconds: number) => change(main ? trimClip(timeline, clip.id, edge, seconds, facts(clip.media_id)) : trimSound(timeline, clip.id, edge, seconds, sourceLimit(clip.media_id)));
    const isVideo = mediaById.get(clip.media_id)?.media_type === 'video';
    return [
      main ? { label: 'Start', value: clip.start, fps } : { label: 'Start', value: clip.start, fps, onChange: (t: number) => change(moveItem(timeline, clip.id, t)) },
      { label: 'Duration', value: length, fps, onChange: (t: number) => edit('out', clip.in + t * clip.speed) },
      ...(isVideo ? [{ label: 'In', value: clip.in, fps, onChange: (t: number) => edit('in', t) }, { label: 'Out', value: clip.out, fps, onChange: (t: number) => edit('out', t) }] : []),
    ];
  };
    return invoke(...args);
  };

  const soundTiming = (...args: Parameters<(sound: Sound) => TimeFieldProps[]>) => {
    const { fps, timeline, change } = getInput();
    const invoke = (sound: Sound): TimeFieldProps[] => (timeline ? [
    { label: 'Start', value: sound.start, fps, onChange: (t) => change(moveItem(timeline, sound.id, t)) },
    { label: 'Duration', value: soundLength(sound), fps, onChange: (t) => change(trimSound(timeline, sound.id, 'out', sound.in + t * sound.speed)) },
    { label: 'In', value: sound.in, fps, onChange: (t) => change(trimSound(timeline, sound.id, 'in', t)) },
    { label: 'Out', value: sound.out, fps, onChange: (t) => change(trimSound(timeline, sound.id, 'out', t)) },
  ] : []);
    return invoke(...args);
  };

  const textTiming = (...args: Parameters<(text: TextItem | BlurBox | Caption) => TimeFieldProps[]>) => {
    const { fps, timeline, change } = getInput();
    const invoke = (text: TextItem | BlurBox | Caption): TimeFieldProps[] => (timeline ? [
    { label: 'Start', value: text.start, fps, onChange: (t) => change(moveItem(timeline, text.id, t)) },
    { label: 'Duration', value: text.length, fps, onChange: (t) => change(trimText(timeline, text.id, 'out', text.start + t)) },
    { label: 'End', value: text.start + text.length, fps, onChange: (t) => change(trimText(timeline, text.id, 'out', t)) },
  ] : []);
    return invoke(...args);
  };
  return { openLayerSettings, scopeBar, pick, paletteCommands, findSetting, mixedSettings, clipTiming, soundTiming, textTiming };
}
