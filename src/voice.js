// Reads the entry aloud with a voice whose pace and pitch come from the day's rules.
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

function pickVoice(lang) {
  const voices = speechSynthesis.getVoices();
  const prefix = lang === 'ru' ? 'ru' : 'en';
  return voices.find((voice) => voice.lang?.toLowerCase().startsWith(prefix) && voice.localService) ?? voices.find((voice) => voice.lang?.toLowerCase().startsWith(prefix)) ?? null;
}

export function speak(text, voice, lang, onEnd) {
  if (!canSpeak()) return null;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === 'ru' ? 'ru-RU' : 'en-US';
  const chosen = pickVoice(lang);
  if (chosen) utterance.voice = chosen;
  utterance.rate = voice.rate;
  utterance.pitch = voice.pitch;
  utterance.volume = 0.95;
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  speechSynthesis.speak(utterance);
  return () => speechSynthesis.cancel();
}
