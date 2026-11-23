import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as vec from '../src/core/vec.js';
import { HANDSHAPES, FINGER_NAMES, getHandshape } from '../src/core/handshapes.js';
import {
  LM,
  localLandmarks,
  blendLandmarks,
  handBasis,
  placeLandmarks,
  poseLandmarks,
  toImageSpace,
} from '../src/core/handModel.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const nearVec = (a, b, eps = 1e-9) => a.every((v, i) => near(v, b[i], eps));
const JOINT = { mcp: 0, pip: 1, dip: 2, tip: 3 };

describe('vec', () => {
  test('basic arithmetic', () => {
    assert.deepEqual(vec.add([1, 2, 3], [4, 5, 6]), [5, 7, 9]);
    assert.deepEqual(vec.sub([4, 5, 6], [1, 2, 3]), [3, 3, 3]);
    assert.deepEqual(vec.scale([1, -2, 3], 2), [2, -4, 6]);
    assert.equal(vec.dot([1, 2, 3], [4, 5, 6]), 32);
    assert.deepEqual(vec.cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
    assert.equal(vec.len([3, 4, 12]), 13);
    assert.equal(vec.dist([1, 1, 1], [4, 5, 13]), 13);
    assert.deepEqual(vec.lerp([0, 0, 0], [2, 4, 6], 0.5), [1, 2, 3]);
    assert.equal(vec.clamp(5, 0, 1), 1);
    assert.equal(vec.clamp(-5, 0, 1), 0);
    assert.equal(vec.clamp(0.3, 0, 1), 0.3);
    assert.ok(near(vec.deg2rad(180), Math.PI));
  });

  test('norm returns unit vectors and survives the zero vector', () => {
    assert.ok(near(vec.len(vec.norm([3, 4, 0])), 1));
    assert.deepEqual(vec.norm([0, 0, 0]), [0, 0, 0]);
  });

  test('angleDeg', () => {
    assert.ok(near(vec.angleDeg([1, 0, 0], [0, 1, 0]), 90));
    assert.ok(near(vec.angleDeg([1, 0, 0], [5, 0, 0]), 0));
    assert.ok(near(vec.angleDeg([1, 0, 0], [-2, 0, 0]), 180));
    assert.equal(vec.angleDeg([0, 0, 0], [1, 0, 0]), 0);
  });

  test('orthoTo is perpendicular to the reference', () => {
    const n = vec.norm([1, 2, 3]);
    const o = vec.orthoTo([0.3, -1, 0.5], n);
    assert.ok(near(vec.dot(o, n), 0, 1e-12));
    assert.ok(near(vec.len(o), 1));
  });

  test('rotateToward turns by the requested angle and keeps unit length', () => {
    const d = [0, 1, 0];
    for (const deg of [0, 10, 45, 90, 135]) {
      const r = vec.rotateToward(d, [1, 0.3, 0], deg);
      assert.ok(near(vec.len(r), 1));
      assert.ok(near(vec.angleDeg(d, r), deg, 1e-6), `angle ${deg}`);
      assert.ok(r[0] >= -1e-12, 'rotates towards +x');
    }
    // No defined plane when the target is parallel: the direction is returned unchanged.
    assert.deepEqual(vec.rotateToward(d, [0, 2, 0], 30), d);
  });

  test('lerpDir stays normalised, even between opposite directions', () => {
    assert.ok(near(vec.len(vec.lerpDir([1, 0, 0], [0, 1, 0], 0.3)), 1));
    assert.deepEqual(vec.lerpDir([1, 0, 0], [-1, 0, 0], 0.5), [1, 0, 0]);
    assert.ok(nearVec(vec.lerpDir([0, 2, 0], [0, 0, 5], 1), [0, 0, 1]));
  });
});

describe('handshapes', () => {
  test('every handshape has four fingers with [mcp, pip, dip, abduction] and a valid thumb', () => {
    for (const [name, shape] of Object.entries(HANDSHAPES)) {
      for (const finger of FINGER_NAMES) {
        const pose = shape.fingers[finger];
        assert.equal(pose.length, 4, `${name}.${finger}`);
        assert.ok(pose.every(Number.isFinite), `${name}.${finger} has non-numeric angles`);
        assert.ok(pose.slice(0, 3).every((a) => a >= -10 && a <= 110), `${name}.${finger} flexion out of range`);
        assert.ok(Math.abs(pose[3]) <= 30, `${name}.${finger} abduction out of range`);
      }
      const { thumb } = shape;
      if (thumb.touch) {
        assert.ok(FINGER_NAMES.includes(thumb.touch), `${name} thumb touches unknown finger`);
        assert.ok(['tip', 'pip', 'dip', 'mcp', undefined].includes(thumb.joint), `${name} thumb joint`);
      } else {
        assert.equal(thumb.dir.length, 3, name);
        assert.equal(thumb.bend.length, 2, name);
        assert.equal(thumb.toward.length, 3, name);
      }
    }
  });

  test('getHandshape throws on unknown names', () => {
    assert.equal(getHandshape('A'), HANDSHAPES.A);
    assert.throws(() => getHandshape('NOPE'), /Unknown handshape: NOPE/);
    assert.throws(() => getHandshape(undefined), /Unknown handshape/);
  });
});

describe('hand model', () => {
  const names = Object.keys(HANDSHAPES);

  test('every handshape yields 21 finite landmarks with the wrist at the origin', () => {
    for (const name of names) {
      const lm = localLandmarks(name);
      assert.equal(lm.length, 21, name);
      for (let i = 0; i < 21; i++) {
        assert.ok(Array.isArray(lm[i]) && lm[i].length === 3, `${name}[${i}] missing`);
        assert.ok(lm[i].every(Number.isFinite), `${name}[${i}] not finite: ${lm[i]}`);
      }
      assert.deepEqual(lm[LM.WRIST], [0, 0, 0]);
    }
  });

  test('bone lengths do not depend on the handshape', () => {
    const reference = localLandmarks('5');
    const bones = [];
    for (const finger of FINGER_NAMES) for (let j = 0; j < 3; j++) bones.push([LM[finger][j], LM[finger][j + 1]]);
    for (let j = 0; j < 3; j++) bones.push([LM.THUMB[j], LM.THUMB[j + 1]]);
    for (const name of names) {
      const lm = localLandmarks(name);
      for (const [a, b] of bones) {
        assert.ok(
          near(vec.dist(lm[a], lm[b]), vec.dist(reference[a], reference[b]), 1e-9),
          `${name}: bone ${a}-${b} changed length`,
        );
      }
    }
  });

  test('an extended fingertip is farther from the wrist than a curled one', () => {
    for (const finger of FINGER_NAMES) {
      const extended = [];
      const curled = [];
      for (const name of names) {
        const [mcp, pip, dip] = HANDSHAPES[name].fingers[finger];
        const d = vec.len(localLandmarks(name)[LM[finger][3]]);
        if (mcp + pip + dip === 0) extended.push([name, d]);
        else if (mcp + pip + dip > 200) curled.push([name, d]);
      }
      assert.ok(extended.length && curled.length, `no samples for ${finger}`);
      const minExtended = Math.min(...extended.map((e) => e[1]));
      const maxCurled = Math.max(...curled.map((e) => e[1]));
      assert.ok(minExtended > maxCurled + 0.4, `${finger}: extended ${minExtended} vs curled ${maxCurled}`);
    }
    // Spot check: the "1" handshape raises only the index finger.
    const one = localLandmarks('1');
    assert.ok(vec.len(one[8]) > vec.len(one[12]) + 0.4);
  });

  test('curled fingers fold towards the palm side (+z) and never behind it', () => {
    const fist = localLandmarks('S');
    for (const finger of FINGER_NAMES) {
      assert.ok(fist[LM[finger][3]][2] > 0, `${finger} tip is not in front of the palm`);
      assert.ok(fist[LM[finger][2]][2] > 0.1);
    }
    const flat = localLandmarks('B');
    for (const finger of FINGER_NAMES) assert.ok(near(flat[LM[finger][3]][2], 0, 1e-9));
  });

  test('named lookups are cached; shape objects are accepted', () => {
    assert.equal(localLandmarks('A'), localLandmarks('A'));
    const fromObject = localLandmarks(HANDSHAPES.A);
    assert.notEqual(fromObject, localLandmarks('A'));
    assert.deepEqual(fromObject, localLandmarks('A'));
    assert.throws(() => localLandmarks('NOPE'), /Unknown handshape/);
  });

  // "touch" thumbs reach for a finger joint. The solver aims 0.06 in front of the joint, so a
  // thumb that really touches lands well within 0.25 (about half a finger segment).
  for (const [name, shape] of Object.entries(HANDSHAPES)) {
    if (!shape.thumb.touch) continue;
    const joint = shape.thumb.joint || 'tip';
    test(`thumb of ${name} reaches the ${shape.thumb.touch} ${joint}`, () => {
      const lm = localLandmarks(name);
      const target = lm[LM[shape.thumb.touch][JOINT[joint]]];
      const gap = vec.dist(lm[LM.THUMB[3]], target);
      assert.ok(gap < 0.25, `thumb tip is ${gap.toFixed(3)} hand units away from the joint it should touch`);
    });
  }

  test('blendLandmarks interpolates between two sets', () => {
    const a = localLandmarks('A');
    const b = localLandmarks('5');
    assert.deepEqual(blendLandmarks(a, b, 0), a);
    assert.deepEqual(blendLandmarks(a, b, 1), b);
    const mid = blendLandmarks(a, b, 0.5);
    assert.equal(mid.length, 21);
    assert.ok(nearVec(mid[8], vec.scale(vec.add(a[8], b[8]), 0.5)));
  });
});

describe('handBasis', () => {
  const cases = [
    [[0, 1, 0], [0, 0, 1]],
    [[1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [0, 0, -1]],
    [[0, 0.45, 0.9], [0, -0.9, 0.45]],
    [[0.75, 0.6, 0.1], [0.2, 0.3, -1]], // not perpendicular: palm must be corrected
    [[0, 3, 0], [0, 2, 5]], // not unit length
  ];

  test('is orthonormal for both hands', () => {
    for (const [finger, palm] of cases) {
      for (const hand of ['right', 'left']) {
        const { x, y, z } = handBasis(finger, palm, hand);
        for (const v of [x, y, z]) assert.ok(near(vec.len(v), 1, 1e-9), `unit length for ${finger}/${palm}`);
        assert.ok(near(vec.dot(x, y), 0, 1e-9));
        assert.ok(near(vec.dot(y, z), 0, 1e-9));
        assert.ok(near(vec.dot(x, z), 0, 1e-9));
        assert.ok(nearVec(y, vec.norm(finger), 1e-9), 'y follows the finger direction');
        assert.ok(vec.dot(z, palm) > 0, 'z stays on the palm side');
      }
    }
  });

  test('right hand is right-handed (x = y × z); the left hand mirrors x only', () => {
    for (const [finger, palm] of cases) {
      const right = handBasis(finger, palm);
      const left = handBasis(finger, palm, 'left');
      assert.ok(nearVec(right.x, vec.cross(right.y, right.z), 1e-9));
      assert.ok(nearVec(left.x, vec.scale(right.x, -1), 1e-9));
      assert.deepEqual(left.y, right.y);
      assert.deepEqual(left.z, right.z);
    }
  });

  test('degenerate palm directions still give an orthonormal basis', () => {
    for (const [finger, palm] of [
      [[0, 1, 0], [0, 1, 0]],
      [[0, 1, 0], [0, 0, 0]],
      [[1, 0, 0], [-4, 0, 0]],
      [[0, 0, 1], [0, 0, 1]],
    ]) {
      const { x, y, z } = handBasis(finger, palm);
      for (const v of [x, y, z]) {
        assert.ok(v.every(Number.isFinite));
        assert.ok(near(vec.len(v), 1, 1e-9), `degenerate ${finger}/${palm}`);
      }
      assert.ok(near(vec.dot(y, z), 0, 1e-9));
      assert.ok(near(vec.dot(x, y), 0, 1e-9));
    }
  });
});

describe('placing hands', () => {
  test('default pose is the local frame; wrist offset and size are applied', () => {
    const local = localLandmarks('V');
    const posed = poseLandmarks('V');
    posed.forEach((p, i) => assert.ok(nearVec(p, local[i], 1e-12)));
    const placed = placeLandmarks(local, handBasis([0, 1, 0], [0, 0, 1]), [1, 2, 3], 0.5);
    assert.deepEqual(placed[0], [1, 2, 3]);
    assert.ok(nearVec(placed[8], vec.add([1, 2, 3], vec.scale(local[8], 0.5)), 1e-12));
  });

  test('rotation preserves distances between landmarks', () => {
    const local = localLandmarks('K');
    const posed = poseLandmarks('K', { finger: [0, -0.35, 0.94], palm: [0, -0.94, -0.35] });
    for (const [a, b] of [[0, 8], [4, 12], [5, 17], [8, 20]]) {
      assert.ok(near(vec.dist(posed[a], posed[b]), vec.dist(local[a], local[b]), 1e-9));
    }
  });

  test('the left hand is the mirror image of the right hand', () => {
    const right = poseLandmarks('L');
    const left = poseLandmarks('L', { hand: 'left' });
    right.forEach((p, i) => assert.ok(nearVec(left[i], [-p[0], p[1], p[2]], 1e-12)));
    // The right thumb sticks out towards +x, the left thumb towards -x.
    assert.ok(right[4][0] > 0.5 && left[4][0] < -0.5);
  });

  test('toImageSpace flips y and z and returns MediaPipe-style objects', () => {
    assert.deepEqual(toImageSpace([[1, 2, 3], [0, -1, 0.5]]), [
      { x: 1, y: -2, z: -3 },
      { x: 0, y: 1, z: -0.5 },
    ]);
    const image = toImageSpace(poseLandmarks('B'));
    assert.equal(image.length, 21);
    // Fingers pointing up in signer space are at smaller image y than the wrist.
    assert.ok(image[12].y < image[0].y);
  });
});
