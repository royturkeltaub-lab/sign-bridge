import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPOKEN,
  SIGN,
  DEFAULT_SPOKEN,
  detectTextLanguage,
  signLanguagesFor,
  defaultSignLanguage,
  fromWhisperLanguage,
} from '../src/core/languages.js';

describe('language registry', () => {
  test('every spoken language points at registered sign languages and back', () => {
    for (const [code, lang] of Object.entries(SPOKEN)) {
      assert.equal(lang.code, code);
      assert.ok(lang.signLanguages.length > 0, `${code} offers no sign language`);
      for (const sign of lang.signLanguages) {
        assert.ok(SIGN[sign], `${code} references unknown sign language ${sign}`);
        assert.equal(SIGN[sign].spoken, code);
      }
    }
    for (const [code, sign] of Object.entries(SIGN)) {
      assert.equal(sign.code, code);
      assert.ok(SPOKEN[sign.spoken], `${code} references unknown spoken language`);
    }
    assert.ok(SPOKEN[DEFAULT_SPOKEN]);
  });

  test('signLanguagesFor / defaultSignLanguage', () => {
    assert.deepEqual(signLanguagesFor('en').map((s) => s.code), ['asl']);
    assert.deepEqual(signLanguagesFor('he').map((s) => s.code), ['isl']);
    assert.deepEqual(signLanguagesFor('fr'), []);
    assert.deepEqual(signLanguagesFor(undefined), []);
    assert.equal(defaultSignLanguage('en').code, 'asl');
    assert.equal(defaultSignLanguage('he').code, 'isl');
    assert.equal(defaultSignLanguage('he').dir, 'rtl');
    assert.equal(defaultSignLanguage('xx'), null);
    assert.equal(defaultSignLanguage(''), null);
  });
});

describe('detectTextLanguage', () => {
  test('detects English and Hebrew with full confidence', () => {
    const en = detectTextLanguage('Hello, how are you?');
    assert.equal(en.code, 'en');
    assert.equal(en.confidence, 1);
    const he = detectTextLanguage('שלום, מה שלומך?');
    assert.equal(he.code, 'he');
    assert.equal(he.confidence, 1);
    assert.equal(he.counts.en, 0);
  });

  test('returns null for text without a supported script', () => {
    for (const text of ['', '   ', '123 456', '?!...', 'Привет', '你好', '\n\t']) {
      const result = detectTextLanguage(text);
      assert.equal(result.code, null, JSON.stringify(text));
      assert.equal(result.confidence, 0);
    }
  });

  test('mixed text picks the majority script and reports its share', () => {
    const mostlyHebrew = detectTextLanguage('אני אוהב pizza מאוד');
    assert.equal(mostlyHebrew.code, 'he');
    assert.ok(mostlyHebrew.confidence > 0.5 && mostlyHebrew.confidence < 1);
    const mostlyEnglish = detectTextLanguage('the word שלום means hello');
    assert.equal(mostlyEnglish.code, 'en');
    assert.equal(mostlyEnglish.counts.he, 4);
    assert.equal(mostlyEnglish.counts.en, 17);
  });

  test('niqqud and final letters still count as Hebrew', () => {
    assert.equal(detectTextLanguage('ש\u05B8\u05C1ל\u05B9ום').code, 'he');
    assert.equal(detectTextLanguage('ךםןףץ').counts.he, 5);
  });

  test('is repeatable (global regex state does not leak between calls)', () => {
    for (let i = 0; i < 5; i++) {
      assert.equal(detectTextLanguage('abc').counts.en, 3);
      assert.equal(detectTextLanguage('אבג').counts.he, 3);
    }
  });

  test('handles very long input', () => {
    const result = detectTextLanguage('שלום '.repeat(20000) + 'ok');
    assert.equal(result.code, 'he');
    assert.equal(result.counts.he, 80000);
  });

  test('null / undefined are not mistaken for English text', () => {
    assert.equal(detectTextLanguage(null).code, null);
    assert.equal(detectTextLanguage(undefined).code, null);
  });
});

describe('fromWhisperLanguage', () => {
  test('accepts names, ISO codes and Whisper tokens', () => {
    assert.equal(fromWhisperLanguage('hebrew'), 'he');
    assert.equal(fromWhisperLanguage('he'), 'he');
    assert.equal(fromWhisperLanguage('<|he|>'), 'he');
    assert.equal(fromWhisperLanguage('english'), 'en');
    assert.equal(fromWhisperLanguage('en'), 'en');
    assert.equal(fromWhisperLanguage('<|en|>'), 'en');
  });

  test('is case and whitespace insensitive', () => {
    assert.equal(fromWhisperLanguage('Hebrew'), 'he');
    assert.equal(fromWhisperLanguage(' EN '), 'en');
    assert.equal(fromWhisperLanguage('<|HE|>'), 'he');
  });

  test('maps the legacy Hebrew code "iw"', () => {
    assert.equal(fromWhisperLanguage('iw'), 'he');
    assert.equal(fromWhisperLanguage('<|iw|>'), 'he');
  });

  test('returns null for unsupported or empty values', () => {
    for (const value of [null, undefined, '', 'french', 'fr', '<|fr|>', 'heb', 'e', 0]) {
      assert.equal(fromWhisperLanguage(value), null, String(value));
    }
  });
});
