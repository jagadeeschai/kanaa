import { animatedLook, dipWeights, LOOKS, REST, WHIP_BLUR, type Look } from '../timeline/animation';
import { keyChroma, keyKind, toHex } from '../timeline/chroma';
import { valueAt } from '../timeline/evaluate';
import { AudioMixer } from './audio';
import { blurGrid, BLUR_FEATHER, BLUR_REACH } from '../timeline/blur';
import { rampShare, rampSpeed } from '../timeline/ramp';
import { litWord } from '../timeline/captions';
import { REST_TRANSFORM, clipLength, duration, fittedSize, transitionHalf, type BlurLayer, type Caption, type CaptionLayer, type Clip, type Sound, type TextItem, type TextLayer, type Timeline, type VideoLayer } from '../timeline/model';

/** `reversed` marks the clip's reversed copy, which runs from the source's end; `duration` is the source's. */
export type PlaybackSource = { url: string; kind: 'video' | 'image'; width: number; height: number; duration?: number | null; reversed?: boolean };
type Slot = { video: HTMLVideoElement; texture: WebGLTexture; clipId: string | null; url: string | null; fresh: boolean };
type LayerSlots = { slots: [Slot, Slot] };
type Crossing = { before: Clip; after: Clip; p: number };
type Pose = { look?: Look; opacity?: number; scale?: number; sideways?: boolean };

const DRIFT_RESEEK_SECONDS = 0.25;
const DRIFT_NUDGE_SECONDS = 0.02;
const MAX_NUDGE = 0.05;
const SEEK_NUDGE_SECONDS = 0.25 / 30;
const MAX_BUFFER_SIDE = 1280;

const BLEND_NUMBERS = { normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5 };
const STRUGGLE_WINDOW_MS = 5000;
const STRUGGLE_EVENTS = 6;
const SLOW_FRAME_MS = 100;
const THROTTLED_FRAME_MS = 900; // A hidden page updates about once a second, which isn't the project's fault.
const MIN_ZOOM = 0.02;
const BLUR_TAPS = 24;
const smoothstep = (low: number, high: number, x: number) => { const t = Math.min(1, Math.max(0, (x - low) / (high - low))); return t * t * (3 - 2 * t); };

const VERTEX = `#version 300 es
in vec2 p; out vec2 uv; uniform vec4 box; uniform float turn; uniform vec2 frame;
void main(){ uv=p; vec2 d=(p-.5)*box.zw*frame; float c=cos(turn), s=sin(turn);
  vec2 pos=box.xy+vec2(d.x*c-d.y*s, d.x*s+d.y*c)/frame; gl_Position=vec4(pos.x*2.-1.,1.-pos.y*2.,0,1); }`;
const FRAGMENT = `#version 300 es
precision highp float; in vec2 uv; out vec4 color; uniform sampler2D tex;
uniform float opacity, brightness, contrast, saturation, blur; uniform int rotation, blendMode, keyType; uniform sampler2D backdrop; uniform vec2 keyColor; uniform float keySimilarity, keySoftness, keySpill; uniform vec2 flip, blurAspect; uniform vec3 tint; uniform int hideMode, hideShape; uniform float hideAmount; uniform vec2 pixelGrid; uniform vec4 fill;
vec4 pick(vec2 at){
  vec4 c=texture(tex,at);
  if (keyType > 0) {
    // ffmpeg's chromakey: distance in BT.709 limited-range chroma, over the square root of two. Then its despill.
    float l = dot(c.rgb, vec3(.2126, .7152, .0722));
    vec2 chroma = vec2((128. + 224. * (c.b - l) / 1.8556) / 255., (128. + 224. * (c.r - l) / 1.5748) / 255.);
    c.a *= clamp((length(chroma - keyColor) / 1.41421356 - keySimilarity) / keySoftness, 0., 1.);
    if (keyType == 1) c.g -= max(c.g - (c.r + c.b) * .5, 0.) * keySpill;
    else c.b -= max(c.b - (c.r + c.g) * .5, 0.) * keySpill;
  }
  c.rgb*=c.a; return c;
}
// A blur box: the picture under it, blurred or in blocks, inside a soft oval or box. Matches blur_filters in timeline_service.py.
vec4 hidden(){
  vec2 size = vec2(textureSize(backdrop, 0));
  vec2 at = gl_FragCoord.xy / size;
  vec3 rgb = vec3(0.);
  if (hideMode == 1) {
    float total = 0.;
    for (int i = 0; i < 64; i++) {
      float r = sqrt((float(i) + .5) / 64.) * 2.5; float a = float(i) * 2.399963;
      float w = exp(-.5 * r * r); rgb += texture(backdrop, at + vec2(cos(a), sin(a)) * r * hideAmount * vec2(size.y / size.x, 1.)).rgb * w; total += w;
    }
    rgb /= total;
  } else {
    vec2 cell = floor(vec2(at.x, 1. - at.y) * pixelGrid);
    for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) { vec2 f = (cell + (vec2(i, j) + .5) / 4.) / pixelGrid; rgb += texture(backdrop, vec2(f.x, 1. - f.y)).rgb; }
    rgb /= 16.;
  }
  vec2 d = uv * 2. - 1.;
  float a = clamp((1. - (hideShape == 0 ? length(d) : max(abs(d.x), abs(d.y)))) / ${BLUR_FEATHER}, 0., 1.) * opacity;
  return vec4(rgb * a, a);
}
void main(){
  if (fill.a > 0.) { color = vec4(fill.rgb * fill.a, fill.a); return; }
  if (hideMode > 0) { color = hidden(); return; }
  vec2 q = mix(uv, 1. - uv, flip);
  vec2 s = rotation==90 ? vec2(q.y, 1.-q.x) : rotation==180 ? 1.-q : rotation==270 ? vec2(1.-q.y, q.x) : q;
  vec4 c = pick(s);
  if (blur > 0.) {
    // A Gaussian-weighted spiral. One pass, and close enough to the export's Gaussian blur for a moving frame.
    float total = 1.; const float tau = 6.2831853;
    for (int i = 0; i < ${BLUR_TAPS}; i++) {
      float r = sqrt((float(i) + .5) / ${BLUR_TAPS}.) * 2.2; float a = float(i) * 2.399963;
      vec2 at = s + vec2(cos(a), sin(a)) * r * blur * blurAspect;
      float w = exp(-.5 * r * r); c += pick(at) * w; total += w;
    }
    c /= total;
  }
  float alpha = c.a; vec3 rgb = alpha > 0. ? c.rgb / alpha : vec3(0.);
  rgb = rgb * brightness * tint;
  rgb = (clamp(rgb, 0., 1.) - .5) * contrast + .5;
  float luma = dot(clamp(rgb, 0., 1.), vec3(.2126, .7152, .0722));
  rgb = clamp(mix(vec3(luma), clamp(rgb, 0., 1.), saturation), 0., 1.);
  float a = alpha * opacity;
  if (blendMode > 0) {
    vec3 b = texture(backdrop, gl_FragCoord.xy / vec2(textureSize(backdrop, 0))).rgb;
    if (blendMode == 1) rgb = b * rgb;
    else if (blendMode == 2) rgb = 1. - (1. - b) * (1. - rgb);
    else if (blendMode == 3) rgb = mix(2. * b * rgb, 1. - 2. * (1. - b) * (1. - rgb), step(.5, b));
    else if (blendMode == 4) rgb = min(b, rgb);
    else rgb = max(b, rgb);
  }
  color = vec4(rgb * a, a);
}`;

/** Draws the timeline to a canvas and keeps video in step with one clock. Lives outside React. */
export class PlaybackEngine {
  readonly mixer = new AudioMixer();
  private soundUrl: (sound: Sound) => string | undefined = () => undefined;
  /** The cleaned sound of a video, once it is ready. */
  cleanVoice: (mediaId: number) => string | undefined = () => undefined;
  private textUrl: (text: TextItem) => string | undefined = () => undefined;
  private captionUrl: (layer: CaptionLayer, caption: Caption, lit: number | null) => string | undefined = () => undefined;
  private stopAt = Infinity;
  private gl: WebGL2RenderingContext;
  private backdrop!: WebGLTexture;
  private struggles: number[] = [];
  private warned = false;
  private lastTick = 0;
  onStruggling: () => void = () => {};
  private unkeyedClip: string | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private layers = new Map<string, LayerSlots>();
  private images = new Map<string, { texture: WebGLTexture; ready: boolean }>();
  private timeline: Timeline | null = null;
  private sources: (mediaId: number, clip?: Clip) => PlaybackSource | undefined = () => undefined;
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
    for (const name of ['box', 'opacity', 'brightness', 'contrast', 'saturation', 'rotation', 'flip', 'tint', 'blur', 'blurAspect', 'turn', 'frame', 'blendMode', 'backdrop', 'keyType', 'keyColor', 'keySimilarity', 'keySoftness', 'keySpill', 'hideMode', 'hideShape', 'hideAmount', 'pixelGrid', 'fill']) this.uniforms[name] = gl.getUniformLocation(program, name);
    this.backdrop = this.newTexture();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
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

  setTimeline(timeline: Timeline, sources: (mediaId: number, clip?: Clip) => PlaybackSource | undefined, soundUrl: (sound: Sound) => string | undefined, textUrl: (text: TextItem) => string | undefined = () => undefined, captionUrl: (layer: CaptionLayer, caption: Caption, lit: number | null) => string | undefined = () => undefined) {
    this.timeline = timeline;
    this.textUrl = textUrl;
    this.captionUrl = captionUrl;
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
    const last = clips[clips.length - 1];
    if (last && t >= duration(this.timeline!) && last.start + clipLength(last) >= t - 0.001) return { clip: last };
    return { next: clips.find((clip) => clip.start > t) };
  }

  private sorted(layer: VideoLayer) { return [...layer.items].sort((a, b) => a.start - b.start); }

  private crossing(layer: VideoLayer, t: number): Crossing | null {
    const clips = this.sorted(layer);
    for (let index = 1; index < clips.length; index += 1) {
      const half = transitionHalf(clips[index - 1], clips[index], this.timeline!.format.fps) / this.timeline!.format.fps;
      if (half && t >= clips[index].start - half && t < clips[index].start + half) return { before: clips[index - 1], after: clips[index], p: (t - clips[index].start + half) / (2 * half) };
    }
    return null;
  }

  private sourceTime(clip: Clip, t: number, inside = true) {
    if (clip.freeze != null) return clip.freeze;
    const local = t - clip.start;
    const at = inside ? Math.max(0, Math.min(local, clipLength(clip) - 0.001)) : local;
    const into = clip.ramp ? rampShare(clip.ramp, at / clipLength(clip)) * (clip.out - clip.in) : at * clip.speed;
    const source = this.sources(clip.media_id, clip);
    // The reversed copy runs from the source's end, so in..out is the mirrored stretch of it.
    if (source?.reversed) return Math.max(0, (source.duration ?? clip.out) - clip.out + into);
    return Math.max(0, clip.in + into);
  }

  /** How fast the source plays at `t`: the clip's speed, shaped by its ramp. */
  private rateAt(clip: Clip, t: number) {
    return clip.speed * (clip.ramp ? rampSpeed(clip.ramp, Math.min(1, Math.max(0, (t - clip.start) / clipLength(clip)))) : 1);
  }

  private load(slot: Slot, clip: Clip, url: string, at: number) {
    if (slot.url !== url) { slot.url = url; slot.video.src = url; }
    // A quarter frame in, as the export reads, so a time right on a frame's edge can't show the frame before.
    const target = at + SEEK_NUDGE_SECONDS;
    if (slot.clipId !== clip.id || Math.abs(slot.video.currentTime - target) > 0.04) slot.video.currentTime = target;
    slot.clipId = clip.id;
  }

  private syncSlots() {
    const t = this.time;
    for (const layer of this.videoLayers()) {
      const { slots } = this.slotsFor(layer);
      const { clip, next } = this.clipFor(layer, t);
      const crossing = this.crossing(layer, t);
      const wanted = crossing ? [crossing.before, crossing.after] : clip ? [clip] : [];
      const used: Slot[] = [];
      for (const item of wanted) {
        const source = this.sources(item.media_id, item);
        if (source?.kind === 'image') this.imageTexture(source.url);
        if (source?.kind !== 'video') continue;
        const slot = slots.find((entry) => entry.clipId === item.id) ?? slots.find((entry) => !used.includes(entry) && !wanted.some((other) => other.id === entry.clipId) && entry.clipId !== next?.id) ?? slots.find((entry) => !used.includes(entry))!;
        used.push(slot);
        const at = this.sourceTime(item, t, !crossing);
        if (slot.clipId !== item.id || !this.playing) this.load(slot, item, source.url, at);
        slot.video.muted = false;
        // A clip with Clean voice is heard from its cleaned copy, played by the mixer, so the video itself stays silent.
        const cleaned = Boolean(item.clean_voice && this.cleanVoice(item.media_id));
        if (this.playing) this.mixer.setVideoGain(slot.video, item === clip && !cleaned ? this.mixer.clipGain(item, t, Boolean(layer.muted)) : 0);
        // While playing, keepInStep owns the rate. Setting it here too would undo each nudge.
        if (slot.video.paused) slot.video.playbackRate = Math.min(16, Math.max(0.0625, this.rateAt(item, t) * this.rate));
        const finished = slot.video.duration > 0 && at >= slot.video.duration - 0.05;
        const still = item.freeze != null;
        if (this.playing && slot.video.paused && !finished && !still) void slot.video.play().catch(() => {});
        if ((!this.playing || still) && !slot.video.paused) slot.video.pause();
        if (still && this.playing && Math.abs(slot.video.currentTime - at) > 0.02) slot.video.currentTime = at;
      }
      const spare = slots.find((entry) => !used.includes(entry));
      if (spare && !spare.video.paused) spare.video.pause();
      const nextSource = next && this.sources(next.media_id, next);
      if (spare && next && nextSource?.kind === 'video' && spare.clipId !== next.id) {
        spare.video.muted = true;
        const half = clip ? transitionHalf(clip, next, this.timeline!.format.fps) / this.timeline!.format.fps : 0;
        this.load(spare, next, nextSource.url, Math.max(0, this.sourceTime(next, next.start - half, false)));
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

  private bindClip(layer: VideoLayer, clip: Clip, source: PlaybackSource): boolean {
    const { gl } = this;
    if (source.kind === 'video') {
      const slot = this.slotsFor(layer).slots.find((entry) => entry.clipId === clip.id);
      if (!slot || slot.video.readyState < 2) return false;
      gl.bindTexture(gl.TEXTURE_2D, slot.texture);
      if (slot.fresh) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, slot.video); slot.fresh = false; }
      return true;
    }
    const image = this.imageTexture(source.url);
    if (!image.ready) return false;
    gl.bindTexture(gl.TEXTURE_2D, image.texture);
    return true;
  }

  private drawClip(layer: VideoLayer, clip: Clip, { look = REST, opacity = 1, scale: zoom = 1, sideways = false }: Pose) {
    const { gl, uniforms } = this;
    const { format } = this.timeline!;
    const source = this.sources(clip.media_id, clip);
    if (!source || !this.bindClip(layer, clip, source)) return;
    const local = this.time - clip.start;
    const frame = look.scale * zoom;
    const moved = look.scale !== 1 || look.dx !== 0 || look.dy !== 0;
    const scale = valueAt(clip.transform, 'scale', local) * frame;
    const fitted = fittedSize(source, clip.adjust.rotation, format);
    const [red, green, blue, contrast, saturation] = LOOKS[clip.look ?? 'none'];
    const height = fitted.height * scale;
    // The clip is cropped to the frame, and that whole frame moves, as in the export.
    const centerX = 0.5 + look.dx; const centerY = 0.5 + look.dy;
    if (moved) {
      const { width: w, height: h } = this.canvas;
      gl.enable(gl.SCISSOR_TEST);
      const left = Math.max(0, (centerX - frame / 2) * w); const right = Math.min(w, (centerX + frame / 2) * w);
      const top = Math.max(0, (centerY - frame / 2) * h); const bottom = Math.min(h, (centerY + frame / 2) * h);
      gl.scissor(Math.round(left), Math.round(h - bottom), Math.max(0, Math.round(right - left)), Math.max(0, Math.round(bottom - top)));
    }
    gl.uniform4f(uniforms.box, centerX + (valueAt(clip.transform, 'x', local) - 0.5) * frame, centerY + (valueAt(clip.transform, 'y', local) - 0.5) * frame, (fitted.width * scale) / format.width, height / format.height);
    gl.uniform1f(uniforms.turn, (valueAt(clip.transform, 'rotation', local) * Math.PI) / 180);
    const key = clip.id === this.unkeyedClip ? null : clip.chroma;
    gl.uniform1i(uniforms.keyType, key ? keyKind(key.color) : 0);
    if (key) {
      gl.uniform2f(uniforms.keyColor, ...keyChroma(key.color));
      gl.uniform1f(uniforms.keySimilarity, key.similarity);
      gl.uniform1f(uniforms.keySoftness, key.softness);
      gl.uniform1f(uniforms.keySpill, key.spill);
    }
    gl.uniform2f(uniforms.frame, format.width, format.height);
    gl.uniform1f(uniforms.opacity, Math.max(0, Math.min(1, valueAt(clip.transform, 'opacity', local))) * look.opacity * opacity);
    gl.uniform1f(uniforms.brightness, clip.adjust.brightness);
    gl.uniform1f(uniforms.contrast, clip.adjust.contrast * contrast);
    gl.uniform1f(uniforms.saturation, clip.adjust.saturation * saturation);
    gl.uniform3f(uniforms.tint, red, green, blue);
    gl.uniform1f(uniforms.blur, look.blur * (format.height / height));
    gl.uniform2f(uniforms.blurAspect, height / (fitted.width * scale), sideways ? 0 : 1);
    gl.uniform1i(uniforms.rotation, clip.adjust.rotation);
    gl.uniform2f(uniforms.flip, clip.adjust.flip_horizontal ? 1 : 0, clip.adjust.flip_vertical ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (moved) gl.disable(gl.SCISSOR_TEST);
  }

  private drawCrossing(layer: VideoLayer, { before, after, p }: Crossing) {
    const { gl, canvas } = this;
    const kind = after.transition_in!.kind;
    const remaining = 1 - p;
    if (kind === 'wipe') {
      gl.enable(gl.SCISSOR_TEST);
      const edge = Math.round(canvas.width * remaining);
      gl.scissor(0, 0, edge, canvas.height);
      this.drawClip(layer, before, {});
      gl.scissor(edge, 0, canvas.width - edge, canvas.height);
      this.drawClip(layer, after, {});
      gl.disable(gl.SCISSOR_TEST);
      return;
    }
    if (kind === 'slide' || kind === 'whip') {
      // A whip is a slide with a sideways blur that peaks halfway, as the export blurs the joined frames.
      const blur = kind === 'whip' ? WHIP_BLUR * Math.sin(Math.PI * p) : 0;
      this.drawClip(layer, before, { look: { ...REST, dx: -p, blur }, sideways: true });
      this.drawClip(layer, after, { look: { ...REST, dx: remaining, blur }, sideways: true });
      return;
    }
    if (kind === 'flash' || kind === 'dip') {
      const [old, fresh, colour] = dipWeights(p);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.drawClip(layer, before, { opacity: old });
      this.drawClip(layer, after, { opacity: fresh });
      if (kind === 'flash') this.drawFill([1, 1, 1], colour);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      return;
    }
    // Two weights that add to one, on black, as xfade mixes them.
    gl.blendFunc(gl.ONE, gl.ONE);
    if (kind === 'crossfade') {
      this.drawClip(layer, before, { opacity: remaining });
      this.drawClip(layer, after, { opacity: p });
    } else {
      const weight = smoothstep(0, 0.5, remaining);
      this.drawClip(layer, before, { opacity: weight, scale: 1 / Math.max(MIN_ZOOM, smoothstep(0.5, 1, remaining)) });
      this.drawClip(layer, after, { opacity: 1 - weight });
    }
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** The shader needs what is under the layer so far. */
  private copyBackdrop() {
    const { gl, uniforms } = this;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backdrop);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, this.canvas.width, this.canvas.height, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(uniforms.backdrop, 1);
  }

  /** A flat colour over the whole frame, `amount` strong. */
  private drawFill([red, green, blue]: [number, number, number], amount: number) {
    const { gl, uniforms } = this;
    gl.uniform4f(uniforms.box, 0.5, 0.5, 1, 1);
    gl.uniform1f(uniforms.turn, 0);
    gl.uniform4f(uniforms.fill, red, green, blue, amount);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.uniform4f(uniforms.fill, 0, 0, 0, 0);
  }

  private drawLayer(layer: VideoLayer) {
    const { gl, uniforms } = this;
    const mode = BLEND_NUMBERS[layer.blend ?? 'normal'];
    if (mode) this.copyBackdrop();
    gl.uniform1i(uniforms.blendMode, mode);
    this.drawLayerClips(layer);
    gl.uniform1i(uniforms.blendMode, 0);
  }

  private drawLayerClips(layer: VideoLayer) {
    const crossing = this.crossing(layer, this.time);
    if (crossing) { this.drawCrossing(layer, crossing); return; }
    const { clip } = this.clipFor(layer, this.time);
    if (!clip) return;
    const { format } = this.timeline!;
    const clips = this.sorted(layer);
    const index = clips.findIndex((item) => item.id === clip.id);
    const opensWithTransition = index > 0 && transitionHalf(clips[index - 1], clip, format.fps) > 0;
    const closesWithTransition = index + 1 < clips.length && transitionHalf(clip, clips[index + 1], format.fps) > 0;
    this.drawClip(layer, clip, { look: animatedLook(opensWithTransition ? null : clip.enter, closesWithTransition ? null : clip.exit, this.time - clip.start, clipLength(clip)) });
  }

  /** The caption on now, with the word being spoken lit. Drawn from the export's own text images. */
  private drawCaptions(layer: CaptionLayer) {
    const { gl, uniforms } = this;
    const item = layer.items.find((entry) => this.time >= entry.start && this.time < entry.start + entry.length);
    if (!item) return;
    const url = this.captionUrl(layer, item, layer.highlight ? litWord(item, this.time - item.start) : null);
    const image = url && this.imageTexture(url);
    if (!image || !image.ready) return;
    gl.bindTexture(gl.TEXTURE_2D, image.texture);
    gl.uniform4f(uniforms.box, 0.5, 0.5, 1, 1);
    gl.uniform1f(uniforms.turn, 0);
    gl.uniform1i(uniforms.keyType, 0);
    gl.uniform1f(uniforms.opacity, 1);
    gl.uniform1f(uniforms.brightness, 1); gl.uniform1f(uniforms.contrast, 1); gl.uniform1f(uniforms.saturation, 1);
    gl.uniform3f(uniforms.tint, 1, 1, 1);
    gl.uniform1f(uniforms.blur, 0);
    gl.uniform1i(uniforms.rotation, 0);
    gl.uniform2f(uniforms.flip, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawText(layer: TextLayer) {
    const { gl, uniforms } = this;
    const item = layer.items.find((entry) => this.time >= entry.start && this.time < entry.start + entry.length);
    const url = item && this.textUrl(item);
    if (!item || !url) return;
    const image = this.imageTexture(url);
    if (!image.ready) return;
    gl.bindTexture(gl.TEXTURE_2D, image.texture);
    const local = this.time - item.start;
    const look = animatedLook(item.enter, item.exit, local, item.length);
    const { width, height } = this.timeline!.format;
    // The title's own move first, then its animation moves that whole frame, as the export's pose() does.
    const transform = item.transform ?? REST_TRANSFORM;
    const size = valueAt(transform, 'scale', local) * look.scale;
    gl.uniform4f(uniforms.box, 0.5 + look.dx + (valueAt(transform, 'x', local) - 0.5) * look.scale, 0.5 + look.dy + (valueAt(transform, 'y', local) - 0.5) * look.scale, size, size);
    gl.uniform1f(uniforms.turn, (valueAt(transform, 'rotation', local) * Math.PI) / 180);
    gl.uniform2f(uniforms.frame, width, height);
    gl.uniform1i(uniforms.keyType, 0);
    gl.uniform1f(uniforms.opacity, look.opacity * Math.max(0, Math.min(1, valueAt(transform, 'opacity', local))));
    gl.uniform1f(uniforms.brightness, 1); gl.uniform1f(uniforms.contrast, 1); gl.uniform1f(uniforms.saturation, 1);
    gl.uniform3f(uniforms.tint, 1, 1, 1);
    gl.uniform1f(uniforms.blur, look.blur / size);
    gl.uniform2f(uniforms.blurAspect, height / width, 1);
    gl.uniform1i(uniforms.rotation, 0);
    gl.uniform2f(uniforms.flip, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawBlur(layer: BlurLayer) {
    const { gl, uniforms } = this;
    const item = layer.items.find((entry) => this.time >= entry.start && this.time < entry.start + entry.length);
    if (!item) return;
    const local = this.time - item.start;
    const scale = valueAt(item.transform, 'scale', local);
    this.copyBackdrop();
    gl.uniform4f(uniforms.box, valueAt(item.transform, 'x', local), valueAt(item.transform, 'y', local), item.width * scale, item.height * scale);
    gl.uniform1f(uniforms.turn, 0);
    gl.uniform2f(uniforms.frame, this.timeline!.format.width, this.timeline!.format.height);
    gl.uniform1f(uniforms.opacity, 1);
    gl.uniform1i(uniforms.hideMode, item.style === 'pixelate' ? 2 : 1);
    gl.uniform1i(uniforms.hideShape, item.shape === 'oval' ? 0 : 1);
    gl.uniform1f(uniforms.hideAmount, item.amount * BLUR_REACH);
    gl.uniform2f(uniforms.pixelGrid, ...blurGrid(item.amount, this.timeline!.format));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.uniform1i(uniforms.hideMode, 0);
  }

  private draw() {
    const { gl } = this;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.timeline) return;
    for (const layer of this.timeline.layers) {
      if (layer.hidden) continue;
      if (layer.kind === 'video') this.drawLayer(layer);
      else if (layer.kind === 'text') this.drawText(layer);
      else if (layer.kind === 'blur') this.drawBlur(layer);
      else if (layer.kind === 'captions') this.drawCaptions(layer);
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
    if (!this.timeline) return;
    // Clips with Clean voice join the mix as sounds at their own place and speed, from their cleaned copies.
    const voices: Sound[] = this.videoLayers().flatMap((layer) => layer.items.filter((clip) => clip.clean_voice && clip.freeze == null && !clip.reverse && !clip.ramp && this.cleanVoice(clip.media_id)).map((clip) => ({
      id: `${clip.id}:voice`, media_id: clip.media_id, start: clip.start, in: clip.in, out: clip.out, speed: clip.speed, volume: clip.volume, muted: clip.muted || Boolean(layer.muted),
      fade_in: clip.fade_in, fade_out: clip.fade_out, duck: false, name: '', clean_voice: true })));
    const timeline = voices.length ? { ...this.timeline, layers: [...this.timeline.layers, { id: 'clean-voices', kind: 'audio' as const, items: voices }] } : this.timeline;
    this.mixer.sync(timeline, this.time, this.playing, this.rate, (sound) => (sound.id.endsWith(':voice') && sound.media_id !== undefined ? this.cleanVoice(sound.media_id) : this.soundUrl(sound)));
  }

  /** While picking a colour, this clip shows unkeyed, so the colour under the click is its own. */
  showUnkeyed(clipId: string | null) { this.unkeyedClip = clipId; this.requestDraw(); }

  /** The average colour around a point in the preview, from 0 to 1 across and down. */
  sampleColor(x: number, y: number) {
    const { gl, canvas } = this;
    this.draw();
    const size = 5;
    const left = Math.max(0, Math.min(canvas.width - size, Math.round(x * canvas.width) - 2));
    const bottom = Math.max(0, Math.min(canvas.height - size, Math.round((1 - y) * canvas.height) - 2));
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(left, bottom, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const total = [0, 0, 0];
    pixels.forEach((value, index) => { if (index % 4 < 3) total[index % 4] += value; });
    return toHex(total.map((value) => value / (size * size)));
  }

  private struggled() {
    const now = performance.now();
    this.struggles = [...this.struggles.filter((time) => now - time < STRUGGLE_WINDOW_MS), now];
    if (this.struggles.length >= STRUGGLE_EVENTS && !this.warned) { this.warned = true; this.onStruggling(); }
  }

  private startClock() {
    this.clockStart = performance.now();
    this.clockBase = this.time;
  }

  private keepInStep() {
    for (const layer of this.videoLayers()) {
      const crossing = this.crossing(layer, this.time);
      const { clip } = this.clipFor(layer, this.time);
      for (const item of crossing ? [crossing.before, crossing.after] : clip ? [clip] : []) {
        const slot = this.slotsFor(layer).slots.find((entry) => entry.clipId === item.id);
        if (!slot || slot.video.paused) continue;
        const at = this.sourceTime(item, this.time, !crossing);
        const drift = slot.video.currentTime - at;
        if (Math.abs(drift) > DRIFT_RESEEK_SECONDS * this.rate) { slot.video.currentTime = at; this.struggled(); }
        else {
          const nudge = Math.abs(drift) > DRIFT_NUDGE_SECONDS ? -Math.sign(drift) * Math.min(MAX_NUDGE, Math.abs(drift)) : 0;
          const wanted = Math.min(16, Math.max(0.0625, this.rateAt(item, this.time) * this.rate * (1 + nudge)));
          if (Math.abs(slot.video.playbackRate - wanted) > 0.001) slot.video.playbackRate = wanted;
        }
      }
    }
  }

  /** Plays one stretch and stops, to show what a preset does. */
  playRange(start: number, end: number) {
    this.seek(start);
    this.play();
    this.stopAt = end;
  }

  play(rate = 1) {
    if (!this.timeline || duration(this.timeline) === 0) return;
    this.stopAt = Infinity;
    this.lastTick = 0;
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
    const stamp = performance.now();
    const gap = stamp - this.lastTick;
    if (this.lastTick && gap > SLOW_FRAME_MS && gap < THROTTLED_FRAME_MS) this.struggled();
    this.lastTick = stamp;
    const end = duration(this.timeline);
    this.time = this.clockBase + ((performance.now() - this.clockStart) / 1000) * this.rate;
    if (this.time >= this.stopAt) { this.onTime(this.time); this.pause(); return; }
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
