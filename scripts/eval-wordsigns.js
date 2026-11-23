// Evaluation of word-level sign recognition: src/vision/wordsigns + the ONNX model.
//
//   node scripts/eval-wordsigns.js               held-out TEST data
//   node scripts/eval-wordsigns.js --split dev   DEV data (the only data used to pick thresholds)
//
// Everything runs through the same JS code as the browser, with onnxruntime-node:
//   1. Feature parity with the model's original Python training code (features-fixture.json).
//   2. In-distribution sanity: the 6 "asl-signs" clips (held-out signers) the model's authors ship.
//   3. Isolated signs, cross-dataset: ASL Citizen clips (other signers and cameras, never seen
//      by the model) of signs whose gloss is one of the model's 250.
//   4. Phrases: 2-3 of those clips joined without a rest between the signs (synthetic).
//   5. Signs the model has no class for: how often it answers anyway.
//   6. Taught ("custom") signs: few-shot enrolment of such signs.
// The ASL Citizen landmark files (evals/wordsigns/*.i16.gz) are made by
// evals/wordsigns/prepare-aslcitizen.mjs; without them only 1 and 2 run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, hits, loadClips, makePhrases, memoInfer, pct, readJson, rng, stream, wilson } from '../evals/wordsigns/lib.mjs';
import { pipelineOptions } from '../src/vision/wordsigns/config.js';
import { CustomSigns } from '../src/vision/wordsigns/custom.js';
import { glossesFromLabels } from '../src/vision/wordsigns/decode.js';
import { frameFeatures, modelInput } from '../src/vision/wordsigns/features.js';
import { frameFromPoints } from '../src/vision/wordsigns/landmarks.js';
import { WordSignPipeline, classifySegment } from '../src/vision/wordsigns/pipeline.js';
import { Segmenter } from '../src/vision/wordsigns/segmenter.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_DIR = path.join(ROOT, 'public/models/wordsigns');
const split = process.argv.includes('--split') ? process.argv[process.argv.indexOf('--split') + 1] : 'test';
const SPLIT = split.toUpperCase();

async function loadModel() {
  const ort = (await import('onnxruntime-node')).default;
  const session = await ort.InferenceSession.create(path.join(MODEL_DIR, 'model.onnx'));
  const times = [];
  const infer = async (input) => {
    const t0 = performance.now();
    const out = await session.run({ frames: new ort.Tensor('float32', input.data, [1, input.frames, input.dim]) });
    times.push(performance.now() - t0);
    return { logits: out.logits.data, embedding: out.embedding.data };
  };
  return { infer, times };
}

function checkFeatureParity() {
  const fixture = readJson(path.join(DATA_DIR, 'features-fixture.json'));
  let worst = 0;
  let failed = 0;
  for (const c of fixture.cases) {
    const frames = c.frames.map((f) => frameFromPoints(f, fixture.points));
    const expected = c.expected.features.flat();
    let got;
    if (c.kind === 'sequence') {
      const input = modelInput(frames, c.srcFps, { fps: c.fps, maxFrames: c.maxFrames });
      got = input.frames === c.expected.length ? input.data : [];
    } else {
      got = frameFeatures(frames[0]);
    }
    let diff = got.length === expected.length ? 0 : Infinity;
    for (let i = 0; i < expected.length && diff < Infinity; i++) diff = Math.max(diff, Math.abs(expected[i] - got[i]));
    worst = Math.max(worst, diff);
    if (!(diff <= fixture.tolerance)) {
      failed++;
      console.log(`   FAIL ${c.name}: max |diff| ${diff}`);
    }
  }
  console.log(
    `1. Feature parity with the original Python features: ${fixture.cases.length - failed}/${fixture.cases.length} cases ` +
      `within ${fixture.tolerance} (worst |diff| ${worst.toExponential(1)}; the fixture is rounded to 1e-5)`,
  );
  return { cases: fixture.cases.length, failed, worstDiff: worst };
}

/** Best guess for frames that are one sign: the single event of a non-splitting, threshold-free decode. */
async function guess(frames, fps, infer, signIds, options) {
  const [event] = await classifySegment(frames, fps, infer, signIds, { ...options, split: false, minConfidence: 0, minShoulderShare: 0 });
  return event ?? null;
}

async function checkReplayClips(infer, signIds, options) {
  const file = readJson(path.join(DATA_DIR, 'replay-clips.json'));
  let top1 = 0;
  let top3 = 0;
  const lines = [];
  for (const clip of file.clips) {
    const d = await guess(clip.frames.map((f) => frameFromPoints(f, file.points)), clip.fps, infer, signIds, options);
    if (d.gloss === clip.sign) top1++;
    if (d.top.some((g) => g.gloss === clip.sign)) top3++;
    lines.push(`   ${clip.sign.padEnd(8)} -> ${d.top.map((g) => `${g.gloss} ${g.p.toFixed(2)}`).join(', ')}`);
  }
  console.log(`2. In-distribution sanity (asl-signs clips of held-out signers shipped by the model's authors, n=${file.clips.length}): top-1 ${top1}/${file.clips.length}, top-3 ${top3}/${file.clips.length}`);
  console.log(lines.join('\n'));
  return { n: file.clips.length, top1, top3 };
}

async function evalIsolated(clips, infer, signIds, options) {
  const s = { n: clips.length, top1: 0, top3: 0, answered: 0, answeredRight: 0 };
  for (const clip of clips) {
    const d = await guess(clip.data, clip.fps, infer, signIds, options);
    if (!d) continue;
    if (d.gloss === clip.sign) s.top1++;
    if (d.top.some((g) => g.gloss === clip.sign)) s.top3++;
    if (d.confidence >= options.minConfidence) {
      s.answered++;
      if (d.gloss === clip.sign) s.answeredRight++;
    }
  }
  return s;
}

/**
 * Streaming: each item ({ frames, fps, signs: [reference ids] }) goes frame by frame through a
 * fresh pipeline. Signs are scored in order (longest common subsequence with the reference).
 */
async function evalStreaming(items, infer, signIds, options, custom) {
  const s = { items: items.length, refs: 0, outputs: 0, right: 0, itemsWithOutput: 0, itemsAllRight: 0, withheld: 0, customOutputs: 0 };
  for (const item of items) {
    const pipeline = new WordSignPipeline({ glosses: signIds, infer, options, custom });
    const events = await stream(pipeline, item.frames, item.fps);
    const said = events.filter((e) => e.accepted);
    const right = hits(item.signs, said.map((e) => e.gloss));
    s.refs += item.signs.length;
    s.outputs += said.length;
    s.right += right;
    s.withheld += events.length - said.length;
    s.customOutputs += said.filter((e) => e.custom).length;
    if (said.length) s.itemsWithOutput++;
    if (right === item.signs.length && said.length === right) s.itemsAllRight++;
  }
  return s;
}

const line = (s) => `precision ${pct(s.right, s.outputs)} (${s.right}/${s.outputs}), recall ${pct(s.right, s.refs)} (${s.right}/${s.refs}, 95% CI ${wilson(s.right, s.refs)})`;

/** Few-shot teaching: enrol K signs the model has no class for, then stream queries and other signs. */
async function evalTeach(oov, known, infer, signIds, options, { enrolled, shots, episodes }) {
  const random = rng(11);
  const glosses = [...new Set(oov.map((c) => c.sign))].sort();
  const s = { enrolled, shots, episodes, queries: 0, recognised: 0, queryOther: 0, others: 0, othersCustom: 0, known: 0, knownCustom: 0, knownRight: 0 };
  for (let episode = 0; episode < episodes; episode++) {
    const picked = glosses.map((g) => [random(), g]).sort((a, b) => a[0] - b[0]).slice(0, enrolled).map(([, g]) => g);
    const teacher = new WordSignPipeline({ glosses: signIds, infer, options });
    for (const clip of oov.filter((c) => c.role === 'enroll' && picked.includes(c.sign))) {
      if (teacher.custom.list().find((x) => x.name === clip.sign)?.examples >= shots) continue;
      // As in the app: teach() captures the next complete stretch of the stream.
      const taught = teacher.teach(clip.sign);
      await stream(teacher, clip.data, clip.fps);
      teacher.cancelTeach();
      await taught;
      teacher.reset();
    }
    const run = async (clip) => {
      const pipeline = new WordSignPipeline({ glosses: signIds, infer, options, custom: teacher.custom });
      return (await stream(pipeline, clip.data, clip.fps)).filter((e) => e.accepted);
    };
    for (const clip of oov.filter((c) => c.role === 'query')) {
      const said = await run(clip);
      if (picked.includes(clip.sign)) {
        s.queries++;
        if (said.some((e) => e.custom && e.gloss === clip.sign)) s.recognised++;
        else if (said.length) s.queryOther++;
      } else {
        s.others++;
        if (said.some((e) => e.custom)) s.othersCustom++;
      }
    }
    for (const clip of known) {
      const said = await run(clip);
      s.known++;
      if (said.some((e) => e.custom)) s.knownCustom++;
      if (said.some((e) => !e.custom && e.gloss === clip.sign)) s.knownRight++;
    }
  }
  return s;
}

const meta = readJson(path.join(MODEL_DIR, 'model-meta.json'));
const labels = readJson(path.join(MODEL_DIR, 'labels.json'));
const signIds = labels.signs.map((s) => s.sign); // dataset sign ids by class index (the UI shows glossesFromLabels)
const options = pipelineOptions(meta);
const single = { ...options, split: false }; // the earlier behaviour: every stretch is one guess
console.log(`Word-sign model ${meta.version}: ${glossesFromLabels(labels).length} ASL signs, input [1, ${meta.minFrames}-${meta.maxFrames}, ${meta.featureDim}] at ${meta.fps} fps`);
console.log(`Thresholds (chosen on DEV): one sign per stretch >= ${options.minConfidence}, a sign inside a longer stretch >= ${options.splitConfidence}, taught sign similarity >= ${options.customSimilarity}\n`);

const results = { model: meta.version, split, options };
results.parity = checkFeatureParity();
const model = await loadModel();
const infer = memoInfer(model.infer);
results.replay = await checkReplayClips(infer, signIds, options);

const clips = loadClips('aslcitizen', split);
if (!clips) {
  console.log('\n3-6 skipped: evals/wordsigns/aslcitizen.i16.gz is missing (run evals/wordsigns/prepare-aslcitizen.mjs).');
} else {
  const t0 = performance.now();
  for (const clip of clips) modelInput(clip.data, clip.fps);
  const featureMs = (performance.now() - t0) / clips.length;
  const signs = new Set(clips.map((c) => c.sign)).size;
  const isolated = await evalIsolated(clips, infer, signIds, options);
  const items = clips.map((c) => ({ frames: c.data, fps: c.fps, signs: [c.sign] }));
  const isoNew = await evalStreaming(items, infer, signIds, options);
  const isoOld = await evalStreaming(items, infer, signIds, single);
  console.log(`\n3. Isolated signs, ASL Citizen ${SPLIT}: ${clips.length} clips of ${signs} signs (of the model's ${signIds.length}); signers and cameras the model never saw`);
  console.log(`   a) whole clip = one sign, no threshold: top-1 ${pct(isolated.top1, isolated.n)} (${isolated.top1}/${isolated.n}, 95% CI ${wilson(isolated.top1, isolated.n)}), top-3 ${pct(isolated.top3, isolated.n)}`);
  console.log(`      with the ${options.minConfidence} threshold: answers ${pct(isolated.answered, isolated.n)} of clips, ${pct(isolated.answeredRight, isolated.answered)} of the answers right`);
  console.log(`   b) streaming (frame by frame through the segmenter, as the camera does), words actually reported:`);
  console.log(`      now:                ${line(isoNew)}; clips with no word: ${pct(isoNew.items - isoNew.itemsWithOutput, isoNew.items)}`);
  console.log(`      one guess/stretch:  ${line(isoOld)}; clips with no word: ${pct(isoOld.items - isoOld.itemsWithOutput, isoOld.items)}`);

  const phrases = makePhrases(clips, 7, split === 'dev' ? { twos: 55, threes: 30 } : { twos: 150, threes: 100 });
  const phraseItems = phrases.map((p) => ({ frames: p.frames, fps: 30, signs: p.signs }));
  model.times.length = 0;
  const t1 = performance.now();
  const phrNew = await evalStreaming(phraseItems, infer, signIds, options);
  const phraseMs = (performance.now() - t1) / phrases.length;
  const phrOld = await evalStreaming(phraseItems, infer, signIds, single);
  console.log(`\n4. Phrases, ${SPLIT}: ${phrases.length} synthetic phrases of 2-3 signs (${phrNew.refs} signs), isolated clips joined without a rest`);
  console.log(`      now:                ${line(phrNew)}; whole phrase right: ${pct(phrNew.itemsAllRight, phrNew.items)}`);
  console.log(`      one guess/stretch:  ${line(phrOld)}; whole phrase right: ${pct(phrOld.itemsAllRight, phrOld.items)}`);
  results.aslCitizen = { clips: clips.length, signs, isolated, streaming: { now: isoNew, single: isoOld }, phrases: { n: phrases.length, now: phrNew, single: phrOld } };

  const oov = loadClips('aslcitizen-oov', split);
  if (oov) {
    const oovItems = oov.map((c) => ({ frames: c.data, fps: c.fps, signs: [] }));
    const oovNew = await evalStreaming(oovItems, infer, signIds, options);
    const oovOld = await evalStreaming(oovItems, infer, signIds, single);
    console.log(`\n5. Signs the model has no class for, ${SPLIT}: ${oov.length} clips of ${new Set(oov.map((c) => c.sign)).size} other ASL Citizen glosses (any word is wrong)`);
    console.log(`      now: a word for ${pct(oovNew.itemsWithOutput, oovNew.items)} of clips (${oovNew.outputs} words); one guess/stretch: ${pct(oovOld.itemsWithOutput, oovOld.items)} (${oovOld.outputs} words)`);
    console.log(`\n6. Taught signs, ${SPLIT}: examples and queries are by DIFFERENT signers (3 query clips per taught sign); "fires" = a taught sign reported for something else`);
    results.teach = [];
    const sample = clips.filter((_, i) => i % (split === 'dev' ? 1 : 3) === 0); // 200 clips of signs the model knows
    for (const [enrolled, shots] of [[1, 1], [1, 3], [5, 3]]) {
      const t = await evalTeach(oov, sample, infer, signIds, options, { enrolled, shots, episodes: 10 });
      results.teach.push(t);
      console.log(
        `      ${enrolled} taught sign(s), ${shots} example(s): recognised ${pct(t.recognised, t.queries)} (${t.recognised}/${t.queries}); ` +
          `fires on ${pct(t.othersCustom, t.others)} of other unknown signs and ${pct(t.knownCustom, t.known)} of known signs; ` +
          `known signs still right: ${pct(t.knownRight, t.known)}`,
      );
    }
    results.oov = { clips: oov.length, now: oovNew, single: oovOld };
  }
  const inferMs = model.times.reduce((a, b) => a + b, 0) / (model.times.length || 1);
  console.log(`\nCost in Node: features ${featureMs.toFixed(2)} ms per sign, model ${inferMs.toFixed(1)} ms per run; a phrase (about ${Math.round(phrases.reduce((a, p) => a + p.frames.length, 0) / phrases.length / 30 * 10) / 10} s of video) takes ${phraseMs.toFixed(0)} ms to decode in total`);
  results.nodeMs = { features: featureMs, model: inferMs, phrase: phraseMs };
}
fs.writeFileSync(path.join(DATA_DIR, `results-${split}.json`), `${JSON.stringify(results, null, 1)}\n`);
if (results.parity.failed) process.exitCode = 1;
