import { type LutInfo, listLuts } from '../../api/client';
import ImportArea from '../../components/ImportArea';
import KanaaSelect from '../../components/KanaaSelect';
import { t } from '../../i18n';
import { BRAND_SIZES, brandClip, fadeBrand, moveBrand, resizeBrand } from '../../timeline/brand';
import { CINEMATIC_PRESETS, activeCinematicPreset, applyCinematicPreset, clearCinematicPreset } from '../../timeline/cinematic';
import { type Adjust, CINEMATIC, type Corner, FORMATS, type Finish, type Format, type Sound, type Timeline, audioLayers, barShare, duration, mainLayer, soundLength, timecode } from '../../timeline/model';
import { activeTheme } from '../../timeline/themes';
import { type Photo } from '../../types/photo';
import { ValueSlider } from '../controls';
import { Group, Panel, RailContext } from '../layout';
import { CORNERS } from './clip-parts';
import { Chips } from './parts';
import { BadgeCheck, Captions, Monitor, Music, Search, SlidersHorizontal, Volume2 } from 'lucide-react';
import { useContext, useEffect, useState } from 'react';
import { BrandIntroGroup, FRAME_RATES, RATE_TIPS } from './project-parts';

export function ProjectInspector({ introBusy, onBrandIntro, timeline, clipFormat, logos, logo, onBrand, onImported, onRemoveBrand, onChange, onPause, onThemes, onGuide }: { introBusy: number | null; onBrandIntro: (logo: Photo, tamil: string, english: string) => void; timeline: Timeline; clipFormat: Format | null; logos: Photo[]; logo: Photo | null; onBrand: (item: Photo) => void; onImported: (items: Photo[]) => void; onRemoveBrand: () => void; onChange: (next: Timeline, group?: string) => void; onPause: () => void; onThemes: () => void; onGuide: () => void }) {
  const format = timeline.format;
  const finish = timeline.finish ?? null;
  const brand = brandClip(timeline);
  const brandSource = logo ? { width: logo.width || 800, height: logo.height || 800 } : null;
  const nearSize = brand ? BRAND_SIZES.reduce((best, entry) => Math.abs(entry.scale - brand.transform.scale) < Math.abs(best.scale - brand.transform.scale) ? entry : best, BRAND_SIZES[1]).id : 'medium';
  const cinematicOn = Boolean(finish && (finish.grade || finish.glow || finish.vignette || finish.grain));
  const theme = activeTheme(timeline);
  const [luts, setLuts] = useState<LutInfo[]>([]);
  const [lutFolder, setLutFolder] = useState('');
  useEffect(() => { void listLuts().then((found) => { setLuts(found.luts); setLutFolder(found.folder); }).catch(() => setLuts([])); }, []);
  const ratio = (width: number, height: number) => { const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a); const d = gcd(width, height); return `${width / d}:${height / d}`; };
  const setFormat = (next: Partial<Format>) => onChange({ ...timeline, format: { ...format, ...next } });
  const setFinish = (next: Finish | null, group?: string) => onChange({ ...timeline, finish: next }, group);
  const part = (key: 'grade' | 'glow' | 'vignette' | 'grain', label: string) => <ValueSlider key={key} label={label} value={finish?.[key] ?? 0} min={0} max={1} step={0.05} defaultValue={CINEMATIC[key]} unit="%" factor={100}
    onGestureStart={onPause} onChange={(value, group) => setFinish({ ...(finish ?? { ...CINEMATIC, letterbox: false, grade: 0, glow: 0, vignette: 0, grain: 0 }), [key]: value }, group ?? `finish-${key}`)}/>;
  const shapes = [...FORMATS.map((item) => ({ id: item.id as string, label: item.label, width: item.width, height: item.height })), ...(clipFormat ? [{ id: 'clip', label: 'Same as my clip', width: Math.min(clipFormat.width, 3840), height: Math.min(clipFormat.height, 3840) }] : [])];
  return <>
    {!useContext(RailContext).folded && <div className="ed-project-head"><h2>Project settings</h2><span>{format.width} × {format.height} · {ratio(format.width, format.height)} · {format.fps} fps</span></div>}
    <Panel id="project" tabs={[{ id: 'format', label: 'Format', Icon: Monitor }, { id: 'look', label: 'Colour & finish', Icon: SlidersHorizontal, changed: Boolean(finish || theme || timeline.lut) }, { id: 'brand', label: 'Brand', Icon: BadgeCheck, changed: Boolean(brand) }, { id: 'sound', label: 'Sound', Icon: Volume2, changed: Boolean(timeline.normalize_audio) }]}>
      <Group title="Shape and size" tab="format" startOpen keywords="canvas aspect ratio resolution size vertical reels youtube square portrait" tip="Where will you post it? Clips refit to the new shape." help="project-settings">
        <div className="ed-shapes">{shapes.map((item) => { const on = item.width === format.width && item.height === format.height; return <button key={item.id} className={on ? 'on' : ''} aria-pressed={on} onClick={() => setFormat({ width: item.width, height: item.height })} title={`${item.width} × ${item.height}`}>
          <i style={{ aspectRatio: `${item.width} / ${item.height}` }}/><span><b>{item.label}</b><small>{ratio(item.width, item.height)} · {item.width} × {item.height}</small></span></button>; })}</div>
        <p className="ed-group-tip">Export can still make it 720p, 1080p or 4K; this sets the shape.</p>
      </Group>
      <Group pro title="Frame rate" tab="format" startOpen keywords="fps frame rate frames per second smooth 24 25 30 50 60" tip="How many pictures a second. Clips keep their timing when you change it." help="project-settings">
        <Chips label="Frame rate" options={FRAME_RATES.map((rate) => ({ id: String(rate), label: `${rate} fps` }))} value={String(format.fps)} onPick={(id) => setFormat({ fps: Number(id) })}/>
        <p className="ed-group-tip">{format.fps} fps: {RATE_TIPS[format.fps] ?? ''}.</p>
      </Group>
      <Group title="Theme" tab="look" startOpen keywords="theme look style wedding festival travel birthday" tip="One click dresses the whole video: colours, transitions, titles and music." help="themes">
        <div className="ed-add-row"><span>{theme ? <>Now: <b>{theme.label}</b></> : 'No theme'}</span><button className="ed-button" onClick={onThemes}>{theme ? 'Change theme' : 'Choose a theme'}</button></div>
      </Group>
      <Group title="Cinematic finish" tab="look" startOpen changed={cinematicOn || Boolean(finish?.letterbox)} keywords="cinematic film grade teal orange glow vignette grain preset bars letterbox widescreen 2.39 framing" tip="A film look over the whole video, and cinema bars if you want them." help="cinematic-finish">
        <h4 className="ed-finish-head">Look</h4>
        {(() => {
          const active = activeCinematicPreset(timeline);
          const custom = cinematicOn && !active;
          const bars = Boolean(finish?.letterbox);
          return <div className="ed-chips" role="group" aria-label="Cinematic look">
            <button className={!cinematicOn ? 'on' : ''} aria-pressed={!cinematicOn} title="No film look; your clips' own colours" onClick={() => onChange(clearCinematicPreset(timeline), 'cinematic-off')}>None</button>
            {CINEMATIC_PRESETS.map((preset) => { const on = active?.id === preset.id; return <button key={preset.id} className={on ? 'on' : ''} aria-pressed={on} title={preset.about}
              onClick={() => { if (on) return; const next = applyCinematicPreset(timeline, preset); onChange(bars ? { ...next, finish: { ...next.finish!, letterbox: true } } : next, `cinematic-${preset.id}`); }}>{preset.label}</button>; })}
            <button className={custom ? 'on' : ''} aria-pressed={custom} title="Teal and orange grade, glow, darker edges and grain, set by the sliders" onClick={() => { if (!custom) setFinish({ ...CINEMATIC, letterbox: bars }, 'cinematic-custom'); }}>Custom</button>
          </div>;
        })()}
        <p className="ed-group-tip">A preset sets the grade below and a colour look on every clip, on every video layer but the watermark; changing a slider makes it your own.</p>
        {cinematicOn && <>
          <h4 className="ed-finish-head">Adjust</h4>
          {part('grade', 'Teal and orange')}{part('glow', 'Glow')}{part('vignette', 'Dark edges')}{part('grain', 'Film grain')}
        </>}
        <h4 className="ed-finish-head">Frame</h4>
        {barShare(format) > 0 ? <label className="ed-check"><input type="checkbox" checked={Boolean(finish?.letterbox)} onChange={(event) => { const next = { ...(finish ?? { ...CINEMATIC, grade: 0, glow: 0, vignette: 0, grain: 0 }), letterbox: event.target.checked }; setFinish(event.target.checked || next.grade || next.glow || next.vignette || next.grain ? next : null); }}/><span>Widescreen bars<small>Black bars to the 2.39:1 cinema shape, with or without a look.</small></span></label>
          : <p className="ed-group-tip">Widescreen bars are for landscape and square projects.</p>}
      </Group>
      <Group title="Brand watermark" tab="brand" startOpen changed={Boolean(brand)} keywords="logo watermark brand mark corner badge" tip="Your logo stays over the whole video, preview and export alike. A PNG with a transparent background looks best." help="brand-watermark">
        {!brand ? <>
          <ImportArea compact onImported={onImported}/>
          <label className="ed-lut-field"><span>Logo</span><KanaaSelect aria-label="Choose a logo image" value="" onChange={(event) => { const item = logos.find((entry) => String(entry.id) === event.target.value); if (item) onBrand(item); }}>
            <option value="">{logos.length ? t('Choose a logo…') : t('No logos yet')}</option>{logos.map((item) => <option key={item.id} value={item.id}>{item.filename}</option>)}
          </KanaaSelect></label>
          <p className="ed-group-tip">{t('Import your logo above, or pick one from the Brand folder in Media.')}</p>
        </> : <>
          <div className="ed-add-row"><span>Now: <b>{logo?.filename ?? 'Logo'}</b></span><button className="ed-button small" onClick={onRemoveBrand}>Remove</button></div>
          {brand && brandSource && <>
            <Chips label="Corner" options={CORNERS} value={null} onPick={(corner) => onChange(moveBrand(timeline, brandSource, corner), 'brand-corner')}/>
            <Chips label="Size" options={BRAND_SIZES.map(({ id, label }) => ({ id, label }))} value={nearSize} onPick={(id) => onChange(resizeBrand(timeline, brandSource, BRAND_SIZES.find((entry) => entry.id === id)?.scale ?? 0.18), `brand-size-${id}`)}/>
            <ValueSlider label="Opacity" value={brand.transform.opacity} min={0.1} max={1} step={0.05} defaultValue={0.9} unit="%" factor={100} onGestureStart={onPause} onChange={(value, group) => onChange(fadeBrand(timeline, value), group ?? 'brand-opacity')}/>
          </>}
        </>}
      </Group>
      <BrandIntroGroup logos={logos} logo={logo} busy={introBusy} has={mainLayer(timeline).items.some((clip) => clip.id.startsWith('brand-intro'))} onMake={onBrandIntro}/>
      <Group pro title="LUT colour grade" tab="look" startOpen changed={Boolean(timeline.lut)} keywords="lut cube color colour grade pack cinematic wedding" tip="A professional colour lookup over the whole film. Captions stay unchanged." help="cinematic-finish">
        <label className="ed-lut-field"><span>LUT</span><KanaaSelect searchable searchPlaceholder={`Search ${luts.length || ''} LUTs…`} aria-label="Project LUT" value={timeline.lut ?? ''} onChange={(event) => onChange({ ...timeline, lut: event.target.value || null, lut_amount: timeline.lut_amount ?? 1 })}>
          <option value="">None</option>{luts.map((lut) => <option key={lut.id} value={lut.id}>{lut.name}</option>)}
        </KanaaSelect></label>
        {timeline.lut && <ValueSlider label="Intensity" value={timeline.lut_amount ?? 1} min={0} max={1} step={0.05} defaultValue={1} unit="%" factor={100} onGestureStart={onPause} onChange={(value, group) => onChange({ ...timeline, lut_amount: value }, group ?? 'project-lut')}/>}
        <p className="ed-group-tip">{luts.length ? `${luts.length} LUTs from ${lutFolder}. The source files stay read-only.` : `No .cube LUTs found in ${lutFolder || 'your LUT folder'}.`}</p>
      </Group>
      <Group title="Loudness" tab="sound" startOpen changed={Boolean(timeline.normalize_audio)} keywords="loudness normalize volume level even out audio" tip="Makes the whole video as loud as social apps expect." help="music-volume-ducking">
        {(() => {
          const ends = audioLayers(timeline).flatMap((layer) => layer.items.filter((sound) => !sound.muted).map((sound) => sound.start + soundLength(sound)));
          if (!ends.length) return null;
          const silentTail = Math.max(0, duration(timeline) - Math.max(...ends));
          return silentTail > 1
            ? <p className="ed-tip" role="status">Music stops at {timecode(Math.max(...ends))}; the last {silentTail >= 10 ? `${Math.round(silentTail)}s` : `${silentTail.toFixed(1)}s`} have no music. Select the song and use Loop to the end in its panel.</p>
            : <p className="ed-tip">Music covers the whole video.</p>;
        })()}
        <label className="ed-check"><input type="checkbox" checked={Boolean(timeline.normalize_audio)} onChange={(event) => onChange({ ...timeline, normalize_audio: event.target.checked })}/><span>Even out loudness<small>Applied when you export.</small></span></label>
      </Group>
    </Panel>
    {void onGuide}
  </>;
}
