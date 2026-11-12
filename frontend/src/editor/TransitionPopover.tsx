import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Play, Shuffle, Trash2, X } from 'lucide-react';
import { ValueSlider } from './controls';
import { TRANSITION_GROUPS, TRANSITION_ICONS, transitionLabel, transitionShortLabel } from './transition-catalog';
import type { Transition, TransitionDirection, TransitionKind } from '../timeline/animation';

/** A picture for one side of the cut: a filmstrip sprite and which tile to show, or nothing yet. */
export type CutPicture = { image: string; tiles: number; tile: number } | null;

type Props = {
  /** The transition at this cut, or null for a plain cut. */
  transition: Transition | null;
  /** The badge the popover hangs from, in viewport pixels. */
  anchor: DOMRect;
  before: CutPicture; after: CutPicture;
  /** The longest this cut allows (half of the shorter clip either side). */
  longest: number;
  locked: boolean;
  onPick: (kind: TransitionKind) => void;
  onLength: (seconds: number, group?: string) => void;
  onDirection: (direction: TransitionDirection) => void;
  /** The colour a dip or flash passes through. */
  onColour?: (color: string | null) => void;
  onRemove: () => void;
  onEveryCut: () => void;
  onPreview: () => void;
  onGestureStart: () => void;
  onClose: () => void;
};

const QUICK_LENGTHS = [0.3, 0.6, 1, 1.5];
const DIRECTIONS: { id: TransitionDirection; label: string; Icon: typeof ArrowLeft }[] = [
  { id: 'left', label: 'Left', Icon: ArrowLeft }, { id: 'right', label: 'Right', Icon: ArrowRight }, { id: 'up', label: 'Up', Icon: ArrowUp }, { id: 'down', label: 'Down', Icon: ArrowDown }];
const WIDTH = 452; const GAP = 10; const MARGIN = 8;

/**
 * Hangs from a transition badge on the timeline: the two pictures either side of the cut, every transition in groups,
 * its length and direction, and preview, every cut and remove. Escape or a click outside closes it.
 */
export default function TransitionPopover({ transition, anchor: start, before, after, longest, locked, onPick, onLength, onDirection, onColour, onRemove, onEveryCut, onPreview, onGestureStart, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; below: boolean } | null>(null);
  // Where the badge is now: it moves when the timeline scrolls (by hand, or following the playhead in Preview).
  const [anchor, setAnchor] = useState(start);
  useEffect(() => setAnchor(start), [start]);
  useLayoutEffect(() => {
    const height = box.current?.offsetHeight ?? 420;
    const below = anchor.top - height - GAP < MARGIN;
    const top = below ? Math.min(anchor.bottom + GAP, window.innerHeight - height - MARGIN) : anchor.top - height - GAP;
    const left = Math.min(Math.max(anchor.left + anchor.width / 2 - WIDTH / 2, MARGIN), window.innerWidth - WIDTH - MARGIN);
    setPlace({ left, top: Math.max(MARGIN, top), below });
  }, [anchor, transition?.kind]);
  useEffect(() => {
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node) && !(event.target as Element).closest?.('.tl-cut')) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    const moved = (event: Event) => {
      if (event.target instanceof Node && box.current?.contains(event.target)) return;
      const badge = document.querySelector('.tl-cut.open');
      if (badge) setAnchor(badge.getBoundingClientRect()); else onClose();
    };
    window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', key, true);
    window.addEventListener('resize', moved); window.addEventListener('scroll', moved, true);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); window.removeEventListener('resize', moved); window.removeEventListener('scroll', moved, true); };
  }, [onClose]);
  useEffect(() => { box.current?.querySelector<HTMLElement>('.tp-kind.on, .tp-kind')?.focus({ preventScroll: true }); }, []);

  const kind = transition?.kind ?? null;
  const directional = kind === 'wipe' || kind === 'slide';
  const arrow = place && anchor.left + anchor.width / 2 - place.left;
  return <div ref={box} className={`tp ${place?.below ? 'below' : ''}`} role="dialog" aria-label={kind ? `${transitionLabel(kind)} transition` : 'Add a transition'}
    style={{ width: WIDTH, left: place?.left ?? -9999, top: place?.top ?? -9999, '--arrow': `${arrow ?? WIDTH / 2}px` } as React.CSSProperties}
    onKeyDown={(event) => event.stopPropagation()}>
    <header className="tp-head">
      <Thumb picture={before} label="End of the clip before"/>
      <span className={`tp-join ${kind ? 'on' : ''}`} aria-hidden>{kind ? TRANSITION_ICONS[kind] : <span className="tp-cut"/>}</span>
      <Thumb picture={after} label="Start of the clip after"/>
      <div className="tp-title"><b>{kind ? transitionLabel(kind) : 'Plain cut'}</b><small>{kind ? `${Number(transition!.duration.toFixed(2))} s${directional ? ` · ${transition!.direction ?? 'left'}` : ''}` : 'Pick a transition below'}</small></div>
      <button className="ed-icon small tp-close" aria-label="Close" onClick={onClose}><X size={14}/></button>
    </header>
    {locked && <p className="tp-note">The main track is locked. Unlock it to change transitions.</p>}
    <div className="tp-groups" role="listbox" aria-label="Transitions">
      {TRANSITION_GROUPS.map((group) => <section key={group.label} className="tp-group">
        <h4>{group.label}</h4>
        <div className="tp-grid">{group.kinds.map((id) => <button key={id} role="option" aria-selected={kind === id} className={`tp-kind ${kind === id ? 'on' : ''}`} disabled={locked}
          onClick={() => onPick(id)} title={transitionLabel(id)} aria-label={transitionLabel(id)}>{TRANSITION_ICONS[id]}<span>{transitionShortLabel(id)}</span></button>)}</div>
      </section>)}
    </div>
    {transition && <div className="tp-settings">
      <ValueSlider label="Length" value={transition.duration} min={0.2} max={Math.max(0.2, Math.min(2, longest))} step={0.05} defaultValue={Math.min(0.6, longest)} unit="s" decimals={2}
        onGestureStart={onGestureStart} onChange={onLength}/>
      <div className="tp-quick" role="group" aria-label="Quick lengths">{QUICK_LENGTHS.filter((seconds) => seconds <= longest + 1e-6).map((seconds) =>
        <button key={seconds} className={Math.abs(transition.duration - seconds) < 0.01 ? 'on' : ''} disabled={locked} onClick={() => { onGestureStart(); onLength(seconds); }}>{seconds} s</button>)}</div>
      {(kind === 'dip' || kind === 'flash') && onColour && <div className="tp-direction" role="group" aria-label="Fade colour"><span>Through</span>
        {([['#000000', 'Black'], ['#ffffff', 'White']] as const).map(([hex, label]) => <button key={hex} className={`ed-icon small tp-swatch ${(transition!.color ?? (kind === 'flash' ? '#ffffff' : '#000000')).toLowerCase() === hex ? 'on' : ''}`} aria-label={label} title={label} disabled={locked} style={{ background: hex }} onClick={() => onColour(hex)}/>)}
        <label className="tp-colour" title="Any colour"><input type="color" aria-label="Fade colour" disabled={locked} value={transition!.color ?? (kind === 'flash' ? '#ffffff' : '#000000')} onChange={(event) => onColour(event.target.value)}/></label>
      </div>}
      {directional && <div className="tp-direction" role="group" aria-label="Direction"><span>Direction</span>
        {DIRECTIONS.map(({ id, label, Icon }) => <button key={id} className={`ed-icon small ${(transition.direction ?? 'left') === id ? 'on' : ''}`} aria-label={label} aria-pressed={(transition.direction ?? 'left') === id} title={label} disabled={locked} onClick={() => onDirection(id)}><Icon size={14}/></button>)}</div>}
    </div>}
    <footer className="tp-foot">
      <button className="ed-button" onClick={onPreview}><Play size={13}/>Preview</button>
      {transition && <button className="ed-button" disabled={locked} onClick={onEveryCut} title={`Put ${transitionLabel(transition.kind)} on every cut`}><Shuffle size={13}/>Every cut</button>}
      {transition && <button className="ed-button danger" disabled={locked} onClick={onRemove}><Trash2 size={13}/>Remove</button>}
    </footer>
  </div>;
}

function Thumb({ picture, label }: { picture: CutPicture; label: string }) {
  if (!picture) return <span className="tp-thumb empty" aria-label={label} role="img"/>;
  const share = picture.tiles > 1 ? (picture.tile / (picture.tiles - 1)) * 100 : 0;
  return <span className="tp-thumb" role="img" aria-label={label} style={{ backgroundImage: `url(${picture.image})`, backgroundSize: `${picture.tiles * 100}% 100%`, backgroundPosition: `${share}% 0` }}/>;
}
