export const moods = {
  still: { label: 'Still', tone: [39, 12, 22], highlights: [248, 207, 152], motion: 'drift', motif: 'soft edge and a long dissolve' },
  buoyant: { label: 'Buoyant', tone: [87, 39, 29], highlights: [255, 208, 132], motion: 'lift', motif: 'open space and an upward pan' },
  electric: { label: 'Electric', tone: [22, 20, 43], highlights: [253, 163, 145], motion: 'pulse', motif: 'tight framing and a sharper pulse' },
  wistful: { label: 'Wistful', tone: [27, 41, 60], highlights: [185, 206, 212], motion: 'recede', motif: 'cool shadows and a slow pullback' },
};

const words = (text) => text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
const prefix = /^(?:today|tonight|this (?:morning|evening|afternoon)|we|i|сегодня|вечером|утром|мы|я)[,\s]+/iu;
const shortWords = new Set('a an the and of to at in on was were it by i we with и в на с у за к о я мы это'.split(' '));
const signals = {
  still: /^(calm|quiet|slow|soft|whisper|peace|mist|still|coffee|gentl|тиш|спокой|медлен|мягк|туман|кофе)/iu,
  buoyant: /^(laugh|gold|sun|warm|happ|joy|danc|summer|bright|smil|тепл|тёпл|сме|смех|солн|радост|золот)/iu,
  electric: /^(rush|neon|crowd|deadlin|loud|rush|thunder|run|fast|hurry|сроч|дедлайн|неон|гром|беж|шум)/iu,
  wistful: /^(long|miss|memor|fadin|rain|last|alone|farewell|empty|old|dusk|скуч|помн|дожд|послед|один|прощ|пуст|сумер)/iu,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const positions = ['50% 50%', '44% 53%', '57% 47%'];

export function framing(index, motion) {
  return {
    position: positions[index % positions.length],
    motion: index > 0 && index % 2 === 0 && motion !== 'pulse' ? 'recede' : motion,
  };
}

export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function dateLabel(date, options) {
  return new Intl.DateTimeFormat('en', { timeZone: 'UTC', ...options }).format(new Date(`${date}T12:00:00Z`));
}

function sourcePhrase(text) {
  const phrases = text.split(/[.!?…;:\n]+/u).map((phrase) => phrase.trim()).filter(Boolean);
  return phrases.find((phrase) => words(phrase.replace(prefix, '')).length >= 3) ?? phrases[0] ?? '';
}

export function titleFrom(text) {
  const phrase = sourcePhrase(text).replace(prefix, '');
  const title = words(phrase).slice(0, 7).map((word) => Array.from(word).slice(0, 24).join(''));
  while (title.length > 3 && shortWords.has(title.at(-1).toLowerCase())) title.pop();
  if (title.length < 3) {
    const russian = /\p{Script=Cyrillic}/u.test(phrase);
    const partial = title.join(' ');
    return partial ? `${russian ? 'День про' : 'A day with'} ${partial}` : 'A day to remember';
  }
  const joined = title.join(' ');
  return joined[0].toLocaleUpperCase() + joined.slice(1);
}

function blend(first, second, fraction) {
  return first.map((value, index) => Math.round(value * (1 - fraction) + second[index] * fraction));
}

function captionsFrom(text) {
  const lines = text.match(/[^.!?…\n]+[.!?…]*/gu)?.map((line) => line.trim()).filter(Boolean) ?? [];
  const source = lines.length > 1 && words(lines[0]).length <= 8 ? lines.slice(1) : lines;
  return (source.length ? source : [text.trim()]).slice(0, 6).map((line) => {
    const characters = Array.from(line);
    return characters.length > 126 ? `${characters.slice(0, 125).join('').trimEnd()}…` : line;
  });
}

export function compose({ text, photo, music, photoCount }) {
  const tokens = words(text);
  const scores = Object.fromEntries(Object.entries(signals).map(([kind, pattern]) => [kind, tokens.filter((word) => pattern.test(word)).length]));
  const mood = Object.keys(scores).reduce((best, candidate) => scores[candidate] > scores[best] ? candidate : best, 'still');
  const treatment = moods[mood];
  const tempo = music.bpm == null ? 86 : clamp(music.bpm, 50, 170);
  const energy = clamp(music.energy, 0, 1);
  const intensity = 0.58 * (tempo - 50) / 120 + 0.42 * energy;
  const crossfade = Math.round(170 + (1 - intensity) * 1260);
  const beatWindow = 60 / tempo * (intensity > 0.62 ? 4 : 8);
  const dwell = Number(clamp(beatWindow, 2.3, 8.4).toFixed(2));
  const captions = captionsFrom(text);
  const shotCount = Math.max(3, photoCount, captions.length);
  const seconds = Math.round(clamp(shotCount * dwell, 15, 42));
  const accent = blend(photo.color, treatment.highlights, 0.42 + energy * 0.16);
  const shadow = blend(treatment.tone, photo.color, 0.12);
  const motion = intensity > 0.7 ? 'pulse' : treatment.motion;
  const brightness = Number(clamp(0.91 + (0.53 - photo.light) * 0.24 + energy * 0.09, 0.86, 1.12).toFixed(2));

  return {
    title: titleFrom(text), phrase: captions[0], captions,
    mood, motion, accent, shadow,
    crossfade, dwell, seconds, shotCount, brightness,
    zoom: Number((1.04 + intensity * 0.19).toFixed(2)),
    saturation: Number((0.72 + energy * 0.47).toFixed(2)),
    textCue: tokens.find((word) => signals[mood].test(word)) ?? null,
  };
}

export function safeLink(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use a public HTTPS link for your song.');
  return url.href;
}
