// Shared Mongolian-word tokenizer, used by both the content script (inline
// checking) and the service worker (right-click selection counting) so their
// notion of "a word worth checking" can never drift apart.

export const MN_WORD = /[А-Яа-яЁёӨөҮү]+/g;

// A Cyrillic run is only treated as a real word if it isn't glued to Latin
// letters or digits on either side (filters out URLs, emails, code, IDs and
// other mixed-script tokens that would otherwise be flagged as misspellings).
const ADJACENT = /[A-Za-z0-9_@./\\-]/;

function isRealWord(text, start, end, word) {
  if (word.length < 2) return false; // single letters are not worth flagging
  const before = start > 0 ? text[start - 1] : '';
  const after = end < text.length ? text[end] : '';
  return !ADJACENT.test(before) && !ADJACENT.test(after);
}

// Tokenize into Mongolian words with their offsets, plus the deduped set of
// distinct words (what gets sent to the engine).
export function tokenize(text) {
  const tokens = [];
  const seen = new Set();
  let m;
  MN_WORD.lastIndex = 0;
  while ((m = MN_WORD.exec(text)) !== null) {
    const word = m[0];
    const start = m.index;
    const end = start + word.length;
    if (!isRealWord(text, start, end, word)) continue;
    tokens.push({ start, end, word });
    seen.add(word);
  }
  return { tokens, seen };
}

// Flat list of words (order preserved, duplicates kept) for simple counting.
export function tokenizeWords(text) {
  return tokenize(text).tokens.map((t) => t.word);
}
