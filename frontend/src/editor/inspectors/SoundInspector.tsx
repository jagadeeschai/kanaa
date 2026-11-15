import { useEditorPanel } from '../state/EditorContext';
import { SoundControls } from "./clip-parts";
import { Mic, LoaderCircle, Music, Volume2, VolumeX } from "lucide-react";
import { soundLength, type AudioLayer, type Sound } from "../../timeline/model";
import { ValueSlider, type TimeFieldProps } from "../controls";
import { Timing, timingSummary } from "../Timing";
import { Group, More, Panel } from "../layout";
import { AudioPresets } from './AudioPresetsGroup';

type StemChoice = 'music' | 'vocals' | 'both';

type StemJob = { soundId: string; jobId: string; choice: StemChoice; progress: number };

export type SoundInspectorBindings = { onLoop: (() => void) | null; looping: boolean; sound: Sound; timing: TimeFieldProps[]; layer: AudioLayer; onChange: (changes: Partial<Sound>, group?: string) => void; onLayer: (changes: Partial<AudioLayer>) => void;
  stems: { available: boolean; install_command: string } | null; job: StemJob | null; busy: boolean; onSeparate: (choice: StemChoice) => void; onCancelStems: () => void };

export function SoundInspector() {
  const { onLoop, looping, sound, timing, layer, onChange, onLayer, stems, job, busy, onSeparate, onCancelStems } = useEditorPanel<SoundInspectorBindings>('sound');
  return <Panel id="sound" tabs={[{ id: 'volume', label: 'Volume', Icon: Volume2, changed: sound.muted || sound.volume !== 1 || Boolean(sound.audio_presets?.length) }, { id: 'voice', label: 'Voice', Icon: Mic, changed: Boolean(sound.clean_voice) }]}>
    <p className="ed-name" title={sound.name}>{sound.name}</p>
    <Group title="Timing" summary={timingSummary(timing)} keywords="when start length duration trim loop repeat" help="timing-and-trimming">
    <Timing fields={timing}/>
    {onLoop && <><button className="ed-button wide" disabled={looping} onClick={onLoop} title="Repeats the song by whole bars, on the beat, until the video ends, then fades out">{looping ? <LoaderCircle className="spin" size={14}/> : <Music size={14}/>}{looping ? 'Finding the beat…' : 'Loop to the end of the video'}</button>
      <p className="ed-tip">The song ends early. Looping repeats it on the beat and fades at the end.</p></>}
    </Group>
    <Group title="Volume" tab="volume" startOpen keywords="volume mute louder quiet fade speed dip duck music" tip="Set loudness and fades; music dips by itself while people talk." help="music-volume-ducking">
    <div className="ed-pair">
      <button className={`ed-button ${sound.muted ? 'on' : ''}`} aria-pressed={sound.muted} onClick={() => onChange({ muted: !sound.muted })}>{sound.muted ? <VolumeX size={14}/> : <Volume2 size={14}/>}Mute</button>
    </div>
    <SoundControls item={sound} length={soundLength(sound)} onChange={onChange}/>
    <AudioPresets value={sound.audio_presets} onChange={(audio_presets) => onChange({ audio_presets })}/>
    <label className="ed-check"><input type="checkbox" checked={sound.duck} onChange={(event) => onChange({ duck: event.target.checked })}/><span>Dip under speech<small>Lowers this sound while your clips or other sounds play.</small></span></label>
      <More>
    <ValueSlider label="Speed" value={sound.speed} min={0.25} max={4} step={0.05} defaultValue={1} unit="×" decimals={2} onChange={(speed, group) => onChange({ speed }, group)}/>
      <div className="ed-pair"><button className={`ed-button ${layer.muted ? 'on' : ''}`} aria-pressed={Boolean(layer.muted)} onClick={() => onLayer({ muted: !layer.muted })}>Mute track</button></div>
      </More>
    </Group>
    <Group pro title="Voice" tab="voice" startOpen keywords="clean voice noise karaoke vocals instrumental singing remove" tip="Clean up a voice, or take the singing out of a song." help="voice-and-vocals">
    <label className="ed-check"><input type="checkbox" checked={Boolean(sound.clean_voice)} onChange={(event) => onChange({ clean_voice: event.target.checked })}/><span>Clean voice<small>Removes steady background noise like fans, AC and hiss. Made once, in the background.</small></span></label>
    {!stems?.available ? <p className="ed-tip">Voice separation is an optional add-on. To install it, run <code>{stems?.install_command ?? './install-stems.sh'}</code> in the Kanaa folder, then restart Kanaa.</p>
      : job ? <><div className="ed-progress"><i style={{ width: `${job.progress}%` }}/></div><p className="ed-tip">Separating… {job.progress}%. This can take a few minutes, and you can keep editing.</p><button className="ed-button wide" onClick={onCancelStems}>Cancel</button></>
        : <div className="ed-stack">
          <button className="ed-button wide" disabled={busy} onClick={() => onSeparate('music')}>Remove vocals</button>
          <button className="ed-button wide" disabled={busy} onClick={() => onSeparate('vocals')}>Keep only vocals</button>
          <button className="ed-button wide" disabled={busy} onClick={() => onSeparate('both')}>Split into two tracks</button>
        </div>}
    </Group>
  </Panel>;
}
