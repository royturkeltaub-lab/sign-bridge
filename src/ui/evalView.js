// Eval tab: runs the same suites as `npm run eval`, plus cases added in the browser.
import { runSuites } from '../eval/runner.js';
import { generatedSuites, resetClassifiers } from '../eval/tasks.js';

const STORE_KEY = 'sign-bridge.custom-evals';
// Suites a person can extend from the form: plain text in, plain text out.
const ADDABLE = ['gloss-en-asl', 'plan-en-asl', 'plan-he-isl', 'text-language'];

const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

function loadCustom() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || [];
  } catch {
    return [];
  }
}

async function loadSuites(env) {
  const files = await (await fetch('/evals/index.json')).json();
  const suites = await Promise.all(files.map(async (f) => (await fetch(`/evals/cases/${f}`)).json()));
  for (const custom of loadCustom()) {
    const suite = suites.find((s) => s.id === custom.suite);
    if (suite) suite.cases.push({ id: `custom-${custom.id}`, input: custom.input, expected: custom.expected, note: 'Added in this browser' });
  }
  return [...suites, ...generatedSuites(env)];
}

function renderSuite(suite) {
  const level = suite.accuracy === 1 ? 'good' : suite.accuracy >= 0.8 ? 'mid' : 'low';
  const rows = suite.results.map((r) =>
    el('tr', {}, [
      el('td', { className: r.pass ? 'pass' : 'fail', textContent: r.pass ? '✓' : '✗' }),
      el('td', { textContent: r.input, dir: 'auto' }),
      el('td', { textContent: r.expected, dir: 'auto' }),
      el('td', { textContent: r.actual, dir: 'auto', className: r.pass ? '' : 'fail' }),
      el('td', { textContent: r.note, className: 'muted' }),
    ]),
  );
  const table = el('table', { className: 'cases' }, [
    el('thead', {}, [el('tr', {}, ['', 'Input', 'Expected', 'Actual', 'Note'].map((t) => el('th', { textContent: t })))]),
    el('tbody', {}, rows),
  ]);
  const details = el('details', { className: 'card suite', open: suite.passed !== suite.total }, [
    el('summary', {}, [
      el('span', { textContent: suite.title }),
      el('span', { className: `score ${level}`, textContent: `${suite.passed}/${suite.total}  ${(suite.accuracy * 100).toFixed(0)}%` }),
    ]),
    el('p', { className: 'muted hint', textContent: suite.description }),
    table,
  ]);
  return details;
}

export function initEvalView() {
  const runButton = document.getElementById('eval-run');
  const summary = document.getElementById('eval-summary');
  const results = document.getElementById('eval-results');
  const form = document.getElementById('eval-add');
  const suiteSelect = document.getElementById('eval-add-suite');
  let model = null;
  let testSamples = null;

  async function run() {
    runButton.disabled = true;
    runButton.textContent = 'Running…';
    try {
      model ||= await (await fetch('/models/handshapes.json', { cache: 'no-cache' })).json();
      resetClassifiers();
      testSamples ||= await fetch('/evals/data/landmarks-test.json')
        .then((r) => (r.ok ? r.json() : { samples: [] }))
        .then((d) => d.samples)
        .catch(() => []);
      const env = { model, testSamples };
      const report = await runSuites(await loadSuites(env), env);
      const failing = report.suites.filter((s) => s.passed !== s.total).length;
      summary.replaceChildren(
        el('div', { className: 'summary-grid' }, [
          el('div', { className: 'summary-tile' }, [el('div', { className: 'num', textContent: `${(report.accuracy * 100).toFixed(1)}%` }), 'cases passing']),
          el('div', { className: 'summary-tile' }, [el('div', { className: 'num', textContent: `${report.passed}/${report.total}` }), 'cases']),
          el('div', { className: 'summary-tile' }, [el('div', { className: 'num', textContent: String(failing) }), 'suites with failures']),
        ]),
      );
      results.replaceChildren(...report.suites.map(renderSuite));
    } catch (err) {
      summary.textContent = `Could not run evals: ${err.message}`;
    }
    runButton.disabled = false;
    runButton.textContent = 'Run all';
  }

  fetch('/evals/index.json')
    .then((r) => r.json())
    .then(async (files) => {
      const suites = await Promise.all(files.map(async (f) => (await fetch(`/evals/cases/${f}`)).json()));
      for (const suite of suites.filter((s) => ADDABLE.includes(s.id))) {
        suiteSelect.append(el('option', { value: suite.id, textContent: suite.title }));
      }
    })
    .catch(() => {});

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('eval-add-input');
    const expected = document.getElementById('eval-add-expected');
    const custom = loadCustom();
    custom.push({ id: Date.now(), suite: suiteSelect.value, input: input.value, expected: expected.value });
    localStorage.setItem(STORE_KEY, JSON.stringify(custom));
    input.value = '';
    expected.value = '';
    run();
  });

  runButton.addEventListener('click', run);
  return { run };
}
