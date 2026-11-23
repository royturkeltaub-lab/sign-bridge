#!/usr/bin/env node
// Runs every eval suite and prints a report.
//   npm run eval                 all suites
//   npm run eval -- gloss        only suites whose id contains "gloss"
//   npm run eval -- --verbose    also list passing cases
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSuites, confusions } from './runner.js';
import { generatedSuites } from './tasks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const filters = args.filter((a) => !a.startsWith('--'));

export async function loadSuites(env = {}) {
  const dir = path.join(ROOT, 'evals/cases');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const suites = [];
  for (const file of files) suites.push(JSON.parse(await readFile(path.join(dir, file), 'utf8')));
  return [...suites, ...generatedSuites(env)];
}

export async function loadEnv() {
  const model = JSON.parse(await readFile(path.join(ROOT, 'public/models/handshapes.json'), 'utf8'));
  let testSamples = [];
  try {
    testSamples = JSON.parse(await readFile(path.join(ROOT, 'evals/data/landmarks-test.json'), 'utf8')).samples;
  } catch {
    // The real-hand suite is skipped when the dataset has not been prepared.
  }
  return { model, testSamples };
}

const color = (code, text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);

async function main() {
  const env = await loadEnv();
  let suites = await loadSuites(env);
  if (filters.length) suites = suites.filter((s) => filters.some((f) => s.id.includes(f)));
  const report = await runSuites(suites, env);
  for (const suite of report.suites) {
    const pct = (suite.accuracy * 100).toFixed(0).padStart(3);
    const mark = suite.passed === suite.total ? color(32, '✓') : color(31, '✗');
    console.log(`${mark} ${suite.title.padEnd(52)} ${String(suite.passed).padStart(3)}/${String(suite.total).padEnd(3)} ${pct}%`);
    for (const r of suite.results) {
      if ((r.pass && !verbose) || (suite.total > 60 && !verbose)) continue;
      const tag = r.pass ? color(32, 'pass') : color(31, 'FAIL');
      console.log(`    ${tag} ${r.id}: ${r.input}\n         expected: ${r.expected}\n         actual:   ${r.actual}`);
    }
    if (suite.total > 20 && suite.passed < suite.total) {
      console.log(`    confusions: ${confusions(suite).slice(0, 8).map(([k, n]) => `${k} ×${n}`).join(', ')}`);
    }
  }
  console.log(`\nTotal: ${report.passed}/${report.total} (${(report.accuracy * 100).toFixed(1)}%)`);
  await mkdir(path.join(ROOT, 'evals/results'), { recursive: true });
  await writeFile(path.join(ROOT, 'evals/results/latest.json'), JSON.stringify({ ranAt: new Date().toISOString(), ...report }, null, 2));
  process.exitCode = report.passed === report.total ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
