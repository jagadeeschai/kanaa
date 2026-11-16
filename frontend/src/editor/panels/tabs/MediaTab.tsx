import { Check,Clapperboard,Layers,Minus,Plus,Search,WandSparkles,X } from "lucide-react";
import { useState } from "react";
import { openTextToVideo } from "../../TextToVideoDialog";
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
  // Search by name, inside the folder chosen: every word typed must be in the file's name.
  const [query, setQuery] = useState('');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (item: { filename: string }) => words.every((word) => item.filename.toLowerCase().includes(word));
  const found = { inVideo: inVideo.filter(matches), otherMedia: otherMedia.filter(matches) };
  return (<>{leftTab === 'media' && <>
          <div className="ed-media-row">
            <ImportArea slim onImported={(items) => { setMedia((current) => [...items, ...current]); }}/>
            <button className="ed-button" disabled={!timeline} title={t('Create image with AI')} onClick={() => setCreatingAIImage(true)}><WandSparkles size={15}/>{t('AI image')}</button>
            <button className="ed-button" disabled={!timeline} title={t('Create video with AI')} onClick={() => openTextToVideo({ addToTimeline: addMedia, folder: projectName.replace(/\s*[–—-]\s*(3D\s+)?lyric\s+video\s*$/i, '').trim() || null })}><Clapperboard size={15}/>{t('AI video')}</button>
          </div>
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
          <label className="ed-media-search"><Search size={13} aria-hidden="true"/><input value={query} placeholder={t('Search media')} aria-label={t('Search media')}
            onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setQuery(''); }}/>
            {query && <button className="ed-icon small" aria-label={t('Clear search')} onClick={() => setQuery('')}><X size={12}/></button>}</label>
          {words.length > 0 && !found.inVideo.length && !found.otherMedia.length && <p className="ed-tip">{t('No media named like that{inFolder}.', { inFolder: folder ? ` ${t('in this folder')}` : '' })}</p>}
          {([['In this video', found.inVideo], ['Other media', found.otherMedia]] as const).map(([heading, items]) => items.length > 0 && <div key={heading}><h3 className="ed-sub">{heading}</h3><div className="ed-media-grid">{items.map((item) => <div className="ed-tile" key={item.id}>
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
