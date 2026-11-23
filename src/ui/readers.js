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
