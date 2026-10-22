import test from 'node:test';
import assert from 'node:assert/strict';
import { newSentenceTrial, sentenceTransition, sentenceWords } from '../dist/sentence.js';
import { initialState, validateState, backupText, parseBackup, csv } from '../dist/domain.js';
const cards = [...initialState().cards, { id: 'red', label: 'あかい', category: 'いろ', emoji: '🔴', image: null }];
const step = (trial, action, id) => sentenceTransition(trial, action, id, cards);

test('くださいを先に選んでも、後から選んだ物の最後に来る', () => {
  let t = step(newSentenceTrial(), 'ending');
  assert.equal(t.stage, 'choose');
  assert.throws(() => step(t, 'give'));
  t = step(t, 'select', 'juice');
  assert.deepEqual(sentenceWords(t, cards), ['ジュース', 'ください']);
  assert.equal(t.stage, 'selected');
});
test('並べ替え・取り消しでもくださいを末尾に保ち、英語順にしない', () => {
  let t = step(newSentenceTrial(), 'select', 'ball');
  t = step(t, 'select', 'red'); t = step(t, 'ending');
  t = step(t, 'left', 'red');
  assert.deepEqual(sentenceWords(t, cards), ['あかい', 'ボール', 'ください']);
  t = step(t, 'right', 'ball');
  assert.deepEqual(sentenceWords(t, cards), ['あかい', 'ボール', 'ください']);
  t = step(t, 'remove', 'red');
  assert.deepEqual(sentenceWords(t, cards), ['ボール', 'ください']);
  t = step(t, 'ending');
  assert.throws(() => step(t, 'give'));
});
test('文を渡す前の受け取り・二重受け取りを防ぐ', () => {
  let t = step(newSentenceTrial(), 'select', 'juice');
  assert.throws(() => step(t, 'receive'));
  assert.throws(() => step(t, 'give'));
  t = step(t, 'ending'); t = step(t, 'give');
  assert.throws(() => step(t, 'select', 'ball'));
  t = step(t, 'receive');
  assert.equal(t.stage, 'received');
  assert.throws(() => step(t, 'receive'));
  assert.deepEqual(step(t, 'reset'), newSentenceTrial());
});
test('存在しないカード・重複・枚数超過を処理する', () => {
  let t = newSentenceTrial();
  assert.throws(() => step(t, 'select', 'missing'));
  for (const id of ['juice', 'ball', 'music', 'red']) t = step(t, 'select', id);
  assert.throws(() => step(t, 'select', 'bubbles'));
  assert.equal(step(t, 'select', 'juice').cardIds.length, 4);
});
test('旧版の保存データとバックアップをPhase 1として引き継ぐ', () => {
  const old = initialState(); old.schemaVersion = 1; delete old.profile.phase;
  const migrated = validateState(old);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.profile.phase, 1);
  assert.equal(old.schemaVersion, 1);
  assert.deepEqual(migrated.cards, old.cards);
  assert.equal(parseBackup(JSON.stringify({ format: 'picture-talk-pecs-v2', data: old })).profile.phase, 1);
});
test('日本語の文をバックアップとCSVに保持し、語順違いの復元を拒否する', () => {
  const state = initialState(); state.profile.phase = 4;
  const sentence = ['ジュース', 'ください'];
  state.records.push({ id: 'r1', phase: 4, at: '2026-10-22T00:00:00.000Z', cardId: 'juice', label: sentence.join(' '), alias: 'テスト', support: 'unrated', sentence });
  assert.deepEqual(parseBackup(backupText(state)), state);
  assert.ok(csv(state.records).includes('ジュース ください'));
  state.records[0].sentence.reverse();
  assert.throws(() => validateState(state), /最後/);
});
test('誤って戻したカードを、元の位置と日本語の語順で復元できる', () => {
  let t = step(newSentenceTrial(), 'select', 'red');
  t = step(t, 'select', 'ball'); t = step(t, 'ending');
  const before = t;
  t = step(t, 'remove', 'red');
  assert.deepEqual(sentenceWords(t, cards), ['ボール', 'ください']);
  t = step(t, 'undo');
  assert.deepEqual(t, before);
  assert.deepEqual(sentenceWords(t, cards), ['あかい', 'ボール', 'ください']);
});
test('追加・要求表現を1操作ずつ戻せ、空の帯でも壊れない', () => {
  let t = step(newSentenceTrial(), 'select', 'ball');
  t = step(t, 'ending');
  t = step(t, 'undo');
  assert.deepEqual(sentenceWords(t, cards), ['ボール']);
  assert.equal(t.stage, 'choose');
  t = step(t, 'undo');
  assert.deepEqual(t, newSentenceTrial());
  assert.deepEqual(step(t, 'undo'), t);
});
test('提示を戻すと編集中の同じ文に戻り、受け取り済みの交換は取り消さない', () => {
  let t = step(newSentenceTrial(), 'select', 'ball');
  t = step(t, 'ending');
  const complete = t;
  t = step(t, 'give');
  assert.deepEqual(step(t, 'undo'), complete);
  t = step(t, 'receive');
  assert.throws(() => step(t, 'undo'), /受け取った/);
});
test('無効な操作を履歴に入れず、長時間の利用でも履歴数を制限する', () => {
  let t = step(newSentenceTrial(), 'select', 'ball');
  const before = t;
  t = step(t, 'select', 'ball');
  assert.equal(t.history.length, before.history.length);
  t = step(t, 'remove', 'missing');
  assert.equal(t.history.length, before.history.length);
  for (let i = 0; i < 120; i++) t = step(t, 'ending');
  assert.equal(t.history.length, 100);
  assert.deepEqual(before.cardIds, ['ball']);
  assert.equal(before.ending, false);
});
