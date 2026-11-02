import { valueAt } from '/file/evaluate.js';
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false, antialias: false });
const say = (text) => { document.getElementById('s').textContent = text; };
const compile = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); return s; };
const program = gl.createProgram();
gl.attachShader(program, compile(gl.VERTEX_SHADER, `#version 300 es
in vec2 p; out vec2 uv; uniform vec4 box;
void main(){ uv=p; vec2 pos=box.xy+(p-.5)*box.zw; gl_Position=vec4(pos.x*2.-1.,1.-pos.y*2.,0,1); }`));
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float; in vec2 uv; out vec4 color; uniform sampler2D tex; uniform float opacity;
void main(){ vec4 c=texture(tex,uv); color=vec4(c.rgb,c.a*opacity); }`));
gl.linkProgram(program); gl.useProgram(program);
const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0,1,0,0,1,1,1]), gl.STATIC_DRAW);
const at = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
const uBox = gl.getUniformLocation(program, 'box'); const uOpacity = gl.getUniformLocation(program, 'opacity');
gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

const timeline = await (await fetch('/file/timeline.json')).json();
const layers = [];
// ?layers=N adds extra static picture-in-picture layers, to find the live preview limit.
const extra = Math.max(0, (Number(new URLSearchParams(location.search).get('layers')) || 3) - 3);
for (let i = 0; i < extra; i += 1) timeline.layers.splice(3, 0, { id: `extra${i}`, media: i % 2 ? 'pip_a' : 'pip_b', transform: { x: 0.12 + 0.19 * (i % 5), y: 0.15 + 0.3 * (Math.floor(i / 5)), scale: 0.18, opacity: 1 } });
for (const layer of timeline.layers) {
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const entry = { ...layer, tex, frames: 0, mediaTime: 0, dirty: false };
  if (layer.kind === 'text') {
    const image = new Image(); image.src = `/out/${layer.id}.png`; await image.decode();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  } else {
    const video = document.createElement('video');
    Object.assign(video, { src: `/media/${layer.media}.proxy.mp4`, muted: true, playsInline: true, preload: 'auto' });
    await new Promise((ok, no) => { video.oncanplay = ok; video.onerror = no; });
    entry.video = video;
    const watch = (_, meta) => { entry.frames += 1; entry.mediaTime = meta.mediaTime; entry.dirty = true; video.requestVideoFrameCallback(watch); };
    video.requestVideoFrameCallback(watch);
  }
  layers.push(entry);
}
const audioContext = new AudioContext();
const song = await audioContext.decodeAudioData(await (await fetch(`/media/${timeline.audio.media}.m4a`)).arrayBuffer());

function draw(t) {
  for (const layer of layers) {
    if (layer.kind === 'text' && (t < layer.start || t > layer.end)) continue;
    gl.bindTexture(gl.TEXTURE_2D, layer.tex);
    if (layer.video && layer.dirty) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.video); layer.dirty = false; }
    const tr = layer.transform ?? { x: 0.5, y: 0.5, scale: 1, opacity: 1 };
    const s = valueAt(tr, 'scale', t);
    gl.uniform4f(uBox, valueAt(tr, 'x', t), valueAt(tr, 'y', t), s, s);
    gl.uniform1f(uOpacity, tr.opacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
async function seek(t) {
  const started = performance.now();
  await Promise.all(layers.filter((l) => l.video).map((layer) => new Promise((done) => {
    const video = layer.video; const fallback = setTimeout(done, 3000);
    video.requestVideoFrameCallback((_, meta) => { clearTimeout(fallback); layer.mediaTime = meta.mediaTime; layer.dirty = true; done(); });
    video.currentTime = t;
  })));
  draw(t);
  return { ms: performance.now() - started, frameErrors: layers.filter((l) => l.video).map((l) => +(l.mediaTime - t).toFixed(3)) };
}
async function play(from, seconds) {
  await audioContext.resume();
  const source = audioContext.createBufferSource(); source.buffer = song; const silent = audioContext.createGain(); silent.gain.value = 0; source.connect(silent).connect(audioContext.destination);
  await seek(from);
  const videos = layers.filter((l) => l.video);
  for (const l of videos) { l.frames = 0; l.quality = l.video.getVideoPlaybackQuality(); }
  // Schedule the audio first, then start video on that moment, so the two begin together.
  const startAt = audioContext.currentTime + 0.25; source.start(startAt, from);
  await new Promise((go) => { const wait = () => (audioContext.currentTime >= startAt - 0.03 ? go() : setTimeout(wait, 2)); wait(); });
  await Promise.all(videos.map((l) => l.video.play()));
  const stats = { draws: 0, slowDraws: 0, maxDrift: 0, driftSamples: [], corrections: 0 };
  let last = performance.now();
  await new Promise((done) => {
    const tick = () => {
      const t = Math.max(0, audioContext.currentTime - startAt) + from;
      for (const l of videos) {
        const drift = l.video.currentTime - t;
        if (audioContext.currentTime > startAt + 0.3) {
          stats.maxDrift = Math.max(stats.maxDrift, Math.abs(drift));
          (stats.all ??= []).push(Math.abs(drift));
          if (Math.abs(drift) > 0.04) (stats.over ??= []).push([+t.toFixed(2), l.id, +drift.toFixed(3)]);
          if (Math.abs(drift) > 0.25) { l.video.currentTime = t; stats.corrections += 1; }
          else l.video.playbackRate = Math.abs(drift) > 0.02 ? 1 - Math.sign(drift) * Math.min(0.05, Math.abs(drift)) : 1;
        }
      }
      if (stats.draws % 300 === 0) stats.driftSamples.push(videos.map((l) => +(l.video.currentTime - t).toFixed(3)));
      draw(t); stats.draws += 1;
      const now = performance.now(); if (now - last > 50) stats.slowDraws += 1; last = now;
      if (stats.draws % 60 === 0) say(`t=${t.toFixed(1)} drift=${stats.maxDrift.toFixed(3)} draws=${stats.draws}`);
      if (t >= from + seconds) done(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  source.stop();
  for (const l of videos) { l.video.pause(); l.video.playbackRate = 1; }
  stats.layers = videos.map((l) => { const q = l.video.getVideoPlaybackQuality(); return { id: l.id, presented: l.frames, dropped: q.droppedVideoFrames - l.quality.droppedVideoFrames, total: q.totalVideoFrames - l.quality.totalVideoFrames }; });
  stats.seconds = seconds;
  const sorted = (stats.all ?? []).sort((a, b) => a - b); stats.all = undefined;
  stats.driftP50 = sorted[sorted.length >> 1]; stats.driftP99 = sorted[Math.floor(sorted.length * 0.99)]; stats.driftP999 = sorted[Math.floor(sorted.length * 0.999)]; stats.samples = sorted.length;
  stats.overCount = stats.over?.length ?? 0; stats.over = stats.over?.slice(0, 12);
  stats.memoryMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null;
  return stats;
}
async function capture(t) {
  await seek(t);
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
  await fetch(`/capture/preview-${String(t).replace('.', '_')}.png`, { method: 'POST', body: blob });
}
async function seekTest(n = 30) {
  const results = [];
  for (let i = 0; i < n; i += 1) { const t = Math.round(Math.random() * 280 * 30) / 30; results.push({ t, ...(await seek(t)) }); await new Promise((r) => setTimeout(r, 100)); }
  const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
  return { median: sorted[n >> 1], p90: sorted[Math.floor(n * 0.9)], max: sorted[n - 1], worstFrameError: Math.max(...results.flatMap((r) => r.frameErrors.map(Math.abs))) };
}
window.spike = { seek, play, capture, seekTest, report: (name, data) => fetch(`/report/${name}`, { method: 'POST', body: JSON.stringify(data), headers: { 'content-type': 'application/json' } }), ready: true };
await seek(0); say('ready');
