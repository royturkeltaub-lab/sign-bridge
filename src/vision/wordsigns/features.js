// Landmark features for the word-sign model: a port of GestureSign (MIT, (c) 2026 Shashank
// Yadav) web/src/ml/features.ts, itself a line-for-line port of the Python training code.
// evals/wordsigns/features-fixture.json (computed by the original Python) is checked by
// scripts/eval-wordsigns.js, so drift from the training features is detected.
//
// Pure functions; runs in the browser and in Node. Arithmetic is float64, stored as float32.
import {
  HAND_MIDDLE_MCP,
  HAND_WRIST,
  LEFT_HAND_START,
  LIPS,
  LIPS_MIRROR,
  N_HAND,
  POSE_LEFT_SHOULDER,
  POSE_RIGHT_SHOULDER,
  POSE_START,
  POSE_UPPER,
  POSE_UPPER_MIRROR,
  RIGHT_HAND_START,
} from './landmarks.js';

export const FEATURE_VERSION = 2;
export const DEFAULT_ANCHOR = Object.freeze({ cx: 0.5, cy: 0.5, scale: 0.25, yScale: 0.25 });
const MIN_SCALE = 1e-3;
/** Median eye-to-mouth / ear-to-ear distance in asl-signs (normalised coordinates). */
export const FACE_RATIO_REF = 0.43;
const FACE_RATIO_MIN = 0.2;
const FACE_RATIO_MAX = 1.2;

// Layout of one row (hands_pose_lips): 186 positions + 84 hand shape + 4 presence + 186 velocity.
const HAND_DIM = N_HAND * 2;
export const POSITIONS = 2 * HAND_DIM + POSE_UPPER.length * 2 + LIPS.length * 2; // 186
export const FRAME_DIM = POSITIONS + 2 * HAND_DIM + 4; // 274
export const SEQUENCE_DIM = FRAME_DIM + POSITIONS; // 460

const range = (start, n) => Array.from({ length: n }, (_, i) => start + i);
const pointOrder = (mirror) => [
  ...range(mirror ? LEFT_HAND_START : RIGHT_HAND_START, N_HAND), // signing hand first
  ...range(mirror ? RIGHT_HAND_START : LEFT_HAND_START, N_HAND),
  ...(mirror ? POSE_UPPER_MIRROR : POSE_UPPER).map((i) => POSE_START + i),
  ...(mirror ? LIPS_MIRROR : LIPS),
];
const ORDER = [pointOrder(false), pointOrder(true)];

const fx = (f, point) => f[point * 3];
const fy = (f, point) => f[point * 3 + 1];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median eye-to-mouth over ear-to-ear distance from pose points, or null if never seen.
 * MediaPipe normalises x by image width and y by height, so this ratio measures how the
 * camera's aspect ratio stretches vertical distances.
 */
export function faceRatio(frames) {
  const ratios = [];
  const p = (i) => POSE_START + i;
  for (const f of frames) {
    const eyeX = (fx(f, p(2)) + fx(f, p(5))) / 2;
    const eyeY = (fy(f, p(2)) + fy(f, p(5))) / 2;
    const mouthX = (fx(f, p(9)) + fx(f, p(10))) / 2;
    const mouthY = (fy(f, p(9)) + fy(f, p(10))) / 2;
    const vertical = Math.hypot(eyeX - mouthX, eyeY - mouthY);
    const horizontal = Math.hypot(fx(f, p(7)) - fx(f, p(8)), fy(f, p(7)) - fy(f, p(8)));
    if (Number.isFinite(vertical) && Number.isFinite(horizontal) && horizontal > 1e-4) {
      ratios.push(vertical / horizontal);
    }
  }
  if (ratios.length === 0) return null;
  return Math.min(Math.max(median(ratios), FACE_RATIO_MIN), FACE_RATIO_MAX);
}

/** Shoulder midpoint and width (medians over frames showing both shoulders) and y scale. */
export function computeAnchor(frames) {
  const cxs = [];
  const cys = [];
  const widths = [];
  const l = POSE_START + POSE_LEFT_SHOULDER;
  const r = POSE_START + POSE_RIGHT_SHOULDER;
  for (const f of frames) {
    const lx = fx(f, l);
    const ly = fy(f, l);
    const rx = fx(f, r);
    const ry = fy(f, r);
    if (!(Number.isFinite(lx) && Number.isFinite(ly) && Number.isFinite(rx) && Number.isFinite(ry))) continue;
    cxs.push((lx + rx) / 2);
    cys.push((ly + ry) / 2);
    widths.push(Math.hypot(lx - rx, ly - ry));
  }
  let { cx, cy, scale } = DEFAULT_ANCHOR;
  if (cxs.length > 0) {
    scale = median(widths);
    if (!(scale > MIN_SCALE)) scale = DEFAULT_ANCHOR.scale;
    cx = median(cxs);
    cy = median(cys);
  }
  const ratio = faceRatio(frames);
  return { cx, cy, scale, yScale: ratio === null ? scale : (scale * ratio) / FACE_RATIO_REF };
}

function handSeen(f, start) {
  for (let i = 0; i < N_HAND; i++) if (Number.isFinite(fx(f, start + i))) return true;
  return false;
}

function wristTravel(frames, start) {
  let total = 0;
  const w = start + HAND_WRIST;
  for (let t = 1; t < frames.length; t++) {
    const a = frames[t - 1];
    const b = frames[t];
    const step = Math.abs(fx(b, w) - fx(a, w)) + Math.abs(fy(b, w) - fy(a, w));
    if (Number.isFinite(step)) total += step;
  }
  return total;
}

/**
 * The signing hand is the one seen in more frames; on a tie, the one whose wrist travels
 * further. Both rules swap under a horizontal flip, so a mirrored webcam image and a
 * left-handed signer canonicalise to the same features.
 */
export function leftIsDominant(frames) {
  let left = 0;
  let right = 0;
  for (const f of frames) {
    if (handSeen(f, LEFT_HAND_START)) left++;
    if (handSeen(f, RIGHT_HAND_START)) right++;
  }
  if (left !== right) return left > right;
  return wristTravel(frames, LEFT_HAND_START) > wristTravel(frames, RIGHT_HAND_START);
}

/** Per-frame features (NaN zeroed) plus the raw normalised positions (NaN kept). */
function frameBlock(f, anchor, mirror) {
  const sign = mirror ? -1 : 1;
  const order = ORDER[mirror ? 1 : 0];
  const positions = new Float64Array(POSITIONS);
  for (let i = 0; i < order.length; i++) {
    positions[2 * i] = ((fx(f, order[i]) - anchor.cx) / anchor.scale) * sign;
    positions[2 * i + 1] = (fy(f, order[i]) - anchor.cy) / anchor.yScale;
  }
  const features = new Float64Array(FRAME_DIM);
  features.set(positions, 0);
  let o = POSITIONS;
  for (const hand of [0, HAND_DIM]) {
    const wx = positions[hand + HAND_WRIST * 2];
    const wy = positions[hand + HAND_WRIST * 2 + 1];
    let size = Math.hypot(positions[hand + HAND_MIDDLE_MCP * 2] - wx, positions[hand + HAND_MIDDLE_MCP * 2 + 1] - wy);
    if (!(Number.isFinite(size) && size > 1e-6)) size = 1;
    for (let i = 0; i < N_HAND; i++) {
      features[o++] = (positions[hand + i * 2] - wx) / size;
      features[o++] = (positions[hand + i * 2 + 1] - wy) / size;
    }
  }
  const anyX = (from, count) => {
    for (let i = 0; i < count; i++) if (Number.isFinite(positions[(from + i) * 2])) return 1;
    return 0;
  };
  features[o++] = anyX(0, N_HAND);
  features[o++] = anyX(N_HAND, N_HAND);
  features[o++] = anyX(2 * N_HAND, POSE_UPPER.length);
  features[o] = anyX(2 * N_HAND + POSE_UPPER.length, LIPS.length);
  for (let i = 0; i < features.length; i++) if (!Number.isFinite(features[i])) features[i] = 0;
  return { features, positions };
}

/**
 * Features of one frame (274 values). Without an anchor and mirror flag it is treated as a
 * sequence of one: its own shoulders anchor it, and it is mirrored when only the left hand shows.
 */
export function frameFeatures(frame, anchor = computeAnchor([frame]), mirror = leftIsDominant([frame])) {
  return Float32Array.from(frameBlock(frame, anchor, mirror).features);
}

/** Per-frame features plus velocity, flattened row-major as [T, 460]. */
export function sequenceFeatures(frames) {
  const out = new Float32Array(frames.length * SEQUENCE_DIM);
  if (frames.length === 0) return out;
  const anchor = computeAnchor(frames);
  const mirror = leftIsDominant(frames);
  let previous = null;
  frames.forEach((f, t) => {
    const { features, positions } = frameBlock(f, anchor, mirror);
    const row = t * SEQUENCE_DIM;
    out.set(features, row);
    if (previous) {
      for (let i = 0; i < POSITIONS; i++) {
        const now = positions[i];
        const before = previous[i];
        out[row + FRAME_DIM + i] = Number.isFinite(now) && Number.isFinite(before) ? now - before : 0;
      }
    }
    previous = positions;
  });
  return out;
}

export function resampledLength(T, srcFps, dstFps) {
  if (T <= 1) return T;
  return Math.floor(((T - 1) * dstFps) / srcFps + 1e-9) + 1;
}

function interpolate(seq, at) {
  const T = seq.length;
  return at.map((u) => {
    const i0 = Math.min(Math.floor(u), T - 1);
    const i1 = Math.min(i0 + 1, T - 1);
    const w = u - i0;
    const a = seq[i0];
    const b = seq[i1];
    const out = new Float32Array(a.length);
    for (let k = 0; k < a.length; k++) {
      const va = a[k];
      const vb = b[k];
      out[k] = Number.isFinite(va) && Number.isFinite(vb) ? va + (vb - va) * w : w < 0.5 ? va : vb;
    }
    return out;
  });
}

/** Resample frames recorded at srcFps to dstFps (first frame kept, never past the last). */
export function resample(seq, srcFps, dstFps) {
  const T = seq.length;
  const n = resampledLength(T, srcFps, dstFps);
  if ((n === T && srcFps === dstFps) || T <= 1) return [...seq];
  return interpolate(seq, Array.from({ length: n }, (_, k) => (k * srcFps) / dstFps));
}

/** Squeeze sequences longer than maxLen onto exactly maxLen frames. */
export function fitLength(seq, maxLen) {
  const T = seq.length;
  if (maxLen >= T) return [...seq];
  return interpolate(seq, Array.from({ length: maxLen }, (_, k) => (k * (T - 1)) / (maxLen - 1)));
}

/**
 * A captured segment -> the model's input: resample to the model's frame rate, squeeze to at
 * most maxFrames, compute features. Returns { data: Float32Array [frames * 460], frames, dim }.
 */
export function modelInput(frames, srcFps, { fps = 30, maxFrames = 64 } = {}) {
  const fitted = fitLength(resample(frames, srcFps, fps), maxFrames);
  return { data: sequenceFeatures(fitted), frames: fitted.length, dim: SEQUENCE_DIM };
}
