import test from 'node:test';
import assert from 'node:assert/strict';
import { explainError } from '../src/editor/errors.ts';

test('technical errors become plain words, with the original kept', () => {
  const lost = explainError('TypeError: Failed to fetch');
  assert.match(lost.text, /could not reach/);
  assert.equal(lost.details, 'TypeError: Failed to fetch');
  assert.match(explainError('Kanaa said: 500').text, /went wrong inside Kanaa/);
});

test('messages written for people are shown as they are', () => {
  const plain = explainError('Put the title over a video with people in it first.');
  assert.equal(plain.text, 'Put the title over a video with people in it first.');
  assert.equal(plain.details, null);
});
