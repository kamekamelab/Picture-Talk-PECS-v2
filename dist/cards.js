// 紙と画面で共通に使うカードのレイアウト。
export function cardLayout(value) {
  const layout = value ?? { position: 'top', textSize: 'medium' };
  if (!layout || !['top', 'bottom'].includes(layout.position) || !['small', 'medium', 'large'].includes(layout.textSize)) throw new Error('カードの文字配置が正しくありません。');
  return { position: layout.position, textSize: layout.textSize };
}
export function printPages(cards, selectedIds, size) {
  if (![25, 35, 45].includes(size)) throw new Error('印刷サイズを選んでください。');
  const selected = cards.filter(c => selectedIds.includes(c.id));
  const columns = Math.floor((190 + 3) / (size + 3));
  const rows = Math.floor((277 + 3) / (size + 3));
  const count = columns * rows;
  return Array.from({ length: Math.ceil(selected.length / count) }, (_, i) => ({ columns, cards: selected.slice(i * count, (i + 1) * count) }));
}
