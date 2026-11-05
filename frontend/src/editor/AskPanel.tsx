import { useEffect, useState } from 'react';
import { Check, Copy, LoaderCircle, Sparkles } from 'lucide-react';
import { describeVideo, getTextAISettings, planEdits, saveTextAISettings, type TextAISettings } from '../api/client';
import { describeCommand, usable, type Options, type Proposed } from '../timeline/commands';
import type { Timeline } from '../timeline/model';

/** Ready-made connections. The model name is left to the person: providers rename models often. */
const PRESETS = [
  { id: 'local', label: 'On this Mac (Ollama)', base: 'http://localhost:11434/v1', note: 'Free and private: nothing leaves this Mac. Install Ollama and a model first (for example with "ollama pull <model>").' },
  { id: 'cloud', label: 'OpenAI-compatible service', base: 'https://api.openai.com/v1', note: 'Needs an API key and uses credits. Your request, file names, titles and captions are sent to the provider; your videos are not.' },
];
const EXAMPLES = ['Make it a warm wedding reel with captions', 'Add a title “Pongal 2026” at the start and fireworks at the end', 'Make it vertical and cut it to the beat', 'Translate the captions to Tamil'];

type Props = {
  timeline: Timeline;
  options: Options;
  project: () => Record<string, unknown>;
  /** Runs the ticked commands in order; returns one line per command saying what happened. */
  onApply: (commands: Proposed[]) => Promise<string[]>;
};

export default function AskPanel({ timeline, options, project, onApply }: Props) {
  const [settings, setSettings] = useState<TextAISettings | null>(null);
  const [editing, setEditing] = useState(false);
  const [base, setBase] = useState(PRESETS[0].base);
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState<'plan' | 'apply' | 'save' | 'describe' | null>(null);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<{ summary: string; commands: Proposed[]; dropped: number } | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<string[]>([]);
  const [language, setLanguage] = useState<'en' | 'ta' | 'both'>('both');
  const [post, setPost] = useState<{ title: string; description: string; hashtags: string[] } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getTextAISettings().then((found) => { setSettings(found); if (found.base_url) setBase(found.base_url); setModel(found.model); setEditing(!found.configured); }).catch((problem) => setError((problem as Error).message));
  }, []);

  const save = async () => {
    setBusy('save'); setError('');
    try { const next = await saveTextAISettings({ base_url: base, model, api_key: key.trim() || undefined }); setSettings(next); setKey(''); setEditing(!next.configured); if (!next.configured) setError('Add an API key for a cloud service.'); }
    catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  const ask = async (text = request) => {
    if (!text.trim()) return;
    setBusy('plan'); setError(''); setPlan(null); setResults([]);
    try {
      const answer = await planEdits({ request: text, project: project(), options });
      const commands = (answer.commands as Proposed[]).filter((command) => usable(command, options, timeline));
      setPlan({ summary: answer.summary, commands, dropped: answer.dropped.length + answer.commands.length - commands.length });
      setTicked(new Set(commands.map((_, index) => index)));
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  const apply = async () => {
    if (!plan) return;
    setBusy('apply'); setError('');
    try { setResults(await onApply(plan.commands.filter((_, index) => ticked.has(index)))); }
    catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  const write = async () => {
    setBusy('describe'); setError(''); setCopied(false);
    try { setPost(await describeVideo(project(), language)); } catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  const copy = async () => {
    if (!post) return;
    try { await navigator.clipboard.writeText(`${post.title}\n\n${post.description}\n\n${post.hashtags.join(' ')}`); setCopied(true); } catch { setError('Could not copy. Select the words and copy them instead.'); }
  };
  const preset = PRESETS.find((item) => item.base === base) ?? PRESETS[1];

  return <section className="ed-add ed-ask" aria-label="Ask AI">
    <p className="ed-tip">Say what you want in plain words, in English or Tamil. Kanaa suggests edits; nothing changes until you apply them, and ⌘Z undoes each one.</p>
    {settings && !editing && <div className="ed-add-row"><span>AI: <b>{settings.model}</b> {settings.local ? '· on this Mac' : '· cloud'}</span><button className="ed-button" onClick={() => setEditing(true)}>Change</button></div>}
    {editing && <div className="ed-ask-connect" role="group" aria-label="AI connection">
      <h3 className="ed-sub">AI connection</h3>
      <div className="ed-chips" role="group" aria-label="Where the AI runs">{PRESETS.map((item) => <button key={item.id} className={preset.id === item.id ? 'on' : ''} aria-pressed={preset.id === item.id} onClick={() => setBase(item.base)}>{item.label}</button>)}</div>
      <p className="ed-tip">{preset.note}</p>
      <label className="ed-field">Model<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="The model's name at your provider"/></label>
      <details><summary className="ed-tip">Address</summary><label className="ed-field">OpenAI-compatible API address<input value={base} onChange={(event) => setBase(event.target.value)}/></label></details>
      {preset.id !== 'local' && <label className="ed-field">API key<input type="password" autoComplete="new-password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={settings?.has_key ? 'Saved. Type to replace it.' : ''}/></label>}
      <button className="ed-button wide" disabled={!model.trim() || busy === 'save'} onClick={() => { void save(); }}>{busy === 'save' ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>}Save AI connection</button>
      <p className="ed-tip">The key stays on this Mac and is never put in projects.</p>
    </div>}
    {settings?.configured && <>
      <textarea className="ed-ask-input" aria-label="What should Kanaa do?" rows={3} value={request} placeholder="For example: make it a warm wedding reel with captions and confetti at the end"
        onChange={(event) => setRequest(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void ask(); }}/>
      <div className="ed-chips ed-ask-examples" role="group" aria-label="Examples">{EXAMPLES.map((text) => <button key={text} onClick={() => { setRequest(text); void ask(text); }}>{text}</button>)}</div>
      <button className="ed-primary wide" disabled={!request.trim() || busy !== null} onClick={() => { void ask(); }}>{busy === 'plan' ? <LoaderCircle className="spin" size={14}/> : <Sparkles size={14}/>}{busy === 'plan' ? 'Thinking…' : 'Suggest edits'}</button>
      {plan && <div className="ed-ask-plan" aria-live="polite">
        {plan.summary && <p>{plan.summary}</p>}
        {plan.commands.length ? <ul className="ed-ask-list">{plan.commands.map((command, index) => <li key={index}><label className="ed-check"><input type="checkbox" checked={ticked.has(index)} onChange={(event) => { const next = new Set(ticked); if (event.target.checked) next.add(index); else next.delete(index); setTicked(next); }}/>
          <span>{describeCommand(command, options)}{command.why && <small>{command.why}</small>}</span></label></li>)}</ul> : <p className="ed-tip">No edits Kanaa can make for that. Try saying it another way.</p>}
        {plan.dropped > 0 && <p className="ed-tip">{plan.dropped} suggestion{plan.dropped === 1 ? ' was' : 's were'} left out because Kanaa can't do {plan.dropped === 1 ? 'it' : 'them'}.</p>}
        {plan.commands.length > 0 && <button className="ed-primary wide" disabled={!ticked.size || busy !== null} onClick={() => { void apply(); }}>{busy === 'apply' ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>}{busy === 'apply' ? 'Applying…' : `Apply ${ticked.size} edit${ticked.size === 1 ? '' : 's'}`}</button>}
        {results.length > 0 && <ul className="ed-ask-results" role="status">{results.map((line, index) => <li key={index}>{line}</li>)}</ul>}
      </div>}
      <h3 className="ed-sub">Words to post</h3>
      <p className="ed-tip">A title, a few lines and hashtags for Instagram, YouTube or WhatsApp, from your titles, captions and clips.</p>
      <div className="ed-chips ed-even" role="group" aria-label="Language">{([['both', 'Both'], ['en', 'English'], ['ta', 'தமிழ்']] as const).map(([id, label]) => <button key={id} className={language === id ? 'on' : ''} aria-pressed={language === id} onClick={() => setLanguage(id)}>{label}</button>)}</div>
      <button className="ed-button wide" disabled={busy !== null} onClick={() => { void write(); }}>{busy === 'describe' ? <LoaderCircle className="spin" size={14}/> : <Sparkles size={14}/>}Write the post</button>
      {post && <div className="ed-ask-post"><b>{post.title}</b><p>{post.description}</p><p className="ed-ask-tags">{post.hashtags.join(' ')}</p>
        <button className="ed-button" onClick={() => { void copy(); }}>{copied ? <Check size={13}/> : <Copy size={13}/>}{copied ? 'Copied' : 'Copy'}</button></div>}
    </>}
    {error && <p className="ed-tip ed-ask-error" role="alert">{error}</p>}
  </section>;
}
