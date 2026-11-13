import test from 'node:test';
import assert from 'node:assert/strict';
import { renameSong, songName } from '../src/timeline/signatureTitles.ts';

const item = (id, text, subtitle) => ({ id, start: 0, length: 1, text, subtitle, style: 'plain', position: 'center', color: '#fff', size: 20 });
test('a new song name reaches the card, the credit in the song and the end card', () => {
  const t = { layers: [{ id: 'm', kind: 'video', items: [] }, { id: 'a', kind: 'text', items: [item('signature-song', 'கற்கண்டு', 'KARKANDU')] },
    { id: 'b', kind: 'text', items: [item('credit-song-lower-1', 'கற்கண்டு  |  Karkandu', 'பாடல் வரிகள்')] }, { id: 'c', kind: 'text', items: [item('credit-song-end', 'கற்கண்டு', 'KARKANDU')] },
    { id: 'd', kind: 'text', items: [item('lyric-line-1', 'கற்கண்டு...', null)] }] };
  const next = renameSong(t, songName(t), { tamil: 'நிலவே', english: 'NILAVE' });
  assert.deepEqual(songName(next), { tamil: 'நிலவே', english: 'NILAVE' });
  assert.equal(next.layers[2].items[0].text, 'நிலவே  |  Nilave');
  assert.equal(next.layers[3].items[0].subtitle, 'NILAVE');
  assert.equal(next.layers[4].items[0].text, 'கற்கண்டு...', 'lyrics are never touched');
});
