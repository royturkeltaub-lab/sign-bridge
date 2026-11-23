// Sign readers used by the Sign -> Text tab. Each reader turns video frames into text and
// shares one small interface so the tab can switch between them:
//   load()                       fetch models (idempotent)
//   frame(video, time, ctx, w, h) -> { big, detail, progress, alternatives, changed }
//   text / reset() / space() / backspace()
import { SIGN_DATA } from '../translate/gloss.js';
import { HandshapeClassifier } from '../vision/classifier.js';
import { LetterDecoder } from '../vision/letters.js';
import { createHandLandmarker } from '../vision/mediapipe.js';
import { signerHand } from '../vision/handedness.js';

const BONES = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [5, 9, 10, 11, 12],
  [9, 13, 14, 15, 16],
  [13, 17, 18, 19, 20],
  [0, 17],
];

/** Draw one hand skeleton on the overlay. */
export function drawHand(ctx, landmarks, width, height, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, width / 240);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const bone of BONES) {
    ctx.beginPath();
    bone.forEach((i, n) => {
      const x = landmarks[i].x * width;
      const y = landmarks[i].y * height;
      if (n) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
}

let handModel = null;
let handLandmarker = null;

/** Fingerspelling: one hand's shape per frame -> letters -> text. */
export class LettersReader {
  constructor(signCode) {
    this.signCode = signCode;
    this.decoder = null;
  }

  get hint() {
    return (
      'Fingerspelling: hold each letter steady for about half a second. ' +
      'Slide the hand sideways to double a letter, and move it out of view for a space.'
    );
  }

  get text() {
    return this.decoder ? this.decoder.text : '';
  }

  async load() {
    handModel ||= await (await fetch('/models/handshapes.json', { cache: 'no-cache' })).json();
    handLandmarker ||= await createHandLandmarker(2);
    if (!this.decoder) {
      const { ALPHABET } = SIGN_DATA[this.signCode];
      const classifier = new HandshapeClassifier(handModel);
      classifier.useAlphabet(ALPHABET);
      this.decoder = new LetterDecoder(classifier, ALPHABET);
    }
  }

  frame(video, time, ctx, width, height) {
    const result = handLandmarker.detectForVideo(video, time);
    // Read the largest hand in view (the one closest to the camera).
    let best = -1;
    let bestSize = 0;
    result.landmarks.forEach((lm, i) => {
      const size = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y);
      if (size > bestSize) {
        bestSize = size;
        best = i;
      }
    });
    result.landmarks.forEach((lm, i) => drawHand(ctx, lm, width, height, i === best ? '#37d0a0' : 'rgba(255,255,255,0.35)'));
    const hand =
      best < 0 ? null : { landmarks: result.landmarks[best], handed: signerHand(result.handedness[best]?.[0]?.categoryName) };
    const state = this.decoder.update(time, hand, width / height);
    // Only show a letter the detector is confident about; the rest is "unclear".
    const shown = hand && state.confidence >= this.decoder.speller.o.minConfidence ? state.letter : null;
    return {
      big: shown || '–',
      detail: !hand
        ? 'No hand in view'
        : state.typed
          ? `Typed ${state.typed === ' ' ? 'space' : state.typed}`
          : shown
            ? `Looks like ${shown} — hold still to type it`
            : 'Unclear handshape',
      progress: state.progress || state.confidence,
      alternatives: '',
      changed: Boolean(state.typed),
    };
  }

  reset() {
    this.decoder?.reset();
  }

  space() {
    this.decoder?.speller.space();
  }

  backspace() {
    this.decoder?.speller.backspace();
  }
}

// A sign the model is only fairly sure about is still shown, marked with "?", instead of
// being dropped: on real clips the right word often scores 40-70%.
const TENTATIVE_CONFIDENCE = 0.4;

const CUSTOM_SIGNS_KEY = 'sign-bridge.taught-signs';

const FRAMING_HINTS = {
  'no-person': 'No one in view',
  'no-hands': 'Waiting for hands',
  partial: 'Step back a little: both shoulders must be in view',
};

/** Whole signs (ASL, one sign at a time): face + body + hands per frame -> words -> text. */
export class WordsReader {
  constructor() {
    this.recognizer = null;
    this.words = [];
    this.last = null; // last recognised or rejected sign, kept on screen until the next one
  }

  get hint() {
    return (
      'Whole signs (ASL): make one sign at a time with your face and both shoulders in view, ' +
      'then lower or pause your hands. The reader knows about 250 everyday signs; a word ending in "?" is a guess.'
    );
  }

  get text() {
    return this.words.join(' ');
  }

  async load() {
    if (this.recognizer) return;
    const { createWordSignRecognizer } = await import('../vision/wordsigns/recognizer.js');
    this.recognizer = await createWordSignRecognizer();
    // Signs taught earlier in this browser.
    try {
      const saved = JSON.parse(localStorage.getItem(CUSTOM_SIGNS_KEY));
      if (saved) this.recognizer.importCustom?.(saved);
    } catch (err) {
      console.warn('Could not restore taught signs', err);
    }
  }

  /** True when the loaded model can learn new signs from an example. */
  get canTeach() {
    return typeof this.recognizer?.teach === 'function';
  }

  /** Signs taught so far: [{ name, examples }]. */
  taught() {
    return this.recognizer?.customSigns?.() || [];
  }

  saveTaught() {
    localStorage.setItem(CUSTOM_SIGNS_KEY, JSON.stringify(this.recognizer.exportCustom()));
  }

  /** Learn `name` from the next sign shown; resolves once it has been captured. */
  async teach(name) {
    const captured = await this.recognizer.teach(name);
    this.saveTaught();
    return captured;
  }

  cancelTeach() {
    this.recognizer?.cancelTeach?.();
  }

  forget(name) {
    this.recognizer.removeCustom(name);
    this.saveTaught();
  }

  /** Record recognised (or rejected) signs; returns true when the text changed. */
  take(out) {
    const results = out.results?.length ? out.results : out.result ? [out.result] : [];
    if (results.length) {
      for (const result of results) this.words.push(result.gloss);
      this.last = { ...results[results.length - 1], accepted: true };
      return true;
    }
    if (out.rejected) {
      this.last = { ...out.rejected, accepted: false };
      if (out.rejected.reason === 'low-confidence' && out.rejected.confidence >= TENTATIVE_CONFIDENCE) {
        this.words.push(`${out.rejected.gloss}?`);
        this.last.tentative = true;
        return true;
      }
    }
    return false;
  }

  frame(video, time, ctx, width, height) {
    return this.present(this.recognizer.update(video, time), ctx, width, height);
  }

  /**
   * Read a whole clip frame by frame (not in real time), so the result does not depend on
   * how fast this machine plays video. `onState(state)` is called for every frame.
   */
  async readFile(video, draw) {
    const { recognizeVideoFile } = await import('../vision/wordsigns/videoFile.js');
    let shown = 0;
    const { events } = await recognizeVideoFile(this.recognizer, video, {
      onFrame: (out) => {
        shown += out.events?.length || 0;
        draw((ctx, w, h) => this.present(out, ctx, w, h));
      },
    });
    // Signs that were still open when the clip ended are decided after the last frame.
    let changed = false;
    for (const event of events.slice(shown)) {
      changed = this.take(event.accepted ? { result: event } : { rejected: event }) || changed;
    }
    return changed;
  }

  /** Learn `name` from a whole clip: everything signed in it becomes one example. */
  async teachFile(name, video) {
    const { teachFromVideo } = await import('../vision/wordsigns/videoFile.js');
    const captured = await teachFromVideo(this.recognizer, name, video);
    if (!captured) throw new Error('no hands were visible in that clip');
    this.saveTaught();
    return captured;
  }

  /** Show one update() result: draw the hands and describe what is happening. */
  present(out, ctx, width, height) {
    for (const hand of out.landmarks.hands) drawHand(ctx, hand, width, height, out.state === 'signing' ? '#37d0a0' : 'rgba(255,255,255,0.5)');
    const changed = this.take(out);
    const { last } = this;
    const percent = (p) => `${Math.round(p * 100)}%`;
    let detail = FRAMING_HINTS[out.framing] || (out.state === 'signing' ? 'Signing…' : 'Ready — make a sign');
    if (out.state !== 'signing' && last) {
      detail = last.accepted
        ? `Recognised (${percent(last.confidence)} sure)`
        : last.reason === 'framing'
          ? 'Saw a sign, but the shoulders were out of view'
          : last.tentative
            ? `Probably "${last.gloss}" (${percent(last.confidence)} sure) — added with a ?`
            : `Not sure — best guess "${last.gloss}" (${percent(last.confidence)})`;
    }
    return {
      big: out.state === 'signing' ? '…' : last?.accepted ? last.gloss : last?.tentative ? `${last.gloss}?` : '–',
      detail,
      progress: out.state === 'signing' ? 1 : last ? last.confidence : 0,
      alternatives:
        out.state !== 'signing' && last?.top?.length > 1
          ? `Other candidates: ${last.top.slice(last.accepted ? 1 : 0).map((c) => `${c.gloss} ${percent(c.p)}`).join(', ')}`
          : '',
      changed,
    };
  }

  /** The picture stopped (clip ended): close a sign that was still in progress. */
  async finish() {
    if (!this.recognizer) return false;
    // flush() can return several signs at once (everything still open when the picture stopped).
    const out = await this.recognizer.flush();
    let changed = false;
    for (const event of out.events?.length ? out.events : [out]) {
      const one = event.gloss ? (event.accepted ? { result: event } : { rejected: event }) : event;
      changed = this.take(one) || changed;
    }
    return changed;
  }

  reset() {
    this.words = [];
    this.last = null;
    this.recognizer?.reset();
  }

  space() {}

  backspace() {
    this.words.pop();
  }
}
