import type { DependencyList } from 'react';
import { useEffect } from "react";
import { getJobStatus } from "../../api/client";
import { type Timeline } from "../../timeline/model";
import { splitAtCuts } from "../../timeline/scenes";
import { newId } from "../editor-constants";

type Input = {
  sceneJob: { jobId: string; clipId: string; progress: number; } | null;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setSceneJob: React.Dispatch<React.SetStateAction<{ jobId: string; clipId: string; progress: number; } | null>>;
  timelineRef: React.MutableRefObject<Timeline | null>;
  change: (next: Timeline, group?: string | null) => void;
  setFaceNote: React.Dispatch<React.SetStateAction<string>>;
};

export function useSceneJob(getInput: () => Input, dependencies: DependencyList) {
  useEffect(() => {
    const { sceneJob, setError, setSceneJob, timelineRef, change, setFaceNote } = getInput();
    const invoke = () => {
    if (!sceneJob) return;
    const timer = setTimeout(async () => {
      try {
        const status = await getJobStatus(sceneJob.jobId) as unknown as { status?: string; progress: number; error?: string | null; cuts?: number[] };
        if (status.status === 'failed' || status.status === 'cancelled') { if (status.status === 'failed') setError(status.error ?? 'Could not look for scene changes.'); setSceneJob(null); return; }
        if (status.status !== 'done' || !status.cuts) { setSceneJob({ ...sceneJob, progress: status.progress }); return; }
        setSceneJob(null);
        const current = timelineRef.current;
        if (!current) return;
        const result = splitAtCuts(current, sceneJob.clipId, status.cuts, newId);
        if (result.splits) change(result.timeline);
        setFaceNote(result.splits ? `Split into ${result.splits + 1} scenes. Select one and press Delete to drop it; ⌘Z puts them back together.` : 'No scene changes found in this clip.');
      } catch (problem) { setError((problem as Error).message); setSceneJob(null); }
    }, 700);
    return () => clearTimeout(timer);
  };
    return invoke();
  }, dependencies);
}
