// Builds public/models/handshapes.json: the prototype set for the handshape classifier.
//   real samples      evals/data/landmarks-train.json (optional; see scripts/README in that file)
//   synthetic samples generated from the avatar hand model for every letter of every alphabet
// Usage: node scripts/build-model.js [--synthetic-only]
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGN_DATA } from '../src/translate/gloss.js';
import { classKey, fitScaler, fitProjection, HandshapeClassifier } from '../src/vision/classifier.js';
import { synthFeatures } from '../src/vision/synth.js';
import { handFeatures } from '../src/vision/features.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REAL = path.join(ROOT, 'evals/data/landmarks-train.json');
const OUT = path.join(ROOT, 'public/models/handshapes.json');
const SYNTH_PER_CLASS = 40;
const REAL_PER_CLASS = 80;
const SYNTH_WITH_REAL = 8;
// Familiarity calibration (see fitFamiliarity).
const FAMILIAR_NEAR_QUANTILE = 0.95;
const FAMILIAR_FAR_QUANTILE = 0.99;
const FAMILIAR_FAR_FACTOR = 1.5;
const syntheticOnly = process.argv.includes('--synthetic-only');

/**
 * Nearest-prototype distances the classifier should treat as familiar: each real prototype
 * is looked up against all the others (so the numbers describe an unseen sample of a known
 * handshape). Confidence is full up to `near` and falls to zero at `far`.
 */
function fitFamiliarity(model) {
  const classifier = new HandshapeClassifier({ ...model, familiarity: { near: 1, far: 2 } }, { k: 2 });
  const distances = [];
  for (const proto of classifier.prototypes) {
    if (proto.source !== 'real') continue;
    classifier.active = classifier.prototypes.filter((p) => p !== proto);
    distances.push(classifier.predictFeatures(proto.f).distance);
  }
  if (distances.length < 20) return null;
  distances.sort((x, y) => x - y);
  const at = (q) => distances[Math.min(distances.length - 1, Math.floor(q * distances.length))];
  return { near: at(FAMILIAR_NEAR_QUANTILE), far: at(FAMILIAR_FAR_QUANTILE) * FAMILIAR_FAR_FACTOR };
}

/**
 * Build a model from real samples ({label, aspect, landmarks}, ASL letters) plus synthetic
 * samples for every letter of every alphabet.
 */
export function assembleModel(samples = [], { realPerClass = REAL_PER_CLASS, project = true } = {}) {
  const prototypes = [];
  const realKeys = new Set();
  const perLabel = new Map();
  // Real samples are labelled with ASL letters; store them under that letter's class key.
  for (const sample of samples) {
    const def = SIGN_DATA.asl.ALPHABET[sample.label];
    // Letters that are a movement of another letter's handshape (J) have no static class.
    if (!def || (def.path && classKey(def) !== sample.label && SIGN_DATA.asl.ALPHABET[classKey(def)])) continue;
    const key = classKey(def);
    const n = perLabel.get(key) || 0;
    if (n >= realPerClass) continue;
    perLabel.set(key, n + 1);
    realKeys.add(key);
    prototypes.push({ key, source: 'real', f: handFeatures(sample.landmarks, { aspect: sample.aspect || 1 }) });
  }
  const seen = new Set();
  let seed = 11;
  for (const data of Object.values(SIGN_DATA)) {
    for (const def of Object.values(data.ALPHABET)) {
      const key = classKey(def);
      if (seen.has(key)) continue;
      seen.add(key);
      // Classes with real data keep a few synthetic samples so rendered signs still match.
      const count = realKeys.has(key) ? SYNTH_WITH_REAL : SYNTH_PER_CLASS;
      for (const f of synthFeatures(def, count, seed++)) prototypes.push({ key, source: 'synthetic', f });
    }
  }
  const round = (v) => Math.round(v * 1e4) / 1e4;
  for (const p of prototypes) p.f = p.f.map(round);
  const scaler = fitScaler(prototypes);
  const model = {
    version: 2,
    createdFrom: realKeys.size ? 'real+synthetic' : 'synthetic',
    mean: scaler.mean.map(round),
    std: scaler.std.map(round),
    prototypes,
  };
  if (project) model.projection = fitProjection(prototypes, model).map((row) => row.map(round));
  const familiarity = fitFamiliarity(model);
  if (familiarity) model.familiarity = { near: round(familiarity.near), far: round(familiarity.far) };
  return model;
}

export async function buildModel({ useReal = true } = {}) {
  const samples = useReal && existsSync(REAL) ? JSON.parse(await readFile(REAL, 'utf8')).samples : [];
  return assembleModel(samples);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const model = await buildModel({ useReal: !syntheticOnly });
  await writeFile(OUT, JSON.stringify(model));
  const keys = new Set(model.prototypes.map((p) => p.key));
  const real = model.prototypes.filter((p) => p.source === 'real').length;
  console.log(`Wrote ${OUT}: ${model.prototypes.length} prototypes (${real} real), ${keys.size} classes`);
}
