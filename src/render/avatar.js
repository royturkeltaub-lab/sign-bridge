// Canvas renderer for the signing avatar: an illustrated upper body with two articulated,
// shaded hands. Geometry comes from the sign timeline; this file is only about looks.
import { add, sub, scale, norm, len, cross, dot } from '../core/vec.js';
import { handBasis, placeLandmarks, LM } from '../core/handModel.js';
import { BODY } from '../signs/space.js';

const SKIN = { light: [247, 208, 178], dark: [176, 112, 84], line: 'rgba(104, 58, 38, 0.9)', nail: 'rgba(255, 236, 226, 0.85)' };
const SHIRT = { top: '#6f8cff', bottom: '#2a3aa6', dark: '#243086', line: 'rgba(20, 26, 78, 0.9)', cuff: '#dfe6ff' };
const HAIR = { base: '#2b1d17', shine: '#5a3f31' };

const DIGITS = [LM.THUMB, LM.index, LM.middle, LM.ring, LM.pinky];
// Finger radius at each joint, as a share of the hand's length (thumb is thicker).
const TAPER = [1, 0.92, 0.82, 0.68];
const PALM_EDGES = [
  [0, 1, 0.17, 0.14],
  [1, 5, 0.14, 0.11],
  [5, 9, 0.11, 0.11],
  [9, 13, 0.11, 0.105],
  [13, 17, 0.105, 0.095],
  [17, 0, 0.095, 0.17],
];
const PALM = [0, 1, 5, 9, 13, 17];

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;

/** World-space landmarks + wrist for a sampled hand state. */
export function resolveHand(state, hand) {
  const basis = handBasis(state.finger, state.palm, hand);
  const wrist = sub(state.at, scale(basis.y, BODY.handSize * 0.85));
  return { landmarks: placeLandmarks(state.local, basis, wrist, BODY.handSize), wrist, basis, hand };
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

/** Add a tapered capsule (two circles and their tangents) to the current path. */
function capsule(ctx, [ax, ay], ar, [bx, by], br) {
  const angle = Math.atan2(by - ay, bx - ax);
  ctx.moveTo(ax + ar * Math.cos(angle + Math.PI / 2), ay + ar * Math.sin(angle + Math.PI / 2));
  ctx.arc(ax, ay, ar, angle + Math.PI / 2, angle + (3 * Math.PI) / 2);
  ctx.arc(bx, by, br, angle - Math.PI / 2, angle + Math.PI / 2);
  ctx.closePath();
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
    const now = performance.now();
    // Idle life: slow breathing and an occasional blink.
    this.breath = Math.sin(now / 1700) * 0.008;
    const blinkPhase = (now % 4300) / 4300;
    this.eyeOpen = blinkPhase > 0.965 ? Math.abs(blinkPhase - 0.9825) / 0.0175 : 1;

    ctx.clearRect(0, 0, this.w, this.h);
    this.drawBackdrop();
    this.drawTorso();
    this.drawHead();
    const hands = [
      { ...resolveHand(pose.non, 'left'), shoulder: BODY.shoulderL, side: 1 },
      { ...resolveHand(pose.dom, 'right'), shoulder: BODY.shoulderR, side: -1 },
    ].sort((a, b) => a.wrist[2] - b.wrist[2]);
    for (const hand of hands) {
      this.drawArm(hand);
      this.drawHand(hand, true);
    }
    // Fingerspelling is small on a full figure, so show the spelling hand close up.
    if (pose.letter >= 0) this.drawCloseUp(hands.find((hand) => hand.side === -1));
  }

  drawBackdrop() {
    const { ctx, unit } = this;
    const [x, y] = this.project([0, 0.55, 0]);
    const glow = ctx.createRadialGradient(x, y, unit * 0.2, x, y, unit * 1.7);
    glow.addColorStop(0, 'rgba(120, 150, 255, 0.22)');
    glow.addColorStop(1, 'rgba(120, 150, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  drawTorso() {
    const { ctx, unit } = this;
    const lift = this.breath;
    const P = (x, y) => this.project([x, y + (y > 0 ? lift : 0), 0]);
    const [, top] = P(0, 0.72);
    const [, bottom] = P(0, BODY.hipY - 0.3);
    const fill = ctx.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, SHIRT.top);
    fill.addColorStop(1, SHIRT.bottom);
    ctx.beginPath();
    ctx.moveTo(...P(-0.17, 0.7));
    ctx.bezierCurveTo(...P(-0.36, 0.66), ...P(-0.62, 0.66), ...P(-0.76, 0.5));
    ctx.bezierCurveTo(...P(-0.84, 0.38), ...P(-0.74, 0.1), ...P(-0.6, -0.1));
    ctx.bezierCurveTo(...P(-0.56, -0.4), ...P(-0.54, -0.7), ...P(-0.56, BODY.hipY - 0.3));
    ctx.lineTo(...P(0.56, BODY.hipY - 0.3));
    ctx.bezierCurveTo(...P(0.54, -0.7), ...P(0.56, -0.4), ...P(0.6, -0.1));
    ctx.bezierCurveTo(...P(0.74, 0.1), ...P(0.84, 0.38), ...P(0.76, 0.5));
    ctx.bezierCurveTo(...P(0.62, 0.66), ...P(0.36, 0.66), ...P(0.17, 0.7));
    ctx.closePath();
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = unit * 0.12;
    ctx.shadowOffsetY = unit * 0.03;
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
    // Soft shading down the sides and a rim light on the shoulders.
    ctx.save();
    ctx.clip();
    const [lx] = P(-0.8, 0);
    const [rx] = P(0.8, 0);
    const side = ctx.createLinearGradient(lx, 0, rx, 0);
    side.addColorStop(0, 'rgba(10, 14, 60, 0.45)');
    side.addColorStop(0.28, 'rgba(10, 14, 60, 0)');
    side.addColorStop(0.72, 'rgba(10, 14, 60, 0)');
    side.addColorStop(1, 'rgba(10, 14, 60, 0.45)');
    ctx.fillStyle = side;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = unit * 0.02;
    ctx.beginPath();
    ctx.moveTo(...P(-0.74, 0.5));
    ctx.bezierCurveTo(...P(-0.6, 0.65), ...P(-0.36, 0.655), ...P(-0.18, 0.69));
    ctx.moveTo(...P(0.74, 0.5));
    ctx.bezierCurveTo(...P(0.6, 0.65), ...P(0.36, 0.655), ...P(0.18, 0.69));
    ctx.stroke();
    ctx.restore();
    // Neck and the skin inside the collar.
    const neck = ctx.createLinearGradient(0, P(0, 0.9)[1], 0, P(0, 0.5)[1]);
    neck.addColorStop(0, mix(SKIN.light, SKIN.dark, 0.55));
    neck.addColorStop(1, mix(SKIN.light, SKIN.dark, 0.2));
    ctx.fillStyle = neck;
    ctx.beginPath();
    ctx.moveTo(...P(-0.13, 0.92));
    ctx.lineTo(...P(-0.15, 0.7));
    ctx.quadraticCurveTo(...P(0, 0.5), ...P(0.15, 0.7));
    ctx.lineTo(...P(0.13, 0.92));
    ctx.closePath();
    ctx.fill();
    // Collar.
    ctx.strokeStyle = SHIRT.cuff;
    ctx.lineWidth = unit * 0.028;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(...P(-0.18, 0.705));
    ctx.quadraticCurveTo(...P(-0.08, 0.62), ...P(0, 0.52));
    ctx.quadraticCurveTo(...P(0.08, 0.62), ...P(0.18, 0.705));
    ctx.stroke();
  }

  drawHead() {
    const { ctx, unit } = this;
    const [hx, hy] = this.project([0, BODY.headCenter[1] + this.breath * 1.5, 0]);
    const r = BODY.headRadius * unit;
    const rx = r * 0.84;
    // Ears.
    ctx.fillStyle = mix(SKIN.light, SKIN.dark, 0.35);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(hx + s * rx * 0.99, hy + r * 0.06, r * 0.11, r * 0.19, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Face.
    const face = ctx.createRadialGradient(hx - rx * 0.25, hy - r * 0.3, r * 0.1, hx, hy, r * 1.15);
    face.addColorStop(0, mix(SKIN.light, SKIN.dark, 0));
    face.addColorStop(1, mix(SKIN.light, SKIN.dark, 0.42));
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.moveTo(hx - rx, hy - r * 0.1);
    ctx.bezierCurveTo(hx - rx, hy - r * 1.05, hx + rx, hy - r * 1.05, hx + rx, hy - r * 0.1);
    ctx.bezierCurveTo(hx + rx, hy + r * 0.62, hx + rx * 0.45, hy + r * 1.02, hx, hy + r * 1.02);
    ctx.bezierCurveTo(hx - rx * 0.45, hy + r * 1.02, hx - rx, hy + r * 0.62, hx - rx, hy - r * 0.1);
    ctx.fill();
    // Hair: a swept fringe with a soft highlight.
    const hair = ctx.createLinearGradient(hx - rx, hy - r, hx + rx, hy - r * 0.2);
    hair.addColorStop(0, HAIR.shine);
    hair.addColorStop(0.5, HAIR.base);
    hair.addColorStop(1, HAIR.base);
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.moveTo(hx - rx * 1.04, hy + r * 0.02);
    ctx.bezierCurveTo(hx - rx * 1.2, hy - r * 1.25, hx + rx * 1.2, hy - r * 1.3, hx + rx * 1.04, hy + r * 0.02);
    ctx.bezierCurveTo(hx + rx * 0.98, hy - r * 0.35, hx + rx * 0.7, hy - r * 0.52, hx + rx * 0.35, hy - r * 0.56);
    ctx.bezierCurveTo(hx - rx * 0.1, hy - r * 0.6, hx - rx * 0.55, hy - r * 0.42, hx - rx * 0.9, hy - r * 0.2);
    ctx.closePath();
    ctx.fill();
    // Brows and eyes.
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      const ex = hx + s * rx * 0.42;
      const ey = hy + r * 0.04;
      ctx.strokeStyle = HAIR.base;
      ctx.lineWidth = r * 0.055;
      ctx.beginPath();
      ctx.moveTo(ex - s * r * 0.17, ey - r * 0.2);
      ctx.quadraticCurveTo(ex, ey - r * 0.27, ex + s * r * 0.15, ey - r * 0.2);
      ctx.stroke();
      const open = Math.max(0.08, this.eyeOpen);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(ex, ey, r * 0.125, r * 0.085 * open, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#3a2a22';
      ctx.beginPath();
      ctx.arc(ex, ey, r * 0.066, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex + r * 0.024, ey - r * 0.026, r * 0.02, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(60, 36, 28, 0.85)';
      ctx.lineWidth = r * 0.03;
      ctx.beginPath();
      ctx.ellipse(ex, ey, r * 0.13, r * 0.09 * open, 0, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
    }
    // Nose and mouth.
    ctx.strokeStyle = 'rgba(140, 84, 60, 0.7)';
    ctx.lineWidth = r * 0.035;
    ctx.beginPath();
    ctx.moveTo(hx + r * 0.02, hy + r * 0.12);
    ctx.quadraticCurveTo(hx + r * 0.1, hy + r * 0.36, hx - r * 0.02, hy + r * 0.38);
    ctx.stroke();
    ctx.strokeStyle = '#a2463f';
    ctx.lineWidth = r * 0.05;
    ctx.beginPath();
    ctx.moveTo(hx - r * 0.2, hy + r * 0.6);
    ctx.quadraticCurveTo(hx, hy + r * 0.74, hx + r * 0.2, hy + r * 0.6);
    ctx.stroke();
  }

  drawArm({ shoulder, wrist, side }) {
    const { ctx, unit } = this;
    const elbow = solveElbow(shoulder, wrist, side);
    const depth = 1 + 0.16 * wrist[2];
    const [s, e, w] = [shoulder, elbow, wrist].map((p) => this.project(p));
    // The sleeve stops a little short of the wrist, leaving skin before the hand.
    const cuff = [e[0] + (w[0] - e[0]) * 0.86, e[1] + (w[1] - e[1]) * 0.86];
    const sleeve = ctx.createLinearGradient(s[0], s[1], w[0], w[1]);
    sleeve.addColorStop(0, SHIRT.top);
    sleeve.addColorStop(1, SHIRT.bottom);
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = unit * 0.08;
    ctx.shadowOffsetY = unit * 0.025;
    ctx.fillStyle = SHIRT.line;
    ctx.beginPath();
    capsule(ctx, s, unit * 0.135, e, unit * 0.105);
    capsule(ctx, e, unit * 0.105, cuff, unit * 0.082 * depth);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = sleeve;
    ctx.beginPath();
    capsule(ctx, s, unit * 0.125, e, unit * 0.097);
    capsule(ctx, e, unit * 0.097, cuff, unit * 0.075 * depth);
    ctx.fill();
    // Wrist skin and cuff band.
    ctx.fillStyle = mix(SKIN.light, SKIN.dark, 0.3);
    ctx.beginPath();
    capsule(ctx, cuff, unit * 0.058 * depth, w, unit * 0.052 * depth);
    ctx.fill();
    ctx.strokeStyle = SHIRT.cuff;
    ctx.lineWidth = unit * 0.03;
    ctx.lineCap = 'round';
    const nx = -(w[1] - e[1]);
    const ny = w[0] - e[0];
    const nl = Math.hypot(nx, ny) || 1;
    const half = unit * 0.07 * depth;
    ctx.beginPath();
    ctx.moveTo(cuff[0] + (nx / nl) * half, cuff[1] + (ny / nl) * half);
    ctx.lineTo(cuff[0] - (nx / nl) * half, cuff[1] - (ny / nl) * half);
    ctx.stroke();
  }

  /** Draw one hand: palm and fingers as shaded, tapered shapes, nearest parts last. */
  drawHand({ landmarks, basis, hand }, castShadow = false) {
    const { ctx, unit } = this;
    const facing = basis.z[2] >= 0; // palm towards the viewer
    const pts = landmarks.map((p) => this.project(p));
    const scalePx = unit * BODY.handSize * (1 + 0.16 * landmarks[9][2]);
    const zRef = landmarks[9][2];
    const meanZ = (ids) => ids.reduce((sum, i) => sum + landmarks[i][2], 0) / ids.length;
    // Nearer parts are lighter; the back of the hand is a shade darker than the palm.
    const tone = (z) => mix(SKIN.light, SKIN.dark, clamp01(0.16 + (facing ? 0 : 0.14) + (zRef - z) * 1.5));

    const parts = [{ kind: 'palm', z: meanZ(PALM) - 0.001 }];
    DIGITS.forEach((ids, d) => parts.push({ kind: 'digit', ids, d, z: meanZ(ids.slice(1)) }));
    parts.sort((a, b) => a.z - b.z);

    const outline = Math.max(1, scalePx * 0.022);
    const trace = (part, grow) => {
      ctx.beginPath();
      if (part.kind === 'palm') {
        ctx.moveTo(...pts[PALM[0]]);
        for (const i of PALM.slice(1)) ctx.lineTo(...pts[i]);
        ctx.closePath();
        for (const [a, b, ra, rb] of PALM_EDGES) capsule(ctx, pts[a], ra * scalePx + grow, pts[b], rb * scalePx + grow);
        return;
      }
      const base = (part.d === 0 ? 0.115 : part.d === 4 ? 0.082 : 0.094) * scalePx;
      for (let j = 0; j < 3; j++) {
        capsule(ctx, pts[part.ids[j]], base * TAPER[j] + grow, pts[part.ids[j + 1]], base * TAPER[j + 1] + grow);
      }
    };

    for (const part of parts) {
      ctx.save();
      if (castShadow && part.kind === 'palm') {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = unit * 0.07;
        ctx.shadowOffsetY = unit * 0.02;
      }
      trace(part, outline);
      ctx.fillStyle = SKIN.line;
      ctx.fill();
      ctx.restore();
      trace(part, 0);
      ctx.fillStyle = tone(part.z);
      ctx.fill();
      if (part.kind === 'digit') this.drawFingerDetail(part, landmarks, pts, basis, hand, scalePx);
    }
  }

  /** Knuckle creases, and a nail when the back of the fingertip faces the viewer. */
  drawFingerDetail(part, landmarks, pts, basis, hand, scalePx) {
    const { ctx } = this;
    const [, , dip, tip] = part.ids;
    const direction = norm(sub(landmarks[tip], landmarks[dip]));
    let back = cross(direction, basis.x);
    if (hand === 'left') back = scale(back, -1);
    const base = (part.d === 0 ? 0.115 : part.d === 4 ? 0.082 : 0.094) * scalePx;
    if (back[2] > 0.3) {
      const [tx, ty] = pts[tip];
      const [dx, dy] = pts[dip];
      const angle = Math.atan2(ty - dy, tx - dx);
      ctx.fillStyle = SKIN.nail;
      ctx.beginPath();
      ctx.ellipse(tx - Math.cos(angle) * base * 0.25, ty - Math.sin(angle) * base * 0.25, base * 0.62, base * 0.46 * back[2], angle, 0, Math.PI * 2);
      ctx.fill();
    } else if (back[2] < -0.3) {
      // Palm side: a small crease at each joint.
      ctx.strokeStyle = 'rgba(120, 70, 48, 0.35)';
      ctx.lineWidth = Math.max(0.8, scalePx * 0.012);
      for (const j of [1, 2]) {
        const [x, y] = pts[part.ids[j]];
        const [px, py] = pts[part.ids[j - 1]];
        const angle = Math.atan2(y - py, x - px) + Math.PI / 2;
        const half = base * TAPER[j] * 0.6;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(angle) * half, y - Math.sin(angle) * half);
        ctx.lineTo(x + Math.cos(angle) * half, y + Math.sin(angle) * half);
        ctx.stroke();
      }
    }
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
    this.unit = size / (BODY.handSize * 2.7);
    const k = 1 + 0.16 * centre[2];
    this.cx = x + size / 2 - centre[0] * this.unit * k;
    this.cy = y + size / 2 + (centre[1] - 0.25) * this.unit * k;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 14);
    const panel = ctx.createLinearGradient(0, y, 0, y + size);
    panel.addColorStop(0, 'rgba(30, 38, 66, 0.92)');
    panel.addColorStop(1, 'rgba(12, 15, 26, 0.92)');
    ctx.fillStyle = panel;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.clip();
    this.drawHand(hand);
    ctx.restore();
    Object.assign(this, saved);
  }
}
