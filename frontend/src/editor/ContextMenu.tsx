import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type MenuItem = { label: string; hint?: string; danger?: boolean; disabled?: boolean; onSelect: () => void } | 'divider';
export type MenuState = { x: number; y: number; items: MenuItem[] };
const EDGE = 8;

export const isEditable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && !['range', 'checkbox', 'color', 'file'].includes((target as HTMLInputElement).type)));

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [place, setPlace] = useState({ left: menu.x, top: menu.y });
  useLayoutEffect(() => {
    const rect = box.current!.getBoundingClientRect();
    setPlace({ left: Math.max(EDGE, Math.min(menu.x, window.innerWidth - rect.width - EDGE)), top: Math.max(EDGE, Math.min(menu.y, window.innerHeight - rect.height - EDGE)) });
    box.current!.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [menu]);
  useEffect(() => {
    const close = (event: Event) => { if (!box.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('blur', onClose);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('wheel', close, true); window.removeEventListener('blur', onClose); };
  }, [onClose]);
  useEffect(() => () => {
    const target = returnFocus.current;
    setTimeout(() => { if (target?.isConnected && (document.activeElement === document.body || !document.activeElement)) target.focus(); }, 0);
  }, []);
  const move = (event: React.KeyboardEvent) => {
    const buttons = [...box.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') buttons[(at + 1) % buttons.length]?.focus();
    else if (event.key === 'ArrowUp') buttons[(at - 1 + buttons.length) % buttons.length]?.focus();
    else if (event.key === 'Escape') onClose();
    else if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Tab') { event.stopPropagation(); event.preventDefault(); return; }
    else return;
    event.preventDefault(); event.stopPropagation();
  };
  return <div ref={box} className="ed-menu" role="menu" style={place} onKeyDown={move} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
    {menu.items.map((item, index) => (item === 'divider' ? <hr key={index}/> : <button key={item.label} role="menuitem" className={item.danger ? 'danger' : ''} disabled={item.disabled} onClick={() => { onClose(); item.onSelect(); }}><span>{item.label}</span>{item.hint && <kbd>{item.hint}</kbd>}</button>))}
  </div>;
}
