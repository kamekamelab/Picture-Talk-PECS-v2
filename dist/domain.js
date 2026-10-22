import { cardLayout } from './cards.js';
import { sentenceWords } from './sentence.js';
export const FORMAT = 'picture-talk-pecs-v2';
export const SCHEMA = 4;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const safeImage = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
export function initialState() {
  return {
    schemaVersion: SCHEMA,
    profile: { alias: 'がくしゅうしゃ', cardId: 'juice', phase: 1, choiceIds: ['juice', 'ball'] },
    cards: [
      { id: 'juice', label: 'ジュース', category: 'のみもの', emoji: '🧃', image: null },
      { id: 'ball', label: 'ボール', category: 'あそび', emoji: '⚽', image: null },
      { id: 'bubbles', label: 'しゃぼんだま', category: 'あそび', emoji: '🫧', image: null },
      { id: 'music', label: 'おんがく', category: 'かつどう', emoji: '🎵', image: null }
    ].map(c => ({ ...c, layout: cardLayout() })),
    records: [],
    settings: { showLabel: true, pin: null, speech: { voiceURI: '', rate: 1, pauses: true, onSelect: false } },
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
  if (!input || ![1, 2, 3, SCHEMA].includes(input.schemaVersion)) throw new Error('対応していないデータ形式です。');
  if (!Array.isArray(input.cards) || input.cards.length < 1 || input.cards.length > 500) throw new Error('カードは1〜500枚にしてください。');
  const ids = new Set();
  const cards = input.cards.map(c => {
    if (!c || ids.has(id(c.id))) throw new Error('カードのIDが重複しています。');
    ids.add(c.id);
    if (c.image !== null && (typeof c.image !== 'string' || c.image.length > 2000000 || !safeImage.test(c.image))) throw new Error('カード画像の形式が正しくありません。');
    return { layout: cardLayout(c.layout), id: c.id, label: string(c.label, 40, 'カードの文字'), category: string(c.category, 30, 'カテゴリ'), emoji: string(c.emoji, 16, 'マーク', true), image: c.image };
  });
  if (!input.profile || !ids.has(input.profile.cardId)) throw new Error('学習用カードが見つかりません。');
  const phase = input.schemaVersion === 1 ? 1 : input.profile.phase;
  if (![1, 2, 3, 4].includes(phase)) throw new Error('対応していない学習段階です。');
  const choiceIds = input.profile.choiceIds ?? cards.slice(0, 2).map(c => c.id);
  if (!Array.isArray(choiceIds) || choiceIds.length > 500 || new Set(choiceIds).size !== choiceIds.length || choiceIds.some(value => !ids.has(value))) throw new Error('選択肢のカードが正しくありません。');
  if (phase === 3 && choiceIds.length < 2) throw new Error('Phase 3ではカードを2枚以上選んでください。');
  if (!Array.isArray(input.records) || input.records.length > 100000) throw new Error('記録の形式が正しくありません。');
  const recordIds = new Set();
  const records = input.records.map(r => {
    if (!r || recordIds.has(id(r.id)) || ![1, 2, 3, 4].includes(r.phase) || !['independent', 'assisted', 'unrated'].includes(r.support)) throw new Error('学習記録の形式が正しくありません。');
    recordIds.add(r.id);
    const record = { id: r.id, phase: r.phase, at: date(r.at), cardId: id(r.cardId), label: string(r.label, r.phase === 4 ? 180 : 40, '記録のカード名・文'), alias: string(r.alias, 40, '記録の呼び名'), support: r.support };
    if (r.kind !== undefined) {
      if (!['read', 'exchange'].includes(r.kind)) throw new Error('記録の種別が正しくありません。');
      record.kind = r.kind;
    }
    if (r.phase === 4) {
      if (!Array.isArray(r.sentence) || r.sentence.length < 2 || r.sentence.length > 5 || r.sentence.at(-1) !== 'ください' || r.sentence.slice(0, -1).some(word => word === 'ください')) throw new Error('「ください」は文の最後に置いてください。');
      record.sentence = r.sentence.map(word => string(word, 40, '文のことば'));
      if (record.label !== record.sentence.join(' ')) throw new Error('記録の文とカードの順序が一致しません。');
    }
    return record;
  });
  if (!input.settings || typeof input.settings.showLabel !== 'boolean') throw new Error('設定が正しくありません。');
  const pin = input.settings.pin;
  if (pin !== null && (!pin || !/^[a-f0-9]{32}$/.test(pin.salt) || !/^[a-f0-9]{64}$/.test(pin.hash))) throw new Error('PIN設定が正しくありません。');
  const speech = input.settings.speech === undefined ? { voiceURI: '', rate: 1, pauses: true, onSelect: false } : input.settings.speech;
  if (!speech || ![.85, 1, 1.1].includes(speech.rate)) throw new Error('読み上げ設定が正しくありません。');
  for (const key of ['pauses', 'onSelect']) if (speech[key] !== undefined && typeof speech[key] !== 'boolean') throw new Error('読み上げ設定が正しくありません。');
  const speechSettings = { pauses: speech.pauses ?? true, onSelect: speech.onSelect ?? false, voiceURI: string(speech.voiceURI, 500, '読み上げ音声', true), rate: speech.rate };
  const clean = {
    schemaVersion: SCHEMA,
    profile: { alias: string(input.profile.alias, 40, '呼び名'), cardId: input.profile.cardId, phase, choiceIds },
    cards, records,
    settings: { showLabel: input.settings.showLabel, pin: pin ? { salt: pin.salt, hash: pin.hash } : null, speech: speechSettings },
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
export function readingRecord(state, trial, { id, at }) {
  if (trial.stage !== 'selected') throw new Error('カードを選んでから読み上げてください。');
  const phase = state.profile.phase;
  const card = state.cards.find(c => c.id === (phase === 4 ? trial.cardIds.at(-1) : trial.cardId));
  if (!card) throw new Error('読み上げるカードが見つかりません。');
  if (phase === 4 && (!trial.ending || !trial.cardIds.length)) throw new Error('文を作ってから読み上げてください。');
  const words = phase === 4 ? sentenceWords(trial, state.cards) : [card.label];
  const record = { id, at, phase, kind: 'read', cardId: card.id, label: words.join(' '), alias: state.profile.alias, support: 'unrated' };
  if (phase === 4) record.sentence = words;
  return record;
}
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
  return '\uFEFF' + [['日時', '呼び名', 'Phase', '種別', 'カード・文', '支援'], ...records.map(r => [r.at, r.alias, r.phase, r.kind === 'read' ? '読み上げ' : '過去の交換', r.label, names[r.support]])].map(row => row.map(cell).join(',')).join('\r\n');
}
