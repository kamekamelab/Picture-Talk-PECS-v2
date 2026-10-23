import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, readingRecord, backupText, parseBackup, validateState, csv } from '../dist/domain.js';
import { newSentenceTrial, sentenceTransition, sentenceWords, COMMENTS } from '../dist/sentence.js';
const meta = { id:'r56', at:'2026-10-23T00:00:00.000Z' };
function step(t, action, value, state) { return sentenceTransition(t, action, value, state.cards); }
test('Phase 5は要求の日本語語順と質問のきっかけを保存・復元する', () => {
  const state = initialState(); state.profile.phase = 5;
  let t = step(newSentenceTrial(), 'ending', null, state);
  assert.throws(() => readingRecord(state,t,meta));
  t = step(t,'select','ball',state);
  const record = readingRecord(state,t,meta);
  assert.deepEqual(record.sentence,['ボール','ください']);
  assert.equal(record.context,'なにが ほしいですか？');
  assert.equal(record.support,'unrated');
  state.records.push(record);
  assert.deepEqual(parseBackup(backupText(state)),state);
  assert.ok(csv(state.records).includes('なにが ほしいですか？'));
});
test('Phase 6はコメントを文末に置き、質問への応答と質問なしを区別する', () => {
  for (const mode of ['spontaneous',...Object.keys(COMMENTS)]) {
    const state = initialState(); state.profile.phase = 6; state.profile.commentMode = mode;
    for (const c of Object.values(COMMENTS)) {
      let t = step(newSentenceTrial(''),'expression',c.label,state);
      assert.equal(t.stage,'choose');
      t = step(t,'select','ball',state);
      assert.deepEqual(sentenceWords(t,state.cards),['ボール',c.label]);
      const record = readingRecord(state,t,meta);
      assert.equal(record.kind,'read');
      assert.equal(record.context,mode==='spontaneous'?'自分からのコメント':COMMENTS[mode].question);
      state.records=[record];
      assert.deepEqual(parseBackup(backupText(state)),state);
    }
  }
});
test('コメントの切り替え・タップで戻す・取消でも元の文と語順を復元する', () => {
  const s=initialState(); let t=newSentenceTrial('');
  t=step(t,'select','music',s);
  assert.equal(t.stage,'choose');
  t=step(t,'expression','がきこえます',s);
  t=step(t,'expression','がみえます',s);
  t=step(t,'undo',null,s);
  assert.deepEqual(sentenceWords(t,s.cards),['おんがく','がきこえます']);
  t=step(t,'ending',null,s);
  assert.equal(t.stage,'choose');
  t=step(t,'undo',null,s);
  assert.equal(t.stage,'selected');
  assert.deepEqual(sentenceWords(t,s.cards),['おんがく','がきこえます']);
  assert.throws(()=>step(t,'expression','ください',s));
  assert.throws(()=>step(newSentenceTrial(),'expression','がみえます',s));
});
test('学習段階に合わない文末や不正なコメントのきっかけを復元しない', () => {
  const s=initialState(); s.profile.phase=6;
  let t=step(newSentenceTrial(''),'expression','がみえます',s); t=step(t,'select','ball',s);
  const r=readingRecord(s,t,meta); s.records=[r];
  s.records[0].context='automatic-success'; assert.throws(()=>validateState(s));
  s.records[0]={...r,phase:5}; assert.throws(()=>validateState(s),/最後/);
  s.records[0]={...r,sentence:['ボール','ください'],label:'ボール ください'}; assert.throws(()=>validateState(s),/最後/);
  s.profile.phase=5; assert.throws(()=>readingRecord(s,t,meta));
});
test('旧版v4の画像・配置・声・記録を保って6段階対応へ移行する', () => {
  const s=initialState(); s.schemaVersion=4; delete s.profile.commentMode;
  s.cards[0].layout={position:'bottom',textSize:'large'};
  s.settings.speech.onSelect=true;
  const clean=validateState(s);
  assert.equal(clean.schemaVersion,7);
  assert.equal(clean.profile.commentMode,'spontaneous');
  assert.deepEqual(clean.cards,s.cards);
  assert.deepEqual(clean.settings,s.settings);
});
