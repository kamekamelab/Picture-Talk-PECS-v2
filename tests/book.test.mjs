import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBook,resizeBook,moveBookCard} from '../dist/book.js';
import {initialState,validateState,backupText,parseBackup} from '../dist/domain.js';
test('カードなしの列も含めて常に4本か5本を保持し、旧版を移行する',()=>{
 const s=initialState();delete s.settings.book;s.schemaVersion=6;
 const clean=validateState(s);assert.equal(clean.settings.book.columns.length,4);
 const one=normalizeBook(undefined,[s.cards[0]]);assert.equal(one.columns.filter(c=>!c.length).length,3);
 assert.equal(resizeBook(one,5).columns.filter(c=>!c.length).length,4);
 assert.throws(()=>resizeBook(one,3));
});
test('左右の列・同じ列の並べ替えを保存してもカードが重複・消失しない',()=>{
 const s=initialState(),original=structuredClone(s.settings.book);
 let book=moveBookCard(original,'juice',1,'ball');
 assert.deepEqual(book.columns[1],['juice','ball']);assert.deepEqual(book.columns[0],[]);
 book=moveBookCard(book,'ball',1,'juice');assert.deepEqual(book.columns[1],['ball','juice']);
 assert.deepEqual(original,s.settings.book);
 book=resizeBook(book,5);book=moveBookCard(book,'juice',4);
 book=resizeBook(book,4);assert.ok(book.columns[3].includes('juice'));
 assert.equal(new Set(book.columns.flat()).size,4);assert.equal(book.columns.flat().length,4);
 s.settings.book=book;assert.deepEqual(parseBackup(backupText(s)).settings.book,book);
});
test('カード追加・削除を配置へ反映し、不正な列・重複を拒否する',()=>{
 const s=initialState();s.cards.splice(0,1);s.profile.cardId='ball';s.profile.choiceIds=['ball'];
 const clean=validateState(s);assert.ok(!clean.settings.book.columns.flat().includes('juice'));
 assert.throws(()=>normalizeBook({rails:4,columns:[['ball'],['ball'],[],[]]},s.cards));
 assert.throws(()=>moveBookCard(clean.settings.book,'missing',0));
 assert.throws(()=>moveBookCard(clean.settings.book,'ball',8));
});


test('ページ切替で全カードに到達でき、空の列と元の順番を保持する', async () => {
  const { paginateBook } = await import('../dist/book.js');
  const columns = [['a','b','c','d','e'],[],['f'],['g','h','i']];
  const seen = columns.map(()=>[]);
  for(let index=0;index<3;index++) {
    const result = paginateBook(columns,index);
    assert.equal(result.pages,3);
    assert.equal(result.columns.length,4);
    result.columns.forEach((column,i)=>seen[i].push(...column));
  }
  assert.deepEqual(seen,columns);
  assert.equal(paginateBook(columns,99).page,2);
  assert.equal(paginateBook([[]],5).page,0);
  assert.throws(()=>paginateBook(columns,0,0));
});
