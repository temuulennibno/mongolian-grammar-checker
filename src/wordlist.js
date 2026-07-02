// Parser for the shipped supplemental word list (dict/supplement.txt).
//
// dict-mn is large but not exhaustive: some common inflected forms, loanwords
// and proper nouns are missing and get flagged as typos. Rather than editing
// the upstream dictionary, we keep a curated allowlist of extra words that the
// engine treats as always-correct. The list grows from real user reports.
//
// Format: one word per line. Blank lines are ignored. A line whose first
// non-space character is '#' is a comment. Surrounding whitespace is trimmed.
// Matching is exact (case-sensitive), so add both cases if a word appears
// capitalized (e.g. a name at the start of a sentence).

export function parseWordList(text) {
  const set = new Set();
  if (typeof text !== 'string') return set;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    set.add(line);
  }
  return set;
}
