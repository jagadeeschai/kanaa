/**
 * The lyric-video tools that need the song or the server (its beats, its loudness, an effect's video, an export), in
 * one place, so the panels (Chorus, Section lights, Lyrics layout) and Ask AI run exactly the same steps. Each returns
 * the new timeline (or the Short's job) and what to tell the person; nothing here changes the editor by itself.
 */
import { exportShort, getSongBeats, getSongPeaks } from '../api/client';
import { beatSound, timelineBeats } from '../timeline/beats';
import { glowLevels, setSungGlow } from '../timeline/karaoke';
import { shortsLyrics } from '../timeline/lyric-layouts';
import { duration, newClip, type Timeline } from '../timeline/model';
import { chorusSections, hitTimes, lyricLines, placeLightHits, placeSectionLights, sectionStarts, shortRange, type SectionLight } from '../timeline/song-sections';
import type { Photo } from '../types/photo';
import { effectMedia } from './effect-media';
import { newId } from './editor-constants';

/** The light the chorus hits use: a warm flash; film_burn's flare is brightest halfway through its 5 seconds. */
const LIGHT_EFFECT = 'film-burn', LIGHT_PEAK = 2.5;

const effectClip = (item: Photo) => newClip({ media_id: item.id, media_type: 'video', duration: item.duration, width: item.width, height: item.height }, newId());
const size = (timeline: Timeline) => ({ width: timeline.format.width, height: timeline.format.height });

/** Light hits on the chorus beats. `media` is the light's video, for the editor's library. */
export async function chorusLightHits(timeline: Timeline): Promise<{ timeline: Timeline; media: Photo; count: number }> {
  const song = beatSound(timeline);
  if (!song) throw new Error('Add a song first. The light hits follow its beat.');
  const sections = chorusSections(timeline);
  if (!sections.length) throw new Error('No chorus found: no lyric line is sung more than once.');
  const [{ beats }, media] = await Promise.all([getSongBeats(song.asset_id), effectMedia(LIGHT_EFFECT, size(timeline))]);
  const hits = hitTimes(sections, timelineBeats(song, beats));
  return { timeline: placeLightHits(timeline, effectClip(media), hits, LIGHT_PEAK, newId), media, count: hits.length };
}

/** A light leak or lens flare at the start of each part of the song, on its beat when there is a song. */
export async function sectionLights(timeline: Timeline, kind: SectionLight): Promise<{ timeline: Timeline; media: Photo; count: number }> {
  if (lyricLines(timeline).length < 2) throw new Error('Section lights need lyric lines to find the parts of the song.');
  const song = beatSound(timeline);
  const [beats, media] = await Promise.all([song ? getSongBeats(song.asset_id).then((found) => timelineBeats(song, found.beats)) : Promise.resolve([]), effectMedia(kind, size(timeline))]);
  const result = placeSectionLights(timeline, effectClip(media), kind, sectionStarts(timeline), beats, newId);
  return { timeline: result.timeline, media, count: result.placed };
}

/** The sung word glows with the music on every lyric line, or stops glowing. */
export async function sungGlow(timeline: Timeline, on: boolean): Promise<Timeline> {
  const lines = lyricLines(timeline);
  if (!on) return setSungGlow(timeline, lines, null);
  const song = beatSound(timeline);
  if (!song) throw new Error('Add a song first. The glow follows how loud it is.');
  const { peaks, peaks_per_second } = await getSongPeaks(song.asset_id);
  const end = song.start + (song.out - song.in) / song.speed;
  const songAt = (at: number) => (at >= song.start && at < end ? song.in + (at - song.start) * song.speed : null);
  return setSungGlow(timeline, lines, (line) => glowLevels(line, peaks, peaks_per_second, songAt));
}

/** Starts a Short of the first chorus (shorts.py); returns its export job. `look`: big lyrics and a slow push, for the Short only. */
export async function startChorusShort(projectId: number, timeline: Timeline, look: boolean): Promise<string> {
  const sections = chorusSections(timeline);
  if (!sections.length) throw new Error('No chorus found: no lyric line is sung more than once.');
  const [start, end] = shortRange(sections, duration(timeline));
  const { job_id } = await exportShort(projectId, look ? shortsLyrics(timeline) : timeline, start, end, look);
  return job_id;
}
