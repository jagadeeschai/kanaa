import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPure, describeCommand, translateCaptions, usable } from '../src/timeline/commands.ts';
import { emptyTimeline, insertClip, mainLayer, newClip, setCaptions } from '../src/timeline/model.ts';

const options = { themes: [{ id: 'wedding', label: 'Wedding' }], looks: [{ id: 'warm', label: 'Warm' }, { id: 'mono', label: 'Mono' }], transitions: [{ id: 'wipe', label: 'Wipe' }],
  effects: [{ id: 'confetti', label: 'Confetti' }], formats: [{ id: 'youtube', label: 'YouTube (16:9)' }], stories: [{ id: 'trip', label: 'Trip recap' }], title_styles: [{ id: 'cinematic', label: 'Cinematic' }] };
const video = { media_id: 1, media_type: 'video', duration: 10 };
const three = () => ['a', 'b', 'c'].reduce((t, id) => insertClip(t, newClip(video, id)), emptyTimeline({ width: 1080, height: 1920, fps: 30 }));

test('commands are checked against what the editor really has', () => {
  const t = three();
  assert.ok(usable({ name: 'set_look', args: { look: 'warm', clips: [1, 3] } }, options, t));
  assert.ok(!usable({ name: 'set_look', args: { look: 'sepia', clips: 'all' } }, options, t));
  assert.ok(!usable({ name: 'set_look', args: { look: 'warm', clips: [4] } }, options, t));
  assert.ok(!usable({ name: 'set_transition', args: { transition: 'wipe', clips: [1] } }, options, t), 'clip 1 has nothing before it');
  assert.ok(!usable({ name: 'translate_captions', args: { to: 'ta' } }, options, t), 'no captions yet');
  assert.ok(!usable({ name: 'drop_table', args: {} }, options, t));
  assert.ok(usable({ name: 'add_title', args: { text: 'வணக்கம்', at: 2 } }, options, t));
});

test('pure commands change only what they say', () => {
  const t = three();
  const looked = applyPure(t, { name: 'set_look', args: { look: 'mono', clips: [2] } });
  assert.deepEqual(mainLayer(looked).items.map((clip) => clip.look ?? 'none'), ['none', 'mono', 'none']);
  const blended = applyPure(t, { name: 'set_transition', args: { transition: 'wipe', clips: 'all' } });
  assert.deepEqual(mainLayer(blended).items.map((clip) => clip.transition_in?.kind ?? null), [null, 'wipe', 'wipe']);
  assert.deepEqual(applyPure(t, { name: 'set_format', args: { format: 'youtube' } }).format, { width: 1920, height: 1080, fps: 30 });
  assert.equal(applyPure(t, { name: 'set_theme', args: { theme: 'wedding' } }), null, 'the editor runs themes itself');
  assert.equal(describeCommand({ name: 'add_effect', args: { effect: 'confetti', at: 75 } }, options), 'Confetti at 1:15');
});

test('translated captions keep their time and share it between the new words', () => {
  let t = setCaptions(three(), [{ id: 'c', start: 2, length: 3, words: [{ w: 'Thank', s: 0 }, { w: 'you', s: 1 }] }, { id: 'd', start: 6, length: 1, words: [{ w: 'Bye', s: 0 }] }], 'subs');
  t = translateCaptions(t, new Map([['c', 'மிக்க நன்றி உங்களுக்கு']]));
  const [first, second] = t.layers.find((layer) => layer.kind === 'captions').items;
  assert.deepEqual(first.words, [{ w: 'மிக்க', s: 0 }, { w: 'நன்றி', s: 1 }, { w: 'உங்களுக்கு', s: 2 }]);
  assert.equal(first.start, 2); assert.equal(first.length, 3);
  assert.equal(second.words[0].w, 'Bye', 'untranslated lines stay');
  const long = translateCaptions(t, new Map([['d', Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ')]]));
  assert.equal(long.layers.find((layer) => layer.kind === 'captions').items[1].words.length, 30, 'the schema allows 30 words a caption');
});
