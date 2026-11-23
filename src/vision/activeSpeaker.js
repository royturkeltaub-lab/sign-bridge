// Active-speaker selection: decides which face on camera belongs to the person talking.
//
// A laptop microphone cannot tell where a sound comes from, so the loudest speaker is
// located by matching the audio with what the camera sees: the face whose mouth moves
// while the microphone is loud collects evidence, and the face with the most evidence wins.

export const SPEAKER_DEFAULTS = {
  matchDistance: 0.18, // max centre movement (fraction of frame) to keep a face identity
  forgetMs: 1200, // drop faces unseen for this long
  decayMs: 1500, // evidence half-life
  switchRatio: 1.35, // a challenger must beat the current speaker by this factor
  minEvidence: 0.004, // evidence needed before anyone is selected
  holdMs: 2500, // keep the last speaker selected this long after they go quiet
  levelFloor: 0.012, // audio RMS treated as silence
  levelFull: 0.08, // audio RMS treated as full loudness
};

/** Mouth opening (0..~1) from MediaPipe FaceLandmarker output for one face. */
export function mouthOpenness(landmarks, blendshapes) {
  if (blendshapes) {
    const jaw = blendshapes.find((c) => c.categoryName === 'jawOpen');
    if (jaw) return jaw.score;
  }
  // Inner lips (13, 14) relative to face height (10 = forehead top, 152 = chin).
  const lip = Math.hypot(landmarks[13].x - landmarks[14].x, landmarks[13].y - landmarks[14].y);
  const face = Math.hypot(landmarks[10].x - landmarks[152].x, landmarks[10].y - landmarks[152].y);
  return face > 0 ? Math.min(1, (lip / face) * 4) : 0;
}

/** Bounding box { x, y, w, h, cx, cy } in normalised image coordinates. */
export function faceBox(landmarks) {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

export class ActiveSpeakerSelector {
  constructor(options = {}) {
    this.o = { ...SPEAKER_DEFAULTS, ...options };
    this.tracks = new Map(); // id -> track
    this.nextId = 1;
    this.selectedId = null;
    this.selectedAt = 0;
    this.lastTime = null;
  }

  /**
   * @param {number} time ms timestamp
   * @param {number} audioLevel microphone RMS for this moment
   * @param {Array<{box: object, mouthOpen: number}>} faces detections in this frame
   * @returns {{selectedId: number|null, tracks: Array}} current state
   */
  update(time, audioLevel, faces) {
    const { o } = this;
    const dt = this.lastTime == null ? 0 : Math.min(250, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const loudness = Math.max(0, Math.min(1, (audioLevel - o.levelFloor) / (o.levelFull - o.levelFloor)));
    const decay = dt > 0 ? Math.pow(0.5, dt / o.decayMs) : 1;

    // Match detections to existing tracks, nearest centre first.
    const unmatched = new Set(this.tracks.keys());
    const pairs = [];
    faces.forEach((face, fi) => {
      for (const [id, track] of this.tracks) {
        const d = Math.hypot(face.box.cx - track.box.cx, face.box.cy - track.box.cy);
        if (d <= o.matchDistance) pairs.push({ d, fi, id });
      }
    });
    pairs.sort((a, b) => a.d - b.d);
    const assigned = new Map();
    for (const { fi, id } of pairs) {
      if (assigned.has(fi) || !unmatched.has(id)) continue;
      assigned.set(fi, id);
      unmatched.delete(id);
    }

    faces.forEach((face, fi) => {
      let track = this.tracks.get(assigned.get(fi));
      if (!track) {
        track = { id: this.nextId++, box: face.box, mouthOpen: face.mouthOpen, evidence: 0, activity: 0, seenAt: time };
        this.tracks.set(track.id, track);
      } else {
        // Mouth movement per second, smoothed; it only counts while the room is loud.
        const speed = dt > 0 ? Math.abs(face.mouthOpen - track.mouthOpen) / (dt / 1000) : 0;
        track.activity = track.activity * 0.6 + speed * 0.4;
        track.evidence = track.evidence * decay + track.activity * loudness * (dt / 1000);
        track.box = face.box;
        track.mouthOpen = face.mouthOpen;
        track.seenAt = time;
      }
    });
    for (const id of unmatched) {
      const track = this.tracks.get(id);
      track.evidence *= decay;
      if (time - track.seenAt > o.forgetMs) this.tracks.delete(id);
    }

    this.select(time);
    return { selectedId: this.selectedId, tracks: [...this.tracks.values()] };
  }

  select(time) {
    const { o } = this;
    let best = null;
    for (const track of this.tracks.values()) {
      if (!best || track.evidence > best.evidence) best = track;
    }
    const current = this.tracks.get(this.selectedId);
    if (!current) this.selectedId = null;
    if (best && best.evidence >= o.minEvidence) {
      const beatsCurrent = !current || best.id === current.id || best.evidence > current.evidence * o.switchRatio;
      if (beatsCurrent) {
        this.selectedId = best.id;
        this.selectedAt = time;
      } else if (current.evidence >= o.minEvidence) {
        this.selectedAt = time;
      }
    } else if (current && time - this.selectedAt > o.holdMs) {
      this.selectedId = null;
    }
  }
}
