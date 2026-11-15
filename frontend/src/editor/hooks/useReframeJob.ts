import type { DependencyList } from 'react';
import { useEffect } from "react";
import { getJobStatus } from "../../api/client";
import { findClip,updateClip,type Timeline } from "../../timeline/model";
import { reframeTransform,type SubjectPoint } from "../../timeline/reframe";
import type { Photo } from "../../types/photo";

type Input = {
  reframeJob: { jobId: string; clipId: string; progress: number; } | null;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setReframeJob: React.Dispatch<React.SetStateAction<{ jobId: string; clipId: string; progress: number; } | null>>;
  timelineRef: React.MutableRefObject<Timeline | null>;
  mediaById: Map<number, Photo>;
  setFaceNote: React.Dispatch<React.SetStateAction<string>>;
  change: (next: Timeline, group?: string | null) => void;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
};

export function useReframeJob(getInput: () => Input, dependencies: DependencyList) {
  useEffect(() => {
    const { reframeJob, setError, setReframeJob, timelineRef, mediaById, setFaceNote, change, setSelectedId } = getInput();
    const invoke = () => {
    if (!reframeJob) return;
    const timer = setTimeout(async () => {
      try {
        const status = await getJobStatus(reframeJob.jobId) as unknown as { status?: string; progress: number; error?: string | null; path?: SubjectPoint[] };
        if (status.status === 'failed' || status.status === 'cancelled') { if (status.status === 'failed') setError(status.error ?? 'Could not follow anyone in this clip.'); setReframeJob(null); return; }
        if (status.status !== 'done' || !status.path) { setReframeJob({ ...reframeJob, progress: status.progress }); return; }
        setReframeJob(null);
        const current = timelineRef.current;
        const clip = current && findClip(current, reframeJob.clipId);
        const item = clip && mediaById.get(clip.media_id);
        if (!current || !clip || !item?.width || !item.height) return;
        const transform = reframeTransform(clip, status.path, { width: item.width, height: item.height }, current.format);
        if (!transform) { setFaceNote(clip.adjust.rotation % 360 ? 'Turn the clip back upright to follow someone in it.' : 'No faces found in this clip, so it stays as it is.'); return; }
        change(updateClip(current, clip.id, { transform }));
        setSelectedId(clip.id);
        setFaceNote('Following the person. The frame now pans with them; drag the picture or use Motion to adjust, or ⌘Z to undo.');
      } catch (problem) { setError((problem as Error).message); setReframeJob(null); }
    }, 700);
    return () => clearTimeout(timer);
  };
    return invoke();
  }, dependencies);
}
