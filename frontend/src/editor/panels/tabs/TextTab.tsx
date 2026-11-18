import { Captions,ScanFace,Type,X } from "lucide-react";
import KanaaSelect from "../../../components/KanaaSelect";
import { t } from "../../../i18n";
import { captionLayers } from "../../../timeline/model";
import { TEMPLATES } from "../../../timeline/templates";
import { useEditorPanel } from "../../state/EditorContext";
import { LANGUAGES } from "../../Words";
import type { EditorLeftRailBindings } from '../EditorLeftRail';
import { GraphicsSection } from './GraphicsSection';
import SourcesPanel from '../../SourcesPanel';
import LyricLayoutPanel from '../../LyricLayoutPanel';
import { lyricLines } from '../../../timeline/song-sections';
import { SubTabs, useSubTab } from './SubTabs';

export function TextTabSection1() {
  const { leftTab, draggableAs, addTitle, thumbs, myStyles, forgetStyle, layout, captionsWaiting, wordJob, total, makeCaptions, timeline, language, setLanguage, captionWords, setCaptionWords, clearing, keepClearOfFaces, clearNote } = useEditorPanel<EditorLeftRailBindings>('left');
  // Four parts, so the tab isn't one long list: titles, captions, explainer graphics (with sources), and lyric layout (only with lyrics).
  const hasLyrics = Boolean(timeline && lyricLines(timeline).length >= 2);
  const tabs = [{ id: 'titles' as const, label: 'Titles' }, { id: 'captions' as const, label: 'Captions' }, { id: 'graphics' as const, label: 'Graphics' }, ...(hasLyrics ? [{ id: 'lyrics' as const, label: 'Lyrics' }] : [])];
  const [part, choose] = useSubTab('text', tabs);
  return (<>{leftTab === 'text' && <>
          <SubTabs label="Text tools" tabs={tabs} part={part} onChoose={choose}/>
          {part === 'titles' && <>
          <section className="ed-add" aria-label="Titles"><h3 className="ed-sub">Titles</h3><p className="ed-tip">Click to add at the playhead, or drag onto the timeline, then type your words.</p>
            <div className="ed-templates">{TEMPLATES.map((template) => <button key={template.id} className="ed-template" {...draggableAs({ kind: 'title', template: template.id })} onClick={() => addTitle(template)} title={`Add a ${template.label} title`}>
              <span className="ed-template-art">{thumbs[template.id] ? <img src={thumbs[template.id]} alt=""/> : <Type size={16}/>}</span><span>{template.label}</span></button>)}</div>
            {myStyles.length > 0 && <><h3 className="ed-sub">My styles</h3><div className="ed-templates">{myStyles.map((style) => <div key={style.id} className="ed-template-wrap">
              <button className="ed-template" {...draggableAs({ kind: 'title', template: style.id })} onClick={() => addTitle(style)} title="Add a title in this style"><span className="ed-template-art">{thumbs[style.id] ? <img src={thumbs[style.id]} alt=""/> : <Type size={16}/>}</span><span>{style.label}</span></button>
              <button className="ed-icon small ed-template-forget" aria-label={`Forget the style ${style.label}`} title="Forget this style" onClick={() => forgetStyle(style.id)}><X size={12}/></button></div>)}</div></>}</section>
          </>}
          {part === 'captions' && <>
          <section className="ed-add" aria-label="Captions"><h3 className="ed-sub">Captions</h3>
            {layout.simple ? <>
              <p className="ed-tip">Writes the words people say, timed to their speech.</p>
              {captionsWaiting && wordJob ? <p className="ed-tip" role="status">Listening to your video… {wordJob.progress}%</p>
                : <button className="ed-button wide" disabled={!total} onClick={() => makeCaptions()}><Captions size={14}/>{timeline && captionLayers(timeline).length ? 'Make captions again' : 'Add captions'}</button>}
            </> : <>
            <p className="ed-tip">Turns the speech in your main track into captions{timeline && captionLayers(timeline).length ? '. Making them again replaces the old ones.' : '.'}</p>
            <label className="ed-words-language"><span>{t('Spoken language')}</span><KanaaSelect aria-label={t('Spoken language')} value={language} onChange={(event) => { setLanguage(event.target.value); try { localStorage.setItem('wa.wordsLanguage', event.target.value); } catch { /* the choice just isn't remembered */ } }}>{LANGUAGES.map((option) => <option key={option.id} value={option.id}>{t(option.label)}</option>)}</KanaaSelect></label>
            <div className="ed-add-row"><span>Words per caption</span><div className="ed-chips ed-even" role="group" aria-label="Words per caption">{[1, 2, 3, 4].map((count) => <button key={count} className={captionWords === count ? 'on' : ''} aria-pressed={captionWords === count} onClick={() => setCaptionWords(count)}>{count}</button>)}</div></div>
            {captionsWaiting && wordJob ? <><div className="ed-progress"><i style={{ width: `${wordJob.progress}%` }}/></div><p className="ed-tip">Listening to your video… {wordJob.progress}%. The captions follow.</p></>
              : <button className="ed-button wide" disabled={!total} onClick={() => makeCaptions()}><Captions size={14}/>{timeline && captionLayers(timeline).length ? 'Make captions again' : 'Add captions'}</button>}
            {timeline && captionLayers(timeline).some((layer) => layer.items.length) && <button className="ed-button wide" disabled={clearing} onClick={() => { void keepClearOfFaces(); }} title="A caption that would cover someone's face moves to the top for that moment"><ScanFace size={14}/>{clearing ? 'Looking for faces…' : 'Keep captions clear of faces'}</button>}
            {clearNote && <p className="ed-tip" role="status">{clearNote}</p>}</>}</section>
          </>}
          {part === 'graphics' && <>
          <GraphicsSection/>
          <SourcesPanel/>
          </>}
          {part === 'lyrics' && <LyricLayoutPanel/>}
        </>}</>);
}
