import { useState } from 'react';
import { t } from '../i18n';
import { applyLyricLayout, LYRIC_LAYOUTS, type LyricLayout } from '../timeline/lyric-layouts';
import { lyricLines } from '../timeline/song-sections';
import { useEditor } from './state/EditorContext';

/** Where a lyric video's lines sit, in one click (lyric-layouts.ts). Shown once there are lyric lines. */
export default function LyricLayoutPanel() {
  const { timeline, change } = useEditor();
  const [chosen, setChosen] = useState<LyricLayout | null>(null);
  if (lyricLines(timeline).length < 2) return null;
  return <section className="ed-add" aria-label={t('Lyrics layout')}><h3 className="ed-sub">{t('Lyrics layout')}</h3>
    <div className="ed-chips" role="group" aria-label={t('Lyrics layout')}>{LYRIC_LAYOUTS.map((layout) =>
      <button key={layout.id} className={chosen === layout.id ? 'active' : undefined} title={t(layout.tip)} onClick={() => { change(applyLyricLayout(timeline, layout.id)); setChosen(layout.id); }}>{t(layout.label)}</button>)}</div>
    {chosen && <p className="ed-tip" role="status">{t('Every lyric line is laid out again. ⌘Z undoes it.')}</p>}
  </section>;
}
