// Converts the ASLNow! fingerspelling dataset (MIT, 21 MediaPipe hand landmarks per sample)
// into the train / test files used by the model builder and the evals.
//   git clone --depth 1 https://huggingface.co/datasets/sid220/asl-now-fingerspelling
//   node scripts/prepare-dataset.js path/to/asl-now-fingerspelling
// Every 5th sample of each letter is held out for testing and never used as a prototype.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/prepare-dataset.js <path to asl-now-fingerspelling>');
  process.exit(1);
}
// The dataset does not record the camera's aspect ratio; 1.5 sits between the 4:3 and 16:9
// webcams it was collected with and makes palm proportions agree across hand orientations.
const ASPECT = 1.5;
const round = (v) => Math.round(v * 1e4) / 1e4;
const train = [];
const test = [];
for (const label of readdirSync(source).filter((d) => /^[A-Z]$/.test(d)).sort()) {
  const files = readdirSync(path.join(source, label)).filter((f) => f.endsWith('.json')).sort();
  files.forEach((file, i) => {
    const landmarks = JSON.parse(readFileSync(path.join(source, label, file), 'utf8'));
    if (!Array.isArray(landmarks) || landmarks.length !== 21) return;
    const sample = { label, aspect: ASPECT, landmarks: landmarks.map((p) => ({ x: round(p.x), y: round(p.y), z: round(p.z) })) };
    (i % 5 === 4 ? test : train).push(sample);
  });
}
const meta = { source: 'https://huggingface.co/datasets/sid220/asl-now-fingerspelling', license: 'MIT' };
mkdirSync(path.join(ROOT, 'evals/data'), { recursive: true });
writeFileSync(path.join(ROOT, 'evals/data/landmarks-train.json'), JSON.stringify({ ...meta, samples: train }));
writeFileSync(path.join(ROOT, 'evals/data/landmarks-test.json'), JSON.stringify({ ...meta, samples: test }));
console.log(`train: ${train.length} samples, test: ${test.length} samples`);
