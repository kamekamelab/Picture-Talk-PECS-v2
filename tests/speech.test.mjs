import test from 'node:test';
import assert from 'node:assert/strict';
import { localJapaneseVoice, speechText, createReader } from '../dist/speech.js';

const local = { name: '日本語（端末内）', lang: 'ja-JP', localService: true, default: false };
const remote = { name: '日本語（クラウド）', lang: 'ja-JP', localService: false, default: true };
function setup(voices = [remote, local]) {
  const spoken = [], states = [], errors = [];
  let cancels = 0;
  const synth = { getVoices: () => voices, speak: utterance => spoken.push(utterance), cancel: () => { cancels++; } };
  class Utterance { constructor(text) { this.text = text; } }
  const reader = createReader({ synth, Utterance, onState: (...args) => states.push(args), onError: error => errors.push(error) });
  return { reader, spoken, states, errors, get cancels() { return cancels; } };
}
test('既定がクラウド音声でも、端末内の日本語音声を明示選択する', () => {
  const s = setup();
  s.reader.read(['ボール', 'ください']);
  assert.equal(s.spoken.length, 1);
  assert.equal(s.spoken[0].voice, local);
  assert.equal(s.spoken[0].lang, 'ja-JP');
  assert.equal(s.spoken[0].text, 'ボール、ください。');
  assert.equal(s.reader.reading, true);
  s.spoken[0].onend();
  assert.equal(s.reader.reading, false);
  assert.deepEqual(s.states.at(-1), [false, 'finished']);
});
test('端末内の日本語音声がない場合、クラウド・言語違い・未判定の音声に送らない', () => {
  for (const voices of [[remote], [{ ...local, localService: undefined }], [{ ...local, lang: 'en-US' }], []]) {
    const s = setup(voices);
    assert.equal(localJapaneseVoice(voices), null);
    assert.throws(() => s.reader.read(['ボール', 'ください']), /端末内/);
    assert.equal(s.spoken.length, 0);
  }
});
test('文の取消や連打で音声が重ならず、古い終了イベントが新しい再生を止めない', () => {
  const s = setup();
  s.reader.read(['ボール', 'ください']);
  const first = s.spoken[0];
  s.reader.read(['ジュース', 'ください']);
  assert.equal(s.cancels, 1);
  first.onend();
  assert.equal(s.reader.reading, true);
  s.reader.stop();
  assert.equal(s.cancels, 2);
  assert.equal(s.reader.reading, false);
  s.spoken[1].onerror({ error: 'canceled' });
  assert.equal(s.errors.length, 0);
});
test('並べた順を維持し、空の文は再生しない', () => {
  assert.equal(speechText(['あかい', 'ボール', 'ください']), 'あかい、ボール、ください。');
  assert.throws(() => speechText([]));
  assert.throws(() => speechText(['']));
  const s = setup();
  assert.throws(() => s.reader.read([]));
  assert.equal(s.spoken.length, 0);
});
test('非対応ブラウザーと再生エラーを扱える', () => {
  const unavailable = createReader({});
  assert.throws(() => unavailable.read(['ボール']), /利用できません/);
  const s = setup(); s.reader.read(['ボール']);
  s.spoken[0].onerror({ error: 'audio-busy' });
  assert.equal(s.reader.reading, false);
  assert.equal(s.errors.length, 1);
});
