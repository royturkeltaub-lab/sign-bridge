import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Speller, SPELLER_DEFAULTS } from '../src/vision/speller.js';

const STEP = 33;

/** Feed [label|null, ms, confidence?] segments at ~30 fps; returns every update result. */
function feed(speller, segments, { allowRepeat = true, clock = { t: 0 } } = {}) {
  const states = [];
  for (const [label, ms, confidence = 0.9] of segments) {
    for (const end = clock.t + ms; clock.t < end; clock.t += STEP) {
      states.push(speller.update(clock.t, label == null ? null : { label, confidence }, allowRepeat));
    }
  }
  return states;
}
const typedBy = (segments, options) => {
  const speller = new Speller(options);
  feed(speller, segments);
  return speller.text;
};

describe('Speller', () => {
  test('a letter is typed once it has been held', () => {
    const speller = new Speller();
    const states = feed(speller, [['A', 700]]);
    assert.equal(speller.text, 'A');
    const typed = states.filter((s) => s.typed);
    assert.equal(typed.length, 1);
    assert.equal(typed[0].typed, 'A');
    // Not before ~90% of the hold time has passed.
    const index = states.indexOf(typed[0]);
    assert.ok(index * STEP >= SPELLER_DEFAULTS.holdMs * 0.9 - STEP);
    assert.ok(index * STEP <= SPELLER_DEFAULTS.holdMs + STEP);
  });

  test('a short hold types nothing', () => {
    assert.equal(typedBy([['A', 300]]), '');
    assert.equal(typedBy([['A', 300], ['B', 300], ['C', 300]]), '');
  });

  test('consecutive letters', () => {
    assert.equal(typedBy([['O', 700], ['K', 700]]), 'OK');
    assert.equal(typedBy([['H', 700], ['E', 700], ['Y', 700]]), 'HEY');
  });

  test('reports the candidate and hold progress before typing', () => {
    const speller = new Speller();
    const states = feed(speller, [['A', 300]]);
    const last = states.at(-1);
    assert.equal(last.candidate, 'A');
    assert.equal(last.typed, null);
    assert.ok(last.progress > 0.3 && last.progress < 1);
    for (let i = 1; i < states.length; i++) assert.ok(states[i].progress >= states[i - 1].progress);
    // Once typed, progress resets.
    const after = feed(speller, [['A', 400]], { clock: { t: 300 + STEP } }).at(-1);
    assert.equal(speller.text, 'A');
    assert.equal(after.progress, 0);
  });

  test('brief flickers of another letter are tolerated', () => {
    assert.equal(typedBy([['A', 700], ['B', 100], ['A', 100], ['C', 700]]), 'AC');
    // A single wrong frame in the middle of a hold does not prevent typing.
    assert.equal(typedBy([['A', 250], ['B', 33], ['A', 400]]), 'A');
  });

  test('an evenly split window types nothing', () => {
    const speller = new Speller();
    const clock = { t: 0 };
    for (let i = 0; i < 40; i++) feed(speller, [[i % 2 ? 'A' : 'B', STEP]], { clock });
    assert.equal(speller.text, '');
  });

  test('low-confidence predictions type nothing', () => {
    assert.equal(typedBy([['A', 900, 0.3]]), '');
    assert.equal(typedBy([['A', 900, SPELLER_DEFAULTS.minConfidence - 0.01]]), '');
    assert.equal(typedBy([['A', 900, SPELLER_DEFAULTS.minConfidence]]), 'A');
  });

  test('losing the hand types exactly one space, and never a leading one', () => {
    assert.equal(typedBy([[null, 3000], ['A', 700]]), 'A');
    assert.equal(typedBy([['H', 700], ['I', 700], [null, 1300], ['Y', 700], ['O', 700]]), 'HI YO');
    assert.equal(typedBy([['A', 700], [null, 6000]]), 'A ');
    assert.equal(typedBy([['A', 700], [null, 1300], [null, 1300], ['B', 700]]), 'A B');
  });

  test('a brief hand loss does not type a space but allows the same letter again', () => {
    assert.equal(typedBy([['H', 700], ['E', 700], ['L', 700], [null, 300], ['L', 700], ['O', 700]]), 'HELLO');
    assert.equal(typedBy([['A', 700], [null, SPELLER_DEFAULTS.spaceMs - 200], ['B', 700]]), 'AB');
  });

  test('the space is reported as typed', () => {
    const speller = new Speller();
    const states = feed(speller, [['A', 700], [null, 1500]]);
    assert.equal(states.filter((s) => s.typed === ' ').length, 1);
    assert.equal(states.at(-1).candidate, null);
  });

  test('holding much longer repeats the letter on a timer', () => {
    assert.equal(typedBy([['L', 1800]]), 'L');
    assert.equal(typedBy([['L', 2100]]), 'LL');
    assert.equal(typedBy([['L', 3500]]), 'LLL');
  });

  test('the repeat is suppressed while the hand is moving', () => {
    const speller = new Speller();
    feed(speller, [['L', 4000]], { allowRepeat: false });
    assert.equal(speller.text, 'L');
  });

  test('the repeat timer restarts when the hand stops moving', () => {
    const speller = new Speller();
    const clock = { t: 0 };
    feed(speller, [['L', 700]], { clock });
    feed(speller, [['L', 1500]], { clock, allowRepeat: false });
    assert.equal(speller.text, 'L');
    feed(speller, [['L', 1000]], { clock });
    assert.equal(speller.text, 'L', 'repeat must wait a full repeatMs after the movement');
    feed(speller, [['L', 600]], { clock });
    assert.equal(speller.text, 'LL');
  });

  test('options override the defaults', () => {
    assert.equal(typedBy([['A', 300]], { holdMs: 200 }), 'A');
    assert.equal(typedBy([['A', 900, 0.3]], { minConfidence: 0.2 }), 'A');
    assert.equal(typedBy([['A', 700], [null, 400], ['B', 700]], { spaceMs: 300 }), 'A B');
    assert.equal(new Speller().o.holdMs, SPELLER_DEFAULTS.holdMs);
  });

  test('backspace and space editing', () => {
    const speller = new Speller();
    const clock = { t: 0 };
    speller.space();
    assert.equal(speller.text, '', 'no leading space');
    feed(speller, [['A', 700], ['B', 700]], { clock });
    speller.space();
    speller.space();
    assert.equal(speller.text, 'AB ');
    feed(speller, [[null, 2000]], { clock });
    assert.equal(speller.text, 'AB ', 'no second space after a manual one');
    speller.backspace();
    speller.backspace();
    assert.equal(speller.text, 'A');
    feed(speller, [[null, 2000]], { clock });
    assert.equal(speller.text, 'A ', 'a space is possible again after deleting back to a letter');
    speller.backspace();
    speller.backspace();
    speller.backspace();
    assert.equal(speller.text, '');
  });

  test('reset clears everything', () => {
    const speller = new Speller();
    feed(speller, [['A', 700], ['B', 300]]);
    speller.reset();
    assert.equal(speller.text, '');
    assert.equal(typedBy([['B', 300]]), '');
    const states = feed(speller, [['B', 300]], { clock: { t: 5000 } });
    assert.equal(speller.text, '', 'frames from before the reset must not count');
    assert.ok(states.every((s) => s.typed == null));
  });

  test('works with Hebrew labels', () => {
    assert.equal(typedBy([['ש', 700], ['ל', 700], ['ו', 700], ['ם', 700]]), 'שלום');
  });

  test('irregular frame timing still types', () => {
    const speller = new Speller();
    let t = 0;
    for (const dt of [16, 50, 33, 80, 20, 100, 33, 33, 120, 40, 60, 33, 90, 33]) {
      t += dt;
      speller.update(t, { label: 'A', confidence: 0.9 });
    }
    assert.equal(speller.text, 'A');
  });
});
