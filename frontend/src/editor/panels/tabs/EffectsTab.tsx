import { Check,EyeOff,LoaderCircle,Minus,Plus,ScanFace,Search,Shuffle,WandSparkles,X } from "lucide-react";
import { cancelRenderJob } from "../../../api/client";
import { t } from "../../../i18n";
import { ValueSlider } from "../../controls";
import { Chips } from "../../inspectors/parts";
import { useEditorPanel } from "../../state/EditorContext";
import type { EditorLeftRailBindings } from '../EditorLeftRail';
import { SubTabs, useSubTab } from './SubTabs';

export function EffectsTabSection1() {
  const { leftTab, effectSearch, setEffectSearch } = useEditorPanel<EditorLeftRailBindings>('left');
  return (<>{leftTab === 'effects' && <div className="ed-effect-search"><Search size={14}/><input type="search" value={effectSearch} onChange={(event) => setEffectSearch(event.target.value)} placeholder="Search effects…" aria-label="Search effects"/>{effectSearch && <button className="ed-icon small" aria-label="Clear effect search" onClick={() => setEffectSearch('')}><X size={12}/></button>}</div>}</>);
}

export function EffectsTabSection2() {
  const { leftTab, selected, activeClipEffects, matchingClipEffects, effectNeedle, effectSection, setEffectSection, clipEffectApplied, draggableAs, applyClipEffect } = useEditorPanel<EditorLeftRailBindings>('left');
  return (<>{leftTab === 'effects' && <section className="ed-add ed-clip-effect-browser" aria-label="Clip effects">
          <div className="ed-effect-browser-head"><div><h3>Apply to selected clip</h3><p>Changes the clip itself. Fine-tune it in Settings on the right.</p></div>{selected && <span className="ed-selected-pill">{activeClipEffects.length ? `${activeClipEffects.length} applied` : 'Clip selected'}</span>}</div>
          {!selected && <div className="ed-effect-empty"><b>Select a clip first</b><span>Click a photo or video on the timeline, then apply an effect here.</span></div>}
          {(['Stylise', 'Motion', 'Shape', 'Film', 'Signal', 'Lens'] as const).map((group) => { const matches = matchingClipEffects.filter((preset) => preset.group === group); if (!matches.length) return null; const section = `clip-${group}`; const open = Boolean(effectNeedle) || effectSection === section; return <div key={group} className="ed-effect-category">
            <button className="ed-effect-category-head" aria-expanded={open} onClick={() => { if (!effectNeedle) setEffectSection(open ? null : section); }}><span><b>{group}</b><small>{matches.map((preset) => preset.label).join(' · ')}</small></span>{open ? <Minus size={14}/> : <Plus size={14}/>}</button>
            {open && <div className="ed-clip-effect-grid">{matches.map((preset) => { const applied = clipEffectApplied(preset.id); return <button key={preset.id} className={`ed-clip-effect-card fx-clip-${preset.id} ${applied ? 'on' : ''}`} {...draggableAs({ kind: 'clip_effect', effect: preset.id })} aria-pressed={applied} onClick={() => applyClipEffect(preset.id)} title={selected ? `${applied ? 'Edit' : 'Apply'} ${preset.label} on the selected clip, or drag it onto another clip` : `Drag ${preset.label} onto a timeline clip`}>
              <span className="ed-clip-effect-art">{applied ? <Check size={15}/> : <WandSparkles size={15}/>}</span><span><b>{preset.label}</b><small>{preset.about}</small><em>{applied ? 'Applied · edit on right' : 'Apply to clip'}</em></span></button>; })}</div>
            }
          </div>; })}
        </section>}</>);
}

export function EffectsTabSection3() {
  const { leftTab, effectNeedle, matchingOverlayEffects, effectSection, setEffectSection, weather, setWeather, effectBusy, draggableAs, total, addEffect, thunderBusy, addThunder, effects } = useEditorPanel<EditorLeftRailBindings>('left');
  return (<>{leftTab === 'effects' && (!effectNeedle || matchingOverlayEffects.length > 0 || 'thunder weather sound'.includes(effectNeedle)) && <section className="ed-add" aria-label="Special effects">
          <h3>Add an overlay</h3><p className="ed-tip">Effects sit above your video as layers. Click to add at the playhead, or drag onto the timeline.</p>
          {(['weather', 'celebration', 'wedding', 'festival', 'travel', 'vlog'] as const).map((mood) => { const group = matchingOverlayEffects.filter((effect) => effect.mood === mood); const thunderMatches = mood === 'weather' && (!effectNeedle || 'thunder weather sound'.includes(effectNeedle)); const label = { weather: 'Weather', celebration: 'Celebration', wedding: 'Wedding', festival: 'Festival', travel: 'Travel', vlog: 'Vlog and film' }[mood]; const section = `overlay-${mood}`; const open = Boolean(effectNeedle) || effectSection === section; return (group.length > 0 || thunderMatches) && <div key={mood} className="ed-effect-category">
            <button className="ed-effect-category-head" aria-expanded={open} onClick={() => { if (!effectNeedle) setEffectSection(open ? null : section); }}><span><b>{label}</b><small>{group.length + (thunderMatches ? 1 : 0)} effects</small></span>{open ? <Minus size={14}/> : <Plus size={14}/>}</button>
            {open && <>{mood === 'weather' && <details className="ed-weather-custom" data-keep-panel><summary>Customize weather</summary><div className="ed-weather-settings">
              <details className="ed-weather-block"><summary>Rain</summary>
                <ValueSlider label="Amount" value={weather.rainDensity} min={0.25} max={2} step={0.25} defaultValue={1} unit="%" factor={100} onChange={(rainDensity) => setWeather({ ...weather, rainDensity })}/>
                <ValueSlider label="Fall speed" value={weather.rainSpeed} min={0.6} max={1.6} step={0.1} defaultValue={1} unit="×" decimals={1} onChange={(rainSpeed) => setWeather({ ...weather, rainSpeed })}/>
                <Chips label="Wind" options={[{ id: 'left' as const, label: 'Left' }, { id: 'straight' as const, label: 'Still' }, { id: 'right' as const, label: 'Right' }]} value={weather.rainDirection} onPick={(rainDirection) => setWeather({ ...weather, rainDirection })}/></details>
              <details className="ed-weather-block"><summary>Fog</summary>
                <ValueSlider label="Density" value={weather.fogDensity} min={0.2} max={1.25} step={0.05} defaultValue={0.65} unit="%" factor={100} onChange={(fogDensity) => setWeather({ ...weather, fogDensity })}/>
                <ValueSlider label="Drift speed" value={weather.fogSpeed} min={0.2} max={1.4} step={0.1} defaultValue={0.55} unit="×" decimals={1} onChange={(fogSpeed) => setWeather({ ...weather, fogSpeed })}/>
                <Chips label="Drift" options={[{ id: 'left' as const, label: 'Left' }, { id: 'straight' as const, label: 'Still' }, { id: 'right' as const, label: 'Right' }]} value={weather.fogDirection} onPick={(fogDirection) => setWeather({ ...weather, fogDirection })}/></details>
              <details className="ed-weather-block"><summary>Lightning</summary>
                <ValueSlider label="Flashes" value={weather.frequency} min={1} max={6} step={1} defaultValue={3} onChange={(frequency) => setWeather({ ...weather, frequency })}/>
                <ValueSlider label="Brightness" value={weather.brightness} min={0.25} max={1.25} step={0.05} defaultValue={0.8} unit="%" factor={100} onChange={(brightness) => setWeather({ ...weather, brightness })}/></details>
              <details className="ed-weather-block"><summary>Snow</summary>
                <ValueSlider label="Amount" value={weather.snowDensity} min={0.25} max={1.75} step={0.25} defaultValue={0.8} unit="%" factor={100} onChange={(snowDensity) => setWeather({ ...weather, snowDensity })}/>
                <ValueSlider label="Fall speed" value={weather.snowSpeed} min={0.4} max={1.5} step={0.1} defaultValue={0.8} unit="×" decimals={1} onChange={(snowSpeed) => setWeather({ ...weather, snowSpeed })}/>
                <Chips label="Wind" options={[{ id: 'left' as const, label: 'Left' }, { id: 'straight' as const, label: 'Still' }, { id: 'right' as const, label: 'Right' }]} value={weather.snowDirection} onPick={(snowDirection) => setWeather({ ...weather, snowDirection })}/></details>
              <button className="ed-button wide" disabled={Boolean(effectBusy)} onClick={() => setWeather({ ...weather, seed: (weather.seed + 1) % 100 })}><Shuffle size={13}/>New variation · {weather.seed + 1}</button>
              <p className="ed-tip">Optional controls for the next weather effect you add.</p>
            </div></details>}
            <div className="ed-quick ed-effects">{group.map((effect) => <button key={effect.id} className={`ed-quick-tile fx-${effect.id}`} {...draggableAs({ kind: 'effect', effect: effect.id })} disabled={!total || Boolean(effectBusy)} onClick={() => { void addEffect(effect.id); }} title={`${effect.about}. Click to add at the playhead, or drag onto the timeline.`}>
              <span className="ed-quick-art">{effectBusy?.id === effect.id && <LoaderCircle className="spin" size={14}/>}</span><b>{effect.label}</b><em lang="ta">{effect.tamil}</em></button>)}{thunderMatches && <button className="ed-quick-tile fx-thunder" disabled={!total || thunderBusy} onClick={() => { void addThunder(); }} title="Add locally generated thunder at the playhead. It is an editable sound clip.">
                <span className="ed-quick-art">{thunderBusy && <LoaderCircle className="spin" size={14}/>}</span><b>Thunder</b><em lang="ta">இடி</em></button>}</div></>}
          </div>; })}
          {effectBusy && <p className="ed-tip" role="status">Making the effect for this video's shape… {effectBusy.progress}%. Next time it's instant.</p>}
          {!effects.length && <p className="ed-tip">Loading effects…</p>}
        </section>}</>);
}

export function EffectsTabSection4() {
  const { leftTab, effectNeedle, matchingClipEffects, matchingOverlayEffects } = useEditorPanel<EditorLeftRailBindings>('left');
  return (<>{leftTab === 'effects' && effectNeedle && !matchingClipEffects.length && !matchingOverlayEffects.length && !'thunder weather sound hide blur pixelate face privacy'.includes(effectNeedle) && <div className="ed-effect-empty"><b>No effects found</b><span>Try a name such as film, rain, VHS, wedding or light.</span></div>}</>);
}

export function EffectsTabSection5() {
  const { leftTab, effectNeedle, total, addBlurBox, faceJob, setFaceJob, blurFaces, faceNote } = useEditorPanel<EditorLeftRailBindings>('left');
  return (<>{leftTab === 'effects' && (!effectNeedle || 'privacy hide blur pixelate face'.includes(effectNeedle)) && <section className="ed-add" aria-label="Privacy"><h3 className="ed-sub">{t('Privacy')}</h3><p className="ed-tip">Covers a face, a number plate or a screen. It can follow what it covers.</p>
            <div className="ed-add-grid">
              <button className="ed-button" disabled={!total} onClick={() => addBlurBox('blur')}><EyeOff size={13}/>Blur box</button>
              <button className="ed-button" disabled={!total} onClick={() => addBlurBox('pixelate')}><EyeOff size={13}/>Pixelate box</button>
              {faceJob ? <div className="ed-add-span"><div className="ed-progress"><i style={{ width: `${faceJob.progress}%` }}/></div><p className="ed-tip">Finding faces… {faceJob.progress}%</p><button className="ed-button wide" onClick={() => { void cancelRenderJob(faceJob.jobId); setFaceJob(null); }}>Cancel</button></div>
                : <button className="ed-button ed-add-span" disabled={!total} onClick={() => { void blurFaces(); }} title="Finds every face in the clip at the playhead and blurs each one"><ScanFace size={14}/>Blur faces</button>}
            </div>
            {faceNote && <p className="ed-tip" role="status">{faceNote}</p>}</section>}</>);
}

/** The Effects tab in parts: overlays added above the video, looks applied to the selected clip, and privacy (blur and
 * pixelate). While searching, every part that matches shows at once. */
export function EffectsTabParts() {
  const { leftTab, effectNeedle } = useEditorPanel<EditorLeftRailBindings>('left');
  const tabs = [{ id: 'overlays' as const, label: 'Overlays' }, { id: 'looks' as const, label: 'Clip looks' }, { id: 'privacy' as const, label: 'Privacy' }];
  const [part, choose] = useSubTab('effects', tabs);
  if (leftTab !== 'effects') return null;
  const all = Boolean(effectNeedle);
  return <>
    <EffectsTabSection1/>
    {!all && <SubTabs label="Effect tools" tabs={tabs} part={part} onChoose={choose}/>}
    {(all || part === 'overlays') && <EffectsTabSection3/>}
    {(all || part === 'looks') && <EffectsTabSection2/>}
    {(all || part === 'privacy') && <EffectsTabSection5/>}
    <EffectsTabSection4/>
  </>;
}
