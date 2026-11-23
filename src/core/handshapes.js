// Handshape inventory shared by the renderer (speech -> sign) and by the synthetic
// round-trip evals. A handshape is a set of joint angles; a *letter* or *sign* then adds
// orientation and movement on top (see src/signs/).
//
// Finger pose: [mcpFlex, pipFlex, dipFlex, abduction] in degrees.
//   flexion curls towards the palm; abduction > 0 leans towards the thumb side.
// Thumb pose, one of:
//   { dir: [x,y,z], bend: [mcp, ip], toward: [x,y,z] }  explicit pose
//   { touch: 'index'|'middle'|..., joint: 'tip'|'pip'|'dip' } reach to a finger joint (IK)

const X = [0, 0, 0]; // extended
const FIST = [88, 100, 75]; // fully curled
const CURVE = [35, 45, 30]; // open curve (C)
const ROUND = [58, 62, 35]; // closed curve meeting the thumb (O)
const HOOK = [8, 95, 70]; // hooked (X)
const OVER = [78, 82, 40]; // folded over the thumb (M, N, T)
const CLAW = [62, 100, 60]; // tips resting on the thumb (E)

const withAbd = (pose, abd) => [pose[0], pose[1], pose[2], abd];

// Default abductions.
const TOGETHER = { index: 2, middle: 0, ring: -2, pinky: -4 };
const SPREAD = { index: 12, middle: 2, ring: -10, pinky: -22 };

function fingers(index, middle, ring, pinky, abd = TOGETHER) {
  return {
    index: withAbd(index, index[3] ?? abd.index),
    middle: withAbd(middle, middle[3] ?? abd.middle),
    ring: withAbd(ring, ring[3] ?? abd.ring),
    pinky: withAbd(pinky, pinky[3] ?? abd.pinky),
  };
}

const THUMB = {
  out: { dir: [0.92, 0.38, 0.05], bend: [0, 0], toward: [0, 1, 0] },
  side: { dir: [0.3, 0.94, 0.16], bend: [4, 6], toward: [-1, 0, 0.4] },
  across: { dir: [0.38, 0.66, 0.65], bend: [48, 42], toward: [-1, 0.15, 0.1] },
  palm: { dir: [0.14, 0.78, 0.6], bend: [55, 38], toward: [-1, 0, 0] },
  tuckT: { dir: [0.2, 0.8, 0.56], bend: [30, 18], toward: [-1, 0.3, 0.2] },
  tuckN: { dir: [0.16, 0.8, 0.58], bend: [46, 28], toward: [-1, 0.3, 0.2] },
  tuckM: { dir: [0.12, 0.8, 0.6], bend: [58, 40], toward: [-1, 0.3, 0.2] },
  curve: { dir: [0.55, 0.5, 0.67], bend: [14, 20], toward: [-0.3, 0.8, 0.1] },
  up: { dir: [0.5, 0.85, 0.1], bend: [0, 0], toward: [0, 1, 0] },
};

/**
 * Handshapes, named after the ASL manual-alphabet letter (or common label) they are known by.
 * These are *shapes only*: orientation and movement live with the letter/sign definitions.
 */
export const HANDSHAPES = {
  A: { fingers: fingers(FIST, FIST, FIST, FIST), thumb: THUMB.side },
  S: { fingers: fingers(FIST, FIST, FIST, FIST), thumb: THUMB.across },
  E: { fingers: fingers(CLAW, CLAW, CLAW, CLAW), thumb: THUMB.palm },
  T: { fingers: fingers(OVER, FIST, FIST, FIST), thumb: THUMB.tuckT },
  N: { fingers: fingers(OVER, OVER, FIST, FIST), thumb: THUMB.tuckN },
  M: { fingers: fingers(OVER, OVER, OVER, FIST), thumb: THUMB.tuckM },
  B: { fingers: fingers(X, X, X, X), thumb: THUMB.palm },
  '5': { fingers: fingers(X, X, X, X, SPREAD), thumb: THUMB.out },
  FLAT: { fingers: fingers(X, X, X, X), thumb: THUMB.up },
  C: { fingers: fingers(CURVE, CURVE, CURVE, CURVE), thumb: THUMB.curve },
  O: { fingers: fingers(ROUND, ROUND, ROUND, ROUND), thumb: { touch: 'middle' } },
  FLAT_O: {
    fingers: fingers([84, 26, 16], [84, 26, 16], [84, 26, 16], [84, 26, 16]),
    thumb: { touch: 'middle' },
  },
  D: { fingers: fingers(X, ROUND, ROUND, ROUND), thumb: { touch: 'middle' } },
  F: {
    fingers: fingers([52, 66, 40, 6], [0, 0, 0, 2], [0, 0, 0, -10], [0, 0, 0, -22]),
    thumb: { touch: 'index' },
  },
  G: { fingers: fingers(X, FIST, FIST, FIST), thumb: THUMB.up },
  H: { fingers: fingers(X, X, FIST, FIST), thumb: THUMB.across },
  I: { fingers: fingers(FIST, FIST, FIST, X), thumb: THUMB.across },
  K: {
    fingers: fingers([0, 0, 0, 6], [62, 4, 2, 0], FIST, FIST),
    thumb: { touch: 'middle', joint: 'pip' },
  },
  L: { fingers: fingers(X, FIST, FIST, FIST), thumb: THUMB.out },
  R: {
    fingers: fingers([6, 4, 2, -13], [0, 4, 2, 14], FIST, FIST),
    thumb: THUMB.across,
  },
  U: { fingers: fingers(X, X, FIST, FIST), thumb: THUMB.across },
  V: { fingers: fingers([0, 0, 0, 12], [0, 0, 0, -10], FIST, FIST), thumb: THUMB.across },
  W: {
    fingers: fingers([0, 0, 0, 14], [0, 0, 0, 0], [0, 0, 0, -14], FIST),
    thumb: { touch: 'pinky', joint: 'dip' },
  },
  X: { fingers: fingers(HOOK, FIST, FIST, FIST), thumb: THUMB.across },
  Y: { fingers: fingers(FIST, FIST, FIST, [0, 0, 0, -24]), thumb: THUMB.out },
  '1': { fingers: fingers(X, FIST, FIST, FIST), thumb: THUMB.across },
  '3': { fingers: fingers([0, 0, 0, 12], [0, 0, 0, -8], FIST, FIST), thumb: THUMB.out },
  CLOSED3: {
    fingers: fingers([82, 24, 14, 4], [82, 24, 14, 0], FIST, FIST),
    thumb: { touch: 'index' },
  },
  // Fist with the thumb stuck out (ISL alef, "thumbs-up" fist).
  THUMB: { fingers: fingers(FIST, FIST, FIST, FIST), thumb: THUMB.out },
  // Index + pinky up, middle + ring held down by the thumb (ISL chet).
  HORNS: {
    fingers: fingers([0, 0, 0, 6], FIST, FIST, [0, 0, 0, -14]),
    thumb: { touch: 'middle', joint: 'dip' },
  },
  // Index + middle raised, spread and hooked (ISL ayin).
  BENT_V: {
    fingers: fingers([8, 80, 50, 12], [8, 80, 50, -10], FIST, FIST),
    thumb: THUMB.across,
  },
  ILY: { fingers: fingers(X, FIST, FIST, [0, 0, 0, -22]), thumb: THUMB.out },
  CLAW5: { fingers: fingers(HOOK, HOOK, HOOK, HOOK, SPREAD), thumb: THUMB.curve },
  BENT_B: {
    fingers: fingers([80, 4, 2], [80, 4, 2], [80, 4, 2], [80, 4, 2]),
    thumb: THUMB.up,
  },
};

export const FINGER_NAMES = ['index', 'middle', 'ring', 'pinky'];

/** Look up a handshape by name; throws on unknown names so data typos surface early. */
export function getHandshape(name) {
  const shape = HANDSHAPES[name];
  if (!shape) throw new Error(`Unknown handshape: ${name}`);
  return shape;
}
