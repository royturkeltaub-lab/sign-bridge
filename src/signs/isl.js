// Israeli Sign Language (שפת הסימנים הישראלית): manual alphabet + a starter lexicon.
//
// Alphabet: cross-checked against four sources (Wikipedia "Israeli Sign Language", the
// israelisignlanguage.com letter photos, and two printed charts). `sure: true` marks letters
// whose handshape all sources agree on; the others are best-effort and flagged in the UI/evals.
// Lexicon: only signs with a written description rated medium-high or better, taken from
// ISL-LEX v1.0 (CC-BY 4.0, https://osf.io/jmwyx/). They still deserve review by a fluent signer.
import { U, D, OUT, IN, SL, h, sign, move, repeat } from './space.js';

const SIDE = [0.8, 0, 0.6];
const DROP = [
  [0, [0, 0.06, 0], {}],
  [1, [0, -0.16, 0], {}],
]; // final letters = base letter + a downward movement

export const ALPHABET = {
  'א': { shape: 'THUMB', sure: false, note: 'handshape agreed; exact orientation varies by source' },
  'ב': { shape: 'B', sure: true },
  'ג': { shape: 'L', finger: SL, palm: IN, sure: true },
  'ד': { shape: 'D', sure: true },
  'ה': { shape: 'H', finger: SL, palm: IN, sure: true },
  'ו': { shape: '1', sure: true },
  'ז': {
    shape: '1',
    finger: [0, 0.45, 0.9],
    palm: [0, -0.9, 0.45],
    sure: false,
    note: 'sources disagree on the traced path',
    path: [
      [0, [-0.1, 0.1, 0], {}],
      [0.4, [0.08, 0.1, 0], {}],
      [1, [0.02, -0.12, 0], {}],
    ],
  },
  'ח': { shape: 'HORNS', sure: true },
  'ט': { shape: 'F', sure: true },
  'י': { shape: 'I', sure: true },
  'כ': { shape: 'C', palm: SIDE, sure: true },
  'ך': { shape: 'C', palm: SIDE, path: DROP, sure: true },
  'ל': { shape: 'L', sure: true },
  'מ': { shape: 'M', sure: false, note: 'finger count rests on one source' },
  'ם': { shape: 'M', path: DROP, sure: false },
  'נ': { shape: 'N', sure: false, note: 'finger count rests on one source' },
  'ן': { shape: 'N', path: DROP, sure: false },
  'ס': { shape: 'S', sure: true },
  'ע': { shape: 'BENT_V', sure: true },
  'פ': { shape: 'K', finger: [0, -0.35, 0.94], palm: [0, -0.94, -0.35], sure: true },
  'ף': { shape: 'K', finger: [0, -0.35, 0.94], palm: [0, -0.94, -0.35], path: DROP, sure: true },
  'צ': { shape: '3', sure: true },
  'ץ': { shape: '3', path: DROP, sure: true },
  'ק': { shape: 'K', sure: true },
  'ר': { shape: 'R', sure: true },
  'ש': { shape: 'W', sure: true },
  'ת': { shape: 'T', sure: true },
};

const SIGNS = [
  // Open hand, palm out, waves side to side.
  sign('שלום', 1100, repeat([h('5', [-0.62, 0.62, 0.55], [-0.2, 1, 0], OUT)], [h('5', [-0.46, 0.62, 0.55], [0.2, 1, 0], OUT)], 2)),
  // Flat hand at the chin, palm towards the signer, moves straight forward.
  sign('תודה', 950, move([h('FLAT', 'chin', U, IN)], [h('FLAT', [-0.08, 0.62, 0.86], U, IN)])),
  // Dominant flat hand strokes forward along the back of the other hand, palms down.
  sign('סליחה', 1200, repeat(
    [h('FLAT', [0.0, 0.26, 0.5], [0.5, 0, 0.87], D), h('FLAT', [0.12, 0.18, 0.62], [-0.6, 0, 0.8], D)],
    [h('FLAT', [0.06, 0.26, 0.68], [0.5, 0, 0.87], D), h('FLAT', [0.12, 0.18, 0.62], [-0.6, 0, 0.8], D)],
    2,
  )),
  // Raised index moves once sideways towards the dominant side.
  sign('לא', 800, move([h('1', [-0.3, 0.5, 0.6], U, OUT)], [h('1', [-0.62, 0.5, 0.6], U, OUT)])),
  // Index points at the upper chest.
  sign('אני', 800, repeat([h('1', [-0.08, 0.36, 0.6], [0.25, -0.1, -1], [1, 0, 0.2])], [h('1', [-0.06, 0.36, 0.46], [0.25, -0.1, -1], [1, 0, 0.2])], 1)),
  // Bunched fingertips move to the mouth, repeated.
  sign('לאכול', 1000, repeat([h('FLAT_O', [-0.1, 0.78, 0.6], [0.15, 0.35, -0.9], [0.2, -0.9, -0.35])], [h('FLAT_O', [-0.08, 0.84, 0.5], [0.15, 0.35, -0.9], [0.2, -0.9, -0.35])], 2)),
  // Fist with the thumb out; the thumb tips towards the mouth.
  sign('לשתות', 950, move([h('THUMB', [-0.2, 0.66, 0.6], [0, 0.4, 0.9], SL)], [h('THUMB', [-0.14, 0.8, 0.5], [0.5, 0.75, 0.4], [0.75, -0.6, 0.2])])),
  // Dominant fist comes down repeatedly on the thumb side of the other fist.
  sign('עבודה', 1000, repeat(
    [h('S', [0.02, 0.36, 0.62], OUT, SL), h('S', [0.02, 0.18, 0.62], OUT, [-1, 0, 0])],
    [h('S', [0.02, 0.29, 0.62], OUT, SL), h('S', [0.02, 0.18, 0.62], OUT, [-1, 0, 0])],
    2,
  )),
  // Bunched fingertips move repeatedly towards the temple.
  sign('ללמוד', 1000, repeat([h('FLAT_O', [-0.44, 1.2, 0.44], [0.7, 0.3, -0.6], [0.5, -0.6, -0.6])], [h('FLAT_O', [-0.38, 1.24, 0.36], [0.7, 0.3, -0.6], [0.5, -0.6, -0.6])], 2)),
  // Open hands, palms towards the body, arms cross onto the chest.
  sign('לאהוב', 1100, move(
    [h('5', [-0.3, 0.2, 0.62], [0.5, 0.85, 0], IN), h('5', [0.3, 0.2, 0.62], [-0.5, 0.85, 0], IN)],
    [h('5', [0.14, 0.32, 0.36], [0.5, 0.85, 0], IN), h('5', [-0.14, 0.3, 0.3], [-0.5, 0.85, 0], IN)],
  )),
];

export const LEXICON = Object.fromEntries(SIGNS.map((s) => [s.gloss, s]));

const NIQQUD = /[֑-ׇ]/g;

/** Letter for alphabet lookup (niqqud stripped); null when the character is not spellable. */
export function normalizeLetter(ch) {
  const bare = ch.replace(NIQQUD, '');
  return ALPHABET[bare] ? bare : null;
}

export default { code: 'isl', ALPHABET, LEXICON, normalizeLetter };
