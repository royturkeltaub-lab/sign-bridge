// Web Worker: loads Whisper once, then transcribes utterances posted from the page.
// Messages in:  { type: 'load', model } | { type: 'transcribe', id, audio, candidates }
// Messages out: { type: 'progress', ... } | { type: 'ready', device } | { type: 'result', id, ... } | { type: 'error', id?, message }
import * as lib from '/vendor/transformers/transformers.js';
import { loadWhisper, transcribe } from './whisperCore.js';

// Use the copy of the ONNX runtime served by this app instead of a CDN.
lib.env.backends.onnx.wasm.wasmPaths = '/vendor/ort/';

let whisper = null;
let queue = Promise.resolve();

async function load(model) {
  const onProgress = (p) => {
    if (p.status === 'progress') self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
  };
  const gpu = Boolean(self.navigator.gpu) && Boolean(await self.navigator.gpu.requestAdapter().catch(() => null));
  if (gpu) {
    try {
      whisper = await loadWhisper(lib, model, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        onProgress,
      });
      return 'webgpu';
    } catch (err) {
      console.warn('WebGPU speech model failed, falling back to WASM', err);
    }
  }
  whisper = await loadWhisper(lib, model, { device: 'wasm', dtype: 'q8', onProgress });
  return 'wasm';
}

self.onmessage = ({ data }) => {
  // Run requests one at a time, in order.
  queue = queue.then(async () => {
    try {
      if (data.type === 'load') {
        const device = await load(data.model);
        self.postMessage({ type: 'ready', device });
      } else if (data.type === 'transcribe') {
        const started = performance.now();
        const result = await transcribe(whisper, data.audio, data.candidates);
        self.postMessage({ type: 'result', id: data.id, ...result, ms: Math.round(performance.now() - started) });
      }
    } catch (err) {
      self.postMessage({ type: 'error', id: data.id, message: err?.message || String(err) });
    }
  });
};
