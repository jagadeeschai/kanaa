/**
 * Music visualiser, one click: Bars, Circle or Wave in a colour, moving with the song for its whole length. None takes
 * it away. It is its own layer, so it can be moved, resized or faded like any clip; ⌘Z undoes it.
 */
import { useState } from 'react';
import { AudioWaveform, LoaderCircle } from 'lucide-react';
import { getPhoto, requestJson, waitForJob } from '../api/client';
import { t } from '../i18n';
import { currentVisualiser, placeVisualiser, removeVisualiser, songOf, VISUALISER_COLOURS, VISUALISER_STYLES, type VisualiserStyle } from '../timeline/visualiser';
import { newId } from './editor-constants';
import { useEditor } from './state/EditorContext';

export default function VisualiserPanel() {
  const { timeline, change, addMedia } = useEditor();
  const on = currentVisualiser(timeline);
  const [colour, setColour] = useState(on?.colour ?? VISUALISER_COLOURS[0]);
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const song = songOf(timeline);

  const make = async (style: VisualiserStyle, tint = colour) => {
    if (!song?.asset_id) return;
    setBusy(0); setNote(null);
    try {
      const { width, height } = timeline.format;
      const started = await requestJson<{ status: string; output_photo_id?: number; job_id?: string }>('/api/visualiser', { method: 'POST',
        body: JSON.stringify({ asset_id: song.asset_id, start: song.in, seconds: (song.out - song.in) / song.speed, style, colour: tint, width, height }) });
      const id = started.output_photo_id ?? (await waitForJob<{ output_photo_id: number }>(started.job_id!, (value) => setBusy(value))).output_photo_id;
      const made = await getPhoto(id);
      addMedia(made);
      change(placeVisualiser(timeline, song, made, style, tint, { clip: newId(), layer: newId() }));
      setNote(t('It moves with the song. Drag or resize it in the preview; ⌘Z undoes it.'));
    } catch (problem) { setNote(t((problem as Error).message)); } finally { setBusy(null); }
  };
  const pickColour = (tint: string) => { setColour(tint); if (on && tint !== on.colour) void make(on.style, tint); };

  return <section className="ed-add" aria-label={t('Music visualiser')}><h3 className="ed-sub">{t('Music visualiser')}</h3>
    {!song ? <p className="ed-tip">{t('Add a song first (Audio › Music); the visualiser moves with it.')}</p> : <>
      <p className="ed-tip">{t('Light that moves with the music, for the whole song.')}</p>
      <div className="ed-chips ed-even" role="group" aria-label={t('Visualiser style')}>
        <button className={!on ? 'on' : undefined} aria-pressed={!on} disabled={busy !== null} onClick={() => { change(removeVisualiser(timeline)); setNote(null); }}>{t('None')}</button>
        {VISUALISER_STYLES.map((style) => <button key={style.id} className={on?.style === style.id ? 'on' : undefined} aria-pressed={on?.style === style.id} disabled={busy !== null} onClick={() => { void make(style.id); }}>{t(style.label)}</button>)}
      </div>
      <div className="ed-swatches" role="group" aria-label={t('Visualiser colour')}>
        {VISUALISER_COLOURS.map((tint) => <button key={tint} className={`ed-swatch ${colour === tint ? 'on' : ''}`} aria-pressed={colour === tint} aria-label={tint} title={tint} disabled={busy !== null} style={{ background: tint }} onClick={() => pickColour(tint)}/>)}
        <label className={`ed-swatch ed-swatch-own ${VISUALISER_COLOURS.includes(colour) ? '' : 'on'}`} style={{ background: VISUALISER_COLOURS.includes(colour) ? 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)' : colour }} title={t('Any colour')}><input type="color" aria-label={t('Any colour')} value={colour} disabled={busy !== null} onChange={(event) => setColour(event.target.value)} onBlur={(event) => pickColour(event.target.value)}/></label>
      </div>
      {busy !== null && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Drawing the music…')} {busy ? `${Math.round(busy)}%` : ''}</p>}
      {busy === null && note && <p className="ed-tip" role="status"><AudioWaveform size={12}/> {note}</p>}
    </>}
  </section>;
}
