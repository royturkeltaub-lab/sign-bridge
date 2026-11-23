// Speech -> Sign tab: microphone -> transcript (+ spoken language) -> signs on the avatar,
// with the camera following whoever is speaking.
import { SPOKEN, SIGN, signLanguagesFor, defaultSignLanguage, detectTextLanguage } from '../core/languages.js';
import { textToPlan } from '../translate/gloss.js';
import { Microphone } from '../speech/mic.js';
import { Transcriber } from '../speech/transcriber.js';
import { Camera, createFaceLandmarker, frameLoop, fitOverlay } from '../vision/mediapipe.js';
import { ActiveSpeakerSelector, mouthOpenness, faceBox, lipsBox, LIPS_OUTER, LIPS_INNER } from '../vision/activeSpeaker.js';
import { SignPlayer } from './player.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

export function initListenView({ setStatus }) {
  const player = new SignPlayer($('avatar'), $('caption'));
  const signSelect = $('sign-lang-out');
  const transcript = $('transcript');
  const offer = $('offer');
  const micButton = $('mic-btn');
  const camButton = $('listen-cam-btn');
  const video = $('listen-video');
  const overlay = $('listen-overlay');
  const chip = $('speaker-chip');

  const transcriber = new Transcriber(setStatus);
  const camera = new Camera(video);
  const speakers = new ActiveSpeakerSelector();
  const accepted = new Set(); // spoken languages the user already agreed to switch for
  let signCode = 'asl';
  let pendingOffer = null;
  let faceLandmarker = null;
  let stopLoop = null;
  let speakerNow = null; // track id of the current speaker
  let speakerAtSpeech = null; // speaker while the current utterance was being said
  let showLips = true;

  for (const lang of Object.values(SIGN)) {
    signSelect.append(el('option', { value: lang.code, textContent: `${lang.shortName} — ${lang.name}` }));
  }

  function setSignLanguage(code) {
    signCode = code;
    signSelect.value = code;
  }

  function addLine(text, tag, dir = 'auto', pending = false) {
    if (transcript.querySelector('.muted:only-child')) transcript.replaceChildren();
    const line = el('div', { className: `line${pending ? ' pending' : ''}` }, [
      el('span', { className: 'tag', textContent: tag }),
      el('span', { textContent: text, dir }),
    ]);
    transcript.append(line);
    transcript.scrollTop = transcript.scrollHeight;
    return line;
  }

  function sign(text, spokenCode) {
    const plan = textToPlan(text, signCode);
    if (!plan.length) return false;
    player.play(plan, SPOKEN[spokenCode].dir);
    return true;
  }

  /** Offer the sign language native to the detected spoken language. */
  function showOffer(spokenCode, text) {
    const spoken = SPOKEN[spokenCode];
    const options = signLanguagesFor(spokenCode);
    pendingOffer = { spokenCode, text };
    $('offer-text').replaceChildren(
      el('strong', { textContent: `${spoken.name} detected. ` }),
      `Show signs in ${options[0].name}?`,
    );
    $('offer-actions').replaceChildren(
      ...options.map((lang, i) =>
        el('button', {
          className: `btn small${i === 0 ? ' primary' : ''}`,
          textContent: `Use ${lang.shortName}`,
          onclick: () => {
            accepted.add(spokenCode);
            setSignLanguage(lang.code);
            offer.hidden = true;
            if (pendingOffer) sign(pendingOffer.text, pendingOffer.spokenCode);
            pendingOffer = null;
          },
        }),
      ),
      el('button', {
        className: 'btn small',
        textContent: 'Not now',
        onclick: () => {
          offer.hidden = true;
          pendingOffer = null;
        },
      }),
    );
    offer.hidden = false;
  }

  /** Route a sentence (heard or typed) to the avatar, offering a language switch if needed. */
  function handleText(text, spokenCode, tag) {
    if (!SPOKEN[spokenCode]) {
      addLine(`${text} — this language is not supported yet`, tag);
      return;
    }
    addLine(text, `${tag} · ${SPOKEN[spokenCode].name}`, SPOKEN[spokenCode].dir);
    const current = SIGN[signCode];
    if (current.spoken === spokenCode) {
      offer.hidden = true;
      sign(text, spokenCode);
    } else if (accepted.has(spokenCode)) {
      setSignLanguage(defaultSignLanguage(spokenCode).code);
      sign(text, spokenCode);
    } else {
      showOffer(spokenCode, text);
    }
  }

  // --- Microphone -----------------------------------------------------------------
  const mic = new Microphone(onUtterance, ({ level, speaking }) => {
    $('mic-meter').style.width = `${Math.min(100, level * 900)}%`;
    if (speaking && speakerNow != null) speakerAtSpeech = speakerNow;
  });

  async function onUtterance({ audio }) {
    const who = speakerAtSpeech;
    speakerAtSpeech = null;
    const tag = who == null ? 'Heard' : `Person ${who}`;
    const line = addLine('…', tag, 'auto', true);
    try {
      const result = await transcriber.transcribe(audio);
      line.remove();
      if (!result.text) return;
      // Trust the script of the transcript over the audio guess when they disagree.
      const byScript = detectTextLanguage(result.text);
      const spokenCode = byScript.code && byScript.confidence > 0.8 ? byScript.code : result.language;
      handleText(result.text, spokenCode, tag);
    } catch (err) {
      line.remove();
      setStatus(`Could not transcribe: ${err.message}`);
    }
  }

  async function toggleMic() {
    if (mic.running) {
      mic.stop();
      micButton.textContent = '🎙 Start listening';
      micButton.classList.remove('on');
      $('mic-meter').style.width = '0';
      return;
    }
    micButton.disabled = true;
    try {
      await mic.start();
      micButton.textContent = '■ Stop listening';
      micButton.classList.add('on');
      transcriber.load(localStorage.getItem('sign-bridge.asr') || 'base').catch(() => {});
    } catch (err) {
      setStatus(`Microphone problem: ${err.message}`);
    }
    micButton.disabled = false;
  }

  // --- Camera: follow the loudest speaker --------------------------------------------
  function onFrame(frame, time) {
    const ctx = fitOverlay(overlay, frame);
    const { width, height } = overlay;
    ctx.clearRect(0, 0, width, height);
    const result = faceLandmarker.detectForVideo(frame, time);
    const faces = result.faceLandmarks.map((landmarks, i) => ({
      landmarks,
      box: faceBox(landmarks),
      mouthOpen: mouthOpenness(landmarks, result.faceBlendshapes?.[i]?.categories),
    }));
    const state = speakers.update(time, mic.running ? mic.level : 0, faces);
    speakerNow = state.selectedId;
    const selected = state.tracks.find((t) => t.id === state.selectedId);
    if (selected) {
      // Spotlight: dim everything except the speaker.
      const pad = 0.35;
      const x = (selected.box.x - selected.box.w * pad) * width;
      const y = (selected.box.y - selected.box.h * pad) * height;
      const w = selected.box.w * (1 + 2 * pad) * width;
      const h = selected.box.h * (1 + 2 * pad) * height;
      ctx.fillStyle = 'rgba(8, 10, 14, 0.55)';
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.rect(x, y, w, h);
      ctx.fill('evenodd');
    }
    for (const track of state.tracks) {
      const isSpeaker = track.id === state.selectedId;
      ctx.strokeStyle = isSpeaker ? '#37d0a0' : 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = isSpeaker ? Math.max(4, width / 200) : Math.max(1.5, width / 500);
      ctx.strokeRect(track.box.x * width, track.box.y * height, track.box.w * width, track.box.h * height);
    }
    // Lip-reading aid: the speaker's lips (or the only face in view), outlined and enlarged.
    const lipsOf = selected || (state.tracks.length === 1 ? state.tracks[0] : null);
    if (showLips && lipsOf?.landmarks) drawLips(ctx, frame, lipsOf.landmarks, width, height);
    chip.hidden = !selected;
    if (selected) chip.textContent = `Following Person ${selected.id}${state.tracks.length > 1 ? ` of ${state.tracks.length} faces` : ''}`;
  }

  /** Trace a lip contour, mapping normalised landmark coordinates through `toPixel`. */
  function lipPath(ctx, landmarks, indices, toPixel) {
    indices.forEach((index, n) => {
      const [x, y] = toPixel(landmarks[index]);
      if (n) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
  }

  function strokeLips(ctx, landmarks, toPixel, lineWidth) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#ff5d8f';
    ctx.shadowBlur = lineWidth * 3;
    ctx.strokeStyle = '#ff7aa5';
    ctx.lineWidth = lineWidth;
    ctx.fillStyle = 'rgba(255, 93, 143, 0.22)';
    ctx.beginPath();
    lipPath(ctx, landmarks, LIPS_OUTER, toPixel);
    lipPath(ctx, landmarks, LIPS_INNER, toPixel);
    ctx.fill('evenodd'); // tint the lips, not the opening between them
    ctx.stroke();
    ctx.restore();
  }

  /** Outline the lips on the face and show them enlarged in a corner of the picture. */
  function drawLips(ctx, frame, landmarks, width, height) {
    strokeLips(ctx, landmarks, (p) => [p.x * width, p.y * height], Math.max(2, width / 320));
    // Enlarged view: a crop around the mouth, about twice the lips' width.
    const lips = lipsBox(landmarks);
    const cropW = Math.max(lips.w * 2, 0.04) * width;
    const cropH = cropW * 0.62;
    const cropX = (lips.x + lips.w / 2) * width - cropW / 2;
    const cropY = (lips.y + lips.h / 2) * height - cropH / 2;
    const viewW = width * 0.34;
    const viewH = viewW * 0.62;
    const viewX = width - viewW - width * 0.02;
    const viewY = width * 0.02;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(viewX, viewY, viewW, viewH, width * 0.015);
    ctx.clip();
    ctx.drawImage(frame, cropX, cropY, cropW, cropH, viewX, viewY, viewW, viewH);
    const zoom = viewW / cropW;
    strokeLips(ctx, landmarks, (p) => [viewX + (p.x * width - cropX) * zoom, viewY + (p.y * height - cropY) * zoom], Math.max(2, width / 260));
    ctx.restore();
    ctx.strokeStyle = '#ff7aa5';
    ctx.lineWidth = Math.max(2, width / 400);
    ctx.beginPath();
    ctx.roundRect(viewX, viewY, viewW, viewH, width * 0.015);
    ctx.stroke();
  }

  async function startCamera(facing) {
    camButton.disabled = true;
    try {
      setStatus('Loading face tracker…');
      faceLandmarker ||= await createFaceLandmarker(4);
      await camera.start(facing);
      const mirror = camera.facing === 'user' ? 'scaleX(-1)' : 'none';
      video.style.transform = mirror;
      overlay.style.transform = mirror;
      $('listen-empty').hidden = true;
      stopLoop?.();
      stopLoop = frameLoop(video, onFrame);
      camButton.textContent = '📷 Camera off';
      setStatus(mic.running ? 'Listening' : 'Camera on — start listening to follow the speaker');
    } catch (err) {
      setStatus(`Camera problem: ${err.message}`);
    }
    camButton.disabled = false;
  }

  function stopCamera() {
    stopLoop?.();
    stopLoop = null;
    camera.stop();
    speakerNow = null;
    chip.hidden = true;
    $('listen-empty').hidden = false;
    camButton.textContent = '📷 Camera on';
  }

  // --- Wiring -----------------------------------------------------------------------
  micButton.addEventListener('click', toggleMic);
  camButton.addEventListener('click', () => (camera.running ? stopCamera() : startCamera()));
  $('listen-flip-btn').addEventListener('click', () => camera.running && startCamera(camera.facing === 'user' ? 'environment' : 'user'));
  $('lips-btn').addEventListener('click', (event) => {
    showLips = !showLips;
    event.currentTarget.setAttribute('aria-pressed', String(showLips));
  });
  signSelect.addEventListener('change', () => setSignLanguage(signSelect.value));
  $('speed').addEventListener('input', (event) => (player.speed = Number(event.target.value)));
  $('replay-btn').addEventListener('click', () => player.replay());
  $('type-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('type-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const detected = detectTextLanguage(text);
    handleText(text, detected.code || SIGN[signCode].spoken, 'Typed');
  });

  setSignLanguage(signCode);
  // The starting language needs no offer when the conversation comes back to it.
  accepted.add(SIGN[signCode].spoken);
  return { stopCamera, handleText, player };
}
