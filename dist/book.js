export function normalizeBook(value, cards) {
  const rails = value?.rails ?? 4;
  if (![4, 5].includes(rails)) throw new Error('マジックテープは4本か5本を選んでください。');
  const columns = value?.columns ?? Array.from({length: rails}, () => []);
  if (!Array.isArray(columns) || columns.length !== rails || columns.some(c => !Array.isArray(c) || c.length > 500)) throw new Error('カードの配置が正しくありません。');
  const known = new Set(cards.map(c => c.id)), seen = new Set();
  const clean = columns.map(column => column.filter(id => {
    if (typeof id !== 'string' || seen.has(id)) throw new Error('カードの配置が重複しています。');
    seen.add(id); return known.has(id);
  }));
  for (const card of cards) if (!seen.has(card.id)) {
    const index = clean.reduce((best,c,i) => c.length < clean[best].length ? i : best, 0);
    clean[index].push(card.id);
  }
  return {rails, columns: clean};
}
export function resizeBook(book, rails) {
  if (![4,5].includes(rails)) throw new Error('マジックテープは4本か5本を選んでください。');
  const columns = Array.from({length:rails}, (_,i) => [...(book.columns[i] || [])]);
  if (rails < book.rails) columns[rails-1].push(...book.columns.slice(rails).flat());
  return {rails,columns};
}
export function moveBookCard(book, id, rail, before = null) {
  if (!Number.isInteger(rail) || rail < 0 || rail >= book.rails || !book.columns.flat().includes(id)) throw new Error('移動先を選び直してください。');
  if (before === id) return book;
  const columns = book.columns.map(c => c.filter(value => value !== id));
  const index = before === null ? -1 : columns[rail].indexOf(before);
  if (before !== null && index < 0) throw new Error('移動先のカードが見つかりません。');
  columns[rail].splice(index < 0 ? columns[rail].length : index, 0, id);
  return {rails:book.rails,columns};
}
