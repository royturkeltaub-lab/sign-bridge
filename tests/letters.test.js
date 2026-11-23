import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import asl from '../src/signs/asl.js';
import isl from '../src/signs/isl.js';
import { poseLandmarks } from '../src/core/handModel.js';
import { LetterDecoder, movingLetters, MOTION } from '../src/vision/letters.js';

const STEP = 33;
const SCALE = 0.1; // hand size in image units
const BASE = poseLandmarks('B');
// The decoder measures positions in "hand lengths" (wrist -> middle knuckle).
const HAND_LENGTH = Math.hypot(BASE[9][0], BASE[9][1], BASE[9][2]) * SCALE;

/** A hand whose middle knuckle sits at (hx, hy) hand lengths, image y growing downwards. */
function handAt(hx, hy) {
  const ox = hx * HAND_LENGTH - BASE[9][0] * SCALE;
  const oy = hy * HAND_LENGTH + BASE[9][1] * SCALE;
  return {
    handed: 'right',
    landmarks: BASE.map(([x, y, z]) => ({ x: ox + x * SCALE, y: oy - y * SCALE, z: -z * SCALE })),
  };
}

/** Decoder driven by a scripted classifier, so only the temporal / movement logic is under test. */
function scripted(alphabet) {
  const script = { label: null, confidence: 0.95 };
  const classifier = {
    predictFeatures: () => (script.label ? { label: script.label, confidence: script.confidence } : null),
  };
  const decoder = new LetterDecoder(classifier, alphabet);
  const clock = { t: 0 };
  const run = {
    decoder,
    last: null,
    /** Hold `label` at a fixed spot. */
    hold(label, ms, x = 3, y = 3) {
      script.label = label;
      for (const end = clock.t + ms; clock.t < end; clock.t += STEP) run.last = decoder.update(clock.t, handAt(x, y));
      return run;
    },
    /** Move in a straight line while showing `label`. */
    glide(label, ms, from, to) {
      script.label = label;
      const steps = Math.max(1, Math.round(ms / STEP));
      for (let i = 1; i <= steps; i++) {
        const f = i / steps;
        run.last = decoder.update(clock.t, handAt(from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f));
        clock.t += STEP;
      }
      return run;
    },
    away(ms) {
      for (const end = clock.t + ms; clock.t < end; clock.t += STEP) run.last = decoder.update(clock.t, null);
      return run;
    },
  };
  return run;
}

describe('movingLetters', () => {
  test('ASL: J is the moving variant of I, Z moves on its own', () => {
    const { variants, selfMoving } = movingLetters(asl.ALPHABET);
    assert.deepEqual([...variants.keys()], ['I']);
    assert.equal(variants.get('I').letter, 'J');
    assert.equal(variants.get('I').down, true);
    assert.deepEqual([...selfMoving], ['Z']);
  });

  test('ISL: the five final letters are their base letter dropping down', () => {
    const { variants, selfMoving } = movingLetters(isl.ALPHABET);
    const pairs = Object.fromEntries([...variants].map(([base, v]) => [base, v.letter]));
    assert.deepEqual(pairs, { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' });
    for (const v of variants.values()) assert.equal(v.down, true);
    assert.deepEqual([...selfMoving], ['ז']);
  });

  test('an alphabet without moving letters has no roles', () => {
    const { variants, selfMoving } = movingLetters({ A: { shape: 'A' }, B: { shape: 'B' } });
    assert.equal(variants.size, 0);
    assert.equal(selfMoving.size, 0);
  });

  test('a sideways variant is not marked as "down"', () => {
    const { variants } = movingLetters({
      A: { shape: 'A' },
      AA: { shape: 'A', path: [[0, [0, 0, 0], {}], [1, [0.3, -0.05, 0], {}]] },
    });
    assert.deepEqual(variants.get('A'), { letter: 'AA', down: false });
  });
});

describe('LetterDecoder', () => {
  test('a held letter is typed and reported', () => {
    const run = scripted(asl.ALPHABET).hold('A', 700);
    assert.equal(run.decoder.text, 'A');
    assert.equal(run.last.text, 'A');
    assert.equal(run.last.letter, 'A');
    assert.equal(run.last.confidence, 0.95);
  });

  test('no hand: no letter, zero confidence, space after a pause', () => {
    const run = scripted(asl.ALPHABET).hold('H', 700).hold('I', 700).away(1300);
    assert.equal(run.last.letter, null);
    assert.equal(run.last.confidence, 0);
    assert.equal(run.decoder.text, 'HI ');
    run.hold('Y', 700).hold('O', 700);
    assert.equal(run.decoder.text, 'HI YO');
  });

  test('I followed by a downward stroke becomes J', () => {
    const run = scripted(asl.ALPHABET).hold('I', 700);
    assert.equal(run.decoder.text, 'I');
    run.glide('I', 200, [3, 3], [3, 4]).hold('I', 300, 3, 4);
    assert.equal(run.decoder.text, 'J');
  });

  test('I moving upwards or only slightly stays I', () => {
    const up = scripted(asl.ALPHABET).hold('I', 700).glide('I', 200, [3, 3], [3, 2]).hold('I', 300, 3, 2);
    assert.equal(up.decoder.text, 'I');
    const small = scripted(asl.ALPHABET).hold('I', 700);
    const dy = MOTION.variantMin - 0.15;
    small.glide('I', 150, [3, 3], [3, 3 + dy]).hold('I', 300, 3, 3 + dy);
    assert.equal(small.decoder.text, 'I');
  });

  test('a hand that travels far is leaving, not drawing a J', () => {
    const far = MOTION.variantMax + 1;
    const run = scripted(asl.ALPHABET).hold('I', 700).glide('I', 250, [3, 3], [3, 3 + far]).hold('I', 300, 3, 3 + far);
    assert.equal(run.decoder.text, 'I');
  });

  test('the variant is only decided once the hand has stopped', () => {
    const run = scripted(asl.ALPHABET).hold('I', 700).glide('I', 400, [3, 3], [3, 5]);
    assert.equal(run.decoder.text, 'I', 'still moving: no decision yet');
  });

  test('ISL base letters dropping down become final letters', () => {
    for (const [base, final] of Object.entries({ 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' })) {
      const run = scripted(isl.ALPHABET).hold('ש', 700).hold(base, 700);
      run.glide(base, 200, [3, 3], [3, 4]).hold(base, 300, 3, 4);
      assert.equal(run.decoder.text, `ש${final}`);
    }
  });

  test('a letter without a moving variant is unaffected by a downward move', () => {
    const run = scripted(asl.ALPHABET).hold('A', 700).glide('A', 200, [3, 3], [3, 4]).hold('A', 300, 3, 4);
    assert.equal(run.decoder.text, 'A');
  });

  test('sliding a held letter sideways doubles it', () => {
    for (const direction of [1, -1]) {
      const to = 3 + direction * (MOTION.slideMin + 0.2);
      const run = scripted(asl.ALPHABET).hold('L', 700).glide('L', 150, [3, 3], [to, 3]).hold('L', 300, to, 3);
      assert.equal(run.decoder.text, 'LL');
      // A second slide types a third letter.
      const further = to + direction * (MOTION.slideMin + 0.2);
      run.glide('L', 150, [to, 3], [further, 3]).hold('L', 300, further, 3);
      assert.equal(run.decoder.text, 'LLL');
    }
  });

  test('a slide that is too short or drifts vertically does not double', () => {
    const short = scripted(asl.ALPHABET).hold('L', 700);
    short.glide('L', 100, [3, 3], [3.25, 3]).hold('L', 400, 3.25, 3);
    assert.equal(short.decoder.text, 'L');
    const drift = scripted(asl.ALPHABET).hold('L', 700);
    drift.glide('L', 150, [3, 3], [3.5, 3 + MOTION.slideMaxDrift + 0.1]).hold('L', 400, 3.5, 3 + MOTION.slideMaxDrift + 0.1);
    assert.equal(drift.decoder.text, 'L');
  });

  test('holding still repeats on the timer; holding away from the typed spot does not', () => {
    const still = scripted(asl.ALPHABET).hold('L', 3200);
    assert.equal(still.decoder.text, 'LL');
    const moved = scripted(asl.ALPHABET).hold('L', 700);
    const off = MOTION.repeatRadius + 0.05;
    moved.hold('L', 2500, 3, 3 + off);
    assert.equal(moved.decoder.text, 'L');
  });

  test('a self-moving letter (Z) is never repeated by the timer', () => {
    const run = scripted(asl.ALPHABET).hold('Z', 4000);
    assert.equal(run.decoder.text, 'Z');
    const zayin = scripted(isl.ALPHABET).hold('ז', 4000);
    assert.equal(zayin.decoder.text, 'ז');
  });

  test('losing the hand forgets the held letter', () => {
    const run = scripted(asl.ALPHABET).hold('I', 700).away(300);
    // Re-appearing lower down is a new letter, not the J movement.
    run.hold('I', 700, 3, 4);
    assert.equal(run.decoder.text, 'II');
  });

  test('distance from the camera does not change the result', () => {
    // Same gesture with the image twice as wide (aspect 2): positions are in hand lengths.
    const script = { label: 'I' };
    const decoder = new LetterDecoder({ predictFeatures: () => ({ label: script.label, confidence: 0.9 }) }, asl.ALPHABET);
    let t = 0;
    const squash = (hand) => ({ ...hand, landmarks: hand.landmarks.map((p) => ({ ...p, x: p.x / 2 })) });
    for (; t < 700; t += STEP) decoder.update(t, squash(handAt(3, 3)), 2);
    for (let i = 1; i <= 6; i++, t += STEP) decoder.update(t, squash(handAt(3, 3 + i / 6)), 2);
    for (const end = t + 300; t < end; t += STEP) decoder.update(t, squash(handAt(3, 4)), 2);
    assert.equal(decoder.text, 'J');
  });

  test('reset clears text and movement state', () => {
    const run = scripted(asl.ALPHABET).hold('I', 700);
    run.decoder.reset();
    assert.equal(run.decoder.text, '');
    run.glide('I', 200, [3, 3], [3, 4]);
    assert.equal(run.decoder.text, '');
  });
});
