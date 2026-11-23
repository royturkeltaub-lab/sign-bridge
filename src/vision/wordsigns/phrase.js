// One stretch of signing (hands up and moving, from rest to rest) -> the signs in it.
// Pure; runs in Node and the browser. The model is passed in as `infer`.
//
// A short stretch that the model confidently reads as one sign is one sign (the isolated-sign
// case). Anything else is searched for signs: the model is run on windows of 16-64 frames on an
// 8-frame grid and the best non-overlapping set of confident windows is kept (dynamic
// programming). A window inside a longer stretch has to be much more certain than a whole
// stretch (0.9 vs 0.7): parts of a sign often look like other signs. A stretch longer than the
// model's 64-frame window is never squeezed into one guess.
import { softmax, topK } from './decode.js';
import { fitLength, resample, sequenceFeatures, SEQUENCE_DIM } from './features.js';

export const DEFAULT_PHRASE = Object.freeze({
  temperature: 1,
  fps: 30,
  minFrames: 8,
  maxFrames: 64,
  /** Whole stretch = one sign: minimum top-1 probability. */
  minConfidence: 0.7,
  /** Search long or unclear stretches for several signs (false = always one guess per stretch). */
  split: true,
  /** A window inside a stretch: minimum top-1 probability (chosen on DEV phrases). */
  splitConfidence: 0.9,
  /** Window grid in frames (at `fps`) and the shortest window. */
  gridFrames: 8,
  minWindowFrames: 16,
  /** DP score of a window = frames * (confidence - scoreOffset). */
  scoreOffset: 0.5,
  /** Custom ("taught") signs: cosine similarity needed for a whole stretch / for a window ... */
  customSimilarity: 0.5,
  customWindowSimilarity: 0.65,
  /** ... the lead over the next-best custom sign, and the similarity that overrides a confident built-in sign. */
  customMargin: 0.1,
  customOverride: 0.75,
});

/** Run the model on frames already at the model frame rate (at most maxFrames are used as is). */
async function look(frames, infer, glosses, custom, o) {
  const input = { data: sequenceFeatures(frames), frames: frames.length, dim: SEQUENCE_DIM };
  const { logits, embedding } = await infer(input);
  for (let i = 0; i < logits.length; i++) if (!Number.isFinite(logits[i])) return null;
  const top = topK(softmax(logits, o.temperature), 3).map(({ index, p }) => ({ gloss: glosses[index], p }));
  const match = custom?.size && embedding ? custom.match(embedding) : null;
  const clear = match && match.similarity - match.runnerUp >= o.customMargin ? match : null;
  return { top, gloss: top[0].gloss, confidence: top[0].p, custom: clear, embedding };
}

/** What a look says, given the thresholds for its kind (whole stretch or window): an event or null. */
function reading(seen, minConfidence, minSimilarity, o) {
  const builtIn = seen.confidence >= minConfidence;
  const taught = seen.custom && seen.custom.similarity >= (builtIn ? Math.max(minSimilarity, o.customOverride) : minSimilarity);
  if (taught) {
    return { gloss: seen.custom.name, confidence: seen.custom.similarity, top: seen.top, custom: true, accepted: true };
  }
  return builtIn ? { gloss: seen.gloss, confidence: seen.confidence, top: seen.top, accepted: true } : null;
}

/**
 * @param {Float32Array[]} frames  one stretch of 543*3 landmark frames
 * @param {number} srcFps          their frame rate
 * @param {(input: {data: Float32Array, frames: number, dim: number}) => Promise<{logits, embedding}>} infer
 * @param {string[]} glosses       sign names by class index
 * @param {object} [options]       overrides of DEFAULT_PHRASE; `custom` = a CustomSigns store
 * @returns {Promise<object[]>} events in time order, each
 *   { gloss, confidence, top: [{gloss, p} x3], accepted, reason?, custom?, startMs, endMs }
 *   (times relative to the start of the stretch). At most one event is not accepted: the best
 *   guess of a stretch in which nothing was certain (reason 'low-confidence').
 */
export async function decodeStretch(frames, srcFps, infer, glosses, options = {}) {
  const o = { ...DEFAULT_PHRASE, ...options };
  const custom = options.custom ?? null;
  const at30 = resample(frames, srcFps, o.fps);
  const n = at30.length;
  if (n < o.minFrames) return [];
  const ms = (frame) => Math.round((frame * 1000) / o.fps);
  const span = (a, b) => ({ startMs: ms(a), endMs: ms(b) });

  // 1. The whole stretch as one sign (squeezed only when splitting is off).
  let whole = null;
  if (n <= o.maxFrames || !o.split) {
    whole = await look(fitLength(at30, o.maxFrames), infer, glosses, custom, o);
    if (!whole) return [];
    const event = reading(whole, o.minConfidence, o.customSimilarity, o);
    if (event) return [{ ...event, ...span(0, n) }];
  }
  const unsure = (seen, a, b) => [
    { gloss: seen.gloss, confidence: seen.confidence, top: seen.top, accepted: false, reason: 'low-confidence', ...span(a, b) },
  ];
  if (!o.split || n < 2 * o.minWindowFrames) return whole ? unsure(whole, 0, n) : [];

  // 2. Windows on a grid; keep the best-scoring set of non-overlapping confident windows.
  const cuts = [];
  for (let a = 0; a < n; a += o.gridFrames) cuts.push(a);
  if (n - cuts[cuts.length - 1] < o.gridFrames / 2) cuts[cuts.length - 1] = n;
  else cuts.push(n);
  const best = new Array(cuts.length).fill(0);
  const back = new Array(cuts.length).fill(null);
  let runnerUp = null; // most confident window, for the "not sure" answer
  for (let j = 1; j < cuts.length; j++) {
    best[j] = best[j - 1];
    for (let i = j - 1; i >= 0; i--) {
      const length = cuts[j] - cuts[i];
      if (length > o.maxFrames) break;
      if (length < o.minWindowFrames || (i === 0 && j === cuts.length - 1)) continue;
      const seen = await look(at30.slice(cuts[i], cuts[j]), infer, glosses, custom, o);
      if (!seen) continue;
      if (!runnerUp || seen.confidence > runnerUp.seen.confidence) runnerUp = { seen, a: cuts[i], b: cuts[j] };
      const event = reading(seen, o.splitConfidence, o.customWindowSimilarity, o);
      if (!event) continue;
      const score = best[i] + length * (event.confidence - o.scoreOffset);
      if (score > best[j]) {
        best[j] = score;
        back[j] = { i, event: { ...event, ...span(cuts[i], cuts[j]) } };
      }
    }
  }
  const events = [];
  for (let j = cuts.length - 1; j > 0; ) {
    if (back[j]) {
      events.unshift(back[j].event);
      j = back[j].i;
    } else {
      j--;
    }
  }
  // The same sign twice in a row inside one stretch is one sign seen through two windows.
  const merged = [];
  for (const event of events) {
    const last = merged[merged.length - 1];
    if (last && last.gloss === event.gloss) {
      last.endMs = event.endMs;
      last.confidence = Math.max(last.confidence, event.confidence);
    } else {
      merged.push(event);
    }
  }
  if (merged.length) return merged;
  if (whole) return unsure(whole, 0, n);
  return runnerUp ? unsure(runnerUp.seen, runnerUp.a, runnerUp.b) : [];
}

/** Embedding of a whole stretch (squeezed to the model window), for teaching a custom sign. */
export async function embedStretch(frames, srcFps, infer, options = {}) {
  const o = { ...DEFAULT_PHRASE, ...options };
  const fitted = fitLength(resample(frames, srcFps, o.fps), o.maxFrames);
  if (fitted.length < o.minFrames) return null;
  const { embedding } = await infer({ data: sequenceFeatures(fitted), frames: fitted.length, dim: SEQUENCE_DIM });
  return embedding ? Float32Array.from(embedding) : null;
}
