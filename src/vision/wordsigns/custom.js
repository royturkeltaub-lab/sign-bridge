// "Teach" signs the model has no class for: nearest-prototype matching on the model's 128-d
// embedding. Pure; runs in Node and the browser. Follows GestureSign (MIT, (c) 2026 Shashank
// Yadav) web/src/ml/prototypes.ts, with open-set thresholds chosen on our own DEV clips.

export const MAX_EXAMPLES = 5;
export const MAX_NAME_LENGTH = 40;

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** Normalised mean of the (normalised) example embeddings. */
export function prototypeOf(examples) {
  const dim = examples[0].length;
  const mean = new Float64Array(dim);
  for (const e of examples) {
    const norm = Math.hypot(...e) || 1;
    for (let i = 0; i < dim; i++) mean[i] += e[i] / norm;
  }
  const norm = Math.hypot(...mean) || 1;
  return Float32Array.from(mean, (v) => v / norm);
}

/** The signs a user has taught: name -> up to MAX_EXAMPLES embeddings. */
export class CustomSigns {
  constructor() {
    this.signs = new Map(); // name -> { examples: Float32Array[], prototype: Float32Array }
  }

  get size() {
    return this.signs.size;
  }

  /** Add one example embedding for `name` (the oldest is dropped beyond MAX_EXAMPLES). Returns the example count. */
  add(name, embedding) {
    const key = String(name).trim().slice(0, MAX_NAME_LENGTH);
    if (!key) throw new Error('A custom sign needs a name');
    const entry = this.signs.get(key) ?? { examples: [] };
    entry.examples = [...entry.examples, Float32Array.from(embedding)].slice(-MAX_EXAMPLES);
    entry.prototype = prototypeOf(entry.examples);
    this.signs.set(key, entry);
    return entry.examples.length;
  }

  remove(name) {
    return this.signs.delete(name);
  }

  clear() {
    this.signs.clear();
  }

  /** [{ name, examples }] in the order taught. */
  list() {
    return [...this.signs].map(([name, entry]) => ({ name, examples: entry.examples.length }));
  }

  /**
   * Best custom sign for an embedding: { name, similarity, runnerUp } (runnerUp = second-best
   * similarity, -1 if there is no other sign), or null when nothing has been taught.
   */
  match(embedding) {
    let best = null;
    let runnerUp = -1;
    for (const [name, entry] of this.signs) {
      const similarity = cosine(embedding, entry.prototype);
      if (!best || similarity > best.similarity) {
        if (best) runnerUp = best.similarity;
        best = { name, similarity };
      } else if (similarity > runnerUp) {
        runnerUp = similarity;
      }
    }
    return best ? { ...best, runnerUp } : null;
  }

  /** Plain JSON for localStorage: { version, dim, signs: [{ name, examples: number[][] }] }. */
  export() {
    const signs = [...this.signs].map(([name, entry]) => ({
      name,
      examples: entry.examples.map((e) => Array.from(e, (v) => Math.round(v * 1e5) / 1e5)),
    }));
    return { version: 1, dim: signs[0]?.examples[0]?.length ?? 0, signs };
  }

  /** Load what export() produced (object or JSON string); replaces the current signs. Returns the count. */
  import(data, dim) {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    if (!parsed || !Array.isArray(parsed.signs)) throw new Error('Not a custom-sign export');
    const next = new Map();
    for (const sign of parsed.signs) {
      if (typeof sign?.name !== 'string' || !Array.isArray(sign.examples)) continue;
      const examples = sign.examples
        .filter((e) => Array.isArray(e) && e.length > 0 && (!dim || e.length === dim) && e.every(Number.isFinite))
        .slice(-MAX_EXAMPLES)
        .map((e) => Float32Array.from(e));
      if (!examples.length) continue;
      next.set(sign.name.trim().slice(0, MAX_NAME_LENGTH), { examples, prototype: prototypeOf(examples) });
    }
    this.signs = next;
    return next.size;
  }
}
