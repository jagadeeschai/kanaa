import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUDIO_PRESETS, presetSteps } from '../src/timeline/audioPresets.ts';

const fixture = JSON.parse(readFileSync(new URL('../../timeline/fixtures/audio-presets.expected.json', import.meta.url)));

test('the same presets and numbers as audio_presets.py', () => {
  assert.deepEqual(Object.fromEntries(AUDIO_PRESETS.map((preset) => [preset.id, preset.steps])), fixture);
});

test('steps come in the fixed order whatever order they were picked in', () => {
  assert.deepEqual(presetSteps(['even-out', 'remove-rumble']), presetSteps(['remove-rumble', 'even-out']));
  assert.deepEqual(presetSteps([]), []);
});
