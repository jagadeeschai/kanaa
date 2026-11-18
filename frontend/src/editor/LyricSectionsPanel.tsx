import { useState } from 'react';
import { Smartphone, Sparkles, Sun } from 'lucide-react';
import { exportShort, getJobStatus, getSongBeats } from '../api/client';
import { effectMedia } from './effect-media';
import { t } from '../i18n';
import { beatSound, timelineBeats } from '../timeline/beats';
import { duration, newClip } from '../timeline/model';
import { chorusSections, hitTimes, placeLightHits, shortRange, styleChorus } from '../timeline/song-sections';
import { newId } from './editor-constants';
import { useEditor } from './state/EditorContext';
import { chorusLightHits, startChorusShort } from './lyric-video-actions';
import { shortsLyrics } from '../timeline/lyric-layouts';

/** The light the hits use: a warm flash, made once per frame size like any effect (effect_service.py). */
const LIGHT_EFFECT = 'film-burn';
const LIGHT_PEAK = 2.5;  // film_burn's flare is brightest halfway through its 5 seconds.

/** Lyric videos: the chorus found from the lyrics, styled stronger, with light hits on its beats. One click each, one undo each. */
export default function LyricSectionsPanel() {
  const { timeline, change, addMedia, projectId, openOutput } = useEditor();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [short, setShort] = useState<{ progress: number; id?: number } | null>(null);
  const [shortLook, setShortLook] = useState(true);
  const sections = chorusSections(timeline);
  if (!sections.length) return null;

  const style = () => {
    const result = styleChorus(timeline);
    if (result.styled) change(result.timeline);
    setNote(result.styled ? t('{count} chorus lines are bigger and pop in word by word. ⌘Z undoes it.', { count: result.styled }) : t('The chorus is already styled.'));
  };

  const lights = async () => {
    setBusy(true); setNote(null);
    try {
      const result = await chorusLightHits(timeline);
      addMedia(result.media); change(result.timeline);
      setNote(t('{count} light hits on the chorus beats. ⌘Z undoes it.', { count: result.count }));
    } catch (problem) { setNote(t((problem as Error).message)); } finally { setBusy(false); }
  };

  const makeShort = async () => {
    setShort({ progress: 0 }); setNote(null);
    try {
      const job_id = await startChorusShort(projectId, timeline, shortLook);
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const status = await getJobStatus(job_id) as unknown as { status?: string; progress: number; error?: string | null; output_photo_id?: number };
        if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error ?? t('The Short was not made.'));
        if (status.status === 'done') { setShort({ progress: 100, id: status.output_photo_id }); return; }
        setShort({ progress: status.progress ?? 0 });
      }
    } catch (problem) { setShort(null); setNote((problem as Error).message); }
  };

  return <section className="ed-add" aria-label={t('Chorus')}><h3 className="ed-sub">{t('Chorus')}</h3>
    <p className="ed-tip">{t('Found {count} chorus parts from the lines sung more than once.', { count: sections.length })}</p>
    <button className="ed-button wide" onClick={style}><Sparkles size={14}/>{t('Make the chorus stand out')}</button>
    <button className="ed-button wide" disabled={busy} onClick={() => { void lights(); }}><Sun size={14}/>{busy ? t('Listening for the beat…') : t('Light hits on the chorus beats')}</button>
    <button className="ed-button wide" disabled={Boolean(short && short.progress < 100)} title={t('A 9:16 video of the chorus for YouTube Shorts and Reels, each picture kept on its subject. Your project stays as it is.')} onClick={() => { void makeShort(); }}><Smartphone size={14}/>{short && short.progress < 100 ? t('Making the Short… {progress}%', { progress: Math.round(short.progress) }) : t('Export a Short of the chorus')}</button>
    <label className="ed-check"><input type="checkbox" checked={shortLook} onChange={(event) => setShortLook(event.target.checked)}/>{t('Shorts look: big lyrics, a slow push on each picture')}</label>
    {short?.id && <p className="ed-tip" role="status">{t('Your Short is ready.')} <button className="ed-link" onClick={() => openOutput(short.id!)}>{t('Open it')}</button></p>}
    {note && <p className="ed-tip" role="status">{note}</p>}
  </section>;
}
