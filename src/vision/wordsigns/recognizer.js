// Browser-only: word-level ASL recognition (isolated signs and short phrases) from video.
//
//   import { createWordSignRecognizer } from '/src/vision/wordsigns/recognizer.js';
//   const recognizer = await createWordSignRecognizer();          // loads ~19 MB once
//   // once per video frame (e.g. inside frameLoop from src/vision/mediapipe.js):
//   const out = recognizer.update(video, timestampMs);
//   if (out.result) text += out.result.gloss + ' ';
//   // when the picture stops:  for (const e of (await recognizer.flush()).events) ...
//
// MediaPipe HolisticLandmarker (face + pose + both hands) -> 543-point frame -> segmenter ->
// 460 features per frame -> ONNX model (250 ASL signs + a 128-d embedding for taught signs).
// The pure parts live in pipeline.js, phrase.js, segmenter.js, features.js, custom.js and
// decode.js; this file only loads things and talks to the browser.
import { pipelineOptions } from './config.js';
import { glossesFromLabels } from './decode.js';
import { WordSignPipeline, assembleFrame, classifySegment, shoulderShare } from './pipeline.js';

const DEFAULTS = {
  wasmPath: '/vendor/mediapipe/wasm',
  visionBundle: '/vendor/mediapipe/vision_bundle.mjs',
  holisticModel: '/models/holistic_landmarker.task',
  modelDir: '/models/wordsigns',
  ortModule: '/vendor/ort/ort.wasm.min.mjs',
  ortWasmPath: '/vendor/ort/',
  /** 'GPU' (falls back to CPU when WebGL is unavailable) or 'CPU'. */
  delegate: 'GPU',
};

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

/** Holistic landmarker on the GPU, falling back to CPU where WebGL is unavailable (some phones). */
async function createHolistic(o) {
  const mp = await import(o.visionBundle);
  const fileset = await mp.FilesetResolver.forVisionTasks(o.wasmPath);
  const create = (delegate) =>
    mp.HolisticLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: o.holisticModel, delegate },
      runningMode: 'VIDEO',
    }).then((task) => ({ task, delegate }));
  if (o.delegate === 'GPU') {
    try {
      return await create('GPU');
    } catch (err) {
      console.warn('GPU delegate unavailable for the holistic landmarker, using CPU', err);
    }
  }
  return create('CPU');
}

/** ONNX model on the WASM backend (single thread: the model is small and runs only when a stretch ends). */
async function createInfer(o, meta, stats) {
  const module = await import(o.ortModule);
  const ort = module.InferenceSession ? module : module.default;
  ort.env.wasm.wasmPaths = o.ortWasmPath;
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(`${o.modelDir}/model.onnx`, { executionProviders: ['wasm'] });
  const inputName = meta.io?.input ?? 'frames';
  return async (input) => {
    const t0 = performance.now();
    const output = await session.run({ [inputName]: new ort.Tensor('float32', input.data, [1, input.frames, input.dim]) });
    stats.inferenceMs = performance.now() - t0;
    stats.inferences++;
    return { logits: output.logits.data, embedding: output.embedding?.data ?? null };
  };
}

/**
 * Load the landmarker and the model (nothing is fetched until this is called).
 *
 * @param {object} [options]
 * @param {number} [options.minConfidence] report a stretch read as one sign at or above this (default 0.7)
 * @param {boolean} [options.split]        look for several signs in a long / unclear stretch (default true)
 * @param {object} [options.segmenter]     overrides of DEFAULT_SEGMENTER (segmenter.js)
 * @param {'GPU'|'CPU'} [options.delegate] landmarker delegate; GPU falls back to CPU
 * @param {(result: {gloss, confidence, top, custom?}) => void} [options.onResult] called for each recognised sign
 * @returns {Promise<object>} the recognizer; see the methods below
 */
export async function createWordSignRecognizer(options = {}) {
  const o = { ...DEFAULTS, ...options };
  const stats = { frames: 0, landmarksMs: 0, landmarksMsAvg: 0, inferenceMs: 0, inferences: 0 };
  const [meta, labels, holistic] = await Promise.all([
    fetchJson(`${o.modelDir}/model-meta.json`),
    fetchJson(`${o.modelDir}/labels.json`),
    createHolistic(o),
  ]);
  const infer = await createInfer(o, meta, stats);
  const glosses = glossesFromLabels(labels);
  const overrides = {};
  if (options.minConfidence !== undefined) overrides.minConfidence = options.minConfidence;
  if (options.split !== undefined) overrides.split = options.split;
  const pipeline = new WordSignPipeline({ glosses, infer, options: pipelineOptions(meta, overrides), segmenter: options.segmenter });
  let lastTimestamp = -1;

  const report = (out) => {
    for (const result of out.results) options.onResult?.(result);
    return out;
  };

  /** Landmarks of one frame, without feeding the recognizer. */
  function detect(video, timestampMs) {
    const t = timestampMs > lastTimestamp ? timestampMs : lastTimestamp + 1; // MediaPipe needs increasing time
    lastTimestamp = t;
    const t0 = performance.now();
    const r = holistic.task.detectForVideo(video, t);
    stats.landmarksMs = performance.now() - t0;
    stats.frames++;
    stats.landmarksMsAvg += (stats.landmarksMs - stats.landmarksMsAvg) / Math.min(stats.frames, 60);
    const leftHand = r.leftHandLandmarks[0] ?? null;
    const rightHand = r.rightHandLandmarks[0] ?? null;
    const pose = r.poseLandmarks[0] ?? null;
    const face = r.faceLandmarks[0] ?? null;
    const frame = assembleFrame({ face, leftHand, pose, rightHand });
    const hands = [leftHand, rightHand].filter(Boolean);
    let framing = 'ok';
    if (!pose && hands.length === 0) framing = 'no-person';
    else if (hands.length === 0) framing = 'no-hands';
    else if (shoulderShare([frame]) < 1) framing = 'partial';
    return { t, frame, framing, landmarks: { hands, leftHand, rightHand, pose, face } };
  }

  return {
    /** The 250 signs the model knows (display names, by class index). */
    glosses,
    meta,
    /** 'GPU' or 'CPU': what the landmarker runs on. */
    delegate: holistic.delegate,
    /** { frames, landmarksMs (last frame), landmarksMsAvg, inferenceMs (last model run), inferences } */
    stats,
    /** Timestamp (ms) of the last frame seen; the next one must be larger. */
    get lastTimestamp() {
      return lastTimestamp;
    },

    /**
     * Process one video frame. Call once per new frame with an increasing timestamp in ms
     * (performance.now() is fine). Returns
     *   landmarks: { hands: {x,y,z}[][], leftHand, rightHand, pose, face }   for drawing
     *   state:     'idle' | 'signing'
     *   framing:   'ok' | 'no-person' | 'no-hands' | 'partial' (a shoulder is out of the picture)
     *   result?:   { gloss, confidence, top: [{gloss, p} x3], custom? }  a sign just recognised
     *              (custom: true = a taught sign; then confidence is its similarity)
     *   results:   all signs recognised on this call (update(): at most one; flush(): all)
     *   rejected?: { gloss, confidence, top, reason }  a sign was seen but is withheld
     *              ('low-confidence' | 'framing'); show it as a hint, never add it to the text
     *   taught?:   { name, examples }  a teach() capture has just completed
     *   events:    the same as result / rejected with accepted, startMs, endMs (0 or 1 per call)
     * The model runs when a stretch of signing ends (hands drop, leave or hold still for
     * 0.3 s); the signs found in it are handed out one per update(), starting with the next frame.
     */
    update(video, timestampMs) {
      const { t, frame, framing, landmarks } = detect(video, timestampMs);
      return { landmarks, framing, ...report(pipeline.push(frame, t)) };
    },

    /** Landmarks of one frame without recognising: { frame (for classifyFrames / teachFrames), landmarks, framing }. */
    landmarks(video, timestampMs) {
      const { frame, framing, landmarks } = detect(video, timestampMs);
      return { frame, framing, landmarks };
    },

    /**
     * The picture stopped (camera off, clip ended): close a stretch in progress. Resolves like
     * update() without landmarks, but `results` (and `events`) hold ALL signs still to be
     * handed out, in order (`result` / `rejected` are only the first of each kind).
     */
    async flush() {
      pipeline.flush();
      await pipeline.pending;
      return report(pipeline.drain(true));
    },

    /**
     * Recognise frames that are already one stretch (no segmentation), e.g. cut from a clip:
     * 543*3 Float32Arrays from landmarks() at `fps`. Resolves to the events array.
     */
    classifyFrames(frames, fps = 30) {
      return classifySegment(frames, fps, infer, glosses, { ...pipeline.options, custom: pipeline.custom });
    },

    /**
     * Teach a sign the model does not know. The next complete stretch of signing (hands start
     * moving ... hands rest or drop; compound signs stay in one piece) is stored as an example
     * of `name` instead of being recognised. Resolves to { name, examples } when captured (also
     * reported as `taught` by update()), or null if cancelled. 2-3 examples match better than 1.
     */
    teach(name) {
      return pipeline.teach(name);
    },
    cancelTeach() {
      pipeline.cancelTeach();
    },
    /** Teach from frames that are already exactly the sign (see landmarks()). Resolves to { name, examples } or null (too short). */
    teachFrames(name, frames, fps = 30) {
      return pipeline.teachFrames(name, frames, fps);
    },
    /** [{ name, examples }] */
    customSigns() {
      return pipeline.custom.list();
    },
    removeCustom(name) {
      return pipeline.custom.remove(name);
    },
    /** Plain JSON-able object for localStorage: { version, dim, signs: [{ name, examples: number[][] }] }. */
    exportCustom() {
      return pipeline.custom.export();
    },
    /** Load what exportCustom() produced (object or JSON string), replacing the taught signs. Returns how many were loaded. */
    importCustom(data) {
      return pipeline.custom.import(data, meta.embeddingDim);
    },

    /** Forget a stretch in progress (camera switched, new clip). Taught signs are kept. */
    reset() {
      pipeline.reset();
    },

    close() {
      holistic.task.close();
    },
  };
}
