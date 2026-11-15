import { LANGUAGE, setLanguage, t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { Monitor, Moon, Sun, SlidersHorizontal } from "lucide-react";
import { Settings2 } from "lucide-react";
import { type ThemeChoice } from "./layout";

export function TopSettings({ appearance, onAppearance, simple, onSimple, format, onProject }: { appearance: ThemeChoice; onAppearance: (choice: ThemeChoice) => void; simple: boolean; onSimple: (simple: boolean) => void; format: string; onProject: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key); };
  }, [open]);
  return <div className="ed-top-settings" ref={box}>
    <button className={open ? 'on' : ''} aria-label={t('Settings')} aria-haspopup="menu" aria-expanded={open} data-tip={t('Settings')} onClick={() => setOpen((value) => !value)}><Settings2 size={17}/></button>
    {open && <div className="ed-top-menu" role="menu">
      <div className="ed-top-row"><span>{t('Editor')}</span><div className="ed-mode" role="group" aria-label={t('Editor')}>
        <button aria-pressed={simple} className={simple ? 'on' : ''} onClick={() => onSimple(true)} title={t('Main choices only')}>Lite</button>
        <button aria-pressed={!simple} className={simple ? '' : 'on'} onClick={() => onSimple(false)} title={t('Every control')}>Pro</button>
      </div></div>
      <div className="ed-top-row"><span>{t('Language')}</span><div className="ed-mode" role="group" aria-label={t('Language')}>
        <button aria-pressed={LANGUAGE === 'en'} className={LANGUAGE === 'en' ? 'on' : ''} onClick={() => { if (LANGUAGE !== 'en') setLanguage('en'); }}>English</button>
        <button aria-pressed={LANGUAGE === 'ta'} className={LANGUAGE === 'ta' ? 'on' : ''} lang="ta" onClick={() => { if (LANGUAGE !== 'ta') setLanguage('ta'); }}>தமிழ்</button>
      </div></div>
      <div className="ed-top-row"><span>{t('Appearance')}</span><div className="ed-mode" role="group" aria-label={t('Appearance')}>
        {([['system', <Monitor key="m" size={15}/>, 'Same as this Mac'], ['light', <Sun key="s" size={15}/>, 'Light'], ['dark', <Moon key="d" size={15}/>, 'Dark']] as const).map(([choice, icon, label]) =>
          <button key={choice} aria-pressed={appearance === choice} className={appearance === choice ? 'on' : ''} onClick={() => onAppearance(choice)} title={t(label)} aria-label={t(label)}>{icon}</button>)}
      </div></div>
      <button className="ed-top-item" role="menuitem" onClick={() => { onProject(); setOpen(false); }}><SlidersHorizontal size={15}/><span>{t('Project settings')}</span><em>{format}</em></button>
    </div>}
  </div>;
}
