import { useEffect, useRef, useState } from 'react';
import { AudioLines, LoaderCircle, Play, RefreshCw, Wand2 } from 'lucide-react';
import KanaaSelect from '../components/KanaaSelect';
import { t } from '../i18n';
import { voiceRequest, type Voice, type VoiceQuote, type VoiceLine } from '../api/voice';
import { ValueSlider } from './controls';
import { useEditor } from './state/EditorContext';
import type { AudioLayer, Timeline } from '../timeline/model';
import './narrate.css';

/**
 * Narration with Google voices (narration_service.py), in three steps: the script, the voice, then the cost and the
 * recording. Nothing is generated (or charged) until the cost has been shown; repeated lines come from Kanaa's cache.
 */
export default function NarratePanel() {
  const { timeline, now, change, selectedId } = useEditor();
  const latest = useRef(timeline); latest.current = timeline;
  const [script, setScript] = useState(''), [voices, setVoices] = useState<Voice[]>([]), [voice, setVoice] = useState('');
  const [speed, setSpeed] = useState(1), [pitch, setPitch] = useState(0), [gap, setGap] = useState(0.15);
  const [quote, setQuote] = useState<VoiceQuote | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [preview, setPreview] = useState(''), [note, setNote] = useState('');
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const selected = timeline.layers.filter((layer) => layer.kind === 'audio' && layer.name === 'Narration').flatMap((layer) => (layer as AudioLayer).items).find((item) => item.id === selectedId);
  const params = { script, voice, speed, pitch };
  const stale = () => setQuote(null);  // Any change to what is said or how: the cost is worked out again before recording.
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const loadVoices = () => run(async () => { const found = await voiceRequest<Voice[]>('voices'); setVoices(found); if (!found.some((v) => v.name === voice)) setVoice(found[0]?.name ?? ''); stale(); });

  // The voice list is free to read; load it once, quietly, when a key is set.
  useEffect(() => { void voiceRequest<{ configured: boolean }>('settings').then((found) => { if (found.configured) void loadVoices(); }).catch(() => {}); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const redo = () => run(async () => {
    const line = await voiceRequest<{ text: string; voice: string; speed: number; pitch: number }>(`line/${selected!.asset_id}`);
    setScript(line.text); setVoice(line.voice); setSpeed(line.speed); setPitch(line.pitch); stale(); setReplaceId(selected!.id);
    setVoices((old) => old.some((v) => v.name === line.voice) ? old : [...old, { name: line.voice, language: line.voice.slice(0, 5), family: null, price_per_million: 1, sentence_captions: line.voice.includes('Chirp3-HD') }]);
  });
  const estimate = () => run(async () => setQuote(await voiceRequest<VoiceQuote>('estimate', params)));
  const previewFirst = () => run(async () => {
    const result = await voiceRequest<{ lines: VoiceLine[] }>('generate', { ...params, quote: quote!.quote, max_cost: quote!.preview_usd, preview: true });
    setPreview(`/api/video-audio/${result.lines[0].asset_id}`); setQuote(await voiceRequest<VoiceQuote>('estimate', params));
  });
  const add = () => run(async () => {
    const base = timeline;
    const result = await voiceRequest<{ timeline: Timeline; lines: VoiceLine[] }>('generate', { ...params, quote: quote!.quote, max_cost: quote!.usd, timeline: base, start: now, gap, replace_id: replaceId });
    if (latest.current !== base) throw new Error('The timeline changed while the voice was prepared. Add it again; the recorded lines are cached.');
    change(result.timeline); setReplaceId(null); setNote(t('Narration added at the playhead')); setQuote(await voiceRequest<VoiceQuote>('estimate', params));
  });
  const voiceLabel = (v: Voice) => `${v.name.replace(/^(ta|en)-IN-/, '')} · ${v.language === 'ta-IN' ? t('Tamil') : t('Indian English')}`;

  return <section className="ed-add ed-narrate" aria-label={t('Narrate')}>
    <h3 className="ed-sub">{t('Narrate')}</h3>
    <p className="ed-tip">{t('A voice clip per sentence, with captions matched to its recorded duration. Reusing the same line is free from Kanaa’s cache.')}</p>
    {selected?.asset_id && !replaceId && <button className="ed-button wide" disabled={busy} onClick={() => void redo()}><RefreshCw size={14}/>{t('Redo selected narration line')}</button>}
    {replaceId && <div className="ed-narrate-note"><span>{t('Redoing one line. Later narration moves to fit its new duration.')}</span><button className="ed-button small" onClick={() => setReplaceId(null)}>{t('Add as new narration')}</button></div>}

    <fieldset disabled={busy}>
      <label className="ed-narrate-field"><span>{t('Narration script')}</span>
        <textarea className="ed-text" lang="ta" rows={6} maxLength={30000} placeholder={t('One sentence per line, or ordinary paragraphs.')} value={script} onChange={(event) => { setScript(event.target.value); stale(); }}/></label>

      <div className="ed-narrate-field"><span>{t('Voice')}</span>
        <div className="ed-narrate-voice">
          <KanaaSelect aria-label={t('Voice')} value={voice} disabled={!voices.length} onChange={(event) => { setVoice(event.target.value); stale(); }}>
            <option value="">{voices.length ? t('Choose a voice') : t('Load the voices first')}</option>
            {voices.map((v) => <option key={v.name} value={v.name} disabled={!v.price_per_million}>{voiceLabel(v)}</option>)}
          </KanaaSelect>
          <button className="ed-button" title={t('Load Google voices')} aria-label={t('Load Google voices')} onClick={() => void loadVoices()}><RefreshCw size={14}/>{!voices.length && t('Load')}</button>
        </div>
      </div>

      <details className="ed-narrate-more"><summary>{t('Speed, pitch and gaps')}</summary>
        <ValueSlider label="Speed" value={speed} min={0.25} max={2} step={0.05} defaultValue={1} decimals={2} unit="×" onChange={(value) => { setSpeed(value); stale(); }}/>
        <ValueSlider label="Pitch" value={pitch} min={-20} max={20} step={1} defaultValue={0} onChange={(value) => { setPitch(value); stale(); }}/>
        <ValueSlider label="Gap between sentences" value={gap} min={0} max={2} step={0.05} defaultValue={0.15} decimals={2} unit=" s" onChange={setGap}/>
      </details>

      {!quote
        ? <button className="ed-button wide" disabled={!voice || !script.trim()} onClick={() => void estimate()}><Wand2 size={14}/>{t('Estimate voice cost')}</button>
        : <div className="ed-narrate-quote" role="status">
            <div className="ed-narrate-cost"><strong>US${quote.usd.toFixed(4)}</strong><span>{quote.cached_sentences}/{quote.sentences} {t('sentences cached')}</span></div>
            <p className="ed-tip">{t(quote.sentence_captions ? 'This voice uses sentence captions timed to the audio.' : 'Word captions use Google’s timing marks when available; otherwise the complete sentence follows its audio.')} <a href={quote.pricing_url} target="_blank" rel="noreferrer">{t('Google pricing')}</a></p>
            <div className="ed-narrate-actions">
              <button className="ed-button" onClick={() => void previewFirst()}><Play size={14}/>{t('Preview first line')} <em>US${quote.preview_usd.toFixed(4)}</em></button>
              <button className="ed-primary" onClick={() => void add()}><AudioLines size={14}/>{t(replaceId ? 'Replace narration line' : 'Add to timeline')}</button>
            </div>
          </div>}
    </fieldset>

    {preview && <audio className="ed-narrate-audio" aria-label={t('Narration preview')} controls src={preview}/>}
    {busy && <p className="ed-tip ed-narrate-busy" role="status"><LoaderCircle className="spin" size={13}/>{t('Preparing narration…')}</p>}
    {note && !busy && <p className="ed-tip" role="status">{note}</p>}
    {error && <p role="alert" className="ed-error">{t(error)}</p>}
  </section>;
}
