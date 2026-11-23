// Text -> sign plan. Picks the gloss rules for the spoken language, then resolves each
// gloss against the target sign language: a known sign is played, anything else is
// fingerspelled with that language's manual alphabet.
import { SIGN } from '../core/languages.js';
import asl from '../signs/asl.js';
import isl from '../signs/isl.js';
import { englishToGloss } from './english.js';
import { hebrewToGloss } from './hebrew.js';

/** Sign language data modules, keyed by sign language code. Register new languages here. */
export const SIGN_DATA = { asl, isl };

/** Gloss rules keyed by spoken language code. Register new languages here. */
const GLOSSERS = { en: englishToGloss, he: hebrewToGloss };

/**
 * Translate text into gloss tokens for a sign language.
 * @returns {Array<{gloss: string, source: string}>}
 */
export function textToGloss(text, signCode) {
  const data = SIGN_DATA[signCode];
  if (!data) throw new Error(`Unsupported sign language: ${signCode}`);
  const glosser = GLOSSERS[SIGN[signCode].spoken];
  return glosser(text, new Set(Object.keys(data.LEXICON)));
}

/** Letters of a word that the sign language's alphabet can spell. */
export function spellableLetters(word, signCode) {
  const data = SIGN_DATA[signCode];
  const letters = [];
  for (const ch of word) {
    const key = data.normalizeLetter(ch);
    if (key) letters.push({ ch: key, def: data.ALPHABET[key] });
  }
  return letters;
}

/**
 * Translate text into a plan the avatar can play.
 * @returns {Array} items: { type: 'sign', gloss, sign } | { type: 'spell', gloss, word, letters }
 */
export function textToPlan(text, signCode) {
  const data = SIGN_DATA[signCode];
  const plan = [];
  for (const token of textToGloss(text, signCode)) {
    const known = data.LEXICON[token.gloss];
    if (known) {
      plan.push({ type: 'sign', gloss: token.gloss, sign: known });
      continue;
    }
    const letters = spellableLetters(token.source, signCode);
    // Words written in another script (or digits) cannot be spelled in this alphabet.
    if (letters.length) plan.push({ type: 'spell', gloss: token.gloss, word: token.source, letters });
  }
  return plan;
}

/**
 * Compact, comparable notation for a plan: signs as glosses, fingerspelling as "#W-O-R-D".
 * Used by the evals and shown in the caption.
 */
export function planNotation(plan) {
  return plan
    .map((item) => (item.type === 'sign' ? item.gloss : `#${item.letters.map((l) => l.ch).join('-')}`))
    .join(' ');
}
