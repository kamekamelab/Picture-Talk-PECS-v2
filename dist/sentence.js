export const REQUEST = 'ください';
export function newSentenceTrial() {
  return { stage: 'choose', cardIds: [], ending: false };
}
export function sentenceWords(trial, cards) {
  const words = trial.cardIds.map(id => {
    const card = cards.find(c => c.id === id);
    if (!card || card.label.trim() === REQUEST) throw new Error('文に使うカードが見つかりません。');
    return card.label;
  });
  return trial.ending ? [...words, REQUEST] : words;
}
export function sentenceTransition(trial, action, value, cards) {
  if (action === 'reset') return newSentenceTrial();
  if (action === 'give' && trial.stage === 'selected') return { ...trial, stage: 'partner' };
  if (action === 'receive' && trial.stage === 'partner') return { ...trial, stage: 'received' };
  if (!['choose', 'selected'].includes(trial.stage)) throw new Error('文を作っているときに操作してください。');
  let next = { ...trial, cardIds: [...trial.cardIds] };
  if (action === 'select') {
    if (next.cardIds.includes(value)) return next;
    if (next.cardIds.length >= 4) throw new Error('ことばのカードは4枚までです。');
    next.cardIds.push(value);
    sentenceWords(next, cards);
  } else if (action === 'ending') {
    next.ending = !next.ending;
  } else if (action === 'remove') {
    next.cardIds = next.cardIds.filter(id => id !== value);
  } else if (action === 'left' || action === 'right') {
    const index = next.cardIds.indexOf(value);
    const other = index + (action === 'left' ? -1 : 1);
    if (index < 0 || other < 0 || other >= next.cardIds.length) return next;
    [next.cardIds[index], next.cardIds[other]] = [next.cardIds[other], next.cardIds[index]];
  } else throw new Error('この操作は今はできません。');
  next.stage = next.cardIds.length && next.ending ? 'selected' : 'choose';
  return next;
}
