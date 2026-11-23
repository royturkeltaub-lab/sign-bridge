// Eval runner: compares each case's actual output with its known-correct result.
import { TASKS } from './tasks.js';

/** Comparison ignores case, niqqud-free spacing and repeated whitespace. */
export function normalize(value) {
  return String(value).trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Accepted answers for a case: `expected` (string) and/or `accept` (array of strings). */
export function acceptedAnswers(testCase) {
  const list = [];
  if (testCase.expected != null) list.push(testCase.expected);
  if (Array.isArray(testCase.accept)) list.push(...testCase.accept);
  return list;
}

/**
 * Run one suite.
 * @param {{id: string, title: string, task: string, cases: Array, defaults?: object}} suite
 * @param {object} env shared resources, e.g. { model } for detector tasks
 */
export async function runSuite(suite, env = {}) {
  const task = TASKS[suite.task];
  if (!task) throw new Error(`Suite "${suite.id}" uses unknown task "${suite.task}"`);
  const results = [];
  for (const testCase of suite.cases) {
    const input =
      suite.defaults && typeof testCase.input === 'object' && !Array.isArray(testCase.input)
        ? { ...suite.defaults, ...testCase.input }
        : suite.defaults && typeof testCase.input === 'string' && suite.wrap
          ? { ...suite.defaults, [suite.wrap]: testCase.input }
          : testCase.input;
    let actual;
    let error = null;
    try {
      actual = await task(input, env);
    } catch (err) {
      error = err.message;
      actual = `ERROR: ${err.message}`;
    }
    const accepted = acceptedAnswers(testCase);
    const pass = !error && accepted.some((answer) => normalize(answer) === normalize(actual));
    results.push({
      id: testCase.id,
      input: testCase.label ?? (typeof testCase.input === 'string' ? testCase.input : testCase.input?.text ?? JSON.stringify(testCase.input).slice(0, 80)),
      expected: accepted.join('  |  '),
      actual,
      pass,
      note: testCase.note || '',
    });
  }
  const passed = results.filter((r) => r.pass).length;
  return {
    id: suite.id,
    title: suite.title,
    description: suite.description || '',
    task: suite.task,
    passed,
    total: results.length,
    accuracy: results.length ? passed / results.length : 0,
    results,
  };
}

export async function runSuites(suites, env = {}) {
  const reports = [];
  for (const suite of suites) reports.push(await runSuite(suite, env));
  const passed = reports.reduce((s, r) => s + r.passed, 0);
  const total = reports.reduce((s, r) => s + r.total, 0);
  return { passed, total, accuracy: total ? passed / total : 0, suites: reports };
}

/** Confusion pairs (expected -> actual) for failed cases, most frequent first. */
export function confusions(report) {
  const counts = new Map();
  for (const r of report.results) {
    if (r.pass) continue;
    const key = `${r.expected} → ${r.actual}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
