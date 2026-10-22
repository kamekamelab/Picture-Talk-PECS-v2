export const REQUEST = 'ください';
export const COMMENTS = { see: { label: 'がみえます', emoji: '👀', question: 'なにが みえますか？' }, hear: { label: 'がきこえます', emoji: '👂', question: 'なにが きこえますか？' }, have: { label: 'をもっています', emoji: '🙌', question: 'なにを もっていますか？' } };
export const commentEndings = Object.values(COMMENTS).map(c => c.label);
export function endingWord(trial) { return trial.expression ?? REQUEST; }
export function newSentenceTrial(expression, everyday = false) {
  return { stage: 'choose', cardIds: [], ending: false, history: [], ...(expression !== undefined ? { expression } : {}), ...(everyday ? { everyday: true } : {}) };
}
function remember(trial, next) {
  const previous = { stage: trial.stage, cardIds: [...trial.cardIds], ending: trial.ending, ...(trial.everyday ? { everyday: true } : {}), ...(trial.expression !== undefined ? { expression: trial.expression } : {}) };
  return { ...next, history: [...(trial.history || []), previous].slice(-100) };
}
export function sentenceWords(trial, cards) {
  const words = trial.cardIds.map(id => {
    const card = cards.find(c => c.id === id);
    if (!card || card.label.trim() === REQUEST) throw new Error('文に使うカードが見つかりません。');
    return card.label;
  });
  if (trial.ending && ![REQUEST, ...commentEndings].includes(endingWord(trial))) throw new Error('文末のカードを選んでください。');
  return trial.ending ? [...words, endingWord(trial)] : words;
}
export function sentenceTransition(trial, action, value, cards) {
  if (action === 'reset') return newSentenceTrial(trial.expression, trial.everyday);
  if (action === 'undo') {
    if (!['choose', 'selected', 'partner'].includes(trial.stage)) throw new Error('受け取った記録は取り消せません。');
    const history = trial.history || [];
    if (!history.length) return trial;
    const previous = history.at(-1);
    return { ...previous, cardIds: [...previous.cardIds], history: history.slice(0, -1) };
  }
  if (action === 'give' && trial.stage === 'selected') return remember(trial, { ...trial, stage: 'partner' });
  if (action === 'receive' && trial.stage === 'partner') return { ...trial, stage: 'received' };
  if (!['choose', 'selected'].includes(trial.stage)) throw new Error('文を作っているときに操作してください。');
  let next = { ...trial, cardIds: [...trial.cardIds] };
  if (action === 'select') {
    if (next.cardIds.includes(value)) return next;
    if (next.cardIds.length >= 4) throw new Error('ことばのカードは4枚までです。');
    next.cardIds.push(value);
    sentenceWords(next, cards);
  } else if (action === 'expression') {
    if (trial.expression === undefined || !(trial.everyday ? [REQUEST, ...commentEndings] : commentEndings).includes(value)) throw new Error('コメントの文末を選んでください。');
    next.expression = value; next.ending = true;
  } else if (action === 'ending') {
    if (!endingWord(next)) throw new Error('文末のカードを選んでください。');
    next.ending = !next.ending;
  } else if (action === 'remove') {
    if (!next.cardIds.includes(value)) return trial;
    next.cardIds = next.cardIds.filter(id => id !== value);
  } else if (action === 'left' || action === 'right') {
    const index = next.cardIds.indexOf(value);
    const other = index + (action === 'left' ? -1 : 1);
    if (index < 0 || other < 0 || other >= next.cardIds.length) return next;
    [next.cardIds[index], next.cardIds[other]] = [next.cardIds[other], next.cardIds[index]];
  } else throw new Error('この操作は今はできません。');
  next.stage = next.cardIds.length && next.ending ? 'selected' : 'choose';
  return remember(trial, next);
}
