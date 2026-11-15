/** The video AI for Bring to life: which API style, address, model and key. Kept apart from the image AI's settings. */
import { useEffect, useState } from 'react';
import { CheckCircle2, Clapperboard } from 'lucide-react';
import { getVideoAISettings, saveVideoAISettings, type VideoAISettings } from '../api/client';

const PRESETS = {
  atlas: { base: 'https://api.atlascloud.ai/api/v1', model: 'alibaba/wan-2.6/image-to-video-flash' },
  openai: { base: 'https://api.openai.com/v1', model: 'sora-2' },
};

export default function VideoAISettingsFields() {
  const [config, setConfig] = useState<VideoAISettings | null>(null);
  const [provider, setProvider] = useState<'atlas' | 'openai'>('atlas');
  const [base, setBase] = useState(PRESETS.atlas.base);
  const [model, setModel] = useState(PRESETS.atlas.model);
  const [resolution, setResolution] = useState<'480p' | '720p' | '1080p'>('720p');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getVideoAISettings().then((s) => { if (!cancelled) { setConfig(s); setProvider(s.provider); setBase(s.base_url); setModel(s.model); setResolution(s.resolution); } }).catch((problem) => { if (!cancelled) setError(problem.message); });
    return () => { cancelled = true; };
  }, []);
  const pick = (next: 'atlas' | 'openai') => { setProvider(next); setBase(PRESETS[next].base); setModel(PRESETS[next].model); setSaved(false); };
  const save = async (clear = false) => {
    setBusy(true); setSaved(false); setError('');
    try { const next = await saveVideoAISettings({ provider, base_url: base, model, resolution, api_key: key.trim() || undefined, clear_key: clear }); setConfig(next); setKey(''); setSaved(true); }
    catch (problem) { setError((problem as Error).message); } finally { setBusy(false); }
  };
  return <div className="ai-settings-fields">
    <h3 className="ai-settings-heading"><Clapperboard size={16}/> Video (Bring to life)</h3>
    <p className="dialog-description">Turns a picture into a few seconds of video. Atlas Cloud with Wan 2.6 Flash costs about $0.02 a second (a 5-second clip is about 10 cents). Any provider with the same API shape works.</p>
    <fieldset disabled={busy || !config}>
      <label className="field-label">Provider style<select aria-label="Video provider style" value={provider} onChange={(event) => pick(event.target.value as 'atlas' | 'openai')}>
        <option value="atlas">Atlas Cloud style (Wan, Kling, Seedance…)</option><option value="openai">OpenAI Videos style</option></select></label>
      <label className="field-label">API key<input aria-label="Video API key" type="password" autoComplete="new-password" value={key} onChange={(event) => { setKey(event.target.value); setSaved(false); }} placeholder={config?.configured ? 'Key configured · leave blank to keep' : 'Enter your video API key'}/></label>
      <label className="field-label">Video model<input aria-label="Video model" value={model} onChange={(event) => { setModel(event.target.value); setSaved(false); }}/></label>
      <label className="field-label">Quality<select aria-label="Video resolution" value={resolution} onChange={(event) => { setResolution(event.target.value as '480p' | '720p' | '1080p'); setSaved(false); }}>
        <option value="480p">480p · cheapest drafts</option><option value="720p">720p · recommended</option><option value="1080p">1080p · costs more</option></select></label>
      <details><summary>Provider URL</summary><label className="field-label">API URL<input aria-label="Video provider URL" value={base} onChange={(event) => { setBase(event.target.value); setSaved(false); }}/></label></details>
      <div className="ai-settings-actions"><button type="button" className="primary small" disabled={!model.trim()} onClick={() => { void save(); }}>{busy ? 'Saving…' : 'Save video settings'}</button>{config?.configured && config.key_source !== 'environment' && <button type="button" className="text-button" onClick={() => { void save(true); }}>Remove saved key</button>}</div>
    </fieldset>
    {saved && <p role="status" className="ai-note"><CheckCircle2 size={15}/> Video settings saved{config?.configured ? ' · key configured' : ' · add a key to use it'}</p>}{error && <p role="alert" className="studio-error">{error}</p>}
    <p className="muted">Bring to life sends the picture and your words to this provider and uses its credits. The video comes back silent; your song stays the soundtrack.</p>
  </div>;
}
