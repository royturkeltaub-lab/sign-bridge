// Whisper speech recognition with spoken-language identification. Shared by the browser
// worker and the Node audio eval: the caller passes in the transformers.js module.
//
// transformers.js does not detect the language itself (it silently assumes English), so it is
// done here in two stages:
//   1. One decoder step after <|startoftranscript|> compares the candidate language tokens.
//      A clear winner is transcribed straight away.
//   2. When the two best languages are close (short Hebrew phrases, accented English), the clip
//      is transcribed in both and the language-token score is combined with how confident each
//      transcript is (mean token log-probability). A transcript written in the wrong alphabet
//      for its language (Hebrew requested, Latin letters produced) is ruled out.
// The audio is encoded once and the encoder output is reused for every decoder pass.
//
// The constants below were chosen on evals/audio (synthetic voices only); see scripts/eval-audio.js.

export const ASR_MODELS = {
  base: 'onnx-community/whisper-base', // ~80-200 MB download, fastest
  small: 'onnx-community/whisper-small', // ~250-590 MB, clearly better Hebrew
};

/** Language-token logit gap under which both languages are transcribed and compared. */
const AMBIGUOUS_GAP = 6;
/** Weight of a transcript's mean token log-probability against the language-token logit. */
const TEXT_WEIGHT = 6;
/** Logits added to the language of the previous utterance when the caller passes `prior`. */
const PRIOR_WEIGHT = 2;
/** Score penalty for a transcript that is mostly in another alphabet than its language uses. */
const WRONG_SCRIPT_PENALTY = 100;
/** Decoder length cap: generous for real speech, stops repetition loops on bad decodes. */
const maxTokens = (seconds) => Math.min(440, 24 + Math.ceil(seconds * 15));
const SAMPLE_RATE = 16000;
/** Faint noise added before and after the clip (seconds, amplitude); see padWithNoise. */
const PAD_SECONDS = 0.5;
const PAD_LEVEL = 0.002;
const MAX_SECONDS = 30; // Whisper's window

/** Unicode script each language is written in (languages not listed skip the alphabet check). */
const SCRIPTS = { en: 'Latin', es: 'Latin', fr: 'Latin', de: 'Latin', he: 'Hebrew', ar: 'Arabic', ru: 'Cyrillic' };
const ANY_LETTER = /\p{L}/gu;
const scriptPattern = (lang) => (SCRIPTS[lang] ? new RegExp(`\\p{Script=${SCRIPTS[lang]}}`, 'gu') : null);

/** False when the text has letters and most of them are not in the language's alphabet. */
export function matchesScript(text, lang) {
  const pattern = scriptPattern(lang);
  const letters = (text.match(ANY_LETTER) || []).length;
  if (!pattern || !letters) return true;
  return (text.match(pattern) || []).length * 2 >= letters;
}

/**
 * @param {object} lib the transformers.js module ({ pipeline, Tensor, LogitsProcessorList })
 * @param {string} model model id
 * @param {{device?: string, dtype?: any, onProgress?: Function}} options
 */
export async function loadWhisper(lib, model, { device, dtype, onProgress } = {}) {
  const asr = await lib.pipeline('automatic-speech-recognition', model, {
    device,
    dtype,
    progress_callback: onProgress,
  });
  // generate() only forwards the inputs named here; listing `encoder_outputs` lets it reuse
  // an encoding instead of re-running the encoder (the slowest part) for every decoder pass.
  if (!asr.model.forward_params.includes('encoder_outputs')) {
    asr.model.forward_params = [...asr.model.forward_params, 'encoder_outputs'];
  }
  return { asr, lib, reuseEncoder: true };
}

/**
 * Surround the clip with half a second of faint noise. Whisper was trained on recordings with
 * a little room tone around the speech; a clip that starts and ends hard against digital
 * silence loses words at its edges (measured on the Hebrew eval clips). The noise is fixed,
 * so results are repeatable.
 */
function padWithNoise(audio) {
  const pad = Math.round(PAD_SECONDS * SAMPLE_RATE);
  if (audio.length + 2 * pad > MAX_SECONDS * SAMPLE_RATE) return audio;
  const out = new Float32Array(audio.length + 2 * pad);
  out.set(audio, pad);
  let seed = 1;
  for (const start of [0, pad + audio.length]) {
    for (let i = start; i < start + pad; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      out[i] = (seed / 2147483648 - 1) * PAD_LEVEL;
    }
  }
  return out;
}

/** Run the encoder once, plus the single decoder step that scores the language tokens. */
async function encode(whisper, audio) {
  const { asr, lib } = whisper;
  const { model, processor } = asr;
  const { input_features } = await processor(padWithNoise(audio));
  let encoder_outputs;
  if (whisper.reuseEncoder) {
    try {
      const out = await model.sessions.model.run({ input_features: input_features.ort_tensor });
      encoder_outputs = new lib.Tensor(out.last_hidden_state);
    } catch (err) {
      // Unexpected runtime layout: fall back to letting the library encode on every pass.
      console.warn('Whisper encoder reuse unavailable, encoding per pass instead', err);
      whisper.reuseEncoder = false;
    }
  }
  const start = BigInt(model.generation_config.decoder_start_token_id);
  const decoder_input_ids = new lib.Tensor('int64', BigInt64Array.from([start]), [1, 1]);
  const { logits } = await model(
    encoder_outputs ? { encoder_outputs, decoder_input_ids } : { input_features, decoder_input_ids },
  );
  const vocab = logits.dims.at(-1);
  const languageLogits = logits.data.subarray(logits.data.length - vocab);
  return { input_features, encoder_outputs, languageLogits, seconds: audio.length / SAMPLE_RATE };
}

/** Candidate languages with their language-token logit (plus the prior), best first. */
function rankLanguages(whisper, encoded, candidates, { prior, priorWeight = PRIOR_WEIGHT } = {}) {
  const ids = whisper.asr.model.generation_config.lang_to_id;
  return candidates
    .map((lang) => ({ lang, score: encoded.languageLogits[ids[`<|${lang}|>`]] + (lang === prior ? priorWeight : 0) }))
    .sort((a, b) => b.score - a.score);
}

/** Scores → probabilities (softmax), keeping the order. */
function toProbabilities(ranked) {
  const max = Math.max(...ranked.map((r) => r.score));
  const weights = ranked.map((r) => Math.exp(r.score - max));
  const total = weights.reduce((a, b) => a + b, 0);
  return ranked.map((r, i) => ({ lang: r.lang, p: weights[i] / total }));
}

/**
 * Probability of each candidate language for an audio clip, from the language token alone.
 * @param {Float32Array} audio 16 kHz mono
 * @param {string[]} candidates ISO codes Whisper knows, e.g. ['en', 'he']
 * @param {{prior?: string, priorWeight?: number}} [options]
 * @returns {Promise<Array<{lang: string, p: number}>>} sorted, most likely first
 */
export async function detectLanguage(whisper, audio, candidates, options = {}) {
  const encoded = await encode(whisper, audio);
  return toProbabilities(rankLanguages(whisper, encoded, candidates, options));
}

/** Log-probability of `token` under the logits of one decoding step. */
function logProbability(logits, token) {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  let sum = 0;
  for (let i = 0; i < logits.length; i++) sum += Math.exp(logits[i] - max);
  return logits[token] - max - Math.log(sum);
}

/** Greedy transcript in one language, with the mean log-probability of its tokens. */
async function decode(whisper, encoded, language) {
  const { asr, lib } = whisper;
  const logProbs = [];
  let pending = null; // logits of the step whose chosen token is not known yet
  const settle = (token) => {
    if (pending) logProbs.push(logProbability(pending, token));
    pending = null;
  };
  const recorder = new lib.LogitsProcessorList();
  recorder.push((input_ids, logits) => {
    settle(Number(input_ids[0].at(-1)));
    pending = logits.data;
    return logits;
  });
  const output = await asr.model.generate({
    inputs: encoded.input_features,
    ...(encoded.encoder_outputs ? { encoder_outputs: encoded.encoder_outputs } : {}),
    language,
    task: 'transcribe',
    logits_processor: recorder,
    max_new_tokens: maxTokens(encoded.seconds),
  });
  const tokens = output.tolist()[0];
  settle(Number(tokens.at(-1)));
  const logProb = logProbs.length ? logProbs.reduce((a, b) => a + b, 0) / logProbs.length : -Infinity;
  const text = cleanTranscript(asr.tokenizer.decode(tokens, { skip_special_tokens: true }));
  return { text, logProb };
}

/**
 * Identify the language and transcribe.
 * @param {object} whisper from loadWhisper
 * @param {Float32Array} audio 16 kHz mono, one utterance (up to 30 s)
 * @param {string[]} candidates ISO codes Whisper knows, e.g. ['en', 'he']
 * @param {{prior?: string, priorWeight?: number}} [options] `prior` is the language of the
 *   previous utterance in the same conversation; it nudges close calls towards that language.
 * @returns {Promise<{text: string, language: string, confidence: number, passes: number}>}
 *   `passes` is how many transcripts were decoded (1 when the language was clear, else 2).
 */
export async function transcribe(whisper, audio, candidates, options = {}) {
  const encoded = await encode(whisper, audio);
  const ranked = rankLanguages(whisper, encoded, candidates, options);
  const [best, rival] = ranked;
  const transcripts = new Map();
  // Fold a language's transcript into its score.
  const weigh = async (entry) => {
    const result = await decode(whisper, encoded, entry.lang);
    transcripts.set(entry.lang, result.text);
    entry.score += TEXT_WEIGHT * result.logProb;
    if (!matchesScript(result.text, entry.lang)) entry.score -= WRONG_SCRIPT_PENALTY;
  };

  let confidence = toProbabilities(ranked)[0].p;
  const close = rival && best.score - rival.score < AMBIGUOUS_GAP;
  await weigh(best);
  // Transcribe the runner-up too when the call is close, or when the favourite came out in
  // the wrong alphabet.
  if (rival && (close || !matchesScript(transcripts.get(best.lang), best.lang))) {
    await weigh(rival);
    const pair = [best, rival].sort((a, b) => b.score - a.score);
    confidence = toProbabilities(pair)[0].p;
    return { text: transcripts.get(pair[0].lang), language: pair[0].lang, confidence, passes: 2 };
  }
  return { text: transcripts.get(best.lang), language: best.lang, confidence, passes: 1 };
}

// Whisper describes non-speech as "[MUSIC]" or "(silence)"; those are not words to sign.
const NON_SPEECH = /^\s*(\[.*\]|\(.*\)|\.+)\s*$/;
// Invisible text-direction marks Whisper sometimes puts in front of Hebrew.
const DIRECTION_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export function cleanTranscript(text) {
  const trimmed = String(text || '').replace(DIRECTION_MARKS, '').trim();
  return NON_SPEECH.test(trimmed) ? '' : trimmed;
}
