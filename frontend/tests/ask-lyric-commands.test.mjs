import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPure, describeCommand, usable } from '../src/timeline/commands.ts';
import { currentLyricLayout } from '../src/timeline/lyric-layouts.ts';
import { currentMood } from '../src/timeline/mood-grade.ts';

const REST = { x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0 };
const line = (id, start, text) => ({ id, start, length: 3, text, style: 'shadow', position: 'bottom', color: '#ffffff', size: 40, transform: REST });
const song = () => ({ version: 2, format: { width: 1920, height: 1080, fps: 30 }, layers: [
  { id: 'main', kind: 'video', name: 'Main', magnetic: true, items: [{ id: 'a', media_id: 1, start: 0, in: 0, out: 40, speed: 1, volume: 0, muted: true, fade_in: 0, fade_out: 0, transform: REST, adjust: {} }] },
  { id: 'lyrics', kind: 'text', name: 'Lyrics', items: [line('v1', 3, 'காற்றில் ஒரு பாட்டு'), line('c1', 6.5, 'நிலவே நீ வா'), line('v2', 10, 'மழையின் துளி'), line('c2', 13.5, 'நிலவே நீ வா')] }] });
const OPTIONS = { themes: [], looks: [], transitions: [], effects: [], formats: [], stories: [], title_styles: [] };
const lines = (timeline) => timeline.layers.find((layer) => layer.id === 'lyrics').items;

test('Ask AI lyric edits are checked against the video and run like the panels', () => {
  const ask = (name, args) => ({ name, args });
  for (const command of [ask('lyric_layout', { layout: 'two-line' }), ask('style_chorus', {}), ask('word_motion', { preset: 'word-pop', lines: 'chorus' }), ask('mood_grade', { mood: 'film' }), ask('sung_glow', { on: true }), ask('make_short', { look: true })]) {
    assert.ok(usable(command, OPTIONS, song()), command.name);
    assert.ok(describeCommand(command, OPTIONS).length > 5);
  }
  assert.equal(usable(ask('lyric_layout', { layout: 'sideways' }), OPTIONS, song()), false);
  assert.equal(currentLyricLayout(applyPure(song(), ask('lyric_layout', { layout: 'two-line' }))), 'two-line');
  assert.equal(currentMood(applyPure(song(), ask('mood_grade', { mood: 'film' }))), 'film');
  const popped = lines(applyPure(song(), ask('word_motion', { preset: 'word-pop', lines: 'chorus' })));
  assert.deepEqual(popped.map((item) => item.enter?.preset ?? null), [null, 'word-pop', null, 'word-pop'], 'only the chorus');
  assert.equal(applyPure(song(), ask('chorus_light_hits', {})), null, 'the song and the light come from the server');
  const plain = song(); plain.layers[1].items = [line('v1', 3, 'ஒரு வரி')];
  assert.equal(usable(ask('style_chorus', {}), OPTIONS, plain), false, 'no chorus, no chorus tools');
});
