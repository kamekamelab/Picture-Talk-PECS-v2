import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, validateState, backupText, parseBackup, readingRecord, newTrial, transition } from '../dist/domain.js';
import { printPages } from '../dist/cards.js';

test('Phase 2・3を選択し、達成判定せず読み上げとして保存・復元できる', () => {
  for (const phase of [2, 3]) {
    const state = initialState(); state.profile.phase = phase;
    const record = readingRecord(state, transition(newTrial(), 'select', 'ball'), { id: 'r', at: '2026-10-22T00:00:00.000Z' });
    state.records.push(record);
    const restored = parseBackup(backupText(state));
    assert.equal(restored.profile.phase, phase);
    assert.equal(restored.records[0].phase, phase);
    assert.equal(restored.records[0].kind, 'read');
    assert.equal(restored.records[0].support, 'unrated');
  }
});
test('Phase 3の選択肢には2枚以上の存在するカードが必要', () => {
  const state = initialState(); state.profile.phase = 3;
  for (const choices of [[], ['ball'], ['ball', 'missing'], ['ball', 'ball']]) {
    state.profile.choiceIds = choices;
    assert.throws(() => validateState(state));
  }
});
test('旧版の画像・音声・記録を保ち、紙とデジタル共通の配置を追加する', () => {
  const old = initialState(); old.schemaVersion = 3;
  delete old.profile.choiceIds;
  old.cards.forEach(c => delete c.layout);
  old.settings.speech = { voiceURI: 'local', rate: 1.1 };
  const clean = validateState(old);
  assert.deepEqual(clean.cards[0].layout, { position: 'top', textSize: 'medium' });
  assert.deepEqual(clean.settings.speech, { voiceURI: 'local', rate: 1.1, pauses: true, onSelect: false });
  clean.cards[0].layout = { position: 'bottom', textSize: 'large' };
  clean.settings.speech.onSelect = true;
  assert.deepEqual(parseBackup(backupText(clean)), clean);
  clean.cards[0].layout.position = 'outside';
  assert.throws(() => validateState(clean), /文字配置/);
});
test('A4の余白内で3サイズを改ページし、選択したカードと同じ画像を使う', () => {
  const cards = Array.from({ length: 500 }, (_, i) => ({ id: 'c'+i, image: 'same-image-'+i }));
  for (const size of [25,35,45]) {
    const pages = printPages(cards, cards.map(c => c.id), size);
    const columns = pages[0].columns;
    assert.ok(columns * size + (columns - 1) * 3 <= 190);
    const maxRows = Math.ceil(pages[0].cards.length / columns);
    assert.ok(maxRows * size + (maxRows - 1) * 3 <= 277);
    assert.deepEqual(pages.flatMap(p => p.cards), cards);
  }
  assert.deepEqual(printPages(cards, ['c2'], 35)[0].cards, [cards[2]]);
  assert.deepEqual(printPages(cards, [], 35), []);
  assert.throws(() => printPages(cards, ['c2'], 30));
});
