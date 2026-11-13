/**
 * The signature title template: the card's picture (the poet's portrait drawing itself) stays the same; the song's
 * name is in titles, on the card, in the credit during the song and on the end card. Typing a new name here renames
 * all of them at once (each title can also be edited on its own).
 */
import { useState } from 'react';
import { t } from '../../i18n';
import { renameSong, songName } from '../../timeline/signatureTitles';
import { Group } from '../layout';
import { useEditor } from '../state/EditorContext';

export function SignatureCardGroup() {
  const { timeline, change } = useEditor();
  const current = songName(timeline);
  const [title, setTitle] = useState(current?.tamil ?? '');
  const [english, setEnglish] = useState(current?.english ?? '');
  const [note, setNote] = useState<string | null>(null);
  if (!current) return null;
  const apply = () => {
    change(renameSong(timeline, current, { tamil: title.trim(), english: english.trim().toUpperCase() }));
    setNote(t('The song name is changed on the card, in the song and on the end card.'));
  };
  return <Group title="Signature card" tab="frame" startOpen keywords="signature title card poet portrait credits song name template" tip="The song's title template. Change the song name here and the card, the credit in the song and the end card all follow.">
    <label className="ed-field-row">{t('Song title')}<input value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} placeholder="கற்கண்டு"/></label>
    <label className="ed-field-row">{t('English title')}<input value={english} maxLength={60} onChange={(event) => setEnglish(event.target.value)} placeholder="Karkandu"/></label>
    <button className="ed-button wide primary" disabled={!title.trim()} onClick={apply}>{t('Change song name')}</button>
    {note && <p className="ed-tip" role="status">{note}</p>}
  </Group>;
}
