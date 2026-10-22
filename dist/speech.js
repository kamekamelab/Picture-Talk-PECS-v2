// localServiceが明示的にtrueの日本語音声だけを使用する。
// 既定音声へのフォールバックは外部音声サービスを使う可能性があるため行わない。
export function localJapaneseVoice(voices) {
  return voices.find(v => v.localService === true && /^ja(?:[-_]|$)/i.test(v.lang) && v.default)
    || voices.find(v => v.localService === true && /^ja(?:[-_]|$)/i.test(v.lang))
    || null;
}
export function speechText(words) {
  if (!Array.isArray(words) || !words.length || words.some(w => typeof w !== 'string' || !w.trim())) throw new Error('よみあげるカードを選んでください。');
  return words.map(w => w.trim()).join('、') + '。';
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
  function read(words) {
    const text = speechText(words);
    if (!synth || !Utterance) throw new Error('このブラウザーでは読み上げを利用できません。');
    const voice = localJapaneseVoice(synth.getVoices());
    if (!voice) throw new Error('端末内の日本語音声が見つかりません。音声の準備後にもう一度押してください。先生用の設定でも確認できます。');
    stop();
    const current = generation;
    const utterance = new Utterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = .85;
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
