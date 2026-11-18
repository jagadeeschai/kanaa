import { LoaderCircle,X } from "lucide-react";
import { t } from "../../../i18n";
import { activeTheme,removeTheme,themeMusic,THEMES } from "../../../timeline/themes";
import { useEditorPanel } from "../../state/EditorContext";
import type { EditorLeftRailBindings } from '../EditorLeftRail';
import { SubTabs, useSubTab } from './SubTabs';

/** Themes by occasion, and the theme this video has (its music, taking it off). Every theme is in one group (tested). */
export const THEME_TABS: { id: 'occasions' | 'everyday' | 'video'; label: string; themes?: string[] }[] = [
  { id: 'occasions', label: 'Occasions', themes: ['wedding', 'festival', 'birthday'] },
  { id: 'everyday', label: 'Everyday', themes: ['travel', 'memories', 'vlog', 'classic'] },
  { id: 'video', label: 'This video' },
];

export function ThemesTabSection1() {
  const [part, choose] = useSubTab('themes', THEME_TABS);
  const { leftTab, timeline, chooseTheme, themeBusy, thumbs, themeWithMusic, setThemeWithMusic, library, changeThemeMusic, change } = useEditorPanel<EditorLeftRailBindings>('left');
  return (<>{leftTab === 'themes' && timeline && (() => {
          const current = activeTheme(timeline);
          const group = THEME_TABS.find((tab) => tab.id === part)?.themes ?? [];
          return <section className="ed-add" aria-label="Themes">
            <SubTabs label="Theme kinds" tabs={THEME_TABS} part={part} onChoose={choose}/>
            {part !== 'video' && <>
            <p className="ed-tip">One click: colours, transitions, photo movement, opening and ending titles. Your clips and words stay.</p>
            <div className="ed-themes">{THEMES.filter((look) => group.includes(look.id)).map((look) => <button key={look.id} className={`ed-theme ${current?.id === look.id ? 'on' : ''}`} aria-pressed={current?.id === look.id} onClick={() => { void chooseTheme(look); }} disabled={Boolean(themeBusy)} title={`${look.label}: ${look.about}`}>
              <span className="ed-theme-art" style={{ background: `linear-gradient(135deg, ${look.swatch[0]}, ${look.swatch[1]})` }}>{thumbs[`theme-${look.id}`] && <img src={thumbs[`theme-${look.id}`]} alt=""/>}</span>
              <span className="ed-theme-name"><b>{themeBusy === look.id ? <LoaderCircle className="spin" size={11}/> : null}{look.label}</b><em lang="ta">{look.tamil}</em></span><small>{look.about}</small></button>)}</div>
            <label className="ed-check"><input type="checkbox" checked={themeWithMusic} onChange={(event) => setThemeWithMusic(event.target.checked)}/><span>Add music from your library<small>{library === null ? 'Reading your music…' : library.length ? `${library.length} tracks, matched to each theme's mood.` : 'No music found in your Music app folder.'}</small></span></label>
            </>}
            {part === 'video' && <>
            {current ? <div className="ed-theme-current"><span className="ed-theme-art" style={{ background: `linear-gradient(135deg, ${current.swatch[0]}, ${current.swatch[1]})` }}/><span><b>{current.label}</b><em lang="ta">{current.tamil}</em></span></div>
              : <p className="ed-tip">{t('No theme yet. Choose one in Occasions or Everyday.')}</p>}
            {current && (() => { const music = themeMusic(timeline); return <div className="ed-add-row"><span>{music ? <>Music: <b>{music.name.replace(/^Theme music · /, '')}</b></> : 'No music'}</span>
              <span className="ed-pair-small">{library && library.length > 0 && <button className="ed-button" onClick={() => { void changeThemeMusic(true); }}>{music ? 'Another track' : 'Add music'}</button>}{music && <button className="ed-icon small" aria-label="Remove theme music" title="No music" onClick={() => { void changeThemeMusic(false); }}><X size={13}/></button>}</span></div>; })()}
            {current && <button className="ed-button wide" onClick={() => change(removeTheme(timeline))}><X size={14}/>Remove theme</button>}
            <p className="ed-tip">{t('Themes dress the whole video. To colour one clip, select it and open Colour; for a grade over everything, Project settings › Colour & finish.')}</p>
            <p className="ed-tip">Click the opening or ending title on the timeline to edit its words; a new theme keeps them.</p>
            </>}
            </section>;
        })()}</>);
}
