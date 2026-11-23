// Browser-only: microphone capture at 16 kHz mono, cut into utterances by the VAD.
import { EnergyVAD, rms } from './vad.js';

export const SAMPLE_RATE = 16000;

/** Linear resampler for browsers that ignore the requested AudioContext sample rate. */
export function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, samples.length - 1);
    out[i] = samples[left] + (samples[right] - samples[left]) * (pos - left);
  }
  return out;
}

export class Microphone {
  /**
   * @param {(utterance: {audio: Float32Array, startMs: number, endMs: number}) => void} onUtterance
   * @param {(state: {level: number, speaking: boolean}) => void} onLevel called for every audio block
   */
  constructor(onUtterance, onLevel = () => {}) {
    this.onLevel = onLevel;
    this.vad = new EnergyVAD({ sampleRate: SAMPLE_RATE }, onUtterance);
    this.level = 0;
    this.context = null;
    this.stream = null;
  }

  get running() {
    return Boolean(this.stream);
  }

  get speaking() {
    return this.vad.speaking;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone needs a secure page: open the app on localhost or over https.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.context = new AudioContext({ sampleRate: SAMPLE_RATE });
    await this.context.audioWorklet.addModule('/capture-worklet.js');
    const source = this.context.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(this.context, 'capture');
    node.port.onmessage = (event) => {
      const block = resample(event.data, this.context.sampleRate, SAMPLE_RATE);
      this.level = rms(block);
      this.vad.push(block);
      this.onLevel({ level: this.level, speaking: this.vad.speaking });
    };
    // The worklet must be connected to run; route it through a muted gain to avoid feedback.
    const mute = this.context.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(this.context.destination);
  }

  stop() {
    this.vad.flush();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.context?.close();
    this.stream = null;
    this.context = null;
    this.level = 0;
  }
}
