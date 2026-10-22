// localServiceが明示的にtrueの日本語音声だけを使用する。
// 既定音声へのフォールバックは外部音声サービスを使う可能性があるため行わない。
export function localJapaneseVoices(voices) {
  return voices.filter(v => v.localService === true && /^ja(?:[-_]|$)/i.test(v.lang));
}
export function localJapaneseVoice(voices, preferredURI = '') {
  const local = localJapaneseVoices(voices);
  return local.find(v => preferredURI && v.voiceURI === preferredURI)
    || local.find(v => v.default)
    || local[0]
    || null;
}
export function speechText(words) {
  if (!Array.isArray(words) || !words.length || words.some(w => typeof w !== 'string' || !w.trim())) throw new Error('よみあげるカードを選んでください。');
  // カード間の強制的な休止を除き、音声エンジンに文全体の韻律を任せる。
  // 助詞や語尾の自動補完はしない。例：「まって」「ください」もそのままつなぐ。
  return words.map(w => w.trim()).join('').replace(/。+$/, '') + '。';
}
export function createReader({ synth, Utterance, onState = () => {}, onError = () => {} }) {
  let active = null;
  let generation = 0;
  function stop() {
    generation++;
    const wasActive = active !== null;
    active = null;
    if (wasActive) synth?.cancel();
    onState(false);
  }
  function read(words, { voiceURI = '', rate = 1 } = {}) {
    const text = speechText(words);
    if (!synth || !Utterance) throw new Error('このブラウザーでは読み上げを利用できません。');
    if (![.85, 1, 1.1].includes(rate)) throw new Error('読み上げの速さを選び直してください。');
    const voice = localJapaneseVoice(synth.getVoices(), voiceURI);
    if (!voice) throw new Error('端末内の日本語音声が見つかりません。音声の準備後にもう一度押してください。先生用の設定でも確認できます。');
    stop();
    const current = generation;
    const utterance = new Utterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.volume = 1;
    active = utterance; // 一部の端末で再生中のオブジェクトが破棄されないよう保持。
    utterance.onend = () => {
      if (current !== generation) return;
      active = null;
      onState(false, 'finished');
    };
    utterance.onerror = event => {
      if (current !== generation) return;
      active = null;
      onState(false);
      if (!['canceled', 'interrupted'].includes(event.error)) onError('読み上げができませんでした。音量と端末の日本語音声を確認してください。');
    };
    onState(true);
    try { synth.speak(utterance); }
    catch (error) { stop(); throw error; }
  }
  return { read, stop, get reading() { return active !== null; } };
}
