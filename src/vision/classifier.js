// Handshape classifier: k-nearest-neighbours over hand feature vectors.
//
// Prototypes are labelled with a *class key* ("shape|orientation", see classKey), not with
// a letter, so one prototype set serves every sign language: each language maps its own
// letters onto class keys. kNN needs no training step, so new samples (another dataset, or
// ones a user records in the app) can be added at any time.
import { handFeatures } from './features.js';

const ORIENTATION_TOLERANCE = 0.25;
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= ORIENTATION_TOLERANCE);
const UP = [0, 1, 0];
const OUT = [0, 0, 1];

/** Stable key for a letter's static appearance: handshape + coarse orientation. */
export function classKey(def) {
  const finger = def.finger || UP;
  const palm = def.palm || OUT;
  if (near(finger, UP) && near(palm, OUT)) return def.shape;
  const q = (v) => v.map((n) => Math.round(n * 2) / 2).join(',');
  return `${def.shape}|${q(finger)}|${q(palm)}`;
}

/**
 * Class key -> letter for a sign language alphabet. Letters that share an appearance
 * (a base letter and its moving variant) resolve to the first, static one.
 */
export function alphabetClasses(alphabet) {
  const map = new Map();
  const entries = Object.entries(alphabet).sort((a, b) => Number(Boolean(a[1].path)) - Number(Boolean(b[1].path)));
  for (const [letter, def] of entries) {
    const key = classKey(def);
    if (!map.has(key)) map.set(key, letter);
  }
  return map;
}

// Familiarity ramp used when the model carries no calibration of its own: nearest-prototype
// distance (RMS per feature) at which a hand is fully / not at all "a known handshape".
const DEFAULT_FAMILIARITY = { near: 0.8, far: 1.6 };

export class HandshapeClassifier {
  /**
   * @param {{mean: number[], std: number[], weights?: number[], projection?: number[][],
   *   familiarity?: {near: number, far: number},
   *   prototypes: Array<{key: string, f: number[], source?: string}>}} model
   *   `projection` (optional) is a linear map applied after standardisation; build-model.js
   *   fits one that evens out how much each direction varies within a handshape.
   */
  constructor(model, { k = 5 } = {}) {
    this.k = k;
    this.mean = model.mean;
    this.std = model.std;
    this.weights = model.weights || null;
    this.projection = model.projection ? model.projection.map((row) => Float32Array.from(row)) : null;
    this.familiarity = model.familiarity || DEFAULT_FAMILIARITY;
    this.scratch = new Float32Array(this.mean.length);
    this.prototypes = model.prototypes.map((p) => ({ ...p, v: this.standardize(p.f) }));
    this.active = this.prototypes;
    this.letters = null;
  }

  standardize(f) {
    const n = this.mean.length;
    const scaled = this.projection ? this.scratch : new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const w = this.weights ? this.weights[i] : 1;
      scaled[i] = ((f[i] - this.mean[i]) / (this.std[i] || 1)) * w;
    }
    if (!this.projection) return scaled;
    const out = new Float32Array(this.projection.length);
    for (let r = 0; r < out.length; r++) {
      const row = this.projection[r];
      let sum = 0;
      for (let i = 0; i < n; i++) sum += row[i] * scaled[i];
      out[r] = sum;
    }
    return out;
  }

  /** Restrict predictions to one sign language's alphabet. */
  useAlphabet(alphabet) {
    this.letters = alphabetClasses(alphabet);
    this.active = this.prototypes.filter((p) => this.letters.has(p.key));
    return [...this.letters.keys()].filter((key) => !this.active.some((p) => p.key === key));
  }

  /** Add a sample at runtime (e.g. one the user just recorded). */
  addSample(key, features, source = 'user') {
    if (features.length !== this.mean.length) return;
    const proto = { key, f: features, source, v: this.standardize(features) };
    this.prototypes.push(proto);
    if (!this.letters || this.letters.has(key)) this.active.push(proto);
  }

  /**
   * @param {number[]} features output of handFeatures()
   * @returns {{key: string, label: string, confidence: number, distance: number}|null}
   *   confidence: share of the (distance-weighted) vote won by `key`, scaled down when the
   *   hand is far from every prototype; distance: RMS per-feature distance to the nearest one.
   */
  predictFeatures(features) {
    // A model built for a different feature layout cannot be compared with these features.
    if (!this.active.length || features.length !== this.mean.length) return null;
    const v = this.standardize(features);
    const n = v.length;
    const k = Math.min(this.k, this.active.length);
    const dists = new Float64Array(k).fill(Infinity); // ascending
    const keys = new Array(k);
    for (const proto of this.active) {
      const pv = proto.v;
      const worst = dists[k - 1];
      let d = 0;
      for (let i = 0; i < n && d < worst; i += 4) {
        const a = v[i] - pv[i];
        const b = i + 1 < n ? v[i + 1] - pv[i + 1] : 0;
        const c = i + 2 < n ? v[i + 2] - pv[i + 2] : 0;
        const e = i + 3 < n ? v[i + 3] - pv[i + 3] : 0;
        d += a * a + b * b + c * c + e * e;
      }
      if (d >= worst) continue;
      let pos = k - 1;
      while (pos > 0 && dists[pos - 1] > d) {
        dists[pos] = dists[pos - 1];
        keys[pos] = keys[pos - 1];
        pos--;
      }
      dists[pos] = d;
      keys[pos] = proto.key;
    }
    // Inverse-square distance votes: close prototypes count far more than distant ones.
    const votes = new Map();
    let total = 0;
    for (let i = 0; i < k; i++) {
      const w = 1 / (dists[i] + 1e-3);
      votes.set(keys[i], (votes.get(keys[i]) || 0) + w);
      total += w;
    }
    let key = null;
    let top = 0;
    for (const [candidate, w] of votes) {
      if (w > top) {
        top = w;
        key = candidate;
      }
    }
    const distance = Math.sqrt(dists[0] / n);
    // Far from every prototype means "not a letter", whatever the vote says.
    const { near, far } = this.familiarity;
    const familiarity = Math.max(0, Math.min(1, (far - distance) / (far - near)));
    return {
      key,
      label: this.letters ? this.letters.get(key) : key,
      confidence: (top / total) * familiarity,
      distance,
    };
  }

  /** Classify MediaPipe landmarks. `options` are handFeatures() options (aspect, hint). */
  predict(landmarks, options = {}) {
    return this.predictFeatures(handFeatures(landmarks, options));
  }
}

/** Compute per-feature mean / std for a prototype set. */
export function fitScaler(prototypes) {
  const n = prototypes.length;
  const dim = prototypes[0].f.length;
  const mean = new Array(dim).fill(0);
  const std = new Array(dim).fill(0);
  for (const p of prototypes) for (let i = 0; i < dim; i++) mean[i] += p.f[i] / n;
  for (const p of prototypes) for (let i = 0; i < dim; i++) std[i] += (p.f[i] - mean[i]) ** 2 / n;
  // Features that are constant by construction (a palm-frame axis, say) carry only
  // rounding noise: leave them unscaled instead of blowing that noise up.
  return { mean, std: std.map((v) => (Math.sqrt(v) > 1e-6 ? Math.sqrt(v) : 1)) };
}

/** Eigen-decomposition of a symmetric matrix (cyclic Jacobi): { values, vectors as columns }. */
function symmetricEigen(matrix, sweeps = 60) {
  const n = matrix.length;
  const a = matrix.map((row) => Float64Array.from(row));
  const v = a.map((_, i) => Float64Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
  const rotate = (m, p, q, c, s, columns) => {
    for (let i = 0; i < n; i++) {
      const x = columns ? m[i][p] : m[p][i];
      const y = columns ? m[i][q] : m[q][i];
      if (columns) [m[i][p], m[i][q]] = [c * x - s * y, s * x + c * y];
      else [m[p][i], m[q][i]] = [c * x - s * y, s * x + c * y];
    }
  };
  for (let sweep = 0; sweep < sweeps; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = (theta < 0 ? -1 : 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        rotate(a, p, q, c, s, true);
        rotate(a, p, q, c, s, false);
        rotate(v, p, q, c, s, true);
      }
    }
  }
  return { values: a.map((row, i) => row[i]), vectors: v };
}

/**
 * Fit the classifier's `projection`: a whitening of the pooled within-class scatter, so
 * that directions in which samples of one handshape vary a lot (noisy depth, wrist turn)
 * count for less than directions in which a handshape is stable. `shrink` blends the
 * scatter towards a plain sphere, which keeps poorly estimated directions in check.
 * @param {Array<{key: string, f: number[]}>} prototypes
 * @param {{mean: number[], std: number[]}} scaler from fitScaler()
 * @returns {number[][]} matrix rows, for model.projection
 */
export function fitProjection(prototypes, scaler, { shrink = 0.3 } = {}) {
  const dim = scaler.mean.length;
  const groups = new Map();
  for (const p of prototypes) {
    const v = p.f.map((x, i) => (x - scaler.mean[i]) / (scaler.std[i] || 1));
    if (!groups.has(p.key)) groups.set(p.key, []);
    groups.get(p.key).push(v);
  }
  const scatter = Array.from({ length: dim }, () => new Float64Array(dim));
  let count = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const centre = new Float64Array(dim);
    for (const v of list) for (let i = 0; i < dim; i++) centre[i] += v[i] / list.length;
    for (const v of list) {
      count++;
      for (let i = 0; i < dim; i++) {
        const di = v[i] - centre[i];
        for (let j = 0; j < dim; j++) scatter[i][j] += di * (v[j] - centre[j]);
      }
    }
  }
  const identity = (i, j) => (i === j ? 1 : 0);
  if (!count) return scatter.map((_, i) => Array.from({ length: dim }, (__, j) => identity(i, j)));
  let trace = 0;
  for (let i = 0; i < dim; i++) trace += scatter[i][i] / count;
  const average = trace / dim || 1;
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) scatter[i][j] = (scatter[i][j] / count) * (1 - shrink) + shrink * average * identity(i, j);
  }
  const { values, vectors } = symmetricEigen(scatter);
  // Symmetric inverse square root, scaled so an average direction keeps its length.
  const gain = values.map((value) => 1 / Math.sqrt(Math.max(value, 1e-9) / average));
  return scatter.map((_, i) =>
    Array.from({ length: dim }, (__, j) => {
      let sum = 0;
      for (let m = 0; m < dim; m++) sum += vectors[i][m] * gain[m] * vectors[j][m];
      return sum;
    }),
  );
}
