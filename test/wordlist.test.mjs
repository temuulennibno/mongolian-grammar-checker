import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseWordList } from '../src/wordlist.js';

test('parses one word per line into a set', () => {
  const set = parseWordList('монгол\nхэл\nбичиг');
  assert.equal(set.size, 3);
  assert.ok(set.has('монгол'));
  assert.ok(set.has('бичиг'));
});

test('ignores blank lines and trims surrounding whitespace', () => {
  const set = parseWordList('  монгол  \n\n\t хэл\n   \n');
  assert.deepEqual([...set].sort(), ['монгол', 'хэл'].sort());
});

test('treats # lines as comments (including indented ones)', () => {
  const set = parseWordList('# header\nмонгол\n   # indented comment\nхэл');
  assert.equal(set.size, 2);
  assert.ok(!set.has('# header'));
});

test('is case-sensitive', () => {
  const set = parseWordList('Монгол\nмонгол');
  assert.equal(set.size, 2);
});

test('deduplicates repeated entries', () => {
  const set = parseWordList('хэл\nхэл\nхэл');
  assert.equal(set.size, 1);
});

test('handles CRLF line endings', () => {
  const set = parseWordList('монгол\r\nхэл\r\n');
  assert.deepEqual([...set].sort(), ['монгол', 'хэл'].sort());
});

test('non-string input yields an empty set', () => {
  assert.equal(parseWordList(undefined).size, 0);
  assert.equal(parseWordList(null).size, 0);
});

test('the shipped supplement.txt is comment-only or valid (no accidental blanks)', () => {
  const path = fileURLToPath(new URL('../dict/supplement.txt', import.meta.url));
  const set = parseWordList(readFileSync(path, 'utf8'));
  for (const w of set) {
    assert.equal(w, w.trim());
    assert.ok(w.length > 0);
    assert.ok(!w.startsWith('#'));
  }
});
