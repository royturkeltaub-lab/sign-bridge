// Browser-only: read a recorded clip frame by frame (seek + update) instead of playing it, so
// the result does not depend on playback speed or on how fast the machine is.
//
//   import { recognizeVideoFile, teachFromVideo } from '/src/vision/wordsigns/videoFile.js';
//   const { events, text } = await recognizeVideoFile(recognizer, file, { onFrame });
//   await teachFromVideo(recognizer, 'everyone', file, { startMs: 900, endMs: 1800 });

function once(target, event) {
  return new Promise((resolve, reject) => {
    const done = () => {
      target.removeEventListener(event, done);
      target.removeEventListener('error', failed);
      resolve();
    };
    const failed = () => {
      target.removeEventListener(event, done);
      target.removeEventListener('error', failed);
      reject(new Error('The video could not be decoded'));
    };
    target.addEventListener(event, done);
    target.addEventListener('error', failed);
  });
}

/**
 * Step through a video at `fps` and call `onFrame(video, mediaTimeMs, index)` for each frame.
 * @param {HTMLVideoElement|File|Blob|string} source a file or URL (a hidden element is used), or
 *   a video element that is on screen (it is paused and seeked; its source must be seekable:
 *   a File/blob URL, or a server that supports HTTP range requests)
 * @param {object} options
 * @param {number} [options.fps=30]      sampling rate; frames are taken at (i + 0.5) / fps seconds
 * @param {number} [options.maxSeconds=120]
 * @param {() => boolean} [options.cancelled] return true to stop early
 * @returns {Promise<{frames: number, durationMs: number}>}
 */
export async function decodeVideoFrames(source, onFrame, { fps = 30, maxSeconds = 120, cancelled } = {}) {
  let video = source;
  let url = null;
  if (!(source instanceof HTMLVideoElement)) {
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    // A URL is downloaded first: seeking a streamed video needs HTTP range support on the server.
    const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source;
    url = URL.createObjectURL(blob);
    video.src = url;
  }
  try {
    if (video.readyState < 1) await once(video, 'loadedmetadata');
    video.pause();
    // Some files start a little after 0; seeking before the first frame would repeat it.
    const first = video.seekable.length ? video.seekable.start(0) : 0;
    const end = video.seekable.length ? video.seekable.end(video.seekable.length - 1) : video.duration;
    const duration = Math.max(0, Math.min(Number.isFinite(end) ? end - first : 0, maxSeconds));
    const total = Math.floor(duration * fps);
    let frames = 0;
    let stuck = 0;
    for (let i = 0; i < total; i++) {
      if (cancelled?.()) break;
      const time = first + (i + 0.5) / fps;
      if (Math.abs(video.currentTime - time) > 1e-4 || video.readyState < 2) {
        const seeked = once(video, 'seeked');
        video.currentTime = time;
        await seeked;
      }
      stuck = Math.abs(video.currentTime - time) > 1 / fps ? stuck + 1 : 0;
      if (stuck >= 5) throw new Error('This video cannot be read frame by frame (it is not seekable)');
      if (video.readyState < 2) await once(video, 'loadeddata');
      await onFrame(video, (time - first) * 1000, i);
      frames++;
    }
    return { frames, durationMs: duration * 1000 };
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

/**
 * Run the word-sign recognizer over a whole clip, deterministically.
 * @param {object} recognizer from createWordSignRecognizer()
 * @param {HTMLVideoElement|File|Blob|string} source
 * @param {object} [options] decodeVideoFrames options, plus
 * @param {(out: object, video: HTMLVideoElement, mediaTimeMs: number) => void} [options.onFrame]
 *   called with each update() result (draw landmarks, show progress)
 * @returns {Promise<{ events: object[], text: string, frames: number, durationMs: number }>}
 *   `events` are all signs in order, each { gloss, confidence, top, accepted, reason?, custom? };
 *   `text` joins the accepted glosses.
 */
export async function recognizeVideoFile(recognizer, source, options = {}) {
  recognizer.reset();
  const base = recognizer.lastTimestamp + 1000;
  const events = [];
  const info = await decodeVideoFrames(
    source,
    (video, mediaTimeMs) => {
      const out = recognizer.update(video, base + mediaTimeMs);
      events.push(...out.events);
      options.onFrame?.(out, video, mediaTimeMs);
    },
    options,
  );
  events.push(...(await recognizer.flush()).events);
  return { events, text: events.filter((e) => e.accepted).map((e) => e.gloss).join(' '), ...info };
}

/**
 * Teach a custom sign from (part of) a clip: the frames between `startMs` and `endMs` (default:
 * the whole clip) in which a hand is visible are stored as one example of `name`.
 * @returns {Promise<{ name: string, examples: number } | null>} null when too little was seen
 */
export async function teachFromVideo(recognizer, name, source, { startMs = 0, endMs = Infinity, fps = 30, ...rest } = {}) {
  const base = recognizer.lastTimestamp + 1000;
  const frames = [];
  await decodeVideoFrames(
    source,
    (video, mediaTimeMs) => {
      if (mediaTimeMs < startMs || mediaTimeMs > endMs) return;
      const seen = recognizer.landmarks(video, base + mediaTimeMs);
      frames.push({ frame: seen.frame, hands: seen.landmarks.hands.length > 0 });
    },
    { fps, ...rest },
  );
  // Drop the frames before the hands appear and after they are gone.
  const first = frames.findIndex((f) => f.hands);
  const last = frames.length - 1 - [...frames].reverse().findIndex((f) => f.hands);
  if (first < 0) return null;
  return recognizer.teachFrames(name, frames.slice(first, last + 1).map((f) => f.frame), fps);
}
