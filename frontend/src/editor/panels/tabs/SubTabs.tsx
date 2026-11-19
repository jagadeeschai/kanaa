import { useState } from 'react';
import { t } from '../../../i18n';

/** A left-panel tab's own parts (Audio: Music / Lyrics / Voice / Sounds; Text: Titles / Captions / Graphics / Lyrics),
 * so a tab is never one long list. The part last chosen is remembered per viewer; a part that isn't offered now
 * (Lyrics, in a video without lyrics) falls back to the first. */
export function useSubTab<T extends string>(name: string, offered: { id: T; label: string }[]): [T, (id: T) => void] {
  const key = `kanaa.${name}-part`;
  const [chosen, setChosen] = useState<string>(() => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } });
  const part = (offered.find((tab) => tab.id === chosen) ?? offered[0]).id;
  const choose = (id: T) => { setChosen(id); try { localStorage.setItem(key, id); } catch { /* Remembering is only a convenience. */ } };
  return [part, choose];
}

export function SubTabs<T extends string>({ label, tabs, part, onChoose }: { label: string; tabs: { id: T; label: string }[]; part: T; onChoose: (id: T) => void }) {
  return <div className="ed-tabs ed-tabs-compact" role="tablist" aria-label={t(label)} style={{ gridTemplateColumns: `repeat(${tabs.length}, auto)` }}>
    {tabs.map((tab) => <button key={tab.id} role="tab" aria-selected={part === tab.id} onClick={() => onChoose(tab.id)}>{t(tab.label)}</button>)}
  </div>;
}
