import { Children, isValidElement, useEffect, useId, useRef, useState, type ChangeEvent, type ReactElement, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Check, ChevronDown } from 'lucide-react';

type Option = ReactElement<{ value?: string; children?: ReactNode; disabled?: boolean }>;
type Props = SelectHTMLAttributes<HTMLSelectElement> & { searchable?: boolean; searchPlaceholder?: string };

export default function KanaaSelect({ children, className = '', disabled, onChange, value, style, searchable = false, searchPlaceholder = 'Find an option', 'aria-label': ariaLabel }: Props) {
  const options = Children.toArray(children).filter((child): child is Option => isValidElement(child) && child.type === 'option');
  const selected = options.find((option) => String(option.props.value ?? '') === String(value ?? '')) ?? options[0];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const shown = searchable && query ? options.filter((option) => String(option.props.children ?? '').toLowerCase().includes(query.toLowerCase())) : options;
  const [focus, setFocus] = useState(Math.max(0, options.indexOf(selected)));
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const choose = (option: Option) => {
    if (option.props.disabled) return;
    const next = String(option.props.value ?? '');
    onChange?.({ target: { value: next }, currentTarget: { value: next } } as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  };
  const move = (amount: number) => {
    if (!shown.length) return;
    let next = focus;
    do next = (next + amount + shown.length) % shown.length; while (shown[next]?.props.disabled && next !== focus);
    setFocus(next);
  };

  return <div ref={root} className={`kanaa-select ${className}`} style={style}>
    <button type="button" className="kanaa-select-trigger" role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={listId} disabled={disabled}
      onClick={() => { setQuery(''); setFocus(Math.max(0, options.indexOf(selected))); setOpen((current) => !current); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { setOpen(false); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open) { setOpen(true); setFocus(Math.max(0, options.indexOf(selected))); } else move(event.key === 'ArrowDown' ? 1 : -1); }
        if ((event.key === 'Enter' || event.key === ' ') && open && shown[focus]) { event.preventDefault(); choose(shown[focus]); }
      }}>
      <span>{selected?.props.children}</span><ChevronDown size={15} aria-hidden="true"/>
    </button>
    {open && <div id={listId} className="kanaa-select-menu" role="listbox" aria-label={ariaLabel}>
      {searchable && <div className="kanaa-select-search"><input autoFocus aria-label={`Search ${ariaLabel ?? 'options'}`} placeholder={searchPlaceholder} value={query} onChange={(event) => { setQuery(event.target.value); setFocus(0); }}/></div>}
      {shown.map((option, index) => {
        const optionValue = String(option.props.value ?? '');
        const active = optionValue === String(value ?? '');
        return <button key={optionValue || index} type="button" role="option" aria-selected={active} disabled={option.props.disabled} className={`${active ? 'selected' : ''} ${focus === index ? 'focused' : ''}`}
          onPointerMove={() => setFocus(index)} onClick={() => choose(option)}><span>{option.props.children}</span>{active && <Check size={15} aria-hidden="true"/>}</button>;
      })}
      {!shown.length && <p className="kanaa-select-empty">No matching folders</p>}
    </div>}
  </div>;
}
