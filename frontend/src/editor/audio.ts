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

type Player = { element: HTMLAudioElement; gain: GainNode; url: string };

/** Mixes preview sound with Web Audio. Video elements feed it too, so ducking hears their sound. */
export class AudioMixer {
  private context: AudioContext | null = null;
  private main!: GainNode;
  private under!: GainNode;
  private meter!: AnalyserNode;
  private samples = new Float32Array(1024);
  private players = new Map<string, Player>();
  private videos = new WeakMap<HTMLVideoElement, GainNode>();

  /** Must first be called from a click: browsers keep audio off until then. */
  private ensure(): AudioContext {
    if (this.context) return this.context;
    const context = new AudioContext();
    this.main = context.createGain();
    this.under = context.createGain();
    this.meter = context.createAnalyser();
    this.meter.fftSize = this.samples.length;
    this.main.connect(context.destination);
    this.main.connect(this.meter);
    this.under.connect(context.destination);
    this.context = context;
    return context;
  }

  resume() { void this.ensure().resume(); }

  setVideoGain(video: HTMLVideoElement, volume: number) {
    const context = this.ensure();
    let gain = this.videos.get(video);
    if (!gain) {
      gain = context.createGain();
      context.createMediaElementSource(video).connect(gain).connect(this.main);
      this.videos.set(video, gain);
    }
    gain.gain.setTargetAtTime(volume, context.currentTime, 0.008);
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
      const gain = context.createGain();
      context.createMediaElementSource(element).connect(gain);
      player = { element, gain, url: '' };
      this.players.set(sound.id, player);
    }
    player.gain.disconnect();
    player.gain.connect(sound.duck ? this.under : this.main);
    if (player.url !== url) { player.url = url; player.element.src = url; }
    return player;
  }

  sync(timeline: Timeline, t: number, playing: boolean, rate: number, urlFor: (sound: Sound) => string | undefined) {
    if (!this.context && !playing) return;
    const context = this.ensure();
    const wanted = new Set<string>();
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
        player.gain.gain.setTargetAtTime(active && !sound.muted && !layer.muted ? sound.volume * (layer.volume ?? 1) * fadeGain(sound, t - sound.start, length) : 0, context.currentTime, 0.008);
        if (playing && active && player.element.paused) void player.element.play().catch(() => {});
        if ((!playing || !active) && !player.element.paused) player.element.pause();
      }
    }
    for (const [id, player] of this.players) {
      if (wanted.has(id)) continue;
      player.element.pause();
      player.gain.disconnect();
      player.element.removeAttribute('src');
      player.element.load();
      this.players.delete(id);
    }
    if (playing) this.duck(context);
    else this.under.gain.setTargetAtTime(1, context.currentTime, DUCK_RELEASE);
  }

  private duck(context: AudioContext) {
    this.meter.getFloatTimeDomainData(this.samples);
    const peak = this.samples.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);
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
