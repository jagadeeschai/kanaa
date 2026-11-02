import { valueAt } from '../timeline/evaluate';
import { AudioMixer } from './audio';
import { clipLength, duration, fittedSize, type Clip, type Sound, type Timeline, type VideoLayer } from '../timeline/model';

export type PlaybackSource = { url: string; kind: 'video' | 'image'; width: number; height: number };
type Slot = { video: HTMLVideoElement; texture: WebGLTexture; clipId: string | null; url: string | null; fresh: boolean };
type LayerSlots = { slots: [Slot, Slot] };

const DRIFT_RESEEK_SECONDS = 0.25;
const DRIFT_NUDGE_SECONDS = 0.02;
const MAX_NUDGE = 0.05;
const MAX_BUFFER_SIDE = 1280;

const VERTEX = `#version 300 es
in vec2 p; out vec2 uv; uniform vec4 box;
void main(){ uv=p; vec2 pos=box.xy+(p-.5)*box.zw; gl_Position=vec4(pos.x*2.-1.,1.-pos.y*2.,0,1); }`;
const FRAGMENT = `#version 300 es
precision highp float; in vec2 uv; out vec4 color; uniform sampler2D tex;
uniform float opacity, brightness, contrast, saturation; uniform int rotation; uniform vec2 flip;
void main(){
  vec2 q = mix(uv, 1. - uv, flip);
  vec2 s = rotation==90 ? vec2(q.y, 1.-q.x) : rotation==180 ? 1.-q : rotation==270 ? vec2(1.-q.y, q.x) : q;
  vec3 c = texture(tex, s).rgb * brightness;
  c = (c - .5) * contrast + .5;
  float luma = dot(c, vec3(.2126, .7152, .0722));
  color = vec4(clamp(mix(vec3(luma), c, saturation), 0., 1.), opacity);
}`;

/** Draws the timeline to a canvas and keeps video in step with one clock. Lives outside React. */
export class PlaybackEngine {
  readonly mixer = new AudioMixer();
  private soundUrl: (sound: Sound) => string | undefined = () => undefined;
  private gl: WebGL2RenderingContext;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private layers = new Map<string, LayerSlots>();
  private images = new Map<string, { texture: WebGLTexture; ready: boolean }>();
  private timeline: Timeline | null = null;
  private sources: (mediaId: number) => PlaybackSource | undefined = () => undefined;
  private time = 0;
  private rate = 1;
  private clockStart = 0;
  private clockBase = 0;
  private frame = 0;
  private drawQueued = false;
  playing = false;
  onTime: (t: number) => void = () => {};
  onPlayingChange: (playing: boolean) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('This browser cannot show the preview. Try the latest Chrome.');
    this.gl = gl;
    const shader = (type: number, source: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, source); gl.compileShader(s); return s; };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    for (const name of ['box', 'opacity', 'brightness', 'contrast', 'saturation', 'rotation', 'flip']) this.uniforms[name] = gl.getUniformLocation(program, name);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private newTexture(): WebGLTexture {
    const { gl } = this;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private newSlot(): Slot {
    const video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    const slot: Slot = { video, texture: this.newTexture(), clipId: null, url: null, fresh: false };
    const watch = () => { slot.fresh = true; this.requestDraw(); video.requestVideoFrameCallback(watch); };
    video.requestVideoFrameCallback(watch);
    video.addEventListener('loadeddata', () => { slot.fresh = true; this.requestDraw(); });
    video.addEventListener('seeked', () => { slot.fresh = true; this.requestDraw(); });
    return slot;
  }

  private slotsFor(layer: VideoLayer): LayerSlots {
    let entry = this.layers.get(layer.id);
    if (!entry) { entry = { slots: [this.newSlot(), this.newSlot()] }; this.layers.set(layer.id, entry); }
    return entry;
  }

  setTimeline(timeline: Timeline, sources: (mediaId: number) => PlaybackSource | undefined, soundUrl: (sound: Sound) => string | undefined) {
    this.timeline = timeline;
    this.sources = sources;
    this.soundUrl = soundUrl;
    const { width, height } = timeline.format;
    const shrink = Math.min(1, MAX_BUFFER_SIDE / Math.max(width, height));
    this.canvas.width = Math.round(width * shrink);
    this.canvas.height = Math.round(height * shrink);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (this.time > duration(timeline)) this.time = duration(timeline);
    this.syncSlots();
    this.requestDraw();
  }

  get currentTime() { return this.time; }

  private videoLayers(): VideoLayer[] {
    return (this.timeline?.layers ?? []).filter((layer): layer is VideoLayer => layer.kind === 'video' && !layer.hidden);
  }

  private clipFor(layer: VideoLayer, t: number): { clip?: Clip; next?: Clip } {
    const clips = [...layer.items].sort((a, b) => a.start - b.start);
    const index = clips.findIndex((clip) => t >= clip.start && t < clip.start + clipLength(clip));
    if (index >= 0) return { clip: clips[index], next: clips[index + 1] };
    if (t >= duration(this.timeline!) && clips.length) return { clip: clips[clips.length - 1] };
    return { next: clips.find((clip) => clip.start > t) };
  }

  private sourceTime(clip: Clip, t: number) {
    return clip.in + Math.max(0, Math.min(t - clip.start, clipLength(clip) - 0.001)) * clip.speed;
  }

  private load(slot: Slot, clip: Clip, url: string, at: number) {
    if (slot.url !== url) { slot.url = url; slot.video.src = url; }
    if (slot.clipId !== clip.id || Math.abs(slot.video.currentTime - at) > 0.04) slot.video.currentTime = at;
    slot.clipId = clip.id;
  }

  private syncSlots() {
    const t = this.time;
    for (const layer of this.videoLayers()) {
      const { slots } = this.slotsFor(layer);
      const { clip, next } = this.clipFor(layer, t);
      const source = clip && this.sources(clip.media_id);
      let active: Slot | undefined;
      if (clip && source?.kind === 'video') {
        active = slots.find((slot) => slot.clipId === clip.id) ?? slots.find((slot) => slot.clipId !== next?.id) ?? slots[0];
        const at = this.sourceTime(clip, t);
        if (active.clipId !== clip.id || !this.playing) this.load(active, clip, source.url, at);
        active.video.muted = false;
        if (this.playing) this.mixer.setVideoGain(active.video, this.mixer.clipGain(clip, t, Boolean(layer.muted)));
        active.video.playbackRate = clip.speed * this.rate;
        if (this.playing && active.video.paused) void active.video.play().catch(() => {});
        if (!this.playing && !active.video.paused) active.video.pause();
      } else if (clip && source?.kind === 'image') this.imageTexture(source.url);
      const spare = slots.find((slot) => slot !== active);
      if (spare && !spare.video.paused) spare.video.pause();
      const nextSource = next && this.sources(next.media_id);
      if (spare && next && nextSource?.kind === 'video' && spare.clipId !== next.id) {
        spare.video.muted = true;
        this.load(spare, next, nextSource.url, next.in);
      }
    }
  }

  private imageTexture(url: string) {
    let entry = this.images.get(url);
    if (!entry) {
      entry = { texture: this.newTexture(), ready: false };
      this.images.set(url, entry);
      const image = new Image();
      image.onload = () => {
        const cached = this.images.get(url)!;
        this.gl.bindTexture(this.gl.TEXTURE_2D, cached.texture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image);
        cached.ready = true;
        this.requestDraw();
      };
      image.src = url;
    }
    return entry;
  }

  private requestDraw() {
    if (this.playing || this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => { this.drawQueued = false; this.draw(); });
  }

  private draw() {
    const { gl, uniforms } = this;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.timeline) return;
    const { format } = this.timeline;
    for (const layer of this.videoLayers()) {
      const { clip } = this.clipFor(layer, this.time);
      const source = clip && this.sources(clip.media_id);
      if (!clip || !source) continue;
      if (source.kind === 'video') {
        const slot = this.slotsFor(layer).slots.find((entry) => entry.clipId === clip.id);
        if (!slot || slot.video.readyState < 2) continue;
        gl.bindTexture(gl.TEXTURE_2D, slot.texture);
        if (slot.fresh) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, slot.video); slot.fresh = false; }
      } else {
        const image = this.imageTexture(source.url);
        if (!image.ready) continue;
        gl.bindTexture(gl.TEXTURE_2D, image.texture);
      }
      const local = this.time - clip.start;
      const scale = valueAt(clip.transform, 'scale', local);
      const fitted = fittedSize(source, clip.adjust.rotation, format);
      gl.uniform4f(uniforms.box, valueAt(clip.transform, 'x', local), valueAt(clip.transform, 'y', local), (fitted.width * scale) / format.width, (fitted.height * scale) / format.height);
      gl.uniform1f(uniforms.opacity, clip.transform.opacity);
      gl.uniform1f(uniforms.brightness, clip.adjust.brightness);
      gl.uniform1f(uniforms.contrast, clip.adjust.contrast);
      gl.uniform1f(uniforms.saturation, clip.adjust.saturation);
      gl.uniform1i(uniforms.rotation, clip.adjust.rotation);
      gl.uniform2f(uniforms.flip, clip.adjust.flip_horizontal ? 1 : 0, clip.adjust.flip_vertical ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  seek(t: number) {
    this.time = Math.max(0, Math.min(t, this.timeline ? duration(this.timeline) : 0));
    if (this.playing) this.startClock();
    this.syncSlots();
    this.syncSound();
    this.requestDraw();
    this.onTime(this.time);
  }

  private syncSound() {
    if (this.timeline) this.mixer.sync(this.timeline, this.time, this.playing, this.rate, this.soundUrl);
  }

  private startClock() {
    this.clockStart = performance.now();
    this.clockBase = this.time;
  }

  private keepInStep() {
    for (const layer of this.videoLayers()) {
      const { clip } = this.clipFor(layer, this.time);
      const slot = clip && this.slotsFor(layer).slots.find((entry) => entry.clipId === clip.id);
      if (!clip || !slot || slot.video.paused) continue;
      const drift = slot.video.currentTime - this.sourceTime(clip, this.time);
      if (Math.abs(drift) > DRIFT_RESEEK_SECONDS * this.rate) slot.video.currentTime = this.sourceTime(clip, this.time);
      else {
        const nudge = Math.abs(drift) > DRIFT_NUDGE_SECONDS ? -Math.sign(drift) * Math.min(MAX_NUDGE, Math.abs(drift)) : 0;
        slot.video.playbackRate = clip.speed * this.rate * (1 + nudge);
      }
    }
  }

  play(rate = 1) {
    if (!this.timeline || duration(this.timeline) === 0) return;
    this.rate = rate;
    if (this.time >= duration(this.timeline) - 0.01) this.time = 0;
    this.startClock();
    this.mixer.resume();
    if (!this.playing) {
      this.playing = true;
      this.onPlayingChange(true);
      this.frame = requestAnimationFrame(this.tick);
    }
    this.syncSlots();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.rate = 1;
    cancelAnimationFrame(this.frame);
    this.syncSlots();
    this.syncSound();
    this.onPlayingChange(false);
    this.requestDraw();
  }

  private tick = () => {
    if (!this.playing || !this.timeline) return;
    const end = duration(this.timeline);
    this.time = this.clockBase + ((performance.now() - this.clockStart) / 1000) * this.rate;
    if (this.time >= end) { this.time = end; this.onTime(end); this.pause(); return; }
    this.syncSlots();
    this.syncSound();
    this.keepInStep();
    this.draw();
    this.onTime(this.time);
    this.frame = requestAnimationFrame(this.tick);
  };

  destroy() {
    this.pause();
    this.mixer.destroy();
    for (const { slots } of this.layers.values()) for (const slot of slots) { slot.video.pause(); slot.video.removeAttribute('src'); slot.video.load(); }
    this.layers.clear();
  }
}
