// Speech -> Sign tab: microphone -> transcript (+ spoken language) -> signs on the avatar,
// with the camera following whoever is speaking.
import { SPOKEN, SIGN, signLanguagesFor, defaultSignLanguage, detectTextLanguage } from '../core/languages.js';
import { textToPlan } from '../translate/gloss.js';
import { Microphone } from '../speech/mic.js';
import { Transcriber } from '../speech/transcriber.js';
import { Camera, createFaceLandmarker, frameLoop, fitOverlay } from '../vision/mediapipe.js';
import { ActiveSpeakerSelector, mouthOpenness, faceBox } from '../vision/activeSpeaker.js';
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
    chip.hidden = !selected;
    if (selected) chip.textContent = `Following Person ${selected.id}${state.tracks.length > 1 ? ` of ${state.tracks.length} faces` : ''}`;
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
