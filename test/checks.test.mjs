import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectHomoglyphs, detectRepeats, toCyrillic } from '../src/checks.js';

test('toCyrillic converts Latin homoglyphs, leaves Cyrillic alone', () => {
  assert.equal(toCyrillic('мoнгол'), 'монгол'); // Latin o -> Cyrillic о
  assert.equal(toCyrillic('cайн'), 'сайн');     // Latin c -> Cyrillic с
  assert.equal(toCyrillic('монгол'), 'монгол'); // already Cyrillic
});

test('detects a Cyrillic word with a stray Latin letter', () => {
  const res = detectHomoglyphs('Энэ мoнгол үг'); // Latin o in монгол
  assert.equal(res.length, 1);
  assert.equal(res[0].word, 'мoнгол');
  assert.equal(res[0].kind, 'homoglyph');
  assert.deepEqual(res[0].suggestions, ['монгол']);
  assert.equal('Энэ мoнгол үг'.slice(res[0].start, res[0].end), 'мoнгол');
});

test('detects an uppercase homoglyph at the start of a word', () => {
  const res = detectHomoglyphs('Xэрэг'); // Latin X -> Cyrillic Х
  assert.equal(res.length, 1);
  assert.deepEqual(res[0].suggestions, ['Хэрэг']);
});

test('leaves pure Cyrillic and pure Latin words alone', () => {
  assert.equal(detectHomoglyphs('монгол хэл').length, 0);
  assert.equal(detectHomoglyphs('hello world').length, 0);
});

test('ignores words whose Latin letters are not all homoglyphs', () => {
  assert.equal(detectHomoglyphs('COVIDын').length, 0); // V, D not homoglyphs
  assert.equal(detectHomoglyphs('дугаар5').length, 0); // digit isn't a letter run char anyway
});

test('detects a repeated word separated by a space', () => {
  const text = 'Энэ бол байна байна шүү';
  const res = detectRepeats(text);
  assert.equal(res.length, 1);
  assert.equal(res[0].kind, 'repeat');
  assert.equal(res[0].display, 'байна');
  // flagged span is whitespace + duplicate, so deletion is clean
  assert.equal(text.slice(res[0].start, res[0].end), ' байна');
  assert.equal(res[0].suggestions[0].value, '');
});

test('repeat detection is case-insensitive', () => {
  assert.equal(detectRepeats('Байна байна').length, 1);
});

test('does not flag repeats across punctuation or non-repeats', () => {
  assert.equal(detectRepeats('байна. байна').length, 0); // punctuation between
  assert.equal(detectRepeats('монгол хэл').length, 0);
  assert.equal(detectRepeats('а а').length, 0); // single letters skipped
});

test('applying the deletion span leaves the single word', () => {
  const text = 'сайн сайн байна';
  const [r] = detectRepeats(text);
  const fixed = text.slice(0, r.start) + '' + text.slice(r.end);
  assert.equal(fixed, 'сайн байна');
});
