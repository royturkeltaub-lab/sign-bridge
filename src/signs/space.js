// Signing space: body landmarks, directions and small builders used by sign definitions.
//
// Coordinates are "signer space" as seen by the viewer: x to the viewer's right, y up,
// z towards the viewer. The signer is right-handed, so the dominant hand appears on the
// viewer's LEFT (negative x). SL / SR mean the *signer's* left / right.

export const U = [0, 1, 0];
export const D = [0, -1, 0];
export const OUT = [0, 0, 1];
export const IN = [0, 0, -1];
export const SL = [1, 0, 0];
export const SR = [-1, 0, 0];

export const BODY = {
  headCenter: [0, 1.15, 0],
  headRadius: 0.36,
  shoulderR: [-0.6, 0.52, 0],
  shoulderL: [0.6, 0.52, 0],
  hipY: -0.75,
  upperArm: 0.62,
  foreArm: 0.6,
  handSize: 0.28,
};

/** Named places for the centre of the hand (roughly the knuckles). */
export const LOC = {
  spell: [-0.62, 0.5, 0.55],
  neutral: [-0.36, 0.2, 0.6],
  neutralL: [0.36, 0.2, 0.6],
  center: [0, 0.2, 0.62],
  chest: [-0.05, 0.28, 0.34],
  forehead: [-0.12, 1.36, 0.36],
  temple: [-0.3, 1.3, 0.3],
  chin: [-0.04, 0.72, 0.4],
  mouth: [-0.06, 0.86, 0.42],
  cheek: [-0.26, 0.92, 0.36],
  ear: [-0.36, 1.1, 0.26],
  restR: [-0.62, -0.62, 0.12],
  restL: [0.62, -0.62, 0.12],
};

/** A hand state: handshape + where it is + which way the fingers and palm face. */
export function h(shape, at, finger = U, palm = OUT) {
  return { shape, at: typeof at === 'string' ? LOC[at] : at, finger, palm };
}

/** Shift a hand state by an offset, optionally changing shape/orientation. */
export function shift(state, offset, changes = {}) {
  return {
    ...state,
    at: [state.at[0] + offset[0], state.at[1] + offset[1], state.at[2] + offset[2]],
    ...changes,
  };
}

export const REST = {
  dom: h('5', 'restR', D, [1, 0, 0.2]),
  non: h('5', 'restL', D, [-1, 0, 0.2]),
};

/**
 * Build a sign from frames. Each frame is [t, dom, non?] with t in 0..1.
 * A missing non-dominant hand stays at rest.
 */
export function sign(gloss, dur, frames, meta = {}) {
  return {
    gloss,
    dur,
    frames: frames.map(([t, dom, non]) => ({ t, dom, non: non || null })),
    ...meta,
  };
}

/** Frames that go a -> b (one movement). Each of a/b is [dom, non?]. */
export function move(a, b) {
  return [
    [0, a[0], a[1]],
    [0.15, a[0], a[1]],
    [0.85, b[0], b[1]],
    [1, b[0], b[1]],
  ];
}

/** Frames that alternate a, b, a, b ... `times` times (taps, nods, shakes). */
export function repeat(a, b, times = 2) {
  const frames = [];
  const steps = times * 2;
  for (let i = 0; i <= steps; i++) {
    const s = i % 2 === 0 ? a : b;
    frames.push([i / steps, s[0], s[1]]);
  }
  return frames;
}

/** Frames tracing a closed loop of offsets around a base state (circles). */
export function circle(base, radius, turns = 2, plane = 'xy', nonHand = null) {
  const frames = [];
  const steps = 8 * turns;
  for (let i = 0; i <= steps; i++) {
    const a = (i / 8) * Math.PI * 2;
    const c = Math.cos(a) * radius;
    const s = Math.sin(a) * radius;
    const offset = plane === 'xy' ? [c, s, 0] : plane === 'yz' ? [0, s, c] : [c, 0, s];
    frames.push([i / steps, shift(base, offset), nonHand]);
  }
  return frames;
}
