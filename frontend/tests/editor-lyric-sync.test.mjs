import test from 'node:test';
import assert from 'node:assert/strict';
import { addText, emptyTimeline, findText, layerLines, retimeLayerLines } from '../src/timeline/model.ts';
import { shiftLyricCues, stretchLyricCues } from '../src/utils/lyrics.ts';

const line = (id, start) => ({ id, start, length: 3, text: id, style: 'shadow', position: 'bottom', color: '#ffffff', size: 40 });
const lyrics = () => ['l1', 'l2', 'l3', 'l4'].reduce((t, id, i) => addText(t, line(id, 1 + i * 4), 'L'), emptyTimeline({ width: 1920, height: 1080, fps: 30 }));
const layerId = (t) => t.layers.find((l) => l.kind === 'text').id;

test('shifting all lyric titles on a layer', () => {
  const t = lyrics();
  const next = retimeLayerLines(t, layerId(t), shiftLyricCues(layerLines(t, layerId(t)), 0, 3, 0.5, 60));
  assert.deepEqual(['l1', 'l2', 'l3', 'l4'].map((id) => findText(next, id).text.start), [1.5, 5.5, 9.5, 13.5]);
});

test('stretching lyric titles, and a moved line never runs into the next', () => {
  const t = lyrics();
  const next = retimeLayerLines(t, layerId(t), stretchLyricCues(layerLines(t, layerId(t)), 0, 3, 1, 15.5, 60));
  assert.equal(findText(next, 'l4').text.start, 15.5);
  const shifted = retimeLayerLines(t, layerId(t), shiftLyricCues(layerLines(t, layerId(t)), 1, 1, 2.5, 60));
  assert.equal(findText(shifted, 'l2').text.start, 7.5);
  assert.equal(findText(shifted, 'l2').text.length, 1.5);
});
