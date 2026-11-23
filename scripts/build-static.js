// Builds a plain static copy of the app in dist/ for static hosts such as Vercel.
// It lays files out exactly as server.js serves them, so the app code needs no changes:
//   public/*  -> /            src/ -> /src/        evals/ -> /evals/ (+ generated index.json)
//   selected parts of node_modules -> /vendor/*
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'dist');
const from = (...parts) => path.join(ROOT, ...parts);
const to = (...parts) => path.join(OUT, ...parts);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await cp(from('public'), OUT, { recursive: true });
await cp(from('src'), to('src'), { recursive: true });
for (const dir of ['cases', 'data', 'audio']) {
  await cp(from('evals', dir), to('evals', dir), { recursive: true }).catch(() => {});
}
// server.js lists the eval case files on request; a static host needs the list as a file.
const cases = (await readdir(from('evals/cases'))).filter((f) => f.endsWith('.json')).sort();
await writeFile(to('evals/index.json'), JSON.stringify(cases));

// MediaPipe: the bundle and its WASM runtime.
await cp(from('node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'), to('vendor/mediapipe/vision_bundle.mjs'));
await cp(from('node_modules/@mediapipe/tasks-vision/wasm'), to('vendor/mediapipe/wasm'), { recursive: true });
// transformers.js (speech) and the ONNX runtime files it and the word-sign model load.
await cp(from('node_modules/@huggingface/transformers/dist/transformers.js'), to('vendor/transformers/transformers.js'));
const ort = from('node_modules/onnxruntime-web/dist');
await mkdir(to('vendor/ort'), { recursive: true });
for (const file of await readdir(ort)) {
  if (/^ort-wasm-simd-threaded.*\.(mjs|wasm)$/.test(file) || file === 'ort.wasm.min.mjs') {
    await cp(path.join(ort, file), to('vendor/ort', file));
  }
}
// three.js (3D avatar): the module build and the add-ons (loaders and their helpers).
await mkdir(to('vendor/three/build'), { recursive: true });
for (const file of ['three.module.js', 'three.core.js']) {
  await cp(from('node_modules/three/build', file), to('vendor/three/build', file));
}
await cp(from('node_modules/three/examples/jsm'), to('vendor/three/examples/jsm'), { recursive: true });

console.log(`Static site written to ${OUT}`);
