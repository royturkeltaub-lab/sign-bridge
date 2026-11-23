// Browser-only: camera access and MediaPipe landmarkers (hands + faces).
const WASM_PATH = '/vendor/mediapipe/wasm';
const MODELS = {
  hand: '/models/hand_landmarker.task',
  face: '/models/face_landmarker.task',
};

let visionPromise = null;
function loadVision() {
  if (!visionPromise) {
    visionPromise = import('/vendor/mediapipe/vision_bundle.mjs').then(async (mp) => ({
      mp,
      fileset: await mp.FilesetResolver.forVisionTasks(WASM_PATH),
    }));
  }
  return visionPromise;
}

/** Create a task on the GPU, falling back to CPU where WebGL is unavailable (some phones). */
async function createWithFallback(create) {
  try {
    return await create('GPU');
  } catch (err) {
    console.warn('GPU delegate unavailable, using CPU', err);
    return create('CPU');
  }
}

export async function createHandLandmarker(numHands = 2) {
  const { mp, fileset } = await loadVision();
  return createWithFallback((delegate) =>
    mp.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODELS.hand, delegate },
      runningMode: 'VIDEO',
      numHands,
      minHandDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }),
  );
}

export async function createFaceLandmarker(numFaces = 4) {
  const { mp, fileset } = await loadVision();
  return createWithFallback((delegate) =>
    mp.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODELS.face, delegate },
      runningMode: 'VIDEO',
      numFaces,
      outputFaceBlendshapes: true,
    }),
  );
}

/**
 * A camera bound to a <video> element. `facing` is 'user' (laptop / selfie camera) or
 * 'environment' (a phone's back camera).
 */
export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.fileUrl = null;
    this.ownsUrl = false;
    this.facing = 'user';
  }

  get running() {
    return Boolean(this.stream || this.fileUrl);
  }

  /** Play a video file (or URL) in place of the camera, e.g. a recorded signing clip. */
  async startFile(fileOrUrl, { loop = false } = {}) {
    this.stop();
    this.facing = 'file';
    this.fileUrl = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
    this.ownsUrl = typeof fileOrUrl !== 'string';
    this.video.srcObject = null;
    this.video.src = this.fileUrl;
    this.video.loop = loop;
    this.video.muted = true;
    await this.video.play();
  }

  async start(facing = this.facing) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera needs a secure page: open the app on localhost or over https.');
    }
    this.stop();
    this.facing = facing === 'file' ? 'user' : facing;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: this.facing, width: { ideal: 960 }, height: { ideal: 720 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  stop() {
    if (this.fileUrl) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
      if (this.ownsUrl) URL.revokeObjectURL(this.fileUrl);
      this.fileUrl = null;
    }
    if (!this.stream) return;
    for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
    this.video.srcObject = null;
  }
}

/**
 * Calls `onFrame(video, timestampMs)` once per new video frame while the camera runs.
 * Returns a function that stops the loop.
 */
export function frameLoop(video, onFrame) {
  let stopped = false;
  let lastTime = -1;
  const tick = () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      try {
        onFrame(video, performance.now());
      } catch (err) {
        console.error(err);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    stopped = true;
  };
}

/** Match an overlay canvas to its video's pixel size and return its 2D context. */
export function fitOverlay(canvas, video) {
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  return canvas.getContext('2d');
}
