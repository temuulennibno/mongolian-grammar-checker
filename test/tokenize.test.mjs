import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, tokenizeWords, MN_WORD } from '../src/tokenize.js';

test('extracts Mongolian words with offsets', () => {
  const { tokens, seen } = tokenize('Сайн байна уу');
  assert.deepEqual(tokens.map((t) => t.word), ['Сайн', 'байна', 'уу']);
  assert.equal(tokens[0].start, 0);
  assert.equal(tokens[0].end, 4);
  assert.deepEqual([...seen].sort(), ['Сайн', 'байна', 'уу'].sort());
});

test('offsets map back to the original substring', () => {
  const text = 'Энэ бол монггол үг';
  for (const t of tokenize(text).tokens) {
    assert.equal(text.slice(t.start, t.end), t.word);
  }
});

test('dedupes repeated words in the seen set but keeps every token', () => {
  const { tokens, seen } = tokenize('монгол монгол монгол');
  assert.equal(tokens.length, 3);
  assert.equal(seen.size, 1);
});

test('skips single-letter Cyrillic runs', () => {
  const { tokens } = tokenize('а бе ц');
  assert.deepEqual(tokens.map((t) => t.word), ['бе']);
});

test('ignores Cyrillic glued to Latin letters or digits (URLs, code, ids)', () => {
  assert.deepEqual(tokenizeWords('github.com/бата'), []);
  assert.deepEqual(tokenizeWords('вер2сион'), []); // digit inside
  assert.deepEqual(tokenizeWords('user_бүртгэл'), []);
  assert.deepEqual(tokenizeWords('монгол@mail'), []);
});

test('still flags a clean Cyrillic word next to punctuation/spaces', () => {
  assert.deepEqual(tokenizeWords('(монгол), "үг".'), ['монгол', 'үг']);
});

test('handles Өө and Үү specifically', () => {
  assert.deepEqual(tokenizeWords('Өнөөдөр үзье'), ['Өнөөдөр', 'үзье']);
});

test('empty / non-Mongolian input yields nothing', () => {
  assert.deepEqual(tokenizeWords(''), []);
  assert.deepEqual(tokenizeWords('hello world 123'), []);
});

test('tokenize is re-runnable (lastIndex reset between calls)', () => {
  const a = tokenizeWords('монгол хэл');
  const b = tokenizeWords('монгол хэл');
  assert.deepEqual(a, b);
  assert.equal(MN_WORD.lastIndex, 0);
});
