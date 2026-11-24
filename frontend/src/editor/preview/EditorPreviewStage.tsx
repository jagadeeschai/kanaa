import { AiEditHost } from '../AiEditDialog';
import { YouTubeHost } from '../../publish/YouTubeDialog';
import { VideoPopoutHost } from '../VideoPopoutDialog';
import { CloneHost } from '../CloneDialog';
import { LensHost } from '../LensDialog';
import { AtmosphereHost } from '../AtmosphereDialog';
import { MatchCutHost } from '../MatchCutDialog';
import { MulticamHost } from '../MulticamDialog';
import { Freeze3dHost } from '../Freeze3dDialog';
import { SkyHost } from '../SkyDialog';
import { NightHost } from '../NightDialog';
import { LooksHost } from '../looks';
import { SlowmoHost } from '../SlowmoDialog';
import { SmartSliceHost } from '../SmartSliceDialog';
import { ClipQuickBar } from './ClipQuickBar';
import { BringToLifeHost } from '../BringToLifeDialog';
import { TextToVideoHost } from '../TextToVideoDialog';
import { RemovePersonHost } from '../RemovePersonDialog';
import { useCallback } from 'react';
import { useSkimListener } from '../skim';
import { useEditorPanel } from '../state/EditorContext';
import { Check,CircleHelp,Crosshair,Expand,Pause,Play,Shrink,X } from "lucide-react";
import { cancelRenderJob } from "../../api/client";
import { t } from "../../i18n";
import type { Transform } from '../../timeline/evaluate';
import { isFollowed } from "../../timeline/keyframes";
import type { AdjustLayer,BlurLayer,TextLayer } from '../../timeline/model';
import { clipLength,REST_TRANSFORM,timecode,type AudioLayer,type BlurBox,type CaptionLayer,type CinemaReveal,type Clip,type TextItem,type Timeline,type VideoLayer } from "../../timeline/model";
import { ON_ITEM } from "../editor-constants";
import { ARTICLES } from "../guide-articles";
import { MotionPath } from "../Keyframes";
import { PathDrawer } from "../PathDraw";
import { PlaybackEngine,type PlaybackSource } from "../playback";
import { type SaveState } from "../project-save";
import { ResizeBox } from "../ResizeBox";
import { ShapeDrawing } from "../ShapeDrawing";
import { GraphicHandles } from './GraphicHandles';
import { TitleEditBox,TitleToolbar } from "./TitleEditing";
type Box = [number, number, number, number];
type FollowJob = { itemId: string; underId: string; jobId: string; progress: number; queued?: boolean; drawnAt: number; from: number; size: boolean; place: Box | null; own: boolean; grew: boolean;
  /** Set while looking for a face under a blur box: where the box is in the source, and what to follow instead when no face is there. */
  faces?: { box: Box; at: number; own: Box; grow?: number } };

export type EditorPreviewStageBindings = {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  choosingFormat: boolean;
  clockRef: React.RefObject<HTMLSpanElement>;
  dragPreview: React.MutableRefObject<{ x: number; y: number; clipX: number; clipY: number; group: string; } | null>;
  drawing: { mode: "start" | "continue"; from?: [number, number]; to?: [number, number]; onBox?: (box: Box) => void; } | null;
  drawnBox: (state: { mode: "start" | "continue"; from?: [number, number]; to?: [number, number]; onBox?: (box: Box) => void; } | null) => Box | null;
  drawStart: React.MutableRefObject<[number, number] | null>;
  editingTitle: string | null;
  engineRef: React.MutableRefObject<PlaybackEngine | null>;
  exportedOnce: boolean;
  faceJob: { jobId: string; clipId: string; progress: number; } | null;
  faceNote: string;
  finishDrawing: (event: React.PointerEvent<HTMLElement>) => void;
  finishShape: () => void;
  firstRunClosed: boolean;
  followHere: (mode: "start" | "continue") => Promise<void>;
  followJob: FollowJob | null;
  followNote: { itemId: string; text: string; } | null;
  followTarget: { id: string; start: number; length: number; transform: Transform; } | null;
  frameAt: (event: React.PointerEvent<HTMLElement>) => [number, number];
  fullScreen: boolean;
  isEmpty: boolean | null;
  local: number;
  now: number;
  openGuide: (article: string) => void;
  openPreviewMenu: (event: React.MouseEvent<Element, MouseEvent>) => void;
  ownBox: () => Box | null;
  pickedInPreview: string | null;
  pickingKey: boolean;
  placing: { textId: string; busy: boolean; } | null;
  playing: boolean;
  previewDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  previewMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  projectName: string;
  ratio: number;
  reframeJob: { jobId: string; clipId: string; progress: number; } | null;
  renderJob: { id: string; key: string; progress: number; } | null;
  safeArea: boolean;
  saved: SaveState;
  sceneJob: { jobId: string; clipId: string; progress: number; } | null;
  seek: (t: number) => void | undefined;
  selected: Clip | null;
  selectedBlur: BlurBox | null;
  selectedLayer: VideoLayer | AudioLayer | TextLayer | CaptionLayer | BlurLayer | AdjustLayer | undefined;
  selectedText: TextItem | null;
  setDrawing: React.Dispatch<React.SetStateAction<{ mode: "start" | "continue"; from?: [number, number]; to?: [number, number]; onBox?: (box: Box) => void; } | null>>;
  setEditingTitle: React.Dispatch<React.SetStateAction<string | null>>;
  setExporting: React.Dispatch<React.SetStateAction<boolean>>;
  setFaceJob: React.Dispatch<React.SetStateAction<{ jobId: string; clipId: string; progress: number; } | null>>;
  setFaceNote: React.Dispatch<React.SetStateAction<string>>;
  setFirstRunClosed: React.Dispatch<React.SetStateAction<boolean>>;
  setFollowJob: React.Dispatch<React.SetStateAction<FollowJob | null>>;
  setFollowNote: React.Dispatch<React.SetStateAction<{ itemId: string; text: string; } | null>>;
  setHeavy: React.Dispatch<React.SetStateAction<boolean>>;
  setLeftTab: React.Dispatch<React.SetStateAction<"audio" | "text" | "media" | "words" | "transitions" | "effects" | "templates" | "themes" | "ask">>;
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPickedInPreview: React.Dispatch<React.SetStateAction<string | null>>;
  setReframeJob: React.Dispatch<React.SetStateAction<{ jobId: string; clipId: string; progress: number; } | null>>;
  setRenderJob: React.Dispatch<React.SetStateAction<{ id: string; key: string; progress: number; } | null>>;
  setSceneJob: React.Dispatch<React.SetStateAction<{ jobId: string; clipId: string; progress: number; } | null>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setShaping: React.Dispatch<React.SetStateAction<{ textId: string; mode: "ground" | "outline"; points: [number, number][]; reveal?: CinemaReveal; } | null>>;
  shaping: { textId: string; mode: "ground" | "outline"; points: [number, number][]; reveal?: CinemaReveal; } | null;
  sourceFor: (id: number, clip?: Clip) => PlaybackSource | undefined;
  stageRef: React.RefObject<HTMLElement>;
  timeline: Timeline | null;
  titleAt: (fx: number, fy: number) => TextItem | null;
  titleRect: (text: TextItem) => { left: number; top: number; right: number; bottom: number; } | null;
  toggleFullScreen: () => void;
  togglePlay: () => void;
  total: number;
  updateSelected: (changes: Partial<Clip>, group?: string | undefined) => void;
  updateSelectedBlur: (changes: Partial<BlurBox>, group?: string) => void;
  updateSelectedText: (changes: Partial<TextItem>, group?: string | undefined) => void;
};

export function EditorPreviewStage() {
  const { fullScreen, stageRef, saved, projectName, timeline, firstRunClosed, total, setLeftTab, setPanelOpen, exportedOnce, engineRef, setExporting, setFirstRunClosed, openGuide, ratio, canvasRef, openPreviewMenu, previewDown, previewMove, dragPreview, titleAt, setPickedInPreview, setSelectedId, setEditingTitle, placing, pickingKey, selected, selectedLayer, shaping, drawing, now, sourceFor, local, updateSelected, seek, selectedText, updateSelectedText, pickedInPreview, titleRect, editingTitle, selectedBlur, updateSelectedBlur, followTarget, followJob, ownBox, followHere, renderJob, reframeJob, sceneJob, faceJob, faceNote, followNote, setRenderJob, setHeavy, setReframeJob, setSceneJob, setFaceJob, setFollowJob, setFaceNote, setFollowNote, setShaping, finishShape, frameAt, drawStart, setDrawing, finishDrawing, drawnBox, safeArea, isEmpty, choosingFormat, clockRef, togglePlay, playing, toggleFullScreen } = useEditorPanel<EditorPreviewStageBindings>('preview');
  const skim = useCallback((t: number | null) => engineRef.current?.skim(t), [engineRef]);
  useSkimListener(skim);
  return (<main className={`ed-stage ${fullScreen ? 'full' : ''}`} ref={stageRef}>
    <AiEditHost/>
    <BringToLifeHost/>
    <TextToVideoHost/>
    <RemovePersonHost/>
    <SmartSliceHost/><YouTubeHost/><VideoPopoutHost/><CloneHost/><LensHost/><SlowmoHost/><AtmosphereHost/><MatchCutHost/><MulticamHost/><Freeze3dHost/><SkyHost/><NightHost/><LooksHost/>
      {!fullScreen && <div className={`ed-stage-title ${saved}`} role="status" title={projectName}><b>{projectName}</b><span>{t(saved === 'saving' ? 'Saving…' : saved === 'failed' ? 'Could not save' : 'Saved')}</span></div>}
    {timeline && !firstRunClosed && !exportedOnce && !fullScreen && (() => {
      const steps = [
        { done: total > 0, label: 'Add your clips or photos', go: () => { setLeftTab('media'); setPanelOpen(true); }, guide: 'getting-started' },
        { done: timeline.layers.some((layer) => layer.kind === 'text' && layer.items.length > 0), label: 'Add a title', go: () => { setLeftTab('text'); setPanelOpen(true); }, guide: 'titles' },
        { done: exportedOnce, label: 'Export your video', go: () => { if (total) { engineRef.current?.pause(); setExporting(true); } }, guide: 'getting-started' },
      ];
      if (steps.every((step) => step.done)) return null;
      const close = () => { setFirstRunClosed(true); try { localStorage.setItem('kanaa-first-run-closed', '1'); } catch { /* ignore */ } };
      return <aside className="ed-first-run" aria-label={t('First steps')}>
        <div className="ed-first-run-head"><b>{t('First steps')}</b><button className="ed-icon small" aria-label={t('Close')} onClick={close}><X size={12}/></button></div>
        <ol>{steps.map((step) => <li key={step.label} className={step.done ? 'done' : ''}><span className="ed-first-run-tick">{step.done ? <Check size={11}/> : null}</span>
          <button className="ed-link" disabled={step.done} onClick={step.go}>{t(step.label)}</button>
          <button className="ed-icon small" aria-label={t('How')} title={t('How')} onClick={() => openGuide(ARTICLES.some((article) => article.id === step.guide) ? step.guide : 'getting-started')}><CircleHelp size={11}/></button></li>)}</ol>
        <p>{t('Press ⌘K any time to find an action.')}</p>
      </aside>;
    })()}
        <div className="ed-frame" style={{ aspectRatio: `${ratio}`, '--ar': ratio } as React.CSSProperties}>
          <canvas ref={canvasRef} aria-label="Preview" onContextMenu={openPreviewMenu} onPointerDown={previewDown} onPointerMove={previewMove} onPointerUp={() => { dragPreview.current = null; }} onDoubleClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const hit = titleAt((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height); if (hit) { engineRef.current?.pause(); setPickedInPreview(hit.id); setSelectedId(hit.id); if (!hit.graphic) setEditingTitle(hit.id); } }} className={(placing && !placing.busy) || pickingKey ? 'picking' : selected && selected.enabled !== false && !selected.frame_locked ? 'movable' : ''}/>
          {selected && selected.enabled !== false && !selectedLayer?.locked && !selected.frame_locked && !pickingKey && !shaping && !drawing && timeline && now >= selected.start && now < selected.start + clipLength(selected) && (() => { const source = sourceFor(selected.media_id); return source && <ResizeBox clip={selected} source={source} format={timeline.format} local={local} onChange={(transform, group, stretch) => updateSelected({ transform, ...(stretch !== undefined ? { stretch } : {}) }, group)}/>; })()}
          {selected && selected.enabled !== false && !selectedLayer?.locked && !selected.frame_locked && <MotionPath transform={selected.transform} length={clipLength(selected)} onChange={(transform, group) => updateSelected({ transform }, group)} onSeek={(t) => seek(selected.start + t)}/>}
          {/* Drawing a path frees a frame-locked picture to move, as Animate does. */}
          {selected && selected.enabled !== false && !selectedLayer?.locked && <PathDrawer transform={selected.transform} length={clipLength(selected)} local={now - selected.start} onChange={(transform, group) => updateSelected({ transform, frame_locked: false }, group)}/>}
          {selectedText && !selectedText.graphic && !selectedLayer?.locked && !isFollowed(selectedText.transform ?? REST_TRANSFORM) && <MotionPath transform={selectedText.transform ?? REST_TRANSFORM} length={selectedText.length} onChange={(transform, group) => updateSelectedText({ transform }, group)} onSeek={(t) => seek(selectedText.start + t)}/>}
          {selectedText && !selectedText.graphic && !selectedLayer?.locked && <PathDrawer transform={selectedText.transform ?? REST_TRANSFORM} length={selectedText.length} local={now - selectedText.start} onChange={(transform, group) => updateSelectedText({ transform }, group)}/>}
          {selectedText?.graphic && !selectedLayer?.locked && now >= selectedText.start && now < selectedText.start + selectedText.length && <GraphicHandles graphic={selectedText.graphic} onChange={(graphic, group) => updateSelectedText({ graphic }, group)}/>}
          {selectedText && !selectedText.graphic && pickedInPreview === selectedText.id && !selectedLayer?.locked && now >= selectedText.start && now < selectedText.start + selectedText.length && (() => {
            const rect = titleRect(selectedText);
            if (!rect) return null;
            const box = { left: `${rect.left * 100}%`, top: `${rect.top * 100}%`, width: `${(rect.right - rect.left) * 100}%`, height: `${(rect.bottom - rect.top) * 100}%` };
            return <>
              {editingTitle === selectedText.id
                ? <TitleEditBox key={selectedText.id} text={selectedText} style={box} onDone={(words) => { setEditingTitle(null); if (words !== null && words.trim() && words !== selectedText.text) updateSelectedText({ text: words }, `text-${selectedText.id}`); }}/>
                : <div className="ed-title-box" style={box} onDoubleClick={() => { engineRef.current?.pause(); setEditingTitle(selectedText.id); }} title={t('Double-click to type')}/>}
              <TitleToolbar text={selectedText} top={rect.top} left={(rect.left + rect.right) / 2} onChange={(changes, group) => updateSelectedText(changes, group)} onEdit={() => { engineRef.current?.pause(); setEditingTitle(selectedText.id); }}/>
            </>;
          })()}
          {selectedBlur && !selectedLayer?.locked && <MotionPath transform={selectedBlur.transform} length={selectedBlur.length} onChange={(transform, group) => updateSelectedBlur({ transform }, group)} onSeek={(t) => seek(selectedBlur.start + t)}/>}
          {followTarget && !selectedLayer?.locked && !selected?.frame_locked && !followJob && !drawing && !shaping && !pickingKey && now >= followTarget.start - ON_ITEM && now < followTarget.start + followTarget.length && !isFollowed(followTarget.transform) && (() => {
            const box = ownBox();
            if (!box) return null;
            return <button className="ed-follow-chip" style={{ left: `clamp(48px, ${box[0] * 100}%, calc(100% - 48px))`, top: `clamp(20px, ${(box[1] + box[3] / 2) * 100}%, calc(100% - 20px))` }} onPointerDown={(event) => event.stopPropagation()} onClick={() => { void followHere('start'); }} title="Kanaa finds what is under it and keeps it covered as it moves"><Crosshair size={13}/>Follow</button>;
          })()}
          {(renderJob || reframeJob || sceneJob || faceJob || followJob || faceNote || (followNote && followTarget?.id === followNote.itemId)) && <div className="ed-status" role="status">
            {renderJob ? <><span>Rendering preview… {renderJob.progress}%</span><i className="ed-status-bar"><b style={{ width: `${renderJob.progress}%` }}/></i><button onClick={() => { void cancelRenderJob(renderJob.id); setRenderJob(null); setHeavy(false); }}>Cancel</button></>
            : reframeJob ? <><span>Finding who to follow… {reframeJob.progress}%</span><i className="ed-status-bar"><b style={{ width: `${reframeJob.progress}%` }}/></i><button onClick={() => { void cancelRenderJob(reframeJob.jobId); setReframeJob(null); }}>Cancel</button></>
            : sceneJob ? <><span>Finding scene changes… {sceneJob.progress}%</span><i className="ed-status-bar"><b style={{ width: `${sceneJob.progress}%` }}/></i><button onClick={() => { void cancelRenderJob(sceneJob.jobId); setSceneJob(null); }}>Cancel</button></>
            : faceJob ? <><span>Finding faces… {faceJob.progress}%</span><i className="ed-status-bar"><b style={{ width: `${faceJob.progress}%` }}/></i><button onClick={() => { void cancelRenderJob(faceJob.jobId); setFaceJob(null); }}>Cancel</button></>
              : followJob ? <><span>{followJob.queued ? 'Waiting for the job ahead of it to finish…' : `Following… ${followJob.progress}%`}</span><i className="ed-status-bar"><b style={{ width: `${followJob.progress}%` }}/></i><button onClick={() => { void cancelRenderJob(followJob.jobId); setFollowJob(null); }}>Cancel</button></>
              : <><span>{faceNote || followNote?.text}</span><button aria-label="Close" onClick={() => { setFaceNote(''); setFollowNote(null); }}>×</button></>}
          </div>}
          {pickingKey && <div className="ed-pick-note" role="status">Click the colour to remove</div>}
          {shaping && <ShapeDrawing mode={shaping.mode} points={shaping.points} onPoints={(points) => setShaping({ ...shaping, points })} onDone={finishShape} onCancel={() => setShaping(null)}/>}
          {drawing && <div className="ed-draw" aria-label={drawing.onBox ? "Drag a box around the light" : "Drag a box around what to follow"} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const at = frameAt(event); drawStart.current = at; setDrawing({ ...drawing, from: at, to: at }); }}
            onPointerMove={(event) => { const from = drawStart.current; const to = frameAt(event); if (from) setDrawing((state) => state && { ...state, from, to }); }} onPointerUp={finishDrawing}>
            <div className="ed-pick-note" role="status">Drag a box around what to follow. Esc cancels.</div>
            {(() => { const box = drawnBox(drawing); return box && <i style={{ left: `${(box[0] - box[2] / 2) * 100}%`, top: `${(box[1] - box[3] / 2) * 100}%`, width: `${box[2] * 100}%`, height: `${box[3] * 100}%` }}/>; })()}
          </div>}
          {safeArea && <div className="ed-safe" aria-hidden="true"><span>Keep titles and faces inside this box</span></div>}
          {isEmpty && !choosingFormat && <div className="ed-empty"><strong>Add a clip to start</strong><span>Pick videos or photos in the Media panel</span></div>}
        </div>
        <div className="ed-transport">
          <span className="ed-clock"><span ref={clockRef}>0:00.00</span> / {timecode(total)}</span>
          <button className="ed-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button>
          <span className="ed-transport-end">
            {!fullScreen && <ClipQuickBar sourceFor={sourceFor} playRange={(start, end) => engineRef.current?.playRange(start, end)}/>}
            {/* An icon with its tip, like the clip actions beside it; in full screen it says Exit, so leaving is obvious. */}
            <button className={`ed-icon ed-safe-toggle ed-fullscreen ${fullScreen ? 'exit' : ''}`} aria-pressed={fullScreen} onClick={toggleFullScreen} aria-label={t(fullScreen ? 'Leave full screen' : 'Full screen preview')}
              data-tip={fullScreen ? `${t('Leave full screen')} · F / Esc` : `${t('Full screen preview')} · F`}>{fullScreen ? <Shrink size={15}/> : <Expand size={15}/>}{fullScreen && t('Exit')}</button>
          </span>
        </div>
      </main>);
}
