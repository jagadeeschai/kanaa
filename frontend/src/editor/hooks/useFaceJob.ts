import type { DependencyList } from 'react';
import { useEffect } from "react";
import { getJobStatus } from "../../api/client";
import { addBlur,findClip,type BlurBox,type Clip,type Timeline } from "../../timeline/model";
import { blurForFace,type TrackPoint } from "../../timeline/tracking";
import { newId } from "../editor-constants";
import { type PlaybackSource } from "../playback";

type Input = {
  faceJob: { jobId: string; clipId: string; progress: number; } | null;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setFaceJob: React.Dispatch<React.SetStateAction<{ jobId: string; clipId: string; progress: number; } | null>>;
  timelineRef: React.MutableRefObject<Timeline | null>;
  sourceFor: (id: number, clip?: Clip) => PlaybackSource | undefined;
  setFaceNote: React.Dispatch<React.SetStateAction<string>>;
  change: (next: Timeline, group?: string | null) => void;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
};

export function useFaceJob(getInput: () => Input, dependencies?: DependencyList) {
  useEffect(() => {
    const { faceJob, setError, setFaceJob, timelineRef, sourceFor, setFaceNote, change, setSelectedId } = getInput();
    const invoke = () => {
    if (!faceJob) return;
    const timer = setTimeout(async () => {
      try {
        const status = await getJobStatus(faceJob.jobId) as unknown as { status?: string; progress: number; error?: string | null; faces?: TrackPoint[][]; more?: number };
        if (status.status === 'failed' || status.status === 'cancelled') { if (status.status === 'failed') setError(status.error ?? 'Could not look for faces.'); setFaceJob(null); return; }
        if (status.status !== 'done' || !status.faces) { setFaceJob({ ...faceJob, progress: status.progress }); return; }
        setFaceJob(null);
        const current = timelineRef.current;
        const clip = current && findClip(current, faceJob.clipId);
        const source = clip && sourceFor(clip.media_id);
        if (!current || !clip || !source) return;
        const boxes = status.faces.map((path) => blurForFace(path, clip, source, current.format, newId())).filter((box): box is BlurBox => Boolean(box));
        if (!boxes.length) { setFaceNote('No faces found in this clip. You can still add a blur box and draw around a face to follow it.'); return; }
        change(boxes.reduce((next, box) => addBlur(next, box, newId()), current));
        setSelectedId(boxes[0].id);
        const more = status.more ? ` ${status.more} smaller ${status.more === 1 ? 'face was' : 'faces were'} left out; add blur boxes for them by hand.` : '';
        setFaceNote(`Blurred ${boxes.length} ${boxes.length === 1 ? 'face' : 'faces'}. Play it back to check: each has its own blur box, so delete any face you want to show.${more}`);
      } catch (problem) { setError((problem as Error).message); setFaceJob(null); }
    }, 700);
    return () => clearTimeout(timer);
  };
    return invoke();
  }, dependencies);
}
