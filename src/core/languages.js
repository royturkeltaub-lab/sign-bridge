// Language registry: the single place to add a new spoken or sign language.
//
// To add a language later:
//   1. add a SPOKEN entry (with the Whisper language code and script test),
//   2. add a SIGN entry and its data module under src/signs/ (alphabet + lexicon),
//   3. add a gloss rule module under src/translate/ and register it in gloss.js.

/** Spoken languages the app can hear. `whisper` is the Whisper language token name. */
export const SPOKEN = {
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    whisper: 'english',
    dir: 'ltr',
    script: /[A-Za-z]/g,
    // Sign languages native to communities speaking this language; the first is the default offer.
    signLanguages: ['asl'],
  },
  he: {
    code: 'he',
    name: 'Hebrew',
    nativeName: 'עברית',
    whisper: 'hebrew',
    dir: 'rtl',
    script: /[א-ת]/g,
    signLanguages: ['isl'],
  },
};

/** Sign languages the app can show and read. */
export const SIGN = {
  asl: {
    code: 'asl',
    name: 'American Sign Language',
    shortName: 'ASL',
    nativeName: 'American Sign Language',
    spoken: 'en',
    dir: 'ltr',
  },
  isl: {
    code: 'isl',
    name: 'Israeli Sign Language',
    shortName: 'ISL',
    nativeName: 'שפת הסימנים הישראלית',
    spoken: 'he',
    dir: 'rtl',
  },
};

export const DEFAULT_SPOKEN = 'en';

/** Sign languages to offer for a spoken language, default first. */
export function signLanguagesFor(spokenCode) {
  const spoken = SPOKEN[spokenCode];
  if (!spoken) return [];
  return spoken.signLanguages.map((code) => SIGN[code]).filter(Boolean);
}

/** The default sign language to offer for a spoken language (or null if unsupported). */
export function defaultSignLanguage(spokenCode) {
  return signLanguagesFor(spokenCode)[0] || null;
}

/**
 * Detect the spoken language of a piece of text by counting characters of each script.
 * Returns { code, confidence, counts }. `code` is null when no supported script is present.
 */
export function detectTextLanguage(text) {
  const counts = {};
  let total = 0;
  for (const [code, lang] of Object.entries(SPOKEN)) {
    const n = (String(text ?? '').match(lang.script) || []).length;
    counts[code] = n;
    total += n;
  }
  if (total === 0) return { code: null, confidence: 0, counts };
  const [best] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return { code: best[0], confidence: best[1] / total, counts };
}

/** Map a Whisper language name or ISO code ("hebrew", "he", "<|he|>") to a supported spoken code. */
export function fromWhisperLanguage(value) {
  if (!value) return null;
  const v = String(value).toLowerCase().replace(/[<|>]/g, '').trim();
  for (const lang of Object.values(SPOKEN)) {
    if (v === lang.code || v === lang.whisper) return lang.code;
  }
  // Whisper still emits the legacy code "iw" for Hebrew in some vocabularies.
  if (v === 'iw') return 'he';
  return null;
}
