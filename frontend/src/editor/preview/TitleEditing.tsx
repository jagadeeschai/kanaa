import { useEffect, useRef } from 'react';
import { Type } from 'lucide-react';
import type { TextItem } from '../../timeline/model';
import { TAMIL_FONTS } from '../../timeline/templates';
import { t } from '../../i18n';

/**
 * Typing into a title where it sits in the preview. Tamil typing is safe: Enter only finishes once the keyboard has
 * finished composing a letter. Enter keeps the words (Shift+Enter starts a new line), Esc puts them back, leaving keeps them.
 */
export function TitleEditBox({ text, style, onDone }: { text: TextItem; style: React.CSSProperties; onDone: (words: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const done = useRef(false);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.innerText = text.text;
    box.focus();
    const range = document.createRange(); range.selectNodeContents(box);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  const finish = (words: string | null) => { if (done.current) return; done.current = true; onDone(words); };
  const lines = Math.max(1, text.text.split('\n').length);
  return <div ref={ref} className="ed-title-edit" style={{ ...style, fontFamily: `"${text.tamil_font ?? 'Noto Sans Tamil'}", "${text.font ?? 'Noto Sans'}", sans-serif`, textAlign: text.align ?? 'center', '--lines': lines } as React.CSSProperties}
    contentEditable="plaintext-only" suppressContentEditableWarning lang="ta" role="textbox" aria-label="Title words" aria-multiline="true"
    onPointerDown={(event) => event.stopPropagation()}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); finish(null); return; }
      if (event.key === 'Enter' && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing) { event.preventDefault(); finish(ref.current?.innerText.replace(/\n+$/, '') ?? null); }
    }}
    onBlur={() => finish(ref.current?.innerText.replace(/\n+$/, '') ?? null)}/>;
}

/** The selected title's most-used settings, right above it in the preview. */
export function TitleToolbar({ text, top, left, onChange, onEdit }: { text: TextItem; top: number; left: number; onChange: (changes: Partial<TextItem>, group?: string) => void; onEdit: () => void }) {
  return <div className="ed-title-toolbar" style={{ left: `clamp(150px, ${left * 100}%, calc(100% - 150px))`, top: `max(4px, calc(${top * 100}% - 40px))` }} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
    <button onClick={onEdit} title={t('Type')} aria-label={t('Type')}><Type size={14}/></button>
    <span className="ed-tt-sep"/>
    <button onClick={() => onChange({ size: Math.max(20, text.size - 2) }, `size-${text.id}`)} title={t('Smaller')} aria-label={t('Smaller')}>A−</button>
    <b className="ed-tt-size">{Math.round(text.size)}</b>
    <button onClick={() => onChange({ size: Math.min(100, text.size + 2) }, `size-${text.id}`)} title={t('Bigger')} aria-label={t('Bigger')}>A+</button>
    <label className="ed-tt-colour" title={t('Colour')}><input type="color" aria-label={t('Text colour')} value={text.color} onChange={(event) => onChange({ color: event.target.value }, `color-${text.id}`)}/><i style={{ background: text.color }}/></label>
    <select aria-label={t('Tamil font')} title={t('Tamil font')} value={text.tamil_font ?? 'Noto Sans Tamil'} onChange={(event) => onChange({ tamil_font: event.target.value === 'Noto Sans Tamil' ? null : event.target.value })}>{TAMIL_FONTS.map((font) => <option key={font.family} value={font.family}>{font.label}</option>)}</select>
    <span className="ed-tt-sep"/>
    {(['band', 'shadow', 'outline'] as const).map((style) => <button key={style} className={text.style === style ? 'on' : ''} aria-pressed={text.style === style} onClick={() => onChange({ style })} title={t(style === 'band' ? 'Band' : style === 'shadow' ? 'Shadow' : 'Outline')}>{style === 'band' ? '▬' : style === 'shadow' ? 'S' : 'O'}</button>)}
  </div>;
}

