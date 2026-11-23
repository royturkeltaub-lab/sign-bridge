// Canvas renderer for the signing avatar: a simple upper body with two articulated hands.
import { add, sub, scale, norm, len, cross, dot } from '../core/vec.js';
import { handBasis, placeLandmarks, LM } from '../core/handModel.js';
import { BODY } from '../signs/space.js';

const COLORS = {
  skin: '#e8b48c',
  skinPalm: '#f3c9a6',
  skinLine: '#8a5a3c',
  shirt: '#3b5bdb',
  shirtDark: '#2f49b0',
  hair: '#3a2a22',
  face: '#2b2b2b',
};

const DIGITS = [LM.THUMB, LM.index, LM.middle, LM.ring, LM.pinky];
const PALM = [0, 1, 5, 9, 13, 17];

/** World-space landmarks + wrist for a sampled hand state. */
export function resolveHand(state, hand) {
  const basis = handBasis(state.finger, state.palm, hand);
  const wrist = sub(state.at, scale(basis.y, BODY.handSize * 0.85));
  return { landmarks: placeLandmarks(state.local, basis, wrist, BODY.handSize), wrist, basis };
}

/** Elbow position for a two-bone arm from shoulder to wrist. */
function solveElbow(shoulder, wrist, side) {
  const { upperArm: l1, foreArm: l2 } = BODY;
  let toWrist = sub(wrist, shoulder);
  let d = len(toWrist);
  const max = l1 + l2 - 0.01;
  if (d > max) {
    toWrist = scale(toWrist, max / d);
    d = max;
  }
  const dir = norm(toWrist);
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const pole = [side * 0.55, -1, -0.35];
  let perp = sub(pole, scale(dir, dot(pole, dir)));
  perp = len(perp) < 1e-6 ? norm(cross(dir, [0, 0, 1])) : norm(perp);
  return add(add(shoulder, scale(dir, along)), scale(perp, height));
}

export class Avatar {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  /** Project signer space to canvas pixels. */
  project(p) {
    const k = 1 + 0.16 * p[2];
    return [this.cx + p[0] * this.unit * k, this.cy - (p[1] - 0.25) * this.unit * k];
  }

  resize() {
    const { canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = hgt;
    this.unit = Math.min(w / 2.6, hgt / 2.9);
    this.cx = w / 2;
    this.cy = hgt * 0.56;
  }

  /** Draw one frame. `pose` comes from sampleTimeline(). */
  draw(pose) {
    this.resize();
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawBody();
    const hands = [
      { ...resolveHand(pose.non, 'left'), shoulder: BODY.shoulderL, side: 1 },
      { ...resolveHand(pose.dom, 'right'), shoulder: BODY.shoulderR, side: -1 },
    ].sort((a, b) => a.wrist[2] - b.wrist[2]);
    for (const hand of hands) {
      this.drawArm(hand);
      this.drawHand(hand);
    }
    // Fingerspelling is small on a full figure, so show the spelling hand close up.
    if (pose.letter >= 0) this.drawCloseUp(hands.find((hand) => hand.side === -1));
  }

  /** Enlarged view of one hand in the top-right corner. */
  drawCloseUp(hand) {
    const { ctx } = this;
    const size = Math.min(this.w, this.h) * 0.36;
    const x = this.w - size - 10;
    const y = 10;
    const saved = { unit: this.unit, cx: this.cx, cy: this.cy };
    // Centre the view on the middle of the hand.
    const centre = hand.landmarks[9];
    this.unit = size / (BODY.handSize * 3.4);
    const k = 1 + 0.16 * centre[2];
    this.cx = x + size / 2 - centre[0] * this.unit * k;
    this.cy = y + size / 2 + (centre[1] - 0.25) * this.unit * k;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 12);
    ctx.fillStyle = 'rgba(12, 15, 22, 0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.clip();
    this.drawHand(hand);
    ctx.restore();
    Object.assign(this, saved);
  }

  drawBody() {
    const { ctx, unit } = this;
    const [sx1, sy1] = this.project(BODY.shoulderR);
    const [sx2, sy2] = this.project(BODY.shoulderL);
    const [, hipY] = this.project([0, BODY.hipY, 0]);
    // Torso
    ctx.fillStyle = COLORS.shirt;
    ctx.beginPath();
    ctx.moveTo(sx1 - unit * 0.08, sy1 + unit * 0.02);
    ctx.quadraticCurveTo(this.cx, sy1 - unit * 0.2, sx2 + unit * 0.08, sy2 + unit * 0.02);
    ctx.lineTo(sx2 - unit * 0.06, hipY);
    ctx.lineTo(sx1 + unit * 0.06, hipY);
    ctx.closePath();
    ctx.fill();
    // Neck
    const [hx, hy] = this.project(BODY.headCenter);
    ctx.fillStyle = COLORS.skin;
    ctx.fillRect(hx - unit * 0.11, hy + unit * 0.2, unit * 0.22, unit * 0.3);
    // Head
    const r = BODY.headRadius * unit;
    ctx.beginPath();
    ctx.ellipse(hx, hy, r * 0.86, r, 0, 0, Math.PI * 2);
    ctx.fill();
    // Hair
    ctx.fillStyle = COLORS.hair;
    ctx.beginPath();
    ctx.ellipse(hx, hy - r * 0.2, r * 0.9, r * 0.86, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    // Face
    ctx.fillStyle = COLORS.face;
    for (const dx of [-0.32, 0.32]) {
      ctx.beginPath();
      ctx.arc(hx + dx * r, hy + r * 0.02, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = COLORS.face;
    ctx.lineWidth = Math.max(1.5, r * 0.05);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(hx, hy + r * 0.3, r * 0.26, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  drawArm({ shoulder, wrist, side }) {
    const { ctx, unit } = this;
    const elbow = solveElbow(shoulder, wrist, side);
    const pts = [shoulder, elbow, wrist].map((p) => this.project(p));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.shirtDark;
    ctx.lineWidth = unit * 0.2;
    ctx.beginPath();
    ctx.moveTo(...pts[0]);
    ctx.lineTo(...pts[1]);
    ctx.stroke();
    ctx.strokeStyle = COLORS.shirt;
    ctx.lineWidth = unit * 0.16;
    ctx.beginPath();
    ctx.moveTo(...pts[1]);
    ctx.lineTo(...pts[2]);
    ctx.stroke();
  }

  drawHand({ landmarks, basis }) {
    const { ctx, unit } = this;
    const facing = basis.z[2] >= 0; // palm towards the viewer
    const fill = facing ? COLORS.skinPalm : COLORS.skin;
    const meanZ = (ids) => ids.reduce((s, i) => s + landmarks[i][2], 0) / ids.length;
    const parts = [{ kind: 'palm', ids: PALM, z: meanZ(PALM) - 0.001 }];
    for (const ids of DIGITS) parts.push({ kind: 'digit', ids, z: meanZ(ids.slice(1)) });
    parts.sort((a, b) => a.z - b.z);
    const width = unit * BODY.handSize * 0.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const part of parts) {
      const pts = part.ids.map((i) => this.project(landmarks[i]));
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (part.kind === 'palm') {
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.strokeStyle = COLORS.skinLine;
        ctx.lineWidth = width * 1.5;
        ctx.stroke();
        ctx.strokeStyle = fill;
        ctx.lineWidth = width * 1.2;
        ctx.stroke();
        ctx.fill();
      } else {
        ctx.strokeStyle = COLORS.skinLine;
        ctx.lineWidth = width + 2.5;
        ctx.stroke();
        ctx.strokeStyle = fill;
        ctx.lineWidth = width;
        ctx.stroke();
      }
    }
  }
}
