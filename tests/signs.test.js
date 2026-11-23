import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HANDSHAPES } from '../src/core/handshapes.js';
import { len } from '../src/core/vec.js';
import asl from '../src/signs/asl.js';
import isl from '../src/signs/isl.js';
import { LOC, REST, BODY, h, shift, sign, move, repeat, circle, U, OUT } from '../src/signs/space.js';

const LANGS = { asl, isl };
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

function assertHandState(state, where) {
  assert.ok(HANDSHAPES[state.shape], `${where}: unknown handshape "${state.shape}"`);
  assert.ok(isVec3(state.at), `${where}: bad position ${JSON.stringify(state.at)}`);
  assert.ok(isVec3(state.finger) && len(state.finger) > 0.5, `${where}: bad finger direction`);
  assert.ok(isVec3(state.palm) && len(state.palm) > 0.5, `${where}: bad palm direction`);
}

for (const [code, data] of Object.entries(LANGS)) {
  describe(`${code} sign data`, () => {
    test('module shape', () => {
      assert.equal(data.code, code);
      assert.equal(typeof data.normalizeLetter, 'function');
    });

    test('every alphabet entry references an existing handshape and sane orientation', () => {
      for (const [letter, def] of Object.entries(data.ALPHABET)) {
        assert.equal([...letter].length, 1, `alphabet key "${letter}" is not one character`);
        assert.ok(HANDSHAPES[def.shape], `${letter}: unknown handshape "${def.shape}"`);
        if (def.finger) assert.ok(isVec3(def.finger) && len(def.finger) > 0.5, `${letter}: finger`);
        if (def.palm) assert.ok(isVec3(def.palm) && len(def.palm) > 0.5, `${letter}: palm`);
      }
    });

    test('letter paths run from t=0 to t=1 without going backwards', () => {
      for (const [letter, def] of Object.entries(data.ALPHABET)) {
        if (!def.path) continue;
        assert.ok(def.path.length >= 2, `${letter}: a path needs two points`);
        assert.equal(def.path[0][0], 0, `${letter}: path must start at t=0`);
        assert.equal(def.path.at(-1)[0], 1, `${letter}: path must end at t=1`);
        let previous = -Infinity;
        for (const [t, offset, changes] of def.path) {
          assert.ok(t >= previous, `${letter}: path time goes backwards`);
          previous = t;
          assert.ok(isVec3(offset), `${letter}: path offset`);
          assert.equal(typeof changes, 'object');
          if (changes.shape) assert.ok(HANDSHAPES[changes.shape], `${letter}: path shape`);
        }
        // A path that does not move is not a moving letter.
        const first = def.path[0][1];
        const last = def.path.at(-1)[1];
        assert.ok(len([last[0] - first[0], last[1] - first[1], last[2] - first[2]]) > 0.1, `${letter}: path does not move`);
      }
    });

    test('every lexicon sign is well formed', () => {
      const entries = Object.entries(data.LEXICON);
      assert.ok(entries.length >= 10);
      for (const [gloss, entry] of entries) {
        assert.equal(entry.gloss, gloss);
        assert.ok(entry.dur >= 300 && entry.dur <= 3000, `${gloss}: duration ${entry.dur}`);
        assert.ok(entry.frames.length >= 2, `${gloss}: needs at least two frames`);
        assert.equal(entry.frames[0].t, 0, `${gloss}: first frame must be at t=0`);
        assert.equal(entry.frames.at(-1).t, 1, `${gloss}: last frame must be at t=1`);
        let previous = -Infinity;
        entry.frames.forEach((frame, i) => {
          assert.ok(frame.t >= 0 && frame.t <= 1, `${gloss}[${i}]: t out of range`);
          assert.ok(frame.t >= previous, `${gloss}[${i}]: t goes backwards`);
          previous = frame.t;
          assertHandState(frame.dom, `${gloss}[${i}].dom`);
          if (frame.non) assertHandState(frame.non, `${gloss}[${i}].non`);
        });
        // A two-handed sign stays two-handed for its whole duration.
        const twoHanded = entry.frames.map((f) => Boolean(f.non));
        assert.ok(twoHanded.every((v) => v === twoHanded[0]), `${gloss}: non-dominant hand appears/disappears`);
      }
    });

    test('hands stay within reach of the body', () => {
      const reach = BODY.upperArm + BODY.foreArm + BODY.handSize;
      for (const [gloss, entry] of Object.entries(data.LEXICON)) {
        for (const frame of entry.frames) {
          const d = len([frame.dom.at[0] - BODY.shoulderR[0], frame.dom.at[1] - BODY.shoulderR[1], frame.dom.at[2]]);
          assert.ok(d <= reach, `${gloss}: dominant hand ${d.toFixed(2)} from the shoulder`);
        }
      }
    });
  });
}

describe('ASL alphabet', () => {
  test('has exactly the 26 letters A-Z', () => {
    const expected = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
    assert.deepEqual(Object.keys(asl.ALPHABET).sort(), expected);
  });

  test('J and Z are the only moving letters; J is a moving I', () => {
    const moving = Object.keys(asl.ALPHABET).filter((l) => asl.ALPHABET[l].path);
    assert.deepEqual(moving.sort(), ['J', 'Z']);
    assert.equal(asl.ALPHABET.J.shape, asl.ALPHABET.I.shape);
  });

  test('normalizeLetter upper-cases and rejects everything else', () => {
    assert.equal(asl.normalizeLetter('a'), 'A');
    assert.equal(asl.normalizeLetter('Z'), 'Z');
    for (const ch of ['1', ' ', '-', "'", 'é', 'א', 'ß', '']) assert.equal(asl.normalizeLetter(ch), null, ch);
  });

  test('lexicon glosses are upper-case', () => {
    for (const gloss of Object.keys(asl.LEXICON)) assert.equal(gloss, gloss.toUpperCase());
    for (const gloss of ['HELLO', 'THANK-YOU', 'YES', 'NO', 'WHERE', 'BATHROOM']) assert.ok(asl.LEXICON[gloss], gloss);
  });
});

describe('ISL alphabet', () => {
  const BASE = [...'אבגדהוזחטיכלמנסעפצקרשת'];
  const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

  test('has the 22 base letters plus the 5 final letters', () => {
    assert.equal(BASE.length, 22);
    assert.deepEqual(Object.keys(isl.ALPHABET).sort(), [...BASE, ...Object.keys(FINALS)].sort());
  });

  test('each final letter is its base letter plus a downward movement', () => {
    for (const [final, base] of Object.entries(FINALS)) {
      const f = isl.ALPHABET[final];
      const b = isl.ALPHABET[base];
      assert.equal(f.shape, b.shape, `${final} vs ${base}`);
      assert.deepEqual(f.finger, b.finger);
      assert.deepEqual(f.palm, b.palm);
      assert.equal(b.path, undefined, `${base} must be static`);
      assert.ok(f.path, `${final} must move`);
      assert.ok(f.path.at(-1)[1][1] < f.path[0][1][1], `${final} must move down`);
    }
  });

  test('static letters are told apart by handshape or orientation', () => {
    const seen = new Map();
    for (const [letter, def] of Object.entries(isl.ALPHABET)) {
      if (def.path) continue;
      const key = JSON.stringify([def.shape, def.finger || null, def.palm || null]);
      assert.ok(!seen.has(key), `${letter} looks identical to ${seen.get(key)}`);
      seen.set(key, letter);
    }
  });

  test('every letter declares whether its handshape is certain', () => {
    for (const [letter, def] of Object.entries(isl.ALPHABET)) {
      assert.equal(typeof def.sure, 'boolean', letter);
    }
  });

  test('normalizeLetter strips niqqud and rejects non-Hebrew', () => {
    assert.equal(isl.normalizeLetter('ש'), 'ש');
    assert.equal(isl.normalizeLetter('ש\u05C1'), 'ש'); // shin + shin dot
    assert.equal(isl.normalizeLetter('ב\u05BC'), 'ב'); // bet + dagesh
    assert.equal(isl.normalizeLetter('ל\u05B9'), 'ל'); // lamed + holam
    assert.equal(isl.normalizeLetter('ם'), 'ם');
    for (const ch of ['a', 'A', '1', ' ', '"', '׳', '\u05BC', '']) assert.equal(isl.normalizeLetter(ch), null, ch);
  });

  test('lexicon glosses are Hebrew words', () => {
    for (const gloss of Object.keys(isl.LEXICON)) assert.match(gloss, /^[א-ת]+$/);
    for (const gloss of ['שלום', 'תודה', 'לא', 'אני']) assert.ok(isl.LEXICON[gloss], gloss);
  });
});

describe('signing space builders', () => {
  test('h resolves named locations and applies default orientation', () => {
    const state = h('B', 'chin');
    assert.equal(state.at, LOC.chin);
    assert.deepEqual(state.finger, U);
    assert.deepEqual(state.palm, OUT);
    assert.deepEqual(h('B', [1, 2, 3]).at, [1, 2, 3]);
  });

  test('every named location is a finite point', () => {
    for (const [name, p] of Object.entries(LOC)) assert.ok(isVec3(p), name);
  });

  test('shift offsets without mutating the original', () => {
    const base = h('A', [1, 1, 1]);
    const moved = shift(base, [0.5, -1, 0], { shape: 'B' });
    assert.deepEqual(moved.at, [1.5, 0, 1]);
    assert.equal(moved.shape, 'B');
    assert.deepEqual(base.at, [1, 1, 1]);
    assert.equal(base.shape, 'A');
  });

  test('rest pose hangs both hands below the hips side, mirrored', () => {
    assert.ok(HANDSHAPES[REST.dom.shape] && HANDSHAPES[REST.non.shape]);
    assert.equal(REST.dom.at[0], -REST.non.at[0]);
    assert.equal(REST.dom.at[1], REST.non.at[1]);
    assert.ok(REST.dom.at[1] < 0);
  });

  test('sign() fills a missing non-dominant hand with null', () => {
    const a = h('A', 'neutral');
    const s = sign('X', 500, [[0, a], [1, a, a]], { note: 'n' });
    assert.equal(s.gloss, 'X');
    assert.equal(s.dur, 500);
    assert.equal(s.note, 'n');
    assert.equal(s.frames[0].non, null);
    assert.equal(s.frames[1].non, a);
  });

  test('move() holds at both ends', () => {
    const a = h('A', 'neutral');
    const b = h('B', 'chin');
    const frames = move([a], [b]);
    assert.deepEqual(frames.map((f) => f[0]), [0, 0.15, 0.85, 1]);
    assert.deepEqual(frames.map((f) => f[1]), [a, a, b, b]);
  });

  test('repeat() alternates and ends where it started', () => {
    const a = h('A', 'neutral');
    const b = h('B', 'chin');
    for (const times of [1, 2, 3]) {
      const frames = repeat([a], [b], times);
      assert.equal(frames.length, times * 2 + 1);
      assert.equal(frames[0][0], 0);
      assert.equal(frames.at(-1)[0], 1);
      frames.forEach((f, i) => assert.equal(f[1], i % 2 === 0 ? a : b));
    }
  });

  test('circle() traces a closed loop at the given radius', () => {
    const base = h('A', [0, 0, 0]);
    for (const plane of ['xy', 'yz', 'xz']) {
      const frames = circle(base, 0.1, 2, plane);
      assert.equal(frames.length, 17);
      assert.equal(frames[0][0], 0);
      assert.equal(frames.at(-1)[0], 1);
      for (const [, state] of frames) assert.ok(Math.abs(len(state.at) - 0.1) < 1e-9);
      frames[0][1].at.forEach((v, i) => assert.ok(Math.abs(v - frames.at(-1)[1].at[i]) < 1e-9));
    }
  });
});
