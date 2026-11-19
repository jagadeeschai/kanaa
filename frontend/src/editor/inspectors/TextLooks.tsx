/**
 * Your own fonts beside the built-in ones (Add a font: a .ttf or .otf, kept in Kanaa), and what fills the letters:
 * Plain, Gold, a gradient or a picture. Each is one click; the outline and shadow stay.
 */
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { listPhotos, photoThumbUrl, requestJson } from '../../api/client';
import { t } from '../../i18n';
import type { TextItem } from '../../timeline/model';
import { ENGLISH_FONTS, TAMIL_FONTS, type FontChoice } from '../../timeline/templates';
import type { Photo } from '../../types/photo';
import { FontPicker } from './parts';

type OwnFont = { family: string; file: string; tamil: boolean; latin: boolean };
let own: OwnFont[] | null = null;
const listeners = new Set<(fonts: OwnFont[]) => void>();
const loaded = new Set<string>();

function remember(fonts: OwnFont[]) {
  own = fonts;
  const rules = fonts.filter((font) => !loaded.has(font.file)).map((font) => { loaded.add(font.file); return `@font-face{font-family:"${font.family}";src:url("/api/fonts/${encodeURIComponent(font.file)}");font-display:swap}`; }).join('');
  if (rules) { const style = document.createElement('style'); style.textContent = rules; document.head.appendChild(style); }
  listeners.forEach((listener) => listener(fonts));
}

function useOwnFonts(): OwnFont[] {
  const [fonts, setFonts] = useState<OwnFont[]>(own ?? []);
  useEffect(() => {
    listeners.add(setFonts);
    if (own === null) requestJson<OwnFont[]>('/api/own-fonts').then(remember).catch(() => remember([]));
    return () => { listeners.delete(setFonts); };
  }, []);
  return fonts;
}

export function FontsWithYours({ text, onChange }: { text: TextItem; onChange: (changes: Partial<TextItem>) => void }) {
  const fonts = useOwnFonts();
  const [note, setNote] = useState<string | null>(null);
  const builtIn = new Set([...TAMIL_FONTS, ...ENGLISH_FONTS].map((font) => font.family));
  const yours = (filter: (font: OwnFont) => boolean): FontChoice[] => fonts.filter((font) => filter(font) && !builtIn.has(font.family)).map((font) => ({ family: font.family, label: font.family, file: font.file }));
  const add = async (file: File) => {
    setNote(null);
    const body = new FormData(); body.append('file', file);
    const response = await fetch('/api/own-fonts', { method: 'POST', body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setNote(typeof data.detail === 'string' ? data.detail : t('Could not add that font.')); return; }
    remember([...(own ?? []).filter((font) => font.family !== data.family), data]);
    onChange(data.tamil ? { tamil_font: data.family } : { font: data.family });
    setNote(t('{name} added and used on this title.', { name: data.family }));
  };
  return <>
    <FontPicker label="Tamil font" fonts={[...TAMIL_FONTS, ...yours((font) => font.tamil)]} value={text.tamil_font ?? 'Noto Sans Tamil'} sample="அ" onPick={(tamil_font) => onChange({ tamil_font: tamil_font === 'Noto Sans Tamil' ? null : tamil_font })}/>
    <FontPicker label="English font" fonts={[...ENGLISH_FONTS, ...yours((font) => font.latin)]} value={text.font ?? 'Noto Sans'} sample="Aa" onPick={(font) => onChange({ font: font === 'Noto Sans' ? null : font })}/>
    <label className="ed-button wide ed-add-font"><Plus size={14}/>{t('Add a font')}<input type="file" accept=".ttf,.otf,font/ttf,font/otf" aria-label={t('Add a font')} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void add(file); }}/></label>
    {note && <p className="ed-tip" role="status">{note}</p>}
  </>;
}

const GRADIENTS: { id: string; label: string; colours: [string, string] }[] = [
  { id: 'sunset', label: 'Sunset', colours: ['#ff7a18', '#af002d'] }, { id: 'ocean', label: 'Ocean', colours: ['#00c6ff', '#0072ff'] },
  { id: 'neon', label: 'Neon', colours: ['#f72585', '#7209b7'] }, { id: 'mint', label: 'Mint', colours: ['#d4fc79', '#0bab64'] },
];

export function LetterFill({ text, onChange }: { text: TextItem; onChange: (changes: Partial<TextItem>) => void }) {
  const fill = text.fill ?? null;
  const [pictures, setPictures] = useState<Photo[] | null>(null);
  const gradient = fill?.kind === 'gradient' ? GRADIENTS.find((each) => each.colours.join() === (fill.colours ?? []).join())?.id ?? 'own' : null;
  const choose = (next: TextItem['fill']) => onChange({ fill: next });
  const showPictures = () => { if (pictures === null) listPhotos({ media_type: 'image', limit: 60 }).then((found) => setPictures(found.photos ?? [])).catch(() => setPictures([])); };
  return <>
    <h3 className="ed-sub">{t('Inside the letters')}</h3>
    <div className="ed-chips" role="group" aria-label={t('Inside the letters')}>
      <button className={!fill ? 'on' : undefined} aria-pressed={!fill} onClick={() => choose(null)}>{t('Plain colour')}</button>
      <button className={fill?.kind === 'gold' ? 'on' : undefined} aria-pressed={fill?.kind === 'gold'} onClick={() => choose({ kind: 'gold' })}>{t('Gold')}</button>
      {GRADIENTS.map((each) => <button key={each.id} className={gradient === each.id ? 'on' : undefined} aria-pressed={gradient === each.id} style={{ backgroundImage: `linear-gradient(135deg, ${each.colours[0]}33, ${each.colours[1]}33)` }} onClick={() => choose({ kind: 'gradient', colours: each.colours })}>{t(each.label)}</button>)}
      <button className={fill?.kind === 'picture' ? 'on' : undefined} aria-pressed={fill?.kind === 'picture'} onClick={showPictures}>{t('A picture')}</button>
    </div>
    {fill?.kind === 'gradient' && <div className="ed-pair-colours">
      {[0, 1].map((index) => <label key={index} className="ed-color"><span>{t(index ? 'To' : 'From')}</span><input type="color" aria-label={t(index ? 'Gradient end colour' : 'Gradient start colour')} value={(fill.colours ?? [])[index] ?? '#ffffff'}
        onChange={(event) => { const colours = [...(fill.colours ?? ['#ffffff', '#ffffff'])] as string[]; colours[index] = event.target.value; choose({ kind: 'gradient', colours }); }}/></label>)}
    </div>}
    {pictures !== null && <div className="ed-youtube-pictures ed-fill-pictures" role="listbox" aria-label={t('Pictures')}>
      {pictures.length === 0 && <small>{t('No pictures in the library yet.')}</small>}
      {pictures.map((picture) => { const on = fill?.kind === 'picture' && fill.media_id === picture.id; return <button key={picture.id} role="option" aria-selected={on} className={on ? 'on' : ''} title={picture.filename} onClick={() => { choose({ kind: 'picture', media_id: picture.id }); setPictures(null); }}><img src={photoThumbUrl(picture.id)} alt={picture.filename}/></button>; })}
    </div>}
    {fill && text.karaoke && <p className="ed-tip">{t('Sung lyric lines keep their plain colour so the sung word can light up.')}</p>}
  </>;
}
