import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import asl from '../src/signs/asl.js';
import isl from '../src/signs/isl.js';
import { englishToGloss } from '../src/translate/english.js';
import { hebrewToGloss } from '../src/translate/hebrew.js';
import { SIGN_DATA, textToGloss, textToPlan, planNotation, spellableLetters } from '../src/translate/gloss.js';

const ASL_KNOWN = new Set(Object.keys(asl.LEXICON));
const ISL_KNOWN = new Set(Object.keys(isl.LEXICON));
const en = (text) => englishToGloss(text, ASL_KNOWN).map((t) => t.gloss).join(' ');
const he = (text) => hebrewToGloss(text, ISL_KNOWN).map((t) => t.gloss).join(' ');
const plan = (text, sign) => planNotation(textToPlan(text, sign));

describe('englishToGloss', () => {
  test('expands contractions', () => {
    assert.equal(en("I can't eat"), 'ME CAN NOT EAT');
    assert.equal(en("I don't know"), 'ME NOT KNOW');
    assert.equal(en("I won't go"), 'ME NOT GO');
    assert.equal(en("I'm deaf"), 'ME DEAF');
    assert.equal(en("you're good"), 'YOU GOOD');
    assert.equal(en("I'll help"), 'ME HELP');
    assert.equal(en("I've finished"), 'ME HAVE FINISH');
    assert.equal(en("I'd love water"), 'ME LOVE WATER');
    assert.equal(en("it's bad"), 'IT BAD');
  });

  test('accepts typographic apostrophes', () => {
    assert.equal(en('I’m deaf'), 'ME DEAF');
    assert.equal(en('I can`t see'), 'ME CAN NOT SEE');
  });

  test('drops articles, the copula and other function words', () => {
    assert.equal(en('The water is good'), 'WATER GOOD');
    assert.equal(en('I am a friend'), 'ME FRIEND');
    assert.equal(en('I want to eat'), 'ME WANT EAT');
    assert.equal(en('Do you want an apple'), 'YOU WANT APPLE');
    assert.equal(en('They were being nice'), 'THEY NICE');
    assert.equal(en('the a an is are'), '');
  });

  test('time words come first', () => {
    assert.equal(en('I go home today'), 'TODAY ME GO HOME');
    assert.equal(en('I will work tomorrow'), 'TOMORROW ME WORK');
    assert.equal(en('I want water right now'), 'NOW ME WANT WATER');
  });

  test('wh-words go last', () => {
    assert.equal(en("What's your name?"), 'YOUR NAME WHAT');
    assert.equal(en('Where is the bathroom'), 'BATHROOM WHERE');
    assert.equal(en('Where are you going today?'), 'TODAY YOU GO WHERE');
  });

  test('reordering stays inside each sentence', () => {
    assert.equal(en('Where is the bathroom? I want water now.'), 'BATHROOM WHERE NOW ME WANT WATER');
    assert.equal(en('Hello!\nWhat is your name; I am deaf'), 'HELLO YOUR NAME WHAT ME DEAF');
  });

  test('maps pronouns, synonyms and irregular forms', () => {
    assert.equal(en('hi mom'), 'HELLO MOTHER');
    assert.equal(en('my dad went home'), 'MY FATHER GO HOME');
    assert.equal(en('I saw you'), 'ME SEE YOU');
    assert.equal(en('thanks'), 'THANK-YOU');
    assert.equal(en('Thank you, friend'), 'THANK-YOU FRIEND');
    assert.equal(en('yeah, the toilet'), 'YES BATHROOM');
  });

  test('"going to" before a verb/noun collapses to GO', () => {
    assert.equal(en('I am going to school'), 'ME GO SCHOOL');
    assert.equal(en('where are you going to?'), 'YOU GO WHERE');
  });

  test('lemmatises inflected forms of known signs', () => {
    assert.equal(en('eating'), 'EAT');
    assert.equal(en('wanted'), 'WANT');
    assert.equal(en('loves'), 'LOVE');
    assert.equal(en('loved'), 'LOVE');
    assert.equal(en('helping'), 'HELP');
    assert.equal(en('friends'), 'FRIEND');
    assert.equal(en('named'), 'NAME');
  });

  test('does not mangle words whose stem is not a sign', () => {
    assert.equal(en('Paris'), 'PARIS');
    assert.equal(en('James needs glasses'), 'JAMES NEEDS GLASSES');
    assert.equal(en('bus'), 'BUS');
    assert.equal(en('king'), 'KING');
    assert.equal(en('red bed'), 'RED BED');
    // "yes" ends in "es"/"s" but is itself a sign.
    assert.equal(en('yes'), 'YES');
  });

  test('without a lexicon nothing is lemmatised', () => {
    assert.deepEqual(englishToGloss('eating apples').map((t) => t.gloss), ['EATING', 'APPLES']);
  });

  test('keeps the source word for fingerspelling', () => {
    assert.deepEqual(englishToGloss('Paris loves me', ASL_KNOWN), [
      { gloss: 'PARIS', source: 'paris' },
      { gloss: 'LOVE', source: 'loves' },
      { gloss: 'ME', source: 'me' },
    ]);
  });

  test('empty, punctuation-only and non-Latin input produce no tokens', () => {
    for (const text of ['', '   ', '?!.,;', '...\n\n', 'שלום עולם', '你好', '— – …']) {
      assert.deepEqual(englishToGloss(text, ASL_KNOWN), [], JSON.stringify(text));
    }
  });

  test('non-string input is coerced rather than throwing', () => {
    assert.deepEqual(englishToGloss(42, ASL_KNOWN).map((t) => t.gloss), ['42']);
  });

  test('every token has a non-empty upper-case gloss and a lower-case source', () => {
    const text = "Hello! I'm Dana, and I don't know where the bus-stop is... Can you help me today? Thanks!";
    for (const token of englishToGloss(text, ASL_KNOWN)) {
      assert.ok(token.gloss.length > 0);
      assert.equal(token.gloss, token.gloss.toUpperCase());
      assert.equal(token.source, token.source.toLowerCase());
    }
  });

  test('handles very long input', () => {
    const tokens = englishToGloss('hello my friend. '.repeat(5000), ASL_KNOWN);
    assert.equal(tokens.length, 15000);
    assert.equal(tokens[14999].gloss, 'FRIEND');
  });

  // Questionable: the stemmer accepts any stem that happens to be a sign.
  test('unrelated words are not stemmed onto a sign', () => {
    assert.equal(en('seed'), 'SEED');
    assert.equal(en('nothing'), 'NOTHING');
    assert.equal(en('noted'), 'NOTED');
  });
});

describe('hebrewToGloss', () => {
  test('maps inflected forms onto lexicon signs', () => {
    assert.equal(he('אני אוהבת ללמוד'), 'אני לאהוב ללמוד');
    assert.equal(he('היי'), 'שלום');
    assert.equal(he('אני עובד'), 'אני עבודה');
    assert.equal(he('מצטער'), 'סליחה');
  });

  test('collapses "תודה רבה"', () => {
    assert.equal(he('תודה רבה'), 'תודה');
    assert.equal(he('תודה רבה לך'), 'תודה לך');
  });

  test('drops the object marker before a definite noun and the definite article', () => {
    assert.equal(he('אני אוהב את הילד'), 'אני לאהוב ילד');
    assert.equal(he('הילדה אוכלת'), 'ילדה לאכול');
    assert.deepEqual(hebrewToGloss('הספר', ISL_KNOWN), [{ gloss: 'ספר', source: 'ספר' }]);
  });

  test('a definite form of a known sign resolves to the sign', () => {
    assert.equal(he('התודה'), 'תודה');
    assert.equal(he('העבודה'), 'עבודה');
  });

  test('"את" is kept when it is not followed by a definite noun', () => {
    assert.equal(he('את יפה'), 'את יפה');
    assert.equal(he('את'), 'את');
  });

  test('words that merely start with ה keep it', () => {
    assert.equal(he('הוא הולך היום'), 'הוא הולך היום');
    assert.equal(he('היא הלכה הביתה'), 'היא הלכה הביתה');
    assert.equal(he('הם'), 'הם');
    assert.equal(he('הנה הכל'), 'הנה הכל');
  });

  test('strips niqqud before matching', () => {
    assert.equal(he('שָׁלֹום'), 'שלום');
    assert.equal(he('תּוֹדָה'), 'תודה');
  });

  test('keeps word order', () => {
    assert.equal(he('היום אני לומד'), 'היום אני ללמוד');
    assert.equal(he('אני לומד היום'), 'אני ללמוד היום');
  });

  test('acronyms with gershayim stay one word', () => {
    assert.deepEqual(hebrewToGloss('צה"ל', ISL_KNOWN).map((t) => t.source), ['צה"ל']);
  });

  test('without a lexicon nothing is mapped onto a sign', () => {
    assert.deepEqual(hebrewToGloss('היי אוהב').map((t) => t.gloss), ['היי', 'אוהב']);
  });

  test('empty and punctuation-only input produce no tokens', () => {
    for (const text of ['', '  ', '?!.,', '־ ״ ׳', '\n']) assert.deepEqual(hebrewToGloss(text, ISL_KNOWN), []);
  });

  test('handles very long input', () => {
    const tokens = hebrewToGloss('שלום אני אוהב את הילד. '.repeat(4000), ISL_KNOWN);
    assert.equal(tokens.length, 16000);
  });

  // "את" is also the pronoun "you" (feminine). The object-marker rule only looks at whether
  // the next word starts with ה, so it swallows the subject of "את הולכת הביתה".
  test('"את" (you) is kept before a verb that merely starts with ה', () => {
    assert.equal(he('את הולכת הביתה'), 'את הולכת הביתה');
    assert.equal(he('את היום עובדת'), 'את היום עבודה');
  });
});

describe('textToGloss / textToPlan', () => {
  test('registers data for every sign language', () => {
    assert.deepEqual(Object.keys(SIGN_DATA).sort(), ['asl', 'isl']);
    assert.equal(SIGN_DATA.asl, asl);
    assert.equal(SIGN_DATA.isl, isl);
  });

  test('unsupported sign language throws', () => {
    assert.throws(() => textToGloss('hello', 'bsl'), /Unsupported sign language: bsl/);
    assert.throws(() => textToPlan('hello', undefined), /Unsupported sign language/);
  });

  test('known glosses become signs, everything else is fingerspelled', () => {
    const items = textToPlan('Hello Paris', 'asl');
    assert.equal(items.length, 2);
    assert.equal(items[0].type, 'sign');
    assert.equal(items[0].sign, asl.LEXICON.HELLO);
    assert.equal(items[1].type, 'spell');
    assert.equal(items[1].word, 'paris');
    assert.deepEqual(items[1].letters.map((l) => l.ch), ['P', 'A', 'R', 'I', 'S']);
    items[1].letters.forEach((l) => assert.equal(l.def, asl.ALPHABET[l.ch]));
  });

  test('planNotation format', () => {
    assert.equal(plan('Hello Paris', 'asl'), 'HELLO #P-A-R-I-S');
    assert.equal(plan("What's your name?", 'asl'), 'YOUR NAME WHAT');
    assert.equal(plan('I love Dana', 'asl'), 'ME LOVE #D-A-N-A');
    assert.equal(plan('שלום דנה', 'isl'), 'שלום #ד-נ-ה');
    assert.equal(plan('אני אוהב את הילד', 'isl'), 'אני לאהוב #י-ל-ד');
    assert.equal(planNotation([]), '');
  });

  test('final letters are spelled with their own sign', () => {
    assert.equal(plan('ילדים', 'isl'), '#י-ל-ד-י-ם');
    assert.equal(plan('הולך', 'isl'), '#ה-ו-ל-ך');
  });

  test('a lemmatised word that is fingerspelled uses the original spelling', () => {
    assert.equal(plan('cats', 'asl'), '#C-A-T-S');
    assert.equal(plan("mom's", 'asl'), 'MOTHER'); // possessive 's is dropped, then signed
    assert.equal(plan('bus-stop', 'asl'), '#B-U-S-S-T-O-P');
  });

  test('text in the wrong script produces no letters', () => {
    assert.deepEqual(textToPlan('שלום עולם', 'asl'), []);
    assert.deepEqual(textToPlan('hello world', 'isl'), []);
    assert.deepEqual(textToPlan('12 345', 'asl'), []);
    assert.deepEqual(textToPlan('12 345', 'isl'), []);
  });

  test('mixed-script text keeps only what the alphabet can spell', () => {
    assert.equal(plan('אני אוהב pizza', 'isl'), 'אני לאהוב');
    assert.equal(plan('I love שלום', 'asl'), 'ME LOVE');
    assert.equal(plan('I have 2 cats', 'asl'), 'ME #H-A-V-E #C-A-T-S');
  });

  test('empty and punctuation-only text give an empty plan', () => {
    for (const code of ['asl', 'isl']) {
      for (const text of ['', '   ', '?!', '...', '\n']) assert.deepEqual(textToPlan(text, code), []);
    }
  });

  test('spellableLetters skips characters outside the alphabet', () => {
    assert.deepEqual(spellableLetters("o'neil-3", 'asl').map((l) => l.ch), ['O', 'N', 'E', 'I', 'L']);
    assert.deepEqual(spellableLetters('héllo', 'asl').map((l) => l.ch), ['H', 'L', 'L', 'O']);
    assert.deepEqual(spellableLetters('צה"ל', 'isl').map((l) => l.ch), ['צ', 'ה', 'ל']);
    assert.deepEqual(spellableLetters('שָׁלֹום', 'isl').map((l) => l.ch), ['ש', 'ל', 'ו', 'ם']);
    assert.deepEqual(spellableLetters('', 'asl'), []);
  });

  test('every plan item is playable: signs exist, spelled items have letters', () => {
    const samples = [
      ['Hello, my name is Dana. Where is the bathroom? I don\'t know!', 'asl'],
      ['Thank you 100 times — see you tomorrow at 5pm', 'asl'],
      ['שלום, אני דנה. אני אוהבת לאכול פיצה! תודה רבה', 'isl'],
      ['היום אני הולך לעבודה ב-8 בבוקר', 'isl'],
    ];
    for (const [text, code] of samples) {
      const items = textToPlan(text, code);
      assert.ok(items.length > 0);
      for (const item of items) {
        if (item.type === 'sign') {
          assert.equal(item.sign, SIGN_DATA[code].LEXICON[item.gloss]);
        } else {
          assert.equal(item.type, 'spell');
          assert.ok(item.letters.length > 0);
          for (const letter of item.letters) assert.equal(letter.def, SIGN_DATA[code].ALPHABET[letter.ch]);
        }
      }
      assert.match(planNotation(items), /^\S+( \S+)*$/);
    }
  });

  test('handles very long input', () => {
    const items = textToPlan('hello zebra '.repeat(3000), 'asl');
    assert.equal(items.length, 6000);
    assert.equal(planNotation(items.slice(0, 2)), 'HELLO #Z-E-B-R-A');
  });
});
