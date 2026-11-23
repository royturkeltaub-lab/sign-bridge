// American Sign Language: manual alphabet + a starter lexicon.
import { U, D, OUT, IN, SL, LOC, h, shift, sign, move, repeat, circle } from './space.js';

const SIDE = [0.8, 0, 0.6]; // palm turned so the viewer sees the hand's profile

/**
 * Manual alphabet. Each letter: handshape + orientation, optional `path` for moving letters.
 * `path` entries are [t, offset, changes] applied to the base state.
 */
export const ALPHABET = {
  A: { shape: 'A' },
  B: { shape: 'B' },
  C: { shape: 'C', palm: SIDE },
  D: { shape: 'D' },
  E: { shape: 'E' },
  F: { shape: 'F' },
  G: { shape: 'G', finger: SL, palm: IN },
  H: { shape: 'H', finger: SL, palm: IN },
  I: { shape: 'I' },
  J: {
    shape: 'I',
    path: [
      [0, [0, 0.08, 0], {}],
      [0.5, [0, -0.1, 0], {}],
      [1, [0.12, -0.14, 0], { finger: [0.75, 0.6, 0.1], palm: [0.2, 0.3, -1] }],
    ],
  },
  K: { shape: 'K' },
  L: { shape: 'L' },
  M: { shape: 'M' },
  N: { shape: 'N' },
  O: { shape: 'O', palm: SIDE },
  P: { shape: 'K', finger: [0, -0.35, 0.94], palm: [0, -0.94, -0.35] },
  Q: { shape: 'G', finger: D, palm: IN },
  R: { shape: 'R' },
  S: { shape: 'S' },
  T: { shape: 'T' },
  U: { shape: 'U' },
  V: { shape: 'V' },
  W: { shape: 'W' },
  X: { shape: 'X' },
  Y: { shape: 'Y' },
  Z: {
    shape: '1',
    finger: [0, 0.45, 0.9],
    palm: [0, -0.9, 0.45],
    path: [
      [0, [-0.12, 0.1, 0], {}],
      [0.33, [0.12, 0.1, 0], {}],
      [0.66, [-0.12, -0.1, 0], {}],
      [1, [0.12, -0.1, 0], {}],
    ],
  },
};

// --- Lexicon -------------------------------------------------------------------------
// Descriptions follow standard ASL dictionary citation forms (dominant hand = right).

const flatUpL = h('FLAT', [0.12, 0.05, 0.6], [-0.6, 0, 0.8], U); // non-dominant palm-up base

const SIGNS = [
  // Flat hand salutes outward from the forehead.
  sign('HELLO', 900, move([h('B', 'temple', U, [-0.3, 0, 1])], [h('B', [-0.78, 1.22, 0.6], [-0.25, 1, 0.2], [-0.2, 0, 1])])),
  // Fingertips at the chin, hand moves forward and down, palm up.
  sign('THANK-YOU', 950, move([h('FLAT', 'chin', U, IN)], [h('FLAT', [-0.12, 0.32, 0.85], [0, 0.25, 1], [0, 1, -0.25])])),
  // Fist nods like a head.
  sign('YES', 1000, repeat([h('S', 'neutral', [0, 1, 0.25], OUT)], [h('S', shiftLoc('neutral', [0, -0.06, 0.08]), [0, 0.2, 1], [0, -1, 0.2])], 2)),
  // Index + middle snap down onto the thumb.
  sign('NO', 900, repeat([h('3', 'neutral', [0, 0.5, 0.86], [0, -0.86, 0.5])], [h('CLOSED3', 'neutral', [0, 0.5, 0.86], [0, -0.86, 0.5])], 2)),
  // Flat palm circles on the chest.
  sign('PLEASE', 1300, circle(h('FLAT', 'chest', [0.85, 0.5, 0], IN), 0.1, 2)),
  // Fist circles on the chest.
  sign('SORRY', 1300, circle(h('A', 'chest', [0.85, 0.5, 0], IN), 0.1, 2)),
  // Index points at self.
  sign('ME', 700, move([h('1', [-0.08, 0.3, 0.62], [0.25, -0.1, -1], [1, 0, 0.2])], [h('1', [-0.06, 0.3, 0.46], [0.25, -0.1, -1], [1, 0, 0.2])])),
  // Index points at the addressee.
  sign('YOU', 700, move([h('1', [-0.3, 0.3, 0.5], OUT, D)], [h('1', [-0.3, 0.3, 0.72], OUT, D)])),
  // Flat palm on the chest.
  sign('MY', 700, move([h('FLAT', [-0.05, 0.3, 0.5], [0.85, 0.5, 0], IN)], [h('FLAT', 'chest', [0.85, 0.5, 0], IN)])),
  // Flat palm pushes towards the addressee.
  sign('YOUR', 700, move([h('FLAT', [-0.3, 0.32, 0.5], U, OUT)], [h('FLAT', [-0.3, 0.32, 0.78], U, OUT)])),
  // Fists crossed over the heart.
  sign('LOVE', 1100, move(
    [h('S', [-0.3, 0.2, 0.6], [0.5, 0.85, 0], IN), h('S', [0.3, 0.2, 0.6], [-0.5, 0.85, 0], IN)],
    [h('S', [0.14, 0.32, 0.36], [0.5, 0.85, 0], IN), h('S', [-0.14, 0.3, 0.3], [-0.5, 0.85, 0], IN)],
  )),
  // Thumb-up fist on the flat palm, both rise.
  sign('HELP', 1000, move(
    [h('A', [0.02, 0.2, 0.62], OUT, SL), flatUpL],
    [h('A', [0.02, 0.44, 0.62], OUT, SL), shift(flatUpL, [0, 0.24, 0])],
  )),
  // Bunched fingertips tap the mouth.
  sign('EAT', 1000, repeat([h('FLAT_O', [-0.1, 0.78, 0.6], [0.15, 0.35, -0.9], [0.2, -0.9, -0.35])], [h('FLAT_O', [-0.08, 0.84, 0.5], [0.15, 0.35, -0.9], [0.2, -0.9, -0.35])], 2)),
  // C hand tips towards the mouth like a cup.
  sign('DRINK', 1000, move([h('C', [-0.12, 0.74, 0.52], U, SL)], [h('C', [-0.1, 0.86, 0.5], [0, 0.6, -0.8], SL)])),
  // Index of the W hand taps the chin.
  sign('WATER', 1000, repeat([h('W', [-0.06, 0.66, 0.52], U, SL)], [h('W', [-0.06, 0.68, 0.42], U, SL)], 2)),
  // Thumb of the open hand taps the chin.
  sign('MOTHER', 1000, repeat([h('5', [-0.1, 0.68, 0.52], U, SL)], [h('5', [-0.1, 0.7, 0.42], U, SL)], 2)),
  // Thumb of the open hand taps the forehead.
  sign('FATHER', 1000, repeat([h('5', [-0.1, 1.24, 0.5], U, SL)], [h('5', [-0.1, 1.26, 0.4], U, SL)], 2)),
  // Palms up, hands shake side to side.
  sign('WHAT', 1100, repeat(
    [h('5', [-0.4, 0.15, 0.65], [-0.2, 0, 1], U), h('5', [0.4, 0.15, 0.65], [0.2, 0, 1], U)],
    [h('5', [-0.3, 0.15, 0.65], [-0.2, 0, 1], U), h('5', [0.3, 0.15, 0.65], [0.2, 0, 1], U)],
    2,
  )),
  // Raised index wags side to side.
  sign('WHERE', 1000, repeat([h('1', [-0.5, 0.5, 0.6], [-0.2, 1, 0], OUT)], [h('1', [-0.38, 0.5, 0.6], [0.2, 1, 0], OUT)], 2)),
  // Fingertips at the chin, hand lands in the other palm.
  sign('GOOD', 1000, move([h('FLAT', 'chin', U, IN), flatUpL], [h('FLAT', [0.06, 0.14, 0.62], [0.4, 0, 0.9], U), flatUpL])),
  // Fingertips at the chin, hand flips palm-down.
  sign('BAD', 1000, move([h('FLAT', 'chin', U, IN)], [h('FLAT', [-0.14, 0.2, 0.7], [0.2, 0, 1], D)])),
  // Bunched fingertips of both hands tap together.
  sign('MORE', 1000, repeat(
    [h('FLAT_O', [-0.24, 0.3, 0.6], [1, 0, 0.1], [0, -0.2, -1]), h('FLAT_O', [0.24, 0.3, 0.6], [-1, 0, 0.1], [0, -0.2, -1])],
    [h('FLAT_O', [-0.14, 0.3, 0.6], [1, 0, 0.1], [0, -0.2, -1]), h('FLAT_O', [0.14, 0.3, 0.6], [-1, 0, 0.1], [0, -0.2, -1])],
    2,
  )),
  // Clawed hands, palms up, pull towards the body.
  sign('WANT', 1000, move(
    [h('CLAW5', [-0.3, 0.18, 0.8], OUT, U), h('CLAW5', [0.3, 0.18, 0.8], OUT, U)],
    [h('CLAW5', [-0.3, 0.16, 0.5], OUT, U), h('CLAW5', [0.3, 0.16, 0.5], OUT, U)],
  )),
  // Fingertips tap the temple.
  sign('KNOW', 900, repeat([h('BENT_B', [-0.36, 1.2, 0.42], U, [0.7, 0, -0.7])], [h('BENT_B', [-0.3, 1.22, 0.34], U, [0.7, 0, -0.7])], 2)),
  // Index touches the forehead.
  sign('THINK', 800, move([h('1', [-0.24, 1.14, 0.5], [0.3, 0.8, -0.5], [0.5, -0.5, -0.7])], [h('1', [-0.18, 1.2, 0.4], [0.3, 0.8, -0.5], [0.5, -0.5, -0.7])])),
  // H hands: dominant fingers tap across the other hand's fingers.
  sign('NAME', 1000, repeat(
    [h('H', [-0.12, 0.34, 0.62], [0.8, 0, 0.6], [0.5, 0.3, -0.8]), h('H', [0.12, 0.2, 0.6], [-0.8, 0, 0.6], [-0.5, 0.3, -0.8])],
    [h('H', [-0.12, 0.27, 0.62], [0.8, 0, 0.6], [0.5, 0.3, -0.8]), h('H', [0.12, 0.2, 0.6], [-0.8, 0, 0.6], [-0.5, 0.3, -0.8])],
    2,
  )),
  // Hooked index fingers link, then swap.
  sign('FRIEND', 1200, [
    [0, h('X', [-0.1, 0.3, 0.6], [0.9, 0, 0.3], D), h('X', [0.1, 0.22, 0.6], [-0.9, 0, 0.3], U)],
    [0.4, h('X', [-0.06, 0.28, 0.6], [0.9, 0, 0.3], D), h('X', [0.06, 0.24, 0.6], [-0.9, 0, 0.3], U)],
    [0.6, h('X', [-0.06, 0.24, 0.6], [0.9, 0, 0.3], U), h('X', [0.06, 0.28, 0.6], [-0.9, 0, 0.3], D)],
    [1, h('X', [-0.06, 0.24, 0.6], [0.9, 0, 0.3], U), h('X', [0.06, 0.28, 0.6], [-0.9, 0, 0.3], D)],
  ]),
  // Dominant fist taps the back of the other fist.
  sign('WORK', 1000, repeat(
    [h('S', [-0.08, 0.34, 0.62], [0.7, 0, 0.7], D), h('S', [0.1, 0.2, 0.6], [-0.7, 0, 0.7], D)],
    [h('S', [-0.08, 0.27, 0.62], [0.7, 0, 0.7], D), h('S', [0.1, 0.2, 0.6], [-0.7, 0, 0.7], D)],
    2,
  )),
  // Flat hands clap twice.
  sign('SCHOOL', 1000, repeat(
    [h('FLAT', [-0.02, 0.3, 0.62], [0.7, 0, 0.7], D), flatUpL],
    [h('FLAT', [0.04, 0.16, 0.62], [0.7, 0, 0.7], D), flatUpL],
    2,
  )),
  // Bunched fingertips touch near the mouth, then near the ear.
  sign('HOME', 1000, move([h('FLAT_O', [-0.2, 0.8, 0.46], [0.5, 0.5, -0.7], [0.6, -0.4, -0.7])], [h('FLAT_O', [-0.36, 0.98, 0.4], [0.5, 0.5, -0.7], [0.6, -0.4, -0.7])])),
  // Y hands, palms up, drop slightly.
  sign('NOW', 800, move(
    [h('Y', [-0.3, 0.3, 0.62], OUT, U), h('Y', [0.3, 0.3, 0.62], OUT, U)],
    [h('Y', [-0.3, 0.16, 0.62], OUT, U), h('Y', [0.3, 0.16, 0.62], OUT, U)],
  )),
  // NOW with a double movement.
  sign('TODAY', 1100, repeat(
    [h('Y', [-0.3, 0.3, 0.62], OUT, U), h('Y', [0.3, 0.3, 0.62], OUT, U)],
    [h('Y', [-0.3, 0.16, 0.62], OUT, U), h('Y', [0.3, 0.16, 0.62], OUT, U)],
    2,
  )),
  // V hand moves forward from the eyes.
  sign('SEE', 900, move([h('V', [-0.14, 0.98, 0.42], U, IN)], [h('V', [-0.2, 0.9, 0.8], [0, 0.8, 0.6], IN)])),
  // Index touches the ear, then the corner of the mouth.
  sign('DEAF', 1000, move([h('1', [-0.36, 0.98, 0.4], [0.5, 0.6, -0.6], [0.5, -0.6, -0.6])], [h('1', [-0.2, 0.8, 0.46], [0.5, 0.6, -0.6], [0.5, -0.6, -0.6])])),
  // Thumb of the fist flicks forward from under the chin.
  sign('NOT', 800, move([h('A', [-0.04, 0.62, 0.42], [0.9, 0.2, 0.3], [0.2, 0.3, -0.9])], [h('A', [-0.06, 0.56, 0.78], [0.9, 0.2, 0.3], [0.2, 0.3, -0.9])])),
  // Index fingers point forward and arc away.
  sign('GO', 900, move(
    [h('1', [-0.2, 0.34, 0.5], [0, 0.8, 0.6], OUT), h('1', [0.2, 0.34, 0.5], [0, 0.8, 0.6], OUT)],
    [h('1', [-0.24, 0.2, 0.86], [0, 0.1, 1], D), h('1', [0.24, 0.2, 0.86], [0, 0.1, 1], D)],
  )),
  // Open hands flip outwards.
  sign('FINISH', 900, move(
    [h('5', [-0.3, 0.32, 0.6], U, IN), h('5', [0.3, 0.32, 0.6], U, IN)],
    [h('5', [-0.42, 0.3, 0.66], [-0.3, 0.9, 0.2], OUT), h('5', [0.42, 0.3, 0.66], [0.3, 0.9, 0.2], OUT)],
  )),
  // T hand shakes.
  sign('BATHROOM', 1000, repeat([h('T', [-0.46, 0.44, 0.6], [-0.15, 1, 0], OUT)], [h('T', [-0.38, 0.44, 0.6], [0.15, 1, 0], OUT)], 2)),
];

function shiftLoc(name, offset) {
  const p = LOC[name];
  return [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]];
}

export const LEXICON = Object.fromEntries(SIGNS.map((s) => [s.gloss, s]));

/** Upper-case a letter for alphabet lookup; returns null when the character is not spellable. */
export function normalizeLetter(ch) {
  const up = ch.toUpperCase();
  return ALPHABET[up] ? up : null;
}

export default { code: 'asl', ALPHABET, LEXICON, normalizeLetter };
