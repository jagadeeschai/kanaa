/**
 * Titles in 3D: leaning back, turning, extruded depth, and locking to the scene. Mirrors
 * backend/app/services/title3d.py step for step, and both are tested on the same numbers.
 * Frame pixels, y down. A flat title (no tilt, depth or pin) lands exactly where it does today.
 */
import { animatedLook, PICTURE_PRESETS, TRICK_MARGIN } from './animation.ts';
import { valueAt } from './evaluate.ts';
import type { TextItem, TitleDepth } from './model.ts';

export const FOV = 40;
export const MAX_LAYERS = 15;
export const DEPTH_SPAN = 0.12;
export const EXTRUDE_Z = 1;
export const EXTRUDE_XY = Math.hypot(0.25, 0.55);  // The fixed screen-plane slant magnitude; its direction is `angle`.
export const DEFAULT_DEPTH_ANGLE = (Math.atan2(0.25, 0.55) * 180) / Math.PI;  // The old fixed slant, as an angle from straight-down towards the right.
export const ALPHA_EDGE = 8;
const TILTING = new Set(['rise-behind', 'push-through']);

export type Point = [number, number];
export type Matrix = [[number, number, number], [number, number, number], [number, number, number]];
export type Pose = { cx: number; cy: number; size: number; turn: number; tilt_x: number; tilt_y: number };
/** x0, y0, x1, y1 in the title picture's pixels. */
export type Box = [number, number, number, number];

export function is3d(text: TextItem): boolean {
  const t = text.transform;
  const tilts = Boolean(t?.tilt_x || t?.tilt_y || t?.keyframes?.tilt_x?.length || t?.keyframes?.tilt_y?.length);
  const presets = [text.enter, text.exit].some((animation) => animation && (TILTING.has(animation.preset) || PICTURE_PRESETS.has(animation.preset)));
  return tilts || presets || Boolean(text.depth && text.depth.amount > 0) || Boolean(text.pin);
}

const COPY_TRICKS = new Set(['chromatic', 'prism', 'echo']);
/** The part of the title picture drawn: the letters' box, and room around it for copies that move apart. Same as trick_bounds in title3d_render.py. */
export function trickBounds(text: TextItem, letters: Box, [width, height]: [number, number]): Box {
  if (![text.enter, text.exit].some((animation) => animation && COPY_TRICKS.has(animation.preset))) return letters;
  const margin = Math.ceil(TRICK_MARGIN * (letters[3] - letters[1]));
  return [Math.max(0, letters[0] - margin), Math.max(0, letters[1] - margin), Math.min(width, letters[2] + margin), Math.min(height, letters[3] + margin)];
}

/** A title's #rrggbb colour as 0..1 red, green and blue. */
export const hexColour = (colour: string | null | undefined): [number, number, number] => {
  const hex = colour ?? '#ffffff';
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
};

/** Each layer's share of the full depth, front (0) to back. */
export function layers(depth: TitleDepth | null | undefined): number[] {
  if (!depth || depth.amount <= 0) return [0];
  const count = 1 + Math.round(depth.amount * (MAX_LAYERS - 1));
  return count > 1 ? Array.from({ length: count }, (_, k) => k / (count - 1)) : [0];
}

export const layerShade = (depth: TitleDepth, share: number) => 0.35 + 0.65 * depth.light * (1 - share);

/** Where the corners of `box` land on the frame: top-left, top-right, bottom-right, bottom-left. */
export function corners(pose: Pose, box: Box, size: [number, number], depthShare = 0, depthAmount = 0, pin: Matrix | null = null, depthAngle = DEFAULT_DEPTH_ANGLE): Point[] {
  const [width, height] = size;
  const turn = (pose.turn * Math.PI) / 180;
  const ct = Math.cos(turn), st = Math.sin(turn);
  const placed = (px: number, py: number): Point => {
    const dx = (px - width / 2) * pose.size, dy = (py - height / 2) * pose.size;
    return [pose.cx * width + dx * ct - dy * st, pose.cy * height + dx * st + dy * ct];
  };
  const [x0, y0, x1, y1] = box;
  const [qx, qy] = placed((x0 + x1) / 2, (y0 + y1) / 2);
  const a = (pose.tilt_x * Math.PI) / 180, b = (pose.tilt_y * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const focal = height / 2 / Math.tan((FOV / 2) * Math.PI / 180);
  const push = depthShare * depthAmount * DEPTH_SPAN * height;
  const slant = (depthAngle * Math.PI) / 180;
  const ex = EXTRUDE_XY * Math.sin(slant), ey = EXTRUDE_XY * Math.cos(slant);
  return ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Point[]).map(([px, py]) => {
    const [fx, fy] = placed(px, py);
    const lx = fx - qx + ex * push, ly = fy - qy + ey * push, lz = EXTRUDE_Z * push;
    const x = lx * cb - lz * sb; let z = lx * sb + lz * cb;
    const y = ly * ca + z * sa; z = -ly * sa + z * ca;
    const scale = focal / Math.max(focal + z, focal * 0.05);
    let sx = width / 2 + (qx + x - width / 2) * scale, sy = height / 2 + (qy + y - height / 2) * scale;
    if (pin) {
      const w = pin[2][0] * sx + pin[2][1] * sy + pin[2][2];
      [sx, sy] = [(pin[0][0] * sx + pin[0][1] * sy + pin[0][2]) / w, (pin[1][0] * sx + pin[1][1] * sy + pin[1][2]) / w];
    }
    return [sx, sy];
  });
}

/** The 3x3 matrix taking four source points to four target points. */
export function homography(source: Point[], target: Point[]): Matrix {
  const rows: number[][] = []; const values: number[] = [];
  source.forEach(([x, y], index) => {
    const [u, v] = target[index];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); values.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]); values.push(v);
  });
  const h = solve(rows, values);
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

function solve(rows: number[][], values: number[]): number[] {
  const n = values.length;
  const m = rows.map((row, index) => [...row, values[index]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    if (Math.abs(m[col][col]) < 1e-12) throw new Error('The title is turned edge-on.');
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = m[r][col] / m[col][col];
      for (let c = col; c <= n; c += 1) m[r][c] -= factor * m[col][c];
    }
  }
  return m.map((row, r) => row[n] / row[r]);
}

export function invert(m: Matrix): Matrix {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}

/** The title's pose and look `local` seconds in, as pose_at in title3d.py. */
export function poseAt(text: TextItem, local: number) {
  const look = animatedLook(text.enter, text.exit, local, text.length);
  const t = text.transform ?? { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
  const pose: Pose = {
    cx: 0.5 + look.dx + (valueAt(t, 'x', local) - 0.5) * look.scale,
    cy: 0.5 + look.dy + (valueAt(t, 'y', local) - 0.5) * look.scale,
    size: valueAt(t, 'scale', local) * look.scale, turn: valueAt(t, 'rotation', local),
    tilt_x: valueAt(t, 'tilt_x', local) + (look.tilt ?? 0), tilt_y: valueAt(t, 'tilt_y', local),
  };
  return { pose, look };
}

/** The title's box in its picture: every pixel with alpha over ALPHA_EDGE, padded a little. Same rule as alpha_box in title3d_render.py. */
export function alphaBox(alpha: Uint8ClampedArray | Uint8Array, width: number, height: number, stride = 4, offset = 3): Box | null {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (alpha[(y * width + x) * stride + offset] > ALPHA_EDGE) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const pad = 4;
  return [Math.max(0, x0 - pad), Math.max(0, y0 - pad), Math.min(width, x1 + 1 + pad), Math.min(height, y1 + 1 + pad)];
}

/** How the scene moves through a clip, in its source's 0..1 coordinates (scene_track_service.py). */
export type SceneTrack = { fps: number; first: number; matrices: Matrix[]; lost: number[] };

export function matrixAt(track: SceneTrack, sourceSeconds: number): Matrix {
  const index = Math.min(track.matrices.length - 1, Math.max(0, Math.round(sourceSeconds * track.fps) - track.first));
  return track.matrices[index];
}

const multiply = (a: Matrix, b: Matrix): Matrix => [0, 1, 2].map((r) => [0, 1, 2].map((c) => a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c])) as Matrix;

type Placed = { in: number; start: number; speed: number; out: number; adjust: { rotation: number }; transform: import('./evaluate.ts').Transform };

export const sourceSeconds = (clip: Placed, timelineSeconds: number) => clip.in + (timelineSeconds - clip.start) * clip.speed;

/** Source 0..1 to frame pixels for a clip as it sits on the frame. Same rule as clip_placement in title3d.py. */
export function clipPlacement(clip: Placed, source: { width: number; height: number }, format: { width: number; height: number }, local: number): Matrix {
  const [w, h] = clip.adjust.rotation % 180 ? [source.height || format.width, source.width || format.height] : [source.width || format.width, source.height || format.height];
  const fit = Math.min(format.width / w, format.height / h);
  const s = valueAt(clip.transform, 'scale', local);
  const fw = w * fit * s, fh = h * fit * s;
  const cx = valueAt(clip.transform, 'x', local) * format.width, cy = valueAt(clip.transform, 'y', local) * format.height;
  return [[fw, 0, cx - fw / 2], [0, fh, cy - fh / 2], [0, 0, 1]];
}

/** The source stretch a pinned title follows (start, end, at), as pinned() in title3d.py. */
export function pinStretch(clip: Placed, text: TextItem) {
  const start = Math.max(clip.in, sourceSeconds(clip, text.start));
  const end = Math.min(clip.out, sourceSeconds(clip, text.start + text.length));
  const at = Math.min(Math.max(sourceSeconds(clip, text.pin!.at), start), end);
  return { start, end, at };
}

/** Frame pixels at the pin moment to frame pixels at `timelineSeconds`. Same as scene_matrix in title3d.py. */
export function sceneMatrix(track: SceneTrack, clip: Placed, source: { width: number; height: number }, format: { width: number; height: number }, timelineSeconds: number, pinSeconds: number): Matrix {
  const place = clipPlacement(clip, source, format, pinSeconds - clip.start);
  return multiply(multiply(place, matrixAt(track, sourceSeconds(clip, timelineSeconds))), invert(place));
}
