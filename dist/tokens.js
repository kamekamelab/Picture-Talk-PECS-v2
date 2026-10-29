export function newTokenBoard(cards) {
  return { enabled: false, display: 'separate', total: 3, choiceIds: cards.slice(0, 3).map(c => c.id), rewardId: null, earned: 0, redeemed: false };
}

export function normalizeTokens(value, cards) {
  const board = value === undefined ? newTokenBoard(cards) : value;
  const known = new Set(cards.map(c => c.id));
  if (!board || typeof board.enabled !== 'boolean' || !Number.isInteger(board.total) || board.total < 1 || board.total > 5 || !Array.isArray(board.choiceIds) || board.choiceIds.length > 6 || board.choiceIds.some(id => typeof id !== 'string') || new Set(board.choiceIds).size !== board.choiceIds.length || !Number.isInteger(board.earned) || board.earned < 0 || board.earned > board.total || typeof board.redeemed !== 'boolean') throw new Error('トークンの設定が正しくありません。');
  if (board.display !== undefined && !['separate','compact'].includes(board.display)) throw new Error('トークンの表示方法が正しくありません。');
  if (board.rewardId !== null && (typeof board.rewardId !== 'string' || !board.choiceIds.includes(board.rewardId))) throw new Error('トークンの目標カードが正しくありません。');
  if ((board.rewardId === null && (board.earned !== 0 || board.redeemed)) || (board.redeemed && board.earned !== board.total)) throw new Error('トークンの進み具合が正しくありません。');
  // A deleted card must not leave a dangling target or make the app unopenable.
  const choiceIds = board.choiceIds.filter(id => known.has(id));
  const rewardId = known.has(board.rewardId) ? board.rewardId : null;
  return { enabled: board.enabled && choiceIds.length > 0, display: board.display ?? 'separate', total: board.total, choiceIds, rewardId, earned: rewardId ? board.earned : 0, redeemed: rewardId ? board.redeemed : false };
}

export function tokenStage(board) {
  return !board.rewardId ? 'choose' : board.redeemed ? 'reward' : board.earned === board.total ? 'ready' : 'collecting';
}

export function tokenTransition(board, action, value) {
  if (!board.enabled) throw new Error('先生用設定でトークンを有効にしてください。');
  const stage = tokenStage(board);
  if (action === 'reset') return { ...board, rewardId: null, earned: 0, redeemed: false };
  if (action === 'select' && stage === 'choose' && board.choiceIds.includes(value)) return { ...board, rewardId: value };
  if (action === 'add' && stage === 'collecting') return { ...board, earned: board.earned + 1 };
  if (action === 'undo' && ['collecting','ready'].includes(stage) && board.earned > 0) return { ...board, earned: board.earned - 1 };
  if (action === 'redeem' && stage === 'ready') return { ...board, redeemed: true };
  throw new Error('今はそのトークン操作はできません。');
}
