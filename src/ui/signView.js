// Sign -> Text tab: camera (or a video file) -> signs -> text.
// The reading itself is done by a "reader" (see readers.js): whole signs or fingerspelling.
import { SIGN, SPOKEN } from '../core/languages.js';
import { Camera, frameLoop, fitOverlay } from '../vision/mediapipe.js';
import { LettersReader, WordsReader } from './readers.js';

/** Reader factories per mode. `available(signCode)` says whether a mode supports a language. */
export const READ_MODES = {
  // The whole-sign model was trained on ASL only.
  words: { label: 'Whole signs (words)', available: (signCode) => signCode === 'asl', create: () => new WordsReader() },
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
  let pendingTeach = null; // word to learn from the next opened video

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
    renderTaught();
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
    if (!reader.ready) return;
    show((ctx, width, height) => reader.frame(frame, time, ctx, width, height));
  }

  /** Clear the overlay, let `render` draw on it, and show the state it returns. */
  function show(render) {
    const ctx = fitOverlay(overlay, video);
    const { width, height } = overlay;
    ctx.clearRect(0, 0, width, height);
    const state = render(ctx, width, height);
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
      stopLoop = null;
      camButton.textContent = '■ Stop';
      camButton.classList.add('on');
      if (camera.facing === 'file' && reader.readFile) {
        // Clips are read frame by frame rather than in real time: slower machines lose nothing.
        video.pause();
        await readClip();
      } else {
        stopLoop = frameLoop(video, onFrame);
        setStatus(camera.facing === 'file' ? 'Reading signs from the video' : 'Reading signs');
      }
    } catch (err) {
      setStatus(`Could not start: ${err.message}`);
    }
    camButton.disabled = false;
    fileButton.disabled = false;
  }

  /** Read (or, when a word is waiting to be taught, learn from) the clip now in the player. */
  async function readClip() {
    if (pendingTeach) {
      const name = pendingTeach;
      pendingTeach = null;
      setStatus(`Learning "${name}" from the video…`);
      try {
        const captured = await reader.teachFile(name, video);
        $('teach-status').textContent = `Learned "${captured.name}" (${captured.examples} example${captured.examples === 1 ? '' : 's'}). Open the video again to check it is recognised.`;
        $('teach-name').value = '';
      } catch (err) {
        $('teach-status').textContent = `Could not learn it: ${err.message}`;
      }
      teachBox.classList.remove('armed');
      renderTaught();
      setStatus('Sign learned — open a video or start the camera');
      return;
    }
    setStatus('Reading signs from the video…');
    if (await reader.readFile(video, show)) {
      nowBig.textContent = reader.words.at(-1) || nowBig.textContent;
    }
    renderText();
    setStatus('Video finished — open another, or start the camera');
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
  video.addEventListener('ended', async () => {
    setStatus('Video finished — open another, or start the camera');
    // A sign may still be open when the clip stops; let the reader close it.
    if (await reader.finish?.()) {
      nowBig.textContent = reader.last?.gloss || nowBig.textContent;
      renderText();
    }
  });
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

  // --- Teaching new signs (readers that support it) ---------------------------------
  const teachBox = $('teach');
  function renderTaught() {
    teachBox.hidden = !reader.canTeach;
    if (!reader.canTeach) return;
    $('teach-list').replaceChildren(
      ...reader.taught().map(({ name, examples }) => {
        const chip = Object.assign(document.createElement('span'), { className: 'chip', textContent: `${name} ×${examples}` });
        const remove = Object.assign(document.createElement('button'), { textContent: '✕', title: `Forget "${name}"` });
        remove.addEventListener('click', () => {
          reader.forget(name);
          renderTaught();
        });
        chip.append(remove);
        return chip;
      }),
    );
  }
  $('teach-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('teach-name').value.trim();
    if (!name || !reader.canTeach) return;
    const teaching = reader;
    teachBox.classList.add('armed');
    if (!camera.running || camera.facing === 'file') {
      // No live camera: learn it from the next video that is opened.
      pendingTeach = name;
      $('teach-status').textContent = `Now press "Open video" and choose a clip that shows only the sign for "${name}".`;
      return;
    }
    $('teach-status').textContent = `Now show the sign for "${name}" once, then lower your hands (or let the clip end)…`;
    try {
      const captured = await teaching.teach(name);
      $('teach-status').textContent = `Learned "${captured.name}" (${captured.examples} example${captured.examples === 1 ? '' : 's'}). Teach it again to add another example.`;
      $('teach-name').value = '';
    } catch (err) {
      $('teach-status').textContent = `Could not learn it: ${err.message}`;
    }
    teachBox.classList.remove('armed');
    renderTaught();
  });
  // The teach panel depends on the loaded model, so refresh it whenever a reader becomes ready.
  setInterval(() => reader?.ready && teachBox.hidden === Boolean(reader.canTeach) && renderTaught(), 500);

  chooseReader();
  /** Load the current reader's models ahead of time (called when the tab is opened). */
  function prepare() {
    const loading = reader;
    if (loading.ready || loading.loading) return;
    loading.loading = true;
    setStatus('Loading sign reader…');
    loading
      .load()
      .then(() => {
        loading.ready = true;
        if (reader === loading && !camera.running) setStatus('Sign reader ready');
      })
      .catch((err) => setStatus(`Could not load the sign reader: ${err.message}`))
      .finally(() => (loading.loading = false));
  }

  return { stop, prepare, startFile: (file) => start(file) };
}
