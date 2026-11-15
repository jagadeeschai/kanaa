import type { DependencyList } from 'react';
import { useEffect } from "react";
import { getJobStatus } from "../../api/client";
import { type TrackPoint } from "../../timeline/tracking";
type Box = [number, number, number, number];
type FollowJob = { itemId: string; underId: string; jobId: string; progress: number; queued?: boolean; drawnAt: number; from: number; size: boolean; place: Box | null; own: boolean; grew: boolean;
  /** Set while looking for a face under a blur box: where the box is in the source, and what to follow instead when no face is there. */
  faces?: { box: Box; at: number; own: Box; grow?: number } };

type Input = {
  followJob: FollowJob | null;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setFollowJob: React.Dispatch<React.SetStateAction<FollowJob | null>>;
  applyFaces: (job: FollowJob, faces: TrackPoint[][]) => void;
  applyFollow: (job: FollowJob, track: { points: TrackPoint[]; lost_before: boolean; lost_after: boolean; }) => void;
};

export function useFollowJob(getInput: () => Input, dependencies?: DependencyList) {
  useEffect(() => {
    const { followJob, setError, setFollowJob, applyFaces, applyFollow } = getInput();
    const invoke = () => {
    if (!followJob) return;
    const timer = setTimeout(async () => {
      try {
        const status = await getJobStatus(followJob.jobId) as unknown as { status?: string; progress: number; error?: string | null; track?: { points: TrackPoint[]; lost_before: boolean; lost_after: boolean }; faces?: TrackPoint[][] };
        if (status.status === 'failed' || status.status === 'cancelled') { if (status.status === 'failed') setError(status.error ?? 'Could not follow that.'); setFollowJob(null); return; }
        if (followJob.faces && status.status === 'done') { setFollowJob(null); applyFaces(followJob, status.faces ?? []); return; }
        if (status.status !== 'done' || !status.track) { setFollowJob({ ...followJob, progress: status.progress, queued: status.status === 'queued' }); return; }
        setFollowJob(null);
        applyFollow(followJob, status.track);
      } catch (problem) { setError((problem as Error).message); setFollowJob(null); }
    }, 600);
    return () => clearTimeout(timer);
  };
    return invoke();
  }, dependencies);
}
