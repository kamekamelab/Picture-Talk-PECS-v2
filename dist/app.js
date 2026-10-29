import { tokenStage, tokenTransition } from './tokens.js';
import { moveBookCard, resizeBook, paginateBook } from './book.js';
import { cardLayout, printPages } from './cards.js';
import { newTrial, transition, backupText, parseBackup, csv, readingRecord, MAX_BACKUP_BYTES } from './domain.js';
import { openStorage, writeState } from './storage.js';
import { COMMENTS, commentEndings, endingWord, REQUEST, newSentenceTrial, sentenceWords, sentenceTransition } from './sentence.js';
import { createReader, localJapaneseVoice, localJapaneseVoices } from './speech.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const notice = document.querySelector('#notice');
const fullscreenExit = document.querySelector('#fullscreen-exit');
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const dateLabel = value => value ? new Date(value).toLocaleString('ja-JP') : 'まだありません';
let state;
let screen = 'student';
let trial = newTrial();
let busy = false;
let draftImage = null;
let editedId = null;
let pendingRestore = null;
let onlineReady = false;
let offlineState = 'checking';
let offlineChecking = false;
let noticeTimer;
let unlocked = false;
let imageBusy = false;
let editorToken = 0;
let pendingRecord = null;
let pendingReading = null;
let printSelection = null;
let printSize = 35;
let dailyCategory = null;
let cardPage = 0;
let categoryPage = 0;
let predicateOpen = false;
let bookEditing = false;
let pickedCard = null;
let pointerDrag = null;
let suppressClickUntil = 0;
const reader = createReader({
  synth: window.speechSynthesis,
  Utterance: window.SpeechSynthesisUtterance,
  onState: (reading, result) => {
    if (reading) { clearTimeout(noticeTimer); notice.textContent = ''; }
    const manualReading = reading && Boolean(pendingReading);
    document.querySelectorAll('[data-action="speak"]').forEach(button => {
      button.setAttribute('aria-pressed', String(manualReading));
      button.setAttribute('aria-label', manualReading ? 'よみあげをとめる' : `${button.dataset.speechSubject || 'ぶん'}をよみあげる`);
      button.querySelector('.speech-label').textContent = manualReading ? 'とめる' : 'よむ';
    });
    if (result === 'finished') {
      const record = pendingReading; pendingReading = null;
      if (record) run(async () => {
        const next = structuredClone(state); next.records.push({ ...record, at: now() });
        await persist(next); toast('よみあげました。');
      });
      else toast('よみあげました。');
    }
  },
  onError: message => { pendingReading = null; toast(message); }
});
function voiceStatus() {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return 'このブラウザーでは読み上げを利用できません。';
  return localJapaneseVoice(window.speechSynthesis.getVoices()) ? '端末内の日本語音声を使えます。生徒画面の「よむ」を押すと読み上げます。' : '端末内の日本語音声が見つかりません。端末に日本語音声を準備してから、もう一度開いてください。';
}
window.speechSynthesis?.addEventListener('voiceschanged', () => {
  const status = document.querySelector('#voice-status');
  if (status) status.textContent = voiceStatus();
  const select = document.querySelector('#voice-select');
  if (select) { const selected = select.value; select.innerHTML = voiceOptions(selected); }
});
// 音声一覧の準備のみ。利用者が「よむ」を押すまでは読み上げない。
window.speechSynthesis?.getVoices();
document.addEventListener('visibilitychange', () => { if (document.hidden) { pendingReading = null; reader.stop(); } });
window.addEventListener('pagehide', () => { pendingReading = null; reader.stop(); });
function voiceOptions(selected = state.settings.speech.voiceURI) {
  const voices = localJapaneseVoices(window.speechSynthesis?.getVoices() || []);
  return '<option value="">端末の標準音声</option>' + voices.map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === selected ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
}
function speechSettingsForm() {
  return `<form id="speech-form"><label>声の種類<select id="voice-select" name="voiceURI">${voiceOptions()}</select></label><label>話す速さ<select name="rate">${[[.85, 'ゆっくり'], [1, 'ふつう（おすすめ）'], [1.1, '少し速く']].map(([value, text]) => `<option value="${value}" ${state.settings.speech.rate === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label><label class="check"><input type="checkbox" name="pauses" ${state.settings.speech.pauses ? 'checked' : ''}>ことばの間を少しあける</label><label class="check"><input type="checkbox" name="onSelect" ${state.settings.speech.onSelect ? 'checked' : ''}>カードを選んだら、すぐに名前を読む</label><div class="speech-setting-actions"><button type="button" class="secondary" data-action="preview-speech">ためしにきく</button><button type="button" class="quiet" data-action="stop-speech">とめる</button><button type="submit" class="primary">声の設定を保存</button></div><p class="hint">「間をあける」をオンにすると「ボール、ください」と読みます。選択時の名称読み上げと試聴は、学習記録の回数に含めません。選べる声や抑揚は端末によって異なります。</p></form>`;
}

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
  return card.image ? `<img draggable="false" class="card-image ${large ? 'large' : ''}" src="${esc(card.image)}" alt="">` : `<span class="card-emoji ${large ? 'large' : ''}" aria-hidden="true">${esc(card.emoji || '▧')}</span>`;
}
function face(card, showLabel = true) {
  const layout = cardLayout(card.layout);
  return `<span class="card-face text-${layout.textSize} label-${layout.position}">${image(card)}${showLabel ? `<strong>${esc(card.label)}</strong>` : ''}</span>`;
}
function saySelection(label) {
  if (!state.settings.speech.onSelect) return;
  pendingReading = null;
  try { reader.read([label], state.settings.speech); }
  catch (error) { toast(error.message); }
}
function offlineLabel() {
  if (onlineReady) return navigator.onLine === false ? '● オフラインで利用中' : '● オフライン準備済み';
  return offlineState === 'checking' ? '○ オフライン準備中' : '○ オフライン準備を確認';
}
function offlineDescription() {
  if (onlineReady) return 'この端末へのアプリの保存を確認しました。Wi-Fiを切っても、カード・文づくり・編集・記録を使えます。読み上げには端末内の日本語音声が必要です。';
  if (offlineState === 'unsupported') return 'このブラウザーではオフライン保存を利用できません。iPadではSafariで開いてください。';
  if (offlineState === 'checking') return 'オフライン用のファイルを確認しています。初回はインターネットにつないだままお待ちください。';
  return 'オフライン用の保存を確認できませんでした。インターネットにつなぎ、下のボタンでもう一度確認してください。更新した直後は、このアプリの画面をすべて閉じて開き直してください。';
}
function tag() { return `<span class="status ${onlineReady ? 'ready' : ''}" data-offline-status role="status">${offlineLabel()}</span>`; }
function offlinePanel() {
  return `<section class="info-note"><h2>オフラインで使う</h2><p id="offline-status">${offlineDescription()}</p><button class="secondary" data-action="offline-retry" ${offlineChecking ? 'disabled' : ''}>オフラインの準備を確認</button><p class="hint">iPadではSafariの共有メニューから「ホーム画面に追加」し、追加したアイコンをオンラインで一度開いてください。「オフライン準備済み」を確認したら、機内モードでも開けるか試してください。</p><p class="hint">写真・記録は端末内に保存されます。ブラウザーの保存データを削除すると使えなくなるため、バックアップも保存してください。</p></section>`;
}
function syncOfflineStatus() {
  document.querySelectorAll('[data-offline-status]').forEach(element => { element.textContent = offlineLabel(); element.classList.toggle('ready', onlineReady); });
  const text = document.querySelector('#offline-status'); if (text) text.textContent = offlineDescription();
  document.querySelectorAll('[data-action="offline-retry"]').forEach(button => { button.disabled = offlineChecking; });
}
window.addEventListener('online', () => { syncOfflineStatus(); prepareOffline(); });
window.addEventListener('offline', syncOfflineStatus);
let fullscreenPending = false;
function fullscreenActive() { return Boolean(document.fullscreenElement || document.webkitFullscreenElement); }
function fullscreenButton() {
  return `<button class="quiet fullscreen-toggle" data-action="fullscreen" aria-label="全画面表示にする" title="全画面表示にする" ${fullscreenPending ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/></svg></button>`;
}
function syncFullscreenButton() {
  const active = fullscreenActive();
  document.body.classList.toggle('fullscreen', active);
  // Keep the escape control usable when a modal makes the rest of the page inert.
  const host = dialog.open ? dialog : document.body;
  if (fullscreenExit.parentElement !== host) host.append(fullscreenExit);
  fullscreenExit.hidden = !active;
  fullscreenExit.disabled = fullscreenPending;
  const button = app.querySelector('[data-action="fullscreen"]');
  if (button) button.disabled = fullscreenPending;
}
dialog.addEventListener('close', syncFullscreenButton);
function fullscreenHelp(failed = false) {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  modal('全画面表示', `<p>${standalone ? 'ホーム画面から開いているため、すでにブラウザーのアドレスバーがない表示です。' : failed ? 'この環境では全画面に切り替えられませんでした。' : 'このブラウザーは全画面への切り替えに対応していません。'}</p><p>iPadではSafariの共有メニューから「ホーム画面に追加」し、追加したアイコンから開くと、アドレスバーなしで使えます。</p><p class="hint">カードや文はそのままです。</p>`);
}
async function toggleFullscreen(exitOnly = false) {
  if (fullscreenPending) return;
  const root = document.documentElement;
  const active = fullscreenActive();
  if (exitOnly && !active) return;
  const method = active ? (document.exitFullscreen || document.webkitExitFullscreen) : (root.requestFullscreen || root.webkitRequestFullscreen);
  if (!method || (!active && (root.requestFullscreen ? document.fullscreenEnabled === false : document.webkitFullscreenEnabled === false))) { fullscreenHelp(); return; }
  fullscreenPending = true; syncFullscreenButton();
  try {
    // Request directly from the tap so Safari retains user activation.
    if (!active && root.requestFullscreen) await method.call(root, { navigationUI: 'hide' });
    else await method.call(active ? document : root);
  } catch { fullscreenHelp(true); }
  finally { fullscreenPending = false; syncFullscreenButton(); }
}
// Also follow exits made with Escape or the browser's own controls.
document.addEventListener('fullscreenchange', syncFullscreenButton);
document.addEventListener('webkitfullscreenchange', syncFullscreenButton);
function header(student = false) {
  return `<header class="top"><a class="brand" href="#" data-action="${student ? 'teacher' : 'home'}"><img src="./icons/icon.svg" width="42" height="42" alt=""><span>Picture Talk<small>PECS v2${student ? '' : ' ・ 先生用'}</small></span></a><div class="header-actions">${fullscreenButton()}${student ? '<button class="quiet" data-action="teacher">設定</button>' : tag()}</div></header>`;
}
function nav() {
  return `<nav class="nav" aria-label="先生用メニュー"><button data-action="start-daily">ふだん使いへ</button>${[['cards','カード'],['print','印刷'],['records','学習記録'],['backup','バックアップ'],['tokens','トークン'],['settings','設定']].map(([key,label]) => `<button class="${screen === key ? 'active' : ''}" data-screen="${key}" ${screen === key ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>`;
}
function render() {
  if (!state) return;
  document.body.classList.toggle('student-mode', ['student','token'].includes(screen));
  if (screen === 'locked') {
    app.innerHTML = `<div class="shell">${header(true)}<main class="locked"><p class="eyebrow">先生用</p><h1>学習の準備をはじめましょう</h1><p class="muted">先生用PINで開いてください。</p><button class="primary" data-action="teacher">先生用画面を開く</button></main></div>`;
    syncFullscreenButton();
    return;
  }
  const student = ['student','token'].includes(screen);
  app.innerHTML = `<div class="shell ${student ? 'student-shell' : ''} ${screen === 'student' && compactTokensVisible() ? 'with-compact-tokens' : ''}">${student ? studentControls() : header(false)}${student ? (screen === 'token' ? tokenView() : studentView()) : `${nav()}<main id="main">${({ cards: cardsView, print: printView, records: recordsView, backup: backupView, settings: settingsView, tokens: tokenSettingsView })[screen]()}</main><footer>PTP · 開発版 0.13.1 <span>写真と学習記録は、この端末内に保存します。</span></footer>`}</div>`;
  syncFullscreenButton();
}
function isDaily() { return state.profile.mode === 'daily'; }
function usesSentence() { return isDaily() || state.profile.phase >= 4; }
function phaseSettings() {
  return `<details class="phase-settings panel"><summary>フェイズ別の練習（1〜6）</summary><p class="hint">普段はカードブックを使い、段階に合わせた練習をするときだけ選びます。アプリを開き直すと、ふだん使いに戻ります。</p><form id="learning-form"><label>呼び名 <span class="subtle">本名の登録は不要です</span><input name="alias" maxlength="40" value="${esc(state.profile.alias)}" required autocomplete="off"></label><label>学習段階<select name="phase"><option value="1" ${state.profile.phase === 1 ? 'selected' : ''}>Phase 1：1枚でつたえる</option><option value="2" ${state.profile.phase === 2 ? 'selected' : ''}>Phase 2：自分からつたえる</option><option value="3" ${state.profile.phase === 3 ? 'selected' : ''}>Phase 3：複数からえらぶ</option><option value="4" ${state.profile.phase === 4 ? 'selected' : ''}>Phase 4：文と属性語でつたえる</option><option value="5" ${state.profile.phase === 5 ? 'selected' : ''}>Phase 5：質問に答えて要求する</option><option value="6" ${state.profile.phase === 6 ? 'selected' : ''}>Phase 6：コメントする</option></select></label><label>Phase 1・2で使うカード<select name="cardId">${state.cards.map(c => `<option value="${c.id}" ${c.id === state.profile.cardId ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label><fieldset class="choice-settings"><legend>Phase 3で並べるカード（2枚以上）</legend>${state.cards.map(c => `<label class="check"><input type="checkbox" name="choiceIds" value="${c.id}" ${state.profile.choiceIds.includes(c.id) ? 'checked' : ''}>${esc(c.label)}</label>`).join('')}</fieldset><label>Phase 6の学習方法<select name="commentMode">${[['spontaneous','自分からコメント（質問なし）'],['see','質問に答える：なにがみえますか？'],['hear','質問に答える：なにがきこえますか？'],['have','質問に答える：なにをもっていますか？']].map(([v,l]) => `<option value="${v}" ${state.profile.commentMode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><p class="hint">Phase 5では先生が「なにがほしいですか？」と問いかけます。Phase 6では質問への応答と、質問なしのコメントを切り替えられます。</p><p class="hint">Phase 2では1枚のカードを使います。端末や相手との距離、場所を先生が調整してください。Phase 3では選んだカードだけを並べます。大きい・小さいなどを文に加えるのは、Phase 4に続く属性語と言語の拡張です。読み上げ回数は、各段階の達成を示すものではありません。</p><button type="button" class="secondary wide" data-action="add-size-cards">大きい・小さいのカードを追加</button><button class="primary wide" type="submit">このフェイズで 練習する <span aria-hidden="true">→</span></button></form></details>`;
}
function cardsView() {
  return `<section class="intro"><div><p class="eyebrow">カードブック</p><h1>いつもの物を、カードに。</h1><p class="muted">写真・イラスト・文字を自由に組み合わせられます。</p></div><button class="primary" data-action="new-card">＋ カードをつくる</button></section><div class="card-grid">${state.cards.map(c => `<article class="editor-card"><div class="editor-visual">${face(c)}</div><div class="editor-meta"><span class="subtle">${esc(c.category)}</span><h2>${esc(c.label)}</h2><button class="secondary wide" data-edit="${c.id}">${esc(c.label)}を編集</button></div></article>`).join('')}</div>`;
}
function recordsView() {
  const today = new Date().toLocaleDateString('ja-JP');
  const records = state.records.filter(r => r.kind === 'read' && new Date(r.at).toLocaleDateString('ja-JP') === today);
  const names = { independent: '自分から', assisted: '支援あり', unrated: '未評価' };
  return `<section class="intro"><div><p class="eyebrow">学習記録</p><h1>つたえる学習を、残す。</h1><p class="muted">最後まで読み上げた回数を保存します。過去の交換記録とは区別しています。</p></div><button class="secondary" data-action="csv" ${state.records.length ? '' : 'disabled'}>CSVを書き出す</button></section><div class="stats">${[['今日の読み上げ',records.length],['自分から',records.filter(r=>r.support==='independent').length],['支援あり',records.filter(r=>r.support==='assisted').length],['未評価',records.filter(r=>r.support==='unrated').length]].map(([label,n])=>`<div><span>${label}</span><strong>${n}<small> 回</small></strong></div>`).join('')}</div><section class="panel"><h2>これまでの記録 <span class="subtle">${state.records.length}件</span></h2>${state.records.length ? `<div class="table-wrap"><table><thead><tr><th>日時</th><th>呼び名</th><th>カード・文</th><th>Phase</th><th>種別</th><th>きっかけ</th><th>様子（押すと変更）</th></tr></thead><tbody>${state.records.slice(-200).reverse().map(r=>`<tr><td>${dateLabel(r.at)}</td><td>${esc(r.alias)}</td><td>${esc(r.label)}</td><td>${r.phase === 0 ? 'ふだん使い' : r.phase}</td><td>${r.kind === 'read' ? '読み上げ' : '過去の交換'}</td><td>${esc(r.context || '—')}</td><td><button class="quiet" data-record-id="${r.id}">${names[r.support]}</button></td></tr>`).join('')}</tbody></table></div><p class="subtle">画面には直近200件を表示します。CSVとバックアップには全件を含みます。</p>` : '<div class="empty"><span aria-hidden="true">▤</span><p>記録はまだありません。</p><p class="muted">カードや文を最後まで読み上げると、ここに残ります。</p></div>'}</section>`;
}
function backupView() {
  return `<section class="intro"><div><p class="eyebrow">バックアップ</p><h1>大切なカードを、手元に。</h1><p class="muted">写真・設定・記録をひとつのファイルにまとめます。</p></div></section><div class="home-grid"><section class="panel"><h2>バックアップを保存</h2><p>カード ${state.cards.length}枚 ／ 記録 ${state.records.length}件</p><p class="muted">最終書き出し：${dateLabel(state.lastBackupAt)}</p><button class="primary wide" data-action="backup">ファイルを保存する</button><p class="hint">書き出し後、iPadの「ファイル」で保存されたことを確認してください。</p></section><section class="panel"><h2>ファイルから復元</h2><p class="muted">v2で保存したバックアップを選びます。復元前に内容を確認できます。</p><label class="file-picker">バックアップを選ぶ<input id="restore-file" type="file" accept=".json,application/json"></label><p class="hint">復元すると現在のカード・設定・記録が置き換わります。先に現在のバックアップを保存してください。</p></section></div><aside class="info-note"><strong>端末内の保存と、バックアップは別です。</strong><p>ブラウザーデータの削除や端末の故障で、端末内データは失われることがあります。バックアップは暗号化されていません。学校の運用に沿った保存先で管理してください。</p></aside>`;
}
function settingsView() {
  return `<section class="intro"><div><p class="eyebrow">先生用設定</p><h1>使いやすさを、ひとりずつ。</h1><p class="muted">カードの表示・音声・フェイズ別の練習を調整します。</p></div></section>${phaseSettings()}<div class="home-grid"><section class="panel"><h2>カードの表示</h2><form id="display-form"><label class="check"><input type="checkbox" name="showLabel" ${state.settings.showLabel ? 'checked' : ''}> 生徒画面にカードの文字を表示する</label><button type="submit" class="secondary">表示設定を保存</button></form><p class="hint">「よむ」を押すと文を読み上げます。カード選択時の読み上げは、下の音声設定で切り替えられます。</p></section><section class="panel"><h2>先生用画面への入口</h2><p class="muted">カードブックの「設定」を押し、確認画面を長押し${state.settings.pin ? 'し、PINを入力' : ''}すると戻れます。</p><form id="pin-form"><label>${state.settings.pin ? '新しいPIN（空欄で解除）' : 'PINを設定（任意）'}<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="new-password" placeholder="数字4〜8桁"></label><button class="secondary" type="submit">PIN設定を保存</button></form><p class="hint">PINは誤操作防止用です。データの暗号化ではありません。忘れた場合は、学習開始前のバックアップから復元してください。</p></section></div><section class="info-note"><h2>この端末での利用</h2><h3>読み上げ</h3><p id="voice-status">${esc(voiceStatus())}</p>${speechSettingsForm()}<p>読み上げには端末内の日本語音声だけを使います。端末に音声がない場合、クラウド音声への切り替えは行いません。</p><p>写真と記録の外部送信・自動同期は行いません。オンラインでの初回アクセスや更新時には、配信先との通信が発生します。</p><button class="secondary" data-action="persistent">端末内の保存を保護する</button><p class="hint">ブラウザーが対応している場合、保存データが自動削除されにくくなるよう要求します。バックアップは引き続き必要です。</p></section>${offlinePanel()}`;
}
function prepareCardMotion(before, after) {
  const keys = value => [...value.cardIds.map(id => `item:${id}`), ...(value.ending ? ['ending:request'] : [])];
  const previous = keys(before), current = keys(after);
  const removed = previous.find(key => !current.includes(key));
  const added = current.find(key => !previous.includes(key));
  const key = removed || added;
  if (!key) return () => {};
  const find = container => [...document.querySelectorAll(`${container} [data-motion-key]`)].find(el => el.dataset.motionKey === key);
  const bookSelector = isDaily() ? '.daily-book' : '.sentence-book';
  const source = find(removed ? '.sentence-track' : bookSelector);
  const from = source?.getBoundingClientRect();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ghost = source && !reduced ? source.cloneNode(true) : null;
  if (ghost) {
    const style = getComputedStyle(source);
    ghost.classList.add('moving-card');
    ghost.disabled = false;
    ghost.inert = true;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.tabIndex = -1;
    Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, backgroundColor: style.backgroundColor, borderColor: style.borderColor });
    document.body.append(ghost);
  }
  return () => {
    const destination = find(removed ? bookSelector : '.sentence-track');
    destination?.focus({ preventScroll: true });
    if (!ghost) return;
    const to = destination?.getBoundingClientRect();
    if (!to || !ghost.animate || to.bottom < 0 || to.top > innerHeight || to.right < 0 || to.left > innerWidth) { ghost.remove(); return; }
    const animation = ghost.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`, opacity: .35 }
    ], { duration: 240, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
    animation.finished.then(() => ghost.remove(), () => ghost.remove());
  };
}
function sentenceStrip(editable = false) {
  const items = trial.cardIds.map(id => {
    const card = state.cards.find(c => c.id === id);
    const label = esc(card.label);
    const content = face(card, state.settings.showLabel);
    return `<div class="sentence-unit">${editable ? `<button class="word-card" data-sentence-action="remove" data-card-id="${id}" data-motion-key="item:${id}" aria-label="${label}をブックにもどす">${content}</button>` : `<div class="word-card" role="img" aria-label="${label}">${content}</div>`}</div>`;
  }).join('');
  const endingLabel = endingWord(trial);
  const endingEmoji = Object.values(COMMENTS).find(c => c.label === endingLabel)?.emoji || '🤲';
  const endingContent = `<span class="card-emoji" aria-hidden="true">${endingEmoji}</span><strong>${endingLabel === 'をもっています' ? 'をもって<br>います' : esc(endingLabel)}</strong>`;
  const ending = trial.ending ? `<div class="sentence-unit ending">${editable ? `<button class="word-card" data-sentence-action="ending" data-motion-key="ending:request" aria-label="${esc(endingLabel)}をブックにもどす">${endingContent}</button>` : `<div class="word-card">${endingContent}</div>`}</div>` : (editable ? `<div class="ending-placeholder"></div>` : '');
  return `<div class="sentence-strip" role="group" aria-label="ぶんのならび" dir="ltr"><div class="sentence-track">${items}${ending}</div></div>`;
}
function sentenceBoard(editable = false) {
  const complete = trial.stage === 'selected';
  const canUndo = Boolean(trial.history?.length);
  return `<div class="sentence-board">${sentenceStrip(editable)}<div class="strip-tools" role="group" aria-label="ぶんのそうさ"><button class="strip-tool speak-tool" data-action="speak" aria-label="ぶんをよみあげる" aria-pressed="false" ${complete ? '' : 'disabled'}><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 12h5l7-6v20l-7-6H5z"/><path d="M22 11q5 5 0 10M26 6q10 10 0 20"/></svg><span class="speech-label">よむ</span></button><button class="strip-tool undo-tool" data-sentence-action="undo" aria-label="ひとつもどす" ${canUndo ? '' : 'disabled'}><span class="undo-symbol" aria-hidden="true">↶</span><span>ひとつ<br>もどす</span></button></div></div>`;
}
function pageControls(page) {
  return page.pages > 1 ? `<div class="card-pages" role="group" aria-label="カードのページ"><button class="quiet" data-card-page="${page.page-1}" aria-label="前のカードページ" ${page.page === 0 ? 'disabled' : ''}>◀</button><span aria-live="polite">${page.page+1} / ${page.pages}</span><button class="quiet" data-card-page="${page.page+1}" aria-label="次のカードページ" ${page.page === page.pages-1 ? 'disabled' : ''}>▶</button></div>` : '';
}
function studentControls() {
  return `<div class="student-controls">${fullscreenButton()}${screen === 'token' ? '<button class="quiet" data-action="token-book" aria-label="カードブックへ戻る" title="カードブックへ戻る">▦</button>' : `${state.tokens.enabled ? '<button class="quiet" data-action="token-open" aria-label="トークンボードを開く" title="トークンボードを開く">☆</button>' : ''}${isDaily() ? '<button class="quiet" data-action="edit-book" aria-label="配置を編集" title="配置を編集">✎</button>' : ''}`}<button class="quiet" data-action="teacher" aria-label="設定" title="設定">⚙</button></div>`;
}
function tokenSettingsView() {
  const board = state.tokens;
  return `<section class="intro"><div><h1>トークンボード</h1><p class="muted">選んだ楽しみと、そこまでに集める星を表示します。</p></div></section><section class="panel"><form id="token-form"><label class="check"><input type="checkbox" name="enabled" ${board.enabled ? 'checked' : ''}>トークンボードを使う</label><label>表示方法<select name="display"><option value="separate" ${board.display === 'separate' ? 'selected' : ''}>専用画面のみ（標準）</option><option value="compact" ${board.display === 'compact' ? 'selected' : ''}>カードブックにも小さく表示</option></select></label><p class="hint">表示方法を変えても、選んだ楽しみと星はそのままです。</p><label>集める数<select name="total">${[1,2,3,4,5].map(n=>`<option value="${n}" ${board.total === n ? 'selected' : ''}>${n}個</option>`).join('')}</select></label><fieldset class="token-choice-settings"><legend>楽しみの候補（1〜6枚）</legend>${state.cards.map(c=>`<label class="check"><input type="checkbox" name="tokenChoices" value="${c.id}" ${board.choiceIds.includes(c.id) ? 'checked' : ''}>${esc(c.label)}</label>`).join('')}</fieldset><p class="hint">個数や候補を変更して保存すると、今の進み具合は最初に戻ります。同じ写真・文字をカードブックと共用します。</p><button class="primary" type="submit">トークンの設定を保存</button></form></section><section class="info-note"><p>星は支援者が手動で追加します。カードの読み上げやフェーズの記録では自動で増えません。星を集めている途中でもカードブックへ戻って伝えられます。</p><p>設定と進み具合はこの端末内に保存され、バックアップにも含まれます。現在：${board.earned} / ${board.total}個</p><button class="secondary" data-action="token-open" ${board.enabled ? '' : 'disabled'}>トークンボードを開く</button></section>`;
}
function compactTokensVisible() {
  return state.tokens.enabled && state.tokens.display === 'compact' && !bookEditing;
}
function compactTokenView() {
  if (!compactTokensVisible()) return '';
  const board = state.tokens, stage = tokenStage(board);
  const card = state.cards.find(c => c.id === board.rewardId);
  const open = `<button class="compact-token-open" data-action="token-open" aria-label="トークンの専用画面を開く">${card ? face(card, false) : '☆'}</button>`;
  if (stage === 'choose' || stage === 'reward') return `<aside class="compact-tokens" aria-label="トークン">${open}<button class="compact-token-message" data-action="token-open">${stage === 'choose' ? '楽しみをえらぶ' : 'つぎをえらぶ'}</button></aside>`;
  return `<aside class="compact-tokens" aria-label="トークン">${open}<div class="compact-token-stars" role="img" aria-label="${board.total}個のうち${board.earned}個たまりました">${Array.from({length:board.total},(_,i)=>`<span class="${i < board.earned ? 'filled' : ''}" aria-hidden="true">${i < board.earned ? '★' : '☆'}</span>`).join('')}</div><span class="compact-token-count" aria-live="polite">${board.earned}/${board.total}</span><button data-token-action="undo" aria-label="トークンを1つ戻す" ${board.earned ? '' : 'disabled'}>↶</button>${stage === 'ready' ? '<button data-token-action="redeem">できた</button>' : '<button data-token-action="add" aria-label="星を1つわたす">＋★</button>'}</aside>`;
}
function tokenView() {
  const board = state.tokens;
  const stage = tokenStage(board);
  const card = state.cards.find(c=>c.id === board.rewardId);
  if (!board.enabled) return '<main class="student token-workspace"><p>先生用設定からトークンボードを有効にしてください。</p><button class="secondary" data-action="token-book">カードブックへ戻る</button></main>';
  if (stage === 'choose') return `<main class="student token-workspace" aria-label="楽しみを選ぶ"><section class="token-choices" aria-label="楽しみの候補">${board.choiceIds.map(id=>state.cards.find(c=>c.id===id)).map(c=>`<button class="word-card" data-token-choice="${c.id}" aria-label="${esc(c.label)}を楽しみに選ぶ">${face(c,state.settings.showLabel)}</button>`).join('')}</section></main>`;
  if (stage === 'reward') return `<main class="student token-workspace token-earned" aria-label="選んだ楽しみ"><div class="token-target">${face(card,state.settings.showLabel)}</div><button class="primary" data-token-action="reset">つぎをえらぶ</button></main>`;
  return `<main class="student token-workspace" aria-label="トークンボード"><section class="token-target" aria-label="楽しみ：${esc(card.label)}">${face(card,state.settings.showLabel)}</section><div class="token-slots" role="img" aria-label="${board.total}個のうち${board.earned}個たまりました">${Array.from({length:board.total},(_,i)=>`<span class="token-slot ${i < board.earned ? 'filled' : ''}" aria-hidden="true">${i < board.earned ? '★' : ''}</span>`).join('')}</div><div class="token-progress" aria-live="polite">${board.earned} / ${board.total}</div>${stage === 'ready' ? '<button class="primary token-done" data-token-action="redeem">できた</button>' : ''}<div class="token-support" role="group" aria-label="支援者の操作"><button class="quiet" data-token-action="undo" aria-label="トークンを1つ戻す" ${board.earned ? '' : 'disabled'}>↶</button><button class="primary" data-token-action="add" ${stage === 'collecting' ? '' : 'disabled'}>＋ 星をわたす</button><button class="quiet" data-action="token-reset">えらびなおす</button></div></main>`;
}
function predicateToggle() {
  return `<button class="predicate-toggle" data-action="toggle-predicate" aria-pressed="${predicateOpen}" aria-label="つたえることばのページ${predicateOpen ? 'を閉じる' : 'を開く'}"><span>つたえることば</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v11H11l-5 5v-5H5z"/><path d="M8 8h8M8 11h6"/></svg></button>`;
}
function categoryIcon(label) {
  if (!label) return '⌂';
  if (/の[みむ]もの|飲|水/.test(label)) return '🥤';
  if (/たべもの|食|おやつ/.test(label)) return '🍎';
  if (/あそび|遊|おもちゃ/.test(label)) return '🧸';
  if (/かつどう|動|運動/.test(label)) return '🏃';
  if (/おおき|形|色|かたち/.test(label)) return '◆';
  if (/場所|ばしょ|家/.test(label)) return '⌂';
  return '▦';
}
function categoryTabs(categories) {
  const all = [null, ...categories];
  const page = paginateBook([all], categoryPage, 4); categoryPage = page.page;
  return `<nav class="category-tabs reference-tabs" aria-label="カードのカテゴリ">${page.pages > 1 ? `<button class="tab-turn" data-category-page="${page.page-1}" aria-label="前のカテゴリ" ${page.page === 0 ? 'disabled' : ''}>◀</button>` : ''}${page.columns[0].map(c => `<button class="category-tab tab-color-${all.indexOf(c)%6}" data-category="${esc(c || '')}" aria-pressed="${!predicateOpen && dailyCategory === c}" aria-label="${esc(c || 'ぜんぶ')}"><span class="tab-name">${esc(c || 'ぜんぶ')}</span><span class="tab-icon" aria-hidden="true">${categoryIcon(c)}</span></button>`).join('')}${page.pages > 1 ? `<button class="tab-turn" data-category-page="${page.page+1}" aria-label="次のカテゴリ" ${page.page === page.pages-1 ? 'disabled' : ''}>▶</button>` : ''}</nav>`;
}
function sentenceView() {
  const phase = state.profile.phase;
  const mode = state.profile.commentMode;
  const cards = state.cards.filter(c => ![REQUEST, ...commentEndings].includes(c.label.trim()));
  const page = paginateBook([cards], cardPage, state.settings.book.rails * 2); cardPage = page.page;
  const endings = phase === 6 ? Object.entries(COMMENTS).filter(([key]) => mode === 'spontaneous' || mode === key).map(([,c]) => ({...c})) : [{label:REQUEST,emoji:'🤲'}];
  const words = page.columns[0].map(c => `<button class="word-card" data-sentence-action="select" data-card-id="${c.id}" data-motion-key="item:${c.id}" aria-label="${esc(c.label)}を文に入れる" ${trial.cardIds.includes(c.id) || trial.cardIds.length >= 4 ? 'disabled' : ''}>${face(c,state.settings.showLabel)}</button>`).join('');
  const endingCards = endings.map(c => `<button class="word-card request-choice" data-sentence-action="${phase === 6 ? 'expression' : 'ending'}" data-expression="${c.label}" aria-label="${c.label}を文に入れる" ${trial.ending && endingWord(trial) === c.label ? 'disabled' : ''}><span class="card-emoji" aria-hidden="true">${c.emoji}</span><strong>${c.label === 'をもっています' ? 'をもって<br>います' : c.label}</strong></button>`).join('');
  return `<main class="student sentence-student practice-binder reference-binder" aria-label="練習のカードブック">${predicateToggle()}<section class="sentence-book rails-${state.settings.book.rails}" aria-label="${predicateOpen ? 'つたえることば' : 'カードブック'}">${predicateOpen ? endingCards : words}</section><div class="book-navigation">${predicateOpen ? '' : pageControls(page)}</div>${compactTokenView()}<section class="sentence-area" aria-label="ぶんをつくるところ">${sentenceBoard(true)}</section></main>`;
}
function dailyView() {
  const categories = [...new Set(state.cards.map(c => c.category))];
  if (dailyCategory !== null && !categories.includes(dailyCategory)) dailyCategory = null;
  const cards = state.cards.filter(c => ![REQUEST, ...commentEndings].includes(c.label.trim()) && (dailyCategory === null || c.category === dailyCategory));
  const book = state.settings.book;
  const page = paginateBook(book.columns.map(column => column.filter(id => cards.some(c => c.id === id))), cardPage); cardPage = page.page;
  const endings = [{ label: REQUEST, emoji: '🤲' }, ...Object.values(COMMENTS)];
  const showPredicates = predicateOpen && !bookEditing;
  const rails = page.columns.map((column,index) => `<section class="daily-rail" data-rail="${index}" aria-label="${index+1}本目のマジックテープ">${showPredicates ? (endings[index] ? `<button class="word-card request-choice" data-sentence-action="expression" data-expression="${endings[index].label}" data-drag-expression="${endings[index].label}" aria-label="${endings[index].label}を文に入れる" ${trial.ending && trial.expression === endings[index].label ? 'disabled' : ''}><span class="card-emoji" aria-hidden="true">${endings[index].emoji}</span><strong>${endings[index].label === 'をもっています' ? 'をもって<br>います' : endings[index].label}</strong></button>` : '') : column.map(id => cards.find(c => c.id === id)).filter(Boolean).map(c => `<button class="word-card drag-card ${pickedCard === c.id ? 'picked-card' : ''}" data-drag-card="${c.id}" ${bookEditing ? `data-pick-card="${c.id}" aria-pressed="${pickedCard === c.id}"` : `data-sentence-action="select" data-card-id="${c.id}"`} data-motion-key="item:${c.id}" aria-label="${esc(c.label)}${bookEditing ? 'を移動する' : 'を文に入れる'}" ${!bookEditing && (trial.cardIds.includes(c.id) || trial.cardIds.length >= 4) ? 'disabled' : ''}>${face(c,state.settings.showLabel)}</button>`).join('')}${bookEditing ? `<button class="rail-place" data-place-rail="${index}" ${pickedCard ? '' : 'disabled'}>${index+1}本目に置く</button>` : ''}</section>`).join('');
  const color = showPredicates ? 6 : (dailyCategory === null ? 0 : (categories.indexOf(dailyCategory)+1)%6);
  return `<main class="student daily-student" aria-label="カードブック"><div class="book-edit-toolbar ${bookEditing ? 'is-editing' : ''}">${bookEditing ? `<label>縦のマジックテープ<select id="rail-count"><option value="4" ${book.rails === 4 ? 'selected' : ''}>4本</option><option value="5" ${book.rails === 5 ? 'selected' : ''}>5本</option></select></label><button class="primary" data-action="finish-book-edit">編集をおわる</button>` : ''}</div><div class="daily-binder reference-binder page-color-${color} ${bookEditing ? 'book-editing' : ''}">${bookEditing ? '' : predicateToggle()}<section class="daily-book rails-${book.rails}" aria-label="${showPredicates ? 'つたえることば' : 'カードブック'}">${rails}</section>${categoryTabs(categories)}${showPredicates ? '' : `<div class="book-navigation">${pageControls(page)}</div>`}${compactTokenView()}<section class="sentence-area" aria-label="ぶんをつくるところ">${bookEditing ? '' : sentenceBoard(true)}</section></div></main>`;
}
function sizeCardImage(radius) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 200;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,200,200);
  ctx.fillStyle = '#438fa5'; ctx.beginPath(); ctx.arc(100,100,radius,0,Math.PI*2); ctx.fill();
  return canvas.toDataURL('image/png');
}
function studentView() {
  if (isDaily()) return dailyView();
  if (state.profile.phase >= 4) return sentenceView();
  if (state.profile.phase === 3) return discriminationView();
  const card = state.cards.find(c => c.id === (trial.cardId || state.profile.cardId));
  const selected = trial.stage === 'selected';
  return `<main class="student single-student practice-binder" aria-label="練習のカードブック"><section class="single-book" aria-label="カードブック">${selected ? '<div class="card-placeholder" aria-hidden="true"></div>' : `<button class="student-card" data-action="select" aria-label="${esc(card.label)}のカードをえらぶ">${face(card,state.settings.showLabel)}</button>`}</section>${compactTokenView()}<section class="sentence-area" aria-label="えらんだカード"><div class="sentence-board"><div class="sentence-strip"><div class="sentence-track">${selected ? `<button class="word-card" data-action="reset" aria-label="${esc(card.label)}をブックにもどす">${face(card,state.settings.showLabel)}</button>` : ''}</div></div><div class="strip-tools"><button class="strip-tool speak-tool" data-action="speak" data-speech-subject="カード" aria-label="カードをよみあげる" aria-pressed="false" ${selected ? '' : 'disabled'}><span aria-hidden="true">🔊</span><span class="speech-label">よむ</span></button></div></div></section></main>`;
}
function discriminationView() {
  const selected = state.cards.find(c => c.id === trial.cardId);
  const choices = state.cards.filter(c => state.profile.choiceIds.includes(c.id));
  const page = paginateBook([choices], cardPage, state.settings.book.rails * 2); cardPage = page.page;
  return `<main class="student sentence-student practice-binder" aria-label="練習のカードブック"><section class="sentence-book rails-${state.settings.book.rails}" aria-label="カードブック">${page.columns[0].map(c => `<button class="word-card" data-action="select" data-card-id="${c.id}" aria-label="${esc(c.label)}のカードをえらぶ" ${selected?.id === c.id ? 'disabled' : ''}>${face(c,state.settings.showLabel)}</button>`).join('')}</section><div class="book-navigation">${pageControls(page)}</div>${compactTokenView()}<section class="sentence-area" aria-label="えらんだカード"><div class="sentence-board"><div class="sentence-strip"><div class="sentence-track">${selected ? `<button class="word-card" data-action="reset" aria-label="${esc(selected.label)}をブックにもどす">${face(selected,state.settings.showLabel)}</button>` : ''}</div></div><div class="strip-tools"><button class="strip-tool speak-tool" data-action="speak" data-speech-subject="カード" aria-label="カードをよみあげる" aria-pressed="false" ${selected ? '' : 'disabled'}><span aria-hidden="true">🔊</span><span class="speech-label">よむ</span></button></div></div></section></main>`;
}

function printView() {
  const selected = state.cards.filter(c => printSelection === null || printSelection.includes(c.id)).map(c => c.id);
  const pages = printPages(state.cards, selected, printSize);
  return `<section class="intro no-print"><div><p class="eyebrow">紙のカード</p><h1>A4に、いつものカードを。</h1><p class="muted">アプリと同じ写真・文字配置で印刷します。</p></div><button class="primary" data-action="print" ${pages.length ? '' : 'disabled'}>A4で印刷する</button></section><section class="panel no-print"><label>カードの大きさ<select id="print-size">${[[45,'大：4.5 × 4.5 cm'],[35,'中：3.5 × 3.5 cm'],[25,'小：2.5 × 2.5 cm']].map(([v,l]) => `<option value="${v}" ${printSize === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><fieldset><legend>印刷するカード</legend><div class="print-choices">${state.cards.map(c => `<label class="check"><input type="checkbox" data-print-card="${c.id}" ${selected.includes(c.id) ? 'checked' : ''}>${esc(c.label)}</label>`).join('')}</div></fieldset><p class="hint">A4・縦・倍率100%（実際のサイズ）・ヘッダーとフッターなしで印刷してください。印刷後に定規で寸法を確認してください。文字の上下と大きさは「カードを編集」で変更できます。</p><p>${selected.length}枚 ／ ${pages.length}ページ</p></section><div class="print-preview print-size-${printSize}">${pages.length ? pages.map((page, i) => `<section class="print-page columns-${page.columns}" aria-label="印刷 ${i+1}ページ">${page.cards.map(c => `<div class="paper-card">${face(c)}</div>`).join('')}</section>`).join('') : '<p class="no-print">印刷するカードを選んでください。</p>'}</div>`;
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
  syncFullscreenButton();
}
function closeDialog() { if (imageBusy) return toast('画像の準備を待ってください。'); dialog.close(); pendingRestore = null; editorToken++; }
function cardEditor(id = null) {
  editedId = id;
  const card = id ? state.cards.find(c => c.id === id) : { label: '', emoji: '▧', category: 'そのほか', image: null };
  const layout = cardLayout(card.layout);
  draftImage = card.image;
  editorToken++;
  modal(id ? 'カードを編集' : 'カードをつくる', `<form id="card-form"><div id="image-preview" class="image-preview">${face(card)}</div><label class="file-picker">写真・イラストを選ぶ<input id="card-image" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label><button type="button" class="text-button" data-action="remove-image">画像を外す</button><p class="hint">写真は端末内で縮小し、位置情報などを除去します。JPEG・PNG・WebP・GIF、15MBまで。</p><label>カードに表示する文字<input name="label" maxlength="40" required value="${esc(card.label)}" autocomplete="off"></label><label>文字の位置<select name="position"><option value="top" ${layout.position === 'top' ? 'selected' : ''}>写真の上</option><option value="bottom" ${layout.position === 'bottom' ? 'selected' : ''}>写真の下</option></select></label><label>文字と写真のバランス<select name="textSize">${[['small','文字は小さく・写真を大きく'],['medium','標準'],['large','文字を大きく・写真は小さく']].map(([v,l]) => `<option value="${v}" ${layout.textSize === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label>カテゴリ<input name="category" maxlength="30" required value="${esc(card.category)}" autocomplete="off"></label><label>画像がないときのマーク<input name="emoji" maxlength="16" value="${esc(card.emoji)}" autocomplete="off"></label><div class="modal-actions">${id ? `<button type="button" class="danger" data-action="delete-card" ${state.cards.length === 1 ? 'disabled' : ''}>削除</button>` : ''}<button type="submit" class="primary">カードを保存</button></div></form>`);
}
function updateCardPreview() {
  const form = dialog.querySelector('#card-form');
  if (!form) return;
  const fields = new FormData(form);
  const card = { label: fields.get('label') || 'カード', emoji: fields.get('emoji'), image: draftImage, layout: { position: fields.get('position'), textSize: fields.get('textSize') } };
  dialog.querySelector('#image-preview').innerHTML = face(card);
}
dialog.addEventListener('input', updateCardPreview);
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
  } else { screen = 'settings'; closeDialog(); render(); }
}
function recordDialog() {
  modal('先生用：今回の様子', '<p>今回の学習の様子を選んでください。</p><div class="record-choices"><button class="primary" data-support="independent">自分から</button><button class="secondary" data-support="assisted">支援あり</button><button class="quiet" data-support="unrated">あとで評価する</button></div>');
  dialog.querySelector('[data-action="close-dialog"]').hidden = true;
}

document.addEventListener('click', event => {
  const button = event.target.closest('button, a[data-action]');
  if (!button) return;
  if (button.dataset.action === 'fullscreen-exit') { toggleFullscreen(true); return; }
  if (busy) return;
  if (performance.now() < suppressClickUntil) { event.preventDefault(); return; }
  if (button.dataset.action === 'offline-retry') { prepareOffline(); return; }
  if (button.dataset.action === 'fullscreen') { toggleFullscreen(); return; }
  if (button.dataset.tokenChoice || button.dataset.tokenAction) {
    const action = button.dataset.tokenChoice ? 'select' : button.dataset.tokenAction;
    return run(async () => { const next = structuredClone(state); next.tokens = tokenTransition(next.tokens, action, button.dataset.tokenChoice); await persist(next); if (dialog.open) closeDialog(); render(); if (action === 'select') saySelection(state.cards.find(c=>c.id === state.tokens.rewardId).label); });
  }
  if (button.dataset.categoryPage !== undefined) { categoryPage = Number(button.dataset.categoryPage); render(); return; }
  if (button.dataset.action === 'toggle-predicate') { predicateOpen = !predicateOpen; render(); return; }
  if (button.dataset.cardPage !== undefined) { cardPage = Number(button.dataset.cardPage); render(); return; }
  if (button.dataset.pickCard) { pickedCard = button.dataset.pickCard; render(); return; }
  if (button.dataset.placeRail !== undefined) { saveCardPosition(pickedCard,Number(button.dataset.placeRail)); return; }
  if (button.dataset.action !== 'speak') { pendingReading = null; reader.stop(); }
  if (button.tagName === 'A') event.preventDefault();
  if (button.dataset.sentenceAction) {
    try {
      const next = sentenceTransition(trial, button.dataset.sentenceAction, button.dataset.expression || button.dataset.cardId, state.cards);
      const animate = prepareCardMotion(trial, next);
      trial = next;
      if (['expression','ending'].includes(button.dataset.sentenceAction) && trial.ending) predicateOpen = false;
      render(); animate();
      if (button.dataset.sentenceAction === 'select') saySelection(state.cards.find(c => c.id === button.dataset.cardId).label);
      if (button.dataset.sentenceAction === 'ending' && trial.ending) saySelection(endingWord(trial));
      if (button.dataset.sentenceAction === 'expression') saySelection(trial.expression);
    } catch (error) { toast(error.message); }
    return;
  }
  if (button.dataset.category !== undefined) { dailyCategory = button.dataset.category || null; cardPage = 0; predicateOpen = false; render(); return; }
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
    if (reader.reading && pendingReading) { pendingReading = null; reader.stop(); return; }
    try {
      const record = readingRecord(state, trial, { id: uid(), at: now() });
      pendingReading = record;
      reader.read(record.sentence || [record.label], state.settings.speech);
    } catch (error) { pendingReading = null; toast(error.message); }
    return;
  }
  if (action === 'preview-speech') {
    const fields = new FormData(document.querySelector('#speech-form'));
    try { reader.read(['ボール', 'ください'], { voiceURI: String(fields.get('voiceURI')), rate: Number(fields.get('rate')), pauses: fields.has('pauses') }); } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'print') { run(async () => { await Promise.all([...document.querySelectorAll('.print-preview img')].map(img => img.decode())); window.print(); }); return; }
  if (action === 'stop-speech') return;
  if (action === 'close-dialog') return closeDialog();
  if (action === 'token-open') { if (!state.tokens.enabled) return toast('先生用のトークン設定を有効にしてください。'); pendingReading = null; reader.stop(); screen = 'token'; bookEditing = false; unlocked = false; render(); return; }
  if (action === 'token-book') { screen = 'student'; render(); return; }
  if (action === 'token-reset') { modal('楽しみを選び直す', '<p>今の星を0個に戻して、楽しみを選び直します。</p><button class="primary" data-token-action="reset">選び直す</button>'); return; }
  if (action === 'teacher') { bookEditing = false; pickedCard = null; return teacherGate(); }
  if (action === 'edit-book' || action === 'finish-book-edit') { bookEditing = action === 'edit-book'; pickedCard = null; render(); return; }
  if (action === 'home') { screen = 'settings'; render(); return; }
  if (action === 'new-card') return cardEditor();
  if (action === 'select' || action === 'reset') {
    if (pendingRecord) return recordDialog();
    try { trial = usesSentence() ? sentenceTransition(trial, action, null, state.cards) : transition(action === 'select' ? newTrial() : trial, action, button.dataset.cardId || state.profile.cardId); render(); if (action === 'select') saySelection(state.cards.find(c => c.id === trial.cardId).label); } catch (error) { toast(error.message); } return;
  }
  if (action === 'remove-image') { if (imageBusy) return; draftImage = null; updateCardPreview(); return; }
  run(async () => {
    if (action === 'start-daily') {
      const next = structuredClone(state); next.profile.mode = 'daily'; await persist(next);
      bookEditing = false; pickedCard = null; dailyCategory = null; cardPage = 0; categoryPage = 0; predicateOpen = false; trial = newSentenceTrial('', true); unlocked = false; screen = 'student'; render();
    } else if (action === 'add-size-cards') {
      const next = structuredClone(state);
      for (const [label, radius] of [['おおきい',72], ['ちいさい',28]]) {
        if (!next.cards.some(c => c.label === label)) next.cards.push({ id: uid(), label, category: 'おおきさ', emoji: '', image: sizeCardImage(radius), layout: cardLayout() });
      }
      await persist(next); render(); toast('大きい・小さいのカードを使えます。カード画面で編集・印刷もできます。');
    } else if (action === 'delete-card') {
      if (imageBusy || state.cards.length === 1) return;
      const card = state.cards.find(c => c.id === editedId);
      modal('カードの削除を確認', `<p>「${esc(card.label)}」を削除します。過去の学習記録は残ります。</p><p class="hint">必要な画像は、先にバックアップに保存してください。</p><button class="danger wide" data-action="delete-card-confirm">このカードを削除する</button>`);
    } else if (action === 'delete-card-confirm') {
      if (state.cards.length === 1) return;
      const next = structuredClone(state);
      next.cards = next.cards.filter(c=>c.id!==editedId);
      next.profile.choiceIds = next.profile.choiceIds.filter(id => id !== editedId);
      if (next.profile.phase === 3 && next.profile.choiceIds.length < 2) next.profile.phase = 1;
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
      await persist(pendingRestore); printSelection = null; trial = newTrial(); pendingRecord = null; unlocked = false;
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
    if (form.id === 'token-form') {
      const total = Number(fields.get('total')), choiceIds = fields.getAll('tokenChoices'), enabled = fields.has('enabled');
      if (enabled && (choiceIds.length < 1 || choiceIds.length > 6)) throw new Error('楽しみの候補を1〜6枚選んでください。');
      if (choiceIds.length > 6) throw new Error('楽しみの候補は6枚までです。');
      const changed = total !== state.tokens.total || JSON.stringify(choiceIds) !== JSON.stringify(state.tokens.choiceIds);
      next.tokens = { ...state.tokens, enabled, display: fields.get('display'), total, choiceIds, ...(changed ? { rewardId:null, earned:0, redeemed:false } : {}) };
      await persist(next); render(); toast('トークンの設定を保存しました。');
    } else if (form.id === 'learning-form') {
      next.profile = { alias: String(fields.get('alias')).trim(), cardId: fields.get('cardId'), phase: Number(fields.get('phase')), choiceIds: fields.getAll('choiceIds'), commentMode: fields.get('commentMode'), mode: 'learning' };
      await persist(next); unlocked = false; screen = 'student'; cardPage = 0; predicateOpen = false; trial = state.profile.phase >= 4 ? newSentenceTrial(state.profile.phase === 6 ? '' : undefined) : newTrial(); render();
    } else if (form.id === 'card-form') {
      const card = { id: editedId || uid(), label: String(fields.get('label')).trim(), category: String(fields.get('category')).trim(), emoji: String(fields.get('emoji')).trim(), image: draftImage, layout: { position: fields.get('position'), textSize: fields.get('textSize') } };
      if (editedId) next.cards[next.cards.findIndex(c=>c.id===editedId)] = card; else next.cards.push(card);
      await persist(next); closeDialog(); render(); toast('カードを保存しました。');
    } else if (form.id === 'speech-form') {
      next.settings.speech = { voiceURI: String(fields.get('voiceURI')), rate: Number(fields.get('rate')), pauses: fields.has('pauses'), onSelect: fields.has('onSelect') };
      reader.stop(); await persist(next); render(); toast('声の設定を保存しました。');
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
  if (input.id === 'daily-category') { dailyCategory = input.value || null; cardPage = 0; render(); return; }
  if (input.id === 'rail-count') { run(async () => { const next = structuredClone(state); next.settings.book = resizeBook(next.settings.book,Number(input.value)); await persist(next); render(); }); return; }
  if (input.id === 'print-size') { printSize = Number(input.value); render(); return; }
  if (input.dataset.printCard) { const selected = new Set(printSelection ?? state.cards.map(c => c.id)); if (input.checked) selected.add(input.dataset.printCard); else selected.delete(input.dataset.printCard); printSelection = [...selected]; render(); return; }
  if (input.id === 'card-image') {
    const file = input.files?.[0]; if (!file) return;
    imageBusy = true;
    const token = editorToken;
    const submit = dialog.querySelector('[type="submit"]'); submit.disabled = true;
    try { const data = await resizeImage(file); if (token === editorToken) { draftImage = data; updateCardPreview(); } }
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

function checkOfflineFiles(worker) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (error, ready) => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); error ? reject(error) : resolve(ready); };
    const timer = setTimeout(() => finish(new Error('offline check timed out')), 8000);
    channel.port1.onmessage = event => finish(null, event.data?.ready === true);
    try { worker.postMessage({ type: 'CHECK_OFFLINE' }, [channel.port2]); }
    catch (error) { finish(error); }
  });
}
async function prepareOffline() {
  if (offlineChecking) return;
  if (!('serviceWorker' in navigator)) { offlineState = 'unsupported'; syncOfflineStatus(); return; }
  offlineChecking = true; offlineState = 'checking'; syncOfflineStatus();
  let timer;
  try {
    // Reuse a saved worker even if the update request cannot reach the server.
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('offline preparation timed out')), 15000); });
    let registration = await Promise.race([navigator.serviceWorker.getRegistration('./'), timeout]);
    if (registration?.active) {
      // A slow or absent connection must not delay access to the saved app.
      registration.update().catch(() => {});
    } else {
      registration = await Promise.race([navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }), timeout]);
    }
    const ready = registration?.active ? registration : await Promise.race([navigator.serviceWorker.ready, timeout]);
    onlineReady = await checkOfflineFiles(ready.active);
    offlineState = onlineReady ? 'ready' : 'error';
  } catch { onlineReady = false; offlineState = 'error'; }
  finally { clearTimeout(timer); offlineChecking = false; syncOfflineStatus(); }
}

async function start() {
  try {
    state = await openStorage();
    if (state.profile.mode !== 'daily') {
      const next = structuredClone(state); next.profile.mode = 'daily'; await persist(next);
    }
    screen = 'student'; trial = newSentenceTrial('', true); dailyCategory = null; unlocked = false;
    render(); prepareOffline();
  }
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

function saveCardPosition(id, rail, before = null) {
  if (!bookEditing || !id) return;
  run(async () => {
    const next = structuredClone(state);
    next.settings.book = moveBookCard(next.settings.book,id,rail,before);
    await persist(next); pickedCard = null; render();
  });
}
function clearPointerDrag() {
  const drag = pointerDrag; pointerDrag = null;
  drag?.ghost?.remove();
  document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  if (drag?.source.hasPointerCapture?.(drag.pointerId)) drag.source.releasePointerCapture(drag.pointerId);
  return drag;
}
document.addEventListener('pointerdown', event => {
  if (!state || busy || !isDaily() || screen !== 'student' || event.button !== 0) return;
  const source = event.target.closest('[data-drag-card], [data-drag-expression]');
  if (!source || source.disabled || (bookEditing && !source.dataset.dragCard)) return;
  pointerDrag = {source,pointerId:event.pointerId,x:event.clientX,y:event.clientY,editing:bookEditing};
  source.setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove', event => {
  const drag = pointerDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!drag.ghost && Math.hypot(event.clientX-drag.x,event.clientY-drag.y) < 10) return;
  event.preventDefault();
  if (event.clientY > innerHeight-48) window.scrollBy(0,18);
  else if (event.clientY < 48) window.scrollBy(0,-18);
  if (drag.editing) {
    const book = document.querySelector('.daily-book'), box = book.getBoundingClientRect();
    if (event.clientX > box.right-30) book.scrollBy(16,0);
    else if (event.clientX < box.left+30) book.scrollBy(-16,0);
  }
  if (!drag.ghost) {
    pendingReading = null; reader.stop();
    const box = drag.source.getBoundingClientRect();
    drag.ghost = drag.source.cloneNode(true); drag.ghost.inert = true;
    drag.ghost.setAttribute('aria-hidden','true'); drag.ghost.classList.add('drag-ghost');
    Object.assign(drag.ghost.style,{width:`${box.width}px`,height:`${box.height}px`});
    document.body.append(drag.ghost);
  }
  Object.assign(drag.ghost.style,{left:`${event.clientX-40}px`,top:`${event.clientY-40}px`});
  document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  const target = document.elementFromPoint(event.clientX,event.clientY);
  (drag.editing ? target?.closest('[data-rail]') : target?.closest('.sentence-area'))?.classList.add('drop-target');
},{passive:false});
document.addEventListener('pointerup', event => {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
  const target = document.elementFromPoint(event.clientX,event.clientY);
  const drag = clearPointerDrag();
  if (!drag.ghost) return;
  suppressClickUntil = performance.now()+500;
  if (drag.editing) {
    const rail = target?.closest('[data-rail]');
    if (rail && bookEditing) saveCardPosition(drag.source.dataset.dragCard,Number(rail.dataset.rail),target.closest('[data-drag-card]')?.dataset.dragCard || null);
  } else if (!bookEditing && target?.closest('.sentence-area')) {
    try {
      trial = sentenceTransition(trial,drag.source.dataset.dragCard ? 'select' : 'expression',drag.source.dataset.dragCard || drag.source.dataset.dragExpression,state.cards);
      if (drag.source.dataset.dragExpression && trial.ending) predicateOpen = false;
      render(); saySelection(drag.source.dataset.dragCard ? state.cards.find(c => c.id === drag.source.dataset.dragCard).label : drag.source.dataset.dragExpression);
    } catch(error) { toast(error.message); }
  }
});
document.addEventListener('pointercancel', clearPointerDrag);
window.addEventListener('blur', clearPointerDrag);
