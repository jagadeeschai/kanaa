/**
 * Cinematic bars, adjustable: a shape in one click (Cinema 2.39, Film 1.85, 2:1, Classic 4:3 at the sides, Square), a
 * Bar size slider for anything between, and the bars' colour. Off takes them away. Preview and export draw the same.
 */
import { t } from '../../i18n';
import { barShares, CINEMATIC, type Finish, type Format } from '../../timeline/model';
import { ValueSlider } from '../controls';

const SHAPES: { ratio: number; label: string; tip: string }[] = [
  { ratio: 2.39, label: 'Cinema 2.39', tip: 'The widescreen cinema shape' }, { ratio: 1.85, label: 'Film 1.85', tip: 'Thinner bars, the usual film shape' },
  { ratio: 2, label: '2:1', tip: 'Between film and cinema' }, { ratio: 4 / 3, label: 'Classic 4:3', tip: 'Old TV: bars at the sides' }, { ratio: 1, label: 'Square', tip: 'A square picture in the middle' },
];
const COLOURS = [['#000000', 'Black'], ['#ffffff', 'White']] as const;

export function BarsPicker({ finish, format, onChange }: { finish: Finish | null; format: Format; onChange: (next: Finish | null, group?: string) => void }) {
  const base: Finish = finish ?? { ...CINEMATIC, letterbox: false, grade: 0, glow: 0, vignette: 0, grain: 0 };
  const aspect = format.width / format.height;
  const on = Boolean(finish?.letterbox);
  const ratio = finish?.bars_ratio ?? (aspect >= 1 ? 2.39 : 1);
  const [side, top] = on ? barShares(format, ratio) : [0, 0];
  const set = (changes: Partial<Finish>, group?: string) => {
    const next = { ...base, ...changes };
    onChange(next.letterbox || next.grade || next.glow || next.vignette || next.grain ? next : null, group);
  };
  // The slider is the bars' size; it is kept as the shape between them, so it stays right if the frame changes.
  const size = Math.max(side, top);
  const sideways = side > 0 || (!on && aspect > ratio);
  const fromSize = (share: number) => sideways ? aspect * (1 - 2 * share) : aspect / (1 - 2 * share);
  const colour = finish?.bars_colour ?? '#000000';
  return <>
    <span className="ed-who-title">{t('Cinematic bars')}</span>
    <div className="ed-chips" role="group" aria-label={t('Cinematic bars')}>
      <button className={!on ? 'on' : undefined} aria-pressed={!on} onClick={() => set({ letterbox: false })}>{t('Off')}</button>
      {SHAPES.filter((shape) => Math.abs(shape.ratio - aspect) > 0.02).map((shape) => { const chosen = on && Math.abs(ratio - shape.ratio) < 0.005; return <button key={shape.label} className={chosen ? 'on' : undefined} aria-pressed={chosen} title={t(shape.tip)} onClick={() => set({ letterbox: true, bars_ratio: shape.ratio })}>{t(shape.label)}</button>; })}
    </div>
    {on && <>
      <ValueSlider label={t('Bar size')} value={size} min={0.01} max={0.4} step={0.005} defaultValue={barShares(format, aspect >= 1 ? 2.39 : 1).reduce((a, b) => Math.max(a, b))} unit="%" factor={100}
        onChange={(share, group) => set({ letterbox: true, bars_ratio: Math.round(fromSize(share) * 10000) / 10000 }, group ?? 'bars-size')}/>
      <div className="ed-add-row"><span>{t('Bar colour')}</span><div className="ed-chips" role="group" aria-label={t('Bar colour')}>
        {COLOURS.map(([value, label]) => <button key={value} className={colour === value ? 'on' : undefined} aria-pressed={colour === value} onClick={() => set({ bars_colour: value })}>{t(label)}</button>)}
        <label className={`ed-swatch ed-swatch-own ${COLOURS.some(([value]) => value === colour) ? '' : 'on'}`} style={{ background: colour, width: 22, height: 22 }} title={t('Any colour')}><input type="color" aria-label={t('Any colour')} value={colour} onChange={(event) => set({ bars_colour: event.target.value }, 'bars-colour')}/></label>
      </div></div>
    </>}
  </>;
}
