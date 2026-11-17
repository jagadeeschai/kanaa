import { useState } from 'react';
import { Sparkles, Sun } from 'lucide-react';
import { getJobStatus, getPhoto, getSongBeats, makeEffect } from '../api/client';
import { t } from '../i18n';
import { beatSound, timelineBeats } from '../timeline/beats';
import { newClip } from '../timeline/model';
import { chorusSections, hitTimes, placeLightHits, styleChorus } from '../timeline/song-sections';
import type { Photo } from '../types/photo';
import { newId } from './editor-constants';
import { useEditor } from './state/EditorContext';

/** The light the hits use: a warm flash, made once per frame size like any effect (effect_service.py). */
const LIGHT_EFFECT = 'film-burn';
const LIGHT_PEAK = 2.5;  // film_burn's flare is brightest halfway through its 5 seconds.

async function lightEffect(size: { width: number; height: number }): Promise<Photo> {
  const made = await makeEffect(LIGHT_EFFECT, size);
  if (made.media) return made.media;
  if (!made.job_id) throw new Error('Could not make the light.');
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const status = await getJobStatus(made.job_id) as unknown as { status?: string; error?: string | null; media_id?: number };
    if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error ?? 'Could not make the light.');
    if (status.status === 'done' && status.media_id) return getPhoto(status.media_id);
  }
}

/** Lyric videos: the chorus found from the lyrics, styled stronger, with light hits on its beats. One click each, one undo each. */
export default function LyricSectionsPanel() {
  const { timeline, change, addMedia } = useEditor();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sections = chorusSections(timeline);
  if (!sections.length) return null;

  const style = () => {
    const result = styleChorus(timeline);
    if (result.styled) change(result.timeline);
    setNote(result.styled ? t('{count} chorus lines are bigger and pop in word by word. ⌘Z undoes it.', { count: result.styled }) : t('The chorus is already styled.'));
  };

  const lights = async () => {
    const song = beatSound(timeline);
    if (!song) { setNote(t('Add a song first. The light hits follow its beat.')); return; }
    setBusy(true); setNote(null);
    try {
      const [{ beats }, item] = await Promise.all([getSongBeats(song.asset_id), lightEffect({ width: timeline.format.width, height: timeline.format.height })]);
      addMedia(item);
      const hits = hitTimes(sections, timelineBeats(song, beats));
      const effect = newClip({ media_id: item.id, media_type: 'video', duration: item.duration, width: item.width, height: item.height }, newId());
      change(placeLightHits(timeline, effect, hits, LIGHT_PEAK, newId));
      setNote(t('{count} light hits on the chorus beats. ⌘Z undoes it.', { count: hits.length }));
    } catch (problem) { setNote((problem as Error).message); } finally { setBusy(false); }
  };

  return <section className="ed-add" aria-label={t('Chorus')}><h3 className="ed-sub">{t('Chorus')}</h3>
    <p className="ed-tip">{t('Found {count} chorus parts from the lines sung more than once.', { count: sections.length })}</p>
    <button className="ed-button wide" onClick={style}><Sparkles size={14}/>{t('Make the chorus stand out')}</button>
    <button className="ed-button wide" disabled={busy} onClick={() => { void lights(); }}><Sun size={14}/>{busy ? t('Listening for the beat…') : t('Light hits on the chorus beats')}</button>
    {note && <p className="ed-tip" role="status">{note}</p>}
  </section>;
}
