import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, acceptedAnswers, runSuite, runSuites, confusions } from '../src/eval/runner.js';
import { TASKS } from '../src/eval/tasks.js';

const suite = (overrides) => ({ id: 's', title: 'Suite', task: 'text-language', cases: [], ...overrides });

describe('normalize', () => {
  test('ignores case, surrounding and repeated whitespace', () => {
    assert.equal(normalize('  hello   world \n'), 'HELLO WORLD');
    assert.equal(normalize('Hello\tWorld'), normalize('hello world'));
    assert.equal(normalize(''), '');
    assert.equal(normalize('   '), '');
  });

  test('coerces non-strings', () => {
    assert.equal(normalize(12), '12');
    assert.equal(normalize(true), 'TRUE');
  });

  test('leaves Hebrew and notation characters intact', () => {
    assert.equal(normalize(' שלום  #ד-נ-ה '), 'שלום #ד-נ-ה');
    assert.equal(normalize('#p-a-r-i-s'), '#P-A-R-I-S');
  });
});

describe('acceptedAnswers', () => {
  test('combines expected and accept', () => {
    assert.deepEqual(acceptedAnswers({ expected: 'A' }), ['A']);
    assert.deepEqual(acceptedAnswers({ accept: ['B', 'C'] }), ['B', 'C']);
    assert.deepEqual(acceptedAnswers({ expected: 'A', accept: ['B', 'C'] }), ['A', 'B', 'C']);
  });

  test('an empty string is a valid expected answer; missing answers give an empty list', () => {
    assert.deepEqual(acceptedAnswers({ expected: '' }), ['']);
    assert.deepEqual(acceptedAnswers({}), []);
    assert.deepEqual(acceptedAnswers({ expected: null, accept: 'not-an-array' }), []);
  });
});

describe('runSuite', () => {
  test('counts passes and failures', async () => {
    const report = await runSuite(
      suite({
        cases: [
          { id: 'a', input: 'hello', expected: 'en' },
          { id: 'b', input: 'שלום', expected: 'he' },
          { id: 'c', input: 'hello', expected: 'he', note: 'deliberately wrong' },
          { id: 'd', input: '123', expected: 'none' },
        ],
      }),
    );
    assert.equal(report.id, 's');
    assert.equal(report.title, 'Suite');
    assert.equal(report.task, 'text-language');
    assert.equal(report.description, '');
    assert.equal(report.total, 4);
    assert.equal(report.passed, 3);
    assert.equal(report.accuracy, 0.75);
    assert.deepEqual(report.results.map((r) => r.pass), [true, true, false, true]);
    assert.deepEqual(report.results[2], {
      id: 'c',
      input: 'hello',
      expected: 'he',
      actual: 'en',
      pass: false,
      note: 'deliberately wrong',
    });
  });

  test('comparison is case- and whitespace-insensitive', async () => {
    const report = await runSuite(
      suite({ task: 'plan', cases: [{ id: 'a', input: { text: 'Hello Paris', sign: 'asl' }, expected: ' hello   #p-a-r-i-s ' }] }),
    );
    assert.equal(report.passed, 1);
  });

  test('any of `expected` + `accept` passes', async () => {
    const report = await runSuite(
      suite({
        cases: [
          { id: 'a', input: 'hello', expected: 'he', accept: ['fr', 'EN'] },
          { id: 'b', input: 'hello', accept: ['en'] },
          { id: 'c', input: 'hello', accept: ['he', 'fr'] },
        ],
      }),
    );
    assert.deepEqual(report.results.map((r) => r.pass), [true, true, false]);
    assert.equal(report.results[0].expected, 'he  |  fr  |  EN');
  });

  test('a case with no accepted answer fails', async () => {
    const report = await runSuite(suite({ cases: [{ id: 'a', input: 'hello' }] }));
    assert.equal(report.passed, 0);
    assert.equal(report.results[0].expected, '');
  });

  test('an expected empty string matches an empty result', async () => {
    const report = await runSuite(suite({ task: 'plan', cases: [{ id: 'a', input: { text: '?!', sign: 'asl' }, expected: '' }] }));
    assert.equal(report.passed, 1);
  });

  test('unknown task is an error that names the suite and the task', async () => {
    await assert.rejects(runSuite(suite({ id: 'mine', task: 'nope' })), /Suite "mine" uses unknown task "nope"/);
    await assert.rejects(runSuite(suite({ task: undefined })), /unknown task/);
  });

  test('a throwing task is reported as a failed case, not a crash', async () => {
    const report = await runSuite(
      suite({
        task: 'gloss',
        cases: [
          { id: 'boom', input: { text: 'hello', sign: 'bsl' }, expected: 'HELLO' },
          { id: 'ok', input: { text: 'hello', sign: 'asl' }, expected: 'HELLO' },
          // Even an "expected" value equal to the error text must not count as a pass.
          { id: 'sneaky', input: { text: 'hello', sign: 'bsl' }, expected: 'ERROR: Unsupported sign language: bsl' },
        ],
      }),
    );
    assert.equal(report.total, 3);
    assert.equal(report.passed, 1);
    assert.deepEqual(report.results.map((r) => r.pass), [false, true, false]);
    assert.equal(report.results[0].actual, 'ERROR: Unsupported sign language: bsl');
  });

  test('an async task is awaited and a rejected one is a failed case', async (t) => {
    TASKS.__async = async (input) => {
      if (input === 'bad') throw new Error('rejected');
      return `got ${input}`;
    };
    t.after(() => delete TASKS.__async);
    const report = await runSuite(
      suite({ task: '__async', cases: [{ id: 'a', input: 'x', expected: 'got x' }, { id: 'b', input: 'bad', expected: 'got bad' }] }),
    );
    assert.deepEqual(report.results.map((r) => r.pass), [true, false]);
    assert.equal(report.results[1].actual, 'ERROR: rejected');
  });

  test('env is passed to the task', async (t) => {
    TASKS.__env = (input, env) => env.prefix + input;
    t.after(() => delete TASKS.__env);
    const report = await runSuite(suite({ task: '__env', cases: [{ id: 'a', input: 'x', expected: 'p-x' }] }), { prefix: 'p-' });
    assert.equal(report.passed, 1);
  });

  test('suite defaults are merged into object inputs; the case wins', async () => {
    const report = await runSuite(
      suite({
        task: 'plan',
        defaults: { sign: 'asl' },
        cases: [
          { id: 'a', input: { text: 'hello' }, expected: 'HELLO' },
          { id: 'b', input: { text: 'שלום', sign: 'isl' }, expected: 'שלום' },
        ],
      }),
    );
    assert.equal(report.passed, 2);
    assert.deepEqual(report.results.map((r) => r.input), ['hello', 'שלום']);
  });

  test('`wrap` turns string inputs into objects using the defaults', async () => {
    const report = await runSuite(
      suite({ task: 'plan', defaults: { sign: 'asl' }, wrap: 'text', cases: [{ id: 'a', input: 'hello', expected: 'HELLO' }] }),
    );
    assert.equal(report.passed, 1);
    assert.equal(report.results[0].input, 'hello');
  });

  test('result labels: explicit label, then text, then truncated JSON', async () => {
    const long = Array.from({ length: 60 }, () => ['A', 700]);
    const report = await runSuite(
      suite({
        task: 'speller',
        cases: [
          { id: 'a', label: 'O K', input: [['O', 700], ['K', 700]], expected: 'OK' },
          { id: 'b', input: [['O', 700]], expected: 'O' },
          { id: 'c', input: long, expected: 'x' },
        ],
      }),
    );
    assert.equal(report.results[0].input, 'O K');
    assert.equal(report.results[1].input, '[["O",700]]');
    assert.equal(report.results[2].input.length, 80);
    assert.equal(report.passed, 2);
  });

  test('an empty suite has zero accuracy rather than NaN', async () => {
    const report = await runSuite(suite({ description: 'd' }));
    assert.equal(report.total, 0);
    assert.equal(report.passed, 0);
    assert.equal(report.accuracy, 0);
    assert.equal(report.description, 'd');
  });
});

describe('runSuites', () => {
  test('aggregates across suites', async () => {
    const report = await runSuites([
      suite({ id: 'one', cases: [{ id: 'a', input: 'hello', expected: 'en' }, { id: 'b', input: 'hello', expected: 'he' }] }),
      suite({ id: 'two', task: 'sign-offer', cases: [{ id: 'a', input: 'he', expected: 'isl' }, { id: 'b', input: 'xx', expected: 'none' }] }),
    ]);
    assert.equal(report.total, 4);
    assert.equal(report.passed, 3);
    assert.equal(report.accuracy, 0.75);
    assert.deepEqual(report.suites.map((s) => [s.id, s.passed, s.total]), [['one', 1, 2], ['two', 2, 2]]);
  });

  test('no suites', async () => {
    assert.deepEqual(await runSuites([]), { passed: 0, total: 0, accuracy: 0, suites: [] });
  });

  test('an unknown task in any suite rejects the whole run', async () => {
    await assert.rejects(runSuites([suite({}), suite({ id: 'bad', task: 'nope' })]), /"bad"/);
  });
});

describe('confusions', () => {
  test('groups failed cases by expected -> actual, most frequent first', async () => {
    const report = await runSuite(
      suite({
        cases: [
          { id: 'a', input: 'hello', expected: 'he' },
          { id: 'b', input: 'שלום', expected: 'en' },
          { id: 'c', input: 'world', expected: 'he' },
          { id: 'd', input: 'ok', expected: 'en' },
        ],
      }),
    );
    assert.deepEqual(confusions(report), [['he → en', 2], ['en → he', 1]]);
  });

  test('no failures, no confusions', () => {
    assert.deepEqual(confusions({ results: [{ pass: true, expected: 'a', actual: 'a' }] }), []);
    assert.deepEqual(confusions({ results: [] }), []);
  });
});

describe('built-in tasks (pure ones)', () => {
  test('text-language / sign-offer / letter-shape', () => {
    assert.equal(TASKS['text-language']('hello'), 'en');
    assert.equal(TASKS['text-language']('...'), 'none');
    assert.equal(TASKS['sign-offer']('en'), 'asl');
    assert.equal(TASKS['sign-offer']('fr'), 'none');
    assert.equal(TASKS['letter-shape']({ letter: 'J', sign: 'asl' }), 'I+move');
    assert.equal(TASKS['letter-shape']({ letter: 'A', sign: 'asl' }), 'A');
    assert.equal(TASKS['letter-shape']({ letter: 'ך', sign: 'isl' }), 'C+move');
    assert.equal(TASKS['letter-shape']({ letter: '?', sign: 'isl' }), 'none');
  });

  test('gloss / plan', () => {
    assert.equal(TASKS.gloss({ text: "What's your name?", sign: 'asl' }), 'YOUR NAME WHAT');
    assert.equal(TASKS.plan({ text: 'Hello Paris', sign: 'asl' }), 'HELLO #P-A-R-I-S');
  });

  test('speller / vad / active-speaker scenes return strings', () => {
    assert.equal(TASKS.speller([['H', 700], ['I', 700]]), 'HI');
    assert.equal(TASKS.vad({ durationMs: 4000, bursts: [{ from: 500, to: 2000 }] }), '1');
    assert.equal(TASKS.vad({ durationMs: 2000, bursts: [] }), '0');
    const scene = {
      durationMs: 3000,
      faces: [{ cx: 0.3, cy: 0.5 }, { cx: 0.7, cy: 0.5 }],
      segments: [{ from: 0, to: 3000, speaker: 1 }],
    };
    assert.equal(TASKS['active-speaker'](scene), '1');
    assert.equal(TASKS['active-speaker']({ ...scene, segments: [] }), '-1');
  });
});
