import { presetSteps, type AudioPresetId, type AudioStep } from '../timeline/audioPresets';
import { audioLayers, fadeGain, soundLength, type Clip, type Sound, type Timeline } from '../timeline/model';

const DRIFT_RESEEK_SECONDS = 0.25;
const DRIFT_NUDGE_SECONDS = 0.02;
const MAX_NUDGE = 0.05;
const LOAD_AHEAD_SECONDS = 2;
// Matches DUCK_THRESHOLD and DUCK_RATIO in timeline_service.py.
const DUCK_THRESHOLD = 0.02;
const DUCK_RATIO = 2;
const DUCK_ATTACK = 0.02;
const DUCK_RELEASE = 0.4;

/** A source wired through its preset nodes (EQ, compressor) into its gain; rewired when the presets change. */
type Chain = { source: MediaElementAudioSourceNode; gain: GainNode; nodes: AudioNode[]; key: string };
type Player = Chain & { element: HTMLAudioElement; url: string; /** The auto-duck dip, after the volume. */ dip: GainNode };

const COMPRESSOR_MAKEUP_DB = 4.55;

/** One preset step as a Web Audio node, matching audio_presets.step_filter. A compressor's output is its `out`. */
export function stepNode(context: AudioContext, step: AudioStep): AudioNode {
  if (step.type === 'compressor') {
    const node = context.createDynamicsCompressor();
    node.threshold.value = step.threshold; node.ratio.value = step.ratio; node.attack.value = step.attack; node.release.value = step.release; node.knee.value = step.knee;
    // Web Audio's compressor adds its own make-up gain; ffmpeg's acompressor (makeup=1) does not. Taken back out, so
    // quiet parts stay as they were in both (measured: +4.55 dB for these settings).
    const back = context.createGain();
    back.gain.value = 10 ** (-COMPRESSOR_MAKEUP_DB / 20);
    node.connect(back);
    return Object.assign(node, { out: back });
  }
  const node = context.createBiquadFilter();
  node.type = step.type; node.frequency.value = step.frequency;
  if (step.type === 'highpass') node.Q.value = Math.SQRT1_2;
  else { node.gain.value = step.gain; if (step.type === 'peaking') node.Q.value = step.q; }
  return node;
}


function wire(context: AudioContext, chain: Chain, presets: readonly AudioPresetId[] | undefined) {
  const key = (presets ?? []).join(',');
  if (key === chain.key) return;
  chain.source.disconnect();
  for (const node of chain.nodes) { node.disconnect(); (node as AudioNode & { out?: AudioNode }).out?.disconnect(); }
  chain.nodes = presetSteps(presets).map((step) => stepNode(context, step));
  const outOf = (node: AudioNode) => (node as AudioNode & { out?: AudioNode }).out ?? node;
  const last = chain.nodes.reduce<AudioNode>((from, to) => { from.connect(to); return outOf(to); }, chain.source);
  last.connect(chain.gain);
  chain.key = key;
}

export { DUCK_PRESETS, duckGain, duckSettings } from '../timeline/ducking';
import { duckGain, duckSettings } from '../timeline/ducking';

/** Mixes preview sound with Web Audio. Video elements feed it too, so ducking hears their sound. */
export class AudioMixer {
  private context: AudioContext | null = null;
  private main!: GainNode;
  private under!: GainNode;
  /** Sounds that dip by an auto-duck preset (each on its own), kept out of the meter like `under`. */
  private apart!: GainNode;
  private meter!: AnalyserNode;
  private samples = new Float32Array(1024);
  private players = new Map<string, Player>();
  private videos = new WeakMap<HTMLVideoElement, Chain>();

  /** Must first be called from a click: browsers keep audio off until then. */
  private ensure(): AudioContext {
    if (this.context) return this.context;
    const context = new AudioContext();
    this.main = context.createGain();
    this.under = context.createGain();
    this.apart = context.createGain();
    this.meter = context.createAnalyser();
    this.meter.fftSize = this.samples.length;
    this.main.connect(context.destination);
    this.main.connect(this.meter);
    this.under.connect(context.destination);
    this.apart.connect(context.destination);
    this.context = context;
    return context;
  }

  resume() { void this.ensure().resume(); }

  setVideoGain(video: HTMLVideoElement, volume: number, presets?: readonly AudioPresetId[]) {
    const context = this.ensure();
    let chain = this.videos.get(video);
    if (!chain) {
      chain = { source: context.createMediaElementSource(video), gain: context.createGain(), nodes: [], key: '-' };
      chain.gain.connect(this.main);
      this.videos.set(video, chain);
    }
    wire(context, chain, presets);
    chain.gain.gain.setTargetAtTime(volume, context.currentTime, 0.008);
  }

  clipGain(clip: Clip, t: number, layerMuted: boolean) {
    const length = (clip.out - clip.in) / clip.speed;
    return clip.muted || layerMuted || clip.freeze != null || clip.reverse || clip.ramp ? 0 : clip.volume * fadeGain(clip, t - clip.start, length);
  }

  private player(sound: Sound, url: string): Player {
    const context = this.ensure();
    let player = this.players.get(sound.id);
    if (!player) {
      const element = new Audio();
      element.preload = 'auto';
      player = { element, source: context.createMediaElementSource(element), gain: context.createGain(), dip: context.createGain(), nodes: [], key: '-', url: '' };
      player.gain.connect(player.dip);
      this.players.set(sound.id, player);
    }
    wire(context, player, sound.audio_presets);
    // Ducked sounds go to `under`, so the meter (on `main`) hears only the other sound; a preset dips each on its own.
    player.dip.disconnect();
    player.dip.connect(!sound.duck ? this.main : sound.duck_preset ? this.apart : this.under);
    if (player.url !== url) { player.url = url; player.element.src = url; }
    return player;
  }

  sync(timeline: Timeline, t: number, playing: boolean, rate: number, urlFor: (sound: Sound) => string | undefined) {
    if (!this.context && !playing) return;
    const context = this.ensure();
    const wanted = new Set<string>();
    const peak = this.peak();
    for (const layer of audioLayers(timeline)) {
      for (const sound of layer.items) {
        const length = soundLength(sound);
        const url = urlFor(sound);
        if (!url || t >= sound.start + length || t < sound.start - LOAD_AHEAD_SECONDS) continue;
        wanted.add(sound.id);
        const player = this.player(sound, url);
        const active = t >= sound.start;
        const at = sound.in + Math.max(0, t - sound.start) * sound.speed;
        const drift = player.element.currentTime - at;
        let nudge = 0;
        if (!playing || !active) { if (Math.abs(drift) > 0.04) player.element.currentTime = at; }
        else if (Math.abs(drift) > DRIFT_RESEEK_SECONDS * rate * sound.speed) player.element.currentTime = at;
        else if (Math.abs(drift) > DRIFT_NUDGE_SECONDS) nudge = -Math.sign(drift) * Math.min(MAX_NUDGE, Math.abs(drift));
        player.element.playbackRate = sound.speed * rate * (1 + nudge);
        const dip = duckSettings(sound);
        const dipTo = dip && playing ? duckGain(peak, dip.threshold, dip.depth) : 1;
        // Down over the fade, back up over twice it: attack and release, as the export's compressor.
        if (dip) player.dip.gain.setTargetAtTime(dipTo, context.currentTime, Math.max(0.01, dipTo < player.dip.gain.value ? dip.fade : dip.fade * 2) / 3);
        else player.dip.gain.setTargetAtTime(1, context.currentTime, 0.008);
        player.gain.gain.setTargetAtTime(active && !sound.muted && !layer.muted ? sound.volume * (layer.volume ?? 1) * fadeGain(sound, t - sound.start, length) : 0, context.currentTime, 0.008);
        if (playing && active && player.element.paused) void player.element.play().catch(() => {});
        if ((!playing || !active) && !player.element.paused) player.element.pause();
      }
    }
    for (const [id, player] of this.players) {
      if (wanted.has(id)) continue;
      player.element.pause();
      player.dip.disconnect();
      player.element.removeAttribute('src');
      player.element.load();
      this.players.delete(id);
    }
    if (playing) this.duck(context, peak);  // The original gentle dip, for ducked sounds without a preset.
    else this.under.gain.setTargetAtTime(1, context.currentTime, DUCK_RELEASE);
  }

  private peak() {
    this.meter.getFloatTimeDomainData(this.samples);
    return this.samples.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);
  }

  private duck(context: AudioContext, peak: number) {
    const over = peak > DUCK_THRESHOLD ? 20 * Math.log10(peak / DUCK_THRESHOLD) : 0;
    const target = 10 ** (-(over * (1 - 1 / DUCK_RATIO)) / 20);
    this.under.gain.setTargetAtTime(target, context.currentTime, target < this.under.gain.value ? DUCK_ATTACK : DUCK_RELEASE);
  }

  destroy() {
    for (const player of this.players.values()) { player.element.pause(); player.element.removeAttribute('src'); player.element.load(); }
    this.players.clear();
    void this.context?.close();
    this.context = null;
  }
}
