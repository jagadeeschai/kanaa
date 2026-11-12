import { photoThumbUrl } from '../../api/client';
import { t } from '../../i18n';
import { type Animation, type Transition } from '../../timeline/animation';
import { DEFAULT_CHROMA } from '../../timeline/chroma';
import { EFFECT_LAYER } from '../../timeline/drop';
import { clipEffects } from '../../timeline/effects';
import { valueAt } from '../../timeline/evaluate';
import { writeValue } from '../../timeline/keyframes';
import { type Adjust, type Clip, type Corner, DEFAULT_BEAT_PULSE, DEFAULT_COLOUR_SPLASH, DEFAULT_DREAMY_GLOW, DEFAULT_ECHO, DEFAULT_LENS_SURFACE, DEFAULT_MIRROR, DEFAULT_OLD_FILM, DEFAULT_SIGNAL_DAMAGE, DEFAULT_TILT_SHIFT, DEFAULT_TONE_GRADE, DEFAULT_ZOOM_BLUR, type Format, type Sound, TONE_PRESETS, type VideoLayer, clipLength, cornerPlacement, duration, fillScale } from '../../timeline/model';
import { type MovePreset } from '../../timeline/presets';
import { RAMPS } from '../../timeline/ramp';
import { type Photo } from '../../types/photo';
import { MotionPanel } from '../Keyframes';
import { Timing, timingSummary } from '../Timing';
import { type TimeFieldProps, ValueSlider } from '../controls';
import { Group, More, Panel } from '../layout';
import { type PlaybackSource } from '../playback';
import { AnimationPicker, Chips } from './parts';
import { AudioLines, Crop, FlipHorizontal, FlipVertical, Lock, Maximize, Minimize, Move, Pipette, Play, RotateCcw, RotateCw, ScanFace, SlidersHorizontal, Unlock, Volume2, VolumeX, Wallpaper, WandSparkles } from 'lucide-react';
import { ActiveEffects, BLENDS, BLUR_AMOUNTS, CORNERS, EFFECT_INTENSITIES, EFFECT_INTENSITY_VALUE, LOOK_NAMES, MOVES, RAMP_CHOICES, RampCurve, SoundControls, WhoStays, rampName } from './clip-parts';

export function Inspector({ onReframe, reframing, onMove, backgrounds, onBackground, logos, clipBrandMarks, onClipBrand, onRemoveClipBrand, clip, source, format, onChange, canDetach, onDetach, local, onSeekLocal, onPause, follow, isMain, copyReady, onLayout, picking, onPick, timing, overlay, onLayer, closesWithTransition, onShowEnter, onShowExit }: { onReframe: (() => void) | null; reframing: boolean; onMove: (move: MovePreset) => void; backgrounds: Photo[]; onBackground: (item: Photo) => void; logos: Photo[]; clipBrandMarks: { id: string; name: string }[]; onClipBrand: (item: Photo) => void; onRemoveClipBrand: (id: string) => void; clip: Clip; source?: PlaybackSource; format: Format; onChange: (changes: Partial<Clip>, group?: string) => void; canDetach: boolean; onDetach: () => void; local: number; onSeekLocal: (t: number) => void; onPause: () => void; follow: React.ReactNode; isMain: boolean; copyReady: boolean; onLayout: (layout: 'side' | 'stack') => void; picking: boolean; onPick: () => void; timing: TimeFieldProps[]; overlay: VideoLayer | null; onLayer: (changes: Partial<VideoLayer>) => void; closesWithTransition: boolean; onShowEnter: () => void; onShowExit: () => void }) {
  const transition: Transition | null = clip.transition_in ?? null;
  const adjust = (changes: Partial<Adjust>, group?: string) => onChange({ adjust: { ...clip.adjust, ...changes } }, group);
  const fill = source ? fillScale(source, clip.adjust.rotation, format) : 1;
  const size = valueAt(clip.transform, 'scale', local);
  const filling = Math.abs(size - fill) < 0.01;
  const place = (scale: number) => writeValue(writeValue(writeValue(clip.transform, 'x', local, 0.5), 'y', local, 0.5), 'scale', local, scale);
  const isEffect = overlay?.name === EFFECT_LAYER;
  const effectFadeMax = Math.min(2, clipLength(clip) / 2);
  return <>
    <ActiveEffects clip={clip} onChange={onChange}/>
    <Panel id="clip" tabs={[{ id: 'frame', label: 'Frame', Icon: Crop }, { id: 'look', label: 'Colour', Icon: SlidersHorizontal, changed: (clip.look ?? 'none') !== 'none' }, { id: 'effects', label: 'Effects', Icon: WandSparkles, changed: clipEffects(clip).length > 0 }, { id: 'background', label: 'Backdrop', Icon: Wallpaper, changed: Boolean(clip.cutout || clip.chroma) },
      { id: 'motion', label: 'Motion', Icon: Move, changed: Boolean(clip.enter || clip.exit || clip.transition_in || Object.keys(clip.transform.keyframes ?? {}).length) }, ...(source?.kind === 'video' && clip.freeze == null ? [{ id: 'sound', label: 'Sound', Icon: Volume2, changed: clip.speed !== 1 || clip.muted || Boolean(clip.ramp) }] : [])]}>
    <Group title="Timing" summary={timingSummary(timing)} keywords="trim cut shorten length start end from to" help="timing-and-trimming"><Timing fields={timing}/></Group>
    <Group title="Clip visibility" tab="frame" startOpen changed={clip.enabled === false} keywords="active inactive disable hide camera angle multicam" tip="Deactivate an angle without deleting or moving it.">
      <label className="ed-check"><input type="checkbox" checked={clip.enabled !== false} onChange={(event) => onChange({ enabled: event.target.checked })}/><span>Active clip<small>{clip.enabled === false ? 'Kept on the timeline, but absent from preview, sound and export.' : 'This clip contributes picture and sound.'}</small></span></label>
    </Group>
    {isEffect && <Group pro title="Effect controls" tab="frame" startOpen changed={clip.transform.opacity !== 1 || clip.speed !== 1 || Boolean(clip.enter || clip.exit) || overlay?.blend !== 'screen'} keywords="effect intensity opacity strength speed fade blend" tip="Fine-tune this effect without changing your original video." help="special-effects">
      <Chips label="Intensity" options={EFFECT_INTENSITIES} value={clip.transform.opacity <= 0.5 ? 'subtle' : clip.transform.opacity <= 0.85 ? 'medium' : 'strong'} onPick={(strength) => onChange({ transform: { ...clip.transform, opacity: EFFECT_INTENSITY_VALUE[strength] } })}/>
      <More><ValueSlider label="Fine intensity" value={clip.transform.opacity} min={0} max={1} step={0.01} defaultValue={1} unit="%" factor={100} onGestureStart={onPause} onChange={(opacity, group) => onChange({ transform: { ...clip.transform, opacity } }, group)}/></More>
      <ValueSlider label="Speed" value={clip.speed} min={0.25} max={4} step={0.05} defaultValue={1} unit="×" decimals={2} onGestureStart={onPause} onChange={(speed, group) => onChange({ speed }, group)}/>
      <ValueSlider label="Fade in" value={clip.enter?.preset === 'fade' ? clip.enter.duration : 0} min={0} max={effectFadeMax} step={0.1} defaultValue={0} unit="s" decimals={1} onChange={(duration, group) => onChange({ enter: duration ? { preset: 'fade', duration } : null }, group)}/>
      <ValueSlider label="Fade out" value={clip.exit?.preset === 'fade' ? clip.exit.duration : 0} min={0} max={effectFadeMax} step={0.1} defaultValue={0} unit="s" decimals={1} onChange={(duration, group) => onChange({ exit: duration ? { preset: 'fade', duration } : null }, group)}/>
      <Chips label="Blend" options={BLENDS} value={overlay?.blend ?? 'screen'} onPick={(blend) => onLayer({ blend })}/>
      <p className="ed-group-tip">Timing sets its span. Slower speed stretches the pattern.</p>
    </Group>}
    <Group title="Frame" tab="frame" startOpen keywords="fit fill crop zoom rotate turn sideways mirror flip resize size bigger smaller corner picture in picture pip" tip="Fit shows everything; Fill covers the screen. Drag the picture to move it, or a corner to resize it." help="framing-and-rotating">
    <div className="ed-pair">
      <button className={`ed-button ${!filling && size === 1 ? 'on' : ''}`} disabled={clip.frame_locked} onClick={() => onChange({ transform: place(1) })}><Minimize size={14}/>Fit</button>
      <button className={`ed-button ${filling ? 'on' : ''}`} disabled={clip.frame_locked} onClick={() => onChange({ transform: place(fill) })}><Maximize size={14}/>Fill</button>
    </div>
    <button className={`ed-button wide ${clip.frame_locked ? 'on' : ''}`} aria-pressed={Boolean(clip.frame_locked)} onClick={() => onChange({ frame_locked: !clip.frame_locked })} title={clip.frame_locked ? 'Allow this picture to be moved and resized again' : 'Prevent accidental movement and resizing'}>{clip.frame_locked ? <Lock size={14}/> : <Unlock size={14}/>} {clip.frame_locked ? 'Frame locked' : 'Lock frame'}</button>
    {onReframe && <button className="ed-button wide" disabled={reframing || clip.frame_locked} onClick={onReframe} title="Fills the frame and pans with the main person, for a reel from a landscape video"><ScanFace size={14}/>{reframing ? 'Finding who to follow…' : 'Follow the person'}</button>}
    <div className="ed-pair">
      <button className="ed-icon" disabled={clip.frame_locked} aria-label="Rotate left" onClick={() => adjust({ rotation: ((clip.adjust.rotation + 270) % 360) as Adjust['rotation'] })}><RotateCcw size={16}/></button>
      <button className="ed-icon" disabled={clip.frame_locked} aria-label="Rotate right" onClick={() => adjust({ rotation: ((clip.adjust.rotation + 90) % 360) as Adjust['rotation'] })}><RotateCw size={16}/></button>
      <button className={`ed-icon ${clip.adjust.flip_horizontal ? 'on' : ''}`} disabled={clip.frame_locked} aria-label="Flip horizontally" onClick={() => adjust({ flip_horizontal: !clip.adjust.flip_horizontal })}><FlipHorizontal size={16}/></button>
      <button className={`ed-icon ${clip.adjust.flip_vertical ? 'on' : ''}`} disabled={clip.frame_locked} aria-label="Flip vertically" onClick={() => adjust({ flip_vertical: !clip.adjust.flip_vertical })}><FlipVertical size={16}/></button>
    </div>
    <More>
    {source?.kind === 'video' && <label className="ed-check"><input type="checkbox" checked={Boolean(clip.stabilise)} onChange={(event) => onChange({ stabilise: event.target.checked })}/><span>Steady shaky video<small>{clip.stabilise && !copyReady ? 'Making a steady copy… The preview shows the original until it is ready.' : 'Removes hand shake and zooms in a little to hide the moving edges.'}</small></span></label>}
    {overlay && source && <>
      <h3 className="ed-sub">Corner</h3>
      <Chips label="Corner" options={CORNERS} value={null} onPick={(corner) => { const spot = cornerPlacement(source, clip.adjust.rotation, format, size, corner); onChange({ transform: writeValue(writeValue(clip.transform, 'x', local, spot.x), 'y', local, spot.y) }); }}/>
      <h3 className="ed-sub">Split screen</h3>
      <Chips label="Split screen" options={[{ id: 'side' as const, label: 'Side by side' }, { id: 'stack' as const, label: 'Top and bottom' }]} value={null} onPick={onLayout}/>
      <h3 className="ed-sub">Blend</h3>
      <Chips label="Blend" options={BLENDS} value={overlay.blend ?? 'normal'} onPick={(blend) => onLayer({ blend })}/>
    </>}
    </More>
    </Group>
    {clip.freeze != null && <Group title="Frozen frame" tab="frame" startOpen keywords="still hold pause freeze"><p className="ed-tip">This holds one frame. Change how long with Duration in Timing. It has no sound.</p></Group>}
    <Group title="Colour" tab="look" startOpen changed={(clip.look ?? 'none') !== 'none' || clip.adjust.brightness !== 1 || clip.adjust.contrast !== 1 || clip.adjust.saturation !== 1 || clip.adjust.gamma !== 1 || clip.adjust.temperature !== 1 || clip.adjust.tint !== 1 || clip.adjust.fade !== 0} keywords="filter colour color brighter dark black and white warm vintage look fade gamma temperature tint" tip="Pick a look, then fine-tune brightness and, under More options, gamma, white balance and a film fade." help="colour-and-looks">
    <Chips label="Look" options={LOOK_NAMES} value={clip.look ?? 'none'} onPick={(look) => onChange({ look })}/>
    <ValueSlider label="Brightness" value={clip.adjust.brightness} min={0.25} max={2} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(brightness, group) => adjust({ brightness }, group)}/>
    <More>
    <ValueSlider label="Contrast" value={clip.adjust.contrast} min={0.25} max={2} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(contrast, group) => adjust({ contrast }, group)}/>
    <ValueSlider label="Colour strength" value={clip.adjust.saturation} min={0} max={2} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(saturation, group) => adjust({ saturation }, group)}/>
    <ValueSlider label="Gamma" value={clip.adjust.gamma} min={0.5} max={2} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(gamma, group) => adjust({ gamma }, group)}/>
    <ValueSlider label="Temperature" value={clip.adjust.temperature} min={0.7} max={1.4} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(temperature, group) => adjust({ temperature }, group)}/>
    <ValueSlider label="Tint" value={clip.adjust.tint} min={0.75} max={1.33} step={0.01} defaultValue={1} unit="%" factor={100} onChange={(tint, group) => adjust({ tint }, group)}/>
    <ValueSlider label="Film fade" value={clip.adjust.fade} min={0} max={0.6} step={0.01} defaultValue={0} unit="%" factor={100} onChange={(fade, group) => adjust({ fade }, group)}/>
    <p className="ed-group-tip">Above 100% warms, below cools. Tint leans green or magenta. Fade lifts blacks into a soft matte.</p>
    </More>
    </Group>
    <Group title="Colour splash" tab="effects" startOpen={Boolean(clip.colour_splash)} changed={Boolean(clip.colour_splash)} keywords="colour splash color selective red saree black white monochrome wedding" tip="Keep one colour while the rest of the picture becomes black and white.">
    {clip.colour_splash ? <>
      <label className="ed-color"><span>Colour to keep</span><input type="color" aria-label="Colour to keep" value={clip.colour_splash.color} onChange={(event) => onChange({ colour_splash: { ...clip.colour_splash!, color: event.target.value } }, `splash-color-${clip.id}`)}/></label>
      <ValueSlider label="Black and white strength" value={clip.colour_splash.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_COLOUR_SPLASH.intensity} unit="%" factor={100} onChange={(intensity, group) => onChange({ colour_splash: { ...clip.colour_splash!, intensity } }, group)}/>
      <More>
        <ValueSlider label="Colour range" value={clip.colour_splash.tolerance} min={0.01} max={0.5} step={0.01} defaultValue={DEFAULT_COLOUR_SPLASH.tolerance} unit="%" factor={100} onChange={(tolerance, group) => onChange({ colour_splash: { ...clip.colour_splash!, tolerance } }, group)}/>
        <ValueSlider label="Edge softness" value={clip.colour_splash.softness} min={0.001} max={0.3} step={0.005} defaultValue={DEFAULT_COLOUR_SPLASH.softness} unit="%" factor={100} decimals={1} onChange={(softness, group) => onChange({ colour_splash: { ...clip.colour_splash!, softness } }, group)}/>
      </More>
      <button className="ed-button wide" onClick={() => onChange({ colour_splash: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ colour_splash: { ...DEFAULT_COLOUR_SPLASH } })}>Add colour splash</button>}
    </Group>
    <Group title="Dreamy glow" tab="effects" startOpen={Boolean(clip.dreamy_glow)} changed={Boolean(clip.dreamy_glow)} keywords="dreamy glow soft focus bloom portrait skin wedding romantic" tip="Add a gentle warm bloom to highlights while keeping faces readable.">
    {clip.dreamy_glow ? <>
      <ValueSlider label="Glow" value={clip.dreamy_glow.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_DREAMY_GLOW.intensity} unit="%" factor={100} onChange={(intensity, group) => onChange({ dreamy_glow: { ...clip.dreamy_glow!, intensity } }, group)}/>
      <ValueSlider label="Softness" value={clip.dreamy_glow.softness} min={0} max={1} step={0.01} defaultValue={DEFAULT_DREAMY_GLOW.softness} unit="%" factor={100} onChange={(softness, group) => onChange({ dreamy_glow: { ...clip.dreamy_glow!, softness } }, group)}/>
      <More><ValueSlider label="Warmth" value={clip.dreamy_glow.warmth} min={0} max={1} step={0.01} defaultValue={DEFAULT_DREAMY_GLOW.warmth} unit="%" factor={100} onChange={(warmth, group) => onChange({ dreamy_glow: { ...clip.dreamy_glow!, warmth } }, group)}/></More>
      <button className="ed-button wide" onClick={() => onChange({ dreamy_glow: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ dreamy_glow: { ...DEFAULT_DREAMY_GLOW } })}>Add dreamy glow</button>}
    </Group>
    <Group pro title="Duotone and split-tone" tab="effects" startOpen={Boolean(clip.tone_grade)} changed={Boolean(clip.tone_grade)} keywords="duotone split tone grade teal orange gold sepia colour two colours" tip="Split-tone tints shadows and highlights; duotone paints the whole picture in two colours.">
    {clip.tone_grade ? <>
      <Chips label="Style" options={[{ id: 'split' as const, label: 'Split-tone' }, { id: 'duotone' as const, label: 'Duotone' }]} value={clip.tone_grade.mode} onPick={(mode) => onChange({ tone_grade: { ...clip.tone_grade!, mode } })}/>
      <Chips label="Colours" options={TONE_PRESETS.map((preset) => ({ id: preset.id as string, label: preset.label }))} value={TONE_PRESETS.find((preset) => preset.shadow === clip.tone_grade!.shadow && preset.highlight === clip.tone_grade!.highlight)?.id ?? null} onPick={(id) => { const preset = TONE_PRESETS.find((each) => each.id === id)!; onChange({ tone_grade: { ...clip.tone_grade!, shadow: preset.shadow, highlight: preset.highlight } }); }}/>
      <ValueSlider label="Strength" value={clip.tone_grade.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_TONE_GRADE.intensity} unit="%" factor={100} onChange={(intensity, group) => onChange({ tone_grade: { ...clip.tone_grade!, intensity } }, group)}/>
      <More>
        <label className="ed-field">Shadows <input type="color" value={clip.tone_grade.shadow} onChange={(event) => onChange({ tone_grade: { ...clip.tone_grade!, shadow: event.target.value } }, 'tone-shadow')}/></label>
        <label className="ed-field">Highlights <input type="color" value={clip.tone_grade.highlight} onChange={(event) => onChange({ tone_grade: { ...clip.tone_grade!, highlight: event.target.value } }, 'tone-highlight')}/></label>
        <ValueSlider label="Balance" value={clip.tone_grade.balance} min={0} max={1} step={0.01} defaultValue={DEFAULT_TONE_GRADE.balance} unit="%" factor={100} onChange={(balance, group) => onChange({ tone_grade: { ...clip.tone_grade!, balance } }, group)}/>
      </More>
      <button className="ed-button wide" onClick={() => onChange({ tone_grade: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ tone_grade: { ...DEFAULT_TONE_GRADE } })}>Add a two-colour grade</button>}
    </Group>
    <Group pro title="Tilt-shift" tab="effects" startOpen={Boolean(clip.tilt_shift)} changed={Boolean(clip.tilt_shift)} keywords="tilt shift miniature toy model blur band city" tip="Works best on scenes filmed from high up: city streets, markets, trains.">
    {clip.tilt_shift ? <>
      <ValueSlider label="Sharp at" value={clip.tilt_shift.focus_y} min={0} max={1} step={0.01} defaultValue={DEFAULT_TILT_SHIFT.focus_y} unit="%" factor={100} onChange={(focus_y, group) => onChange({ tilt_shift: { ...clip.tilt_shift!, focus_y } }, group)}/>
      <ValueSlider label="Sharp band" value={clip.tilt_shift.band} min={0.02} max={0.8} step={0.01} defaultValue={DEFAULT_TILT_SHIFT.band} unit="%" factor={100} onChange={(band, group) => onChange({ tilt_shift: { ...clip.tilt_shift!, band } }, group)}/>
      <ValueSlider label="Blur" value={clip.tilt_shift.blur} min={0} max={1} step={0.01} defaultValue={DEFAULT_TILT_SHIFT.blur} unit="%" factor={100} onChange={(blur, group) => onChange({ tilt_shift: { ...clip.tilt_shift!, blur } }, group)}/>
      <More><ValueSlider label="Colour boost" value={clip.tilt_shift.saturation} min={0} max={1} step={0.01} defaultValue={DEFAULT_TILT_SHIFT.saturation} unit="%" factor={100} onChange={(saturation, group) => onChange({ tilt_shift: { ...clip.tilt_shift!, saturation } }, group)}/></More>
      <button className="ed-button wide" onClick={() => onChange({ tilt_shift: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ tilt_shift: { ...DEFAULT_TILT_SHIFT } })}>Add tilt-shift</button>}
    </Group>
    <Group pro title="Mirror and kaleidoscope" tab="effects" startOpen={Boolean(clip.mirror)} changed={Boolean(clip.mirror)} keywords="mirror reflect symmetry kaleidoscope pattern wedges" tip="Mirror reflects one half onto the other; kaleidoscope turns the picture into mirrored wedges.">
    {clip.mirror ? <>
      <Chips label="Kind" options={[{ id: 'left' as const, label: 'Left' }, { id: 'top' as const, label: 'Top' }, { id: 'quad' as const, label: 'Four ways' }, { id: 'kaleido' as const, label: 'Kaleidoscope' }]} value={clip.mirror.mode} onPick={(mode) => onChange({ mirror: { ...clip.mirror!, mode } })}/>
      {clip.mirror.mode === 'kaleido' && <>
        <ValueSlider label="Wedges" value={clip.mirror.segments} min={3} max={12} step={1} defaultValue={DEFAULT_MIRROR.segments} onChange={(segments, group) => onChange({ mirror: { ...clip.mirror!, segments: Math.round(segments) } }, group)}/>
        <ValueSlider label="Turn" value={clip.mirror.angle} min={-180} max={180} step={1} defaultValue={0} unit="°" onChange={(angle, group) => onChange({ mirror: { ...clip.mirror!, angle } }, group)}/>
      </>}
      <button className="ed-button wide" onClick={() => onChange({ mirror: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ mirror: { ...DEFAULT_MIRROR } })}>Add mirror</button>}
    </Group>
    <Group pro title="Zoom blur" tab="effects" startOpen={Boolean(clip.zoom_blur)} changed={Boolean(clip.zoom_blur)} keywords="zoom blur radial rush speed punch" tip="Streaks towards a centre. Short clips and quick cuts suit it best.">
    {clip.zoom_blur ? <>
      <ValueSlider label="Strength" value={clip.zoom_blur.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_ZOOM_BLUR.intensity} unit="%" factor={100} onChange={(intensity, group) => onChange({ zoom_blur: { ...clip.zoom_blur!, intensity } }, group)}/>
      <More>
        <ValueSlider label="Centre across" value={clip.zoom_blur.center_x} min={0} max={1} step={0.01} defaultValue={0.5} unit="%" factor={100} onChange={(center_x, group) => onChange({ zoom_blur: { ...clip.zoom_blur!, center_x } }, group)}/>
        <ValueSlider label="Centre down" value={clip.zoom_blur.center_y} min={0} max={1} step={0.01} defaultValue={0.5} unit="%" factor={100} onChange={(center_y, group) => onChange({ zoom_blur: { ...clip.zoom_blur!, center_y } }, group)}/>
      </More>
      <button className="ed-button wide" onClick={() => onChange({ zoom_blur: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ zoom_blur: { ...DEFAULT_ZOOM_BLUR } })}>Add zoom blur</button>}
    </Group>
    <Group pro title="Echo trail" tab="effects" startOpen={Boolean(clip.echo)} changed={Boolean(clip.echo)} keywords="echo ghost trail smear dance motion blur light trails" tip="Ghosts of the last moments follow movement. The preview shows it once its copy is made in the background.">
    {clip.echo ? <>
      <Chips label="Kind" options={[{ id: 'echo' as const, label: 'Echo' }, { id: 'smear' as const, label: 'Light smear' }]} value={clip.echo.mode} onPick={(mode) => onChange({ echo: { ...clip.echo!, mode } })}/>
      {clip.echo.mode === 'echo' && <ValueSlider label="Trails" value={clip.echo.trails} min={2} max={8} step={1} defaultValue={DEFAULT_ECHO.trails} onChange={(trails, group) => onChange({ echo: { ...clip.echo!, trails: Math.round(trails) } }, group)}/>}
      <ValueSlider label="Linger" value={clip.echo.decay} min={0.2} max={0.95} step={0.05} defaultValue={DEFAULT_ECHO.decay} unit="%" factor={100} onChange={(decay, group) => onChange({ echo: { ...clip.echo!, decay: Math.round(decay * 100) / 100 } }, group)}/>
      {!copyReady && <p className="ed-tip" role="status">Preparing the echo trail… the preview shows it when ready; the export always has it.</p>}
      {Boolean(clip.cutout) && <p className="ed-tip">With a background effect on, the preview leaves out the echo; the export has both.</p>}
      <button className="ed-button wide" onClick={() => onChange({ echo: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ echo: { ...DEFAULT_ECHO } })}>Add echo trail</button>}
    </Group>
    <Group pro title="Beat pulse" tab="effects" startOpen={Boolean(clip.beat_pulse)} changed={Boolean(clip.beat_pulse)} keywords="beat pulse music rhythm zoom reels bpm" tip="Push the picture gently on each beat. Match Tempo to the song for clean synchronization.">
    {clip.beat_pulse ? <>
      <ValueSlider label="Strength" value={clip.beat_pulse.strength} min={0} max={1} step={0.01} defaultValue={DEFAULT_BEAT_PULSE.strength} unit="%" factor={100} onChange={(strength, group) => onChange({ beat_pulse: { ...clip.beat_pulse!, strength } }, group)}/>
      <ValueSlider label="Tempo" value={clip.beat_pulse.bpm} min={30} max={300} step={1} defaultValue={DEFAULT_BEAT_PULSE.bpm} unit=" BPM" onChange={(bpm, group) => onChange({ beat_pulse: { ...clip.beat_pulse!, bpm } }, group)}/>
      <More>
        <ValueSlider label="Pulse size" value={clip.beat_pulse.size} min={0.005} max={0.15} step={0.005} defaultValue={DEFAULT_BEAT_PULSE.size} unit="%" factor={100} decimals={1} onChange={(size, group) => onChange({ beat_pulse: { ...clip.beat_pulse!, size } }, group)}/>
        <ValueSlider label="First beat" value={clip.beat_pulse.offset} min={0} max={Math.min(60, clipLength(clip))} step={0.01} defaultValue={0} unit="s" decimals={2} onChange={(offset, group) => onChange({ beat_pulse: { ...clip.beat_pulse!, offset } }, group)}/>
      </More>
      <button className="ed-button wide" onClick={() => onChange({ beat_pulse: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ beat_pulse: { ...DEFAULT_BEAT_PULSE } })}>Add beat pulse</button>}
    </Group>
    <Group title="Old film" tab="effects" startOpen={Boolean(clip.old_film)} changed={Boolean(clip.old_film)} keywords="old film vintage grain scratches dust gate weave projector" tip="Distress the picture like aged film stock. Preview and export use the same clip settings.">
    {clip.old_film ? <>
      <ValueSlider label="Intensity" value={clip.old_film.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_OLD_FILM.intensity} unit="%" factor={100} onChange={(intensity, group) => onChange({ old_film: { ...clip.old_film!, intensity } }, group)}/>
      <ValueSlider label="Grain" value={clip.old_film.grain} min={0} max={1} step={0.01} defaultValue={DEFAULT_OLD_FILM.grain} unit="%" factor={100} onChange={(grain, group) => onChange({ old_film: { ...clip.old_film!, grain } }, group)}/>
      <More>
        <ValueSlider label="Scratches" value={clip.old_film.scratches} min={0} max={1} step={0.01} defaultValue={DEFAULT_OLD_FILM.scratches} unit="%" factor={100} onChange={(scratches, group) => onChange({ old_film: { ...clip.old_film!, scratches } }, group)}/>
        <ValueSlider label="Dust" value={clip.old_film.dust} min={0} max={1} step={0.01} defaultValue={DEFAULT_OLD_FILM.dust} unit="%" factor={100} onChange={(dust, group) => onChange({ old_film: { ...clip.old_film!, dust } }, group)}/>
        <ValueSlider label="Gate weave" value={clip.old_film.weave} min={0} max={1} step={0.01} defaultValue={DEFAULT_OLD_FILM.weave} unit="%" factor={100} onChange={(weave, group) => onChange({ old_film: { ...clip.old_film!, weave } }, group)}/>
      </More>
      <button className="ed-button wide" onClick={() => onChange({ old_film: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ old_film: DEFAULT_OLD_FILM })}>Add old film</button>}
    </Group>
    <Group title="Signal damage" tab="effects" startOpen={Boolean(clip.signal_damage)} changed={Boolean(clip.signal_damage)} keywords="glitch rgb split vhs tape scanlines jitter noise retro" tip="Break up the clip like a digital signal or worn VHS tape.">
    {clip.signal_damage ? <>
      <Chips label="Style" options={[{ id: 'glitch' as const, label: 'Glitch' }, { id: 'vhs' as const, label: 'VHS' }]} value={clip.signal_damage.mode} onPick={(mode) => onChange({ signal_damage: { ...clip.signal_damage!, mode } })}/>
      <ValueSlider label="Intensity" value={clip.signal_damage.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_SIGNAL_DAMAGE.intensity} unit="%" factor={100} onChange={(intensity, group) => onChange({ signal_damage: { ...clip.signal_damage!, intensity } }, group)}/>
      <ValueSlider label="RGB separation" value={clip.signal_damage.rgb_split} min={0} max={1} step={0.01} defaultValue={DEFAULT_SIGNAL_DAMAGE.rgb_split} unit="%" factor={100} onChange={(rgb_split, group) => onChange({ signal_damage: { ...clip.signal_damage!, rgb_split } }, group)}/>
      <More>
        <ValueSlider label="Horizontal jitter" value={clip.signal_damage.jitter} min={0} max={1} step={0.01} defaultValue={DEFAULT_SIGNAL_DAMAGE.jitter} unit="%" factor={100} onChange={(jitter, group) => onChange({ signal_damage: { ...clip.signal_damage!, jitter } }, group)}/>
        <ValueSlider label="Scanlines" value={clip.signal_damage.scanlines} min={0} max={1} step={0.01} defaultValue={DEFAULT_SIGNAL_DAMAGE.scanlines} unit="%" factor={100} onChange={(scanlines, group) => onChange({ signal_damage: { ...clip.signal_damage!, scanlines } }, group)}/>
        <ValueSlider label="Noise" value={clip.signal_damage.noise} min={0} max={1} step={0.01} defaultValue={DEFAULT_SIGNAL_DAMAGE.noise} unit="%" factor={100} onChange={(noise, group) => onChange({ signal_damage: { ...clip.signal_damage!, noise } }, group)}/>
      </More>
      <button className="ed-button wide" onClick={() => onChange({ signal_damage: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ signal_damage: DEFAULT_SIGNAL_DAMAGE })}>Add signal damage</button>}
    </Group>
    <Group title="Lens surface" tab="effects" startOpen={Boolean(clip.lens_surface)} changed={Boolean(clip.lens_surface)} keywords="lens dirt raindrops water glass refraction droplets" tip="Put dirt or refracting water drops on the camera lens.">
    {clip.lens_surface ? <>
      <Chips label="Surface" options={[{ id: 'raindrops' as const, label: 'Raindrops' }, { id: 'dirt' as const, label: 'Lens dirt' }]} value={clip.lens_surface.mode} onPick={(mode) => onChange({ lens_surface: { ...clip.lens_surface!, mode } })}/>
      <ValueSlider label="Intensity" value={clip.lens_surface.intensity} min={0} max={1} step={0.01} defaultValue={DEFAULT_LENS_SURFACE.intensity} unit="%" factor={100} onChange={(intensity, group) => onChange({ lens_surface: { ...clip.lens_surface!, intensity } }, group)}/>
      <ValueSlider label="Amount" value={clip.lens_surface.amount} min={0} max={1} step={0.01} defaultValue={DEFAULT_LENS_SURFACE.amount} unit="%" factor={100} onChange={(amount, group) => onChange({ lens_surface: { ...clip.lens_surface!, amount } }, group)}/>
      <More>
        <ValueSlider label="Refraction" value={clip.lens_surface.refraction} min={0} max={1} step={0.01} defaultValue={DEFAULT_LENS_SURFACE.refraction} unit="%" factor={100} onChange={(refraction, group) => onChange({ lens_surface: { ...clip.lens_surface!, refraction } }, group)}/>
        <ValueSlider label="Softness" value={clip.lens_surface.softness} min={0} max={1} step={0.01} defaultValue={DEFAULT_LENS_SURFACE.softness} unit="%" factor={100} onChange={(softness, group) => onChange({ lens_surface: { ...clip.lens_surface!, softness } }, group)}/>
      </More>
      <button className="ed-button wide" onClick={() => onChange({ lens_surface: null })}>Turn off</button>
    </> : <button className="ed-button wide" onClick={() => onChange({ lens_surface: DEFAULT_LENS_SURFACE })}>Add lens surface</button>}
    </Group>
    {source?.kind === 'video' && <Group pro title="Background" tab="background" startOpen changed={Boolean(clip.cutout)} keywords="blur background portrait remove replace focus bokeh cut out person who stays" tip="Blur or remove what's behind people, and choose who stays sharp." help="background-blur-remove">
      <Chips label="Background" options={[{ id: 'keep' as const, label: 'Keep' }, { id: 'blur' as const, label: 'Blur' }, { id: 'remove' as const, label: 'Remove' }]} value={clip.cutout ?? 'keep'} onPick={(id) => onChange(id === 'keep' ? { cutout: null, cutout_pick: null, focus_pull: null } : id === 'remove' ? { cutout: id, focus_pull: null } : { cutout: id })}/>
      {clip.cutout === 'blur' && <div className="ed-strength"><span className="ed-who-title">Blur strength</span><Chips label="Blur strength" options={BLUR_AMOUNTS} value={clip.blur_amount ?? 'medium'} onPick={(blur_amount) => onChange({ blur_amount })}/></div>}
      {clip.cutout && (clip.cutout_pick?.kind === 'land' ? <p className="ed-tip">Everything but the sky stays, found in every frame.</p> : <WhoStays clip={clip} onChange={onChange} local={local} sourceDuration={source?.duration}/>)}
      {clip.cutout === 'remove' && <div className="ed-strength"><span className="ed-who-title">New background</span>
        {backgrounds.length ? <div className="ed-media-grid ed-backgrounds">{backgrounds.map((item) => <button key={item.id} className="ed-tile-add" onClick={() => onBackground(item)} title={`Put ${item.filename} behind, filling the frame`}><img src={photoThumbUrl(item.id)} alt="" loading="lazy"/><span className="ed-tile-label"><b>{item.filename}</b></span></button>)}</div>
          : <p className="ed-tip">Import a picture or video in Media, then choose it here.</p>}
        <p className="ed-tip">It fills the whole frame, behind {isMain ? 'this clip' : 'the cut-out'}. A shorter video plays slower to cover it.</p></div>}
      {clip.cutout && <p className="ed-tip">{!copyReady ? `${clip.cutout === 'blur' ? `Making the ${clip.focus_pull ? 'focus pull' : `${clip.blur_amount ?? 'medium'} blur`}` : `Finding ${clip.cutout_pick?.kind === 'objects' ? 'the objects' : clip.cutout_pick?.ids ? 'the chosen people' : 'the person'}`}… This runs in the background${clip.cutout === 'blur' ? '; the preview keeps the previous blur until the new one is ready' : ', and the preview shows the original until it is ready'}.`
        : clip.cutout === 'blur' ? 'Who you choose stays sharp and everything else is softened, like a film camera focused on them.' : isMain ? 'The person shows over black until you choose a new background below.' : 'The person shows over whatever is under this layer.'}</p>}
    </Group>}
    <Group pro title="Brand watermark" tab="background" changed={clipBrandMarks.length > 0} keywords="logo watermark brand mark corner badge overlay" tip="A logo shown only while this clip plays. On the timeline it is an ordinary overlay: drag it, trim it or delete it." help="brand-watermark">
      {clipBrandMarks.length > 0 && <div className="ed-add-row"><span>{clipBrandMarks.length === 1 ? `1 logo over this clip` : `${clipBrandMarks.length} logos over this clip`}</span></div>}
      {clipBrandMarks.map((mark) => <div className="ed-add-row" key={mark.id}><span>{mark.name}</span><button className="ed-button small" onClick={() => onRemoveClipBrand(mark.id)}>Remove</button></div>)}
      {logos.length ? <div className="ed-media-grid ed-backgrounds">{logos.map((item) => <button key={item.id} className="ed-tile-add" onClick={() => onClipBrand(item)} title={`Put ${item.filename} over this clip`}><img src={photoThumbUrl(item.id)} alt="" loading="lazy"/><span className="ed-tile-label"><b>{item.filename}</b></span></button>)}</div>
        : <p className="ed-tip">Import the logo in Media, then pick it here. A transparent PNG looks best.</p>}
      {logos.length > 0 && <p className="ed-tip">Top right, for this clip's length. A whole-video mark lives in Project settings.</p>}
    </Group>
    <Group pro title="Green screen" tab="background" startOpen={Boolean(clip.chroma) || source?.kind !== 'video'} changed={Boolean(clip.chroma)} keywords="green screen chroma key transparent blue" tip="Click the green or blue in the preview to make it see-through." help="green-screen">
    {clip.chroma ? <>
      <div className="ed-key-color"><label><span className="ed-key-swatch" style={{ background: clip.chroma.color }}/><input type="color" aria-label="Colour to remove" value={clip.chroma.color} onChange={(event) => onChange({ chroma: { ...clip.chroma!, color: event.target.value } }, `key-colour-${clip.id}`)}/></label>
        <button className={`ed-button ${picking ? 'on' : ''}`} onClick={onPick}><Pipette size={14}/>{picking ? 'Click the preview' : 'Pick from preview'}</button></div>
      <ValueSlider label="Strength" value={clip.chroma.similarity} min={0.001} max={0.5} step={0.001} defaultValue={DEFAULT_CHROMA.similarity} unit="%" factor={100} decimals={1} onChange={(similarity, group) => onChange({ chroma: { ...clip.chroma!, similarity } }, group)}/>
      <ValueSlider label="Soft edges" value={clip.chroma.softness} min={0.001} max={0.5} step={0.001} defaultValue={DEFAULT_CHROMA.softness} unit="%" factor={100} decimals={1} onChange={(softness, group) => onChange({ chroma: { ...clip.chroma!, softness } }, group)}/>
      <ValueSlider label="Clean up green edges" value={clip.chroma.spill} min={0} max={1} step={0.01} defaultValue={DEFAULT_CHROMA.spill} unit="%" factor={100} onChange={(spill, group) => onChange({ chroma: { ...clip.chroma!, spill } }, group)}/>
      <button className="ed-button wide" onClick={() => onChange({ chroma: null })}>Turn off</button>
    </> : <>
      <p className="ed-tip">Removes a green or blue screen. Add the clip as an overlay to put something behind it.</p>
      <button className="ed-button wide" onClick={() => { onChange({ chroma: DEFAULT_CHROMA }); onPick(); }}><Pipette size={14}/>Remove a colour</button>
    </>}
    </Group>
    <Group title="Animation" tab="motion" startOpen changed={Boolean(clip.enter || clip.exit)} keywords="animation entrance exit enter fade slide" tip="How the clip appears and leaves." help="animations-and-moves">
    {transition && <p className="ed-tip">This clip opens with a {transition.kind} transition — set in the Transitions tab.</p>}
    {transition ? <p className="ed-tip">The transition replaces this clip's enter animation.</p> : <AnimationPicker label="Enter" value={clip.enter} onChange={(enter, group) => onChange({ enter }, group)} onShow={onShowEnter}/>}
    {closesWithTransition ? <p className="ed-tip">The next clip's transition replaces this clip's exit animation.</p> : <AnimationPicker label="Exit" value={clip.exit} onChange={(exit, group) => onChange({ exit }, group)} onShow={onShowExit}/>}
    </Group>
    <Group title="Moves" tab="motion" startOpen changed={Object.keys(clip.transform.keyframes ?? {}).length > 0} keywords="zoom in push pull shake move keyframe position size tilt see-through animate" tip="A gentle zoom in one click; More lets you animate anything." help="animations-and-moves">
    <div className="ed-chips" role="group" aria-label="Quick moves">{MOVES.map((move) => <button key={move.id} title={move.tip} onClick={() => onMove(move.id)}>{move.label}</button>)}</div>
    <More label="Animate position, size and more">
    <MotionPanel transform={clip.transform} local={local} length={(clip.out - clip.in) / clip.speed} onChange={(transform, group) => onChange({ transform }, group)} onSeek={onSeekLocal} onGestureStart={onPause}/>
    </More>
    </Group>
    {follow && <Group title="Follow movement" tab="motion" startOpen keywords="track follow stick moving person" tip="Draw a box around something and this follows it as it moves." help="follow-movement">{follow}</Group>}
    {source?.kind === 'video' && clip.freeze == null && <Group title="Speed and sound" tab="sound" startOpen changed={clip.speed !== 1 || clip.muted || clip.volume !== 1 || clip.fade_in > 0 || clip.fade_out > 0 || Boolean(clip.reverse)} keywords="volume mute louder quiet slow motion fast reverse backwards noise clean voice speed" tip="Loudness and speed; Clean voice removes fan and AC hum." help="speed-and-sound">
      <button className={`ed-button wide ${clip.muted ? 'on' : ''}`} onClick={() => onChange({ muted: !clip.muted })}>{clip.muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}{clip.muted ? 'Muted' : 'Mute this clip'}</button>
      <SoundControls item={clip} length={(clip.out - clip.in) / clip.speed} onChange={onChange}/>
      <ValueSlider label={clip.ramp ? 'Overall speed' : 'Speed'} value={clip.speed} min={0.25} max={4} step={0.05} defaultValue={1} unit="×" decimals={2} onChange={(speed, group) => onChange({ speed }, group)}/>
      <More>
      <h3 className="ed-sub">Speed effect</h3>
      <Chips label="Speed ramp" options={RAMP_CHOICES} value={rampName(clip.ramp)} onPick={(id) => onChange({ ramp: id === 'off' ? null : RAMPS[id] })}/>
      {clip.ramp && <><RampCurve ramp={clip.ramp} at={local / ((clip.out - clip.in) / clip.speed)}/><p className="ed-tip">A ramp has no sound. Slow parts smoothen best from 60 or 120 fps footage.</p></>}
      {isMain && <label className="ed-check"><input type="checkbox" checked={Boolean(clip.reverse)} onChange={(event) => onChange({ reverse: event.target.checked })}/><span>Play backwards<small>{clip.reverse && !copyReady ? 'Making a reversed copy… The preview plays forwards until it is ready.' : 'Sound is off while a clip plays backwards.'}</small></span></label>}
      <label className="ed-check"><input type="checkbox" checked={Boolean(clip.clean_voice)} onChange={(event) => onChange({ clean_voice: event.target.checked })}/><span>Clean voice<small>Removes steady background noise like fans, AC and hiss. Made once, in the background.</small></span></label>
      {canDetach && <button className="ed-button wide" onClick={onDetach}><AudioLines size={15}/>Move sound to its own track</button>}
      </More>
    </Group>}
    </Panel>
  </>;
}
