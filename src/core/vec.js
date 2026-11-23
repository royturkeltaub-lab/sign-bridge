// Tiny 3D vector helpers (arrays of [x, y, z]).

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => len(sub(a, b));
export const lerp = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export function norm(a) {
  const l = len(a);
  return l < 1e-9 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

/** Angle between two vectors in degrees (0..180). */
export function angleDeg(a, b) {
  const la = len(a);
  const lb = len(b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  const c = Math.max(-1, Math.min(1, dot(a, b) / (la * lb)));
  return (Math.acos(c) * 180) / Math.PI;
}

/** Component of `v` orthogonal to unit vector `n`, normalised. */
export function orthoTo(v, n) {
  return norm(sub(v, scale(n, dot(v, n))));
}

/** Rotate unit vector `d` towards direction `toward` by `deg` degrees (within their common plane). */
export function rotateToward(d, toward, deg) {
  const perp = orthoTo(toward, d);
  if (len(perp) < 1e-9) return d;
  const r = (deg * Math.PI) / 180;
  return norm(add(scale(d, Math.cos(r)), scale(perp, Math.sin(r))));
}

/** Interpolate between two directions and renormalise (good enough for small avatar motions). */
export function lerpDir(a, b, t) {
  const v = lerp(a, b, t);
  return len(v) < 1e-6 ? norm(a) : norm(v);
}

export const deg2rad = (d) => (d * Math.PI) / 180;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
