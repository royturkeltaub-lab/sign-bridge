// Fingerspelling decoder: hand landmarks per frame -> typed text.
// Combines the handshape classifier, the speller (temporal smoothing) and movement rules:
//   - a held letter followed by its movement becomes the moving variant (ASL J, ISL finals),
//   - a held letter slid sideways is typed again (how double letters are fingerspelled).
import { classKey } from './classifier.js';
import { handFeatures } from './features.js';
import { Speller } from './speller.js';

export const MOTION = {
  variantMin: 0.5, // travel (in hand lengths) that turns a letter into its moving variant
  variantMax: 2.2, // more than this is the hand leaving, not a letter movement
  slideMin: 0.3, // sideways travel that doubles a letter
  slideMaxDrift: 0.3, // vertical drift allowed during a slide
  stillRadius: 0.1, // hand counts as stopped when it stays within this radius...
  stillMs: 130, // ...for this long
  repeatRadius: 0.2, // holding still within this radius allows the timed repeat
};

/**
 * Movement roles of an alphabet's letters.
 * `variants`: base letter -> { letter, down } for "base letter + movement" entries.
 * `selfMoving`: letters that are themselves traced in the air (ASL Z).
 */
export function movingLetters(alphabet) {
  const statics = new Map();
  for (const [letter, def] of Object.entries(alphabet)) {
    if (!def.path) statics.set(classKey(def), letter);
  }
  const variants = new Map();
  const selfMoving = new Set();
  for (const [letter, def] of Object.entries(alphabet)) {
    if (!def.path) continue;
    const base = statics.get(classKey(def));
    if (!base) {
      selfMoving.add(letter);
      continue;
    }
    const first = def.path[0][1];
    const last = def.path[def.path.length - 1][1];
    const dx = last[0] - first[0];
    const dy = last[1] - first[1];
    variants.set(base, { letter, down: dy < 0 && Math.abs(dy) > Math.abs(dx) });
  }
  return { variants, selfMoving };
}

export class LetterDecoder {
  /**
   * @param {import('./classifier.js').HandshapeClassifier} classifier already set to the alphabet
   * @param {object} alphabet the sign language's ALPHABET
   */
  constructor(classifier, alphabet, spellerOptions = {}) {
    this.classifier = classifier;
    Object.assign(this, movingLetters(alphabet));
    this.speller = new Speller(spellerOptions);
    this.held = null; // { letter, x, y } last typed letter and where it was typed
    this.trail = []; // recent hand positions { time, x, y } in hand lengths
  }

  get text() {
    return this.speller.text;
  }

  reset() {
    this.speller.reset();
    this.held = null;
    this.trail = [];
  }

  /** True when the hand has stayed put for MOTION.stillMs. */
  stopped(time, x, y) {
    const oldest = this.trail[0];
    if (!oldest || time - oldest.time < MOTION.stillMs) return false;
    return this.trail.every((p) => Math.hypot(p.x - x, p.y - y) <= MOTION.stillRadius);
  }

  /**
   * @param {number} time ms
   * @param {{landmarks: Array, handed: string}|null} hand null when no hand is visible
   * @param {number} aspect image width / height (landmark x and y are both 0..1)
   */
  update(time, hand, aspect = 1) {
    if (!hand) {
      this.held = null;
      this.trail = [];
      return { ...this.speller.update(time, null), letter: null, confidence: 0 };
    }
    const lm = hand.landmarks;
    const size = Math.hypot((lm[9].x - lm[0].x) * aspect, lm[9].y - lm[0].y, (lm[9].z || 0) - (lm[0].z || 0)) || 1e-6;
    // Positions in hand lengths, so thresholds do not depend on distance from the camera.
    const x = (lm[9].x * aspect) / size;
    const y = lm[9].y / size;
    this.trail.push({ time, x, y });
    while (this.trail.length && time - this.trail[0].time > MOTION.stillMs * 1.6) this.trail.shift();

    const dx = this.held ? x - this.held.x : 0;
    const dy = this.held ? y - this.held.y : 0; // image y grows downwards
    const travel = Math.hypot(dx, dy);
    const still = travel <= MOTION.repeatRadius && !(this.held && this.selfMoving.has(this.held.letter));

    const prediction = this.classifier.predictFeatures(handFeatures(lm, { aspect, hint: hand.handed }));
    const state = this.speller.update(time, prediction, still);

    if (state.typed) {
      this.held = { letter: state.typed, x, y };
    } else if (this.held && this.stopped(time, x, y)) {
      const variant = this.variants.get(this.held.letter);
      if (variant) {
        const amount = variant.down ? dy : travel;
        if (amount >= MOTION.variantMin && travel <= MOTION.variantMax) {
          this.speller.text = this.speller.text.slice(0, -1) + variant.letter;
          state.typed = variant.letter;
          this.held = null;
        }
      } else if (
        !this.selfMoving.has(this.held.letter) &&
        state.candidate === this.held.letter &&
        Math.abs(dx) >= MOTION.slideMin &&
        Math.abs(dy) <= MOTION.slideMaxDrift
      ) {
        this.speller.text += this.held.letter;
        this.speller.committedAt = time;
        state.typed = this.held.letter;
        this.held = { letter: this.held.letter, x, y };
      }
    }
    return {
      ...state,
      text: this.speller.text,
      letter: prediction ? prediction.label : null,
      confidence: prediction ? prediction.confidence : 0,
    };
  }
}
