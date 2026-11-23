// App shell: tabs and status line; each tab's logic lives in its own module.
import { initListenView } from './listenView.js';
import { initSignView } from './signView.js';
import { initEvalView } from './evalView.js';

const status = document.getElementById('status');
const setStatus = (text) => {
  status.textContent = text || '';
};

const listen = initListenView({ setStatus });
const sign = initSignView({ setStatus });
const evals = initEvalView();
let evalsRan = false;

function showTab(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const panel of document.querySelectorAll('.panel')) {
    const active = panel.id === `panel-${name}`;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  }
  // Only one tab uses the camera at a time.
  if (name !== 'listen') listen.stopCamera();
  if (name !== 'sign') sign.stop();
  if (name === 'eval' && !evalsRan) {
    evalsRan = true;
    evals.run();
  }
  history.replaceState(null, '', `#${name}`);
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
}
const initial = location.hash.slice(1);
if (['listen', 'sign', 'eval'].includes(initial)) showTab(initial);

// Handy for demos and debugging from the console.
window.signBridge = { say: (text, lang = 'en') => listen.handleText(text, lang, 'Typed'), player: listen.player };
