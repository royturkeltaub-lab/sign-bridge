// Forward-kinematic hand model: handshape (joint angles) -> 21 landmarks laid out exactly
// like MediaPipe Hands, so rendered signs and camera detections share one representation.
//
// Local hand frame (right hand): +Y along the extended fingers, +X towards the thumb side,
// +Z out of the palm. Unit = roughly the wrist -> middle-knuckle distance.
import { add, scale, norm, rotateToward, cross, sub, len, lerp, deg2rad } from './vec.js';
import { getHandshape, FINGER_NAMES } from './handshapes.js';

// MediaPipe landmark indices.
export const LM = {
  WRIST: 0,
  THUMB: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};
const JOINT_OFFSET = { mcp: 0, pip: 1, dip: 2, tip: 3 };

const KNUCKLE = {
  index: [0.34, 1.0, 0],
  middle: [0.1, 1.05, 0],
  ring: [-0.13, 1.0, 0],
  pinky: [-0.35, 0.88, 0],
};
const SEGMENTS = {
  index: [0.45, 0.27, 0.22],
  middle: [0.5, 0.3, 0.23],
  ring: [0.46, 0.28, 0.22],
  pinky: [0.36, 0.2, 0.19],
};
const THUMB_BASE = [0.22, 0.12, 0.06];
const THUMB_SEGMENTS = [0.47, 0.34, 0.29];

const Z = [0, 0, 1];

/** Joint positions [mcp, pip, dip, tip] for one finger. */
function fingerChain(name, pose) {
  const [mcp, pip, dip, abd = 0] = pose;
  const a = deg2rad(abd);
  const u = [Math.sin(a), Math.cos(a), 0]; // direction when straight
  const points = [KNUCKLE[name]];
  let flex = 0;
  const flexes = [mcp, pip, dip];
  for (let i = 0; i < 3; i++) {
    flex += flexes[i];
    const r = deg2rad(flex);
    const d = add(scale(u, Math.cos(r)), scale(Z, Math.sin(r)));
    points.push(add(points[i], scale(d, SEGMENTS[name][i])));
  }
  return points;
}

/** Thumb positions [cmc, mcp, ip, tip] for an explicit pose. */
function thumbExplicit(pose) {
  let d = norm(pose.dir);
  const points = [THUMB_BASE, add(THUMB_BASE, scale(d, THUMB_SEGMENTS[0]))];
  for (let i = 0; i < 2; i++) {
    d = rotateToward(d, pose.toward, pose.bend[i]);
    points.push(add(points[i + 1], scale(d, THUMB_SEGMENTS[i + 1])));
  }
  return points;
}

/** Thumb positions when the thumb tip reaches for a finger joint (two-bone IK). */
function thumbTouch(pose, chains) {
  const chain = chains[pose.touch];
  const joint = chain[JOINT_OFFSET[pose.joint || 'tip']];
  // Aim slightly in front of the joint, on the palm side, so the pads meet rather than overlap.
  const target = add(joint, [0.03, -0.02, 0.05]);
  const [l1, l2] = [THUMB_SEGMENTS[1], THUMB_SEGMENTS[2]];
  // Start from a relaxed base bone and swing it towards the target until the tip can reach.
  const relaxed = norm([0.5, 0.58, 0.64]);
  const aim = norm(sub(target, THUMB_BASE));
  let mcp = add(THUMB_BASE, scale(relaxed, THUMB_SEGMENTS[0]));
  for (let w = 0.1; w <= 1 && len(sub(target, mcp)) > (l1 + l2) * 0.97; w += 0.1) {
    mcp = add(THUMB_BASE, scale(norm(lerp(relaxed, aim, w)), THUMB_SEGMENTS[0]));
  }
  const toTarget = sub(target, mcp);
  const d = len(toTarget);
  const dir = norm(toTarget);
  if (d >= l1 + l2 - 1e-6) {
    const ip = add(mcp, scale(dir, l1));
    return [THUMB_BASE, mcp, ip, add(ip, scale(dir, l2))];
  }
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  // Bend the knuckle outwards (away from the fingers).
  const pole = [0.7, -0.2, 0.6];
  let perp = sub(pole, scale(dir, pole[0] * dir[0] + pole[1] * dir[1] + pole[2] * dir[2]));
  perp = len(perp) < 1e-6 ? [1, 0, 0] : norm(perp);
  const ip = add(add(mcp, scale(dir, along)), scale(perp, height));
  return [THUMB_BASE, mcp, ip, target];
}

const cache = new Map();

/**
 * 21 landmarks in the local hand frame for a named handshape (or a handshape object).
 * @returns {number[][]} landmarks indexed like MediaPipe Hands
 */
export function localLandmarks(shapeOrName) {
  const key = typeof shapeOrName === 'string' ? shapeOrName : null;
  if (key && cache.has(key)) return cache.get(key);
  const shape = key ? getHandshape(key) : shapeOrName;
  const chains = {};
  for (const name of FINGER_NAMES) chains[name] = fingerChain(name, shape.fingers[name]);
  const thumb = shape.thumb.touch ? thumbTouch(shape.thumb, chains) : thumbExplicit(shape.thumb);
  const out = new Array(21);
  out[LM.WRIST] = [0, 0, 0];
  thumb.forEach((p, i) => (out[LM.THUMB[i]] = p));
  for (const name of FINGER_NAMES) chains[name].forEach((p, i) => (out[LM[name][i]] = p));
  if (key) cache.set(key, out);
  return out;
}

/** Blend two landmark sets (used to animate between handshapes). */
export function blendLandmarks(a, b, t) {
  return a.map((p, i) => lerp(p, b[i], t));
}

/**
 * Basis for a hand whose extended fingers point along `finger` and whose palm faces `palm`.
 * For the right hand thumb-side = finger x palm; the left hand is its mirror image.
 */
export function handBasis(finger, palm, hand = 'right') {
  const y = norm(finger);
  // Make the palm normal exactly perpendicular to the finger direction.
  let z = sub(palm, scale(y, palm[0] * y[0] + palm[1] * y[1] + palm[2] * y[2]));
  z = len(z) < 1e-6 ? norm(cross(y, [0, 1, 0.01])) : norm(z);
  let x = cross(y, z);
  if (hand === 'left') x = scale(x, -1);
  return { x, y, z };
}

/** Place local landmarks in the world: rotate into the basis, scale and move to the wrist position. */
export function placeLandmarks(local, basis, wrist = [0, 0, 0], size = 1) {
  return local.map((p) => [
    wrist[0] + size * (p[0] * basis.x[0] + p[1] * basis.y[0] + p[2] * basis.z[0]),
    wrist[1] + size * (p[0] * basis.x[1] + p[1] * basis.y[1] + p[2] * basis.z[1]),
    wrist[2] + size * (p[0] * basis.x[2] + p[1] * basis.y[2] + p[2] * basis.z[2]),
  ]);
}

/**
 * Convenience: landmarks for a handshape in a given orientation, in "signer" coordinates
 * (x to the viewer's right, y up, z towards the viewer).
 */
export function poseLandmarks(shapeName, { finger = [0, 1, 0], palm = [0, 0, 1], hand = 'right' } = {}) {
  return placeLandmarks(localLandmarks(shapeName), handBasis(finger, palm, hand));
}

/**
 * Convert signer-space landmarks to MediaPipe-style image landmarks, as if a camera were
 * looking at the signer: x right, y DOWN, z negative towards the camera.
 */
export function toImageSpace(landmarks) {
  return landmarks.map(([x, y, z]) => ({ x, y: -y, z: -z }));
}
