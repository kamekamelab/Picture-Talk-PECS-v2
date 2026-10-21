import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, validateState, newTrial, transition, backupText, parseBackup, csv } from '../dist/domain.js';

test('相手の受け取り確認前に交換を完了できない', () => {
  const start = newTrial();
  assert.throws(() => transition(start, 'receive'));
  assert.throws(() => transition(start, 'give'));
  const selected = transition(start, 'select', 'juice');
  assert.throws(() => transition(selected, 'receive'));
  const partner = transition(selected, 'give');
  const received = transition(partner, 'receive');
  assert.equal(received.stage, 'received');
  assert.throws(() => transition(received, 'receive'));
  assert.deepEqual(transition(received, 'reset'), start);
});
test('画像・記録・設定をバックアップから復元できる', () => {
  const state = initialState();
  state.cards[0].image = 'data:image/png;base64,aGVsbG8=';
  state.records.push({ id: 'r1', phase: 1, cardId: 'juice', label: '前のカード名', alias: 'A', at: '2026-10-21T00:00:00.000Z', support: 'unrated' });
  assert.deepEqual(parseBackup(backupText(state)), state);
});
test('未知の形式・壊れたファイル・不正な画像・重複IDを拒否する', () => {
  assert.throws(() => parseBackup('{broken'));
  assert.throws(() => parseBackup('{"format":"other"}'));
  const state = initialState();
  state.cards[0].image = 'https://external.example/photo.jpg';
  assert.throws(() => validateState(state));
  state.cards[0].image = 'data:image/svg+xml;base64,PHN2Zz4=';
  assert.throws(() => validateState(state));
  state.cards[0].image = null;
  state.cards.push({ ...state.cards[0] });
  assert.throws(() => validateState(state));
});
test('旧カードの記録はカード削除後も保持できる', () => {
  const state = initialState();
  state.records.push({ id: 'r1', phase: 1, cardId: 'deleted', label: '元の名前', alias: 'A', at: '2026-10-21T00:00:00.000Z', support: 'assisted' });
  assert.equal(validateState(state).records[0].label, '元の名前');
});
test('存在しない学習カード・未対応Phase・不正な評価を復元しない', () => {
  const state = initialState();
  state.profile.cardId = 'missing';
  assert.throws(() => validateState(state));
  state.profile.cardId = 'juice';
  state.records.push({ id: 'r1', phase: 2, cardId: 'juice', label: 'J', alias: 'A', at: '2026-10-21T00:00:00.000Z', support: 'independent' });
  assert.throws(() => validateState(state));
  state.records[0].phase = 1; state.records[0].support = 'automatic';
  assert.throws(() => validateState(state));
});
test('CSVの日本語と改行・引用符を保持し数式の実行を抑える', () => {
  const output = csv([{ at: '2026-10-21T00:00:00.000Z', alias: '=1+1', phase: 1, label: 'りんご,"赤"\nジュース', support: 'independent' }]);
  assert.ok(output.startsWith('\uFEFF'));
  assert.ok(output.includes("'=1+1"));
  assert.ok(output.includes('りんご,""赤""\nジュース'));
});
test('未知のキーを除去し復元したデータを正規化する', () => {
  const state = initialState(); state.profile.secret = 'unexpected';
  state.settings.pin = { salt: '0'.repeat(32), hash: '1'.repeat(64), extra: true };
  const output = validateState(state);
  assert.equal(output.profile.secret, undefined);
  assert.equal(output.settings.pin.extra, undefined);
});
test('バックアップから復元できない総量になる前に保存を止める', () => {
  const state = initialState();
  state.cards = Array.from({length:14}, (_,i) => ({ ...state.cards[0], id:'c'+i, image:'data:image/png;base64,'+'A'.repeat(1950000) }));
  state.profile.cardId = 'c0';
  assert.throws(() => validateState(state), /24MB/);
});
