#!/usr/bin/env node
// Speech eval: runs recorded clips through the same Whisper code the app uses and checks
// (1) the detected language, (2) the transcript, (3) the signs the transcript produces.
//   npm run eval:audio                      whisper-base
//   npm run eval:audio -- small             whisper-small
//   npm run eval:audio -- base --prior=same   pass each clip's true language as the previous
//                                             utterance's language (--prior=other: the wrong one)
// Exits non-zero when language accuracy falls below LANGUAGE_FLOOR for the model.
// The clips are synthetic (macOS voices), so this is a regression check, not real-world accuracy.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '@huggingface/transformers';
import { ASR_MODELS, loadWhisper, transcribe } from '../src/speech/whisperCore.js';
import { SPOKEN, defaultSignLanguage } from '../src/core/languages.js';
import { textToPlan, planNotation } from '../src/translate/gloss.js';

const DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'evals/audio');
const args = process.argv.slice(2);
const size = args.find((arg) => !arg.startsWith('--')) || 'base';
const priorMode = args.find((arg) => arg.startsWith('--prior='))?.split('=')[1] || null;
// Clips with the right language, out of 48, measured without a prior. Raise when it improves.
const LANGUAGE_FLOOR = { base: 46, small: 46 };

/** Read a 16-bit PCM mono 16 kHz wav file into a Float32Array. */
async function readWav(file) {
  const buf = await readFile(file);
  let offset = 12;
  while (offset < buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const length = buf.readUInt32LE(offset + 4);
    if (id === 'data') {
      const out = new Float32Array(Math.floor(length / 2));
      for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(offset + 8 + i * 2) / 32768;
      return out;
    }
    offset += 8 + length + (length % 2);
  }
  throw new Error(`No audio data in ${file}`);
}

const words = (text) =>
  String(text).toLowerCase().replace(/[֑-ׇ]/g, '').replace(/[^a-z0-9א-ת\s]/g, ' ').split(/\s+/).filter(Boolean);

/** Word error rate: edit distance between word lists over the reference length. */
function wordErrorRate(reference, hypothesis) {
  const a = words(reference);
  const b = words(hypothesis);
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return a.length ? row[b.length] / a.length : 0;
}

const suite = JSON.parse(await readFile(path.join(DIR, 'cases.json'), 'utf8'));
if (!ASR_MODELS[size]) throw new Error(`Unknown model "${size}" (use ${Object.keys(ASR_MODELS).join(' or ')})`);
console.log(`Loading ${ASR_MODELS[size]}…`);
const whisper = await loadWhisper(lib, ASR_MODELS[size], { dtype: 'q8' });
const candidates = Object.keys(SPOKEN);
const tally = { language: 0, text: 0, plan: 0 };
const perGroup = {}; // by id prefix: en, he, ena (accented English)
let werSum = 0;
let msSum = 0;
let twoPass = 0;
for (const c of suite.cases) {
  const audio = await readWav(path.join(DIR, c.file));
  const other = candidates.find((code) => code !== c.language);
  const prior = priorMode === 'same' ? c.language : priorMode === 'other' ? other : undefined;
  const started = performance.now();
  const result = await transcribe(whisper, audio, candidates, { prior });
  const ms = Math.round(performance.now() - started);
  const wer = wordErrorRate(c.text, result.text);
  const sign = defaultSignLanguage(result.language)?.code;
  const plan = sign ? planNotation(textToPlan(result.text, sign)) : '';
  const ok = { language: result.language === c.language, text: wer === 0, plan: plan === c.plan };
  for (const key of Object.keys(tally)) if (ok[key]) tally[key]++;
  const group = (perGroup[c.id.split('-')[0]] ??= { n: 0, language: 0, text: 0, wer: 0, ms: 0 });
  group.n++;
  group.language += ok.language;
  group.text += ok.text;
  group.wer += wer;
  group.ms += ms;
  werSum += wer;
  msSum += ms;
  if (result.passes > 1) twoPass++;
  const mark = (v) => (v ? '✓' : '✗');
  const seconds = (audio.length / 16000).toFixed(1);
  console.log(`${c.id.padEnd(5)} ${seconds}s  lang ${mark(ok.language)} ${result.language} (${(result.confidence * 100).toFixed(0)}%)  text ${mark(ok.text)}  signs ${mark(ok.plan)}  ${ms} ms${result.passes > 1 ? '  (compared both languages)' : ''}`);
  if (!ok.text) console.log(`      said:  ${c.text}\n      heard: ${result.text}`);
  if (!ok.plan) console.log(`      signs expected: ${c.plan}\n      signs actual:   ${plan}`);
}
const n = suite.cases.length;
const pct = (value) => `${(value * 100).toFixed(0)}%`;
console.log('');
for (const [name, g] of Object.entries(perGroup)) {
  console.log(`${name.padEnd(4)} language ${g.language}/${g.n}   exact transcript ${g.text}/${g.n}   mean word error rate ${pct(g.wer / g.n)}   mean ${Math.round(g.ms / g.n)} ms`);
}
console.log(`Language ${tally.language}/${n}   exact transcript ${tally.text}/${n}   signs ${tally.plan}/${n}   mean word error rate ${pct(werSum / n)}   mean ${Math.round(msSum / n)} ms/clip   compared both languages on ${twoPass}/${n}${priorMode ? `   (prior: ${priorMode} language)` : ''}`);
const floor = LANGUAGE_FLOOR[size] ?? n;
if (!priorMode && tally.language < floor) {
  console.error(`FAIL: language accuracy ${tally.language}/${n} is below the floor of ${floor}/${n} for ${size}`);
  process.exitCode = 1;
}
