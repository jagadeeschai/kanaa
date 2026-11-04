import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectSaveQueue } from '../src/editor/project-save.ts';

test('flush persists a change immediately instead of waiting for the debounce', async () => {
  const writes = [];
  const queue = new ProjectSaveQueue(async (value) => { writes.push(value); }, () => {}, 10_000);
  queue.load('old');
  queue.change('new');
  assert.equal(await queue.flush(), true);
  assert.deepEqual(writes, ['new']);
});

test('writes stay ordered and flush waits for the newest edit', async () => {
  const writes = [];
  let finishFirst;
  const queue = new ProjectSaveQueue((value) => {
    writes.push(value);
    if (value === 'one') return new Promise((resolve) => { finishFirst = resolve; });
    return Promise.resolve();
  }, () => {}, 10_000);
  queue.load('old');
  queue.change('one');
  const flushing = queue.flush();
  await new Promise((resolve) => setImmediate(resolve));
  queue.change('two');
  finishFirst();
  assert.equal(await flushing, true);
  assert.deepEqual(writes, ['one', 'two']);
});

test('failed persistence keeps the queue dirty and reports failure', async () => {
  const states = [];
  let fail = true;
  const queue = new ProjectSaveQueue(async () => { if (fail) throw new Error('offline'); }, (state) => states.push(state), 10_000);
  queue.load('old');
  queue.change('new');
  assert.equal(await queue.flush(), false);
  assert.equal(states.at(-1), 'failed');
  fail = false;
  assert.equal(await queue.flush(), true);
  assert.equal(states.at(-1), 'saved');
});
