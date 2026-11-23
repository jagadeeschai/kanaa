import { useEditorPanel } from '../state/EditorContext';
import { KARAOKE_COLOUR } from '../../timeline/karaoke';
import { useEditor, useItemTime } from '../state/EditorContext';
import { t } from '../../i18n';
import { type CinemaReveal, type Clip, type CoverKind, DEFAULT_TITLE_DEPTH, type KeepClear, REST_TRANSFORM, type SurfaceKind, TITLE_DESIGNS, TITLE_SPACE, type TextItem, duration, titleSpaceOf } from '../../timeline/model';
import { FontsWithYours, LetterFill, ZoomThrough } from './TextLooks';
import { DepthPlacer } from './DepthPlacer';
import { TITLE_MOVES, applyTitleMove, stillTitle } from '../../timeline/titleMoves';
import { MotionPanel } from '../Keyframes';
import { DrawPathButton } from '../PathDraw';
import { Timing, timingSummary } from '../Timing';
import { type TimeFieldProps, ValueSlider } from '../controls';
import { Group, LayerModeContext, More, Panel, TabHeading } from '../layout';
import { SONG_IDS } from '../../timeline/signatureTitles';
import { SignatureCardGroup } from './SignatureCardGroup';
import { ALargeSmall, Bookmark, Check, Crosshair, Lock, Move, Type, Users } from 'lucide-react';
import { useContext, useEffect, useState } from 'react';
import { AnimationPicker, BACKED_DESIGNS, Chips, CinemaPicker, DESIGN_TIPS, KeepClearPanel, SIMPLE_TITLE_PRESETS, TitleCover } from './parts';

import { MATERIAL_LOOKS } from '../../timeline/titleMaterial';
import { GraphicInspector } from './GraphicInspector';
import { SourceField } from './SourceField';

const KARAOKE_SWATCHES: [string, string][] = [['#ffd54a', 'Gold'], ['#ff7aa8', 'Rose'], ['#7dd3fc', 'Sky'], ['#86efac', 'Leaf'], ['#ffffff', 'White']];

export type TextInspectorBindings = { onKaraoke: (colour: string | null) => void; onDecorate: (effect: 'bubbles' | 'shine') => void; decorating: boolean; staying: number | null; stayNote: string | null; onStay: () => void; onStopStay: () => void; onStayCover: (banner: boolean) => void; text: TextItem; groundGap: 0 | 1 | 2 | 3 | 4 | 5; onGroundGap: (gap: 0 | 1 | 2 | 3 | 4 | 5) => void; onSaveStyle: () => void; onCinema: (reveal: CinemaReveal, what: CoverKind) => void; onCinemaFront: (reveal: CinemaReveal) => void; onCinemaClear: () => void; pinning: number | null; onPin: (on: boolean) => void; placing: 'waiting' | 'busy' | null; onPlace: () => void; onSurface: (kind: SurfaceKind) => void; clearing: number | null; clearNote: string | null; clearUnder: Clip | null; onKeepClear: (settings: Pick<KeepClear, 'gap' | 'direction' | 'max_move' | 'who'>) => void; onRemoveClear: () => void; onBehindShape: (reveal: CinemaReveal, mode: 'ground' | 'outline') => void; cover: TitleCover; shapingMode: 'ground' | 'outline' | null; timing: TimeFieldProps[]; follow: React.ReactNode; onChange: (changes: Partial<TextItem>, group?: string) => void; onEnter: () => void; onExit: () => void };

export function TextInspector() {
  const { onKaraoke, onDecorate, decorating, staying, stayNote, onStay, onStopStay, onStayCover, text, groundGap, onGroundGap, onSaveStyle, onCinema, onCinemaFront, onCinemaClear, pinning, onPin, placing, onPlace, onSurface, clearing, clearNote, clearUnder, onKeepClear, onRemoveClear, onBehindShape, cover, shapingMode, timing, follow, onChange, onEnter, onExit } = useEditorPanel<TextInspectorBindings>('text');
  const { local, seekLocal: onSeekLocal } = useItemTime(text.start, text.length);
  const { pause: onPause, timeline } = useEditor();

  // The words as typed: they may be empty for a moment while retyping. A title can't be empty, so only words are
  // saved, and leaving the box empty puts the last words back.
  const [draft, setDraft] = useState(text.text);
  const [savedNow, setSavedNow] = useState(false);  // A moment of "Saved to My styles" after saving.
  useEffect(() => { setDraft(text.text); }, [text.id, text.text]);
  const forLayer = useContext(LayerModeContext);
  if (text.graphic) return <GraphicInspector text={text} timing={timing} onChange={onChange} onEnter={onEnter} follow={follow}/>;
  const fontsAndSize = <>
    <FontsWithYours text={text} onChange={onChange}/>
    <ValueSlider label="Size" value={text.size} min={20} max={100} step={1} defaultValue={44} onChange={(size, group) => onChange({ size }, group)}/>
    <label className="ed-color"><span>Colour</span><input type="color" aria-label="Text colour" value={text.color} onChange={(event) => onChange({ color: event.target.value }, `color-${text.id}`)}/></label>
    <Chips label="Style" options={[{ id: 'band', label: 'Band' }, { id: 'shadow', label: 'Shadow' }, { id: 'outline', label: 'Outline' }, { id: 'plain', label: 'Plain' }]} value={text.style} onPick={(style) => onChange({ style })}/>
    <LetterFill text={text} onChange={onChange}/>
    <h3 className="ed-sub">{t('Video inside the letters')}</h3>
    <div className="ed-chips" role="group" aria-label={t('Video inside the letters')}>
      {([[null, null, 'Off'], ['#000000', null, 'Black around'], ['#ffffff', null, 'White around'], ['#000000', 0.55, 'Soft black'], ['#ffffff', 0.55, 'Soft white']] as const).map(([colour, wash, label]) => { const on = (text.knockout ?? null) === colour && (colour === null || (text.knockout_wash ?? null) === wash); return <button key={label} className={on ? 'on' : undefined} aria-pressed={on}
          title={colour ? t(wash ? 'The clip shows around the words through a soft wash, and each letter gets a thin border.' : 'The picture under the title shows only through its letters.') : undefined} onClick={() => onChange({ knockout: colour, knockout_wash: wash, ...(colour ? { style: 'plain' as const } : {}) })}>{t(label)}</button>; })}
      </div>
    <ZoomThrough text={text} format={timeline.format} onChange={onChange}/>
    <DepthPlacer text={text} placing={placing} onPlace={onPlace}/>
    <Chips label="Position" options={[{ id: 'top', label: 'Top' }, { id: 'center', label: 'Middle' }, { id: 'bottom', label: 'Bottom' }]} value={text.position} onPick={(position) => onChange({ position })}/>
    <Chips label="Alignment" options={[{ id: 'left' as const, label: 'Left' }, { id: 'center' as const, label: 'Centre' }, { id: 'right' as const, label: 'Right' }]} value={text.align ?? 'center'} onPick={(align) => onChange({ align })}/>
    <ValueSlider label="Letter spacing" value={text.spacing ?? 0} min={0} max={30} step={1} defaultValue={0} onChange={(spacing, group) => onChange({ spacing: Math.round(spacing) }, group)}/>
  </>;
  // One Text tab: the words with everything about how they look; and a Motion tab.
  return <Panel id="title" header={SONG_IDS.some((id) => text.id.startsWith(id)) ? <SignatureCardGroup/> : undefined} tabs={[{ id: 'style', label: 'Text', Icon: ALargeSmall }, { id: 'motion', label: 'Motion', Icon: Move, changed: Boolean(text.enter || text.exit || Object.keys(text.transform?.keyframes ?? {}).length) }]}>
    <Group title="Timing" summary={timingSummary(timing)} keywords="when start length duration" help="timing-and-trimming">
      <Timing fields={timing}/>
    </Group>
    <Group title="Text" tab="style" startOpen keywords="text title words tamil english type font bigger size colour color band shadow outline style position align spacing" tip="Type in Tamil or English, or double-click the title in the preview. Drag it there to move it." help="titles">
      {!forLayer && <textarea className="ed-text" aria-label="Title" lang="ta" value={draft} placeholder="Type your title" maxLength={500} rows={2} onChange={(event) => { setDraft(event.target.value); if (event.target.value.trim()) onChange({ text: event.target.value }, `text-${text.id}`); }} onBlur={() => { if (!draft.trim()) setDraft(text.text); }}/>}
      {fontsAndSize}
      {!forLayer && <SourceField text={text} onChange={onChange}/>}
    </Group>
    <Group title="Karaoke" tab="style" startOpen={Boolean(text.karaoke)} changed={Boolean(text.karaoke)} keywords="karaoke highlight sing along words lyrics light up">
      <label className="ed-check"><input type="checkbox" checked={Boolean(text.karaoke)} onChange={(event) => onKaraoke(event.target.checked ? text.karaoke?.color ?? KARAOKE_COLOUR : null)}/><span>Light the words as they are sung<small>{forLayer ? 'Each word changes colour in time with its line.' : 'Each word changes colour in time with the line. For a whole lyrics layer at once, use the layer’s settings (⋯ on the layer → Layer settings).'}</small></span></label>
      {forLayer && <p className="ed-group-tip">{t('Turns karaoke on or off for every title on this layer.')}</p>}
      {text.karaoke && <div className="ed-chips" role="group" aria-label="Karaoke colour">{KARAOKE_SWATCHES.map(([colour, name]) => <button key={colour} className={text.karaoke?.color === colour ? 'on' : ''} aria-pressed={text.karaoke?.color === colour} onClick={() => onKaraoke(colour)}><i className="ed-who-dot" style={{ background: colour }}/>{name}</button>)}</div>}
    </Group>
    <Group title="Subtitle" tab="style" startOpen={Boolean(text.subtitle)} changed={Boolean(text.subtitle)} keywords="subtitle small line spacing">
      {!forLayer && <textarea className="ed-text" aria-label="Subtitle" lang="ta" placeholder="Subtitle (optional)" value={text.subtitle ?? ''} maxLength={200} rows={1} onChange={(event) => onChange({ subtitle: event.target.value || null }, `subtitle-${text.id}`)}/>}
      {(text.subtitle || forLayer) && <>
      <ValueSlider label="Size" value={text.subtitle_size ?? Math.round(Math.max(20, text.size) * 0.55)} min={10} max={100} step={1} defaultValue={Math.round(Math.max(20, text.size) * 0.55)} onChange={(subtitle_size, group) => onChange({ subtitle_size: Math.round(subtitle_size) }, group)}/>
      <ValueSlider label="Subtitle letter spacing" value={text.subtitle_spacing ?? 0} min={0} max={30} step={1} defaultValue={0} onChange={(spacing, group) => onChange({ subtitle_spacing: Math.round(spacing) }, group)}/>
      <label className="ed-color"><span>Colour</span><input type="color" aria-label="Subtitle colour" value={text.subtitle_color ?? text.color} onChange={(event) => onChange({ subtitle_color: event.target.value }, `subcolor-${text.id}`)}/></label>
      <Chips label="Subtitle place" options={[{ id: 'below' as const, label: 'Below the title' }, { id: 'above' as const, label: 'Above it' }]} value={text.subtitle_above ? 'above' : 'below'} onPick={(place) => onChange({ subtitle_above: place === 'above' })}/>
      </>}
    </Group>
    <Group title="Layout and look" tab="style" changed={Boolean(text.design)} keywords="layout design band backing save my style look" help="title-styles">
      <Chips label="Layout" options={[{ id: 'none' as const, label: 'Plain' }, ...TITLE_DESIGNS]} value={text.design ?? 'none'} onPick={(design) => onChange({ design: design === 'none' ? null : design })}/>
      {text.design && <p className="ed-group-tip">{DESIGN_TIPS[text.design]}</p>}
      {(text.style === 'band' || (text.design && BACKED_DESIGNS.has(text.design))) && <label className="ed-color"><span>{text.design ? 'Backing colour' : 'Band colour'}</span><input type="color" aria-label="Band colour" value={text.band_color ?? '#000000'} onChange={(event) => onChange({ band_color: event.target.value }, `band-${text.id}`)}/></label>}
      {!forLayer && <div className="ed-save-style">
        <button className={`ed-button ${savedNow ? 'done' : ''}`} onClick={() => { onSaveStyle(); setSavedNow(true); window.setTimeout(() => setSavedNow(false), 2200); }}
          title="Keep this title — look, place, moves and length — in Text, under My styles, for any video; change only the words">
          {savedNow ? <><Check size={13}/>{t('Saved to My styles')}</> : <><Bookmark size={13}/>{t('Save as my style')}</>}
        </button>
      </div>}
    </Group>
    <Group title="3D" tab="style" startOpen={Boolean(text.depth || text.transform?.tilt_x || text.transform?.tilt_y)} changed={Boolean(text.depth || text.transform?.tilt_x || text.transform?.tilt_y)} keywords="3d depth extrude tilt perspective lean turn cinema solid letters" tip="Lean the title back or turn it in true perspective, and give the letters solid sides." help="cinema-titles">
      <Chips label="Material" options={MATERIAL_LOOKS} value={text.depth?.material ?? ''} onPick={(id) => onChange({ style: 'plain', depth: { ...MATERIAL_LOOKS.find((look) => look.id === id)!.depth, sweep: text.depth?.sweep ?? false } })}/>
      {text.depth?.material && <label className="ed-check"><input type="checkbox" checked={Boolean(text.depth.sweep)} onChange={(event) => onChange({ depth: { ...text.depth!, sweep: event.target.checked } })}/><span>{t('Light sweep on letters')}</span></label>}
      <More>
      <ValueSlider label="Lean back" value={text.transform?.tilt_x ?? 0} min={-80} max={80} step={1} defaultValue={0} unit="°" onChange={(tilt_x, group) => onChange({ transform: { ...(text.transform ?? REST_TRANSFORM), tilt_x } }, group)}/>
      <ValueSlider label="Turn" value={text.transform?.tilt_y ?? 0} min={-80} max={80} step={1} defaultValue={0} unit="°" onChange={(tilt_y, group) => onChange({ transform: { ...(text.transform ?? REST_TRANSFORM), tilt_y } }, group)}/>
      </More>
      {text.depth && <More>
        <ValueSlider label="Bevel" value={text.depth.bevel ?? 0} min={0} max={1} step={0.01} defaultValue={0} onChange={(bevel, group) => onChange({ depth: { ...text.depth!, bevel } }, group)}/>
        <ValueSlider label="Shine" value={text.depth.shine ?? 0} min={0} max={1} step={0.01} defaultValue={0} onChange={(shine, group) => onChange({ depth: { ...text.depth!, shine } }, group)}/>
        <ValueSlider label="Distance" value={text.depth.amount} min={0} max={4} step={0.01} defaultValue={0} unit="%" factor={100} onChange={(amount, group) => onChange({ depth: { ...text.depth!, amount } }, group)}/>
        <label className="ed-color"><span>Sides</span><input type="color" aria-label="Colour of the letters' sides" value={text.depth.color} onChange={(event) => onChange({ depth: { ...text.depth!, color: event.target.value } }, `depth-colour-${text.id}`)}/></label>
        <ValueSlider label="Light on the sides" value={text.depth.light} min={0} max={1} step={0.01} defaultValue={DEFAULT_TITLE_DEPTH.light} unit="%" factor={100} onChange={(light, group) => onChange({ depth: { ...text.depth!, light } }, group)}/>
        <Chips label="Direction" options={[{ id: '0', label: '↓ Down' }, { id: '24', label: '↘ Soft' }, { id: '45', label: '↘' }, { id: '90', label: '→ Right' }, { id: '135', label: '↗' }, { id: '180', label: '↑ Up' }, { id: '-135', label: '↖' }, { id: '-90', label: '← Left' }, { id: '-45', label: '↙' }]} value={String(Math.round(text.depth.angle ?? DEFAULT_TITLE_DEPTH.angle ?? 24))} onPick={(id) => onChange({ depth: { ...text.depth!, angle: Number(id) } }, `depth-angle-${text.id}`)}/>
      </More>}
      {text.depth ? null : <ValueSlider label="Depth" value={0} min={0} max={1} step={0.01} defaultValue={0} unit="%" factor={100} onChange={(amount, group) => onChange({ depth: amount > 0 ? { ...(text.depth ?? DEFAULT_TITLE_DEPTH), amount } : null }, group)}/>}
    </Group>
    <TabHeading tab="motion">{t('In and out')}</TabHeading>
    <Group title="Simple animation" tab="motion" changed={Boolean(text.enter || text.exit)} keywords="animation entrance exit fade slide pop" tip="A quick entrance or exit without scene depth." help="animations-and-moves">
      <AnimationPicker label="Enter" presets={SIMPLE_TITLE_PRESETS} value={text.enter} onChange={(enter, group) => onChange({ enter }, group)} onShow={onEnter}/>
      <AnimationPicker label="Exit" presets={[...SIMPLE_TITLE_PRESETS, { id: 'fly-through-3d', label: 'Through the letters' }]} value={text.exit} onChange={(exit, group) => onChange({ exit }, group)} onShow={onExit}/>
    </Group>
    <Group title="Cinematic reveal" tab="motion" startOpen keywords="cinema reveal behind 3d rise push pass uncover film title depth ground skyline people front space flicker" tip="How the title appears, and what passes in front of it." help="cinema-titles">
      <CinemaPicker initial={text.enter?.preset === 'fly-reveal' ? 'fly' : text.enter?.preset === 'push-through' ? 'push' : text.enter?.preset === 'rise-behind' || text.enter?.preset === 'ground-rise' ? 'rise' : text.depth || text.pin || (cover && cover !== 'front') ? 'pass' : 'none'} cover={cover} shapingMode={shapingMode} onClear={onCinemaClear} onFront={onCinemaFront} onPick={onCinema} onShape={onBehindShape}/>
      {(cover === 'people' || cover === 'object') && <>
        <h3 className="ed-sub">3 · Space around them</h3>
        <Chips label="Space around them" options={[{ id: 'none' as const, label: 'None' }, { id: 'close' as const, label: 'Close' }, { id: 'comfortable' as const, label: 'Comfortable' }, { id: 'wide' as const, label: 'Wide' }]} value={titleSpaceOf(groundGap)} onPick={(space) => onGroundGap(TITLE_SPACE[space])}/>
        <p className="ed-group-tip">{groundGap ? 'The title keeps a little room around them that moves smoothly with them, so letters at their edges don\'t flicker.' : 'Letters touching their outline can flicker as they move. A little space fixes it.'}</p>
      </>}
      {(text.enter?.preset === 'ground-rise' || text.enter?.preset === 'rise-behind' || text.enter?.preset === 'push-through') && <ValueSlider label="How long it takes" value={text.enter.duration} min={0.2} max={3} step={0.1} defaultValue={1.2} unit="s" decimals={1} onChange={(duration, group) => onChange({ enter: { ...text.enter!, duration } }, group ?? `cinema-enter-${text.id}`)}/>}
    </Group>
    <TabHeading tab="motion">{t('While on screen')}</TabHeading>
    <Group title="Moves" tab="motion" keywords="drift drifting sideways vertical ticker news crawl credits scroll roll story moving slow" tip="One click moves the title the whole time it shows. Stand still stops it." help="animations-and-moves">
      <div className="ed-chips" role="group" aria-label="Title moves">{TITLE_MOVES.map((move) => <button key={move.id} title={move.tip} onClick={() => onChange(applyTitleMove(text, move.id))}>{move.label}</button>)}</div>
      <button className="ed-button wide" onClick={() => onChange(stillTitle(text, local))} title="Stops the title moving, where it is now">Stand still</button>
      <label className="ed-check"><input type="checkbox" checked={Boolean(text.glint)} onChange={(event) => onChange({ glint: event.target.checked })}/><span>{t('Glint')}</span></label>
      <div className="ed-chips" role="group" aria-label="Around the words">
        <button disabled={decorating} title="Soap bubbles rising around the words, for as long as the title shows" onClick={() => onDecorate('bubbles')}>Bubbles around it</button>
        <button disabled={decorating} title="A streak of light crossing the words every few seconds" onClick={() => onDecorate('shine')}>Shine across it</button>
      </div>
    </Group>
    <Group title="Keyframes" tab="motion" changed={Object.keys(text.transform?.keyframes ?? {}).length > 0} keywords="move position size tilt see-through animate keyframe" help="animations-and-moves">
      <DrawPathButton/>
      <MotionPanel transform={text.transform ?? REST_TRANSFORM} local={local} length={text.length} onChange={(transform, group) => onChange({ transform }, group)} onSeek={onSeekLocal} onGestureStart={onPause}/>
    </Group>
    <Group title="People and scene" tab="motion" startOpen={Boolean(text.stay_with || text.pin || text.keep_clear)} changed={Boolean(text.stay_with || text.pin || text.keep_clear)}
      keywords="stay with people follow person moving distance near far stick walk attach place scene surface wall floor ground sky track perspective billboard sign lock camera pin subject keep clear avoid faces move aside overlap cover"
      tip="Make the title travel with people, sit on a wall or the ground, stay locked to the scene, or move aside when someone comes near." help="cinema-titles">
      <h3 className="ed-sub" title={t('The title travels with the people: same distance from them, bigger as they come near, smaller as they walk away.')}>{t('Stay with people')}</h3>
      {text.stay_with ? <>
        <p className="ed-group-tip">This title stays with the people it was nearest, and changes size with them.</p>
        <h3 className="ed-sub">The people pass</h3>
        <Chips label="The people pass" options={[{ id: 'banner' as const, label: 'In front of it, like a banner' }, { id: 'over' as const, label: 'Behind it' }]} value={cover === 'people' || cover === 'object' ? 'banner' : 'over'} onPick={(id) => onStayCover(id === 'banner')}/>
        <div className="ed-pair"><button className="ed-button" disabled={staying !== null} onClick={onStay} title="Uses where the title is now, at the playhead">{staying !== null ? `Finding them… ${staying}%` : 'Set again from here'}</button><button className="ed-button" disabled={staying !== null} onClick={onStopStay}>Stop</button></div>
      </> : <>
        <p className="ed-group-tip">1. Go to a moment where the people are clear. 2. Drag the title to where it should sit, above or beside them. 3. Click the button.</p>
        <button className="ed-button wide primary" disabled={staying !== null} onClick={onStay}><Users size={14}/>{staying !== null ? `Finding the people… ${staying}%` : 'Stay with the people'}</button>
      </>}
      {stayNote && staying === null && <p className="ed-group-tip" role="status">{stayNote}</p>}
      <h3 className="ed-sub" title={t('Put the title on a wall, the ground or the sky in the video, in one click.')}>{t('Place in scene')}</h3>
      <div className="ed-place">
        <button className={`ed-button wide ${placing === 'waiting' ? 'on' : 'primary'}`} disabled={placing === 'busy' || pinning !== null} onClick={onPlace} aria-pressed={placing === 'waiting'}>
          <Crosshair size={14}/>{placing === 'waiting' ? 'Click a spot in the video…' : placing === 'busy' ? 'Reading the surface…' : pinning !== null ? `Following the surface… ${pinning}%` : text.pin?.region || text.pin?.surface ? 'Place somewhere else' : 'Place in scene'}</button>
        <p className="ed-group-tip">{placing === 'waiting' ? 'Click where the title should go: a wall, the ground, the sky. Esc cancels.' : text.pin?.surface ? 'It lies on that surface, stays there as the camera moves, and people pass in front.' : 'Click a wall, the ground or the sky in the video: the title lies on it, stays there as the camera moves, and people pass in front. No keyframes.'}</p>
        {text.pin?.surface && <Chips label="Surface" options={[{ id: 'floor' as const, label: 'Floor' }, { id: 'wall' as const, label: 'Wall' }, { id: 'upright' as const, label: 'Upright' }, { id: 'sky' as const, label: 'Sky' }]} value={text.pin.surface} onPick={onSurface}/>}
      </div>
      <h3 className="ed-sub" title={t('Keep the title fixed to a spot in the scene, or moving with a person.')}>{t('Move with the scene')}</h3>
      <label className="ed-check"><input type="checkbox" checked={Boolean(text.pin)} disabled={pinning !== null} onChange={(event) => onPin(event.target.checked)}/><span>Lock to the scene{pinning !== null ? ` … ${pinning}%` : ''}<small>Stays on the same spot as the camera moves.</small></span></label>
      {follow}
      <h3 className="ed-sub" title={t('The title moves aside when someone comes near, instead of going behind them.')}>{t('Keep the title clear of people')}</h3>
      {cover === 'people' || cover === 'object' ? <>
        <p className="ed-group-tip">{text.keep_clear ? 'This title also moves aside from people, while they pass in front of it. The two fight, so the title jumps about. Stop moving it aside to keep it still behind them.' : 'People pass in front of this title now. To keep it clear of them instead, choose Nothing in front above.'}</p>
        {text.keep_clear && <button className="ed-button wide primary" onClick={onRemoveClear}>Stop moving it aside</button>}
      </>
        : <KeepClearPanel key={text.id} kept={text.keep_clear ?? null} under={clearUnder} busy={clearing} note={clearNote} onRun={onKeepClear} onRemove={onRemoveClear}/>}
    </Group>
  </Panel>;
}
