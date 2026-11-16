import { Check,Clapperboard,Layers,Minus,Plus,Search,WandSparkles,X } from "lucide-react";
import { useRef, useState } from "react";
import { MediaPeek, PEEK_DELAY, type Peek } from "../../MediaPeek";
import { insertClip } from "../../../timeline/model";
import { MEDIA_SORTS, sortMedia, type MediaSort } from "../../../timeline/mediaOrder";
import { openTextToVideo } from "../../TextToVideoDialog";
import { getPhoto,photoThumbUrl } from "../../../api/client";
import type { Photo } from "../../../types/photo";
import ImportArea from "../../../components/ImportArea";
import KanaaSelect from "../../../components/KanaaSelect";
import { t } from "../../../i18n";
import { dropClip } from "../../../timeline/drop";
import { newClip,timecode } from "../../../timeline/model";
import { useEditorPanel } from "../../state/EditorContext";
import TravelMapPanel from "../../TravelMapPanel";
import type { EditorLeftRailBindings } from '../EditorLeftRail';

export function MediaTabSection1() {
  const { leftTab, timeline, setCreatingAIImage, setMedia, folders, projectName, media, folder, setFolder, inVideo, otherMedia, draggableAs, addMedia, openMediaMenu, usedIds, addOverlayMedia, change, newId, setSelectedId } = useEditorPanel<EditorLeftRailBindings>('left');
  const [sort, setSort] = useState<MediaSort>(() => { try { return (localStorage.getItem('kanaa.mediaSort') as MediaSort) || 'newest'; } catch { return 'newest'; } });
  const [unusedOnly, setUnusedOnly] = useState(false);
  // Tile size, remembered; the hover card; and whether tiles name their folder (only when every folder is shown).
  const [size, setSize] = useState<'s' | 'm' | 'l'>(() => { try { return (localStorage.getItem('kanaa.mediaTile') as 's' | 'm' | 'l') || 'm'; } catch { return 'm'; } });
  const [peek, setPeek] = useState<Peek | null>(null);
  const waiting = useRef<number | undefined>(undefined);
  const hover = (item: Photo, tile: HTMLElement) => {
    window.clearTimeout(waiting.current);
    waiting.current = window.setTimeout(() => {
      const box = tile.getBoundingClientRect(); const panel = tile.closest('.ed-media, .ed-left, aside')?.getBoundingClientRect() ?? box;
      setPeek({ item, top: box.top, left: panel.right + 10, used: usedIds.has(item.id) });
    }, PEEK_DELAY);
  };
  const unhover = () => { window.clearTimeout(waiting.current); setPeek(null); };
  const resize = (next: 's' | 'm' | 'l') => { setSize(next); try { localStorage.setItem('kanaa.mediaTile', next); } catch { /* This session only. */ } };
  // Shift- or ⌘-click picks several, in the order clicked; Add puts them on the timeline in that order.
  const [picked, setPicked] = useState<Photo[]>([]);
  const pick = (item: Photo) => setPicked((current) => (current.some((each) => each.id === item.id) ? current.filter((each) => each.id !== item.id) : [...current, item]));
  const addPicked = () => {
    if (!timeline || !picked.length) return;
    let next = timeline; let last = '';
    for (const item of picked) {
      const clip = newClip({ media_id: item.id, media_type: item.media_type === 'video' ? 'video' : 'image', duration: item.duration, width: item.width, height: item.height }, newId());
      next = insertClip(next, clip); last = clip.id;
    }
    change(next); setSelectedId(last); setPicked([]);
  };
  // Search by name, inside the folder chosen: every word typed must be in the file's name.
  const [query, setQuery] = useState('');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (item: { filename: string }) => words.every((word) => item.filename.toLowerCase().includes(word));
  const shown = (items: Photo[]) => sortMedia(items.filter((item) => matches(item) && (!unusedOnly || !usedIds.has(item.id))), sort);
  const found = { inVideo: unusedOnly ? [] : shown(inVideo), otherMedia: shown(otherMedia) };
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
          <div className="ed-media-tools">
            <button className={`ed-chip-toggle ${unusedOnly ? 'on' : ''}`} aria-pressed={unusedOnly} title={t('Show only media not yet in this video')} onClick={() => setUnusedOnly(!unusedOnly)}>{t('Not used yet')}</button>
            <KanaaSelect aria-label={t('Sort')} value={sort} onChange={(event) => { const next = event.target.value as MediaSort; setSort(next); try { localStorage.setItem('kanaa.mediaSort', next); } catch { /* This session only. */ } }}>
              {MEDIA_SORTS.map((each) => <option key={each.id} value={each.id}>{t(each.label)}</option>)}
            </KanaaSelect>
            <div className="ed-size-pick" role="group" aria-label={t('Tile size')}>{(['s', 'm', 'l'] as const).map((each) => <button key={each} className={size === each ? 'on' : ''} aria-pressed={size === each} title={t(each === 's' ? 'Small tiles' : each === 'm' ? 'Medium tiles' : 'Large tiles')} onClick={() => resize(each)}><i className={`ed-size-dot ${each}`}/></button>)}</div>
          </div>
          <MediaPeek peek={peek}/>
          {picked.length > 0 && <div className="ed-media-picked" role="status">
            <span>{t('{count} picked', { count: picked.length })}</span>
            <button className="ed-button primary" disabled={!timeline} onClick={addPicked}>{t('Add to timeline in this order')}</button>
            <button className="ed-icon small" aria-label={t('Clear the picks')} onClick={() => setPicked([])}><X size={12}/></button>
          </div>}
          {(words.length > 0 || unusedOnly) && !found.inVideo.length && !found.otherMedia.length && <p className="ed-tip">{words.length ? t('No media named like that{inFolder}.', { inFolder: folder ? ` ${t('in this folder')}` : '' }) : t('Everything here is already in your video.')}</p>}
          {([['In this video', found.inVideo], ['Other media', found.otherMedia]] as const).map(([heading, items]) => items.length > 0 && <div key={heading}><h3 className="ed-sub">{heading}</h3><div className={`ed-media-grid size-${size}`} onScroll={unhover}>{items.map((item) => <div className="ed-tile" key={item.id} onMouseEnter={(event) => hover(item, event.currentTarget)} onMouseLeave={unhover} onDragStart={unhover}>
            <button className={`ed-tile-add ${picked.some((each) => each.id === item.id) ? 'picked' : ''}`} {...draggableAs({ kind: 'media', id: item.id })}
              onClick={(event) => { if (event.shiftKey || event.metaKey) pick(item); else if (picked.length) pick(item); else addMedia(item); }} onContextMenu={(event) => openMediaMenu(event, item)}
              title={`Add ${item.filename}, or drag it onto the timeline. Shift-click to pick several. Right-click for more.`}><img src={photoThumbUrl(item.id)} alt=""  loading="lazy"/><span className="ed-tile-label">{!folder && item.folder && <i className="ed-tile-folder">{item.folder}</i>}<b>{item.filename}</b>{item.duration ? <em>{timecode(item.duration).replace(/\.\d+$/, '')}</em> : null}</span></button>
            {usedIds.has(item.id) && <span className="ed-tile-used" title="In your video"><Check size={11}/></span>}
            {picked.some((each) => each.id === item.id) && <span className="ed-tile-order" aria-label={t('Picked {number}', { number: picked.findIndex((each) => each.id === item.id) + 1 })}>{picked.findIndex((each) => each.id === item.id) + 1}</span>}
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
