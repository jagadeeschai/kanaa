import { Check,Layers,Minus,Plus,WandSparkles } from "lucide-react";
import { getPhoto,photoThumbUrl } from "../../../api/client";
import ImportArea from "../../../components/ImportArea";
import KanaaSelect from "../../../components/KanaaSelect";
import { t } from "../../../i18n";
import { dropClip } from "../../../timeline/drop";
import { newClip,timecode } from "../../../timeline/model";
import { useEditorPanel } from "../../state/EditorContext";
import TravelMapPanel from "../../TravelMapPanel";
import type { EditorLeftRailBindings } from '../EditorLeftRail';

export function MediaTabSection1() {
  const { leftTab, timeline, setCreatingAIImage, setMedia, folders, projectName, media, folder, setFolder, inVideo, otherMedia, draggableAs, addMedia, openMediaMenu, usedIds, addOverlayMedia } = useEditorPanel<EditorLeftRailBindings>('left');
  return (<>{leftTab === 'media' && <>
          <div className="ed-media-create"><span>Create media</span><button className="ed-button wide" disabled={!timeline} onClick={() => setCreatingAIImage(true)}><WandSparkles size={15}/>Create image with AI</button></div>
          <ImportArea compact onImported={(items) => { setMedia((current) => [...items, ...current]); }}/>
          {folders.length > 0 && (() => {
            // One picker, however many folders there are: this video's own folder first, then the rest A to Z, each with its count.
            const own = projectName.replace(/\s*[–—-]\s*(3D\s+)?lyric\s+video\s*$/i, '').trim();
            const count = (name: string) => media.filter((item) => item.folder === name).length;
            const ordered = [...folders].sort((x, y) => (x === own ? -1 : y === own ? 1 : x.localeCompare(y)));
            return <label className="ed-folder-pick" data-keep-panel><span>{t('Folder')}</span><KanaaSelect aria-label={t('Folder')} searchable searchPlaceholder={t('Search folders')} value={folder ?? ''} onChange={(event) => setFolder(event.target.value || null)}>
              <option value="">{t('All media')} ({media.length})</option>
              {ordered.map((name) => <option key={name} value={name}>{name === own ? `★ ${name}` : name} ({count(name)})</option>)}
            </KanaaSelect></label>;
          })()}
          {([['In this video', inVideo], ['Other media', otherMedia]] as const).map(([heading, items]) => items.length > 0 && <div key={heading}><h3 className="ed-sub">{heading}</h3><div className="ed-media-grid">{items.map((item) => <div className="ed-tile" key={item.id}>
            <button className="ed-tile-add" {...draggableAs({ kind: 'media', id: item.id })} onClick={() => addMedia(item)} onContextMenu={(event) => openMediaMenu(event, item)} title={`Add ${item.filename}, or drag it onto the timeline. Right-click for more.`}><img src={photoThumbUrl(item.id)} alt=""  loading="lazy"/><span className="ed-tile-label"><b>{item.filename}</b>{item.duration ? <em>{timecode(item.duration).replace(/\.\d+$/, '')}</em> : null}</span></button>
            {usedIds.has(item.id) && <span className="ed-tile-used" title="In your video"><Check size={11}/></span>}
            <button className="ed-tile-over" onClick={() => addOverlayMedia(item)} title="Add on top of your video, like a logo" aria-label={`Add ${item.filename} as an overlay`}><Layers size={12}/></button></div>)}</div></div>)}
        </>}</>);
}

export function MediaTabSection2() {
  const { leftTab, timeline, effectNeedle, effectSection, setEffectSection, setMedia, timelineRef, newId, change, engineRef, setSelectedId } = useEditorPanel<EditorLeftRailBindings>('left');
  return (<>{leftTab === 'media' && timeline && <section className="ed-add ed-effect-tool" data-keep-panel><button className="ed-effect-category-head" aria-expanded={Boolean(effectNeedle) || effectSection === 'travel-map'} onClick={() => { if (!effectNeedle) setEffectSection(effectSection === 'travel-map' ? null : 'travel-map'); }}><span><b>Travel map</b><small>Animated route between places</small></span>{Boolean(effectNeedle) || effectSection === 'travel-map' ? <Minus size={14}/> : <Plus size={14}/>}</button>{(Boolean(effectNeedle) || effectSection === 'travel-map') && <TravelMapPanel compact format={timeline.format} onMade={async (mediaId) => {
          const item = await getPhoto(mediaId);
          setMedia((current) => [item, ...current.filter((each) => each.id !== item.id)]);
          const current = timelineRef.current;
          if (!current) return;
          const clip = newClip({ media_id: item.id, media_type: 'video', duration: item.duration, width: item.width, height: item.height }, newId());
          change(dropClip(current, clip, engineRef.current?.currentTime ?? 0));
          setSelectedId(clip.id);
        }}/>}</section>}</>);
}
