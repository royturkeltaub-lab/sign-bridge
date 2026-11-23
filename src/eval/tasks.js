// Eval tasks: each takes a case's `input` and returns the system's actual output as a
// string, which the runner compares with the case's known-correct `expected` value.
// Everything here runs both in Node (npm run eval) and in the browser (Eval tab).
import { detectTextLanguage, defaultSignLanguage } from '../core/languages.js';
import { handBasis, placeLandmarks, toImageSpace } from '../core/handModel.js';
import { textToGloss, textToPlan, planNotation, spellableLetters, SIGN_DATA } from '../translate/gloss.js';
import { buildTimeline, sampleTimeline } from '../render/timeline.js';
import { HandshapeClassifier } from '../vision/classifier.js';
import { LetterDecoder } from '../vision/letters.js';
import { Speller } from '../vision/speller.js';
import { ActiveSpeakerSelector } from '../vision/activeSpeaker.js';
import { EnergyVAD } from '../speech/vad.js';
import { rng } from '../vision/synth.js';
import { BODY } from '../signs/space.js';

const classifiers = new Map();
/** One classifier per sign language, built lazily from the shared model. */
function classifierFor(signCode, env) {
  if (!classifiers.has(signCode)) {
    const classifier = new HandshapeClassifier(env.model);
    classifier.useAlphabet(SIGN_DATA[signCode].ALPHABET);
    classifiers.set(signCode, classifier);
  }
  return classifiers.get(signCode);
}
export function resetClassifiers() {
  classifiers.clear();
}

/**
 * Fingerspell `text` with the avatar's hand model, show the resulting hand to the
 * detector frame by frame (as a camera would), and return what the detector typed.
 */
export function roundTripSpell(text, signCode, env, { fps = 30, slow = 2.6 } = {}) {
  const data = SIGN_DATA[signCode];
  const decoder = new LetterDecoder(classifierFor(signCode, env), data.ALPHABET);
  let clock = 0;
  const step = 1000 / fps;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const letters = spellableLetters(word, signCode);
    const timeline = buildTimeline([{ type: 'spell', word, letters }]);
    for (let t = 0; t < timeline.duration * slow; t += step) {
      const pose = sampleTimeline(timeline, t / slow);
      let hand = null;
      if (pose.item >= 0) {
        const basis = handBasis(pose.dom.finger, pose.dom.palm, 'right');
        const wrist = [pose.dom.at[0], pose.dom.at[1], pose.dom.at[2]];
        const world = placeLandmarks(pose.dom.local, basis, wrist, BODY.handSize);
        hand = { landmarks: toImageSpace(world), handed: 'right' };
      }
      decoder.update(clock, hand);
      clock += step;
    }
    // Hand leaves the frame between words.
    for (let t = 0; t < 1300; t += step) {
      decoder.update(clock, null);
      clock += step;
    }
  }
  return decoder.text.trim();
}

/** Scripted scene for the active-speaker selector; returns the index of the chosen face. */
function activeSpeakerScene(input) {
  const selector = new ActiveSpeakerSelector();
  const random = rng(input.seed || 7);
  const ids = new Map(); // track id -> face index
  let selected = null;
  for (let t = 0; t <= input.durationMs; t += 33) {
    const segment = input.segments.find((s) => t >= s.from && t < s.to) || { speaker: -1, level: 0.002 };
    const faces = input.faces.map((face, i) => {
      const talking = segment.speaker === i;
      // Talking mouths open and close a few times a second; idle mouths barely move,
      // unless the scene says the person is moving their mouth silently (e.g. chewing).
      const chewing = (segment.silentMovers || []).includes(i);
      const wave = talking || chewing ? 0.25 + 0.2 * Math.sin(t / 55 + i) : 0.03;
      const mouthOpen = wave + random() * 0.02;
      return { box: { cx: face.cx, cy: face.cy, x: face.cx - 0.08, y: face.cy - 0.1, w: 0.16, h: 0.2 }, mouthOpen };
    });
    const level = segment.speaker >= 0 ? segment.level ?? 0.07 : segment.level ?? 0.002;
    const state = selector.update(t, level * (0.7 + 0.6 * random()), faces);
    state.tracks.forEach((track) => {
      if (!ids.has(track.id)) {
        // Identify the track by the nearest scripted face.
        let best = 0;
        input.faces.forEach((f, i) => {
          if (Math.abs(f.cx - track.box.cx) < Math.abs(input.faces[best].cx - track.box.cx)) best = i;
        });
        ids.set(track.id, best);
      }
    });
    if (input.sampleAt != null && t >= input.sampleAt && selected == null) {
      selected = state.selectedId == null ? -1 : ids.get(state.selectedId);
    }
  }
  if (selected == null) selected = selector.selectedId == null ? -1 : ids.get(selector.selectedId);
  return String(selected);
}

/** Synthetic audio (tone bursts over noise) through the VAD; returns the utterance count. */
function vadScene(input) {
  const rate = 16000;
  const random = rng(input.seed || 3);
  const total = Math.round((input.durationMs / 1000) * rate);
  const audio = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const ms = (i / rate) * 1000;
    const burst = input.bursts.find((b) => ms >= b.from && ms < b.to);
    const noise = (random() * 2 - 1) * (input.noise ?? 0.003);
    audio[i] = noise + (burst ? Math.sin(i * 0.12) * (burst.level ?? 0.2) : 0);
  }
  let count = 0;
  const vad = new EnergyVAD({ sampleRate: rate }, () => count++);
  for (let i = 0; i < total; i += 1600) vad.push(audio.subarray(i, i + 1600));
  vad.flush();
  return String(count);
}

function spellerScene(input) {
  const speller = new Speller();
  let t = 0;
  for (const [label, ms, confidence = 0.9] of input) {
    for (const end = t + ms; t < end; t += 33) {
      speller.update(t, label == null ? null : { label, confidence });
    }
  }
  return speller.text.trim();
}

export const TASKS = {
  /** input: text -> spoken language code */
  'text-language': (input) => detectTextLanguage(input).code || 'none',
  /** input: spoken language code -> sign language offered first */
  'sign-offer': (input) => defaultSignLanguage(input)?.code || 'none',
  /** input: { text, sign } -> gloss string */
  gloss: (input) => textToGloss(input.text, input.sign).map((t) => t.gloss).join(' '),
  /** input: { text, sign } -> plan notation (signs + #fingerspelling) */
  plan: (input) => planNotation(textToPlan(input.text, input.sign)),
  /** input: { letter, sign } -> handshape name (+move for moving letters) */
  'letter-shape': (input) => {
    const def = SIGN_DATA[input.sign].ALPHABET[input.letter];
    return def ? `${def.shape}${def.path ? '+move' : ''}` : 'none';
  },
  /** input: { text, sign } -> text read back by the detector from the rendered hand */
  'round-trip': (input, env) => roundTripSpell(input.text, input.sign, env),
  /** input: { landmarks, aspect, sign } -> letter, for one real camera sample */
  handshape: (input, env) =>
    classifierFor(input.sign, env).predict(input.landmarks, { aspect: input.aspect || 1 })?.label || 'none',
  /** input: [[label|null, ms, confidence?], ...] -> typed text */
  speller: (input) => spellerScene(input),
  /** input: scripted scene -> index of the selected face (-1 = nobody) */
  'active-speaker': (input) => activeSpeakerScene(input),
  /** input: synthetic audio description -> number of utterances */
  vad: (input) => vadScene(input),
};

/** Suites generated from the sign data itself: every letter of every alphabet, round-tripped. */
export function generatedSuites(env = {}) {
  const suites = [];
  if (env.testSamples?.length) {
    const seen = {};
    suites.push({
      id: 'handshape-real-asl',
      title: 'ASL letters from real hands (held-out samples)',
      description:
        'Hand landmarks recorded from real signers (ASLNow! dataset, MIT). These samples were held out and never used to build the detector. J is excluded: it is a movement, which a single frame cannot show.',
      task: 'handshape',
      cases: env.testSamples
        .filter((sample) => sample.label !== 'J')
        .map((sample) => {
          seen[sample.label] = (seen[sample.label] || 0) + 1;
          return {
            id: `${sample.label}-${seen[sample.label]}`,
            label: `${sample.label} (sample ${seen[sample.label]})`,
            input: { landmarks: sample.landmarks, aspect: sample.aspect, sign: 'asl' },
            expected: sample.label,
          };
        }),
    });
  }
  return [...suites, ...roundTripLetterSuites()];
}

function roundTripLetterSuites() {
  return Object.entries(SIGN_DATA).map(([code, data]) => ({
    id: `round-trip-letters-${code}`,
    title: `Round trip: every ${code.toUpperCase()} letter`,
    description: 'Each letter is rendered by the avatar hand model and must be read back as the same letter.',
    task: 'round-trip',
    cases: Object.keys(data.ALPHABET).map((letter) => ({
      id: letter,
      input: { text: letter, sign: code },
      expected: letter,
    })),
  }));
}
