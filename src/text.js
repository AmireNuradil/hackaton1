// Reads a diary entry: mood (valence × arousal), season, time of day, place, people, details.
// Everything is rule-based so every effect on the page can be traced back to a word.

const RU = /\p{Script=Cyrillic}/u;

// [stem, valence -2..2, arousal -2..2, nostalgia 0..2]
const LEXICON = [
  // calm & warm
  ['тепл', 1, -0.4], ['тёпл', 1, -0.4], ['уют', 1.5, -1.2], ['тих', 0.3, -1.6], ['тиш', 0.3, -1.6], ['спокой', 1, -1.6],
  ['мягк', 0.8, -1], ['нежн', 1.2, -0.8], ['обня', 1.5, -0.2], ['любл', 1.5, 0.2], ['любов', 1.5, 0.2], ['какао', 0.9, -0.9],
  ['кофе', 0.5, -0.3], ['чай', 0.6, -0.8], ['разговар', 0.6, -0.4], ['улыб', 1.2, 0.3], ['солн', 1, 0.4], ['закат', 0.8, -0.6],
  ['плед', 1, -1.2], ['свеч', 0.8, -1], ['медлен', 0.2, -1.4], ['долго', 0.2, -0.6], ['дом', 0.6, -0.6], ['мам', 0.9, -0.3],
  ['красив', 1.2, 0], ['хорош', 1, 0], ['вкусн', 1, 0.1],
  // bright & lively
  ['смея', 1.5, 1.3], ['смех', 1.5, 1.3], ['хохот', 1.5, 1.5], ['весел', 1.5, 1.2], ['радост', 1.8, 1], ['рада', 1.2, 0.6], ['рады', 1.2, 0.6], ['радов', 1.2, 0.6],
  ['танц', 1.3, 1.6], ['праздн', 1.5, 1.2], ['счаст', 1.8, 0.8], ['восторг', 1.8, 1.6], ['бега', 0.2, 1.3], ['бежа', 0.2, 1.3],
  ['прыга', 0.8, 1.5], ['визж', 0.8, 1.6], ['друз', 0.9, 0.7], ['пляж', 1, 0.6], ['летн', 0.8, 0.5], ['лето', 0.8, 0.5], ['волн', 0.4, 0.8],
  ['ярк', 0.8, 1], ['концерт', 1, 1.6], ['фестивал', 1.2, 1.5], ['громк', 0, 1.3],
  // tense
  ['сроч', -0.8, 1.6], ['дедлайн', -0.8, 1.7], ['сдач', -0.5, 1.3], ['стресс', -1.5, 1.5], ['нерв', -1.2, 1.4], ['паник', -1.6, 1.8],
  ['злю', -1.5, 1.4], ['злост', -1.5, 1.4], ['ссор', -1.6, 1.4], ['крич', -1.2, 1.6], ['шум', -0.5, 1.2], ['гром', -0.4, 1.4],
  ['неон', 0, 1.1], ['спеш', -0.4, 1.3], ['торопи', -0.4, 1.3], ['опазд', -0.8, 1.3], ['офис', -0.4, 0.6], ['бессон', -1, 0.9],
  ['ноутбук', -0.2, 0.5], ['экран', -0.3, 0.5], ['презентац', -0.4, 1], ['экзамен', -0.8, 1.3], ['устал', -1, -0.3],
  // low & heavy
  ['груст', -1.5, -0.8], ['печал', -1.6, -0.8], ['скуч', -1, -0.6], ['одино', -1.3, -0.7], ['одна', -0.6, -0.6], ['один', -0.4, -0.4], ['одино', -1.3, -0.7],
  ['пуст', -0.8, -0.9], ['дожд', -0.4, -0.5], ['холод', -0.4, 0], ['тоск', -1.6, -0.6], ['прощ', -1, -0.3], ['слез', -1.6, 0.2],
  ['плак', -1.6, 0.2], ['серы', -0.5, -0.6], ['серо', -0.5, -0.6], ['серая', -0.5, -0.6], ['серое', -0.5, -0.6], ['туман', -0.2, -1.1], ['послед', -0.6, -0.2], ['уехал', -0.9, -0.1], ['уезжа', -0.9, 0],
  ['темн', -0.4, -0.3], ['тёмн', -0.4, -0.3], ['капл', -0.2, -0.6], ['молча', -0.5, -1], ['ждал', -0.4, -0.2], ['жаль', -1.2, -0.3],
  // memory
  ['помн', 0, -0.3, 1.2], ['вспомин', 0, -0.3, 1.4], ['вспомн', 0, -0.3, 1.4], ['детств', 0.6, -0.2, 1.8], ['снова', 0.2, 0, 0.8],
  ['когда-то', 0, -0.4, 1.5], ['давно', 0, -0.3, 0.9], ['бабушк', 0.8, -0.6, 1.2], ['дедушк', 0.8, -0.6, 1.2], ['старый', 0, -0.4, 1],
  ['старая', 0, -0.4, 1], ['школ', 0.2, 0.2, 1], ['альбом', 0.3, -0.5, 1.4], ['пластинк', 0.5, -0.4, 1.5], ['кассет', 0.4, -0.2, 1.6],
  ['как раньше', 0, -0.2, 1.4], ['впервые', 0.8, 0.4, 0.6], ['уже не', -0.6, -0.4, 1],
  // English
  ['warm', 1, -0.4], ['cozy', 1.5, -1.2], ['quiet', 0.3, -1.6], ['calm', 1, -1.6], ['soft', 0.8, -1], ['gentle', 1, -1],
  ['love', 1.5, 0.2], ['cocoa', 0.9, -0.9], ['coffee', 0.5, -0.3], ['tea', 0.6, -0.8], ['talk', 0.6, -0.4], ['smil', 1.2, 0.3],
  ['sun', 1, 0.4], ['sunset', 0.8, -0.6], ['slow', 0.2, -1.4], ['home', 0.6, -0.6], ['beautiful', 1.2, 0],
  ['laugh', 1.5, 1.3], ['fun', 1.5, 1.2], ['joy', 1.8, 1], ['happy', 1.6, 0.8], ['danc', 1.3, 1.6], ['party', 1.5, 1.4],
  ['ran', 0.2, 1.3], ['run', 0.2, 1.3], ['friends', 0.9, 0.7], ['beach', 1, 0.6], ['summer', 0.8, 0.5], ['bright', 0.8, 1],
  ['deadline', -0.8, 1.7], ['rush', -0.6, 1.5], ['stress', -1.5, 1.5], ['panic', -1.6, 1.8], ['angry', -1.5, 1.4], ['loud', -0.3, 1.3],
  ['neon', 0, 1.1], ['hurry', -0.4, 1.3], ['office', -0.4, 0.6], ['sleepless', -1, 0.9], ['tired', -1, -0.3],
  ['sad', -1.5, -0.8], ['lonely', -1.3, -0.7], ['alone', -0.8, -0.6], ['empty', -0.8, -0.9], ['rain', -0.4, -0.5], ['cold', -0.4, 0],
  ['miss', -1.2, -0.5], ['farewell', -1, -0.3], ['tears', -1.6, 0.2], ['cried', -1.6, 0.2], ['grey', -0.5, -0.6], ['gray', -0.5, -0.6],
  ['mist', -0.2, -1.1], ['fog', -0.2, -1.1], ['last', -0.6, -0.2], ['dark', -0.4, -0.3],
  ['remember', 0, -0.3, 1.2], ['childhood', 0.6, -0.2, 1.8], ['again', 0.2, 0, 0.8], ['grandma', 0.8, -0.6, 1.2], ['grandpa', 0.8, -0.6, 1.2],
  ['old', 0, -0.4, 0.9], ['vinyl', 0.5, -0.4, 1.5], ['used to', 0, -0.4, 1.4],
];

const SEASONS = [
  ['autumn', /^(осен|листопад|листь|листв|autumn|leaves)/u],
  ['winter', /^(зим|снег|снеж|мороз|ёлк|елк|winter|snow|frost)/u],
  ['spring', /^(весн|весен|цвет[уеё]|подсн|spring|blossom)/u],
  ['summer', /^(лет[оа]|летн|жар[аке]|summer)/u],
];

const TIMES = [
  ['night', /^(ноч|полноч|night|midnight)/u],
  ['evening', /^(вечер|закат|сумер|evening|dusk|sunset)/u],
  ['morning', /^(утр|рассвет|завтрак|morning|dawn|breakfast)/u],
  ['day', /^(днём|днем|обед|полдень|afternoon|noon)/u],
];

// stem → [Russian phrase, English phrase]
const PLACES = [
  [/^парк/, 'в парке', 'in the park'], [/^(мор|моря)/, 'у моря', 'by the sea'], [/^пляж/, 'на пляже', 'on the beach'],
  [/^берег/, 'на берегу', 'on the shore'], [/^офис/, 'в офисе', 'at the office'], [/^поезд/, 'в поезде', 'on the train'],
  [/^(перрон|вокзал|платформ)/, 'на перроне', 'on the platform'], [/^автобус/, 'в автобусе', 'on the bus'],
  [/^трамва/, 'в трамвае', 'on the tram'], [/^(лес|лесу)/, 'в лесу', 'in the woods'], [/^(город|улиц|проспект)/, 'в городе', 'in the city'],
  [/^кухн/, 'на кухне', 'in the kitchen'], [/^(кафе|кофейн)/, 'в кафе', 'at the café'], [/^пруд/, 'у пруда', 'by the pond'],
  [/^озер/, 'у озера', 'by the lake'], [/^гор[аыу]?$|^горах/, 'в горах', 'in the mountains'], [/^(крыш)/, 'на крыше', 'on the roof'],
  [/^дач/, 'на даче', 'at the dacha'], [/^(окн|окош)/, 'у окна', 'by the window'], [/^(сад|саду)$/, 'в саду', 'in the garden'],
  [/^(park)/, 'в парке', 'in the park'], [/^(sea|coast|ocean)/, 'у моря', 'by the sea'], [/^beach/, 'на пляже', 'on the beach'],
  [/^office/, 'в офисе', 'at the office'], [/^train/, 'в поезде', 'on the train'], [/^platform|^station/, 'на перроне', 'on the platform'],
  [/^bus/, 'в автобусе', 'on the bus'], [/^tram/, 'в трамвае', 'on the tram'], [/^(forest|woods)/, 'в лесу', 'in the woods'],
  [/^(city|street)/, 'в городе', 'in the city'], [/^kitchen/, 'на кухне', 'in the kitchen'], [/^(cafe|café)/, 'в кафе', 'at the café'],
  [/^lake/, 'у озера', 'by the lake'], [/^window/, 'у окна', 'by the window'],
];

const PEOPLE = [
  [/^подруг/, 'с подругой', 'with a friend'], [/^друз/, 'с друзьями', 'with friends'], [/^друг(ом|а)?$/, 'с другом', 'with a friend'],
  [/^(мам|мать|матер)/, 'с мамой', 'with mom'], [/^(пап|отц|отец)/, 'с папой', 'with dad'], [/^сестр/, 'с сестрой', 'with my sister'],
  [/^брат/, 'с братом', 'with my brother'], [/^девушк/, 'с девушкой', 'with my girlfriend'], [/^(парн|парень)/, 'с парнем', 'with my boyfriend'],
  [/^семь/, 'с семьёй', 'with family'], [/^бабушк/, 'с бабушкой', 'with grandma'], [/^дедушк/, 'с дедушкой', 'with grandpa'],
  [/^коллег/, 'с коллегами', 'with colleagues'], [/^(сын|сыном)$/, 'с сыном', 'with my son'], [/^доч/, 'с дочкой', 'with my daughter'],
  [/^собак/, 'с собакой', 'with the dog'], [/^(команд)/, 'с командой', 'with the team'],
  [/^friends$/, 'с друзьями', 'with friends'], [/^friend$/, 'с другом', 'with a friend'], [/^(mom|mum|mother)/, 'с мамой', 'with mom'],
  [/^(dad|father)/, 'с папой', 'with dad'], [/^sister/, 'с сестрой', 'with my sister'], [/^girlfriend/, 'с девушкой', 'with my girlfriend'],
  [/^team/, 'с командой', 'with the team'], [/^(grandma|grandmother)/, 'с бабушкой', 'with grandma'], [/^(grandpa|grandfather)/, 'с дедушкой', 'with grandpa'],
];

const DETAILS = [
  [/^какао/, 'и какао', 'and cocoa'], [/^коф/, 'и кофе', 'and coffee'], [/^ча[йя]$|^чаем$/, 'и чай', 'and tea'],
  [/^дожд/, 'под дождём', 'in the rain'], [/^(снег|снеж)/, 'под снегом', 'in the snow'], [/^(дедлайн|сдач)/, 'перед сдачей', 'before the deadline'],
  [/^туман/, 'в тумане', 'in the mist'], [/^(закат)/, 'на закате', 'at sunset'], [/^(звёзд|звезд)/, 'под звёздами', 'under the stars'],
  [/^(прощ)/, 'на прощание', 'saying goodbye'], [/^(неон)/, 'в неоне', 'in neon'],
  [/^cocoa/, 'и какао', 'and cocoa'], [/^coffee/, 'и кофе', 'and coffee'], [/^tea$/, 'и чай', 'and tea'], [/^rain/, 'под дождём', 'in the rain'],
  [/^snow/, 'под снегом', 'in the snow'], [/^deadline/, 'перед сдачей', 'before the deadline'], [/^(mist|fog)/, 'в тумане', 'in the mist'],
  [/^sunset/, 'на закате', 'at sunset'], [/^neon/, 'в неоне', 'in neon'],
];

const HEAD = {
  ru: { morning: ['Утро', 'n'], day: ['День', 'm'], evening: ['Вечер', 'm'], night: ['Ночь', 'f'] },
  en: { morning: 'morning', day: 'day', evening: 'evening', night: 'night' },
};
const SEASON_ADJ = {
  autumn: { m: 'Осенний', f: 'Осенняя', n: 'Осеннее', en: 'Autumn' },
  winter: { m: 'Зимний', f: 'Зимняя', n: 'Зимнее', en: 'Winter' },
  spring: { m: 'Весенний', f: 'Весенняя', n: 'Весеннее', en: 'Spring' },
  summer: { m: 'Летний', f: 'Летняя', n: 'Летнее', en: 'Summer' },
};
export const SEASON_NAMES = { autumn: 'осень', winter: 'зима', spring: 'весна', summer: 'лето' };
export const TIME_NAMES = { morning: 'утро', day: 'день', evening: 'вечер', night: 'ночь' };

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function tokenize(text) {
  return (text.toLocaleLowerCase('ru').replaceAll('ё', 'е').match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) ?? []);
}

export function sentences(text) {
  return (text.match(/[^.!?…\n]+[.!?…]*/gu) ?? []).map((part) => part.trim()).filter((part) => part.length > 1);
}

function seasonFromDate(date) {
  const month = Number(String(date ?? '').slice(5, 7));
  if (!month) return null;
  return ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][month - 1];
}

function firstMatch(tokens, table) {
  for (const token of tokens) for (const entry of table) if (entry[0].test(token)) return entry;
  return null;
}

function firstLabel(tokens, table) {
  for (const token of tokens) for (const [name, pattern] of table) if (pattern.test(token)) return name;
  return null;
}

export function readText(text, date) {
  const lang = RU.test(text) ? 'ru' : 'en';
  const lower = text.toLocaleLowerCase('ru').replaceAll('ё', 'е');
  const tokens = tokenize(text);
  const hits = [];
  let valence = 0;
  let arousal = 0;
  let nostalgia = 0;
  tokens.forEach((token, index) => {
    for (const [stem, v, a, n = 0] of LEXICON) {
      if (stem.includes(' ')) continue;
      if (!token.startsWith(stem.replaceAll('ё', 'е'))) continue;
      const negated = ['не', 'not', "don't", 'never', 'ни'].includes(tokens[index - 1]);
      const sign = negated ? -0.6 : 1;
      valence += v * sign;
      arousal += a;
      nostalgia += n;
      hits.push({ word: token, valence: v * sign, arousal: a });
      break;
    }
  });
  for (const [stem, v, a, n = 0] of LEXICON) {
    if (stem.includes(' ') && lower.includes(stem)) {
      valence += v; arousal += a; nostalgia += n;
      hits.push({ word: stem, valence: v, arousal: a });
    }
  }
  const weight = Math.sqrt(hits.length + 1);
  const exclamations = (text.match(/!/g) ?? []).length;
  const season = firstLabel(tokens, SEASONS);
  return {
    lang,
    valence: Number(clamp(valence / weight / 1.6, -1, 1).toFixed(3)),
    arousal: Number(clamp((arousal + exclamations * 0.6) / weight / 1.6, -1, 1).toFixed(3)),
    nostalgia: Number(clamp(nostalgia / 2.4, 0, 1).toFixed(3)),
    season: season ?? seasonFromDate(date),
    seasonFromText: Boolean(season),
    time: firstLabel(tokens, TIMES),
    place: firstMatch(tokens, PLACES),
    people: firstMatch(tokens, PEOPLE),
    detail: firstMatch(tokens, DETAILS),
    hits: hits.sort((a, b) => Math.abs(b.valence) + Math.abs(b.arousal) - Math.abs(a.valence) - Math.abs(a.arousal)).slice(0, 6).map((hit) => hit.word),
    sentences: sentences(text),
    words: tokens.length,
  };
}

const capital = (value) => value ? value[0].toLocaleUpperCase('ru') + value.slice(1) : value;
const wordCount = (value) => value.split(/\s+/).filter(Boolean).length;

function fallbackTitle(reading, lang) {
  const first = reading.sentences.find((part) => tokenize(part).length >= 3) ?? reading.sentences[0] ?? '';
  const parts = first.replace(/[.!?…,;:]+$/u, '').split(/\s+/).filter(Boolean).slice(0, 6);
  while (parts.length > 3 && /^(и|в|на|с|у|к|а|но|the|a|and|of|to|in)$/iu.test(parts.at(-1))) parts.pop();
  if (parts.length >= 3) return capital(parts.join(' '));
  return lang === 'ru' ? 'День, который хочется помнить' : 'A day worth remembering';
}

// Titles follow one pattern: [season] time-of-day + place + company + detail, 3–7 words.
export function titleFor(reading) {
  const ru = reading.lang === 'ru';
  const pieces = [];
  const time = reading.time ?? (reading.place || reading.people ? 'day' : null);
  if (time) {
    if (ru) {
      const [noun, gender] = HEAD.ru[time];
      pieces.push(reading.seasonFromText ? `${SEASON_ADJ[reading.season][gender]} ${noun.toLowerCase()}` : noun);
    } else {
      pieces.push(reading.seasonFromText ? `${SEASON_ADJ[reading.season].en} ${HEAD.en[time]}` : capital(HEAD.en[time]));
    }
  }
  const pick = (entry) => entry && (ru ? entry[1] : entry[2]);
  for (const part of [pick(reading.place), pick(reading.people), pick(reading.detail)]) {
    if (!part) continue;
    // "…с мамой и чай" reads oddly: a companion already carries the scene, so skip "и <object>".
    if (reading.people && /^(и|and) /.test(part)) continue;
    if (wordCount([...pieces, part].join(' ')) > 7) break;
    pieces.push(part);
  }
  const title = pieces.join(' ');
  // "Осенний вечер" alone is too thin: use the entry's own first phrase instead of guessing a place.
  return wordCount(title) < 3 ? fallbackTitle(reading, reading.lang) : capital(title);
}

export function folderName(date, title) {
  return `${date} ${title}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
}
