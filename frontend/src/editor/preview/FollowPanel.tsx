import { useEditorPanel } from '../state/EditorContext';
import { Crosshair } from "lucide-react";
import { More } from "../layout";

type Box = [number, number, number, number];

type FollowJob = { itemId: string; underId: string; jobId: string; progress: number; queued?: boolean; drawnAt: number; from: number; size: boolean; place: Box | null; own: boolean; grew: boolean;
  /** Set while looking for a face under a blur box: where the box is in the source, and what to follow instead when no face is there. */
  faces?: { box: Box; at: number; own: Box; grow?: number } };

export type FollowPanelBindings = { blur: boolean; own: boolean; drawing: boolean; job: FollowJob | null; busy: boolean; note: string | null; following: boolean; size: boolean;
  onSize: (on: boolean) => void; onStart: () => void; onDraw: () => void; onContinue: () => void; onCancel: () => void; onStop: () => void };

export function FollowPanel() {
  const { blur, own, drawing, job, busy, note, following, size, onSize, onStart, onDraw, onContinue, onCancel, onStop } = useEditorPanel<FollowPanelBindings>('follow');
  if (job) return <><div className="ed-progress"><i style={{ width: `${job.progress}%` }}/></div><p className="ed-tip">{job.queued ? 'Waiting for the job ahead of it to finish…' : `Following… ${job.progress}%`}</p><button className="ed-button wide" onClick={onCancel}>Cancel</button></>;
  const what = blur ? 'the blur' : 'it';
  return <>
    <p className="ed-tip">{drawing ? 'Drag a box around it in the preview. Esc cancels.' : own ? `Put ${what} over what should be followed, a face or a number plate, then click Follow. Kanaa keeps ${what} on it as it moves.` : 'Place the title where it should sit, then click Follow and drag a box around the person or thing it should move with.'}</p>
    <button className={`ed-button wide primary ${drawing ? 'on' : ''}`} disabled={busy} onClick={onStart}><Crosshair size={14}/>{own ? (following ? 'Follow again from here' : 'Follow') : following ? 'Track a different subject' : 'Track person or object'}</button>
    {following && <div className="ed-pair"><button className="ed-button" disabled={busy} onClick={onContinue}>Continue from here</button><button className="ed-button" disabled={busy} onClick={onStop}>Stop following</button></div>}
    {note && <p className="ed-tip ed-follow-note" role="status">{note}</p>}
    <More>
      <label className="ed-check"><input type="checkbox" checked={size} onChange={(event) => onSize(event.target.checked)}/><span>Follow its size too<small>Grows and shrinks as the subject comes closer or moves away.</small></span></label>
      {own && <button className="ed-button wide" disabled={busy} onClick={onDraw}>Draw around something else</button>}
    </More>
  </>;
}
