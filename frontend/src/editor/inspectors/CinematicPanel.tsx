/**
 * The Cinematic tab: every cinematic look for one clip in one place, without covering the preview. Each look is a card
 * in the order they stack (colour match, sky, night, rays, air, lens, slow motion, motion blur), with an on/off switch,
 * its presets and Fine-tune. Changes are a draft: a still preview at the playhead shows them in a second or two (hold
 * \ or the picture to see the original), and Apply looks makes them, all at once, through the stack (timeline/stack.ts).
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, LoaderCircle, Sparkles } from 'lucide-react';
import { photoThumbUrl, requestJson, waitForJob } from '../../api/client';
import { t } from '../../i18n';
import { ATMOSPHERE_PRESETS } from '../../timeline/atmosphere';
import { LENS_PRESETS } from '../../timeline/lens';
import { clipLength, mainLayer, type Clip } from '../../timeline/model';
import { BLUR_PRESETS } from '../../timeline/motionblur';
import { NIGHT_MOODS } from '../../timeline/night';
import { RAYS_PRESETS } from '../../timeline/rays';
import { SKY_CHOICES } from '../../timeline/sky';
import { SLOW_FACTORS } from '../../timeline/slowmo';
import { cannotLook, LOOK_ORDER, looksOf, originalPart, withLook, withoutLook, type Look, type LookKind, type Tune } from '../../timeline/stack';
import { openDirector } from '../DirectorDialog';
import { openMatch } from '../MatchDialog';
import { restyle } from '../looks';
import { EditorContext } from '../state/EditorContext';
import { TuneSection, type TuneLook } from '../TuneSection';

type Option = { id: string | number; label: string; about: string };
const CARDS: Record<LookKind, { title: string; about: string; tune?: TuneLook }> = {
  match: { title: 'Colour match', about: 'Take on the colour of another shot.', tune: 'match' },
  new_sky: { title: 'New sky', about: 'A new sky, the land relit to match.', tune: 'sky' },
  night: { title: 'Day for night', about: 'A believable night from a daytime shot.', tune: 'night' },
  rays: { title: 'God rays', about: 'Beams of light from the sun.', tune: 'rays' },
  atmosphere: { title: 'Atmosphere', about: 'Mist, haze or fog by distance.', tune: 'atmosphere' },
  lens: { title: 'Cinematic lens', about: 'Real depth of field.', tune: 'lens' },
  slowmo: { title: 'Smooth slow motion', about: 'New frames made between the clip’s own.' },
  blur: { title: 'Motion blur', about: 'The smear of a film camera on what moves.', tune: 'blur' },
};
const MOVING: LookKind[] = ['slowmo', 'blur'];

/** A look of `kind` with its first preset, to switch it on. */
function startLook(kind: LookKind, hero: Clip | undefined): Look | null {
  switch (kind) {
    case 'match': return hero ? { kind, reference: { media: hero.media_id, start: hero.in, end: hero.out } } : null;
    case 'new_sky': return { kind, sky: 'sunset' };
    case 'night': return { kind, mood: 'moonlit' };
    case 'rays': return { kind, preset: 'soft' };
    case 'atmosphere': return { kind, preset: 'mist', strength: 'medium' };
    case 'lens': return { kind, preset: 'portrait', strength: 'medium' };
    case 'slowmo': return { kind, factor: 2 };
    case 'blur': return { kind, preset: 'natural' };
  }
}

/** The preset choices a look's card shows, and how a choice changes the look. */
function choices(look: Look): { label: string; options: Option[]; value: string | number; set: (value: string | number) => Look }[] {
  const strengths = (ids: string[]) => ids.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), about: '' }));
  switch (look.kind) {
    case 'new_sky': return [{ label: 'Sky', options: SKY_CHOICES, value: look.sky, set: (value) => ({ ...look, sky: value as typeof look.sky }) }];
    case 'night': return [{ label: 'Mood', options: NIGHT_MOODS, value: look.mood, set: (value) => ({ ...look, mood: value as typeof look.mood }) }];
    case 'rays': return [{ label: 'Light', options: RAYS_PRESETS, value: look.preset, set: (value) => ({ ...look, preset: value as typeof look.preset }) }];
    case 'atmosphere': return [{ label: 'Air', options: ATMOSPHERE_PRESETS, value: look.preset, set: (value) => ({ ...look, preset: value as typeof look.preset }) },
      { label: 'How thick', options: strengths(['light', 'medium', 'heavy']), value: look.strength, set: (value) => ({ ...look, strength: value as typeof look.strength }) }];
    case 'lens': return [{ label: 'Lens', options: LENS_PRESETS, value: look.preset, set: (value) => ({ ...look, preset: value as typeof look.preset }) },
      { label: 'Blur', options: strengths(['soft', 'medium', 'strong']), value: look.strength, set: (value) => ({ ...look, strength: value as typeof look.strength }) }];
    case 'slowmo': return [{ label: 'Speed', options: SLOW_FACTORS, value: look.factor, set: (value) => ({ ...look, factor: value as typeof look.factor }) }];
    case 'blur': return [{ label: 'Shutter', options: BLUR_PRESETS, value: look.preset, set: (value) => ({ ...look, preset: value as typeof look.preset }) }];
    default: return [];
  }
}

/** The preset key the Fine-tune sliders start from. */
function tunePreset(look: Look): string {
  switch (look.kind) {
    case 'lens': case 'atmosphere': return `${look.preset}/${look.strength}`;
    case 'new_sky': return look.sky;
    case 'night': return look.mood;
    case 'rays': case 'blur': return look.preset;
    case 'match': return 'default';
    default: return '';
  }
}

const same = (a: Look[], b: Look[]) => JSON.stringify(a) === JSON.stringify(b);

export function CinematicPanel({ clip }: { clip: Clip }) {
  const store = useContext(EditorContext)!;
  const live = useRef(store);
  live.current = store;
  const applied = useMemo(() => looksOf(clip), [clip]);
  const [draft, setDraft] = useState<Look[]>(applied);
  useEffect(() => { setDraft(applied); }, [applied]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ before: string; after: string; not_shown: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [original, setOriginal] = useState(false);
  const part = originalPart(clip);
  const blocked = cannotLook(clip, 'atmosphere');
  const others = mainLayer(store.timeline!).items.filter((item) => item.id !== clip.id && item.freeze == null && !item.freeze3d);
  const local = Math.min(Math.max(0, store.now - clip.start), clipLength(clip));
  // The playhead within the original part (slow motion stretches the clip).
  const at = clip.slowmo ? local / clip.slowmo.factor : local;

  // The still preview follows the draft and the playhead, a moment after they settle.
  useEffect(() => {
    if (blocked) return;
    let live = true;
    const timer = setTimeout(() => {
      setPreviewing(true);
      void (async () => {
        try {
          const started = await requestJson<{ job_id: string }>('/api/look-preview', { method: 'POST', body: JSON.stringify({ media: part.media, start: part.start, end: part.end, at, looks: draft }) });
          const found = await waitForJob<{ before: string; after: string; not_shown: string[] }>(started.job_id);
          if (live) setPreview(found);
        } catch (problem) { if (live) setError((problem as Error).message); } finally { if (live) setPreviewing(false); }
      })();
    }, 600);
    return () => { live = false; clearTimeout(timer); };
  }, [JSON.stringify(draft), part.media, part.start, part.end, Math.round(at * 4)]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Hold \ to see the original.
  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.key === '\\' && !(event.target as HTMLElement)?.closest?.('input, textarea')) { event.preventDefault(); setOriginal(true); } };
    const up = (event: KeyboardEvent) => { if (event.key === '\\') setOriginal(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const toggle = (kind: LookKind, on: boolean) => {
    if (!on) { setDraft(withoutLook(draft, kind)); return; }
    const look = startLook(kind, others[0]);
    if (look) setDraft(withLook(draft, look));
  };
  const change = (look: Look) => setDraft(withLook(draft, look));
  const apply = async () => {
    setError(null); setBusy(0);
    try { await restyle(live.current, clip.id, draft, setBusy); } catch (problem) { setError((problem as Error).message); } finally { setBusy(null); }
  };
  const dirty = !same(draft, applied);
  if (blocked) return <p className="ed-tip">{t(blocked)}</p>;
  return <div className="ed-cinematic">
    <div className="ed-cinematic-preview" title={t('Hold to see the original (or hold \\)')}
      onPointerDown={() => setOriginal(true)} onPointerUp={() => setOriginal(false)} onPointerLeave={() => setOriginal(false)}>
      {preview ? <img src={original ? preview.before : preview.after} alt={t(original ? 'The original' : 'Preview of the looks')}/> : <div className="ed-cinematic-empty">{t('Preview at the playhead')}</div>}
      <span className="ed-cinematic-badge">{previewing ? <><LoaderCircle className="spin" size={11}/> {t('Updating…')}</> : original ? t('Original') : <><Eye size={11}/> {t('Hold to compare')}</>}</span>
    </div>
    {preview && preview.not_shown.length > 0 && <p className="ed-tip"><small>{t('Movement looks (slow motion, motion blur) show in the clip once applied, not in this still.')}</small></p>}
    <button className="ed-button wide" onClick={() => openDirector(clip.id)}><Sparkles size={13}/> {t('✨ Make it cinematic (AI)')}</button>
    {LOOK_ORDER.map((kind) => {
      const look = draft.find((each) => each.kind === kind);
      const card = CARDS[kind];
      if (kind === 'match' && !others.length && !look) return null;
      return <section key={kind} className={`ed-cinematic-card ${look ? 'on' : ''}`}>
        <label className="ed-check"><input type="checkbox" checked={Boolean(look)} disabled={busy !== null} onChange={(event) => toggle(kind, event.target.checked)}/>
          <span>{t(card.title)}<small>{t(card.about)}</small></span></label>
        {look && <>
          {look.kind === 'match' && <div className="ed-youtube-pictures ed-clone-takes" role="group" aria-label={t('Match to')}>
            {others.map((item) => { const on = look.reference.media === item.media_id && look.reference.start === item.in; return <button key={item.id} className={on ? 'on' : ''} aria-pressed={on} disabled={busy !== null}
              onClick={() => change({ ...look, reference: { media: item.media_id, start: item.in, end: item.out } })}><img src={photoThumbUrl(item.media_id)} alt=""/></button>; })}
          </div>}
          {choices(look).map((row) => <div key={row.label} className="ed-chips" role="group" aria-label={t(row.label)}>
            {row.options.map((option) => <button key={option.id} className={row.value === option.id ? 'on' : ''} aria-pressed={row.value === option.id} title={option.about ? t(option.about) : undefined}
              disabled={busy !== null} onClick={() => change(row.set(option.id))}>{t(option.label)}</button>)}</div>)}
          {card.tune && <TuneSection look={card.tune} preset={tunePreset(look)} tune={('tune' in look && look.tune) || {}} disabled={busy !== null}
            onChange={(tune: Tune) => change({ ...look, ...(Object.keys(tune).length ? { tune } : { tune: undefined }) } as Look)}/>}
          {MOVING.includes(kind) && <p className="ed-tip"><small>{t('Shows in the clip once applied.')}</small></p>}
        </>}
      </section>;
    })}
    {busy !== null && <p className="ed-tip" role="status"><LoaderCircle className="spin" size={13}/> {t('Making the looks…')} {busy ? `${Math.round(busy)}%` : ''}</p>}
    {error && <p className="ed-error" role="alert">{error}</p>}
    <div className="ed-pair">
      <button className="ed-button primary" disabled={!dirty || busy !== null} onClick={() => { void apply(); }}>{t('Apply looks')}</button>
      <button className="ed-button" disabled={!dirty || busy !== null} onClick={() => setDraft(applied)}>{t('Undo changes')}</button>
    </div>
    {others.length > 0 && <button className="ed-button wide" disabled={busy !== null} onClick={() => openMatch(clip.id, true)}>{t('Match the other clips to this one…')}</button>}
  </div>;
}
