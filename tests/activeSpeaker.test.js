import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ActiveSpeakerSelector, SPEAKER_DEFAULTS, mouthOpenness, faceBox } from '../src/vision/activeSpeaker.js';

const STEP = 33;
const LOUD = 0.07;
const QUIET = 0.002;
const LEFT = { cx: 0.25, cy: 0.5 };
const RIGHT = { cx: 0.75, cy: 0.5 };

const face = (pos, mouthOpen) => ({
  box: { cx: pos.cx, cy: pos.cy, x: pos.cx - 0.08, y: pos.cy - 0.1, w: 0.16, h: 0.2 },
  mouthOpen,
});
const talking = (t, phase = 0) => 0.25 + 0.2 * Math.sin(t / 55 + phase);
const IDLE = 0.03;

/**
 * Drive a selector with a scene. `frame(t)` returns { level, faces } for each step.
 * Returns the last state.
 */
function play(selector, clock, ms, frame) {
  let state = null;
  for (const end = clock.t + ms; clock.t < end; clock.t += STEP) {
    const { level, faces } = frame(clock.t);
    state = selector.update(clock.t, level, faces);
  }
  return state;
}
const trackAt = (state, pos) => state.tracks.find((t) => Math.abs(t.box.cx - pos.cx) < 0.05);

describe('mouthOpenness', () => {
  const landmarks = (lipGap, faceHeight) => {
    const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    points[10] = { x: 0.5, y: 0.2 };
    points[152] = { x: 0.5, y: 0.2 + faceHeight };
    points[13] = { x: 0.5, y: 0.5 };
    points[14] = { x: 0.5, y: 0.5 + lipGap };
    return points;
  };

  test('uses the jawOpen blendshape when available', () => {
    const blend = [{ categoryName: 'mouthSmileLeft', score: 0.9 }, { categoryName: 'jawOpen', score: 0.42 }];
    assert.equal(mouthOpenness(landmarks(0.2, 0.4), blend), 0.42);
    assert.equal(mouthOpenness(null, [{ categoryName: 'jawOpen', score: 0 }]), 0);
  });

  test('falls back to lip distance relative to face height', () => {
    assert.ok(Math.abs(mouthOpenness(landmarks(0.02, 0.4)) - 0.2) < 1e-9);
    assert.ok(Math.abs(mouthOpenness(landmarks(0.02, 0.4), null) - 0.2) < 1e-9);
    assert.ok(Math.abs(mouthOpenness(landmarks(0.02, 0.4), []) - 0.2) < 1e-9);
    assert.ok(Math.abs(mouthOpenness(landmarks(0.02, 0.4), [{ categoryName: 'other', score: 1 }]) - 0.2) < 1e-9);
    assert.equal(mouthOpenness(landmarks(0, 0.4)), 0);
  });

  test('is independent of face size, capped at 1 and safe for a degenerate face', () => {
    assert.ok(Math.abs(mouthOpenness(landmarks(0.01, 0.2)) - mouthOpenness(landmarks(0.02, 0.4))) < 1e-9);
    assert.equal(mouthOpenness(landmarks(0.3, 0.4)), 1);
    assert.equal(mouthOpenness(landmarks(0.1, 0)), 0);
  });
});

describe('faceBox', () => {
  test('bounds the landmarks', () => {
    const box = faceBox([{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.5 }, { x: 0.4, y: 0.9 }]);
    assert.deepEqual(
      Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v * 1e6) / 1e6])),
      { x: 0.2, y: 0.3, w: 0.4, h: 0.6, cx: 0.4, cy: 0.6 },
    );
  });

  test('a single point gives a zero-size box at that point', () => {
    assert.deepEqual(faceBox([{ x: 0.3, y: 0.7 }]), { x: 0.3, y: 0.7, w: 0, h: 0, cx: 0.3, cy: 0.7 });
  });
});

describe('ActiveSpeakerSelector tracking', () => {
  test('a face keeps its identity while it moves gradually', () => {
    const selector = new ActiveSpeakerSelector();
    const ids = new Set();
    for (let i = 0; i < 40; i++) {
      const state = selector.update(i * STEP, QUIET, [face({ cx: 0.2 + i * 0.012, cy: 0.5 }, IDLE)]);
      assert.equal(state.tracks.length, 1);
      ids.add(state.tracks[0].id);
    }
    assert.equal(ids.size, 1);
  });

  test('two faces keep separate identities regardless of detection order', () => {
    const selector = new ActiveSpeakerSelector();
    const first = selector.update(0, QUIET, [face(LEFT, IDLE), face(RIGHT, IDLE)]);
    const leftId = trackAt(first, LEFT).id;
    const rightId = trackAt(first, RIGHT).id;
    assert.notEqual(leftId, rightId);
    for (let i = 1; i < 30; i++) {
      const faces = i % 2 ? [face(RIGHT, IDLE), face(LEFT, IDLE)] : [face(LEFT, IDLE), face(RIGHT, IDLE)];
      const state = selector.update(i * STEP, QUIET, faces);
      assert.equal(state.tracks.length, 2);
      assert.equal(trackAt(state, LEFT).id, leftId);
      assert.equal(trackAt(state, RIGHT).id, rightId);
    }
  });

  test('a face far from any known face starts a new track', () => {
    const selector = new ActiveSpeakerSelector();
    const a = selector.update(0, QUIET, [face(LEFT, IDLE)]).tracks[0].id;
    const state = selector.update(STEP, QUIET, [face({ cx: LEFT.cx + SPEAKER_DEFAULTS.matchDistance + 0.1, cy: 0.5 }, IDLE)]);
    assert.equal(state.tracks.length, 2);
    assert.ok(state.tracks.some((t) => t.id !== a));
  });

  test('two close detections never share one track', () => {
    const selector = new ActiveSpeakerSelector();
    selector.update(0, QUIET, [face(LEFT, IDLE)]);
    const state = selector.update(STEP, QUIET, [face(LEFT, IDLE), face({ cx: LEFT.cx + 0.05, cy: 0.5 }, IDLE)]);
    assert.equal(state.tracks.length, 2);
    assert.equal(new Set(state.tracks.map((t) => t.id)).size, 2);
  });

  test('a face that briefly disappears keeps its identity; a long absence forgets it', () => {
    const selector = new ActiveSpeakerSelector();
    const clock = { t: 0 };
    const id = play(selector, clock, 300, () => ({ level: QUIET, faces: [face(LEFT, IDLE)] })).tracks[0].id;
    let state = play(selector, clock, 500, () => ({ level: QUIET, faces: [] }));
    assert.equal(state.tracks.length, 1, 'still remembered');
    state = play(selector, clock, 100, () => ({ level: QUIET, faces: [face(LEFT, IDLE)] }));
    assert.equal(state.tracks[0].id, id);
    state = play(selector, clock, SPEAKER_DEFAULTS.forgetMs + 200, () => ({ level: QUIET, faces: [] }));
    assert.equal(state.tracks.length, 0);
    state = play(selector, clock, 100, () => ({ level: QUIET, faces: [face(LEFT, IDLE)] }));
    assert.notEqual(state.tracks[0].id, id);
  });
});

describe('ActiveSpeakerSelector selection', () => {
  test('nobody is selected at first or with no faces', () => {
    const selector = new ActiveSpeakerSelector();
    assert.equal(selector.update(0, LOUD, []).selectedId, null);
    assert.equal(selector.update(STEP, LOUD, [face(LEFT, 0.5)]).selectedId, null);
  });

  test('the face whose mouth moves while the audio is loud is selected', () => {
    const selector = new ActiveSpeakerSelector();
    const state = play(selector, { t: 0 }, 1500, (t) => ({
      level: LOUD,
      faces: [face(LEFT, IDLE), face(RIGHT, talking(t))],
    }));
    assert.equal(state.selectedId, trackAt(state, RIGHT).id);
    assert.equal(trackAt(state, LEFT).evidence, 0);
  });

  test('a moving mouth in silence collects no evidence', () => {
    const selector = new ActiveSpeakerSelector();
    const state = play(selector, { t: 0 }, 3000, (t) => ({
      level: QUIET,
      faces: [face(LEFT, talking(t)), face(RIGHT, IDLE)],
    }));
    assert.equal(state.selectedId, null);
    assert.ok(state.tracks.every((t) => t.evidence === 0));
    // Exactly at the silence floor counts as silence too.
    const atFloor = play(new ActiveSpeakerSelector(), { t: 0 }, 2000, (t) => ({
      level: SPEAKER_DEFAULTS.levelFloor,
      faces: [face(LEFT, talking(t))],
    }));
    assert.equal(atFloor.selectedId, null);
  });

  test('loud audio with still mouths collects no evidence (off-camera speaker)', () => {
    const selector = new ActiveSpeakerSelector();
    const state = play(selector, { t: 0 }, 3000, () => ({
      level: 0.5,
      faces: [face(LEFT, 0.3), face(RIGHT, IDLE)],
    }));
    assert.equal(state.selectedId, null);
    assert.ok(state.tracks.every((t) => t.evidence === 0));
  });

  test('louder audio gives more evidence, saturating at levelFull', () => {
    const evidenceAt = (level) =>
      play(new ActiveSpeakerSelector(), { t: 0 }, 1000, (t) => ({ level, faces: [face(LEFT, talking(t))] })).tracks[0].evidence;
    assert.ok(evidenceAt(0.03) > 0);
    assert.ok(evidenceAt(0.06) > evidenceAt(0.03));
    assert.equal(evidenceAt(0.5), evidenceAt(SPEAKER_DEFAULTS.levelFull));
  });

  test('selection follows the speaker when the conversation changes sides', () => {
    const selector = new ActiveSpeakerSelector();
    const clock = { t: 0 };
    let state = play(selector, clock, 2000, (t) => ({ level: LOUD, faces: [face(LEFT, talking(t)), face(RIGHT, IDLE)] }));
    const leftId = trackAt(state, LEFT).id;
    const rightId = trackAt(state, RIGHT).id;
    assert.equal(state.selectedId, leftId);
    state = play(selector, clock, 6000, (t) => ({ level: LOUD, faces: [face(LEFT, IDLE), face(RIGHT, talking(t))] }));
    assert.equal(state.selectedId, rightId);
  });

  test('hysteresis: an equally active second face does not steal the selection', () => {
    const selector = new ActiveSpeakerSelector();
    const clock = { t: 0 };
    let state = play(selector, clock, 1500, (t) => ({ level: LOUD, faces: [face(LEFT, talking(t)), face(RIGHT, IDLE)] }));
    const leftId = state.selectedId;
    assert.equal(leftId, trackAt(state, LEFT).id);
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      state = play(selector, clock, STEP, (t) => ({ level: LOUD, faces: [face(LEFT, talking(t)), face(RIGHT, talking(t))] }));
      seen.add(state.selectedId);
    }
    assert.deepEqual([...seen], [leftId]);
    // Both now carry nearly the same evidence, yet the selection never flipped.
    const ratio = trackAt(state, RIGHT).evidence / trackAt(state, LEFT).evidence;
    assert.ok(ratio > 0.9 && ratio <= 1.0001, `evidence ratio ${ratio}`);
  });

  test('the speaker stays selected through a pause, then is released', () => {
    const selector = new ActiveSpeakerSelector();
    const clock = { t: 0 };
    let state = play(selector, clock, 2000, (t) => ({ level: LOUD, faces: [face(LEFT, talking(t)), face(RIGHT, IDLE)] }));
    const id = state.selectedId;
    assert.notEqual(id, null);
    const silence = () => ({ level: QUIET, faces: [face(LEFT, IDLE), face(RIGHT, IDLE)] });
    state = play(selector, clock, SPEAKER_DEFAULTS.holdMs, silence);
    assert.equal(state.selectedId, id, 'held during a pause');
    state = play(selector, clock, 60000, silence);
    assert.equal(state.selectedId, null, 'released after a long silence');
    assert.ok(trackAt(state, LEFT).evidence < SPEAKER_DEFAULTS.minEvidence);
  });

  test('evidence decays with the configured half-life', () => {
    const selector = new ActiveSpeakerSelector();
    const clock = { t: 0 };
    let state = play(selector, clock, 2000, (t) => ({ level: LOUD, faces: [face(LEFT, talking(t))] }));
    // Let the smoothed mouth activity die out first, then measure pure decay.
    state = play(selector, clock, 1000, () => ({ level: 0, faces: [face(LEFT, IDLE)] }));
    const before = state.tracks[0].evidence;
    const from = clock.t;
    state = play(selector, clock, SPEAKER_DEFAULTS.decayMs, () => ({ level: 0, faces: [face(LEFT, IDLE)] }));
    const elapsed = clock.t - from;
    const expected = before * Math.pow(0.5, elapsed / SPEAKER_DEFAULTS.decayMs);
    assert.ok(Math.abs(state.tracks[0].evidence - expected) / expected < 0.02);
  });

  test('when the selected face leaves the frame the selection is dropped', () => {
    const selector = new ActiveSpeakerSelector();
    const clock = { t: 0 };
    let state = play(selector, clock, 2000, (t) => ({ level: LOUD, faces: [face(LEFT, talking(t)), face(RIGHT, IDLE)] }));
    const leftId = state.selectedId;
    // Briefly hidden (e.g. a missed detection): still selected.
    state = play(selector, clock, 400, () => ({ level: QUIET, faces: [face(RIGHT, IDLE)] }));
    assert.equal(state.selectedId, leftId);
    // Gone for good.
    state = play(selector, clock, SPEAKER_DEFAULTS.forgetMs + 300, () => ({ level: QUIET, faces: [face(RIGHT, IDLE)] }));
    assert.equal(state.selectedId, null);
    assert.equal(state.tracks.length, 1);
    assert.equal(selector.selectedId, null);
  });

  test('everyone leaving empties the tracks without errors', () => {
    const selector = new ActiveSpeakerSelector();
    const clock = { t: 0 };
    play(selector, clock, 1500, (t) => ({ level: LOUD, faces: [face(LEFT, talking(t)), face(RIGHT, talking(t, 2))] }));
    const state = play(selector, clock, 3000, () => ({ level: LOUD, faces: [] }));
    assert.deepEqual(state, { selectedId: null, tracks: [] });
  });

  test('a long gap between frames does not create a burst of evidence', () => {
    const selector = new ActiveSpeakerSelector();
    selector.update(0, LOUD, [face(LEFT, 0.1)]);
    const state = selector.update(60000, LOUD, [face(LEFT, 0.11)]);
    assert.ok(state.tracks.length >= 1);
    assert.ok(state.tracks.every((t) => Number.isFinite(t.evidence) && t.evidence < SPEAKER_DEFAULTS.minEvidence));
    assert.equal(state.selectedId, null);
  });

  test('repeated or out-of-order timestamps are harmless', () => {
    const selector = new ActiveSpeakerSelector();
    selector.update(100, LOUD, [face(LEFT, 0.1)]);
    selector.update(100, LOUD, [face(LEFT, 0.5)]);
    const state = selector.update(50, LOUD, [face(LEFT, 0.1)]);
    assert.ok(state.tracks.every((t) => Number.isFinite(t.evidence) && Number.isFinite(t.activity)));
  });

  test('options override the defaults', () => {
    const strict = new ActiveSpeakerSelector({ minEvidence: 1e9 });
    const state = play(strict, { t: 0 }, 2000, (t) => ({ level: LOUD, faces: [face(LEFT, talking(t))] }));
    assert.equal(state.selectedId, null);
    assert.equal(new ActiveSpeakerSelector().o.switchRatio, SPEAKER_DEFAULTS.switchRatio);
  });
});
