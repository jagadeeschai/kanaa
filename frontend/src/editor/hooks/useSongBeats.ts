/** The song's beats on the timeline (timeline seconds), for beat-synced looks: null while loading, [] without a song. */
import { useEffect, useState } from 'react';
import { getSongBeats } from '../../api/client';
import { beatSound, timelineBeats } from '../../timeline/beats';
import type { Timeline } from '../../timeline/model';

export function useSongBeats(timeline: Timeline) {
  const song = beatSound(timeline);
  const [beats, setBeats] = useState<number[] | null>(null);
  useEffect(() => {
    let live = true;
    setBeats(song?.asset_id ? null : []);
    if (song?.asset_id) getSongBeats(song.asset_id).then((found) => { if (live) setBeats(timelineBeats(song, found.beats)); }).catch(() => { if (live) setBeats([]); });
    return () => { live = false; };
  }, [song?.asset_id, song?.start, song?.in, song?.out, song?.speed]);  // eslint-disable-line react-hooks/exhaustive-deps
  return { song, beats };
}
