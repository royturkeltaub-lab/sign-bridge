// Synthetic handshape samples generated from the avatar's hand model. They give the
// classifier prototypes for handshapes with no real training data (most ISL-only shapes)
// and let the evals round-trip rendered signs back through the detector.
import { getHandshape, FINGER_NAMES } from '../core/handshapes.js';
import { localLandmarks, handBasis, placeLandmarks } from '../core/handModel.js';
import { norm } from '../core/vec.js';
import { featuresFromSignerSpace } from './features.js';

/** Small deterministic PRNG so generated data is reproducible. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jitterShape(shape, random, degrees) {
  const j = () => (random() * 2 - 1) * degrees;
  const fingers = {};
  for (const name of FINGER_NAMES) {
    const [mcp, pip, dip, abd] = shape.fingers[name];
    fingers[name] = [Math.max(-5, mcp + j()), Math.max(0, pip + j()), Math.max(0, dip + j() * 0.6), abd + j() * 0.4];
  }
  let thumb = shape.thumb;
  if (!thumb.touch) {
    thumb = {
      dir: thumb.dir.map((v) => v + (random() * 2 - 1) * 0.08),
      bend: thumb.bend.map((v) => Math.max(0, v + j())),
      toward: thumb.toward,
    };
  }
  return { fingers, thumb };
}

/**
 * Landmarks (signer space) for a letter definition, optionally perturbed.
 * @param {{shape: string, finger?: number[], palm?: number[]}} def
 * @param {{random?: Function, shapeNoise?: number, turnNoise?: number, hand?: string}} options
 */
export function synthLandmarks(def, { random = null, shapeNoise = 0, turnNoise = 0, hand = 'right' } = {}) {
  const base = getHandshape(def.shape);
  const local = random && shapeNoise ? localLandmarks(jitterShape(base, random, shapeNoise)) : localLandmarks(def.shape);
  let finger = def.finger || [0, 1, 0];
  let palm = def.palm || [0, 0, 1];
  if (random && turnNoise) {
    const wobble = (v) => norm(v.map((n) => n + (random() * 2 - 1) * turnNoise));
    finger = wobble(finger);
    palm = wobble(palm);
  }
  return placeLandmarks(local, handBasis(finger, palm, hand));
}

/** Feature vectors for `count` perturbed renderings of a letter definition. */
export function synthFeatures(def, count, seed = 1, { shapeNoise = 9, turnNoise = 0.28 } = {}) {
  const random = rng(seed);
  const samples = [];
  for (let i = 0; i < count; i++) {
    const landmarks = synthLandmarks(def, { random, shapeNoise: i ? shapeNoise : 0, turnNoise: i ? turnNoise : 0 });
    samples.push(featuresFromSignerSpace(landmarks));
  }
  return samples;
}
