// Energy-based voice activity detector. Feed it mono Float32 audio at a fixed sample rate;
// it emits complete utterances (speech bounded by silence) ready for transcription.

export const VAD_DEFAULTS = {
  sampleRate: 16000,
  frameMs: 30,
  minLevel: 0.012, // absolute RMS floor for speech
  noiseRatio: 3, // speech must be this many times louder than the noise floor
  startMs: 90, // speech needed to open an utterance
  endMs: 700, // silence needed to close it
  preRollMs: 300, // audio kept from before the start
  minUtteranceMs: 350,
  maxUtteranceMs: 12000,
};

export function rms(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export class EnergyVAD {
  /**
   * @param {object} options overrides for VAD_DEFAULTS
   * @param {(utterance: {audio: Float32Array, startMs: number, endMs: number}) => void} onUtterance
   */
  constructor(options = {}, onUtterance = () => {}) {
    this.o = { ...VAD_DEFAULTS, ...options };
    this.onUtterance = onUtterance;
    this.frameSize = Math.round((this.o.sampleRate * this.o.frameMs) / 1000);
    this.pending = new Float32Array(0);
    this.noise = 0.004;
    this.level = 0;
    this.speaking = false;
    this.clock = 0; // ms of audio consumed
    this.loudMs = 0;
    this.quietMs = 0;
    this.preRoll = [];
    this.chunks = [];
    this.startedAt = 0;
    this.leadMs = 0;
    this.floor = 0;
  }

  /** Current speech threshold (RMS). */
  get threshold() {
    return Math.max(this.o.minLevel, this.noise * this.o.noiseRatio);
  }

  /** Push any amount of audio; frames are cut internally. */
  push(samples) {
    const merged = new Float32Array(this.pending.length + samples.length);
    merged.set(this.pending);
    merged.set(samples, this.pending.length);
    let offset = 0;
    while (offset + this.frameSize <= merged.length) {
      this.frame(merged.subarray(offset, offset + this.frameSize));
      offset += this.frameSize;
    }
    this.pending = merged.slice(offset);
  }

  frame(frame) {
    const { o } = this;
    const level = rms(frame);
    this.level = level;
    this.clock += o.frameMs;
    const loud = level > this.threshold;
    if (!this.speaking) {
      // Track the noise floor only while nobody is talking.
      if (!loud) this.noise = this.noise * 0.95 + level * 0.05;
      this.preRoll.push(frame.slice());
      const keep = Math.ceil(o.preRollMs / o.frameMs);
      if (this.preRoll.length > keep) this.preRoll.shift();
      this.loudMs = loud ? this.loudMs + o.frameMs : 0;
      if (this.loudMs >= o.startMs) {
        this.speaking = true;
        this.chunks = this.preRoll;
        this.preRoll = [];
        this.startedAt = this.clock - this.chunks.length * o.frameMs;
        this.leadMs = Math.max(0, this.chunks.length * o.frameMs - this.loudMs); // silent pre-roll
        this.quietMs = 0;
        this.floor = level;
      }
      return;
    }
    this.chunks.push(frame.slice());
    this.quietMs = loud ? 0 : this.quietMs + o.frameMs;
    this.floor = Math.min(this.floor, level);
    const length = this.clock - this.startedAt;
    if (length >= o.maxUtteranceMs) {
      // Speech dips to room level between words; a sound that never dipped for this long is
      // background noise (a fan, music), so treat its quietest level as the new noise floor.
      this.noise = Math.max(this.noise, this.floor);
      this.flush();
    } else if (this.quietMs >= o.endMs) {
      this.flush();
    }
  }

  /** Close the current utterance (also call when the mic stops). */
  flush() {
    if (!this.speaking) return;
    const { o } = this;
    const total = this.chunks.length * this.frameSize;
    const audio = new Float32Array(total);
    this.chunks.forEach((chunk, i) => audio.set(chunk, i * this.frameSize));
    const speechMs = this.chunks.length * o.frameMs - this.quietMs - this.leadMs;
    this.speaking = false;
    this.chunks = [];
    this.loudMs = 0;
    this.quietMs = 0;
    if (speechMs >= o.minUtteranceMs) {
      this.onUtterance({ audio, startMs: this.startedAt, endMs: this.clock });
    }
  }
}
