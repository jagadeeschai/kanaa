import { useState } from 'react';
import { Sunrise } from 'lucide-react';
import { getSongBeats } from '../api/client';
import { t } from '../i18n';
import { beatSound, timelineBeats } from '../timeline/beats';
import { newClip } from '../timeline/model';
import { lyricLines, placeSectionLights, sectionStarts, type SectionLight } from '../timeline/song-sections';
import { applyMood, clearMood, currentMood, MOODS } from '../timeline/mood-grade';
import { effectMedia } from './effect-media';
import { newId } from './editor-constants';
import { useEditor } from './state/EditorContext';

const LIGHTS: { id: SectionLight; label: string }[] = [{ id: 'light-leak', label: 'Light leak' }, { id: 'lens-flare', label: 'Lens flare' }];

/** A light at the start of each part of the song (verse, chorus, after a pause), on its beat. One click, one undo. */
export default function SectionLightsPanel() {
  const { timeline, change, addMedia } = useEditor();
  const [kind, setKind] = useState<SectionLight>('light-leak');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (lyricLines(timeline).length < 2) return null;
  const starts = sectionStarts(timeline);
  const mood = currentMood(timeline);

  const place = async () => {
    setBusy(true); setNote(null);
    try {
      const song = beatSound(timeline);
      const [beats, item] = await Promise.all([song ? getSongBeats(song.asset_id).then((found) => timelineBeats(song, found.beats)) : Promise.resolve([]),
        effectMedia(kind, { width: timeline.format.width, height: timeline.format.height })]);
      addMedia(item);
      const effect = newClip({ media_id: item.id, media_type: 'video', duration: item.duration, width: item.width, height: item.height }, newId());
      const result = placeSectionLights(timeline, effect, kind, starts, beats, newId);
      change(result.timeline);
      setNote(t('{count} lights at the start of each part of the song. ⌘Z undoes it.', { count: result.placed }));
    } catch (problem) { setNote((problem as Error).message); } finally { setBusy(false); }
  };

  return <section className="ed-add" aria-label={t('Section lights')}><h3 className="ed-sub">{t('Section lights')}</h3>
    <p className="ed-tip">{t('{count} parts found: each verse and chorus, and after each pause.', { count: starts.length })}</p>
    <div className="ed-chips" role="group" aria-label={t('Section lights')}>{LIGHTS.map((light) => <button key={light.id} className={kind === light.id ? 'on' : undefined} aria-pressed={kind === light.id} onClick={() => setKind(light.id)}>{t(light.label)}</button>)}</div>
    <button className="ed-button wide" disabled={busy} onClick={() => { void place(); }}><Sunrise size={14}/>{busy ? t('Making the light…') : t('Add a light at each part')}</button>
    {note && <p className="ed-tip" role="status">{note}</p>}
    <h3 className="ed-sub">{t('Mood grade')}</h3>
    <p className="ed-tip">{t('Each part of the song in its own colour: calm verses, a richer chorus. The words keep their colour.')}</p>
    <div className="ed-chips" role="group" aria-label={t('Mood grade')}><button className={mood === null ? 'on' : undefined} aria-pressed={mood === null} onClick={() => change(clearMood(timeline))}>{t('None')}</button>
      {MOODS.map((each) => <button key={each.id} className={mood === each.id ? 'on' : undefined} aria-pressed={mood === each.id} title={t(each.tip)} onClick={() => change(applyMood(timeline, each.id))}>{t(each.label)}</button>)}</div>
  </section>;
}
