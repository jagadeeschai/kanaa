import { useState } from 'react';
import { getSongPeaks } from '../api/client';
import { beatSound } from '../timeline/beats';
import { glowLevels, setSungGlow } from '../timeline/karaoke';
import { t } from '../i18n';
import { applyLyricLayout, currentLyricLayout, LYRIC_LAYOUTS } from '../timeline/lyric-layouts';
import { lyricLines } from '../timeline/song-sections';
import { useEditor } from './state/EditorContext';
import { sungGlow } from './lyric-video-actions';

/** Where a lyric video's lines sit, in one click (lyric-layouts.ts). Shown once there are lyric lines. */
export default function LyricLayoutPanel() {
  const { timeline, change } = useEditor();
  const [glowNote, setGlowNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lines = lyricLines(timeline);
  if (lines.length < 2) return null;
  const glowing = lines.every((line) => line.karaoke?.glow);
  const chosen = currentLyricLayout(timeline);

  const toggleGlow = async () => {
    setBusy(true); setGlowNote(null);
    try {
      change(await sungGlow(timeline, !glowing));
      setGlowNote(glowing ? null : t('Each sung word glows, brighter where the song is louder. ⌘Z undoes it.'));
    } catch (problem) { setGlowNote(t((problem as Error).message)); } finally { setBusy(false); }
  };
  return <section className="ed-add" aria-label={t('Lyrics layout')}><h3 className="ed-sub">{t('Lyrics layout')}</h3>
    <div className="ed-chips" role="group" aria-label={t('Lyrics layout')}>{LYRIC_LAYOUTS.map((layout) =>
      <button key={layout.id} className={chosen === layout.id ? 'on' : undefined} aria-pressed={chosen === layout.id} title={t(layout.tip)} onClick={() => change(applyLyricLayout(timeline, layout.id))}>{t(layout.label)}</button>)}</div>
    <p className="ed-tip">{t(chosen === 'original' ? 'Your own layout. Try one above; Original always brings yours back.' : 'Original brings back your own layout at any time.')}</p>
    <label className="ed-check"><input type="checkbox" checked={glowing} disabled={busy} onChange={() => { void toggleGlow(); }}/>{t('Sung word glows with the music')}</label>
    {glowNote && <p className="ed-tip" role="status">{glowNote}</p>}
  </section>;
}
