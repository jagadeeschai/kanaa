/** Pieces shared by the settings panels (moved from Editor.tsx unchanged). */
import { type FoundOne, instancesPictureUrl, requestInstances } from '../../api/client';
import { t } from '../../i18n';
import { type Animation, type Preset } from '../../timeline/animation';
import { KEEP_CLEAR_ROOM, type Room, roomOf } from '../../timeline/keepClear';
import { CINEMA_REVEALS, type CinemaReveal, type Clip, type CoverKind, type CutoutPick, type KeepClear, type TitleDesign, duration } from '../../timeline/model';
import { type FontChoice, TAMIL_FONTS } from '../../timeline/templates';
import { ValueSlider } from '../controls';
import { More } from '../layout';
import { Expand, Mountain, PenTool } from 'lucide-react';
import { useEffect, useState } from 'react';

export const ASSET_POLL_MS = 2000;

export const PRESETS: { id: Preset; label: string }[] = [{ id: 'fade', label: 'Fade' }, { id: 'slide-up', label: 'Slide up' }, { id: 'slide-down', label: 'Slide down' }, { id: 'slide-left', label: 'Slide left' }, { id: 'slide-right', label: 'Slide right' }, { id: 'zoom', label: 'Zoom' }, { id: 'pop', label: 'Pop' }, { id: 'blur', label: 'Blur' }, { id: 'bounce', label: 'Bounce' }, { id: 'ground-rise', label: 'Ground rise' }, { id: 'blast', label: 'Blast' }, { id: 'magic-form', label: 'Magic form' }, { id: 'magic-vanish', label: 'Magic vanish' }, { id: 'particle-form', label: 'Particle form' }];

// Picture tricks, for titles only: drawn in the title's own picture (PictureLook in animation.ts).
export const DESIGN_TIPS: Record<TitleDesign, string> = {
  gradient: 'A bar behind the words, fading out to the right. Backing colour (under More) sets it.',
  formal: 'A light bar across the frame with fine rules; the subtitle colour sets the rules.',
  overlap: 'The subtitle overlaps the end of the title, in the subtitle colour.',
  corners: 'The title in the top left corner, the subtitle in the bottom right.',
  clouds: 'A puffy cloud behind the words. Backing colour (under More) sets it.',
  paper: 'A torn strip of paper behind the words. Backing colour (under More) sets it.',
  torn: 'A band with a torn top edge across the frame. Backing colour: black, tan or your own.',
  organic: 'Curling vines either side of the words and a fine line beneath, in the subtitle colour.',
};

export const BACKED_DESIGNS = new Set<TitleDesign>(['gradient', 'formal', 'clouds', 'paper', 'torn']);

export const TITLE_PICTURE_PRESETS: { id: Preset; label: string }[] = [{ id: 'blur-sideways', label: 'Horizontal blur' }, { id: 'reveal', label: 'Reveal' }, { id: 'soft-edge', label: 'Soft edge' }, { id: 'line', label: 'Line' }, { id: 'chromatic', label: 'Chromatic' }, { id: 'prism', label: 'Prism' }, { id: 'echo', label: 'Echo' }, { id: 'pop-letters', label: 'Pop-up letters' }, { id: 'gravity', label: 'Gravity' }, { id: 'split', label: 'Split' }, { id: 'expand', label: 'Expand' }];

export const SIMPLE_TITLE_PRESETS = [...PRESETS.filter((preset) => preset.id !== 'ground-rise'), ...TITLE_PICTURE_PRESETS];

/** Who stays: everyone, or the people or objects chosen from a numbered picture of the clip. */
/** Each person (or object) found in a clip, numbered, found once in the background. */
export function useFoundInClip(clip: Clip | null, kind: 'people' | 'objects') {
  const steady = Boolean(clip?.stabilise); const backwards = Boolean(clip?.reverse) && clip?.freeze == null;
  const [found, setFound] = useState<{ key: string; tracks: FoundOne[] | null; progress: number; problem?: string }>({ key: '', tracks: null, progress: 0 });
  const key = clip ? `${clip.media_id}:${kind}:${steady}:${backwards}` : '';
  useEffect(() => {
    if (!clip) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const status = await requestInstances(clip.media_id, kind, steady, backwards);
        if (stopped) return;
        setFound({ key, tracks: status.status === 'ready' ? status.tracks ?? [] : null, progress: status.progress ?? 0 });
        if (status.status !== 'ready') timer = setTimeout(check, ASSET_POLL_MS);
      } catch (problem) { if (!stopped) setFound({ key, tracks: null, progress: 0, problem: (problem as Error).message }); }
    };
    void check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [key, clip?.media_id, kind, steady, backwards]);
  return { found, key, steady, backwards, tracks: found.key === key ? found.tracks : null };
}

export function Chips<T extends string>({ label, options, value, onPick }: { label: string; options: { id: T; label: string }[]; value: T | null; onPick: (id: T) => void }) {
  return <div className="ed-chips" role="group" aria-label={t(label)}>{options.map((option) => <button key={option.id} className={value === option.id ? 'on' : ''} aria-pressed={value === option.id} onClick={() => onPick(option.id)}>{t(option.label)}</button>)}</div>;
}

export function AnimationPicker({ label, value, onChange, onShow, presets = PRESETS }: { label: string; value?: Animation | null; onChange: (value: Animation | null, group?: string) => void; onShow: () => void; presets?: { id: Preset; label: string }[] }) {
  const pick = (id: Preset | 'none') => {
    onChange(id === 'none' ? null : { preset: id, duration: value?.duration ?? 0.5 });
    if (id !== 'none') setTimeout(onShow, 60);
  };
  return <>
    <h3 className="ed-sub">{label}</h3>
    <Chips label={label} options={[{ id: 'none' as const, label: 'None' }, ...presets]} value={value?.preset ?? 'none'} onPick={pick}/>
    {value && <ValueSlider label="Length" value={value.duration} min={0.1} max={3} step={0.1} defaultValue={0.5} unit="s" decimals={1} onChange={(duration, group) => onChange({ ...value, duration }, group)}/>}
  </>;
}

/** Bundled Tamil fonts load from Kanaa itself, so each button shows its font. English ones are already on the Mac. */
export let fontsLoaded = false;

export function loadBundledFonts() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  const rules = TAMIL_FONTS.filter((font) => font.file).map((font) => `@font-face{font-family:"${font.family}";src:url("/api/fonts/${font.file}") format("truetype");font-display:swap}`).join('');
  const style = document.createElement('style'); style.textContent = rules; document.head.appendChild(style);
}

export function FontPicker({ label, fonts, value, sample, onPick }: { label: string; fonts: FontChoice[]; value: string; sample: string; onPick: (family: string) => void }) {
  useEffect(loadBundledFonts, []);
  return <><h3 className="ed-sub">{t(label)}</h3><div className="ed-fonts" role="group" aria-label={t(label)}>{fonts.map((font) => <button key={font.family} className={value === font.family ? 'on' : ''} aria-pressed={value === font.family} title={font.label} onClick={() => onPick(font.family)}>
    <b style={{ fontFamily: `"${font.family}"` }}>{sample}</b><span>{font.label}</span></button>)}</div></>;
}

/** One tick box: people never cover the title. Then who (everyone, or numbered people), how much room and which way. Each pick applies at once. */
export function KeepClearPanel({ kept, under, busy, note, onRun, onRemove }: { kept: KeepClear | null; under: Clip | null; busy: number | null; note: string | null; onRun: (settings: Pick<KeepClear, 'gap' | 'direction' | 'max_move' | 'who'>) => void; onRemove: () => void }) {
  const room = roomOf(kept);
  const way = kept?.direction === 'left' || kept?.direction === 'right' ? 'side' : kept?.direction ?? 'auto';
  const who = kept?.who ?? null;
  const ids = who?.ids ?? null;
  const run = (nextRoom: Room, nextWay: KeepClear['direction'], nextWho: CutoutPick | null) => onRun({ gap: KEEP_CLEAR_ROOM[nextRoom].gap, max_move: KEEP_CLEAR_ROOM[nextRoom].max_move, direction: nextWay, who: nextWho });
  const on = Boolean(kept) || busy !== null;
  const { tracks, found, key, steady, backwards } = useFoundInClip(on ? under : null, 'people');
  const toggle = (id: number) => {
    const next = (ids ?? []).includes(id) ? (ids ?? []).filter((other) => other !== id) : [...(ids ?? []), id];
    run(room, kept?.direction ?? 'auto', next.length && next.length < (tracks?.length ?? 0) ? { kind: 'people', ids: next.sort((p, q) => p - q) } : null);
  };
  return <>
    <label className="ed-check"><input type="checkbox" checked={on} disabled={busy !== null} onChange={(event) => (event.target.checked ? run('comfortable', 'auto', null) : onRemove())}/>Don't let people cover the title</label>
    {busy !== null && <p className="ed-group-tip">Finding the people in this clip … {busy}%</p>}
    {kept && busy === null && <>
      <div className="ed-who">
        <span className="ed-who-title">Keep clear of</span>
        {found.key === key && found.problem ? <p className="ed-tip">{found.problem}</p>
          : !tracks ? <p className="ed-tip">Numbering the people… {found.progress ? `${found.progress}%` : ''}</p>
          : tracks.length > 1 ? <>
            <img className="ed-who-picture" src={`${instancesPictureUrl(under!.media_id, 'people', steady, backwards)}&v=${tracks.map((track) => track.id).join('-')}`} alt="The clip with each person numbered"/>
            <div className="ed-chips" role="group" aria-label="Keep clear of">
              <button className={ids ? '' : 'on'} aria-pressed={!ids} onClick={() => run(room, kept.direction, null)}>Everyone</button>
              {tracks.map((track) => <button key={track.id} className={ids?.includes(track.id) ? 'on' : ''} aria-pressed={Boolean(ids?.includes(track.id))} onClick={() => toggle(track.id)}><i className="ed-who-dot" style={{ background: track.colour }}/>{track.label}</button>)}
            </div>
          </> : <p className="ed-tip">{tracks.length ? 'One person in this clip.' : 'No people were found in this clip.'}</p>}
      </div>
      <p className="ed-sub">Space around them</p><Chips label="Space around them" options={(Object.keys(KEEP_CLEAR_ROOM) as Room[]).map((id) => ({ id, label: KEEP_CLEAR_ROOM[id].label }))} value={room} onPick={(id) => run(id, kept.direction, who)}/>
      <p className="ed-sub">Title moves</p><Chips label="Title moves" options={[{ id: 'auto', label: 'Best way' }, { id: 'up', label: 'Up' }, { id: 'down', label: 'Down' }, { id: 'side', label: 'Aside' }]} value={way} onPick={(id) => run(room, id as KeepClear['direction'], who)}/>
    </>}
    {note && busy === null && <p className="ed-group-tip">{note}</p>}
  </>;
}

/** The three cinema reveals, then who stays in front: one click makes the whole reveal. */
export type TitleCover = 'front' | 'people' | 'object' | 'land' | 'drawn' | null;

export function CinemaPicker({ initial, cover, shapingMode, onClear, onFront, onPick, onShape }: { initial: CinemaReveal | 'none'; cover: TitleCover; shapingMode: 'ground' | 'outline' | null; onClear: () => void; onFront: (reveal: CinemaReveal) => void; onPick: (reveal: CinemaReveal, what: CoverKind) => void; onShape: (reveal: CinemaReveal, mode: 'ground' | 'outline') => void }) {
  const [reveal, setReveal] = useState<CinemaReveal | 'none'>(initial);
  useEffect(() => { setReveal(initial); }, [initial]);
  const choose = (next: CinemaReveal | 'none') => { setReveal(next); if (next === 'none') onClear(); };
  const chosen = CINEMA_REVEALS.find((item) => item.id === reveal);
  const [drawing, setDrawing] = useState(cover === 'drawn');
  useEffect(() => { if (cover && cover !== 'drawn') setDrawing(false); }, [cover]);
  const front = drawing || cover === 'drawn' ? 'still' : cover === 'front' ? 'nothing' : cover ?? '';
  return <>
    <h3 className="ed-sub">1 · How it appears</h3>
    <Chips label="How it appears" options={[{ id: 'none' as const, label: 'Plain' }, ...CINEMA_REVEALS.map((item) => ({ id: item.id, label: item.label }))]} value={reveal} onPick={choose}/>
    {reveal === 'none' ? <p className="ed-group-tip">The title stays flat. Pick one above for a cinematic entrance.</p> : <>
      <p className="ed-group-tip">{chosen!.about} <span lang="ta">{chosen!.tamil}</span></p>
      <h3 className="ed-sub">2 · In front of the title</h3>
      <Chips label="In front of the title" options={[{ id: 'nothing', label: 'Nothing' }, { id: 'people', label: 'People' }, { id: 'object', label: 'An object' }, { id: 'land', label: 'Sky only' }, { id: 'still', label: 'Something still' }]} value={front}
        onPick={(id) => { setDrawing(id === 'still'); if (id === 'nothing') onFront(reveal); else if (id !== 'still') onPick(reveal, id === 'people' ? 'person' : id === 'land' ? 'land' : 'object'); }}/>
      {cover === 'land' && <p className="ed-group-tip">The title shows only in the sky. Land, buildings, trees and people stay in front, and it follows the horizon as the camera moves. <span lang="ta">வானத்தில் மட்டும்</span></p>}
      {(cover === 'people' || cover === 'object') && <p className="ed-group-tip">Found for you in every frame, as they move.</p>}
      {front === 'still' && <>
        <div className="ed-pair">
          <button className={`ed-button ${shapingMode === 'ground' ? 'on' : ''}`} onClick={() => onShape(reveal, 'ground')} title="Click the top edge of the ground, a mountain or a skyline"><Mountain size={14}/>Draw skyline</button>
          <button className={`ed-button ${shapingMode === 'outline' ? 'on' : ''}`} onClick={() => onShape(reveal, 'outline')} title="Click around anything still that stays in front"><PenTool size={14}/>Draw shape</button>
        </div>
        <p className="ed-group-tip">For things that don't move: a hill, a wall, a parked car.</p>
      </>}
    </>}
  </>;
}

