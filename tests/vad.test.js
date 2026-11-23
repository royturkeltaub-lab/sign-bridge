import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EnergyVAD, VAD_DEFAULTS, rms } from '../src/speech/vad.js';

const RATE = 16000;

/** Deterministic noise in [-1, 1). */
function noiseSource(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
}

/** Tone bursts ({from, to, level} in ms) over background noise. */
function makeAudio(durationMs, bursts = [], noise = 0.003, seed = 1) {
  const random = noiseSource(seed);
  const audio = new Float32Array(Math.round((durationMs / 1000) * RATE));
  for (let i = 0; i < audio.length; i++) {
    const ms = (i / RATE) * 1000;
    const burst = bursts.find((b) => ms >= b.from && ms < b.to);
    audio[i] = random() * noise + (burst ? Math.sin(i * 0.12) * (burst.level ?? 0.2) : 0);
  }
  return audio;
}

/** Run audio through a VAD in chunks; returns the utterances (after a final flush by default). */
function detect(audio, { options = {}, chunk = 1600, flush = true } = {}) {
  const utterances = [];
  const vad = new EnergyVAD({ sampleRate: RATE, ...options }, (u) => utterances.push(u));
  for (let i = 0; i < audio.length; i += chunk) vad.push(audio.subarray(i, i + chunk));
  if (flush) vad.flush();
  return { utterances, vad };
}

describe('rms', () => {
  test('empty input is silent', () => {
    assert.equal(rms([]), 0);
    assert.equal(rms(new Float32Array(0)), 0);
  });

  test('known signals', () => {
    assert.equal(rms(new Float32Array(100)), 0);
    assert.ok(Math.abs(rms(new Float32Array(100).fill(0.5)) - 0.5) < 1e-7);
    assert.ok(Math.abs(rms([3, -4, 3, -4]) - Math.sqrt(12.5)) < 1e-12);
    const sine = Float32Array.from({ length: 16000 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / RATE));
    assert.ok(Math.abs(rms(sine) - 0.3 / Math.SQRT2) < 1e-3);
  });

  test('sign does not matter', () => {
    assert.equal(rms([-0.2, -0.2]), rms([0.2, 0.2]));
  });
});

describe('EnergyVAD utterance boundaries', () => {
  test('one burst of speech is one utterance', () => {
    const { utterances } = detect(makeAudio(4000, [{ from: 500, to: 2000 }]));
    assert.equal(utterances.length, 1);
    const [u] = utterances;
    assert.ok(u.audio instanceof Float32Array);
    // Closed once endMs of silence has followed the speech.
    assert.ok(u.endMs >= 2000 + VAD_DEFAULTS.endMs - 30 && u.endMs <= 2000 + VAD_DEFAULTS.endMs + 60, `endMs ${u.endMs}`);
    assert.equal(u.audio.length, ((u.endMs - u.startMs) / 1000) * RATE);
  });

  test('pre-roll: the utterance starts before the speech was detected', () => {
    const { utterances } = detect(makeAudio(4000, [{ from: 500, to: 2000 }]));
    const [u] = utterances;
    assert.ok(u.startMs < 500, `startMs ${u.startMs} should precede the burst`);
    assert.ok(u.startMs >= 500 + VAD_DEFAULTS.startMs - VAD_DEFAULTS.preRollMs - 30, `startMs ${u.startMs}`);
    // The audio really contains the quiet lead-in followed by the whole burst.
    const leadIn = u.audio.subarray(0, Math.round(((500 - u.startMs) / 1000) * RATE) - 16);
    assert.ok(rms(leadIn) < 0.01, 'lead-in should be background noise');
    const onset = Math.round(((500 - u.startMs) / 1000) * RATE);
    assert.ok(rms(u.audio.subarray(onset, onset + 800)) > 0.1, 'burst onset must not be clipped');
    const speech = u.audio.subarray(onset, onset + 1.5 * RATE);
    assert.ok(Math.abs(rms(speech) - 0.2 / Math.SQRT2) < 0.01);
  });

  test('speech at the very start of the stream has a shorter pre-roll but still works', () => {
    const { utterances } = detect(makeAudio(3000, [{ from: 0, to: 1000 }]));
    assert.equal(utterances.length, 1);
    assert.equal(utterances[0].startMs, 0);
  });

  test('bursts separated by a long silence are separate utterances', () => {
    const { utterances } = detect(makeAudio(7000, [{ from: 500, to: 2000 }, { from: 3500, to: 5000 }]));
    assert.equal(utterances.length, 2);
    assert.ok(utterances[0].endMs <= utterances[1].startMs, 'utterances must not overlap');
    assert.ok(utterances[1].startMs < 3500 && utterances[1].startMs > 3000);
  });

  test('a short pause does not split a sentence', () => {
    const { utterances } = detect(makeAudio(5000, [{ from: 500, to: 1500 }, { from: 1800, to: 2800 }]));
    assert.equal(utterances.length, 1);
    assert.ok(utterances[0].endMs >= 2800 + VAD_DEFAULTS.endMs - 30);
  });

  test('background noise alone and digital silence produce nothing', () => {
    assert.equal(detect(makeAudio(5000)).utterances.length, 0);
    assert.equal(detect(new Float32Array(RATE * 3)).utterances.length, 0);
    assert.equal(detect(new Float32Array(0)).utterances.length, 0);
  });

  test('a click shorter than startMs never opens an utterance', () => {
    const { utterances, vad } = detect(makeAudio(3000, [{ from: 1000, to: 1060 }]), { flush: false });
    assert.equal(utterances.length, 0);
    assert.equal(vad.speaking, false);
  });

  test('a 100 ms click is discarded as too short', () => {
    assert.equal(detect(makeAudio(3000, [{ from: 1000, to: 1100 }])).utterances.length, 0);
  });

  // Questionable: the pre-roll (up to 300 ms of silence) is counted as speech when the
  // utterance length is compared with minUtteranceMs (350 ms), so ~150 ms of sound passes.
  test('a 200 ms blip is shorter than minUtteranceMs and is discarded', () => {
    assert.equal(detect(makeAudio(3000, [{ from: 1000, to: 1200 }])).utterances.length, 0);
  });

  test('minUtteranceMs is configurable', () => {
    const audio = makeAudio(3000, [{ from: 1000, to: 1500 }]);
    assert.equal(detect(audio).utterances.length, 1);
    assert.equal(detect(audio, { options: { minUtteranceMs: 2000 } }).utterances.length, 0);
  });

  test('a quiet voice above the floor is still detected; one below it is not', () => {
    assert.equal(detect(makeAudio(3000, [{ from: 500, to: 1500, level: 0.05 }])).utterances.length, 1);
    assert.equal(detect(makeAudio(3000, [{ from: 500, to: 1500, level: 0.008 }])).utterances.length, 0);
  });

  test('continuous speech is cut at maxUtteranceMs', () => {
    // A sound that never dips for the whole limit is cut once, then treated as background
    // noise (its level becomes the noise floor) instead of being cut into endless utterances.
    const audio = makeAudio(10000, [{ from: 0, to: 10000 }]);
    const { utterances, vad } = detect(audio, { options: { maxUtteranceMs: 3000 } });
    assert.equal(utterances.length, 1, `got ${utterances.length} utterances`);
    assert.ok(utterances[0].endMs - utterances[0].startMs <= 3000 + VAD_DEFAULTS.frameMs);
    assert.ok(utterances[0].endMs - utterances[0].startMs >= 3000 - VAD_DEFAULTS.frameMs);
    assert.ok(vad.noise > VAD_DEFAULTS.minLevel, 'steady sound raised the noise floor');
    // Default limit: 12 s.
    const long = detect(makeAudio(20000, [{ from: 200, to: 20000 }])).utterances;
    assert.ok(long[0].endMs - long[0].startMs <= VAD_DEFAULTS.maxUtteranceMs + VAD_DEFAULTS.frameMs);
  });

  test('flush closes an utterance that is still open', () => {
    const audio = makeAudio(1500, [{ from: 500, to: 1500 }]);
    const { utterances, vad } = detect(audio, { flush: false });
    assert.equal(utterances.length, 0, 'still speaking: nothing emitted yet');
    assert.equal(vad.speaking, true);
    vad.flush();
    assert.equal(utterances.length, 1);
    assert.equal(vad.speaking, false);
    assert.ok(utterances[0].endMs <= 1500);
    vad.flush();
    assert.equal(utterances.length, 1, 'a second flush emits nothing');
  });

  test('flush on an idle detector does nothing', () => {
    const { utterances, vad } = detect(makeAudio(1000), { flush: false });
    vad.flush();
    vad.flush();
    assert.equal(utterances.length, 0);
  });

  test('the detector can be reused after a flush', () => {
    const utterances = [];
    const vad = new EnergyVAD({ sampleRate: RATE }, (u) => utterances.push(u));
    vad.push(makeAudio(1500, [{ from: 300, to: 1500 }]));
    vad.flush();
    vad.push(makeAudio(3000, [{ from: 500, to: 1500 }], 0.003, 2));
    assert.equal(utterances.length, 2);
    assert.ok(utterances[1].startMs >= utterances[0].endMs);
  });

  test('chunk size does not change the result', () => {
    const audio = makeAudio(7000, [{ from: 500, to: 2000 }, { from: 3500, to: 5000 }]);
    const reference = detect(audio, { chunk: audio.length }).utterances;
    for (const chunk of [1, 127, 480, 481, 1600, 4096]) {
      if (chunk === 1 && audio.length > 200000) continue;
      const { utterances } = detect(chunk === 1 ? audio.subarray(0, 48000) : audio, { chunk });
      const expected = chunk === 1 ? detect(audio.subarray(0, 48000), { chunk: 48000 }).utterances : reference;
      assert.equal(utterances.length, expected.length, `chunk ${chunk}`);
      utterances.forEach((u, i) => {
        assert.equal(u.startMs, expected[i].startMs);
        assert.equal(u.endMs, expected[i].endMs);
        assert.deepEqual(u.audio, expected[i].audio);
      });
    }
  });

  test('a partial trailing frame is kept pending, not processed', () => {
    const vad = new EnergyVAD({ sampleRate: RATE });
    assert.equal(vad.frameSize, 480);
    vad.push(new Float32Array(500));
    assert.equal(vad.clock, 30);
    assert.equal(vad.pending.length, 20);
    vad.push(new Float32Array(460));
    assert.equal(vad.clock, 60);
    assert.equal(vad.pending.length, 0);
  });

  test('frame size follows the sample rate', () => {
    assert.equal(new EnergyVAD({ sampleRate: 48000 }).frameSize, 1440);
    assert.equal(new EnergyVAD({ sampleRate: 8000, frameMs: 20 }).frameSize, 160);
  });
});

describe('EnergyVAD noise floor', () => {
  test('the threshold starts at the absolute floor', () => {
    assert.equal(new EnergyVAD().threshold, VAD_DEFAULTS.minLevel);
  });

  test('the threshold rises in a noisy room and never drops below the floor', () => {
    // Uniform noise of amplitude a has RMS a / sqrt(3): about 0.008 here.
    const noisy = detect(makeAudio(4000, [], 0.008 * Math.sqrt(3)), { flush: false });
    assert.equal(noisy.utterances.length, 0);
    assert.ok(Math.abs(noisy.vad.noise - 0.008) < 0.001, `noise floor ${noisy.vad.noise}`);
    assert.ok(noisy.vad.threshold > 0.02);
    const quiet = detect(new Float32Array(RATE * 4), { flush: false });
    assert.equal(quiet.vad.threshold, VAD_DEFAULTS.minLevel);
  });

  test('a sound that passes in a quiet room is ignored once the room is noisy', () => {
    const burst = [{ from: 4000, to: 5000, level: 0.025 }];
    assert.equal(detect(makeAudio(7000, burst, 0.001)).utterances.length, 1);
    assert.equal(detect(makeAudio(7000, burst, 0.008 * Math.sqrt(3))).utterances.length, 0);
    // ...while a clearly louder voice still gets through.
    const loud = [{ from: 4000, to: 5000, level: 0.2 }];
    assert.equal(detect(makeAudio(7000, loud, 0.008 * Math.sqrt(3))).utterances.length, 1);
  });

  test('the noise floor is frozen while someone is speaking', () => {
    const vad = new EnergyVAD({ sampleRate: RATE });
    vad.push(makeAudio(1000));
    const before = vad.noise;
    vad.push(makeAudio(2000, [{ from: 0, to: 2000 }], 0.003, 5));
    assert.equal(vad.speaking, true);
    assert.ok(Math.abs(vad.noise - before) < 1e-4);
  });

  test('level reports the RMS of the latest frame', () => {
    const vad = new EnergyVAD({ sampleRate: RATE });
    vad.push(new Float32Array(480).fill(0.25));
    assert.ok(Math.abs(vad.level - 0.25) < 1e-6);
    vad.push(new Float32Array(480));
    assert.equal(vad.level, 0);
  });
});
