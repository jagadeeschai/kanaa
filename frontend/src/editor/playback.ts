import { animatedLook, dipWeights, LOOKS, REST, WHIP_BLUR, type Look } from '../timeline/animation';
import { keyChroma, keyKind, toHex } from '../timeline/chroma';
import { valueAt } from '../timeline/evaluate';
import { AudioMixer } from './audio';
import { blurGrid, BLUR_FEATHER, BLUR_REACH } from '../timeline/blur';
import { rampShare, rampSpeed } from '../timeline/ramp';
import { litWord } from '../timeline/captions';
import { lutAtlasUrl } from '../api/client';
import { REST_TRANSFORM, barShare, clipLength, duration, fittedSize, transitionHalf, type BlurLayer, type Caption, type ShapeMask, type CaptionLayer, type Clip, type Sound, type TextItem, type TextLayer, type Timeline, type VideoLayer } from '../timeline/model';
import { isBrandLayer } from '../timeline/brand';
import { alphaBox, corners, DEFAULT_DEPTH_ANGLE, homography, invert, is3d, layers, layerShade, poseAt, type Box, type Matrix, type Point } from '../timeline/title3d';

/** A title picture's letter box as shares of the picture (alphaBox in title3d.ts), so any size of the picture agrees. */
function pictureBox(image: HTMLImageElement): Box | null {
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || !canvas.width || !canvas.height) return null;
  context.drawImage(image, 0, 0);
  const box = alphaBox(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  return box && [box[0] / canvas.width, box[1] / canvas.height, box[2] / canvas.width, box[3] / canvas.height];
}

/** `reversed` marks the clip's reversed copy, which runs from the source's end; `duration` is the source's. */
export type PlaybackSource = { url: string; kind: 'video' | 'image'; width: number; height: number; duration?: number | null; reversed?: boolean; pendingCutout?: boolean };
type Slot = { video: HTMLVideoElement; texture: WebGLTexture; clipId: string | null; url: string | null; fresh: boolean };
type LayerSlots = { slots: [Slot, Slot] };
type Crossing = { before: Clip; after: Clip; p: number };
type Pose = { look?: Look; opacity?: number; scale?: number; sideways?: boolean };

const DRIFT_RESEEK_SECONDS = 0.25;
const DRIFT_NUDGE_SECONDS = 0.02;
const MAX_NUDGE = 0.05;
// A cut-out overlay (the see-through people copy) must sit exactly on the picture under it; it is silent, so
// snapping it is free. It is anchored to the base video element's actual position, not the master clock.
const OVERLAY_RESEEK_SECONDS = 0.04;
const OVERLAY_NUDGE = 0.5;
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
/** The cinematic finish over the whole frame. Matches finish_service.py: the same grade, glow, vignette, grain and bars. */
const FINISH_VERTEX = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p * 2. - 1., 0., 1.); }`;
const FINISH_FRAGMENT = `#version 300 es
precision highp float; out vec4 color; uniform sampler2D backdrop; uniform vec2 viewport;
uniform sampler2D lutTex; uniform int useLut; uniform float lutAmount;
uniform float grade, glow, vignette, grain, bars, seed;
float luma(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
vec3 lookup(vec3 c){ float n=float(textureSize(lutTex,0).y); float blue=clamp(c.b,0.,1.)*(n-1.); float lo=floor(blue), hi=min(n-1.,lo+1.);
  float y=(clamp(c.g,0.,1.)*(n-1.)+.5)/n; float red=clamp(c.r,0.,1.)*(n-1.);
  vec3 a=texture(lutTex,vec2((lo*n+red+.5)/(n*n),y)).rgb; vec3 b=texture(lutTex,vec2((hi*n+red+.5)/(n*n),y)).rgb; return mix(a,b,fract(blue)); }
vec3 tone(vec3 c){ float l = luma(c); float shadow = 1. - smoothstep(0., .55, l); float high = smoothstep(.45, 1., l);
  return clamp(c + grade * (shadow * vec3(-.06, .02, .07) + high * vec3(.08, .02, -.07)), 0., 1.); }
vec3 graded(vec2 at){ vec3 c=texture(backdrop,at).rgb; if(useLut==1)c=mix(c,lookup(c),lutAmount); return tone(c); }
float hash(vec2 q){ return fract(sin(dot(q, vec2(12.9898, 78.233)) + seed * 7.13) * 43758.5453); }
void main(){
  vec2 at = gl_FragCoord.xy / viewport; float aspect = viewport.x / viewport.y;
  vec3 c = graded(at);
  if (glow > 0.) {
    // The highlights, blurred: a Gaussian of sigma 3% of the height, sampled on a spiral.
    vec3 sum = vec3(0.); float total = 0.;
    for (int i = 0; i < 40; i++) {
      float r = sqrt((float(i) + .5) / 40.) * 2.5; float a = float(i) * 2.39996;
      vec2 off = vec2(cos(a), sin(a)) * r * .03 * vec2(1. / aspect, 1.);
      float w = exp(-.5 * r * r);
      sum += clamp((graded(at + off) - .5) * 2., 0., 1.) * w; total += w;
    }
    c = 1. - (1. - c) * (1. - sum / total * glow);
  }
  if (vignette > 0.) { vec2 d = (at - .5) * vec2(aspect, 1.); c *= 1. - vignette * smoothstep(.45, 1.05, length(d) / length(vec2(aspect, 1.) * .5)); }
  if (grain > 0.) c = clamp(c + (hash(floor(gl_FragCoord.xy)) - .5) * grain * .16, 0., 1.);
  if (at.y < bars || at.y > 1. - bars) c = vec3(0.);
  color = vec4(c, 1.);
}`;
/** A title in 3D: every frame pixel is taken back into the title picture through the inverse of its homography
 * (title3d.ts), so perspective is exact. Matches title3d_render.py, which warps the same way with OpenCV. */
const TITLE_FRAGMENT = `#version 300 es
precision highp float; out vec4 color; uniform sampler2D tex; uniform mat3 toPicture; uniform vec2 frame, viewport;
uniform vec4 bounds; uniform float opacity; uniform vec4 shade;
void main(){
  vec2 at = vec2(gl_FragCoord.x, viewport.y - gl_FragCoord.y) * frame / viewport;
  vec3 q = toPicture * vec3(at, 1.);
  if (q.z <= 0.) discard;
  vec2 p = q.xy / q.z;
  if (p.x < bounds.x || p.y < bounds.y || p.x > bounds.z || p.y > bounds.w) discard;
  vec4 c = texture(tex, p / frame);
  vec3 rgb = mix(c.rgb, shade.rgb, shade.a);
  float a = c.a * opacity;
  color = vec4(rgb * a, a);
}`;
const FRAGMENT = `#version 300 es
precision highp float; in vec2 uv; out vec4 color; uniform sampler2D tex;
uniform float opacity, brightness, contrast, saturation, gamma, fade, blur; uniform int rotation, blendMode, keyType; uniform sampler2D backdrop; uniform vec2 keyColor; uniform float keySimilarity, keySoftness, keySpill; uniform vec2 flip, blurAspect; uniform vec3 tint; uniform int hideMode, hideShape; uniform float hideAmount; uniform vec2 pixelGrid; uniform vec4 fill; uniform int useShape; uniform sampler2D shapeTex; uniform vec2 viewport;
uniform float oldFilm, oldGrain, oldScratches, oldDust, oldWeave, oldSeed;
uniform int signalMode; uniform float signalAmount, signalSplit, signalJitter, signalScanlines, signalNoise;
uniform int lensMode; uniform float lensAmount, lensCount, lensRefraction, lensSoftness;
uniform float splashAmount, splashTolerance, splashSoftness; uniform vec3 splashColor;
uniform float dreamyAmount, dreamySoftness, dreamyWarmth;
uniform int titleParticle; uniform float titleParticleProgress;
// Mirrored in timeline_service.py: mirror_filters, zoom_blur_filters, tilt_shift_filters, tone_grade_filters (ZOOM_TAPS, TILT_SIGMA).
uniform int mirrorMode; uniform float mirrorSegments, mirrorTurn, picAspect;
uniform float zoomReach; uniform vec2 zoomCenter;
uniform float tiltBlur, tiltFocus, tiltBand, tiltSat; uniform vec2 tiltSigma;
uniform int toneMode; uniform float toneBalance, toneAmount; uniform vec3 toneShadow, toneHigh;
float filmHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
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
// The clip's own picture coordinates (as displayed, after its flip and turn) folded by a mirror or kaleidoscope.
vec2 shaped(vec2 u){
  if (mirrorMode == 4) {
    vec2 d = (u - .5) * vec2(picAspect, 1.);
    float wedge = 6.2831853 / mirrorSegments;
    float folded = mod(atan(d.y, d.x) + mirrorTurn + 25.1327412, wedge);
    float a = min(folded, wedge - folded) - mirrorTurn;
    return .5 + length(d) * vec2(cos(a) / picAspect, sin(a));
  }
  if (mirrorMode == 1 || mirrorMode == 3) u.x = .5 - abs(u.x - .5);
  if (mirrorMode == 2 || mirrorMode == 3) u.y = .5 - abs(u.y - .5);
  return u;
}
vec2 toSource(vec2 u){
  vec2 q = mix(u, 1. - u, flip);
  return rotation==90 ? vec2(q.y, 1.-q.x) : rotation==180 ? 1.-q : rotation==270 ? vec2(1.-q.y, q.x) : q;
}
vec4 pickAt(vec2 u){ return pick(toSource(shaped(u))); }
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
  vec2 q = mix(shaped(uv), 1. - shaped(uv), flip);
  vec2 s = rotation==90 ? vec2(q.y, 1.-q.x) : rotation==180 ? 1.-q : rotation==270 ? vec2(1.-q.y, q.x) : q;
  float lensMask = 0.; float lensRim = 0.;
  if (lensMode > 0) {
    float cells = mix(5., 12., lensCount); vec2 grid = vec2(cells, cells * .62);
    vec2 cell = floor(s * grid); vec2 local = fract(s * grid);
    vec2 centre = vec2(.18 + .64 * filmHash(cell + 7.), .18 + .64 * filmHash(cell.yx + 29.));
    vec2 delta = local - centre; delta.x *= viewport.x / viewport.y;
    float radius = mix(.08, .20, filmHash(cell + 53.)) * mix(.72, 1.2, lensCount);
    float distanceToDrop = length(delta); float edge = mix(.015, .08, lensSoftness);
    lensMask = 1. - smoothstep(radius - edge, radius + edge, distanceToDrop);
    lensRim = smoothstep(radius - edge * 2., radius, distanceToDrop) * (1. - smoothstep(radius, radius + edge, distanceToDrop));
    if (lensMode == 2 && lensMask > 0.) s += normalize(delta + vec2(.0001)) * lensRefraction * lensAmount * .018 * (1. - distanceToDrop / radius);
    else if (lensMode == 1 && lensMask > 0.) s += delta * lensRefraction * lensAmount * .004;
  }
  if (oldFilm > 0. && oldWeave > 0.) {
    float beat = floor(oldSeed * .5);
    s += (vec2(filmHash(vec2(beat, 3.)), filmHash(vec2(beat, 9.))) - .5) * vec2(.008, .004) * oldWeave * oldFilm;
  }
  if (signalMode > 0 && signalJitter > 0.) {
    float band = floor(s.y * (signalMode == 1 ? 18. : 42.));
    float burst = filmHash(vec2(band, floor(oldSeed / (signalMode == 1 ? 2. : 4.))));
    s.x += (burst - .5) * .055 * signalJitter * signalAmount * step(signalMode == 1 ? .62 : .35, burst);
  }
  float particleHue = 0.;
  if (titleParticle > 0 && titleParticleProgress < .999) {
    vec2 grid = vec2(150., 90.); vec2 cell = floor(s * grid);
    float rx = filmHash(cell + 13.); float ry = filmHash(cell.yx + 71.);
    float travel = pow(1. - titleParticleProgress, 1.7);
    s += (vec2(rx, ry) - .5) * travel * (titleParticle == 2 ? .20 : .34);
    particleHue = filmHash(cell + 109.);
  }
  vec4 c = pick(s);
  if (zoomReach > 0.) {
    // The picture averaged with itself scaled up about the centre, in eight even steps.
    vec4 sum = c;
    for (int i = 1; i < 8; i++) { float k = 1. + zoomReach * float(i) / 7.; sum += pickAt(zoomCenter + (uv - zoomCenter) / k); }
    c = sum / 8.;
  }
  if (tiltBlur > 0.) {
    float t = clamp((abs(uv.y - tiltFocus) - .5 * tiltBand) / (.18 + .5 * tiltBand), 0., 1.);
    float m = t * t * (3. - 2. * t);
    if (m > 0.) {
      vec4 sum = c; float total = 1.;
      for (int i = 0; i < 24; i++) {
        float r = sqrt((float(i) + .5) / 24.) * 2.2; float a = float(i) * 2.399963;
        float w = exp(-.5 * r * r); sum += pickAt(uv + vec2(cos(a), sin(a)) * r * tiltSigma) * w; total += w;
      }
      c = mix(c, sum / total, m);
    }
  }
  if (signalMode > 0 && signalSplit > 0.) {
    float split = .012 * signalSplit * signalAmount;
    vec4 left = pick(s - vec2(split, 0.)); vec4 right = pick(s + vec2(split, 0.));
    c.r = right.r; c.b = left.b;
  }
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
  if (titleParticle > 0 && titleParticleProgress < .999) {
    vec3 magic = particleHue < .33 ? vec3(.35, .85, 1.) : particleHue < .66 ? vec3(.85, .35, 1.) : vec3(1., .68, .18);
    rgb *= mix(magic, vec3(1.), titleParticleProgress);
    alpha *= smoothstep(particleHue * .72, min(1., particleHue * .72 + .24), titleParticleProgress);
  }
  rgb = rgb * brightness * tint;
  rgb = pow(max(rgb, 0.), vec3(1. / gamma));
  rgb = rgb * (1. - fade) + fade;
  rgb = (clamp(rgb, 0., 1.) - .5) * contrast + .5;
  float luma = dot(clamp(rgb, 0., 1.), vec3(.2126, .7152, .0722));
  rgb = clamp(mix(vec3(luma), clamp(rgb, 0., 1.), saturation), 0., 1.);
  if (tiltSat > 0.) rgb = clamp(mix(vec3(dot(rgb, vec3(.2126, .7152, .0722))), rgb, 1. + tiltSat), 0., 1.);
  if (splashAmount > 0.) {
    float targetLuma = dot(splashColor, vec3(.2126, .7152, .0722));
    vec2 chroma = vec2((rgb.b - luma) / 1.8556, (rgb.r - luma) / 1.5748);
    vec2 targetChroma = vec2((splashColor.b - targetLuma) / 1.8556, (splashColor.r - targetLuma) / 1.5748);
    float keep = 1. - smoothstep(splashTolerance, splashTolerance + splashSoftness, length(chroma - targetChroma));
    rgb = mix(rgb, vec3(luma), splashAmount * (1. - keep));
  }
  if (dreamyAmount > 0.) {
    vec3 bloom = vec3(0.); float bloomWeight = 0.;
    for (int i = 0; i < 24; i++) {
      float r = sqrt((float(i) + .5) / 24.); float a = float(i) * 2.399963;
      vec2 at = s + vec2(cos(a), sin(a)) * r * mix(.004, .025, dreamySoftness) * blurAspect;
      vec4 sampleColor = pick(at); vec3 sampleRgb = sampleColor.a > 0. ? sampleColor.rgb / sampleColor.a : vec3(0.);
      float highlight = smoothstep(.48, .92, dot(sampleRgb, vec3(.2126, .7152, .0722)));
      float weight = exp(-2. * r * r); bloom += sampleRgb * highlight * weight; bloomWeight += weight;
    }
    bloom /= max(bloomWeight, .001);
    bloom *= vec3(1. + dreamyWarmth * .12, 1. + dreamyWarmth * .035, 1. - dreamyWarmth * .08);
    rgb = clamp(1. - (1. - rgb) * (1. - bloom * dreamyAmount * .72), 0., 1.);
    rgb = mix(rgb, vec3(dot(rgb, vec3(.2126, .7152, .0722))) + rgb * .82, dreamyAmount * dreamySoftness * .08);
  }
  if (toneMode > 0) {
    float t = clamp(dot(rgb, vec3(.2126, .7152, .0722)) + .5 - toneBalance, 0., 1.);
    if (toneMode == 1) rgb = rgb * (1. - toneAmount) + toneAmount * mix(toneShadow, toneHigh, t);
    else rgb = rgb + toneAmount * ((toneShadow - .5) * .55 * (1. - t) * (1. - t) + (toneHigh - .5) * .55 * t * t);
    rgb = clamp(rgb, 0., 1.);
  }
  if (oldFilm > 0.) {
    float flicker = (filmHash(vec2(floor(oldSeed), 17.)) - .5) * .10 * oldFilm;
    vec3 aged = mix(vec3(luma), vec3(luma * 1.08, luma, luma * .82), .42);
    rgb = clamp(mix(rgb, aged, .42 * oldFilm) + flicker, 0., 1.);
    float grainNoise = filmHash(gl_FragCoord.xy + vec2(oldSeed * 19.7, oldSeed * 7.3)) - .5;
    rgb = clamp(rgb + grainNoise * .24 * oldGrain * oldFilm, 0., 1.);
    float scratchCell = floor(gl_FragCoord.x / 3.);
    float scratchLife = filmHash(vec2(scratchCell, floor(oldSeed / 3.)));
    float scratch = step(1. - oldScratches * .035, scratchLife) * (.35 + .65 * filmHash(vec2(scratchCell, floor(gl_FragCoord.y / 19.))));
    rgb = clamp(rgb + vec3(scratch * .48 * oldFilm), 0., 1.);
    vec2 dustCell = floor(gl_FragCoord.xy / 28.);
    vec2 dustAt = fract(gl_FragCoord.xy / 28.) - vec2(filmHash(dustCell + oldSeed), filmHash(dustCell.yx + oldSeed + 31.));
    float dust = step(length(dustAt), .055 + .08 * oldDust) * step(1. - oldDust * .28, filmHash(dustCell + floor(oldSeed / 2.)));
    rgb *= 1. - dust * .65 * oldFilm;
  }
  if (signalMode > 0) {
    float line = sin(gl_FragCoord.y * (signalMode == 2 ? 3.14159265 : 1.5707963));
    rgb *= 1. - signalScanlines * signalAmount * (signalMode == 2 ? .16 : .08) * (.5 + .5 * line);
    float snow = filmHash(gl_FragCoord.xy + vec2(oldSeed * 37., oldSeed * 11.)) - .5;
    rgb = clamp(rgb + snow * signalNoise * signalAmount * (signalMode == 2 ? .28 : .16), 0., 1.);
    if (signalMode == 2) rgb = mix(rgb, vec3(dot(rgb, vec3(.299, .587, .114))), .08 * signalAmount);
  }
  if (lensMode == 1) rgb *= 1. - lensMask * lensAmount * .34;
  if (lensMode == 2) {
    rgb = mix(rgb, rgb * vec3(.86, .94, 1.06), lensMask * lensAmount * .24);
    rgb = clamp(rgb + lensRim * lensAmount * .32, 0., 1.);
  }
  float a = alpha * opacity;
  // A drawn shape keeps only part of the frame. The picture has the frame's top at its first row.
  if (useShape == 1) a *= texture(shapeTex, vec2(gl_FragCoord.x / viewport.x, 1. - gl_FragCoord.y / viewport.y)).a;
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
  /** The picture of a clip's drawn shape, once it is ready. */
  shapeUrl: (mask: ShapeMask) => string | undefined = () => undefined;
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
  private main!: WebGLProgram;
  private finishing!: WebGLProgram;
  private finishUniforms: Record<string, WebGLUniformLocation | null> = {};
  private lutTexture: WebGLTexture | null = null;
  private lutId: string | null = null;
  private layers = new Map<string, LayerSlots>();
  private images = new Map<string, { texture: WebGLTexture; ready: boolean; box?: Box | null; measuring?: boolean }>();
  private titleProgram!: WebGLProgram;
  private titleUniforms: Record<string, WebGLUniformLocation | null> = {};
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
    for (const name of ['box', 'opacity', 'brightness', 'contrast', 'saturation', 'gamma', 'fade', 'rotation', 'flip', 'tint', 'blur', 'blurAspect', 'turn', 'frame', 'blendMode', 'backdrop', 'keyType', 'keyColor', 'keySimilarity', 'keySoftness', 'keySpill', 'hideMode', 'hideShape', 'hideAmount', 'pixelGrid', 'fill', 'useShape', 'shapeTex', 'viewport', 'oldFilm', 'oldGrain', 'oldScratches', 'oldDust', 'oldWeave', 'oldSeed', 'signalMode', 'signalAmount', 'signalSplit', 'signalJitter', 'signalScanlines', 'signalNoise', 'lensMode', 'lensAmount', 'lensCount', 'lensRefraction', 'lensSoftness', 'splashAmount', 'splashTolerance', 'splashSoftness', 'splashColor', 'dreamyAmount', 'dreamySoftness', 'dreamyWarmth', 'titleParticle', 'titleParticleProgress', 'mirrorMode', 'mirrorSegments', 'mirrorTurn', 'picAspect', 'zoomReach', 'zoomCenter', 'tiltBlur', 'tiltFocus', 'tiltBand', 'tiltSat', 'tiltSigma', 'toneMode', 'toneBalance', 'toneAmount', 'toneShadow', 'toneHigh']) this.uniforms[name] = gl.getUniformLocation(program, name);
    this.main = program;
    const finishing = gl.createProgram()!;
    gl.attachShader(finishing, shader(gl.VERTEX_SHADER, FINISH_VERTEX));
    gl.attachShader(finishing, shader(gl.FRAGMENT_SHADER, FINISH_FRAGMENT));
    gl.bindAttribLocation(finishing, position, 'p');
    gl.linkProgram(finishing);
    this.finishing = finishing;
    for (const name of ['backdrop', 'viewport', 'lutTex', 'useLut', 'lutAmount', 'grade', 'glow', 'vignette', 'grain', 'bars', 'seed']) this.finishUniforms[name] = gl.getUniformLocation(finishing, name);
    const titles = gl.createProgram()!;
    gl.attachShader(titles, shader(gl.VERTEX_SHADER, FINISH_VERTEX));
    gl.attachShader(titles, shader(gl.FRAGMENT_SHADER, TITLE_FRAGMENT));
    gl.bindAttribLocation(titles, position, 'p');
    gl.linkProgram(titles);
    this.titleProgram = titles;
    for (const name of ['tex', 'toPicture', 'frame', 'viewport', 'bounds', 'opacity', 'shade']) this.titleUniforms[name] = gl.getUniformLocation(titles, name);
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
    if ((timeline.lut ?? null) !== this.lutId) this.loadLut(timeline.lut ?? null);
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

  private loadLut(id: string | null) {
    this.lutId = id; this.lutTexture = null;
    if (!id) { this.requestDraw(); return; }
    const image = new Image();
    image.onload = () => {
      if (this.lutId !== id) return;
      const { gl } = this; const texture = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      this.lutTexture = texture; gl.activeTexture(gl.TEXTURE0); this.requestDraw();
    };
    image.src = lutAtlasUrl(id);
  }

  get currentTime() { return this.time; }

  private videoLayers(): VideoLayer[] {
    return (this.timeline?.layers ?? []).filter((layer): layer is VideoLayer => layer.kind === 'video' && !layer.hidden);
  }

  private clipFor(layer: VideoLayer, t: number): { clip?: Clip; next?: Clip } {
    const clips = layer.items.filter((clip) => clip.enabled !== false).sort((a, b) => a.start - b.start);
    const index = clips.findIndex((clip) => t >= clip.start && t < clip.start + clipLength(clip));
    if (index >= 0) return { clip: clips[index], next: clips[index + 1] };
    const last = clips[clips.length - 1];
    if (last && t >= duration(this.timeline!) && last.start + clipLength(last) >= t - 0.001) return { clip: last };
    return { next: clips.find((clip) => clip.start > t) };
  }

  private sorted(layer: VideoLayer) { return layer.items.filter((clip) => clip.enabled !== false).sort((a, b) => a.start - b.start); }

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

  private imageTexture(url: string, measureTitle = false) {
    let entry = this.images.get(url);
    if (!entry) {
      entry = { texture: this.newTexture(), ready: false };
      this.images.set(url, entry);
      const image = new Image();
      image.onload = () => {
        const cached = this.images.get(url)!;
        this.gl.bindTexture(this.gl.TEXTURE_2D, cached.texture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image);
        // Text images are fetched as blob: URLs, so their URL cannot identify their origin. The caller explicitly
        // requests measurement; without this box the 3D path used by cinematic reveals has nothing to draw.
        if (measureTitle) cached.box = pictureBox(image);
        cached.ready = true;
        this.requestDraw();
      };
      image.src = url;
    } else if (measureTitle && entry.ready && entry.box === undefined && !entry.measuring) {
      // A title may first be shown flat and only become 3D after the user picks a cinematic reveal. Its texture is
      // already cached then, so measure the cached title on demand instead of waiting for an image reload that never occurs.
      entry.measuring = true;
      const image = new Image();
      image.onload = () => {
        const cached = this.images.get(url);
        if (!cached) return;
        cached.box = pictureBox(image);
        cached.measuring = false;
        this.requestDraw();
      };
      image.onerror = () => { const cached = this.images.get(url); if (cached) cached.measuring = false; };
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
    gl.uniform1i(uniforms.titleParticle, 0);
    const { format } = this.timeline!;
    const source = this.sources(clip.media_id, clip);
    // A foreground copy used by "Behind people" must never fall back to the opaque original while its transparent
    // person copy is being made: that would cover both the title and the main video and look like the title vanished.
    if (source?.pendingCutout && layer !== this.videoLayers()[0]) return;
    if (!source || !this.bindClip(layer, clip, source)) return;
    const local = this.time - clip.start;
    const frame = look.scale * zoom;
    const moved = look.scale !== 1 || look.dx !== 0 || look.dy !== 0;
    const pulse = clip.beat_pulse;
    const interval = pulse ? 60 / pulse.bpm : 1;
    const phase = pulse && local >= pulse.offset ? (local - pulse.offset) % interval : 1;
    const beatZoom = pulse ? 1 + pulse.size * pulse.strength * Math.max(0, 1 - phase / 0.18) : 1;
    const scale = valueAt(clip.transform, 'scale', local) * frame * beatZoom;
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
    gl.uniform2f(uniforms.viewport, this.canvas.width, this.canvas.height);
    gl.uniform1f(uniforms.opacity, Math.max(0, Math.min(1, valueAt(clip.transform, 'opacity', local))) * look.opacity * opacity);
    gl.uniform1f(uniforms.brightness, clip.adjust.brightness);
    gl.uniform1f(uniforms.contrast, clip.adjust.contrast * contrast);
    gl.uniform1f(uniforms.saturation, clip.adjust.saturation * saturation);
    gl.uniform1f(uniforms.gamma, clip.adjust.gamma);
    gl.uniform1f(uniforms.fade, clip.adjust.fade);
    const old = clip.old_film;
    gl.uniform1f(uniforms.oldFilm, old?.intensity ?? 0);
    gl.uniform1f(uniforms.oldGrain, old?.grain ?? 0);
    gl.uniform1f(uniforms.oldScratches, old?.scratches ?? 0);
    gl.uniform1f(uniforms.oldDust, old?.dust ?? 0);
    gl.uniform1f(uniforms.oldWeave, old?.weave ?? 0);
    gl.uniform1f(uniforms.oldSeed, Math.floor(this.time * format.fps) % 997);
    const signal = clip.signal_damage;
    gl.uniform1i(uniforms.signalMode, signal ? (signal.mode === 'glitch' ? 1 : 2) : 0);
    gl.uniform1f(uniforms.signalAmount, signal?.intensity ?? 0);
    gl.uniform1f(uniforms.signalSplit, signal?.rgb_split ?? 0);
    gl.uniform1f(uniforms.signalJitter, signal?.jitter ?? 0);
    gl.uniform1f(uniforms.signalScanlines, signal?.scanlines ?? 0);
    gl.uniform1f(uniforms.signalNoise, signal?.noise ?? 0);
    const lens = clip.lens_surface;
    gl.uniform1i(uniforms.lensMode, lens ? (lens.mode === 'dirt' ? 1 : 2) : 0);
    gl.uniform1f(uniforms.lensAmount, lens?.intensity ?? 0);
    gl.uniform1f(uniforms.lensCount, lens?.amount ?? 0);
    gl.uniform1f(uniforms.lensRefraction, lens?.refraction ?? 0);
    gl.uniform1f(uniforms.lensSoftness, lens?.softness ?? 0);
    const splash = clip.colour_splash;
    const splashRgb = splash ? [1, 3, 5].map((at) => parseInt(splash.color.slice(at, at + 2), 16) / 255) : [0, 0, 0];
    gl.uniform1f(uniforms.splashAmount, splash?.intensity ?? 0);
    gl.uniform1f(uniforms.splashTolerance, splash?.tolerance ?? 0);
    gl.uniform1f(uniforms.splashSoftness, splash?.softness ?? 0.001);
    gl.uniform3f(uniforms.splashColor, splashRgb[0], splashRgb[1], splashRgb[2]);
    const dreamy = clip.dreamy_glow;
    gl.uniform1f(uniforms.dreamyAmount, dreamy?.intensity ?? 0);
    gl.uniform1f(uniforms.dreamySoftness, dreamy?.softness ?? 0);
    gl.uniform1f(uniforms.dreamyWarmth, dreamy?.warmth ?? 0);
    const hex = (colour: string) => [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16) / 255) as [number, number, number];
    const mirror = clip.mirror;
    gl.uniform1i(uniforms.mirrorMode, mirror ? { left: 1, top: 2, quad: 3, kaleido: 4 }[mirror.mode] : 0);
    gl.uniform1f(uniforms.mirrorSegments, mirror?.segments ?? 6);
    gl.uniform1f(uniforms.mirrorTurn, ((mirror?.angle ?? 0) * Math.PI) / 180);
    gl.uniform1f(uniforms.picAspect, fitted.width / fitted.height);
    const zoomBlur = clip.zoom_blur;
    gl.uniform1f(uniforms.zoomReach, zoomBlur ? 0.22 * zoomBlur.intensity : 0);
    gl.uniform2f(uniforms.zoomCenter, zoomBlur?.center_x ?? 0.5, zoomBlur?.center_y ?? 0.5);
    const tilt = clip.tilt_shift;
    // The export blurs by TILT_SIGMA of the frame's short side; here that is a share of the picture across and down.
    const sigma = 0.012 * (tilt?.blur ?? 0) * Math.min(format.width, format.height);
    gl.uniform1f(uniforms.tiltBlur, tilt && tilt.blur > 0 ? 1 : 0);
    gl.uniform2f(uniforms.tiltSigma, sigma / fitted.width, sigma / fitted.height);
    gl.uniform1f(uniforms.tiltFocus, tilt?.focus_y ?? 0.5);
    gl.uniform1f(uniforms.tiltBand, tilt?.band ?? 0.2);
    gl.uniform1f(uniforms.tiltSat, tilt ? 0.6 * tilt.saturation : 0);
    const tone = clip.tone_grade;
    gl.uniform1i(uniforms.toneMode, tone ? (tone.mode === 'duotone' ? 1 : 2) : 0);
    gl.uniform1f(uniforms.toneBalance, tone?.balance ?? 0.5);
    gl.uniform1f(uniforms.toneAmount, tone?.intensity ?? 0);
    gl.uniform3f(uniforms.toneShadow, ...hex(tone?.shadow ?? '#000000'));
    gl.uniform3f(uniforms.toneHigh, ...hex(tone?.highlight ?? '#ffffff'));
    gl.uniform3f(uniforms.tint, red * clip.adjust.temperature, green * clip.adjust.tint, blue * (2 - clip.adjust.temperature));
    gl.uniform1f(uniforms.blur, look.blur * (format.height / height));
    gl.uniform2f(uniforms.blurAspect, height / (fitted.width * scale), sideways ? 0 : 1);
    gl.uniform1i(uniforms.rotation, clip.adjust.rotation);
    gl.uniform2f(uniforms.flip, clip.adjust.flip_horizontal ? 1 : 0, clip.adjust.flip_vertical ? 1 : 0);
    const shapeUrl = clip.shape_mask && this.shapeUrl(clip.shape_mask);
    const shape = shapeUrl ? this.imageTexture(shapeUrl) : null;
    // Until its shape picture arrives, a shaped clip draws nothing rather than the whole frame.
    if (clip.shape_mask && !shape?.ready) { gl.uniform1f(uniforms.oldFilm, 0); gl.uniform1i(uniforms.signalMode, 0); gl.uniform1i(uniforms.lensMode, 0); gl.uniform1f(uniforms.splashAmount, 0); gl.uniform1f(uniforms.dreamyAmount, 0); this.clearShaping(); if (moved) gl.disable(gl.SCISSOR_TEST); return; }
    if (shape) {
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, shape.texture); gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(uniforms.shapeTex, 2); gl.uniform2f(uniforms.viewport, this.canvas.width, this.canvas.height);
    }
    gl.uniform1i(uniforms.useShape, shape ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.uniform1f(uniforms.oldFilm, 0);
    gl.uniform1i(uniforms.signalMode, 0);
    gl.uniform1i(uniforms.lensMode, 0);
    gl.uniform1f(uniforms.splashAmount, 0);
    gl.uniform1f(uniforms.dreamyAmount, 0);
    this.clearShaping();
    gl.uniform1i(uniforms.useShape, 0);
    if (moved) gl.disable(gl.SCISSOR_TEST);
  }

  /** Mirror, zoom blur, tilt-shift and tone grade off again, so the next thing drawn with this program is plain. */
  private clearShaping() {
    const { gl } = this; const uniforms = this.uniforms;
    gl.uniform1i(uniforms.mirrorMode, 0); gl.uniform1f(uniforms.zoomReach, 0); gl.uniform1f(uniforms.tiltBlur, 0); gl.uniform1f(uniforms.tiltSat, 0); gl.uniform1i(uniforms.toneMode, 0);
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
    gl.uniform1i(uniforms.titleParticle, 0);
    gl.uniform4f(uniforms.box, 0.5, 0.5, 1, 1);
    gl.uniform1f(uniforms.turn, 0);
    gl.uniform1i(uniforms.keyType, 0);
    gl.uniform1f(uniforms.opacity, 1);
    gl.uniform1f(uniforms.brightness, 1); gl.uniform1f(uniforms.contrast, 1); gl.uniform1f(uniforms.saturation, 1); gl.uniform1f(uniforms.gamma, 1); gl.uniform1f(uniforms.fade, 0);
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
    const image = this.imageTexture(url, true);
    if (!image.ready) return;
    gl.bindTexture(gl.TEXTURE_2D, image.texture);
    const local = this.time - item.start;
    // Keep the ordinary title visible while its letter bounds are being measured. Once ready, redraw it through the
    // perspective path. A failed measurement must not make a perfectly valid title disappear.
    if (is3d(item) && image.box) { this.drawTitle3d(item, local, image.box, image.texture); return; }
    const look = animatedLook(item.enter, item.exit, local, item.length);
    const { width, height } = this.timeline!.format;
    // The title's own move first, then its animation moves that whole frame, as the export's pose() does.
    const transform = item.transform ?? REST_TRANSFORM;
    const enterMagic = item.enter && (item.enter.preset === 'particle-form' || item.enter.preset === 'magic-form') && local < item.enter.duration;
    const exitMagic = item.exit && (item.exit.preset === 'particle-form' || item.exit.preset === 'magic-vanish') && local > item.length - item.exit.duration;
    const magic = enterMagic ? item.enter! : exitMagic ? item.exit! : null;
    const magicProgress = enterMagic ? Math.min(1, local / magic!.duration) : exitMagic ? Math.min(1, (item.length - local) / magic!.duration) : 1;
    gl.uniform1i(uniforms.titleParticle, magic ? (magic.preset === 'particle-form' ? 1 : 2) : 0);
    gl.uniform1f(uniforms.titleParticleProgress, magicProgress);
    const size = valueAt(transform, 'scale', local) * look.scale;
    gl.uniform4f(uniforms.box, 0.5 + look.dx + (valueAt(transform, 'x', local) - 0.5) * look.scale, 0.5 + look.dy + (valueAt(transform, 'y', local) - 0.5) * look.scale, size, size);
    gl.uniform1f(uniforms.turn, (valueAt(transform, 'rotation', local) * Math.PI) / 180);
    gl.uniform2f(uniforms.frame, width, height);
    gl.uniform1i(uniforms.keyType, 0);
    gl.uniform1f(uniforms.opacity, look.opacity * Math.max(0, Math.min(1, valueAt(transform, 'opacity', local))));
    gl.uniform1f(uniforms.brightness, 1); gl.uniform1f(uniforms.contrast, 1); gl.uniform1f(uniforms.saturation, 1); gl.uniform1f(uniforms.gamma, 1); gl.uniform1f(uniforms.fade, 0);
    gl.uniform3f(uniforms.tint, 1, 1, 1);
    gl.uniform1f(uniforms.blur, look.blur / size);
    gl.uniform2f(uniforms.blurAspect, height / width, 1);
    gl.uniform1i(uniforms.rotation, 0);
    gl.uniform2f(uniforms.flip, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.uniform1i(uniforms.titleParticle, 0);
  }

  /** A title with tilt, depth or a pin: each depth layer from back to front, warped through its homography (title3d.ts). */
  private drawTitle3d(item: TextItem, local: number, box: Box, texture: WebGLTexture) {
    const { gl } = this; const u = this.titleUniforms;
    const { width, height } = this.timeline!.format;
    const frameBox: Box = [box[0] * width, box[1] * height, box[2] * width, box[3] * height];
    const { pose, look } = poseAt(item, local);
    const opacity = look.opacity * Math.max(0, Math.min(1, valueAt(item.transform ?? REST_TRANSFORM, 'opacity', local)));
    if (opacity <= 0) return;
    const pin = this.titlePin(item);
    const source: Point[] = [[frameBox[0], frameBox[1]], [frameBox[2], frameBox[1]], [frameBox[2], frameBox[3]], [frameBox[0], frameBox[3]]];
    const depth = item.depth && item.depth.amount > 0 ? item.depth : null;
    const shades = layers(depth);
    const colour = depth ? [1, 3, 5].map((at) => parseInt(depth.color.slice(at, at + 2), 16) / 255) : [0, 0, 0];
    gl.useProgram(this.titleProgram);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(u.tex, 0);
    gl.uniform2f(u.frame, width, height);
    gl.uniform2f(u.viewport, this.canvas.width, this.canvas.height);
    gl.uniform4f(u.bounds, ...frameBox);
    gl.uniform1f(u.opacity, opacity);
    for (let index = shades.length - 1; index >= 0; index -= 1) {
      const share = shades[index];
      let toPicture: Matrix;
      try { toPicture = invert(homography(source, corners(pose, frameBox, [width, height], share, depth?.amount ?? 0, pin, depth?.angle ?? DEFAULT_DEPTH_ANGLE))); } catch { continue; }
      gl.uniformMatrix3fv(u.toPicture, false, [toPicture[0][0], toPicture[1][0], toPicture[2][0], toPicture[0][1], toPicture[1][1], toPicture[2][1], toPicture[0][2], toPicture[1][2], toPicture[2][2]]);
      // The front layer is the title itself; layers behind it are its sides, in the depth colour, darker further back.
      if (index === 0 || !depth) gl.uniform4f(u.shade, 0, 0, 0, 0);
      else { const light = layerShade(depth, share); gl.uniform4f(u.shade, colour[0] * light, colour[1] * light, colour[2] * light, 1); }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.useProgram(this.main);
  }

  /** The scene track a pinned title follows, as a matrix from the pin moment's frame to this one; null when not pinned or not ready. */
  private titlePin(item: TextItem): Matrix | null {
    return item.pin ? this.pinMatrix?.(item, this.time) ?? null : null;
  }

  /** A title's letter box as shares of its picture, once its picture has loaded and been measured; null until then. */
  titleBox(text: TextItem): Box | null {
    const url = this.textUrl(text);
    if (!url) return null;
    const entry = this.imageTexture(url, true);
    return entry.ready ? entry.box ?? null : null;
  }

  /** Set by the editor once a pinned title's scene track has loaded. */
  pinMatrix: ((item: TextItem, time: number) => Matrix | null) | null = null;

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

  /** The cinematic finish over everything drawn so far, as the export does it, before the captions. */
  private drawFinish() {
    const finish = this.timeline?.finish;
    const lut = Boolean(this.timeline?.lut && this.lutTexture && (this.timeline.lut_amount ?? 1) > 0);
    if ((!finish || !(finish.letterbox || finish.grade || finish.glow || finish.vignette || finish.grain)) && !lut) return;
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backdrop);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, this.canvas.width, this.canvas.height, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(this.finishing);
    const u = this.finishUniforms;
    gl.uniform1i(u.backdrop, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.lutTexture); gl.uniform1i(u.lutTex, 2); gl.uniform1i(u.useLut, lut ? 1 : 0); gl.uniform1f(u.lutAmount, this.timeline?.lut_amount ?? 1); gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(u.viewport, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.grade, finish?.grade ?? 0); gl.uniform1f(u.glow, finish?.glow ?? 0); gl.uniform1f(u.vignette, finish?.vignette ?? 0); gl.uniform1f(u.grain, finish?.grain ?? 0);
    gl.uniform1f(u.bars, finish?.letterbox ? barShare(this.timeline!.format) : 0);
    gl.uniform1f(u.seed, Math.floor(this.time * this.timeline!.format.fps) % 997);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
    gl.useProgram(this.main);
  }

  private draw() {
    const { gl } = this;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.timeline) return;
    let finished = false;
    const brand: VideoLayer[] = [];
    for (const layer of this.timeline.layers) {
      if (layer.hidden) continue;
      if (layer.kind === 'video' && isBrandLayer(layer)) { brand.push(layer); continue; }
      if (layer.kind === 'captions' && !finished) { this.drawFinish(); this.drawBrand(brand); finished = true; }
      if (layer.kind === 'video') this.drawLayer(layer);
      else if (layer.kind === 'text') this.drawText(layer);
      else if (layer.kind === 'blur') this.drawBlur(layer);
      else if (layer.kind === 'captions') this.drawCaptions(layer);
    }
    if (!finished) { this.drawFinish(); this.drawBrand(brand); }
  }

  /** Brand watermarks over the cinematic finish (including its bars), under the captions. Matches timeline_service.py. */
  private drawBrand(layers: VideoLayer[]) {
    for (const layer of layers) this.drawLayer(layer);
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
    const voices: Sound[] = this.videoLayers().flatMap((layer) => layer.items.filter((clip) => clip.enabled !== false && clip.clean_voice && clip.freeze == null && !clip.reverse && !clip.ramp && this.cleanVoice(clip.media_id)).map((clip) => ({
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

  /** The cut-out token when this slot plays a see-through people/objects copy, else null. */
  private cutoutToken(slot: Slot): string | null {
    const query = slot.url?.split('?')[1];
    if (!query) return null;
    return new URLSearchParams(query).get('cutout');
  }

  /** Where the base video element for this clip actually is, as an offset from its expected source time.
   * Cut-out overlays ride on the base element's real position, so a layer can never drift against the one under it. */
  private anchorOffset(item: Clip, above: VideoLayer): number | undefined {
    const layers = this.videoLayers();
    for (const layer of layers.slice(0, layers.indexOf(above))) {
      const { clip } = this.clipFor(layer, this.time);
      if (!clip || clip.media_id !== item.media_id) continue;
      const slot = this.slotsFor(layer).slots.find((entry) => entry.clipId === clip.id);
      if (slot && !slot.video.paused) return slot.video.currentTime - this.sourceTime(clip, this.time);
    }
    return undefined;
  }

  private keepInStep() {
    for (const layer of this.videoLayers()) {
      const crossing = this.crossing(layer, this.time);
      const { clip } = this.clipFor(layer, this.time);
      for (const item of crossing ? [crossing.before, crossing.after] : clip ? [clip] : []) {
        const slot = this.slotsFor(layer).slots.find((entry) => entry.clipId === item.id);
        if (!slot || slot.video.paused) continue;
        const at = this.sourceTime(item, this.time, !crossing);
        // A silent cut-out overlay is held to the base element (tight), not just to the master clock.
        const anchor = this.cutoutToken(slot) ? this.anchorOffset(item, layer) : undefined;
        const target = anchor === undefined ? at : at + anchor;
        const drift = slot.video.currentTime - target;
        if (Math.abs(drift) > (anchor === undefined ? DRIFT_RESEEK_SECONDS : OVERLAY_RESEEK_SECONDS) * this.rate) {
          slot.video.currentTime = Math.max(0, target);
          if (anchor === undefined) this.struggled();
        } else {
          const nudge = Math.abs(drift) > DRIFT_NUDGE_SECONDS ? -Math.sign(drift) * Math.min(anchor === undefined ? MAX_NUDGE : OVERLAY_NUDGE, Math.abs(drift)) : 0;
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
