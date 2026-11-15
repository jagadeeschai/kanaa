import { useEditorPanel } from '../state/EditorContext';
import { Camera,X as Close,Magnet,Minus,MoreHorizontal,Paintbrush,Plus,Redo2,Scissors,Snowflake,Trash2,Undo2 } from "lucide-react";
import { t } from "../../i18n";
import type { Clipboard,CopiedStyle } from '../../timeline/clipboard';
import { type History } from "../../timeline/history";
import type { BlurLayer,TextLayer } from '../../timeline/model';
import { mainLayer,type AudioLayer,type BlurBox,type Caption,type CaptionLayer,type Clip,type Sound,type TextItem,type Timeline,type VideoLayer } from "../../timeline/model";
import { type MenuItem } from "../ContextMenu";
import { ZOOM_MAX,ZOOM_MIN,ZOOM_STEP } from "../editor-constants";
type Action = { type: 'load'; timeline: Timeline } | { type: 'change'; timeline: Timeline; group?: string | null } | { type: 'undo' } | { type: 'redo' };

export type EditorTimelineToolbarBindings = {
  clipboard: { styleCopy: CopiedStyle | null; clearStyle: () => void; copy: (cut?: boolean) => void; pasteAt: (at: number, copied?: Clipboard | null) => void; duplicate: () => void; copyStyleOf: (id?: string | null) => void; pasteStyleOnto: (ids?: string[]) => void; menuItems: (id: string, at: number) => MenuItem[]; hasCopy: () => boolean; };
  dispatch: React.Dispatch<Action>;
  fitZoom: () => void;
  freeze: (t?: number) => void;
  history: History<Timeline | null>;
  openViewMenu: (event: React.MouseEvent<Element, MouseEvent>) => void;
  removeSelected: () => void;
  selected: Clip | null;
  selectedBlur: BlurBox | null;
  selectedCaption: { caption: Caption; layer: CaptionLayer; } | null;
  selectedId: string | null;
  selectedLayer: VideoLayer | AudioLayer | TextLayer | CaptionLayer | BlurLayer | undefined;
  selectedSound: { sound: Sound; layer: AudioLayer; } | null;
  selectedText: TextItem | null;
  setSnapping: React.Dispatch<React.SetStateAction<boolean>>;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  snapping: boolean;
  snapshot: (t?: number | undefined) => Promise<void>;
  split: () => void;
  timeline: Timeline | null;
  total: number;
  zoom: number;
};

export function EditorTimelineToolbar() {
  const { dispatch, history, clipboard, selectedId, split, total, freeze, timeline, snapshot, removeSelected, selected, selectedSound, selectedText, selectedBlur, selectedCaption, selectedLayer, fitZoom, snapping, setSnapping, setZoom, zoom, openViewMenu } = useEditorPanel<EditorTimelineToolbarBindings>('toolbar');
  return (<div className="ed-tools">
      <span className="ed-tool-group" role="group" aria-label="Edit tools">
        <button className="ed-button ed-icon-button" onClick={() => dispatch({ type: 'undo' })} disabled={!history.past.length} aria-label={t('Undo')} title={`${t('Undo')} (⌘Z)`}><Undo2 size={15}/></button>
        <button className="ed-button ed-icon-button" onClick={() => dispatch({ type: 'redo' })} disabled={!history.future.length} aria-label={t('Redo')} title={`${t('Redo')} (⇧⌘Z)`}><Redo2 size={15}/></button>
        {clipboard.styleCopy && <span className="ed-brush"><button className="ed-button ed-icon-button on" onClick={() => clipboard.pasteStyleOnto()} disabled={!selectedId} aria-label={t('Paste style')} title={`${t('Paste style')} (⌥⌘V)`}><Paintbrush size={15}/></button><button className="ed-brush-off" onClick={clipboard.clearStyle} aria-label={t('Stop pasting style')} title={t('Stop pasting style')}><Close size={11}/></button></span>}
        <span className="ed-tool-sep" aria-hidden="true"/>
        <button className="ed-button" onClick={split} disabled={!total} title="Split at playhead (S)"><Scissors size={15}/>Split</button>
        <button className="ed-button" onClick={() => freeze()} disabled={!total || Boolean(timeline && mainLayer(timeline).locked)} title="Hold the frame at the playhead for 2 seconds"><Snowflake size={15}/>Freeze</button>
        <button className="ed-button" onClick={() => { void snapshot(); }} disabled={!total || Boolean(timeline && mainLayer(timeline).locked)} title="Flash, shutter sound and a two-second printed-photo freeze"><Camera size={15}/>Snapshot</button>
        <button className="ed-button" onClick={removeSelected} disabled={(!selected && !selectedSound && !selectedText && !selectedBlur && !selectedCaption) || Boolean(selectedLayer?.locked)} title="Delete (⌫)"><Trash2 size={15}/>Delete</button>
      </span>
      <div className="ed-spacer"/>
      <span className="ed-tool-group" role="group" aria-label="Timeline view">
        <button className="ed-button" disabled={!total} onClick={fitZoom} title="Show the whole video on the timeline">Fit</button>
        <button className={`ed-button ${snapping ? 'on' : ''}`} aria-pressed={snapping} onClick={() => setSnapping(!snapping)} title={`${t(snapping ? 'Snapping on: edges lock to clips, the playhead and beats' : 'Snapping off')} (N)`}><Magnet size={14}/></button>
        <button className="ed-icon" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value / ZOOM_STEP))}><Minus size={15}/></button>
        <input className="ed-zoom" type="range" min={Math.log(ZOOM_MIN)} max={Math.log(ZOOM_MAX)} step={0.01} value={Math.log(zoom)} onChange={(event) => setZoom(Math.exp(Number(event.target.value)))} aria-label={t('Timeline zoom')} title={t('Timeline zoom')}/>
        <button className="ed-icon" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value * ZOOM_STEP))}><Plus size={15}/></button>
        <button className="ed-button" aria-label="View" onClick={openViewMenu}><MoreHorizontal size={15}/>{t('View')}</button>
      </span>
    </div>);
}
