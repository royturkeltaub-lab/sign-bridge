// Hebrew text -> ISL gloss tokens (rule based, runs offline).
//
// Deliberately conservative: word order is kept as spoken (ISL grammar differs, but we have
// no verified reordering rules), the object marker and the definite article are dropped, and
// inflected forms are mapped onto the few signs in the lexicon. Everything else is fingerspelled.

const NIQQUD = /[֑-ׇ]/g;

// Inflected / related forms -> lexicon gloss.
const MAP = {
  'שלום': 'שלום', 'היי': 'שלום', 'הי': 'שלום',
  'תודה': 'תודה',
  'סליחה': 'סליחה', 'מצטער': 'סליחה', 'מצטערת': 'סליחה',
  'לא': 'לא',
  'אני': 'אני',
  'לאכול': 'לאכול', 'אוכל': 'לאכול', 'אוכלת': 'לאכול', 'אוכלים': 'לאכול', 'אוכלות': 'לאכול',
  'לשתות': 'לשתות', 'שותה': 'לשתות', 'שותים': 'לשתות', 'שותות': 'לשתות',
  'עבודה': 'עבודה', 'לעבוד': 'עבודה', 'עובד': 'עבודה', 'עובדת': 'עבודה', 'עובדים': 'עבודה', 'עובדות': 'עבודה',
  'ללמוד': 'ללמוד', 'לומד': 'ללמוד', 'לומדת': 'ללמוד', 'לומדים': 'ללמוד', 'לומדות': 'ללמוד',
  'לאהוב': 'לאהוב', 'אוהב': 'לאהוב', 'אוהבת': 'לאהוב', 'אוהבים': 'לאהוב', 'אוהבות': 'לאהוב',
};

const PHRASES = [[/תודה רבה/g, 'תודה']];

/**
 * @param {string} text Hebrew sentence(s)
 * @param {Set<string>} known glosses that have a sign in the target lexicon
 * @returns {Array<{gloss: string, source: string}>}
 */
export function hebrewToGloss(text, known = new Set()) {
  let s = String(text).replace(NIQQUD, '');
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  const words = s.match(/[א-ת]+(?:["'׳״][א-ת]+)*|[A-Za-z0-9]+/g) || [];
  const out = [];
  words.forEach((word, i) => {
    const next = words[i + 1] || '';
    // "את" before a definite noun is the object marker, which has no sign.
    if (word === 'את' && next.startsWith('ה') && next.length > 2 && !KEEP_HE.has(next)) return;
    let gloss = MAP[word] && known.has(MAP[word]) ? MAP[word] : null;
    if (!gloss && word.startsWith('ה') && word.length > 2) {
      // Definite article: drop it. Keep the bare word for signing or fingerspelling.
      const bare = word.slice(1);
      gloss = MAP[bare] && known.has(MAP[bare]) ? MAP[bare] : null;
      if (!gloss && MAP[word] === undefined && !KEEP_HE.has(word)) {
        out.push({ gloss: bare, source: bare });
        return;
      }
    }
    out.push({ gloss: gloss || word, source: word });
  });
  return out;
}

// Common words that merely start with ה (not the article), so the ה must stay.
const KEEP_HE = new Set([
  'הוא', 'היא', 'הם', 'הן', 'היום', 'היה', 'היתה', 'הייתה', 'היו', 'הנה', 'הרבה', 'הכל', 'הלך',
  'הלכה', 'האם', 'הזה', 'הזאת', 'הלו', 'הולך', 'הולכת', 'הולכים', 'הביתה',
]);
