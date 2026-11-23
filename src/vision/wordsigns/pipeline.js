// Stream of landmark frames -> recognised signs. Pure logic (no browser, MediaPipe or ONNX
// imports): the model is passed in as `infer`, so this runs unchanged in Node (see
// scripts/eval-wordsigns.js) and in the browser (see recognizer.js).
import { CustomSigns } from './custom.js';
import {
  FRAME_LENGTH,
  LEFT_HAND_START,
  N_FACE,
  N_HAND,
  N_POSE,
  POSE_LEFT_SHOULDER,
  POSE_RIGHT_SHOULDER,
  POSE_START,
  RIGHT_HAND_START,
} from './landmarks.js';
import { DEFAULT_PHRASE, decodeStretch, embedStretch } from './phrase.js';
import { Segmenter } from './segmenter.js';

export const DEFAULT_PIPELINE = Object.freeze({
  ...DEFAULT_PHRASE,
  /** A stretch is refused when both shoulders are in view in fewer than this share of its frames. */
  minShoulderShare: 0.5,
});

function write(frame, start, points, count) {
  if (!points || points.length < count) return;
  for (let i = 0; i < count; i++) {
    const p = points[i];
    frame[(start + i) * 3] = p.x;
    frame[(start + i) * 3 + 1] = p.y;
    frame[(start + i) * 3 + 2] = p.z ?? 0;
  }
}

/**
 * MediaPipe Holistic output -> the 543 x 3 frame the model was trained on (NaN = not detected).
 * Each argument is an array of {x, y, z} in normalised image coordinates, or null/undefined.
 * `leftHand` / `rightHand` are the signer's own left and right, as Holistic reports them.
 */
export function assembleFrame({ face, leftHand, pose, rightHand }) {
  const frame = new Float32Array(FRAME_LENGTH).fill(Number.NaN);
  write(frame, 0, face, N_FACE);
  write(frame, LEFT_HAND_START, leftHand, N_HAND);
  write(frame, POSE_START, pose, N_POSE);
  write(frame, RIGHT_HAND_START, rightHand, N_HAND);
  return frame;
}

function shoulderInView(frame, index) {
  const k = (POSE_START + index) * 3;
  return frame[k] >= -0.02 && frame[k] <= 1.02 && frame[k + 1] >= -0.02 && frame[k + 1] <= 1.02;
}

/** Share of frames in which both shoulders are inside the picture. */
export function shoulderShare(frames) {
  let ok = 0;
  for (const f of frames) {
    if (shoulderInView(f, POSE_LEFT_SHOULDER) && shoulderInView(f, POSE_RIGHT_SHOULDER)) ok++;
  }
  return frames.length ? ok / frames.length : 0;
}

/**
 * One stretch of frames (a sign, or several signed without a rest) -> events, without the
 * segmenter. See decodeStretch (phrase.js) for the event shape. A stretch with the shoulders
 * out of view is refused: its events come back with accepted = false, reason 'framing'.
 */
export async function classifySegment(frames, srcFps, infer, glosses, options = {}) {
  const o = { ...DEFAULT_PIPELINE, ...options };
  const events = await decodeStretch(frames, srcFps, infer, glosses, o);
  if (shoulderShare(frames) >= o.minShoulderShare) return events;
  return events.map((e) => (e.accepted ? { ...e, accepted: false, reason: 'framing' } : e));
}

/**
 * Continuous stream -> signs. Call push() once per frame; when the segmenter closes a stretch
 * the model runs asynchronously and its answers are handed out by the following push() calls,
 * one sign per call, in order (normally starting with the next frame).
 */
export class WordSignPipeline {
  /**
   * @param {object} config
   * @param {string[]} config.glosses  sign names by class index
   * @param {Function} config.infer    (input) => Promise<{ logits, embedding }>
   * @param {object} [config.options]   overrides of DEFAULT_PIPELINE
   * @param {object} [config.segmenter] overrides of DEFAULT_SEGMENTER
   * @param {CustomSigns} [config.custom] taught signs (a new empty store by default)
   */
  constructor({ glosses, infer, options = {}, segmenter = {}, custom = new CustomSigns() }) {
    this.glosses = glosses;
    this.infer = infer;
    this.custom = custom;
    this.options = { ...DEFAULT_PIPELINE, ...options };
    // Without splitting, a stretch is one guess: keep it within what one model window can hold.
    this.segmenter = new Segmenter({ ...(this.options.split ? {} : { maxMs: 4000 }), ...segmenter });
    this.ready = [];
    this.pending = Promise.resolve();
    this.teaching = null;
    this.generation = 0;
  }

  /** 'idle' | 'signing' ('idle' also covers a hand resting still in view). */
  get state() {
    return this.segmenter.state === 'signing' ? 'signing' : 'idle';
  }

  /** Forget a stretch in progress and answers not handed out yet (taught signs are kept). */
  reset() {
    this.generation++;
    this.segmenter.reset();
    this.ready = [];
  }

  /**
   * Teach a custom sign: the NEXT complete stretch (from the hands starting to move until they
   * rest or drop, however many movements it has) is stored as an example of `name` instead of
   * being recognised. Resolves to { name, examples } once captured, or null if cancelled /
   * the stretch was unusable. Teach the same name 2-3 times for a better match.
   */
  teach(name) {
    this.cancelTeach();
    return new Promise((resolve) => {
      this.teaching = { name, resolve };
    });
  }

  cancelTeach() {
    this.teaching?.resolve(null);
    this.teaching = null;
  }

  /** Store frames that are already one sign (e.g. cut from a clip) as an example of `name`. */
  async teachFrames(name, frames, fps = 30) {
    const embedding = await embedStretch(frames, fps, this.infer, this.options);
    if (!embedding) return null;
    return { name, examples: this.custom.add(name, embedding) };
  }

  /**
   * @param {Float32Array} frame 543*3 landmark frame (see assembleFrame)
   * @param {number} t timestamp in ms
   * @returns {{ state: 'idle'|'signing', events: object[], results: object[], result?: object, rejected?: object, taught?: object }}
   *   `events` holds at most one event here (see drain()).
   */
  push(frame, t) {
    this.submit(this.segmenter.push(frame, t));
    return this.drain();
  }

  /** Close an open stretch now (camera stopped / clip ended). Await `pending`, then drain(true). */
  flush() {
    this.submit(this.segmenter.flush());
  }

  submit(event) {
    if (event?.type !== 'end') return;
    const { frames, fps } = event.segment;
    const generation = this.generation;
    const teaching = this.teaching;
    this.teaching = null;
    const work = teaching
      ? this.teachFrames(teaching.name, frames, fps).then((taught) => {
          teaching.resolve(taught);
          return taught ? [{ taught }] : [];
        })
      : classifySegment(frames, fps, this.infer, this.glosses, { ...this.options, custom: this.custom });
    this.pending = this.pending
      .then(() => work)
      .then((events) => {
        if (generation === this.generation) this.ready.push(...events);
      })
      .catch((err) => {
        teaching?.resolve(null);
        console.error('word-sign inference failed', err);
      });
  }

  /**
   * Hand out finished answers: one per call (so a per-frame loop adds one word per frame), or
   * all of them with `all = true`.
   *   events:   the signs handed out now, each { gloss, confidence, top, accepted, reason?, custom?, startMs, endMs }
   *   results:  the accepted ones, each { gloss, confidence, top, custom? } (custom = a taught sign)
   *   result:   the first of `results`
   *   rejected: the first one not accepted, as { gloss, confidence, top, reason } - a sign was
   *             seen but is not reported ('low-confidence' | 'framing'); never add it to the text
   *   taught:   { name, examples } when a teach() capture has just completed
   */
  drain(all = false) {
    const out = { state: this.state, events: [], results: [] };
    while (this.ready.length && (all || (out.events.length === 0 && !out.taught))) {
      const event = this.ready.shift();
      if (event.taught) {
        out.taught = event.taught;
        continue;
      }
      out.events.push(event);
      const { gloss, confidence, top, reason, custom } = event;
      if (event.accepted) out.results.push({ gloss, confidence, top, ...(custom ? { custom: true } : {}) });
      else out.rejected ??= { gloss, confidence, top, reason };
    }
    if (out.results.length) out.result = out.results[0];
    return out;
  }
}
