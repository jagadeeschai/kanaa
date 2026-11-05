import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { getAISettings, saveAISettings, type AISettings } from '../api/client';
export default function AISettingsFields({ onSaved }: { onSaved?: (settings: AISettings) => void }) {
  const [config, setConfig] = useState<AISettings | null>(null);
  const [key, setKey] = useState('');
  const [base, setBase] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('gpt-image-2.5-flare');
  const [textModel, setTextModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { let cancelled = false; void getAISettings().then((settings) => { if (!cancelled) { setConfig(settings); setBase(settings.base_url); setModel(settings.model); setTextModel(settings.text_model ?? ''); } }).catch((problem) => { if (!cancelled) setError(problem.message); }); return () => { cancelled = true; }; }, []);
  const save = async (clear = false) => { setBusy(true); setSaved(false); setError(''); try { const next = await saveAISettings({ api_key: key.trim() || undefined, base_url: base, model, text_model: textModel.trim(), clear_key: clear }); setConfig(next); setKey(''); setSaved(true); onSaved?.(next); } catch (problem) { setError((problem as Error).message); } finally { setBusy(false); } };
  return <div className="ai-settings-fields"><p className="dialog-description"><KeyRound size={17}/> Connect OpenAI or any OpenAI-compatible provider, for image generation and for Ask AI. Your key stays on Kanaa’s local backend and is never included in projects.</p>
    <fieldset disabled={busy || !config}><label className="field-label">API key<input aria-label="Image generation API key" type="password" autoComplete="new-password" value={key} onChange={(event) => { setKey(event.target.value); setSaved(false); }} placeholder={config?.configured ? 'Key configured · leave blank to keep' : 'Enter your API key'} /></label>
    <label className="field-label">Image model<input aria-label="Image generation model" value={model} onChange={(event) => { setModel(event.target.value); setSaved(false); }}/></label>
    <label className="field-label">Text model (for Ask AI)<input aria-label="Text model for Ask AI" value={textModel} placeholder="The chat model's name at your provider" onChange={(event) => { setTextModel(event.target.value); setSaved(false); }}/></label>
    <details><summary>Provider URL</summary><label className="field-label">OpenAI-compatible API URL<input aria-label="Image provider URL" value={base} onChange={(event) => { setBase(event.target.value); setSaved(false); }}/></label></details>
    <div className="ai-settings-actions"><button type="button" className="primary small" disabled={!model.trim()} onClick={() => { void save(); }}>{busy ? 'Saving…' : 'Save AI settings'}</button>{config?.configured && config.key_source !== 'environment' && <button type="button" className="text-button" onClick={() => { void save(true); }}>Remove saved key</button>}</div></fieldset>
    {saved && <p role="status" className="ai-note"><CheckCircle2 size={15}/> Settings saved{config?.configured ? ' · key configured' : ' · add a key to generate'}</p>}{error && <p role="alert" className="studio-error">{error}</p>}
    <p className="muted">Image generation sends the prompts and included lyrics to your provider and uses API credits. Ask AI sends your request, file names, titles and captions, never your videos or photos. A provider on this Mac (for example Ollama at http://localhost:11434/v1) needs no key. Local editing and lyric timing work without any of this.</p>
  </div>;
}
