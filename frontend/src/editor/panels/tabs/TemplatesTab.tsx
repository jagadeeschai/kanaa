import { ArrowLeft,Check,LoaderCircle,Plus,X } from "lucide-react";
import { photoThumbUrl } from "../../../api/client";
import { mainLayer } from "../../../timeline/model";
import { fillRest,STORIES,storySeconds } from "../../../timeline/stories";
import { THEMES } from "../../../timeline/themes";
import { useEditorPanel } from "../../state/EditorContext";
import type { EditorLeftRailBindings } from '../EditorLeftRail';

export function TemplatesTabSection1() {
  const { leftTab, timeline, story, setStory, mediaById, storyMedia, facts, themeBusy, momentProgress, makeStory } = useEditorPanel<EditorLeftRailBindings>('left');
  return (<>{leftTab === 'templates' && timeline && <div data-keep-panel>{(() => {
          if (story) {
            const filled = story.fills.filter((id) => id !== null).length;
            const pick = (index: number, id: number | null) => setStory({ ...story, fills: story.fills.map((current, at) => (at === index ? id : current)), choosing: null });
            return <section className="ed-add" aria-label="Story">
              <div className="ed-add-row"><button className="ed-button" onClick={() => setStory(null)}><ArrowLeft size={13}/>All stories</button><span>{filled} of {story.story.slots.length} filled</span></div>
              <h3 className="ed-sub">{story.story.label} <em lang="ta" className="ed-tamil-note">{story.story.tamil}</em></h3>
              <ol className="ed-slots">{story.story.slots.map((item, index) => { const id = story.fills[index]; const chosen = id !== null ? mediaById.get(id) : undefined; return <li key={item.label} className={story.choosing === index ? 'on' : ''}>
                <button className="ed-slot" onClick={() => setStory({ ...story, choosing: story.choosing === index ? null : index })} title={item.hint}>
                  <span className="ed-slot-art">{chosen ? <img src={photoThumbUrl(chosen.id)} alt=""/> : <Plus size={14}/>}</span>
                  <span className="ed-slot-text"><b>{index + 1}. {item.label}</b><em lang="ta">{item.tamil} · {item.seconds}s</em><small>{chosen ? chosen.filename : item.hint}</small></span></button>
                {chosen && <button className="ed-icon small" aria-label={`Empty ${item.label}`} title="Empty this moment" onClick={() => pick(index, null)}><X size={12}/></button>}
                {story.choosing === index && <div className="ed-media-grid ed-backgrounds">{storyMedia.length ? storyMedia.map((item2) => <button key={item2.id} className="ed-tile-add" onClick={() => pick(index, item2.id)} title={`Use ${item2.filename}`}><img src={photoThumbUrl(item2.id)} alt="" loading="lazy"/><span className="ed-tile-label"><b>{item2.filename}</b></span></button>) : <p className="ed-tip">Import your clips and photos in Media first.</p>}</div>}
              </li>; })}</ol>
              <button className="ed-button wide" disabled={!storyMedia.length || filled === story.fills.length} onClick={() => setStory({ ...story, fills: fillRest(story.story, story.fills.map((id) => (id === null ? null : facts(id) ?? null)), storyMedia.map((item) => facts(item.id)!).filter(Boolean)).map((source) => source?.media_id ?? null), choosing: null })}>Fill the rest with my media</button>
              <button className="ed-primary wide" disabled={!filled || Boolean(themeBusy) || momentProgress !== null} onClick={() => { void makeStory(); }}>{themeBusy || momentProgress !== null ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>}{momentProgress !== null ? `Picking the best moments… ${momentProgress}%` : 'Make my video'}</button>
              <p className="ed-tip">Each moment takes the sharpest, steadiest, best-lit part of its clip. {mainLayer(timeline).items.length ? 'This replaces the clips on your main track; undo with ⌘Z.' : ''}</p>
            </section>;
          }
          return <section className="ed-add" aria-label="Story templates">
            <p className="ed-tip">Fill each moment with a clip or photo; Kanaa makes the video, theme and music included.</p>
            <div className="ed-stories">{STORIES.map((item) => <button key={item.id} className="ed-story" onClick={() => setStory({ story: item, fills: item.slots.map(() => null), choosing: null })} title={`${item.slots.map((each) => each.label).join(' → ')}`}>
              <b>{item.label}</b><em lang="ta">{item.tamil}</em><small>{item.slots.length} moments · about {storySeconds(item)}s · {THEMES.find((look) => look.id === item.theme)?.label}</small></button>)}</div>
          </section>;
        })()}</div>}</>);
}
