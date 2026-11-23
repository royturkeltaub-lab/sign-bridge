// Decision settings for the word-sign recognizer, shared by the browser module and the eval.
// Every threshold here was chosen on DEV data only (evals/wordsigns: the 4th ASL Citizen clip
// of each sign, phrases built from those clips, and the DEV half of the out-of-vocabulary
// glosses; `node scripts/eval-wordsigns.js --split dev`), never on the held-out TEST split.
import { DEFAULT_PIPELINE } from './pipeline.js';

/**
 * A whole stretch read as one sign is reported at or above this top-1 probability. On DEV,
 * 0.29 (the model's own "not sure" calibration, fitted on its training dataset's signers) left
 * 22% of the answers wrong, 0.5 left 16%, 0.7 left 10% while still answering 63% of the clips.
 */
export const MIN_CONFIDENCE = 0.7;

/**
 * A window inside a longer stretch (several signs without a rest) is reported at or above
 * this. On DEV phrases 0.7 gave 77% precision / 56% recall, 0.9 gave 90% / 48%, and isolated
 * signs kept their precision (91% vs 93% without splitting).
 */
export const SPLIT_CONFIDENCE = 0.9;

/**
 * Taught signs: cosine similarity of the embedding to the taught examples. On DEV, with the
 * examples and the query signed by DIFFERENT people, 0.5 accepted 58% of repeats of one taught
 * sign (3 examples) and fired on about 1% of other signs; 0.6 accepted 44% / 0.5%.
 */
export const CUSTOM_SIMILARITY = 0.5;

/** Pipeline options from model-meta.json (temperature, frame rate, window). */
export function pipelineOptions(meta, overrides = {}) {
  return {
    ...DEFAULT_PIPELINE,
    temperature: meta.calibration?.temperature ?? 1,
    minConfidence: Math.max(MIN_CONFIDENCE, meta.calibration?.notSureBelow ?? 0),
    splitConfidence: SPLIT_CONFIDENCE,
    customSimilarity: CUSTOM_SIMILARITY,
    fps: meta.fps,
    minFrames: meta.minFrames,
    maxFrames: meta.maxFrames,
    ...overrides,
  };
}
