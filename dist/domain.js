export const FORMAT = 'picture-talk-pecs-v2';
export const SCHEMA = 1;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const safeImage = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
export function initialState() {
  return {
    schemaVersion: SCHEMA,
    profile: { alias: 'がくしゅうしゃ', cardId: 'juice' },
    cards: [
      { id: 'juice', label: 'ジュース', category: 'のみもの', emoji: '🧃', image: null },
      { id: 'ball', label: 'ボール', category: 'あそび', emoji: '⚽', image: null },
      { id: 'bubbles', label: 'しゃぼんだま', category: 'あそび', emoji: '🫧', image: null },
      { id: 'music', label: 'おんがく', category: 'かつどう', emoji: '🎵', image: null }
    ],
    records: [],
    settings: { showLabel: true, pin: null },
    lastBackupAt: null
  };
}
function string(value, max, field, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${field}が正しくありません。`);
  return value;
}
function id(value) {
  if (typeof value !== 'string' || !idPattern.test(value)) throw new Error('IDが正しくありません。');
  return value;
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('日時が正しくありません。');
  return value;
}
export function validateState(input) {
  if (!input || input.schemaVersion !== SCHEMA) throw new Error('対応していないデータ形式です。');
  if (!Array.isArray(input.cards) || input.cards.length < 1 || input.cards.length > 500) throw new Error('カードは1〜500枚にしてください。');
  const ids = new Set();
  const cards = input.cards.map(c => {
    if (!c || ids.has(id(c.id))) throw new Error('カードのIDが重複しています。');
    ids.add(c.id);
    if (c.image !== null && (typeof c.image !== 'string' || c.image.length > 2000000 || !safeImage.test(c.image))) throw new Error('カード画像の形式が正しくありません。');
    return { id: c.id, label: string(c.label, 40, 'カードの文字'), category: string(c.category, 30, 'カテゴリ'), emoji: string(c.emoji, 16, 'マーク', true), image: c.image };
  });
  if (!input.profile || !ids.has(input.profile.cardId)) throw new Error('学習用カードが見つかりません。');
  if (!Array.isArray(input.records) || input.records.length > 100000) throw new Error('記録の形式が正しくありません。');
  const recordIds = new Set();
  const records = input.records.map(r => {
    if (!r || recordIds.has(id(r.id)) || r.phase !== 1 || !['independent', 'assisted', 'unrated'].includes(r.support)) throw new Error('学習記録の形式が正しくありません。');
    recordIds.add(r.id);
    return { id: r.id, phase: 1, at: date(r.at), cardId: id(r.cardId), label: string(r.label, 40, '記録のカード名'), alias: string(r.alias, 40, '記録の呼び名'), support: r.support };
  });
  if (!input.settings || typeof input.settings.showLabel !== 'boolean') throw new Error('設定が正しくありません。');
  const pin = input.settings.pin;
  if (pin !== null && (!pin || !/^[a-f0-9]{32}$/.test(pin.salt) || !/^[a-f0-9]{64}$/.test(pin.hash))) throw new Error('PIN設定が正しくありません。');
  const clean = {
    schemaVersion: SCHEMA,
    profile: { alias: string(input.profile.alias, 40, '呼び名'), cardId: input.profile.cardId },
    cards, records,
    settings: { showLabel: input.settings.showLabel, pin: pin ? { salt: pin.salt, hash: pin.hash } : null },
    lastBackupAt: input.lastBackupAt === null ? null : date(input.lastBackupAt)
  };
  // 常に復元可能なサイズで書き出せるよう、封筒分の余裕を残す。
  if (new TextEncoder().encode(JSON.stringify(clean)).length > 24 * 1024 * 1024) throw new Error('保存データが24MBを超えます。バックアップを保存してから、使わないカードを整理してください。');
  return clean;
}
export function backupText(state) {
  return JSON.stringify({ format: FORMAT, exportedAt: new Date().toISOString(), data: validateState(state) });
}
export function parseBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('バックアップは25MB以下にしてください。');
  let input;
  try { input = JSON.parse(text); } catch { throw new Error('JSONファイルを読み込めません。'); }
  if (input?.format !== FORMAT) throw new Error('Picture Talk PECS v2のバックアップを選んでください。');
  return validateState(input.data);
}
export function newTrial() { return { stage: 'choose', cardId: null }; }
export function transition(trial, action, cardId) {
  if (action === 'reset') return newTrial();
  if (action === 'select' && trial.stage === 'choose' && cardId) return { stage: 'selected', cardId };
  if (action === 'give' && trial.stage === 'selected') return { ...trial, stage: 'partner' };
  if (action === 'receive' && trial.stage === 'partner') return { ...trial, stage: 'received' };
  throw new Error('この操作は今はできません。');
}
export function csv(records) {
  const cell = v => {
    let s = String(v);
    if (/^[\s]*[=+@-]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  const names = { independent: '自分から', assisted: '支援あり', unrated: '未評価' };
  return '\uFEFF' + [['日時', '呼び名', 'Phase', 'カード', '支援'], ...records.map(r => [r.at, r.alias, r.phase, r.label, names[r.support]])].map(row => row.map(cell).join(',')).join('\r\n');
}
