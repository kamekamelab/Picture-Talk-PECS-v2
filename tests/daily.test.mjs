import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,readingRecord,backupText,parseBackup,validateState,csv} from '../dist/domain.js';
import {newSentenceTrial,sentenceTransition,sentenceWords} from '../dist/sentence.js';
const meta={id:'daily_read',at:'2026-10-23T00:00:00.000Z'};
function setup() {
 const s=initialState(); s.profile.mode='daily';
 s.cards.push({id:'big',label:'おおきい',category:'おおきさ',emoji:'',image:null,layout:{position:'top',textSize:'medium'}});
 return s;
}
test('ふだん使いは属性語・物・文末の日本語順を保ち、フェイズの記録と区別する',()=>{
 const s=setup(); let t=newSentenceTrial('',true);
 t=sentenceTransition(t,'expression','ください',s.cards);
 for(const id of ['big','ball'])t=sentenceTransition(t,'select',id,s.cards);
 assert.deepEqual(sentenceWords(t,s.cards),['おおきい','ボール','ください']);
 const record=readingRecord(s,t,meta); assert.equal(record.phase,0);
 assert.equal(record.support,'unrated'); s.records=[record];
 assert.deepEqual(parseBackup(backupText(s)),validateState(s));
 assert.ok(csv(s.records).includes('ふだん使い'));
});
test('ふだん使いで要求とコメントを切り替え、取消で元の文に戻せる',()=>{
 const s=setup(); let t=newSentenceTrial('',true);
 t=sentenceTransition(t,'select','ball',s.cards);
 t=sentenceTransition(t,'expression','ください',s.cards);
 t=sentenceTransition(t,'expression','がみえます',s.cards);
 s.records=[readingRecord(s,t,meta)];
 assert.deepEqual(parseBackup(backupText(s)).records[0].sentence,['ボール','がみえます']);
 t=sentenceTransition(t,'undo',null,s.cards);
 assert.deepEqual(sentenceWords(t,s.cards),['ボール','ください']);
 assert.equal(t.everyday,true);
 t=sentenceTransition(t,'reset',null,s.cards);
 assert.equal(t.everyday,true);
});
test('旧v5を練習モードとして移行し、以前のフェイズとカードを保持する',()=>{
 const s=initialState();s.schemaVersion=5;delete s.profile.mode;s.profile.phase=3;
 const clean=validateState(s);
 assert.equal(clean.schemaVersion,8);assert.equal(clean.profile.mode,'learning');assert.equal(clean.profile.phase,3);
 assert.deepEqual(clean.cards,s.cards);
 s.profile.mode='external';assert.throws(()=>validateState(s));
});
