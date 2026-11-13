/**
 * The signature title card (a poet's portrait drawing itself, then the song's details): change the song's title and
 * redraw it. The card is one video made by Kanaa, so a change makes a new one and puts it in place. The clip's name
 * keeps the title as "Tamil | English".
 */
import { useEffect, useState } from 'react';
import { getJobStatus, getPhoto, requestJson } from '../../api/client';
import { t } from '../../i18n';
import { updateClip, type Clip } from '../../timeline/model';
import { Group } from '../layout';
import { useEditor } from '../state/EditorContext';

type Signature = { name: string; lyricist: string | null; lyricist_english: string | null };

export function SignatureCardGroup({ clip }: { clip: Clip }) {
  const { timeline, change, addMedia } = useEditor();
  const [tamil, english] = (clip.name ?? '').split('|').map((part) => part.trim());
  const [title, setTitle] = useState(tamil ?? '');
  const [englishTitle, setEnglishTitle] = useState(english ?? '');
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { void requestJson<Signature[]>('/api/signatures').then((list) => { setSignatures(list); setChosen((value) => value || list[0]?.name || ''); }).catch(() => setSignatures([])); }, []);
  const redraw = async () => {
    setNote(null); setBusy(0);
    try {
      const made = await requestJson<{ job_id: string }>(`/api/signatures/${encodeURIComponent(chosen)}/card`, { method: 'POST', body: JSON.stringify({ title, english: englishTitle, seconds: (clip.out - clip.in) / clip.speed }) });
      let card: number | undefined;
      while (!card) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        const status = await getJobStatus(made.job_id) as unknown as { status?: string; progress: number; error?: string | null; output_photo_id?: number };
        if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error ?? 'Could not make the card.');
        if (status.status === 'done') card = status.output_photo_id;
        setBusy(status.progress);
      }
      const item = await getPhoto(card);
      addMedia(item);
      change(updateClip(timeline, clip.id, { media_id: card, name: englishTitle ? `${title} | ${englishTitle}` : title }));
      setNote(t('The card is updated.'));
    } catch (problem) { setNote((problem as Error).message); } finally { setBusy(null); }
  };
  return <Group title="Signature card" tab="frame" startOpen keywords="signature title card poet portrait credits song name" tip="The song's opening card: the poet's portrait drawing itself, the title and the credits. Change the title and redraw it.">
    {signatures.length > 1 && <div className="ed-chips" role="group" aria-label={t('Signature')}>{signatures.map((each) => <button key={each.name} className={chosen === each.name ? 'on' : ''} aria-pressed={chosen === each.name} onClick={() => setChosen(each.name)}>{each.name}</button>)}</div>}
    <label className="ed-field-row">{t('Song title')}<input value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} placeholder="கற்கண்டு"/></label>
    <label className="ed-field-row">{t('English title')}<input value={englishTitle} maxLength={60} onChange={(event) => setEnglishTitle(event.target.value)} placeholder="Karkandu"/></label>
    <button className="ed-button wide primary" disabled={busy !== null || !title.trim() || !chosen} onClick={() => { void redraw(); }}>{busy === null ? t('Update card') : `${t('Drawing the card…')} ${busy}%`}</button>
    {note && <p className="ed-tip" role="status">{note}</p>}
  </Group>;
}
