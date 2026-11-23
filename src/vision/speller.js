// Turns a noisy per-frame stream of letter predictions into text.
//
// A letter is typed once it has been held steadily; taking the hand out of view (or
// pausing with no confident letter) types a space; holding a letter much longer repeats
// it, which is how double letters are entered.

export const SPELLER_DEFAULTS = {
  holdMs: 550, // steady time needed to type a letter
  repeatMs: 1400, // extra hold time that types the same letter again
  spaceMs: 1100, // time without a hand that types a space
  minConfidence: 0.55,
  agreement: 0.7, // share of the hold window that must agree on the letter
};

export class Speller {
  constructor(options = {}) {
    this.o = { ...SPELLER_DEFAULTS, ...options };
    this.reset();
  }

  reset() {
    this.text = '';
    this.window = []; // recent { time, label }
    this.committed = null; // label typed for the current hold
    this.committedAt = 0;
    this.goneSince = null;
    this.spaced = true; // no leading spaces
  }

  /**
   * @param {number} time ms timestamp
   * @param {{label: string, confidence: number}|null} prediction null when no hand is visible
   * @param {boolean} allowRepeat false while the hand is moving, so a long moving letter is not typed twice
   * @returns {{text: string, typed: string|null, candidate: string|null, progress: number}}
   */
  update(time, prediction, allowRepeat = true) {
    const { o } = this;
    let typed = null;
    const label = prediction && prediction.confidence >= o.minConfidence ? prediction.label : null;

    if (!prediction) {
      if (this.goneSince == null) this.goneSince = time;
      this.window = [];
      this.committed = null;
      if (!this.spaced && time - this.goneSince >= o.spaceMs) {
        this.text += ' ';
        this.spaced = true;
        typed = ' ';
      }
      return { text: this.text, typed, candidate: null, progress: 0 };
    }
    this.goneSince = null;

    this.window.push({ time, label });
    while (this.window.length && time - this.window[0].time > o.holdMs) this.window.shift();

    // Most common label in the hold window.
    const counts = new Map();
    for (const entry of this.window) {
      if (entry.label) counts.set(entry.label, (counts.get(entry.label) || 0) + 1);
    }
    let candidate = null;
    let best = 0;
    for (const [key, count] of counts) {
      if (count > best) {
        best = count;
        candidate = key;
      }
    }
    const span = this.window.length ? time - this.window[0].time : 0;
    const steady = candidate && best / this.window.length >= o.agreement;
    const full = span >= o.holdMs * 0.9;

    if (steady && full) {
      if (this.committed !== candidate) {
        typed = candidate;
        this.committed = candidate;
        this.committedAt = time;
      } else if (!allowRepeat) {
        this.committedAt = time;
      } else if (time - this.committedAt >= o.repeatMs) {
        typed = candidate;
        this.committedAt = time;
      }
    } else if (!steady) {
      this.committed = null;
    }
    if (typed) {
      this.text += typed;
      this.spaced = false;
    }
    const progress = steady && this.committed !== candidate ? Math.min(1, span / o.holdMs) : 0;
    return { text: this.text, typed, candidate, progress };
  }

  backspace() {
    this.text = this.text.slice(0, -1);
    this.spaced = this.text.length === 0 || this.text.endsWith(' ');
  }

  space() {
    if (this.text && !this.text.endsWith(' ')) this.text += ' ';
    this.spaced = true;
  }
}
