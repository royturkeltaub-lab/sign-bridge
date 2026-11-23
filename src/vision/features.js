// Hand landmarks (MediaPipe layout, 21 points) -> a feature vector for handshape
// classification. The same function is used for camera frames, dataset samples and
// landmarks synthesised from the avatar's hand model, so all three are comparable.
//
// Input points are { x, y, z } in image-like coordinates: x right, y DOWN, z negative
// towards the camera, with x and y normalised to 0..1 by the image width and height.
// Features are invariant to position, size and left/right hand, but keep the hand's
// orientation, which several letters depend on (G vs Q, K vs P, ...).
import { sub, norm, cross, dot, len, scale } from '../core/vec.js';

const WRIST = 0;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;
const TIPS = [4, 8, 12, 16, 20];
const FINGERS = [
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];
const CHIRALITY_MARGIN = 0.12;
// Joints the thumb tip is measured against: index / middle / ring knuckle, middle and end
// joints, and the pinky's knuckle and middle joint.
const THUMB_TARGETS = [5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18];
// Depth (z) is stretched relative to x and y before anything else: an empirical setting,
// cross-validated on the real training samples (1.5 beat 1, 2 and 3).
const DEPTH_SCALE = 1.5;

/** Palm frame assuming a right hand: y along the fingers, z out of the palm, x to the thumb side. */
export function palmFrame(points) {
  const y = norm(sub(points[MIDDLE_MCP], points[WRIST]));
  const across = sub(points[INDEX_MCP], points[PINKY_MCP]); // towards the thumb side
  const z = norm(cross(across, y));
  const x = norm(cross(y, z));
  return { x, y, z };
}

/**
 * Which hand the landmarks look like, judged from the geometry alone: fingers and thumb
 * fold towards the palm, which fixes the palm side and therefore left vs right.
 * Returns > 0 for a right hand, < 0 for a left hand; near 0 means "cannot tell" (open hand).
 *
 * Deciding this from the landmarks, rather than trusting a label, keeps training data
 * (which has no labels and mixes hands and mirrored cameras) consistent with live frames.
 */
export function chirality(points) {
  const size = len(sub(points[MIDDLE_MCP], points[WRIST])) || 1e-6;
  const { z } = palmFrame(points);
  let score = 0;
  for (const [mcp, , , tip] of FINGERS) score += dot(sub(points[tip], points[mcp]), z);
  score += 0.5 * dot(sub(points[TIPS[0]], points[WRIST]), z);
  return score / size;
}

/**
 * @param {Array<{x:number,y:number,z:number}>} landmarks 21 points
 * @param {{aspect?: number, hint?: 'left'|'right'}} options
 *   aspect: image width / height, to undo the 0..1 normalisation of x (and z);
 *   hint: used only when the geometry cannot tell left from right.
 * @returns {number[]} feature vector
 */
export function handFeatures(landmarks, { aspect = 1, hint = 'right' } = {}) {
  let points = landmarks.map((p) => [p.x * aspect, p.y, (p.z || 0) * aspect * DEPTH_SCALE]);
  const side = chirality(points);
  const left = Math.abs(side) < CHIRALITY_MARGIN ? hint === 'left' : side < 0;
  // Mirror left hands so one model serves both.
  if (left) points = points.map(([x, y, z]) => [-x, y, z]);
  const size = len(sub(points[MIDDLE_MCP], points[WRIST])) || 1e-6;
  const frame = palmFrame(points);
  const wrist = points[WRIST];
  const dist = (a, b) => len(sub(points[a], points[b])) / size;
  const direction = (from, to) => norm(sub(points[to], points[from]));
  /** Cosine of the angle at joint `b` between its neighbours: -1 straight, towards +1 folded. */
  const bend = (a, b, c) => dot(direction(b, a), direction(b, c));

  const features = [];
  // 1. Landmarks in the palm frame (shape, independent of how the hand is turned).
  const local = [[0, 0, 0]];
  for (let i = 1; i < 21; i++) {
    const v = scale(sub(points[i], wrist), 1 / size);
    local.push([dot(v, frame.x), dot(v, frame.y), dot(v, frame.z)]);
    features.push(local[i][0], local[i][1], local[i][2]);
  }
  // 2. Orientation of the hand in the image: finger direction and palm normal.
  features.push(frame.y[0], frame.y[1], frame.y[2], frame.z[0], frame.z[1], frame.z[2]);
  // 3. Thumb tip to each fingertip, and neighbouring fingertips to each other.
  for (let i = 1; i < 5; i++) features.push(dist(TIPS[0], TIPS[i]));
  for (let i = 1; i < 4; i++) features.push(dist(TIPS[i], TIPS[i + 1]));
  // 4. How curled each finger is: tip-to-knuckle distance over the finger's full length.
  for (const [mcp, pip, dip, tip] of FINGERS) {
    features.push(dist(tip, mcp) / (dist(pip, mcp) + dist(dip, pip) + dist(tip, dip) || 1e-6));
  }
  // 5. Where the thumb tip sits among the fingers (tells M / N / T / S / A / E apart).
  for (const joint of THUMB_TARGETS) features.push(dist(TIPS[0], joint));
  // 6. Joint bends: knuckle, middle and end joint of each finger (D vs X hook), then the thumb.
  for (const [mcp, pip, dip, tip] of FINGERS) {
    features.push(bend(mcp, pip, dip), bend(pip, dip, tip), bend(WRIST, mcp, pip));
  }
  features.push(bend(2, 3, 4), bend(1, 2, 3));
  // 7. Sideways order of neighbouring fingers (index crossed over middle: U vs R).
  features.push(
    local[8][0] - local[12][0],
    local[7][0] - local[11][0],
    local[8][2] - local[12][2],
    local[12][0] - local[16][0],
    local[16][0] - local[20][0],
  );
  // 8. Where the index and middle fingers point in the image (G vs Q, K vs P, Z).
  features.push(...direction(INDEX_MCP, 8), ...direction(MIDDLE_MCP, 12));
  return features;
}

export const FEATURE_COUNT = 60 + 6 + 4 + 3 + 4 + THUMB_TARGETS.length + 14 + 5 + 6;

/** Features for synthetic landmarks given as [x, y, z] arrays in signer space. */
export function featuresFromSignerSpace(landmarks) {
  return handFeatures(landmarks.map(([x, y, z]) => ({ x, y: -y, z: -z })));
}
