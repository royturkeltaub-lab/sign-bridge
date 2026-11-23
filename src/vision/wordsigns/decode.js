// Model logits -> probabilities and best guesses. Pure; runs in Node and the browser.
// (What is reported and what is withheld is decided in phrase.js.)

/** Softmax of logits / temperature (numerically stable). */
export function softmax(logits, temperature = 1) {
  const out = new Float64Array(logits.length);
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) max = Math.max(max, logits[i] / temperature);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    out[i] = Math.exp(logits[i] / temperature - max);
    sum += out[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= sum;
  return out;
}

/** The k most probable classes, best first: [{ index, p }]. */
export function topK(probs, k = 3) {
  const best = [];
  for (let i = 0; i < probs.length; i++) {
    if (best.length === k && probs[i] <= best[k - 1].p) continue;
    best.push({ index: i, p: probs[i] });
    best.sort((a, b) => b.p - a.p);
    if (best.length > k) best.pop();
  }
  return best;
}

/** Read labels.json ({ signs: [{ index, sign }] }) into a gloss array ordered by class index. */
export function glossesFromLabels(labels) {
  const out = [];
  for (const s of labels.signs) out[s.index] = s.label ?? s.sign;
  return out;
}
