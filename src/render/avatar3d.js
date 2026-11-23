// 3D signing avatar: a rigged character (Mixamo-style skeleton with full finger bones)
// rendered with three.js and posed from the same sign timeline as the 2D avatar.
//
// The default character (public/models/avatar/rpm.glb) is the Ready Player Me sample avatar
// distributed with the three.js examples. Any GLB with Mixamo-style bone names works.
//
// Posing is by direction: every arm and finger bone is turned so that it points the way the
// sign's hand model says (wrist -> knuckle -> joint -> tip), and the hand bone takes the
// sign's full orientation (finger direction + palm normal).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { resolveHand } from './avatar.js';
import { BODY } from '../signs/space.js';

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
// Landmark index of each finger's first joint (thumb chain starts one joint later than the bones).
const FINGER_START = { Thumb: 1, Index: 5, Middle: 9, Ring: 13, Pinky: 17 };
const SIGNER = {
  hipY: BODY.hipY,
  shoulderY: BODY.shoulderR[1],
  chinY: BODY.headCenter[1] - BODY.headRadius,
  eyeY: BODY.headCenter[1] + 0.03,
  halfWidth: Math.abs(BODY.shoulderR[0]),
};

// Neutral styling: the sample character's costume pieces (hat with wig, moustache) are hidden,
// its patterned jacket becomes a plain dark top, and simple short hair is added.
const HIDDEN_PARTS = /Headwear|Beard/i;
const PLAIN_PARTS = /Outfit_Top/i;
const STYLE = { top: 0x2c3a52, hair: 0x2e211b };

const v = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export class Avatar3D {
  /** Load the model and set up the scene. Rejects when WebGL or the model is unavailable. */
  static async create(canvas, url = '/models/avatar/rpm.glb') {
    const avatar = new Avatar3D(canvas);
    await avatar.load(url);
    return avatar;
  }

  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.05, 50);
    this.closeCamera = new THREE.PerspectiveCamera(24, 1, 0.02, 20);
    // Soft studio lighting: sky/ground fill, a warm key from the front-left, a cool rim behind.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4468, 1.5));
    const key = new THREE.DirectionalLight(0xfff1e2, 2.4);
    key.position.set(-1.2, 2.2, 2.6);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.9);
    fill.position.set(2, 1, 2);
    const rim = new THREE.DirectionalLight(0x8fb0ff, 2.2);
    rim.position.set(1.5, 2, -2.5);
    this.scene.add(key, fill, rim);
  }

  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.model = gltf.scene;
    this.scene.add(this.model);
    this.bones = {};
    this.model.traverse((node) => {
      if (node.isBone) this.bones[node.name.replace(/^mixamorig:?/, '')] = node;
      if (node.isMesh) {
        node.frustumCulled = false; // posed far from the bind pose, so bounds are unreliable
        // A relaxed, friendly expression where the model supports it.
        const smile = node.morphTargetDictionary?.mouthSmile;
        if (smile !== undefined) node.morphTargetInfluences[smile] = 0.45;
        if (HIDDEN_PARTS.test(node.name)) node.visible = false;
        if (PLAIN_PARTS.test(node.name)) {
          node.material = node.material.clone();
          node.material.map = null;
          node.material.color.set(STYLE.top);
          node.material.roughness = 0.9;
          node.material.metalness = 0;
        }
      }
    });
    for (const name of ['Hips', 'Head', 'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand']) {
      if (!this.bones[name]) throw new Error(`Avatar model has no "${name}" bone`);
    }
    this.model.updateMatrixWorld(true);
    // Remember the rest pose: world position and orientation of every bone.
    this.rest = {};
    for (const [name, bone] of Object.entries(this.bones)) {
      this.rest[name] = {
        position: bone.getWorldPosition(new THREE.Vector3()),
        quaternion: bone.getWorldQuaternion(new THREE.Quaternion()),
      };
    }
    this.sides = { Right: this.measureSide('Right'), Left: this.measureSide('Left') };
    this.headRest = this.bones.Head.quaternion.clone();
    // Body anchors used to map signing space onto this character's proportions.
    const headBase = this.rest.Head.position.y;
    const headTop = (this.rest.HeadTop_End || this.rest.Head).position.y;
    const eye = this.rest.LeftEye || this.rest.RightEye;
    const eyeY = eye ? eye.position.y : headBase + (headTop - headBase) * 0.4;
    const shoulderR = this.rest.RightArm.position;
    const shoulderL = this.rest.LeftArm.position;
    const scale = Math.abs(shoulderL.x - shoulderR.x) / (2 * SIGNER.halfWidth);
    this.anchor = {
      centerX: (shoulderR.x + shoulderL.x) / 2,
      // Signing space measures depth from just behind the chest surface, which on a real
      // body is well ahead of the shoulder joints.
      frontZ: (shoulderR.z + shoulderL.z) / 2 + scale * 0.43,
      scale,
      headTop,
      // Heights, lowest first: [signing-space y, character y].
      levels: [
        [SIGNER.hipY, this.rest.Hips.position.y],
        [SIGNER.shoulderY, (shoulderR.y + shoulderL.y) / 2],
        [SIGNER.chinY, eyeY - (headTop - eyeY) * 0.8],
        [SIGNER.eyeY, eyeY],
      ],
    };
    this.addHair(eyeY, headTop);
    this.frameCamera();
  }

  /** Short, simple hair: a cap over the skull, tilted back so the forehead stays clear. */
  addHair(eyeY, headTop) {
    const head = this.bones.Head;
    const height = headTop - eyeY; // eyes to crown
    const eye = (this.rest.LeftEye || this.rest.Head).position;
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.66),
      new THREE.MeshStandardMaterial({ color: STYLE.hair, roughness: 0.75, metalness: 0 }),
    );
    cap.scale.set(height * 0.615, height * 0.71, height * 0.775);
    cap.position.set(this.anchor.centerX, eyeY + height * 0.35, eye.z - height * 0.65);
    cap.rotation.x = -0.46; // hairline high on the forehead, low at the nape
    this.scene.add(cap);
    cap.updateMatrixWorld(true);
    head.attach(cap); // keep it where it is, but let it follow the head
  }

  /** Rest-pose measurements for one arm and hand. */
  measureSide(side) {
    const pos = (name) => this.rest[side + name].position;
    const dir = (a, b) => pos(b).clone().sub(pos(a)).normalize();
    const y = dir('Hand', 'HandMiddle1');
    const x = pos('HandIndex1').clone().sub(pos('HandPinky1'));
    x.addScaledVector(y, -x.dot(y)).normalize(); // towards the thumb side, square to the fingers
    const z = side === 'Right' ? new THREE.Vector3().crossVectors(x, y) : new THREE.Vector3().crossVectors(y, x);
    const fingers = {};
    for (const finger of FINGERS) {
      fingers[finger] = [1, 2, 3].map((i) => dir(`Hand${finger}${i}`, `Hand${finger}${i + 1}`));
    }
    return {
      upperDir: dir('Arm', 'ForeArm'),
      foreDir: dir('ForeArm', 'Hand'),
      upperLength: pos('Arm').distanceTo(pos('ForeArm')),
      foreLength: pos('ForeArm').distanceTo(pos('Hand')),
      palmLength: pos('Hand').distanceTo(pos('HandMiddle1')),
      restFrameInverse: new THREE.Matrix4().makeBasis(x, y, z).transpose(),
      fingers,
    };
  }

  /** Signing-space point -> this character's world space. */
  place([x, y, z]) {
    const a = this.anchor;
    const { levels } = a;
    // Piecewise-linear height: hips, shoulders, chin and eyes land on the character's own.
    let i = 0;
    while (i < levels.length - 2 && y > levels[i + 1][0]) i++;
    const [y0, m0] = levels[i];
    const [y1, m1] = levels[i + 1];
    const height = y > levels[levels.length - 1][0] ? m1 + (y - y1) * a.scale : m0 + ((y - y0) / (y1 - y0)) * (m1 - m0);
    return new THREE.Vector3(a.centerX + x * a.scale, height, a.frontZ + z * a.scale);
  }

  frameCamera() {
    const a = this.anchor;
    const shoulderY = a.levels[1][1];
    const hipY = a.levels[0][1];
    const top = a.headTop + (a.headTop - shoulderY) * 0.5;
    const bottom = hipY + (shoulderY - hipY) * 0.22; // waist: rest hands hang just out of view
    this.view = { centerY: (top + bottom) / 2, height: top - bottom, width: a.scale * 3.3 };
  }

  resize() {
    const { canvas, renderer } = this;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
    }
    this.w = w;
    this.h = h;
    const { camera, view, anchor } = this;
    camera.aspect = w / h;
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max(view.height / (2 * half), view.width / (2 * half * camera.aspect));
    camera.position.set(anchor.centerX, view.centerY + view.height * 0.04, anchor.frontZ + distance);
    camera.lookAt(anchor.centerX, view.centerY, anchor.frontZ);
    camera.updateProjectionMatrix();
  }

  /** Turn `bone` so that its world orientation is `worldQuaternion`. */
  setWorld(name, worldQuaternion) {
    const bone = this.bones[name];
    const parent = this.world.get(bone.parent) || bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parent.clone().invert().multiply(worldQuaternion));
    this.world.set(bone, worldQuaternion);
  }

  /** Pose one arm and hand from a resolved sign hand (signer space). */
  poseSide(side, state, hand) {
    const m = this.sides[side];
    const { landmarks, basis } = resolveHand(state, hand);
    const rest = (name) => this.rest[side + name].quaternion;
    // Put the character's knuckles where the sign wants the hand, then back off to the wrist.
    const fingerDir = v(basis.y).normalize();
    const shoulder = this.rest[`${side}Arm`].position;
    const wrist = this.place(state.at).addScaledVector(fingerDir, -m.palmLength);
    // Two-bone IK: shoulder -> elbow -> wrist, elbow hanging down and slightly out and back.
    const toWrist = wrist.clone().sub(shoulder);
    const reach = Math.min(toWrist.length(), (m.upperLength + m.foreLength) * 0.995);
    const dir = toWrist.clone().normalize();
    wrist.copy(shoulder).addScaledVector(dir, reach);
    const along = (m.upperLength ** 2 - m.foreLength ** 2 + reach ** 2) / (2 * reach);
    const height = Math.sqrt(Math.max(0, m.upperLength ** 2 - along ** 2));
    const pole = new THREE.Vector3(side === 'Right' ? -0.3 : 0.3, -1, -0.5);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = shoulder.clone().addScaledVector(dir, along).addScaledVector(pole, height);

    const upperTurn = new THREE.Quaternion().setFromUnitVectors(m.upperDir, elbow.clone().sub(shoulder).normalize());
    this.setWorld(`${side}Arm`, upperTurn.clone().multiply(rest('Arm')));
    const foreTurn = new THREE.Quaternion()
      .setFromUnitVectors(m.foreDir.clone().applyQuaternion(upperTurn), wrist.clone().sub(elbow).normalize())
      .multiply(upperTurn);
    this.setWorld(`${side}ForeArm`, foreTurn.clone().multiply(rest('ForeArm')));

    // Hand: full orientation from the sign (thumb side, finger direction, palm normal).
    const target = new THREE.Matrix4().makeBasis(v(basis.x), v(basis.y), v(basis.z));
    const handTurn = new THREE.Quaternion().setFromRotationMatrix(target.multiply(m.restFrameInverse));
    this.setWorld(`${side}Hand`, handTurn.clone().multiply(rest('Hand')));

    // Fingers: each bone follows the matching segment of the sign's hand model.
    for (const finger of FINGERS) {
      let turn = handTurn;
      for (let i = 0; i < 3; i++) {
        const from = landmarks[FINGER_START[finger] + i];
        const to = landmarks[FINGER_START[finger] + i + 1];
        const want = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
        const now = m.fingers[finger][i].clone().applyQuaternion(turn);
        turn = new THREE.Quaternion().setFromUnitVectors(now, want).multiply(turn);
        this.setWorld(`${side}Hand${finger}${i + 1}`, turn.clone().multiply(rest(`Hand${finger}${i + 1}`)));
      }
    }
    return side === 'Right' ? this.place(state.at) : null;
  }

  /** Draw one frame. `pose` comes from sampleTimeline(). */
  draw(pose) {
    this.resize();
    const { renderer, scene } = this;
    this.world = new Map();
    const spellingHand = this.poseSide('Right', pose.dom, 'right');
    this.poseSide('Left', pose.non, 'left');
    // Idle life: the head drifts a little.
    const now = performance.now() / 1000;
    const drift = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(now * 0.7) * 0.02, Math.sin(now * 0.45) * 0.045, 0));
    this.bones.Head.quaternion.copy(this.headRest).multiply(drift);

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.w, this.h);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, this.camera);

    // Fingerspelling is small on a full figure, so show the spelling hand close up.
    if (pose.letter >= 0) {
      const size = Math.round(Math.min(this.w, this.h) * 0.36);
      const x = this.w - size - 10;
      const y = this.h - size - 10; // WebGL viewports are measured from the bottom
      const cam = this.closeCamera;
      const span = this.sides.Right.palmLength * 3.2;
      cam.position.set(spellingHand.x, spellingHand.y, spellingHand.z + span / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))));
      cam.lookAt(spellingHand);
      renderer.setScissorTest(true);
      renderer.setScissor(x, y, size, size);
      renderer.setViewport(x, y, size, size);
      renderer.setClearColor(0x10141f, 0.94);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.setScissorTest(false);
    }
  }
}
