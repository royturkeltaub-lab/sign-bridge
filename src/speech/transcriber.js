// Page-side handle on the Whisper worker.
import { SPOKEN } from '../core/languages.js';
import { ASR_MODELS } from './whisperCore.js';

export class Transcriber {
  /** @param {(status: string) => void} onStatus human-readable loading progress */
  constructor(onStatus = () => {}) {
    this.onStatus = onStatus;
    this.worker = null;
    this.ready = null;
    this.pending = new Map();
    this.nextId = 1;
    this.device = null;
  }

  /** Start loading the model (idempotent). `size` is a key of ASR_MODELS. */
  load(size = 'base') {
    if (this.ready) return this.ready;
    this.worker = new Worker('/src/speech/whisper-worker.js', { type: 'module' });
    const files = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = ({ data }) => {
        if (data.type === 'progress') {
          files.set(data.file, [data.loaded, data.total]);
          let loaded = 0;
          let total = 0;
          for (const [l, t] of files.values()) {
            loaded += l;
            total += t;
          }
          this.onStatus(`Downloading speech model… ${Math.round(loaded / 1e6)} / ${Math.round(total / 1e6)} MB`);
        } else if (data.type === 'ready') {
          this.device = data.device;
          this.onStatus(`Speech model ready (${data.device === 'webgpu' ? 'GPU' : 'CPU'})`);
          resolve(data.device);
        } else if (data.type === 'result') {
          this.pending.get(data.id)?.resolve(data);
          this.pending.delete(data.id);
        } else if (data.type === 'error') {
          const waiting = this.pending.get(data.id);
          if (waiting) {
            waiting.reject(new Error(data.message));
            this.pending.delete(data.id);
          } else {
            this.onStatus(`Speech model failed to load: ${data.message}`);
            reject(new Error(data.message));
          }
        }
      };
      this.worker.onerror = (event) => reject(new Error(event.message || 'Speech worker failed'));
    });
    this.onStatus('Loading speech model…');
    this.worker.postMessage({ type: 'load', model: ASR_MODELS[size] || ASR_MODELS.base });
    return this.ready;
  }

  /**
   * @param {Float32Array} audio 16 kHz mono
   * @returns {Promise<{text: string, language: string, confidence: number, ms: number}>}
   */
  async transcribe(audio) {
    await this.load();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'transcribe', id, audio, candidates: Object.keys(SPOKEN) }, [audio.buffer]);
    });
  }
}
