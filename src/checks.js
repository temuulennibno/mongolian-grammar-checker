// Extra, dictionary-independent checks that catch mistakes Hunspell can't:
//
//   * homoglyphs  — a Cyrillic word typed with stray Latin lookalike letters
//                   (e.g. "мoнгол" with a Latin "o"). It looks perfect but
//                   fails spell-check for an invisible reason; we suggest the
//                   all-Cyrillic form.
//   * repeats     — the same word typed twice in a row ("байна байна").
//
// Both are pure functions over the raw text so they can be unit-tested and
// shared between the content script and the popup.

import { MN_WORD } from './tokenize.js';

// Latin letters that share a glyph with a Cyrillic letter in common fonts.
export const HOMOGLYPH = {
  a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у',
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М',
  O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У',
};

const CYRILLIC = /[А-Яа-яЁёӨөҮү]/;
const LETTER_RUN = /[A-Za-zА-Яа-яЁёӨөҮү]+/g;

// Replace any Latin homoglyphs in a word with their Cyrillic equivalents.
export function toCyrillic(word) {
  let out = '';
  for (const ch of word) out += HOMOGLYPH[ch] || ch;
  return out;
}

// Find words that are Cyrillic but contain Latin homoglyph letters. Only runs
// where EVERY Latin letter is a homoglyph are flagged, so real English words
// and acronyms (COVID, id2) are left alone.
export function detectHomoglyphs(text) {
  const out = [];
  LETTER_RUN.lastIndex = 0;
  let m;
  while ((m = LETTER_RUN.exec(text)) !== null) {
    const word = m[0];
    if (word.length < 2) continue;
    let hasCyrillic = false;
    let hasLatin = false;
    let allLatinAreHomoglyph = true;
    for (const ch of word) {
      if (CYRILLIC.test(ch)) {
        hasCyrillic = true;
      } else {
        hasLatin = true;
        if (!(ch in HOMOGLYPH)) { allLatinAreHomoglyph = false; break; }
      }
    }
    if (hasCyrillic && hasLatin && allLatinAreHomoglyph) {
      out.push({
        start: m.index,
        end: m.index + word.length,
        word,
        kind: 'homoglyph',
        suggestions: [toCyrillic(word)],
      });
    }
  }
  return out;
}

// Find consecutive duplicated words separated only by whitespace. The flagged
// span covers the whitespace + the second word, so deleting it (replacement
// '') removes the duplicate cleanly.
export function detectRepeats(text) {
  const words = [];
  MN_WORD.lastIndex = 0;
  let m;
  while ((m = MN_WORD.exec(text)) !== null) {
    words.push({ start: m.index, end: m.index + m[0].length, word: m[0] });
  }

  const out = [];
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1];
    const cur = words[i];
    if (cur.word.length < 2) continue;
    if (prev.word.toLowerCase() !== cur.word.toLowerCase()) continue;
    const between = text.slice(prev.end, cur.start);
    if (!/^\s+$/.test(between)) continue; // must be only whitespace
    out.push({
      start: prev.end,
      end: cur.end,
      word: text.slice(prev.end, cur.end), // whitespace + duplicate
      display: cur.word,
      kind: 'repeat',
      suggestions: [{ label: `Давхардсан «${cur.word}»-г устгах`, value: '' }],
    });
  }
  return out;
}

// Run the extra checks and return their flags sorted by position.
export function detectExtras(text) {
  return [...detectHomoglyphs(text), ...detectRepeats(text)].sort((a, b) => a.start - b.start);
}
