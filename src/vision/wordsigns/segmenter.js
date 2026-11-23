// Cuts a continuous landmark stream into single-sign segments. Pure; runs in Node and the browser.
// Ported from GestureSign (MIT, (c) 2026 Shashank Yadav) web/src/ml/segmenter.ts.
//
// A segment (one "stretch" of signing: a sign, or a phrase signed without a rest) starts when a
// hand is present and moving - or is already in view on the very first frame, as in a clip that
// starts mid-sign - and ends when the hands are gone, or held still, for `gapMs`. Short dropouts
// inside a sign are bridged. After a "still" ending the
// segmenter waits for new motion ('resting'), so a hand resting in view does not produce a
// stream of guesses, and a quick movement out of a still hold that ends with the hands leaving
// the frame is taken as the hands dropping after the sign, not as a new sign. Motion is measured
// in shoulder widths per second, so it does not depend on the distance to the camera or on the
// frame rate.
import { computeAnchor } from './features.js';
import { LEFT_HAND_START, N_HAND, RIGHT_HAND_START, handsMissing } from './landmarks.js';

export const DEFAULT_SEGMENTER = Object.freeze({
  /** Hands absent or still for this long ends a sign (ms). */
  gapMs: 300,
  /** Hand speed (shoulder widths per second) above which the hand counts as moving. */
  moveSpeed: 0.6,
  /** Segments shorter than this are discarded as noise (the model needs 8 frames at 30 fps) ... */
  minMs: 230,
  /** ... and so are segments with fewer frames, whatever the camera's frame rate. */
  minFrames: 4,
  /** A segment is closed after this long even if signing continues (ms). */
  maxMs: 12000,
  /** Frames with hands just before motion starts are kept (hands entering), ms. */
  prerollMs: 200,
  /** A segment that starts from a still hold and ends with the hands leaving in less than this is discarded. */
  leaveMs: 500,
});

const HAND_STARTS = [LEFT_HAND_START, RIGHT_HAND_START];

/** Mean displacement of hand points seen in both samples, in shoulder widths per second. */
export function handSpeed(prev, next) {
  const dt = (next.t - prev.t) / 1000;
  if (!(dt > 0)) return 0;
  const { scale } = computeAnchor([next.frame]);
  let total = 0;
  let count = 0;
  for (const start of HAND_STARTS) {
    for (let i = 0; i < N_HAND; i++) {
      const k = (start + i) * 3;
      const d = Math.hypot(next.frame[k] - prev.frame[k], next.frame[k + 1] - prev.frame[k + 1]);
      if (Number.isFinite(d)) {
        total += d;
        count++;
      }
    }
  }
  return count ? total / count / scale / dt : 0;
}

export class Segmenter {
  constructor(options = {}) {
    this.opts = { ...DEFAULT_SEGMENTER, ...options };
    this.reset();
  }

  reset() {
    this.samples = [];
    this.recent = [];
    this.last = null;
    this.speed = 0;
    this.quietSince = null;
    this.quietReason = 'absent';
    this.fromRest = false;
    this.started = false;
    /** 'idle' | 'signing' | 'resting' */
    this.state = 'idle';
  }

  /**
   * Feed one frame (Float32Array 543*3, NaN = not detected) with its timestamp in ms.
   * Returns null, or one of
   *   { type: 'start', t }
   *   { type: 'end', reason: 'absent'|'still'|'max'|'flush', segment: { frames, timestamps, fps, durationMs } }
   *   { type: 'discard', reason: 'too-short'|'hands-leaving' }
   */
  push(frame, t) {
    const sample = { frame, t };
    const present = !handsMissing(frame);
    if (present && this.last && !handsMissing(this.last.frame)) {
      // Light smoothing so one jittery frame neither starts nor ends a sign.
      this.speed = 0.5 * this.speed + 0.5 * handSpeed(this.last, sample);
    } else if (!present) {
      this.speed = 0;
    }
    this.last = sample;
    const moving = present && this.speed >= this.opts.moveSpeed;
    // The first frame of a stream: hands already in view count as a sign under way.
    const cold = !this.started && present;
    this.started = true;

    if (this.state !== 'signing') {
      if (!present) this.state = 'idle';
      this.recent = present ? [...this.recent, sample].filter((s) => t - s.t <= this.opts.prerollMs) : [];
      if (!moving && !cold) return null;
      this.fromRest = this.state === 'resting';
      this.state = 'signing';
      this.samples = [...this.recent];
      this.quietSince = null;
      return { type: 'start', t };
    }

    this.samples.push(sample);
    if (t - this.samples[0].t >= this.opts.maxMs) {
      const event = this.finish('max', this.samples.length);
      this.recent = [];
      return event;
    }
    if (moving) {
      this.quietSince = null;
      return null;
    }
    if (this.quietSince === null) {
      this.quietSince = t;
      this.quietReason = present ? 'still' : 'absent';
    }
    if (t - this.quietSince < this.opts.gapMs) return null;
    // Keep frames up to the start of the quiet gap; a still hold keeps its first frame.
    const quietStart = this.quietSince;
    const keep = this.samples.filter((s) => s.t < quietStart).length;
    const reason = this.quietReason;
    if (reason === 'absent' && this.fromRest) {
      const kept = this.samples.slice(0, keep);
      const span = kept.length ? kept[kept.length - 1].t - kept[0].t : 0;
      if (span < this.opts.leaveMs) {
        this.finish(reason, 0);
        return { type: 'discard', reason: 'hands-leaving' };
      }
    }
    const event = this.finish(reason, reason === 'still' ? keep + 1 : keep);
    this.state = present ? 'resting' : 'idle';
    return event;
  }

  /** End any open segment now (e.g. when the camera stops or a recorded clip finishes). */
  flush() {
    if (this.state !== 'signing') return null;
    const quiet = this.quietSince;
    const keep = quiet === null ? this.samples.length : this.samples.filter((s) => s.t < quiet).length;
    return this.finish('flush', keep);
  }

  finish(reason, keep) {
    const kept = this.samples.slice(0, Math.max(0, keep));
    this.samples = [];
    this.quietSince = null;
    this.state = 'idle';
    const first = kept.length ? kept[0].t : 0;
    const durationMs = kept.length ? kept[kept.length - 1].t - first : 0;
    if (kept.length < this.opts.minFrames || durationMs < this.opts.minMs) return { type: 'discard', reason: 'too-short' };
    const fps = durationMs > 0 ? ((kept.length - 1) * 1000) / durationMs : 30;
    return {
      type: 'end',
      reason,
      segment: { frames: kept.map((s) => s.frame), timestamps: kept.map((s) => s.t), fps, durationMs },
    };
  }
}
