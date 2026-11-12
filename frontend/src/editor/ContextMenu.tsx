import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { Check, ChevronRight } from 'lucide-react';

/**
 * A right-click menu. An item can run an action, show a tick (`checked`) and stay open after it is chosen (`keepOpen`),
 * so several switches can be flipped in one go, or open a submenu. A submenu given as a function is built each time
 * the menu draws, so its ticks always show the current state.
 */
export type MenuAction = { label: string; hint?: string; danger?: boolean; disabled?: boolean; checked?: boolean; keepOpen?: boolean; onSelect: () => void };
export type MenuSubmenu = { label: string; disabled?: boolean; submenu: MenuItem[] | (() => MenuItem[]) };
export type MenuItem = MenuAction | MenuSubmenu | 'divider';
export type MenuState = { x: number; y: number; items: MenuItem[] };
const EDGE = 8;

export const isEditable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && !['range', 'checkbox', 'color', 'file'].includes((target as HTMLInputElement).type)));

const isSubmenu = (item: MenuItem): item is MenuSubmenu => item !== 'divider' && 'submenu' in item;

function Items({ items, onClose, openSub, setOpenSub, level }: { items: MenuItem[]; onClose: () => void; openSub: number | null; setOpenSub: (index: number | null) => void; level: number }) {
  return <>{items.map((item, index) => {
    if (item === 'divider') return <hr key={`divider-${index}`}/>;
    if (isSubmenu(item)) {
      const open = openSub === index;
      return <div key={item.label} className="ed-menu-parent" onPointerEnter={() => setOpenSub(index)}>
        <button role="menuitem" aria-haspopup="menu" aria-expanded={open} disabled={item.disabled} data-level={level} data-submenu={index}
          onClick={() => setOpenSub(open ? null : index)}><span>{t(item.label)}</span><ChevronRight size={13}/></button>
        {open && <SubMenu items={typeof item.submenu === 'function' ? item.submenu() : item.submenu} onClose={onClose} level={level + 1}/>}
      </div>;
    }
    const checkable = item.checked !== undefined;
    return <button key={item.label} role={checkable ? 'menuitemcheckbox' : 'menuitem'} aria-checked={checkable ? item.checked : undefined} className={`${item.danger ? 'danger' : ''} ${checkable ? 'checkable' : ''}`} disabled={item.disabled} data-level={level}
      onPointerEnter={() => level === 0 && setOpenSub(null)}
      onClick={() => { if (!item.keepOpen) onClose(); item.onSelect(); }}>
      {checkable && <span className="ed-menu-check" aria-hidden="true">{item.checked ? <Check size={13}/> : null}</span>}<span>{t(item.label)}</span>{item.hint && <kbd>{item.hint}</kbd>}
    </button>;
  })}</>;
}

function SubMenu({ items, onClose, level }: { items: MenuItem[]; onClose: () => void; level: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<{ left?: string; right?: string; top: number }>({ left: '100%', top: -4 });
  const [openSub, setOpenSub] = useState<number | null>(null);
  useLayoutEffect(() => {
    const rect = box.current!.getBoundingClientRect();
    const parent = box.current!.parentElement!.getBoundingClientRect();
    // Opens to the right, or to the left when there is no room; stays inside the window at the bottom.
    const flip = parent.right + rect.width + EDGE > window.innerWidth;
    const top = Math.min(-4, window.innerHeight - EDGE - parent.top - rect.height);
    setSide(flip ? { right: '100%', top } : { left: '100%', top });
  }, [items.length]);
  return <div ref={box} className="ed-menu ed-submenu" role="menu" style={{ ...side, position: 'absolute' }}>
    <Items items={items} onClose={onClose} openSub={openSub} setOpenSub={setOpenSub} level={level}/>
  </div>;
}

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [place, setPlace] = useState({ left: menu.x, top: menu.y });
  const [openSub, setOpenSub] = useState<number | null>(null);
  useLayoutEffect(() => {
    const rect = box.current!.getBoundingClientRect();
    setPlace({ left: Math.max(EDGE, Math.min(menu.x, window.innerWidth - rect.width - EDGE)), top: Math.max(EDGE, Math.min(menu.y, window.innerHeight - rect.height - EDGE)) });
    box.current!.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    setOpenSub(null);
  }, [menu.x, menu.y]);
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
    const current = document.activeElement as HTMLButtonElement | null;
    const level = current?.dataset.level ?? '0';
    // Up and down move within the menu the focus is in; right opens a submenu, left goes back to its parent item.
    const siblings = [...box.current!.querySelectorAll<HTMLButtonElement>(`button[data-level="${level}"]:not(:disabled)`)];
    const at = current ? siblings.indexOf(current) : -1;
    if (event.key === 'ArrowDown') siblings[(at + 1) % siblings.length]?.focus();
    else if (event.key === 'ArrowUp') siblings[(at - 1 + siblings.length) % siblings.length]?.focus();
    else if (event.key === 'ArrowRight' && current?.dataset.submenu !== undefined) {
      if (level === '0') setOpenSub(Number(current.dataset.submenu));
      setTimeout(() => current.parentElement?.querySelector<HTMLButtonElement>(`button[data-level="${Number(level) + 1}"]:not(:disabled)`)?.focus(), 0);
    } else if (event.key === 'ArrowLeft' && level !== '0') {
      current?.closest('.ed-submenu')?.parentElement?.querySelector<HTMLButtonElement>(':scope > button')?.focus();
    } else if (event.key === 'Escape') onClose();
    else if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Tab') { event.stopPropagation(); event.preventDefault(); return; }
    else return;
    event.preventDefault(); event.stopPropagation();
  };
  return <div ref={box} className="ed-menu" role="menu" style={place} onKeyDown={move} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
    <Items items={menu.items} onClose={onClose} openSub={openSub} setOpenSub={setOpenSub} level={0}/>
  </div>;
}
