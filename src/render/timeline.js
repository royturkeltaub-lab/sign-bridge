// Turns a sign plan (signs + fingerspelled words) into a timeline of hand keyframes, and
// samples that timeline at any time. Pure data: no DOM, so it also runs in the Node evals.
import { lerp, lerpDir } from '../core/vec.js';
import { localLandmarks, blendLandmarks } from '../core/handModel.js';
import { REST, LOC, h, shift, U, OUT } from '../signs/space.js';

export const TIMING = {
  transition: 260, // ms between items
  letter: 430, // ms per fingerspelled letter
  letterMove: 150, // ms of that spent moving into the letter
  doubleLetterSlide: 0.11, // sideways slide for repeated letters
  wordGap: 220,
  endHold: 500,
};

/** Hand states for one fingerspelled letter, as [offsetMs, state] pairs. */
export function letterFrames(letterDef, slide = 0) {
  const base = h(letterDef.shape, LOC.spell, letterDef.finger || U, letterDef.palm || OUT);
  const moved = slide ? shift(base, [slide, 0, 0]) : base;
  if (!letterDef.path) {
    return [
      [TIMING.letterMove, moved],
      [TIMING.letter, moved],
    ];
  }
  // Moving letters: form the handshape, hold it briefly, then trace the path.
  const span = TIMING.letter * 2 - TIMING.letterMove;
  const start = shift(moved, letterDef.path[0][1], letterDef.path[0][2]);
  const lastStep = letterDef.path[letterDef.path.length - 1];
  return [
    [TIMING.letterMove, start],
    ...letterDef.path.map(([t, offset, changes]) => [
      TIMING.letterMove + (0.3 + 0.5 * t) * span,
      shift(moved, offset, changes),
    ]),
    [TIMING.letterMove + span, shift(moved, lastStep[1], lastStep[2])],
  ];
}

/**
 * Build a timeline from plan items.
 * @param {Array} plan items: { type: 'sign', gloss, sign } | { type: 'spell', word, letters: [{ch, def}] }
 */
export function buildTimeline(plan) {
  const keys = [];
  let time = 0;
  const push = (t, dom, non, item, letter = -1) =>
    keys.push({ time: t, dom, non: non || REST.non, item, letter });

  push(0, REST.dom, REST.non, -1);
  plan.forEach((item, index) => {
    time += TIMING.transition;
    const start = time;
    if (item.type === 'sign') {
      for (const frame of item.sign.frames) {
        push(start + frame.t * item.sign.dur, frame.dom, frame.non, index);
      }
      time = start + item.sign.dur;
    } else if (item.type === 'spell') {
      let previous = null;
      let repeats = 0;
      item.letters.forEach((letter, li) => {
        // Each repeat of a letter slides a little further, so LLL shows three distinct stops.
        repeats = previous === letter.ch ? repeats + 1 : 0;
        const slide = repeats * TIMING.doubleLetterSlide;
        const frames = letterFrames(letter.def, slide);
        for (const [offset, state] of frames) push(time + offset, state, null, index, li);
        time += frames[frames.length - 1][0];
        previous = letter.ch;
      });
      time += TIMING.wordGap;
    }
    item.start = start;
    item.end = time;
  });
  time += TIMING.transition;
  push(time, REST.dom, REST.non, -1);
  return { keys, duration: time + TIMING.endHold, plan };
}

const ease = (t) => t * t * (3 - 2 * t);

function blendHand(a, b, t) {
  return {
    local: a.shape === b.shape ? localLandmarks(a.shape) : blendLandmarks(localLandmarks(a.shape), localLandmarks(b.shape), t),
    at: lerp(a.at, b.at, t),
    finger: lerpDir(a.finger, b.finger, t),
    palm: lerpDir(a.palm, b.palm, t),
    shape: t < 0.5 ? a.shape : b.shape,
  };
}

/** Sample the timeline at `ms`. Returns both hands plus which item/letter is active. */
export function sampleTimeline(timeline, ms) {
  const { keys } = timeline;
  const t = Math.max(0, Math.min(ms, keys[keys.length - 1].time));
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].time <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.time - a.time;
  const f = span <= 0 ? 1 : ease((t - a.time) / span);
  const active = f < 0.5 ? a : b;
  return {
    dom: blendHand(a.dom, b.dom, f),
    non: blendHand(a.non, b.non, f),
    item: active.item,
    letter: active.letter,
  };
}
