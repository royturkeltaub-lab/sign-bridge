// English text -> ASL gloss tokens (rule based, runs offline).
//
// ASL is not signed English: articles and the copula are dropped, time words come first
// and wh-question words go last. These rules cover that core; anything without a known
// sign is kept as a word to be fingerspelled.

const CONTRACTIONS = [
  [/\bcan't\b/g, 'can not'],
  [/\bwon't\b/g, 'will not'],
  [/\b(\w+)n't\b/g, '$1 not'],
  [/\bi'm\b/g, 'i am'],
  [/\b(\w+)'re\b/g, '$1 are'],
  [/\b(what|where|who|how|that|it|he|she|there|here)'s\b/g, '$1 is'],
  [/\b(\w+)'ll\b/g, '$1 will'],
  [/\b(\w+)'ve\b/g, '$1 have'],
  [/\b(\w+)'d\b/g, '$1 would'],
  [/\b(\w+)'s\b/g, '$1'], // possessive: "mom's" is signed MOTHER
  [/\b(\w+s)'(?=\s|$)/g, '$1'],
];

const PHRASES = [
  [/\bthank you\b/g, 'thank-you'],
  [/\bthanks\b/g, 'thank-you'],
  [/\bgoing to\b(?= \w)/g, 'go'],
  [/\bright now\b/g, 'now'],
];

// Words with no sign of their own in ASL glossing.
const DROP = new Set([
  'a', 'an', 'the', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'do', 'does', 'did', 'will', 'would',
]);

// Word -> gloss for pronouns, synonyms and irregular forms.
const MAP = {
  i: 'ME', me: 'ME', my: 'MY', mine: 'MY', you: 'YOU', your: 'YOUR', yours: 'YOUR',
  hi: 'HELLO', hey: 'HELLO', hello: 'HELLO',
  mom: 'MOTHER', mum: 'MOTHER', mommy: 'MOTHER', mother: 'MOTHER',
  dad: 'FATHER', daddy: 'FATHER', father: 'FATHER',
  food: 'EAT', ate: 'EAT', eaten: 'EAT',
  drank: 'DRINK', went: 'GO', gone: 'GO', goes: 'GO', saw: 'SEE', seen: 'SEE',
  knew: 'KNOW', thought: 'THINK', toilet: 'BATHROOM', restroom: 'BATHROOM',
  done: 'FINISH', finished: 'FINISH', not: 'NOT', okay: 'OK',
  yeah: 'YES', yep: 'YES', nope: 'NO',
  everyone: 'EVERYONE', everybody: 'EVERYONE',
};

const NO_LEMMA = new Set(['NOT', 'NO', 'ME', 'MY', 'YOU', 'YOUR', 'NOW']);
const TIME_WORDS = new Set(['TODAY', 'TOMORROW', 'YESTERDAY', 'NOW', 'LATER', 'TONIGHT']);
const WH_WORDS = new Set(['WHAT', 'WHERE', 'WHO', 'WHY', 'HOW', 'WHEN', 'WHICH']);

/** Reduce an inflected word to a base form, but only when the base is a known sign. */
function lemma(word, known) {
  const candidates = [];
  const doubled = (stem) => stem.length > 2 && stem.at(-1) === stem.at(-2); // "stopp" in "stopping"
  if (word.endsWith('ing')) {
    const stem = word.slice(0, -3);
    candidates.push(stem, `${stem}e`);
    if (doubled(stem)) candidates.push(stem.slice(0, -1));
  }
  if (word.endsWith('ed') && !word.endsWith('eed')) {
    const stem = word.slice(0, -2);
    candidates.push(stem, `${stem}e`);
    if (doubled(stem)) candidates.push(stem.slice(0, -1));
  }
  if (word.endsWith('es')) candidates.push(word.slice(0, -2));
  if (word.endsWith('s')) candidates.push(word.slice(0, -1));
  for (const c of candidates) {
    const gloss = c.toUpperCase();
    // Function words are never the base of a longer word ("noted" is not NOT).
    if (c.length > 1 && known.has(gloss) && !NO_LEMMA.has(gloss)) return gloss;
  }
  return null;
}

/**
 * @param {string} text English sentence(s)
 * @param {Set<string>} known glosses that have a sign in the target lexicon
 * @returns {Array<{gloss: string, source: string}>}
 */
export function englishToGloss(text, known = new Set()) {
  let s = String(text).toLowerCase().replace(/[’`]/g, "'");
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  for (const [re, to] of PHRASES) s = s.replace(re, to);

  const out = [];
  // Translate sentence by sentence so reordering stays inside a clause.
  for (const sentence of s.split(/[.!?;\n]+/)) {
    const words = sentence.match(/[a-z0-9]+(?:[-'][a-z0-9]+)*/g) || [];
    const front = [];
    const middle = [];
    const back = [];
    for (const word of words) {
      if (DROP.has(word)) continue;
      const upper = word.toUpperCase();
      const gloss = MAP[word] || (known.has(upper) ? upper : lemma(word, known)) || upper;
      const token = { gloss, source: word };
      if (TIME_WORDS.has(gloss)) front.push(token);
      else if (WH_WORDS.has(gloss)) back.push(token);
      else middle.push(token);
    }
    out.push(...front, ...middle, ...back);
  }
  return out;
}
