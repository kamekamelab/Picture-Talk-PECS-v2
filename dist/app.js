import { newTrial, transition, backupText, parseBackup, csv, MAX_BACKUP_BYTES } from './domain.js';
import { openStorage, writeState } from './storage.js';
import { REQUEST, newSentenceTrial, sentenceWords, sentenceTransition } from './sentence.js';
import { createReader, localJapaneseVoice } from './speech.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const notice = document.querySelector('#notice');
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const dateLabel = value => value ? new Date(value).toLocaleString('ja-JP') : 'まだありません';
let state;
let screen = 'home';
let trial = newTrial();
let busy = false;
let draftImage = null;
let editedId = null;
let pendingRestore = null;
let onlineReady = false;
let noticeTimer;
let unlocked = false;
let imageBusy = false;
let editorToken = 0;
let pendingRecord = null;
const reader = createReader({
  synth: window.speechSynthesis,
  Utterance: window.SpeechSynthesisUtterance,
  onState: (reading, result) => {
    document.querySelectorAll('[data-action="speak"]').forEach(button => {
      button.setAttribute('aria-pressed', String(reading));
      button.setAttribute('aria-label', reading ? 'よみあげをとめる' : 'ぶんをよみあげる');
      button.querySelector('.speech-label').textContent = reading ? 'とめる' : 'よむ';
    });
    if (result === 'finished') toast('よみあげました。');
  },
  onError: message => toast(message)
});
function voiceStatus() {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return 'このブラウザーでは読み上げを利用できません。';
  return localJapaneseVoice(window.speechSynthesis.getVoices()) ? '端末内の日本語音声を使えます。生徒画面の「よむ」を押すと読み上げます。' : '端末内の日本語音声が見つかりません。端末に日本語音声を準備してから、もう一度開いてください。';
}
window.speechSynthesis?.addEventListener('voiceschanged', () => {
  const status = document.querySelector('#voice-status');
  if (status) status.textContent = voiceStatus();
});
// 音声一覧の準備のみ。利用者が「よむ」を押すまでは読み上げない。
window.speechSynthesis?.getVoices();
document.addEventListener('visibilitychange', () => { if (document.hidden) reader.stop(); });
window.addEventListener('pagehide', () => reader.stop());

function toast(text) {
  notice.textContent = text;
  if (dialog.open) {
    let message = dialog.querySelector('.dialog-notice');
    if (!message) { message = document.createElement('p'); message.className = 'dialog-notice'; message.setAttribute('role', 'alert'); dialog.append(message); }
    message.textContent = text;
  }
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.textContent = ''; }, 6500);
}
function image(card, large = false) {
  return card.image ? `<img class="card-image ${large ? 'large' : ''}" src="${esc(card.image)}" alt="">` : `<span class="card-emoji ${large ? 'large' : ''}" aria-hidden="true">${esc(card.emoji || '▧')}</span>`;
}
function tag() { return `<span class="status ${onlineReady ? 'ready' : ''}">${onlineReady ? '● オフライン準備済み' : '○ オフライン準備中'}</span>`; }
function header(student = false) {
  return `<header class="top"><a class="brand" href="#" data-action="${student ? 'teacher' : 'home'}"><img src="./icons/icon.svg" width="42" height="42" alt=""><span>Picture Talk<small>PECS v2${student ? '' : ' ・ 先生用'}</small></span></a>${student ? '<button class="quiet" data-action="teacher">先生用</button>' : tag()}</header>`;
}
function nav() {
  return `<nav class="nav" aria-label="先生用メニュー">${[['home','学習の準備'],['cards','カード'],['records','学習記録'],['backup','バックアップ'],['settings','設定']].map(([key,label]) => `<button class="${screen === key ? 'active' : ''}" data-screen="${key}" ${screen === key ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>`;
}
function render() {
  if (!state) return;
  if (screen === 'locked') {
    app.innerHTML = `<div class="shell">${header(true)}<main class="locked"><p class="eyebrow">先生用</p><h1>学習の準備をはじめましょう</h1><p class="muted">先生用PINで開いてください。</p><button class="primary" data-action="teacher">先生用画面を開く</button></main></div>`;
    return;
  }
  const student = screen === 'student';
  app.innerHTML = `<div class="shell ${student ? 'student-shell' : ''}">${header(student)}${student ? studentView() : `${nav()}<main id="main">${({ home: homeView, cards: cardsView, records: recordsView, backup: backupView, settings: settingsView })[screen]()}</main><footer>PTP · 開発版 0.3.0 <span>写真と学習記録は、この端末内に保存します。</span></footer>`}</div>`;
}
function homeView() {
  const card = state.cards.find(c => c.id === state.profile.cardId);
  return `<section class="intro"><div><p class="eyebrow">学習の準備</p><h1>カードで、つたえる。</h1><p class="muted">学習段階とカードを選んで、交換の学習をはじめましょう。</p></div><span class="phase-chip">Phase ${state.profile.phase}</span></section>
  <div class="home-grid"><section class="panel"><div class="section-heading"><h2>今日の学習</h2><span class="subtle">日本語でつたえる</span></div><form id="learning-form"><label>呼び名 <span class="subtle">本名の登録は不要です</span><input name="alias" maxlength="40" value="${esc(state.profile.alias)}" required autocomplete="off"></label><label>学習段階<select name="phase"><option value="1" ${state.profile.phase === 1 ? 'selected' : ''}>Phase 1：1枚を交換する</option><option value="4" ${state.profile.phase === 4 ? 'selected' : ''}>Phase 4：日本語の文をつくる</option></select></label><label>Phase 1で使うカード<select name="cardId">${state.cards.map(c => `<option value="${c.id}" ${c.id === card.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label><p class="hint">相手がカードを受け取り、欲しい物や活動につなげます。</p><button class="primary wide" type="submit">学習を はじめる <span aria-hidden="true">→</span></button></form></section>
  <section class="preview-panel"><p class="eyebrow">今選んでいるカード</p><div class="sample-card">${image(card, true)}<strong>${esc(card.label)}</strong></div><p class="muted">大きなカードで、ゆっくり交換。</p></section></div>
  <section class="roadmap-note"><span class="leaf" aria-hidden="true">↗</span><div><h2>まずは、1枚をわたすところから。</h2><p>Phase 1と、Phase 4の「ことば＋ください」を使えます。Phase 2・3は今後追加します。</p></div></section>`;
}
function cardsView() {
  return `<section class="intro"><div><p class="eyebrow">カードブック</p><h1>いつもの物を、カードに。</h1><p class="muted">写真・イラスト・文字を自由に組み合わせられます。</p></div><button class="primary" data-action="new-card">＋ カードをつくる</button></section><div class="card-grid">${state.cards.map(c => `<article class="editor-card"><div class="editor-visual">${image(c)}</div><div class="editor-meta"><span class="subtle">${esc(c.category)}</span><h2>${esc(c.label)}</h2><button class="secondary wide" data-edit="${c.id}">${esc(c.label)}を編集</button></div></article>`).join('')}</div>`;
}
function recordsView() {
  const today = new Date().toLocaleDateString('ja-JP');
  const records = state.records.filter(r => new Date(r.at).toLocaleDateString('ja-JP') === today);
  const names = { independent: '自分から', assisted: '支援あり', unrated: '未評価' };
  return `<section class="intro"><div><p class="eyebrow">学習記録</p><h1>伝わったことを、残す。</h1><p class="muted">受け取りを確認した交換を、1回ずつ保存しています。</p></div><button class="secondary" data-action="csv" ${state.records.length ? '' : 'disabled'}>CSVを書き出す</button></section><div class="stats">${[['今日の交換',records.length],['自分から',records.filter(r=>r.support==='independent').length],['支援あり',records.filter(r=>r.support==='assisted').length],['未評価',records.filter(r=>r.support==='unrated').length]].map(([label,n])=>`<div><span>${label}</span><strong>${n}<small> 回</small></strong></div>`).join('')}</div><section class="panel"><h2>これまでの記録 <span class="subtle">${state.records.length}件</span></h2>${state.records.length ? `<div class="table-wrap"><table><thead><tr><th>日時</th><th>呼び名</th><th>カード</th><th>Phase</th><th>様子（押すと変更）</th></tr></thead><tbody>${state.records.slice(-200).reverse().map(r=>`<tr><td>${dateLabel(r.at)}</td><td>${esc(r.alias)}</td><td>${esc(r.label)}</td><td>${r.phase}</td><td><button class="quiet" data-record-id="${r.id}">${names[r.support]}</button></td></tr>`).join('')}</tbody></table></div><p class="subtle">画面には直近200件を表示します。CSVとバックアップには全件を含みます。</p>` : '<div class="empty"><span aria-hidden="true">▤</span><p>記録はまだありません。</p><p class="muted">カードを交換すると、ここに残ります。</p></div>'}</section>`;
}
function backupView() {
  return `<section class="intro"><div><p class="eyebrow">バックアップ</p><h1>大切なカードを、手元に。</h1><p class="muted">写真・設定・記録をひとつのファイルにまとめます。</p></div></section><div class="home-grid"><section class="panel"><h2>バックアップを保存</h2><p>カード ${state.cards.length}枚 ／ 記録 ${state.records.length}件</p><p class="muted">最終書き出し：${dateLabel(state.lastBackupAt)}</p><button class="primary wide" data-action="backup">ファイルを保存する</button><p class="hint">書き出し後、iPadの「ファイル」で保存されたことを確認してください。</p></section><section class="panel"><h2>ファイルから復元</h2><p class="muted">v2で保存したバックアップを選びます。復元前に内容を確認できます。</p><label class="file-picker">バックアップを選ぶ<input id="restore-file" type="file" accept=".json,application/json"></label><p class="hint">復元すると現在のカード・設定・記録が置き換わります。先に現在のバックアップを保存してください。</p></section></div><aside class="info-note"><strong>端末内の保存と、バックアップは別です。</strong><p>ブラウザーデータの削除や端末の故障で、端末内データは失われることがあります。バックアップは暗号化されていません。学校の運用に沿った保存先で管理してください。</p></aside>`;
}
function settingsView() {
  return `<section class="intro"><div><p class="eyebrow">先生用設定</p><h1>使いやすさを、ひとりずつ。</h1><p class="muted">生徒画面に見せるものを調整します。</p></div></section><div class="home-grid"><section class="panel"><h2>カードの表示</h2><form id="display-form"><label class="check"><input type="checkbox" name="showLabel" ${state.settings.showLabel ? 'checked' : ''}> 生徒画面にカードの文字を表示する</label><button type="submit" class="secondary">表示設定を保存</button></form><p class="hint">「よむ」を押すと文を読み上げます。自動再生・効果音・点滅する演出はありません。</p></section><section class="panel"><h2>先生用画面への入口</h2><p class="muted">「先生用」を長押し${state.settings.pin ? 'し、PINを入力' : ''}すると戻れます。</p><form id="pin-form"><label>${state.settings.pin ? '新しいPIN（空欄で解除）' : 'PINを設定（任意）'}<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="new-password" placeholder="数字4〜8桁"></label><button class="secondary" type="submit">PIN設定を保存</button></form><p class="hint">PINは誤操作防止用です。データの暗号化ではありません。忘れた場合は、学習開始前のバックアップから復元してください。</p></section></div><section class="info-note"><h2>この端末での利用</h2><h3>読み上げ</h3><p id="voice-status">${esc(voiceStatus())}</p><p>読み上げには端末内の日本語音声だけを使います。端末に音声がない場合、クラウド音声への切り替えは行いません。</p><p id="offline-status">${onlineReady ? 'オフライン準備ができています。機内モードでの起動も確認してください。' : '初回の準備にはインターネット接続が必要です。'}</p><p>写真と記録の外部送信・自動同期は行いません。オンラインでの初回アクセスや更新時には、配信先との通信が発生します。</p><button class="secondary" data-action="persistent">端末内の保存を保護する</button><p class="hint">ブラウザーが対応している場合、保存データが自動削除されにくくなるよう要求します。バックアップは引き続き必要です。</p></section>`;
}
function sentenceStrip(editable = false) {
  const items = trial.cardIds.map((id, index) => {
    const card = state.cards.find(c => c.id === id);
    return `<div class="sentence-unit"><div class="word-card" role="img" aria-label="${esc(card.label)}">${image(card)}${state.settings.showLabel ? `<strong>${esc(card.label)}</strong>` : ''}</div>${editable ? `<div class="word-controls"><button class="quiet" data-sentence-action="left" data-card-id="${id}" aria-label="${esc(card.label)}を左へ" ${index === 0 ? 'disabled' : ''}>←</button><button class="quiet" data-sentence-action="remove" data-card-id="${id}" aria-label="${esc(card.label)}を外す">×</button><button class="quiet" data-sentence-action="right" data-card-id="${id}" aria-label="${esc(card.label)}を右へ" ${index === trial.cardIds.length - 1 ? 'disabled' : ''}>→</button></div>` : ''}</div>`;
  }).join('');
  const ending = trial.ending ? `<div class="sentence-unit ending"><div class="word-card"><span class="card-emoji" aria-hidden="true">🤲</span><strong>${REQUEST}</strong></div>${editable ? '<button class="quiet" data-sentence-action="ending" aria-label="くださいを外す">×</button>' : ''}</div>` : (editable ? '<div class="ending-placeholder">ください</div>' : '');
  return `<div class="sentence-strip" role="group" aria-label="ぶんのならび" dir="ltr"><div class="sentence-track">${items}${ending}${!items && !trial.ending ? '<p class="hint">カードを ならべよう</p>' : ''}</div></div>`;
}
function sentenceBoard(editable = false) {
  const complete = ['selected', 'partner'].includes(trial.stage);
  const hasCards = trial.cardIds.length > 0 || trial.ending;
  return `<div class="sentence-board">${sentenceStrip(editable)}<div class="strip-tools" role="group" aria-label="ぶんのそうさ"><button class="strip-tool speak-tool" data-action="speak" aria-label="ぶんをよみあげる" aria-pressed="false" ${complete ? '' : 'disabled'}><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 12h5l7-6v20l-7-6H5z"/><path d="M22 11q5 5 0 10M26 6q10 10 0 20"/></svg><span class="speech-label">よむ</span></button><button class="strip-tool clear-tool" data-action="reset" aria-label="ぶんをとりけす" ${hasCards ? '' : 'disabled'}><span class="cancel-symbol" aria-hidden="true">×</span><span>とりけす</span></button></div></div>`;
}
function sentenceView() {
  if (trial.stage === 'received') return `<main class="student success"><span class="success-mark" aria-hidden="true">✓</span><h1>つたわった！</h1><p>ぶんを わたせたね</p><button class="primary receive" data-action="reset">もういちど</button></main>`;
  if (trial.stage === 'partner') return `<main class="student sentence-partner"><p class="eyebrow">あいてに みせよう</p><h1>これを つたえたい</h1>${sentenceBoard()}<p class="sentence-text">${esc(sentenceWords(trial, state.cards).join(' '))}</p><button class="primary receive" data-action="receive">うけとった <span class="small">あいてのひとが おします</span></button><button class="text-button" data-action="reset">もどる</button></main>`;
  return `<main class="student sentence-student"><p class="eyebrow">ことばを ならべよう</p><h1>ぶんを つくろう</h1><section class="sentence-book" aria-label="カードブック">${state.cards.filter(c => c.label.trim() !== REQUEST).map(c => `<button class="word-card" data-sentence-action="select" data-card-id="${c.id}" aria-label="${esc(c.label)}を文に入れる" ${trial.cardIds.includes(c.id) || trial.cardIds.length >= 4 ? 'disabled' : ''}>${image(c)}${state.settings.showLabel ? `<strong>${esc(c.label)}</strong>` : ''}</button>`).join('')}<button class="word-card request-choice" data-sentence-action="ending" aria-pressed="${trial.ending}"><span class="card-emoji" aria-hidden="true">🤲</span><strong>${REQUEST}</strong></button></section><section class="sentence-area" aria-label="ぶんをつくるところ"><h2>ぶん</h2>${sentenceBoard(true)}</section><button class="primary give-button" data-action="give" ${trial.stage !== 'selected' ? 'disabled' : ''}>ぶんを わたす</button></main>`;
}
function studentView() {
  if (state.profile.phase === 4) return sentenceView();
  const card = state.cards.find(c => c.id === (trial.cardId || state.profile.cardId));
  if (trial.stage === 'partner') return `<main class="student partner"><p class="eyebrow">あいてに みせよう</p><h1>これを ください</h1><div class="student-card static-card" aria-label="${esc(card.label)}">${image(card, true)}${state.settings.showLabel ? `<strong>${esc(card.label)}</strong>` : ''}</div><button class="primary receive" data-action="receive">うけとった <span class="small">あいてのひとが おします</span></button><button class="text-button" data-action="reset">もどる</button></main>`;
  if (trial.stage === 'received') return `<main class="student success"><span class="success-mark" aria-hidden="true">✓</span><h1>つたわった！</h1><p>あいてに わたせたね</p><button class="primary receive" data-action="reset">もういちど</button></main>`;
  return `<main class="student"><p class="eyebrow">カードで つたえよう</p><h1>${trial.stage === 'choose' ? 'カードを とろう' : 'あいてに わたそう'}</h1><div class="exchange-layout"><section class="book-space" aria-label="カードブック"><span class="space-label">カード</span>${trial.stage === 'choose' ? `<button class="student-card" data-action="select" aria-label="${esc(card.label)}のカードをとる">${image(card, true)}${state.settings.showLabel ? `<strong>${esc(card.label)}</strong>` : ''}</button>` : '<div class="card-placeholder" aria-hidden="true"></div>'}</section><span class="exchange-arrow" aria-hidden="true">→</span><section class="give-space" aria-label="わたすところ"><span class="space-label">わたすところ</span>${trial.stage === 'selected' ? `<div class="student-card selected static-card">${image(card, true)}${state.settings.showLabel ? `<strong>${esc(card.label)}</strong>` : ''}</div>` : '<div class="card-placeholder"><span aria-hidden="true">＋</span></div>'}</section></div><button class="primary give-button" data-action="give" ${trial.stage !== 'selected' ? 'disabled' : ''}>わたす</button>${trial.stage === 'selected' ? '<button class="text-button" data-action="reset">カードを もどす</button>' : ''}</main>`;
}
async function persist(next) {
  const clean = await writeState(next);
  state = clean;
}
async function run(task) {
  if (busy) return;
  busy = true;
  app.inert = true;
  try { await task(); }
  catch (error) { toast(`保存・操作ができませんでした。${error.name === 'QuotaExceededError' ? '保存容量が不足しています。バックアップしてからカードを整理してください。' : error.message || 'もう一度お試しください。'}`); }
  finally { busy = false; app.inert = false; }
}
function modal(title, content) {
  dialog.innerHTML = `<div class="modal-head"><h2 id="dialog-title">${title}</h2><button class="quiet" data-action="close-dialog" aria-label="閉じる">×</button></div>${content}`;
  if (!dialog.open) dialog.showModal();
}
function closeDialog() { if (imageBusy) return toast('画像の準備を待ってください。'); dialog.close(); pendingRestore = null; editorToken++; }
function cardEditor(id = null) {
  editedId = id;
  const card = id ? state.cards.find(c => c.id === id) : { label: '', emoji: '▧', category: 'そのほか', image: null };
  draftImage = card.image;
  editorToken++;
  modal(id ? 'カードを編集' : 'カードをつくる', `<form id="card-form"><div id="image-preview" class="image-preview">${image(card)}</div><label class="file-picker">写真・イラストを選ぶ<input id="card-image" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label><button type="button" class="text-button" data-action="remove-image">画像を外す</button><p class="hint">写真は端末内で縮小し、位置情報などを除去します。JPEG・PNG・WebP・GIF、15MBまで。</p><label>カードに表示する文字<input name="label" maxlength="40" required value="${esc(card.label)}" autocomplete="off"></label><label>カテゴリ<input name="category" maxlength="30" required value="${esc(card.category)}" autocomplete="off"></label><label>画像がないときのマーク<input name="emoji" maxlength="16" value="${esc(card.emoji)}" autocomplete="off"></label><div class="modal-actions">${id ? `<button type="button" class="danger" data-action="delete-card" ${state.cards.length === 1 ? 'disabled' : ''}>削除</button>` : ''}<button type="submit" class="primary">カードを保存</button></div></form>`);
}
async function resizeImage(file) {
  if (file.size > 15 * 1024 * 1024 || !['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) throw new Error('15MB以下のJPEG・PNG・WebP・GIFを選んでください。');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 80000000) throw new Error('画像が大きすぎます。小さくして選び直してください。');
    const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    if (png.length <= 2000000) return png;
    const jpgCanvas = document.createElement('canvas');
    jpgCanvas.width = canvas.width; jpgCanvas.height = canvas.height;
    const jpg = jpgCanvas.getContext('2d'); jpg.fillStyle = '#fff';
    jpg.fillRect(0, 0, canvas.width, canvas.height); jpg.drawImage(canvas, 0, 0);
    return jpgCanvas.toDataURL('image/jpeg', .82);
  } finally { bitmap.close(); }
}
function download(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function pinHash(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const result = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 150000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(result)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function teacherGate() {
  if (trial.stage === 'received' && !pendingRecord) return enterTeacher();
  modal('先生用画面へ', '<p>先生が操作してください。</p><button class="primary wide" id="hold-teacher">ここを 1.5秒 長押し</button><p class="hint">キーボードではスペースキーを長押ししてください。</p>');
  const hold = dialog.querySelector('#hold-teacher');
  let timer;
  const cancel = () => { clearTimeout(timer); hold.classList.remove('holding'); };
  const start = () => { cancel(); hold.classList.add('holding'); timer = setTimeout(() => { cancel(); enterTeacher(); }, 1500); };
  hold.onpointerdown = event => { event.preventDefault(); hold.setPointerCapture(event.pointerId); start(); };
  hold.onpointerup = hold.onpointercancel = hold.onlostpointercapture = cancel;
  hold.onkeydown = event => { if (event.key === ' ' && !event.repeat) { event.preventDefault(); start(); } };
  hold.onkeyup = cancel; hold.onblur = cancel;
  dialog.addEventListener('close', cancel, { once: true });
}
function enterTeacher() {
  if (state.settings.pin && !unlocked) {
    modal('先生用PIN', '<form id="unlock-form"><label>PINを入力<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" required autofocus autocomplete="off"></label><button class="primary wide">先生用画面を開く</button><p id="pin-error" role="alert"></p></form>');
  } else { screen = 'home'; closeDialog(); render(); }
}
function recordDialog() {
  modal('先生用：今回の様子', '<p>欲しい物や活動につなげてから、様子を記録してください。</p><div class="record-choices"><button class="primary" data-support="independent">自分から</button><button class="secondary" data-support="assisted">支援あり</button><button class="quiet" data-support="unrated">あとで評価する</button></div>');
  dialog.querySelector('[data-action="close-dialog"]').hidden = true;
}

document.addEventListener('click', event => {
  const button = event.target.closest('button, a[data-action]');
  if (!button || busy) return;
  if (button.dataset.action !== 'speak') reader.stop();
  if (button.tagName === 'A') event.preventDefault();
  if (button.dataset.sentenceAction) {
    try { trial = sentenceTransition(trial, button.dataset.sentenceAction, button.dataset.cardId, state.cards); render(); } catch (error) { toast(error.message); }
    return;
  }
  if (button.dataset.recordId) {
    pendingRecord = state.records.find(r => r.id === button.dataset.recordId);
    if (pendingRecord) recordDialog();
    return;
  }
  if (button.dataset.screen) { screen = button.dataset.screen; render(); return; }
  if (button.dataset.edit) { cardEditor(button.dataset.edit); return; }
  if (button.dataset.support) {
    if (!pendingRecord) return;
    return run(async () => {
      const record = { ...pendingRecord, support: button.dataset.support };
      const next = structuredClone(state);
      const index = next.records.findIndex(r => r.id === record.id);
      if (index < 0) throw new Error('記録が見つかりません。');
      next.records[index] = record;
      await persist(next);
      pendingRecord = null;
      dialog.close(); render();
    });
  }
  const action = button.dataset.action;
  if (!action) return;
  if (action === 'speak') {
    if (reader.reading) { reader.stop(); return; }
    try {
      if (state.profile.phase !== 4 || !['selected', 'partner'].includes(trial.stage)) throw new Error('ぶんを つくってから よもう。');
      reader.read(sentenceWords(trial, state.cards));
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'close-dialog') return closeDialog();
  if (action === 'teacher') return teacherGate();
  if (action === 'home') { screen = 'home'; render(); return; }
  if (action === 'new-card') return cardEditor();
  if (action === 'select' || action === 'give' || action === 'reset') {
    if (pendingRecord) return recordDialog();
    try { trial = state.profile.phase === 4 ? sentenceTransition(trial, action, null, state.cards) : transition(trial, action, state.profile.cardId); render(); } catch (error) { toast(error.message); } return;
  }
  if (action === 'remove-image') { if (imageBusy) return; draftImage = null; dialog.querySelector('#image-preview').innerHTML = '<span class="card-emoji">▧</span>'; return; }
  run(async () => {
    if (action === 'receive') {
      const sentenceMode = state.profile.phase === 4;
      const nextTrial = sentenceMode ? sentenceTransition(trial, 'receive', null, state.cards) : transition(trial, 'receive');
      const card = state.cards.find(c=>c.id===(sentenceMode ? trial.cardIds.at(-1) : trial.cardId));
      const sentence = sentenceMode ? sentenceWords(trial, state.cards) : null;
      const record = { id: uid(), phase: state.profile.phase, at: now(), cardId: card.id, label: sentence ? sentence.join(' ') : card.label, alias: state.profile.alias, support: 'unrated' };
      if (sentence) record.sentence = sentence;
      const next = structuredClone(state); next.records.push(record);
      await persist(next);
      trial = nextTrial; pendingRecord = record;
      render(); recordDialog();
    } else if (action === 'delete-card') {
      if (imageBusy || state.cards.length === 1) return;
      const card = state.cards.find(c => c.id === editedId);
      modal('カードの削除を確認', `<p>「${esc(card.label)}」を削除します。過去の学習記録は残ります。</p><p class="hint">必要な画像は、先にバックアップに保存してください。</p><button class="danger wide" data-action="delete-card-confirm">このカードを削除する</button>`);
    } else if (action === 'delete-card-confirm') {
      if (state.cards.length === 1) return;
      const next = structuredClone(state);
      next.cards = next.cards.filter(c=>c.id!==editedId);
      if (next.profile.cardId === editedId) next.profile.cardId = next.cards[0].id;
      await persist(next); closeDialog(); render(); toast('カードを削除しました。');
    } else if (action === 'backup') {
      const next = structuredClone(state); next.lastBackupAt = now();
      const text = backupText(next);
      if (new Blob([text]).size > MAX_BACKUP_BYTES) throw new Error('バックアップが25MBを超えています。画像を整理してください。');
      download(`picture-talk-${now().slice(0,10)}.backup.json`, text, 'application/json');
      await persist(next); render(); toast('書き出しました。「ファイル」で保存を確認してください。');
    } else if (action === 'restore-confirm') {
      if (!pendingRestore) return;
      await persist(pendingRestore); trial = newTrial(); pendingRecord = null; unlocked = false;
      screen = state.settings.pin ? 'locked' : 'backup';
      closeDialog(); render(); toast('バックアップを復元しました。');
    } else if (action === 'csv') {
      download(`picture-talk-records-${now().slice(0,10)}.csv`, csv(state.records), 'text/csv;charset=utf-8');
    } else if (action === 'persistent') {
      const granted = await navigator.storage?.persist?.();
      toast(granted ? '保存の保護が有効になっています。' : 'このブラウザーでは保存保護を有効にできませんでした。バックアップを保存してください。');
    }
  });
});
document.addEventListener('submit', event => {
  event.preventDefault();
  if (busy || imageBusy) return toast('処理が終わるまでお待ちください。');
  const form = event.target;
  const fields = new FormData(form);
  run(async () => {
    const next = structuredClone(state);
    if (form.id === 'learning-form') {
      next.profile = { alias: String(fields.get('alias')).trim(), cardId: fields.get('cardId'), phase: Number(fields.get('phase')) };
      await persist(next); unlocked = false; screen = 'student'; trial = state.profile.phase === 4 ? newSentenceTrial() : newTrial(); render();
    } else if (form.id === 'card-form') {
      const card = { id: editedId || uid(), label: String(fields.get('label')).trim(), category: String(fields.get('category')).trim(), emoji: String(fields.get('emoji')).trim(), image: draftImage };
      if (editedId) next.cards[next.cards.findIndex(c=>c.id===editedId)] = card; else next.cards.push(card);
      await persist(next); closeDialog(); render(); toast('カードを保存しました。');
    } else if (form.id === 'display-form') {
      next.settings.showLabel = fields.has('showLabel'); await persist(next); render(); toast('表示設定を保存しました。');
    } else if (form.id === 'pin-form') {
      const pin = String(fields.get('pin'));
      if (pin && !/^\d{4,8}$/.test(pin)) throw new Error('PINは数字4〜8桁にしてください。');
      const salt = [...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
      next.settings.pin = pin ? { salt, hash: await pinHash(pin, salt) } : null;
      await persist(next); render(); toast('PIN設定を保存しました。');
    } else if (form.id === 'unlock-form') {
      if (await pinHash(String(fields.get('pin')), state.settings.pin.salt) !== state.settings.pin.hash) {
        dialog.querySelector('#pin-error').textContent = 'PINが違います。'; return;
      }
      unlocked = true; enterTeacher();
    }
  });
});
document.addEventListener('change', async event => {
  const input = event.target;
  if (input.name === 'cardId' && screen === 'home') {
    const card = state.cards.find(c => c.id === input.value);
    if (card) document.querySelector('.sample-card').innerHTML = `${image(card, true)}<strong>${esc(card.label)}</strong>`;
  } else if (input.id === 'card-image') {
    const file = input.files?.[0]; if (!file) return;
    imageBusy = true;
    const token = editorToken;
    const submit = dialog.querySelector('[type="submit"]'); submit.disabled = true;
    try { const data = await resizeImage(file); if (token === editorToken) { draftImage = data; dialog.querySelector('#image-preview').innerHTML = `<img src="${data}" class="card-image" alt="選択した画像">`; } }
    catch(error) { toast(error.message || '画像を読み込めませんでした。'); }
    finally { imageBusy = false; submit.disabled = false; input.value = ''; }
  } else if (input.id === 'restore-file') {
    const file = input.files?.[0]; if (!file) return;
    await run(async () => {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('25MB以下のファイルを選んでください。');
      pendingRestore = parseBackup(await file.text());
      modal('復元する内容を確認', `<p>カード：${pendingRestore.cards.length}枚</p><p>記録：${pendingRestore.records.length}件</p><p>呼び名：${esc(pendingRestore.profile.alias)}</p><p class="hint">現在のカード・設定・記録を置き換えます。PIN設定も復元されます。</p><button class="primary wide" data-action="restore-confirm">現在のデータを置き換えて復元する</button>`);
    });
    input.value = '';
  }
});
dialog.addEventListener('cancel', event => {
  if (busy || imageBusy || pendingRecord) { event.preventDefault(); if (pendingRecord) toast('今回の様子を選んでください。未評価でも保存できます。'); }
});

async function prepareOffline() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
    onlineReady = true;
    // 入力中のフォームを再描画しない。
    const status = app.querySelector('.status'); if (status) { status.textContent = '● オフライン準備済み'; status.classList.add('ready'); }
    const text = document.querySelector('#offline-status'); if (text) text.textContent = 'オフライン準備ができています。機内モードでの起動も確認してください。';
  } catch { toast('オフライン準備ができませんでした。オンラインで開き直してください。'); }
}
async function start() {
  try { state = await openStorage(); if (state.settings.pin) screen = 'locked'; render(); prepareOffline(); }
  catch {
    app.innerHTML = `<main class="loading"><h1>保存領域を開けませんでした</h1><p>データは上書きしていません。通常のブラウザーで開き直してください。</p><p>保存済みデータの形式が違う場合は、ブラウザーデータを削除せず開発担当へ相談してください。</p><button class="secondary" id="retry">もう一度開く</button></main>`;
    document.querySelector('#retry').onclick = () => location.reload();
  }
}
// 同じデータを複数タブで上書きしない。ロックはタブ終了時にブラウザーが解放する。
if (navigator.locks) {
  navigator.locks.request('ptp-v2-editor', { ifAvailable: true }, async lock => {
    if (!lock) {
      app.innerHTML = '<main class="loading"><h1>別の画面で開いています</h1><p>先に開いたPicture Talkを閉じてから、この画面を開き直してください。</p><button id="retry" class="secondary">開き直す</button></main>';
      document.querySelector('#retry').onclick = () => location.reload(); return;
    }
    await start(); await new Promise(() => {});
  });
} else {
  app.innerHTML = '<main class="loading"><h1>このブラウザーでは利用できません</h1><p>新しいSafariまたはChromeで開いてください。複数画面からのデータ上書きを防ぐ機能が必要です。</p></main>';
}
