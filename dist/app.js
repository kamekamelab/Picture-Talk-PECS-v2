import { cardLayout, printPages } from './cards.js';
import { newTrial, transition, backupText, parseBackup, csv, readingRecord, MAX_BACKUP_BYTES } from './domain.js';
import { openStorage, writeState } from './storage.js';
import { COMMENTS, commentEndings, endingWord, REQUEST, newSentenceTrial, sentenceWords, sentenceTransition } from './sentence.js';
import { createReader, localJapaneseVoice, localJapaneseVoices } from './speech.js';

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
let pendingReading = null;
let printSelection = null;
let printSize = 35;
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
  return card.image ? `<img class="card-image ${large ? 'large' : ''}" src="${esc(card.image)}" alt="">` : `<span class="card-emoji ${large ? 'large' : ''}" aria-hidden="true">${esc(card.emoji || '▧')}</span>`;
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
function tag() { return `<span class="status ${onlineReady ? 'ready' : ''}">${onlineReady ? '● オフライン準備済み' : '○ オフライン準備中'}</span>`; }
function header(student = false) {
  return `<header class="top"><a class="brand" href="#" data-action="${student ? 'teacher' : 'home'}"><img src="./icons/icon.svg" width="42" height="42" alt=""><span>Picture Talk<small>PECS v2${student ? '' : ' ・ 先生用'}</small></span></a>${student ? '<button class="quiet" data-action="teacher">先生用</button>' : tag()}</header>`;
}
function nav() {
  return `<nav class="nav" aria-label="先生用メニュー">${[['home','学習の準備'],['cards','カード'],['print','印刷'],['records','学習記録'],['backup','バックアップ'],['settings','設定']].map(([key,label]) => `<button class="${screen === key ? 'active' : ''}" data-screen="${key}" ${screen === key ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>`;
}
function render() {
  if (!state) return;
  if (screen === 'locked') {
    app.innerHTML = `<div class="shell">${header(true)}<main class="locked"><p class="eyebrow">先生用</p><h1>学習の準備をはじめましょう</h1><p class="muted">先生用PINで開いてください。</p><button class="primary" data-action="teacher">先生用画面を開く</button></main></div>`;
    return;
  }
  const student = screen === 'student';
  app.innerHTML = `<div class="shell ${student ? 'student-shell' : ''}">${header(student)}${student ? studentView() : `${nav()}<main id="main">${({ home: homeView, cards: cardsView, print: printView, records: recordsView, backup: backupView, settings: settingsView })[screen]()}</main><footer>PTP · 開発版 0.7.0 <span>写真と学習記録は、この端末内に保存します。</span></footer>`}</div>`;
}
function homeView() {
  const card = state.cards.find(c => c.id === state.profile.cardId);
  return `<section class="intro"><div><p class="eyebrow">学習の準備</p><h1>カードで、つたえる。</h1><p class="muted">学習段階とカードを選んで、つたえる学習をはじめましょう。</p></div><span class="phase-chip">Phase ${state.profile.phase}</span></section>
  <div class="home-grid"><section class="panel"><div class="section-heading"><h2>今日の学習</h2><span class="subtle">日本語でつたえる</span></div><form id="learning-form"><label>呼び名 <span class="subtle">本名の登録は不要です</span><input name="alias" maxlength="40" value="${esc(state.profile.alias)}" required autocomplete="off"></label><label>学習段階<select name="phase"><option value="1" ${state.profile.phase === 1 ? 'selected' : ''}>Phase 1：1枚でつたえる</option><option value="2" ${state.profile.phase === 2 ? 'selected' : ''}>Phase 2：自分からつたえる</option><option value="3" ${state.profile.phase === 3 ? 'selected' : ''}>Phase 3：複数からえらぶ</option><option value="4" ${state.profile.phase === 4 ? 'selected' : ''}>Phase 4：日本語の文をつくる</option><option value="5" ${state.profile.phase === 5 ? 'selected' : ''}>Phase 5：質問に答えて要求する</option><option value="6" ${state.profile.phase === 6 ? 'selected' : ''}>Phase 6：コメントする</option></select></label><label>Phase 1・2で使うカード<select name="cardId">${state.cards.map(c => `<option value="${c.id}" ${c.id === card.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label><fieldset class="choice-settings"><legend>Phase 3で並べるカード（2枚以上）</legend>${state.cards.map(c => `<label class="check"><input type="checkbox" name="choiceIds" value="${c.id}" ${state.profile.choiceIds.includes(c.id) ? 'checked' : ''}>${esc(c.label)}</label>`).join('')}</fieldset><label>Phase 6の学習方法<select name="commentMode">${[['spontaneous','自分からコメント（質問なし）'],['see','質問に答える：なにがみえますか？'],['hear','質問に答える：なにがきこえますか？'],['have','質問に答える：なにをもっていますか？']].map(([v,l]) => `<option value="${v}" ${state.profile.commentMode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><p class="hint">Phase 5では先生が「なにがほしいですか？」と問いかけます。Phase 6では質問への応答と、質問なしのコメントを切り替えられます。</p><p class="hint">Phase 2では1枚のカードを使います。端末や相手との距離、場所を先生が調整してください。Phase 3では選んだカードだけを並べます。読み上げ回数は、各段階の達成を示すものではありません。</p><button class="primary wide" type="submit">学習を はじめる <span aria-hidden="true">→</span></button></form></section>
  <section class="preview-panel"><p class="eyebrow">今選んでいるカード</p><div class="sample-card">${face(card)}</div><p class="muted">大きなカードで、つたえよう。</p></section></div>
  <section class="roadmap-note"><span class="leaf" aria-hidden="true">↗</span><div><h2>まずは、1枚でつたえるところから。</h2><p>Phase 1〜6の画面を使えます。カードを選び、「よむ」でつたえます。</p></div></section>`;
}
function cardsView() {
  return `<section class="intro"><div><p class="eyebrow">カードブック</p><h1>いつもの物を、カードに。</h1><p class="muted">写真・イラスト・文字を自由に組み合わせられます。</p></div><button class="primary" data-action="new-card">＋ カードをつくる</button></section><div class="card-grid">${state.cards.map(c => `<article class="editor-card"><div class="editor-visual">${face(c)}</div><div class="editor-meta"><span class="subtle">${esc(c.category)}</span><h2>${esc(c.label)}</h2><button class="secondary wide" data-edit="${c.id}">${esc(c.label)}を編集</button></div></article>`).join('')}</div>`;
}
function recordsView() {
  const today = new Date().toLocaleDateString('ja-JP');
  const records = state.records.filter(r => r.kind === 'read' && new Date(r.at).toLocaleDateString('ja-JP') === today);
  const names = { independent: '自分から', assisted: '支援あり', unrated: '未評価' };
  return `<section class="intro"><div><p class="eyebrow">学習記録</p><h1>つたえる学習を、残す。</h1><p class="muted">最後まで読み上げた回数を保存します。過去の交換記録とは区別しています。</p></div><button class="secondary" data-action="csv" ${state.records.length ? '' : 'disabled'}>CSVを書き出す</button></section><div class="stats">${[['今日の読み上げ',records.length],['自分から',records.filter(r=>r.support==='independent').length],['支援あり',records.filter(r=>r.support==='assisted').length],['未評価',records.filter(r=>r.support==='unrated').length]].map(([label,n])=>`<div><span>${label}</span><strong>${n}<small> 回</small></strong></div>`).join('')}</div><section class="panel"><h2>これまでの記録 <span class="subtle">${state.records.length}件</span></h2>${state.records.length ? `<div class="table-wrap"><table><thead><tr><th>日時</th><th>呼び名</th><th>カード・文</th><th>Phase</th><th>種別</th><th>きっかけ</th><th>様子（押すと変更）</th></tr></thead><tbody>${state.records.slice(-200).reverse().map(r=>`<tr><td>${dateLabel(r.at)}</td><td>${esc(r.alias)}</td><td>${esc(r.label)}</td><td>${r.phase}</td><td>${r.kind === 'read' ? '読み上げ' : '過去の交換'}</td><td>${esc(r.context || '—')}</td><td><button class="quiet" data-record-id="${r.id}">${names[r.support]}</button></td></tr>`).join('')}</tbody></table></div><p class="subtle">画面には直近200件を表示します。CSVとバックアップには全件を含みます。</p>` : '<div class="empty"><span aria-hidden="true">▤</span><p>記録はまだありません。</p><p class="muted">カードや文を最後まで読み上げると、ここに残ります。</p></div>'}</section>`;
}
function backupView() {
  return `<section class="intro"><div><p class="eyebrow">バックアップ</p><h1>大切なカードを、手元に。</h1><p class="muted">写真・設定・記録をひとつのファイルにまとめます。</p></div></section><div class="home-grid"><section class="panel"><h2>バックアップを保存</h2><p>カード ${state.cards.length}枚 ／ 記録 ${state.records.length}件</p><p class="muted">最終書き出し：${dateLabel(state.lastBackupAt)}</p><button class="primary wide" data-action="backup">ファイルを保存する</button><p class="hint">書き出し後、iPadの「ファイル」で保存されたことを確認してください。</p></section><section class="panel"><h2>ファイルから復元</h2><p class="muted">v2で保存したバックアップを選びます。復元前に内容を確認できます。</p><label class="file-picker">バックアップを選ぶ<input id="restore-file" type="file" accept=".json,application/json"></label><p class="hint">復元すると現在のカード・設定・記録が置き換わります。先に現在のバックアップを保存してください。</p></section></div><aside class="info-note"><strong>端末内の保存と、バックアップは別です。</strong><p>ブラウザーデータの削除や端末の故障で、端末内データは失われることがあります。バックアップは暗号化されていません。学校の運用に沿った保存先で管理してください。</p></aside>`;
}
function settingsView() {
  return `<section class="intro"><div><p class="eyebrow">先生用設定</p><h1>使いやすさを、ひとりずつ。</h1><p class="muted">生徒画面に見せるものを調整します。</p></div></section><div class="home-grid"><section class="panel"><h2>カードの表示</h2><form id="display-form"><label class="check"><input type="checkbox" name="showLabel" ${state.settings.showLabel ? 'checked' : ''}> 生徒画面にカードの文字を表示する</label><button type="submit" class="secondary">表示設定を保存</button></form><p class="hint">「よむ」を押すと文を読み上げます。カード選択時の読み上げは、下の音声設定で切り替えられます。</p></section><section class="panel"><h2>先生用画面への入口</h2><p class="muted">「先生用」を長押し${state.settings.pin ? 'し、PINを入力' : ''}すると戻れます。</p><form id="pin-form"><label>${state.settings.pin ? '新しいPIN（空欄で解除）' : 'PINを設定（任意）'}<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="new-password" placeholder="数字4〜8桁"></label><button class="secondary" type="submit">PIN設定を保存</button></form><p class="hint">PINは誤操作防止用です。データの暗号化ではありません。忘れた場合は、学習開始前のバックアップから復元してください。</p></section></div><section class="info-note"><h2>この端末での利用</h2><h3>読み上げ</h3><p id="voice-status">${esc(voiceStatus())}</p>${speechSettingsForm()}<p>読み上げには端末内の日本語音声だけを使います。端末に音声がない場合、クラウド音声への切り替えは行いません。</p><p id="offline-status">${onlineReady ? 'オフライン準備ができています。機内モードでの起動も確認してください。' : '初回の準備にはインターネット接続が必要です。'}</p><p>写真と記録の外部送信・自動同期は行いません。オンラインでの初回アクセスや更新時には、配信先との通信が発生します。</p><button class="secondary" data-action="persistent">端末内の保存を保護する</button><p class="hint">ブラウザーが対応している場合、保存データが自動削除されにくくなるよう要求します。バックアップは引き続き必要です。</p></section>`;
}
function prepareCardMotion(before, after) {
  const keys = value => [...value.cardIds.map(id => `item:${id}`), ...(value.ending ? ['ending:request'] : [])];
  const previous = keys(before), current = keys(after);
  const removed = previous.find(key => !current.includes(key));
  const added = current.find(key => !previous.includes(key));
  const key = removed || added;
  if (!key) return () => {};
  const find = container => [...document.querySelectorAll(`${container} [data-motion-key]`)].find(el => el.dataset.motionKey === key);
  const source = find(removed ? '.sentence-track' : '.sentence-book');
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
    const destination = find(removed ? '.sentence-book' : '.sentence-track');
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
  const ending = trial.ending ? `<div class="sentence-unit ending">${editable ? `<button class="word-card" data-sentence-action="ending" data-motion-key="ending:request" aria-label="${esc(endingLabel)}をブックにもどす">${endingContent}</button>` : `<div class="word-card">${endingContent}</div>`}</div>` : (editable ? `<div class="ending-placeholder">${state.profile.phase === 6 ? 'つたえることば' : REQUEST}</div>` : '');
  return `<div class="sentence-strip" role="group" aria-label="ぶんのならび" dir="ltr"><div class="sentence-track">${items}${ending}${!items && !trial.ending ? '<p class="hint">カードを ならべよう</p>' : ''}</div></div>`;
}
function sentenceBoard(editable = false) {
  const complete = trial.stage === 'selected';
  const canUndo = Boolean(trial.history?.length);
  return `<div class="sentence-board">${sentenceStrip(editable)}<div class="strip-tools" role="group" aria-label="ぶんのそうさ"><button class="strip-tool speak-tool" data-action="speak" aria-label="ぶんをよみあげる" aria-pressed="false" ${complete ? '' : 'disabled'}><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 12h5l7-6v20l-7-6H5z"/><path d="M22 11q5 5 0 10M26 6q10 10 0 20"/></svg><span class="speech-label">よむ</span></button><button class="strip-tool undo-tool" data-sentence-action="undo" aria-label="ひとつもどす" ${canUndo ? '' : 'disabled'}><span class="undo-symbol" aria-hidden="true">↶</span><span>ひとつ<br>もどす</span></button></div></div>`;
}
function sentenceView() {
  const phase = state.profile.phase;
  const comment = phase === 6;
  const mode = state.profile.commentMode;
  const question = phase === 5 ? 'なにが ほしいですか？' : comment && mode !== 'spontaneous' ? COMMENTS[mode].question : '';
  const endings = comment ? Object.entries(COMMENTS).filter(([key]) => mode === 'spontaneous' || mode === key).map(([key, c]) => `<button class="word-card request-choice" data-sentence-action="expression" data-expression="${c.label}" aria-label="${c.label}を文に入れる" ${trial.ending && trial.expression === c.label ? 'disabled' : ''}><span class="card-emoji" aria-hidden="true">${c.emoji}</span><strong>${c.label === 'をもっています' ? 'をもって<br>います' : c.label}</strong></button>`).join('') : `<button class="word-card request-choice" data-sentence-action="ending" data-motion-key="ending:request" aria-pressed="${trial.ending}" ${trial.ending ? 'disabled' : ''}><span class="card-emoji" aria-hidden="true">🤲</span><strong>${REQUEST}</strong></button>`;
  return `<main class="student sentence-student"><p class="eyebrow">${comment ? 'みつけたことを つたえよう' : 'ことばを ならべよう'}</p><h1>${comment ? 'つたえよう' : 'ぶんを つくろう'}</h1>${question ? `<p class="question-card">${question}</p>` : ''}<section class="sentence-book" aria-label="カードブック">${state.cards.filter(c => ![REQUEST, ...commentEndings].includes(c.label.trim())).map(c => `<button class="word-card" data-sentence-action="select" data-card-id="${c.id}" data-motion-key="item:${c.id}" aria-label="${esc(c.label)}を文に入れる" ${trial.cardIds.includes(c.id) || trial.cardIds.length >= 4 ? 'disabled' : ''}>${face(c, state.settings.showLabel)}</button>`).join('')}${endings}</section><section class="sentence-area" aria-label="ぶんをつくるところ"><h2>ぶん</h2>${sentenceBoard(true)}</section></main>`;
}
function studentView() {
  if (state.profile.phase >= 4) return sentenceView();
  if (state.profile.phase === 3) return discriminationView();
  const card = state.cards.find(c => c.id === (trial.cardId || state.profile.cardId));
  const selected = trial.stage === 'selected';
  return `<main class="student"><p class="eyebrow">カードで つたえよう</p><h1>${selected ? 'よんで つたえよう' : state.profile.phase === 2 ? 'じぶんから つたえよう' : 'カードを えらぼう'}</h1><div class="exchange-layout"><section class="book-space" aria-label="カードブック"><span class="space-label">カード</span>${selected ? '<div class="card-placeholder" aria-hidden="true"></div>' : `<button class="student-card" data-action="select" aria-label="${esc(card.label)}のカードをえらぶ">${face(card, state.settings.showLabel)}</button>`}</section><span class="exchange-arrow" aria-hidden="true">→</span><section class="give-space" aria-label="えらんだカード"><span class="space-label">えらんだカード</span>${selected ? `<button class="student-card selected" data-action="reset" aria-label="${esc(card.label)}をブックにもどす">${face(card, state.settings.showLabel)}</button>` : '<div class="card-placeholder" aria-hidden="true"><span>＋</span></div>'}</section></div><button class="primary read-card-button" data-action="speak" data-speech-subject="カード" aria-label="カードをよみあげる" aria-pressed="false" ${selected ? '' : 'disabled'}><span aria-hidden="true">🔊</span> <span class="speech-label">よむ</span></button></main>`;
}
function discriminationView() {
  const selected = state.cards.find(c => c.id === trial.cardId);
  const choices = state.cards.filter(c => state.profile.choiceIds.includes(c.id));
  return `<main class="student sentence-student"><p class="eyebrow">カードで つたえよう</p><h1>カードを えらぼう</h1><section class="sentence-book choice-book" aria-label="カードブック">${choices.map(c => `<button class="word-card" data-action="select" data-card-id="${c.id}" aria-label="${esc(c.label)}のカードをえらぶ" ${selected?.id === c.id ? 'disabled' : ''}>${face(c, state.settings.showLabel)}</button>`).join('')}</section><section class="sentence-area" aria-label="えらんだカード"><h2>えらんだカード</h2><div class="sentence-board"><div class="sentence-strip"><div class="sentence-track">${selected ? `<button class="word-card" data-action="reset" aria-label="${esc(selected.label)}をブックにもどす">${face(selected, state.settings.showLabel)}</button>` : '<p class="hint">カードを えらぼう</p>'}</div></div><div class="strip-tools"><button class="strip-tool speak-tool" data-action="speak" data-speech-subject="カード" aria-label="カードをよみあげる" aria-pressed="false" ${selected ? '' : 'disabled'}><span aria-hidden="true">🔊</span><span class="speech-label">よむ</span></button></div></div></section></main>`;
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
  } else { screen = 'home'; closeDialog(); render(); }
}
function recordDialog() {
  modal('先生用：今回の様子', '<p>今回の学習の様子を選んでください。</p><div class="record-choices"><button class="primary" data-support="independent">自分から</button><button class="secondary" data-support="assisted">支援あり</button><button class="quiet" data-support="unrated">あとで評価する</button></div>');
  dialog.querySelector('[data-action="close-dialog"]').hidden = true;
}

document.addEventListener('click', event => {
  const button = event.target.closest('button, a[data-action]');
  if (!button || busy) return;
  if (button.dataset.action !== 'speak') { pendingReading = null; reader.stop(); }
  if (button.tagName === 'A') event.preventDefault();
  if (button.dataset.sentenceAction) {
    try {
      const next = sentenceTransition(trial, button.dataset.sentenceAction, button.dataset.expression || button.dataset.cardId, state.cards);
      const animate = prepareCardMotion(trial, next);
      trial = next; render(); animate();
      if (button.dataset.sentenceAction === 'select') saySelection(state.cards.find(c => c.id === button.dataset.cardId).label);
      if (button.dataset.sentenceAction === 'ending' && trial.ending) saySelection(endingWord(trial));
      if (button.dataset.sentenceAction === 'expression') saySelection(trial.expression);
    } catch (error) { toast(error.message); }
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
  if (action === 'teacher') return teacherGate();
  if (action === 'home') { screen = 'home'; render(); return; }
  if (action === 'new-card') return cardEditor();
  if (action === 'select' || action === 'reset') {
    if (pendingRecord) return recordDialog();
    try { trial = state.profile.phase >= 4 ? sentenceTransition(trial, action, null, state.cards) : transition(action === 'select' ? newTrial() : trial, action, button.dataset.cardId || state.profile.cardId); render(); if (action === 'select') saySelection(state.cards.find(c => c.id === trial.cardId).label); } catch (error) { toast(error.message); } return;
  }
  if (action === 'remove-image') { if (imageBusy) return; draftImage = null; updateCardPreview(); return; }
  run(async () => {
    if (action === 'delete-card') {
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
    if (form.id === 'learning-form') {
      next.profile = { alias: String(fields.get('alias')).trim(), cardId: fields.get('cardId'), phase: Number(fields.get('phase')), choiceIds: fields.getAll('choiceIds'), commentMode: fields.get('commentMode') };
      await persist(next); unlocked = false; screen = 'student'; trial = state.profile.phase >= 4 ? newSentenceTrial(state.profile.phase === 6 ? '' : undefined) : newTrial(); render();
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
  if (input.id === 'print-size') { printSize = Number(input.value); render(); return; }
  if (input.dataset.printCard) { const selected = new Set(printSelection ?? state.cards.map(c => c.id)); if (input.checked) selected.add(input.dataset.printCard); else selected.delete(input.dataset.printCard); printSelection = [...selected]; render(); return; }
  if (input.name === 'cardId' && screen === 'home') {
    const card = state.cards.find(c => c.id === input.value);
    if (card) document.querySelector('.sample-card').innerHTML = face(card);
  } else if (input.id === 'card-image') {
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
