// The 543-point frame layout of Kaggle "asl-signs" (MediaPipe Holistic), which the word-sign
// model was trained on: 468 face points, 21 left-hand, 33 pose, 21 right-hand, each x, y, z.
// A frame is a Float32Array of 543 * 3 values with NaN for anything not detected.
// Ported from GestureSign (MIT, (c) 2026 Shashank Yadav), web/src/ml/landmarks.ts.

export const N_FACE = 468;
export const N_HAND = 21;
export const N_POSE = 33;
export const N_POINTS = N_FACE + N_HAND + N_POSE + N_HAND;
export const FRAME_LENGTH = N_POINTS * 3;

export const LEFT_HAND_START = N_FACE;
export const POSE_START = LEFT_HAND_START + N_HAND;
export const RIGHT_HAND_START = POSE_START + N_POSE;

export const POSE_UPPER = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16];
export const POSE_UPPER_MIRROR = [0, 5, 2, 8, 7, 12, 11, 14, 13, 16, 15];
export const POSE_LEFT_SHOULDER = 11;
export const POSE_RIGHT_SHOULDER = 12;
export const POSE_LEFT_WRIST = 15;
export const POSE_RIGHT_WRIST = 16;

const LIP_RUNS = [
  [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
  [185, 40, 39, 37, 0, 267, 269, 270, 409],
  [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308],
  [191, 80, 81, 82, 13, 312, 311, 310, 415],
];
export const LIPS = LIP_RUNS.flat();
export const LIPS_MIRROR = LIP_RUNS.flatMap((run) => [...run].reverse());

export const HAND_WRIST = 0;
export const HAND_MIDDLE_MCP = 9;

/** The only points the features read (40 lip points, both hands, the pose): 115 of 543. */
export const KEEP_POINTS = [
  ...[...LIPS].sort((a, b) => a - b),
  ...Array.from({ length: N_POINTS - LEFT_HAND_START }, (_, i) => LEFT_HAND_START + i),
];

export function emptyFrame() {
  return new Float32Array(FRAME_LENGTH).fill(Number.NaN);
}

/** True when no hand point is present (the "nothing to read" case). */
export function handsMissing(frame) {
  return Number.isNaN(frame[LEFT_HAND_START * 3]) && Number.isNaN(frame[RIGHT_HAND_START * 3]);
}

/**
 * Build a frame from sparse x,y values: `flat` holds x,y per entry of `points`
 * (null / NaN = not detected). Used by the eval fixtures.
 */
export function frameFromPoints(flat, points) {
  const frame = emptyFrame();
  for (let i = 0; i < points.length; i++) {
    const x = flat[2 * i];
    const y = flat[2 * i + 1];
    if (x === null || y === null || Number.isNaN(x) || Number.isNaN(y)) continue;
    const k = points[i] * 3;
    frame[k] = x;
    frame[k + 1] = y;
    frame[k + 2] = 0;
  }
  return frame;
}
