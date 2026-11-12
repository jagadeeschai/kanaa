/** Pieces shared by the settings panels (moved from Editor.tsx unchanged). */
import { instancesPictureUrl } from '../../api/client';
import { t } from '../../i18n';
import { type LookName } from '../../timeline/animation';
import { clipEffects, removeEffect, toggleAllEffects, toggleEffect } from '../../timeline/effects';
import { undo } from '../../timeline/history';
import { type BlendMode, type BlurAmount, type Clip, type Corner, type CutoutPick, focusAt, focusLocal, timecode } from '../../timeline/model';
import { type Focus, type MovePreset } from '../../timeline/presets';
import { RAMPS, type RampName, type RampPoint, rampSpeed } from '../../timeline/ramp';
import { ValueSlider } from '../controls';
import { RailContext } from '../layout';
import { Chips, useFoundInClip } from './parts';
import { ChevronRight, Crosshair, Eye, EyeOff, Move, X } from 'lucide-react';
import { useContext, useState } from 'react';

export const MAX_FADE_SECONDS = 5;

export const BLENDS: { id: BlendMode; label: string }[] = [{ id: 'normal', label: 'Normal' }, { id: 'multiply', label: 'Multiply' }, { id: 'screen', label: 'Screen' }, { id: 'overlay', label: 'Overlay' }, { id: 'darken', label: 'Darken' }, { id: 'lighten', label: 'Lighten' }];

export const CORNERS: { id: Corner; label: string }[] = [{ id: 'top-left', label: 'Top left' }, { id: 'top-right', label: 'Top right' }, { id: 'bottom-left', label: 'Bottom left' }, { id: 'bottom-right', label: 'Bottom right' }];

export const EFFECT_INTENSITIES = [{ id: 'subtle', label: 'Subtle' }, { id: 'medium', label: 'Medium' }, { id: 'strong', label: 'Strong' }];

export const EFFECT_INTENSITY_VALUE: Record<string, number> = { subtle: 0.4, medium: 0.7, strong: 1 };

export const MOVES: { id: MovePreset; label: string; tip: string }[] = [{ id: 'push-in', label: 'Push in', tip: 'Slowly moves closer over the whole clip' }, { id: 'pull-out', label: 'Pull out', tip: 'Slowly moves away over the whole clip' },
  { id: 'punch-in', label: 'Punch in here', tip: 'Jumps closer at the playhead, for a word or a beat' }, { id: 'shake', label: 'Shake here', tip: 'A short camera shake at the playhead' }];

export const PULL_SPEEDS: { id: string; label: string }[] = [{ id: '0.4', label: 'Quick' }, { id: '1', label: 'Smooth' }, { id: '2', label: 'Slow' }];

export const BLUR_AMOUNTS: { id: BlurAmount; label: string }[] = [{ id: 'subtle', label: 'Subtle' }, { id: 'medium', label: 'Medium' }, { id: 'strong', label: 'Strong' }];

export const LOOK_NAMES: { id: LookName; label: string }[] = [{ id: 'none', label: 'Original' }, { id: 'warm', label: 'Warm' }, { id: 'cool', label: 'Cool' }, { id: 'vivid', label: 'Vivid' }, { id: 'film', label: 'Film' }, { id: 'mono', label: 'Mono' }];

/** What is active on this clip, each with a switch to compare with and without it, and Remove. */
export let effectsOpen = false;  // Whether the list of a clip's effects is unfolded; kept while moving between clips.

export function ActiveEffects({ clip, onChange }: { clip: Clip; onChange: (changes: Partial<Clip>) => void }) {
  const effects = clipEffects(clip);
  const [open, setOpen] = useState(effectsOpen);
  // A folded panel is only its tab rail: there is no room for the list.
  const folded = useContext(RailContext).folded;
  if (!effects.length || folded) return null;
  const allOff = effects.every((effect) => !effect.on);
  const on = effects.filter((effect) => effect.on).length;
  // One line until unfolded, so the settings below keep their room.
  return <section className={`ed-effects ${open ? 'open' : ''}`} aria-label="Active on this clip">
    <div className="ed-effects-head">
      <button className="ed-effects-toggle" aria-expanded={open} onClick={() => { effectsOpen = !open; setOpen(!open); }}><ChevronRight size={13}/>
        <span>{t('Effects')} ({on}/{effects.length})</span>{!open && <small>{effects.map((effect) => t(effect.label)).join(' · ')}</small>}</button>
      {open && effects.length > 1 && <button className="ed-link" onClick={() => onChange(toggleAllEffects(clip))}>{allOff ? t('All back on') : t('All off')}</button>}
    </div>
    {open && <ul>{effects.map((effect) => <li key={effect.id} className={effect.on ? '' : 'off'}>
      <button className="ed-effect-switch" role="switch" aria-checked={effect.on} aria-label={`${effect.label}: ${effect.on ? 'on' : 'off'}`} title={effect.on ? 'Turn off to compare; its settings are kept' : 'Turn back on'} onClick={() => onChange(toggleEffect(clip, effect.id))}>{effect.on ? <Eye size={13}/> : <EyeOff size={13}/>}</button>
      <span className="ed-effect-name"><b>{effect.label}</b><small>{effect.on ? effect.detail : `off · ${effect.detail}`}</small></span>
      <button className="ed-icon small" aria-label={`Remove ${effect.label}`} title="Remove it (undo brings it back)" onClick={() => onChange(removeEffect(clip, effect.id))}><X size={12}/></button>
    </li>)}</ul>}
  </section>;
}

export function WhoStays({ clip, onChange, local, sourceDuration }: { clip: Clip; onChange: (changes: Partial<Clip>) => void; local: number; sourceDuration?: number | null }) {
  const kind = clip.cutout_pick?.kind === 'objects' ? 'objects' : 'people';  // Never land: that cover has nothing to number.
  const ids = clip.cutout_pick?.ids ?? null;
  const { found, key, steady, backwards, tracks } = useFoundInClip(clip, kind);
  const everyone = kind === 'people' ? 'Everyone' : 'All of them';
  const blur = clip.cutout === 'blur';
  const toggle = (id: number) => {
    const chosen = ids ?? [];
    const next = chosen.includes(id) ? chosen.filter((other) => other !== id) : [...chosen, id];
    pick({ kind, ids: next.length ? next.sort((a, b) => a - b) : null });
  };
  const pick = (cutout_pick: CutoutPick | null) => onChange({ cutout_pick });
  const pull = blur ? clip.focus_pull ?? null : null;
  const pullTo = (id: number | null) => {
    if (!pull) return;
    if (id === null) { onChange({ focus_pull: { ...pull, to: null } }); return; }
    const chosen = pull.to ?? [];
    const next = chosen.includes(id) ? chosen.filter((other) => other !== id) : [...chosen, id];
    onChange({ focus_pull: { ...pull, to: next.length ? next.sort((a, b) => a - b) : null } });
  };
  const startPull = () => {
    const other = tracks?.find((track) => !ids?.includes(track.id));
    onChange({ focus_pull: { to: ids ? (other ? [other.id] : null) : tracks?.[1] ? [tracks[1].id] : null, at: focusAt(clip, local, sourceDuration), length: 1 } });
  };
  return <div className="ed-who">
    <span className="ed-who-title">{blur ? 'Who stays in focus' : 'Who stays in front'}</span>
    <Chips label="Find" options={[{ id: 'people' as const, label: 'People' }, { id: 'objects' as const, label: 'Objects' }]} value={kind} onPick={(next) => onChange({ cutout_pick: next === 'people' ? null : { kind: next, ids: null }, focus_pull: null })}/>
    {found.key === key && found.problem ? <p className="ed-tip">{found.problem}</p>
      : !tracks ? <p className="ed-tip">Finding each {kind === 'people' ? 'person' : 'object'}… {found.progress ? `${found.progress}%` : ''}</p>
      : !tracks.length ? <p className="ed-tip">{kind === 'people' ? 'No people were found in this clip.' : 'No objects stood out in this clip. Try drawing around it instead.'}</p>
      : <>
        <img className="ed-who-picture" src={`${instancesPictureUrl(clip.media_id, kind, steady, backwards)}&v=${tracks.map((track) => track.id).join('-')}`} alt={`The clip with each ${kind === 'people' ? 'person' : 'object'} numbered`}/>
        <div className="ed-chips" role="group" aria-label={blur ? 'Who stays in focus' : 'Who stays in front'}>
          <button className={ids ? '' : 'on'} aria-pressed={!ids} onClick={() => pick(kind === 'people' ? null : { kind, ids: null })}>{everyone}</button>
          {tracks.map((track) => <button key={track.id} className={ids?.includes(track.id) ? 'on' : ''} aria-pressed={Boolean(ids?.includes(track.id))} onClick={() => toggle(track.id)}><i className="ed-who-dot" style={{ background: track.colour }}/>{track.label}</button>)}
        </div>
        {tracks.length > 1 && <p className="ed-tip">{blur ? 'The ones you choose stay sharp; the rest blur with the background.' : 'The ones you choose stay in front of the title; the rest go behind it.'}</p>}
        {blur && tracks.length > 0 && (!pull ? <button className="ed-button wide" onClick={startPull} title="Part way through, the focus moves to someone else, like a film camera"><Crosshair size={14}/>Pull focus at the playhead</button>
          : <div className="ed-pull">
            <span className="ed-who-title">Then the focus moves to</span>
            <div className="ed-chips" role="group" aria-label="Focus moves to">
              <button className={pull.to ? '' : 'on'} aria-pressed={!pull.to} onClick={() => pullTo(null)}>{everyone}</button>
              {tracks.map((track) => <button key={track.id} className={pull.to?.includes(track.id) ? 'on' : ''} aria-pressed={Boolean(pull.to?.includes(track.id))} onClick={() => pullTo(track.id)}><i className="ed-who-dot" style={{ background: track.colour }}/>{track.label}</button>)}
            </div>
            <div className="ed-add-row"><span>At {timecode(Math.max(0, focusLocal(clip, pull.at, sourceDuration)))}</span><button className="ed-button" onClick={() => onChange({ focus_pull: { ...pull, at: focusAt(clip, local, sourceDuration) } })}>Move to playhead</button></div>
            <Chips label="Focus speed" options={PULL_SPEEDS} value={PULL_SPEEDS.find((speed) => Number(speed.id) === pull.length)?.id ?? null} onPick={(id) => onChange({ focus_pull: { ...pull, length: Number(id) } })}/>
            <button className="ed-button wide" onClick={() => onChange({ focus_pull: null })}><X size={14}/>Remove focus pull</button>
          </div>)}
      </>}
  </div>;
}

export function SoundControls({ item, length, onChange }: { item: { volume: number; fade_in: number; fade_out: number }; length: number; onChange: (changes: { volume?: number; fade_in?: number; fade_out?: number }, group?: string) => void }) {
  const longest = Math.min(MAX_FADE_SECONDS, length);
  return <>
    <ValueSlider label="Volume" value={item.volume} min={0} max={2} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(volume, group) => onChange({ volume }, group)}/>
    <ValueSlider label="Fade in" value={Math.min(item.fade_in, longest)} min={0} max={longest} step={0.1} defaultValue={0} unit="s" decimals={1} onChange={(fade_in, group) => onChange({ fade_in }, group)}/>
    <ValueSlider label="Fade out" value={Math.min(item.fade_out, longest)} min={0} max={longest} step={0.1} defaultValue={0} unit="s" decimals={1} onChange={(fade_out, group) => onChange({ fade_out }, group)}/>
  </>;
}

export const RAMP_CHOICES: { id: RampName | 'off'; label: string }[] = [{ id: 'off', label: 'Off' }, { id: 'hero', label: 'Hero' }, { id: 'bullet', label: 'Bullet' }, { id: 'montage', label: 'Montage' }, { id: 'speed-up', label: 'Speed up' }, { id: 'slow-down', label: 'Slow down' }];

/** Which preset a ramp is, if any. A split leaves each half with its own part of the curve, shown as none. */
export const rampName = (ramp?: RampPoint[] | null): RampName | 'off' | null => (!ramp ? 'off' : (Object.keys(RAMPS) as RampName[]).find((name) => JSON.stringify(RAMPS[name]) === JSON.stringify(ramp)) ?? null);

/** The ramp's speed through the clip, with the playhead on it. Higher is faster. */
export function RampCurve({ ramp, at }: { ramp: RampPoint[]; at: number }) {
  const samples = Array.from({ length: 61 }, (_, index) => rampSpeed(ramp, index / 60));
  const top = Math.max(...samples) * 1.1;
  const line = samples.map((value, index) => `${index === 0 ? 'M' : 'L'}${(index / 60) * 200},${56 - (value / top) * 52}`).join(' ');
  return <svg className="ed-ramp" viewBox="0 0 200 60" role="img" aria-label="Speed through the clip"><path d={`${line} L200,60 L0,60 Z`} className="fill"/><path d={line} className="line"/><line x1={at * 200} x2={at * 200} y1="0" y2="60" className="head"/></svg>;
}

