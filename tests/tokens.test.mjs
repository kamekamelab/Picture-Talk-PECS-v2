import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, validateState, backupText, parseBackup, readingRecord } from '../dist/domain.js';
import { newSentenceTrial, sentenceTransition } from '../dist/sentence.js';
import { normalizeTokens, tokenStage, tokenTransition } from '../dist/tokens.js';

function enabled() { const state = initialState(); state.tokens.enabled = true; return state; }
test('旧v7の写真・記録・設定を保ちトークンを無効の初期値で追加する', () => {
  const state = initialState(); state.schemaVersion = 7; delete state.tokens;
  const copy = structuredClone(state);
  const result = validateState(state);
  assert.equal(result.schemaVersion, 8);
  assert.equal(result.tokens.enabled, false);
  assert.deepEqual(result.cards, copy.cards);
  assert.deepEqual(result.settings, copy.settings);
  assert.deepEqual(result.records, copy.records);
});
test('選択→手動加算→必要数到達→楽しみ表示→次の回を順に処理する', () => {
  let board = enabled().tokens;
  assert.throws(() => tokenTransition(board,'add'));
  board = tokenTransition(board,'select','ball');
  assert.equal(tokenStage(board),'collecting');
  assert.throws(() => tokenTransition(board,'redeem'));
  for(let i=0;i<3;i++) board = tokenTransition(board,'add');
  assert.equal(tokenStage(board),'ready');
  assert.throws(() => tokenTransition(board,'add'));
  board = tokenTransition(board,'redeem');
  assert.equal(tokenStage(board),'reward');
  assert.throws(() => tokenTransition(board,'redeem'));
  assert.throws(() => tokenTransition(board,'undo'));
  board = tokenTransition(board,'reset');
  assert.equal(board.earned,0); assert.equal(board.rewardId,null);
});
test('1個・5個の設定と取り消しが境界を越えず選択カードを保持する', () => {
  for(const total of [1,5]) {
    let board = {...enabled().tokens,total};
    board = tokenTransition(board,'select','juice');
    assert.throws(() => tokenTransition(board,'undo'));
    for(let i=0;i<total;i++) board = tokenTransition(board,'add');
    board = tokenTransition(board,'undo');
    assert.equal(board.earned,total-1); assert.equal(board.rewardId,'juice');
    assert.equal(tokenStage(board),'collecting');
  }
});
test('バックアップにトークンの途中経過を含め、読み上げと相互に加算しない', () => {
  const state = enabled(); state.profile.phase = 4;
  state.tokens = tokenTransition(tokenTransition(state.tokens,'select','ball'),'add');
  let trial = sentenceTransition(newSentenceTrial(), 'select', 'ball', state.cards);
  trial = sentenceTransition(trial,'ending',null,state.cards);
  readingRecord(state,trial,{id:'read_1',at:'2026-10-29T00:00:00.000Z'});
  assert.equal(state.tokens.earned,1);
  assert.deepEqual(state.records,[]);
  const restored = parseBackup(backupText(state));
  assert.deepEqual(restored.tokens,state.tokens);
  assert.deepEqual(restored.cards,state.cards);
});
test('不正な個数・重複・未達成の完了を拒否し削除された目標を安全に解除する', () => {
  const state = enabled();
  for(const patch of [{total:0},{total:6},{earned:-1},{earned:4},{choiceIds:['ball','ball']},{rewardId:'unknown'},{redeemed:true}]) {
    assert.throws(()=>normalizeTokens({...state.tokens,...patch},state.cards));
  }
  const selected = tokenTransition(tokenTransition(state.tokens,'select','ball'),'add');
  const clean = normalizeTokens(selected,state.cards.filter(c=>c.id !== 'ball'));
  assert.equal(clean.rewardId,null); assert.equal(clean.earned,0);
  assert.ok(!clean.choiceIds.includes('ball'));
  assert.throws(()=>tokenTransition({...selected,enabled:false},'add'));
});
