/**
 * Put a saved signature card into this song (signature_apply.py): the same card picture (the poet's portrait drawing
 * itself, with his name) and the same credits; only the song's name is typed. The card plays in silence after the
 * brand intro and the song moves later to make room; the credits come back after the last lyric when there is room.
 * One change, so Undo takes it all back. A song that already has the card shows the rename instead (SignatureCardGroup).
 */
import { useEffect, useState } from 'react';
import { requestJson } from '../../api/client';
import { t } from '../../i18n';
import { type Timeline, normalizeTimeline } from '../../timeline/model';
import { songName } from '../../timeline/signatureTitles';
import { Group } from '../layout';
import { useEditor } from '../state/EditorContext';
import { SignatureCardGroup } from './SignatureCardGroup';

type Saved = { name: string; lyricist: string | null; lyricist_english: string | null };

export function SignatureAddGroup() {
  const { timeline, change } = useEditor();
  const [saved, setSaved] = useState<Saved[]>([]);
  const [chosen, setChosen] = useState('');
  const [title, setTitle] = useState('');
  const [english, setEnglish] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    requestJson<Saved[]>('/api/signatures').then((list) => { setSaved(list); setChosen((current) => current || list[0]?.name || ''); }).catch(() => setSaved([]));
  }, []);
  if (songName(timeline)) return <SignatureCardGroup/>;  // Already has the card: only the song's name changes.
  if (!saved.length) return null;
  const add = async () => {
    setBusy(true); setNote(null);
    try {
      const next = await requestJson<Timeline>(`/api/signatures/${encodeURIComponent(chosen)}/apply`, { method: 'POST', body: JSON.stringify({ timeline, title: title.trim(), english: english.trim() }) });
      change(normalizeTimeline(next), 'signature');  // In the editor's own form, so autosave sees its own change.
      setNote(t('The signature card is at the start, and the song moved later to make room. Undo takes it back.'));
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };
  return <Group title="Signature card" tab="brand" startOpen keywords="signature title card poet portrait credits song name template bharathidasan" tip="Your saved title card for every song: the same portrait and credits, with this song's name.">
    {saved.length > 1 && <label className="ed-field-row">{t('Card')}<select value={chosen} onChange={(event) => setChosen(event.target.value)}>{saved.map((item) => <option key={item.name} value={item.name}>{item.lyricist_english ? `${item.name} · ${item.lyricist_english}` : item.name}</option>)}</select></label>}
    {saved.length === 1 && <p className="ed-tip">{saved[0].lyricist_english ? `${saved[0].name} · ${saved[0].lyricist_english}` : saved[0].name}</p>}
    <label className="ed-field-row">{t('Song title')}<input value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} placeholder="கற்கண்டு"/></label>
    <label className="ed-field-row">{t('English title')}<input value={english} maxLength={60} onChange={(event) => setEnglish(event.target.value)} placeholder="Karkandu"/></label>
    <button className="ed-button wide primary" disabled={busy || !title.trim() || !chosen} onClick={() => { void add(); }}>{busy ? t('Adding…') : t('Add signature card')}</button>
    {note && <p className="ed-tip" role="status">{note}</p>}
  </Group>;
}
