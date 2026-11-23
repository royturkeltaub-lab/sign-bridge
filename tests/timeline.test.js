import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import asl from '../src/signs/asl.js';
import isl from '../src/signs/isl.js';
import { LOC, REST } from '../src/signs/space.js';
import { textToPlan } from '../src/translate/gloss.js';
import { TIMING, letterFrames, buildTimeline, sampleTimeline } from '../src/render/timeline.js';

const spellPlan = (word, data = asl) => [
  { type: 'spell', word, letters: [...word].map((ch) => ({ ch, def: data.ALPHABET[ch] })) },
];
const dedupe = (list) => list.filter((v, i) => i === 0 || v !== list[i - 1]);

function sampleAll(timeline, step = 20) {
  const samples = [];
  for (let t = 0; t <= timeline.duration; t += step) samples.push(sampleTimeline(timeline, t));
  return samples;
}

describe('letterFrames', () => {
  test('a static letter moves in, then holds at the spelling position', () => {
    const frames = letterFrames(asl.ALPHABET.A);
    assert.equal(frames.length, 2);
    assert.deepEqual(frames.map((f) => f[0]), [TIMING.letterMove, TIMING.letter]);
    assert.deepEqual(frames[0][1].at, LOC.spell);
    assert.deepEqual(frames[1][1], frames[0][1]);
    assert.equal(frames[0][1].shape, 'A');
  });

  test('letter orientation is taken from the definition', () => {
    const [, state] = letterFrames(asl.ALPHABET.G)[0];
    assert.deepEqual(state.finger, asl.ALPHABET.G.finger);
    assert.deepEqual(state.palm, asl.ALPHABET.G.palm);
  });

  test('a moving letter gets a path: more frames, more time, changing position', () => {
    for (const def of [asl.ALPHABET.J, asl.ALPHABET.Z, isl.ALPHABET['ך'], isl.ALPHABET['ז']]) {
      const frames = letterFrames(def);
      assert.equal(frames.length, def.path.length + 2);
      const times = frames.map((f) => f[0]);
      times.forEach((t, i) => assert.ok(i === 0 || t >= times[i - 1], 'frame times go backwards'));
      assert.ok(times.at(-1) > TIMING.letter, 'a moving letter takes longer than a static one');
      const positions = new Set(frames.map((f) => f[1].at.join(',')));
      assert.ok(positions.size >= 2, 'the hand never moves');
      for (const [, state] of frames) assert.equal(state.shape, def.shape);
    }
  });

  test('the path is traced relative to the spelling position', () => {
    const def = asl.ALPHABET.Z;
    const frames = letterFrames(def);
    def.path.forEach(([, offset], i) => {
      const at = frames[i + 1][1].at;
      offset.forEach((o, axis) => assert.ok(Math.abs(at[axis] - (LOC.spell[axis] + o)) < 1e-12));
    });
  });

  test('slide shifts the letter sideways', () => {
    const [, state] = letterFrames(asl.ALPHABET.L, 0.11)[0];
    assert.ok(Math.abs(state.at[0] - (LOC.spell[0] + 0.11)) < 1e-12);
    assert.equal(state.at[1], LOC.spell[1]);
  });
});

describe('buildTimeline', () => {
  test('an empty plan is just rest -> rest', () => {
    const timeline = buildTimeline([]);
    assert.equal(timeline.keys.length, 2);
    assert.equal(timeline.keys[0].time, 0);
    assert.equal(timeline.keys[1].time, TIMING.transition);
    assert.equal(timeline.duration, TIMING.transition + TIMING.endHold);
    const pose = sampleTimeline(timeline, 100);
    assert.equal(pose.item, -1);
    assert.deepEqual(pose.dom.at, REST.dom.at);
  });

  test('starts and ends at rest', () => {
    const timeline = buildTimeline(textToPlan('Hello Paris', 'asl'));
    for (const key of [timeline.keys[0], timeline.keys.at(-1)]) {
      assert.equal(key.dom, REST.dom);
      assert.equal(key.non, REST.non);
      assert.equal(key.item, -1);
      assert.equal(key.letter, -1);
    }
    assert.equal(timeline.keys[0].time, 0);
    assert.equal(timeline.duration, timeline.keys.at(-1).time + TIMING.endHold);
  });

  for (const [text, code] of [
    ['Hello Paris, what is your name? Jazz pizza', 'asl'],
    ['שלום אני דנה, תודה רבה לך', 'isl'],
  ]) {
    test(`key times never go backwards and items progress in order (${code})`, () => {
      const plan = textToPlan(text, code);
      const { keys } = buildTimeline(plan);
      for (let i = 1; i < keys.length; i++) {
        assert.ok(keys[i].time >= keys[i - 1].time, `key ${i} goes back in time`);
        assert.ok(Number.isFinite(keys[i].time));
      }
      const inner = keys.slice(1, -1);
      assert.deepEqual(dedupe(inner.map((k) => k.item)), plan.map((_, i) => i));
      plan.forEach((item, index) => {
        const mine = inner.filter((k) => k.item === index);
        if (item.type === 'sign') {
          assert.equal(mine.length, item.sign.frames.length);
          assert.ok(mine.every((k) => k.letter === -1));
          assert.equal(item.end - item.start, item.sign.dur);
        } else {
          assert.deepEqual(dedupe(mine.map((k) => k.letter)), item.letters.map((_, i) => i));
          assert.ok(mine.every((k) => k.non === REST.non), 'fingerspelling is one-handed');
        }
        assert.ok(item.end > item.start);
        assert.ok(mine.every((k) => k.time >= item.start && k.time <= item.end));
        if (index > 0) assert.ok(item.start >= plan[index - 1].end + TIMING.transition - 1e-9);
      });
    });
  }

  test('a one-handed sign leaves the other hand at rest', () => {
    const { keys } = buildTimeline(textToPlan('hello', 'asl'));
    assert.ok(keys.every((k) => k.non === REST.non));
    const twoHanded = buildTimeline(textToPlan('love', 'asl'));
    assert.ok(twoHanded.keys.slice(1, -1).every((k) => k.non !== REST.non));
  });

  test('each static letter takes TIMING.letter; moving letters take longer', () => {
    const still = buildTimeline(spellPlan('ABC'));
    const withJ = buildTimeline(spellPlan('AJC'));
    assert.equal(still.plan[0].end - still.plan[0].start, 3 * TIMING.letter + TIMING.wordGap);
    assert.ok(withJ.duration > still.duration);
    const jKeys = withJ.keys.filter((k) => k.letter === 1);
    assert.equal(jKeys.length, asl.ALPHABET.J.path.length + 2);
    assert.ok(new Set(jKeys.map((k) => k.dom.at.join(','))).size >= 3, 'J must trace its path');
  });

  test('double letters slide sideways; different letters do not', () => {
    const { keys } = buildTimeline(spellPlan('LLOL'));
    const xOf = (letter) => keys.filter((k) => k.letter === letter).map((k) => k.dom.at[0]);
    assert.ok(xOf(0).every((x) => x === LOC.spell[0]));
    assert.ok(xOf(1).every((x) => Math.abs(x - (LOC.spell[0] + TIMING.doubleLetterSlide)) < 1e-12));
    assert.ok(xOf(2).every((x) => x === LOC.spell[0]));
    assert.ok(xOf(3).every((x) => x === LOC.spell[0]));
  });

  test('a double letter does not carry over between words', () => {
    const plan = [...spellPlan('AL'), ...spellPlan('LA')];
    const { keys } = buildTimeline(plan);
    const secondWordL = keys.filter((k) => k.item === 1 && k.letter === 0);
    assert.ok(secondWordL.every((k) => k.dom.at[0] === LOC.spell[0]));
  });

  // Questionable: the slide is a fixed offset, so the third of three equal letters is formed
  // in exactly the same place as the second and the repetition is invisible.
  test('a tripled letter is visibly re-formed each time', () => {
    const { keys } = buildTimeline(spellPlan('LLL'));
    const x = (letter) => keys.find((k) => k.letter === letter).dom.at[0];
    assert.notEqual(x(2), x(1));
  });
});

describe('sampleTimeline', () => {
  const timeline = buildTimeline(textToPlan('Hello Paris', 'asl'));

  test('is at rest at the start and at the end', () => {
    for (const ms of [0, timeline.duration, timeline.duration + 5000, -100]) {
      const pose = sampleTimeline(timeline, ms);
      assert.equal(pose.item, -1);
      assert.equal(pose.letter, -1);
      pose.dom.at.forEach((v, i) => assert.ok(Math.abs(v - REST.dom.at[i]) < 1e-9));
      pose.non.at.forEach((v, i) => assert.ok(Math.abs(v - REST.non.at[i]) < 1e-9));
      assert.equal(pose.dom.shape, REST.dom.shape);
    }
  });

  test('active item and letter progress in order', () => {
    const samples = sampleAll(timeline);
    assert.deepEqual(dedupe(samples.map((s) => s.item)), [-1, 0, 1, -1]);
    assert.deepEqual(dedupe(samples.filter((s) => s.item === 1).map((s) => s.letter)), [0, 1, 2, 3, 4]);
    assert.ok(samples.filter((s) => s.item === 0).every((s) => s.letter === -1));
  });

  test('every sample has 21 finite landmarks and unit directions for both hands', () => {
    for (const [text, code] of [['Hello Jazz, I love pizza', 'asl'], ['שלום דנה ץ ך ז', 'isl']]) {
      const tl = buildTimeline(textToPlan(text, code));
      for (const pose of sampleAll(tl, 35)) {
        for (const hand of [pose.dom, pose.non]) {
          assert.equal(hand.local.length, 21);
          assert.ok(hand.local.every((p) => p.every(Number.isFinite)));
          assert.ok(hand.at.every(Number.isFinite));
          assert.ok(Math.abs(Math.hypot(...hand.finger) - 1) < 1e-9);
          assert.ok(Math.abs(Math.hypot(...hand.palm) - 1) < 1e-9);
        }
      }
    }
  });

  test('the hand holds each letter at the spelling position', () => {
    const tl = buildTimeline(spellPlan('AB'));
    const start = tl.plan[0].start;
    const holdA = sampleTimeline(tl, start + (TIMING.letterMove + TIMING.letter) / 2);
    assert.equal(holdA.letter, 0);
    assert.equal(holdA.dom.shape, 'A');
    assert.deepEqual(holdA.dom.at, LOC.spell);
    const holdB = sampleTimeline(tl, start + TIMING.letter + (TIMING.letterMove + TIMING.letter) / 2);
    assert.equal(holdB.letter, 1);
    assert.equal(holdB.dom.shape, 'B');
  });

  test('motion is continuous: no jumps between consecutive samples', () => {
    const samples = sampleAll(timeline, 10);
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1].dom.at;
      const b = samples[i].dom.at;
      assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.25, `jump at sample ${i}`);
    }
  });

  test('sampling does not depend on call order', () => {
    const forward = [100, 700, 1500, 2600].map((t) => sampleTimeline(timeline, t).dom.at);
    const backward = [2600, 1500, 700, 100].map((t) => sampleTimeline(timeline, t).dom.at).reverse();
    assert.deepEqual(forward, backward);
  });
});
