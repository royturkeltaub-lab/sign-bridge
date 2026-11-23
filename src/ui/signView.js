// Sign -> Text tab: camera (or a video file) -> signs -> text.
// The reading itself is done by a "reader" (see readers.js): whole signs or fingerspelling.
import { SIGN, SPOKEN } from '../core/languages.js';
import { Camera, frameLoop, fitOverlay } from '../vision/mediapipe.js';
import { LettersReader } from './readers.js';

/** Reader factories per mode. `available(signCode)` says whether a mode supports a language. */
export const READ_MODES = {
  letters: { label: 'Fingerspelling (letters)', available: () => true, create: (signCode) => new LettersReader(signCode) },
};

export function initSignView({ setStatus }) {
  const $ = (id) => document.getElementById(id);
  const video = $('sign-video');
  const overlay = $('sign-overlay');
  const camButton = $('sign-cam-btn');
  const fileButton = $('sign-file-btn');
  const fileInput = $('sign-file');
  const langSelect = $('sign-lang-in');
  const modeSelect = $('sign-mode');
  const output = $('sign-output');
  const nowBig = $('now-letter');
  const camera = new Camera(video);
  const readers = new Map(); // "mode:lang" -> reader, so text survives switching back and forth
  let reader = null;
  let stopLoop = null;

  for (const lang of Object.values(SIGN)) {
    langSelect.append(Object.assign(document.createElement('option'), { value: lang.code, textContent: `${lang.shortName} — ${lang.name}` }));
  }

  function renderText() {
    output.replaceChildren(document.createTextNode(reader ? reader.text : ''), Object.assign(document.createElement('span'), { className: 'caret' }));
  }

  /** Rebuild the mode list for the chosen language and pick the reader. */
  function chooseReader() {
    const lang = SIGN[langSelect.value];
    const wanted = modeSelect.value;
    modeSelect.replaceChildren(
      ...Object.entries(READ_MODES).map(([value, mode]) =>
        Object.assign(document.createElement('option'), {
          value,
          textContent: mode.available(lang.code) ? mode.label : `${mode.label} — ${lang.shortName} not supported yet`,
          disabled: !mode.available(lang.code),
        }),
      ),
    );
    const usable = Object.keys(READ_MODES).filter((m) => READ_MODES[m].available(lang.code));
    modeSelect.value = usable.includes(wanted) ? wanted : usable[0];
    const key = `${modeSelect.value}:${lang.code}`;
    if (!readers.has(key)) readers.set(key, READ_MODES[modeSelect.value].create(lang.code));
    reader = readers.get(key);
    output.dir = lang.dir;
    nowBig.classList.toggle('word', modeSelect.value !== 'letters');
    nowBig.textContent = '–';
    $('now-alternatives').textContent = '';
    $('sign-hint').textContent = reader.hint;
    renderText();
    // If the picture is already running, load this reader's models in the background.
    if (camera.running) {
      const loading = reader;
      loading.ready = false;
      setStatus('Loading sign reader…');
      loading
        .load()
        .then(() => {
          loading.ready = true;
          if (reader === loading) setStatus('Reading signs');
        })
        .catch((err) => setStatus(`Could not load the sign reader: ${err.message}`));
    }
  }

  function onFrame(frame, time) {
    const ctx = fitOverlay(overlay, frame);
    const { width, height } = overlay;
    ctx.clearRect(0, 0, width, height);
    if (!reader.ready) return;
    const state = reader.frame(frame, time, ctx, width, height);
    nowBig.textContent = state.big;
    $('now-detail').textContent = state.detail;
    $('now-conf').style.width = `${Math.round(Math.max(0, Math.min(1, state.progress)) * 100)}%`;
    $('now-alternatives').textContent = state.alternatives || '';
    if (state.changed) renderText();
  }

  /** Start reading from the camera (`source` = facing mode) or from a video File. */
  async function start(source) {
    camButton.disabled = true;
    fileButton.disabled = true;
    try {
      setStatus('Loading sign reader…');
      await reader.load();
      reader.ready = true;
      if (source instanceof File) await camera.startFile(source);
      else await camera.start(source);
      $('sign-empty').hidden = true;
      // Mirror the picture only for the selfie camera, like a mirror.
      const mirror = camera.facing === 'user' ? 'scaleX(-1)' : 'none';
      video.style.transform = mirror;
      overlay.style.transform = mirror;
      stopLoop?.();
      stopLoop = frameLoop(video, onFrame);
      camButton.textContent = '■ Stop';
      camButton.classList.add('on');
      setStatus(camera.facing === 'file' ? 'Reading signs from the video' : 'Reading signs');
    } catch (err) {
      setStatus(`Could not start: ${err.message}`);
    }
    camButton.disabled = false;
    fileButton.disabled = false;
  }

  function stop() {
    stopLoop?.();
    stopLoop = null;
    camera.stop();
    $('sign-empty').hidden = false;
    camButton.textContent = '📷 Start camera';
    camButton.classList.remove('on');
    setStatus('');
  }

  camButton.addEventListener('click', () => (camera.running ? stop() : start()));
  $('sign-flip-btn').addEventListener('click', () => {
    if (camera.running && camera.facing !== 'file') start(camera.facing === 'user' ? 'environment' : 'user');
  });
  fileButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files;
    fileInput.value = '';
    if (file) start(file);
  });
  // When a clip ends, keep the last frame and result on screen; "Stop" clears it.
  video.addEventListener('ended', () => setStatus('Video finished — open another, or start the camera'));
  langSelect.addEventListener('change', chooseReader);
  modeSelect.addEventListener('change', chooseReader);
  $('space-btn').addEventListener('click', () => {
    reader.space();
    renderText();
  });
  $('back-btn').addEventListener('click', () => {
    reader.backspace();
    renderText();
  });
  $('clear-btn').addEventListener('click', () => {
    reader.reset();
    renderText();
  });
  $('speak-btn').addEventListener('click', () => {
    if (!reader.text.trim() || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(reader.text);
    utterance.lang = SPOKEN[SIGN[langSelect.value].spoken].code === 'he' ? 'he-IL' : 'en-US';
    speechSynthesis.speak(utterance);
  });

  chooseReader();
  return { stop, startFile: (file) => start(file) };
}
