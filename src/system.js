// The visual system: explicit rules that turn the day's text, photos and song into one diary page.
import { GENRES } from './music.js';
import { hslToRgb, rgbToHsl } from './photo.js';
import { SEASON_NAMES, TIME_NAMES, titleFor } from './text.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, digits = 2) => Number(value.toFixed(digits));
const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);

export const TECHNIQUES = {
  monet: {
    name: 'Импрессионизм', short: 'Мазки и свет',
    mood: 'спокойный, тёплый день',
    references: 'Клод Моне — «Впечатление. Восходящее солнце», серия «Стога»; Камиль Писсарро',
    why: 'Короткие мазки складываются в форму медленно, глаз сам смешивает цвет — время на странице замедляется, как в тихий вечер.',
    voice: 'тихий и тёплый',
  },
  seurat: {
    name: 'Пуантилизм', short: 'Цветные точки',
    mood: 'яркий, живой, радостный день',
    references: 'Жорж Сёра — «Воскресный день на острове Гранд-Жатт»; Поль Синьяк',
    why: 'Чистые точки цвета мерцают и пульсируют в такт песне — так ощущается день, в котором много движения и смеха.',
    voice: 'живой и быстрый',
  },
  kandinsky: {
    name: 'Геометрическая абстракция', short: 'Линии и круги',
    mood: 'напряжённый, быстрый, собранный день',
    references: 'Василий Кандинский — «Композиция VIII», «Жёлтое — красное — синее»; конструктивизм, Эль Лисицкий',
    why: 'Жёсткая сетка, резкие линии и круги, которые перескакивают на сильную долю, передают ритм дедлайна и холодную собранность.',
    voice: 'ровный и собранный',
  },
  ma: {
    name: 'Ма — японская пустота', short: 'Тушь и воздух',
    mood: 'тихий, пасмурный, грустный день',
    references: 'Хасэгава Тохаку — «Сосны в тумане»; суми-э, дзенский круг энсо, японская минималистичная графика',
    why: 'Фото уходит в небольшое окно, вокруг много пустой бумаги и туши: тишина и одиночество становятся видимым пространством.',
    voice: 'медленный и приглушённый',
  },
  film: {
    name: 'Любительская плёнка', short: 'Зерно и засветка',
    mood: 'день-воспоминание, ностальгия, старая песня',
    references: 'Цветная любительская плёнка 1970–80-х; Уильям Эгглстон, Стивен Шор; фотоальбомы семьи',
    why: 'Зерно, выцветший цвет, ореол вокруг света и засветки по краю кадра — так выглядят воспоминания, которые уже стали фотографиями.',
    voice: 'негромкий, как будто вспоминаешь',
  },
};

export const CONSTANTS = [
  'Формат страницы 4:5, поля и сетка из 12 колонок одни и те же для всех дней',
  'Дата и номер дня — в верхней строке, название — Cormorant Garamond под кадром',
  'Подпись строками из записи — рукописным Caveat, поверх нижнего края кадра',
  'Строка песни внизу страницы и линия прогресса по ритму',
  'Бумага одного оттенка с лёгким зерном, фото всегда в окне сетки',
];

function shiftHue(hue, target, amount) {
  const delta = ((target - hue + 540) % 360) - 180;
  return hue + delta * amount;
}

function tempoArousal(bpm) {
  return bpm == null ? 0 : clamp((bpm - 95) / 45, -1, 1);
}

export function moodOf({ reading, photo, music }) {
  const modeSign = music.mode === 'major' ? 1 : music.mode === 'minor' ? -1 : 0;
  const modeValence = modeSign * (0.4 + 0.6 * (music.keyConfidence ?? 0));
  const photoValence = clamp(photo.warmth * 0.6 + (photo.light - 0.45) * 1.2, -1, 1) * 0.5;
  const genre = GENRES[music.genre];
  const musicArousal = clamp(tempoArousal(music.bpm) * 0.55 + (music.energy - 0.4) * 1.6 * 0.45, -1, 1);
  // Pace is mostly heard: tempo and energy carry 65% of it, the words of the entry 35%.
  const textWeight = reading.hits.length ? 0.35 : 0.15;
  const valence = clamp(0.55 * reading.valence + 0.3 * modeValence + 0.15 * photoValence + 0.1 * (genre?.warmth ?? 0), -1, 1);
  const arousal = clamp(textWeight * reading.arousal + (1 - textWeight) * musicArousal, -1, 1);
  const era = music.year ? clamp((2026 - music.year - 15) / 35, 0, 1) : 0;
  const nostalgia = clamp(Math.max(reading.nostalgia, era * 0.8) + (genre?.texture === 'grain' ? 0.1 : 0), 0, 1);
  return { valence: round(valence), arousal: round(arousal), nostalgia: round(nostalgia), musicArousal: round(musicArousal), modeValence: round(modeValence), era: round(era) };
}

export function techniqueFor(mood) {
  if (mood.nostalgia >= 0.5) return 'film';
  if (mood.arousal >= 0.12) return mood.valence >= 0 ? 'seurat' : 'kandinsky';
  return mood.valence >= 0.05 ? 'monet' : 'ma';
}

// Temperature is graded like a photo filter (blend toward a warm or cool light), so hues stay true to the photos.
function paletteFor(photo, mood, technique, music) {
  const minor = music.mode === 'minor';
  const light = mood.valence >= 0 ? [255, 176, 96] : [92, 128, 196];
  return photo.palette.map((rgb) => {
    const graded = rgb.map((v, i) => v + (light[i] - v) * Math.abs(mood.valence) * 0.2);
    let [h, s, l] = rgbToHsl(graded.map(Math.round));
    s *= (0.82 + 0.35 * clamp(mood.arousal + 0.3, 0, 1)) * (minor ? 0.82 : 1);
    if (technique === 'ma') { s *= 0.4; l = lerp(l, 0.74, 0.3); }
    if (technique === 'kandinsky') { s = lerp(s, 0.5, 0.25); h = shiftHue(h, 215, 0.15); }
    if (technique === 'seurat') s = lerp(s, 0.7, 0.25);
    if (technique === 'film') { h = shiftHue(h, 38, 0.1); s *= 0.85; }
    return hslToRgb([h, clamp(s, 0, 1), clamp(l, 0.06, 0.94)]);
  });
}

const accentFor = (technique, mood) => ({
  monet: [205, 112, 64], seurat: [222, 74, 61], kandinsky: [38, 64, 160], ma: [176, 42, 36], film: [196, 118, 52],
})[technique].map((v, i) => Math.round(v * (1 - 0.08 * Math.max(0, -mood.valence)) + (i === 2 ? 6 : 0)));

export function composeDay({ text, date, reading, photo, music, photoCount }) {
  const mood = moodOf({ reading, photo, music });
  const technique = techniqueFor(mood);
  const bpm = music.bpm ?? 80;
  const beat = 60 / bpm;
  const beatsPerScene = mood.arousal < -0.3 ? 16 : mood.arousal < 0.1 ? 12 : mood.arousal < 0.45 ? 8 : 4;
  // A short opening sentence usually works as a headline; the handwritten lines continue from the next one.
  const lines = reading.sentences.length > 1 && reading.sentences[0].split(/\s+/).length <= 8 ? reading.sentences.slice(1) : reading.sentences;
  const captions = (lines.length ? lines : [text.trim()]).slice(0, 6)
    .map((line) => (Array.from(line).length > 110 ? `${Array.from(line).slice(0, 108).join('').trimEnd()}…` : line));
  const minimumScenes = Math.max(3, photoCount, captions.length);
  // Frames last a whole number of beats: the phrase length nearest to the mood's, 2.2–9 s per frame, with
  // every photo and line fitting into 45 s. A lively song then gets more, shorter shots rather than
  // stretched frames: photos return with new crops until the page lasts at least 15 s.
  const fits = (beats) => beats * beat >= 2.2 && beats * beat <= 9 && minimumScenes * beats * beat <= 45;
  const phrase = [2, 4, 6, 8, 12, 16, 24, 32].filter(fits).sort((a, b) => Math.abs(a - beatsPerScene) - Math.abs(b - beatsPerScene))[0];
  const sceneSeconds = phrase ? phrase * beat : clamp(clamp(beatsPerScene * beat, 2.2, 9), 0, 45 / minimumScenes);
  const scenes = Math.max(minimumScenes, Math.min(Math.ceil(15 / sceneSeconds), Math.floor(45 / sceneSeconds)));
  const transition = technique === 'kandinsky' ? 90 : Math.round(lerp(1900, 260, (mood.arousal + 1) / 2));
  const energy = music.energy;
  const design = {
    version: 1,
    title: titleFor(reading),
    captions,
    technique,
    mood,
    palette: paletteFor(photo, mood, technique, music),
    accent: accentFor(technique, mood),
    rhythm: {
      bpm: music.bpm, beat: round(beat, 3), beatsPerScene: phrase ?? beatsPerScene, scenes,
      sceneSeconds: round(sceneSeconds), seconds: round(scenes * sceneSeconds, 1), transition,
    },
    motion: { zoom: round(1.03 + 0.13 * (mood.arousal + 1) / 2, 3), pulse: round(clamp(energy * 1.2, 0.1, 1)), drift: round(lerp(1, 0.35, (mood.arousal + 1) / 2)) },
    texture: {
      grain: round(clamp(0.12 + 0.62 * mood.nostalgia + (GENRES[music.genre]?.texture === 'grain' ? 0.1 : 0), 0, 0.9)),
      stroke: round(7 + 20 * energy, 1),
      dot: round(clamp(7 - 3.5 * (mood.arousal + 1) / 2, 2.5, 7), 1),
      shapes: Math.round(5 + 9 * energy),
      air: round(technique === 'ma' ? lerp(0.62, 0.48, (mood.arousal + 1) / 2) : 0),
      sepia: round(technique === 'film' ? 0.25 + 0.5 * mood.era : 0),
    },
    type: { weight: Math.round(lerp(380, 640, (mood.arousal + 1) / 2)), italic: mood.valence > 0.1 && mood.arousal < 0 },
    voice: {
      rate: round(lerp(0.82, 1.14, (mood.arousal + 1) / 2)),
      pitch: round(clamp(1 + 0.18 * mood.valence - 0.08 * mood.nostalgia, 0.8, 1.2)),
      label: TECHNIQUES[technique].voice,
    },
  };
  design.reasons = explain({ reading, photo, music, design, date });
  return design;
}

const pct = (value) => `${Math.round(value * 100)}%`;
const beatsLabel = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'доля' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'доли' : 'долей'}`;
const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

function explain({ reading, photo, music, design }) {
  const { mood, technique, rhythm, texture } = design;
  const tone = mood.valence > 0.15 ? 'тёплая' : mood.valence < -0.15 ? 'холодная' : 'нейтральная';
  const tempo = rhythm.sceneSeconds < 4.5 ? 'быстрый' : rhythm.sceneSeconds < 7 ? 'спокойный' : 'медленный';
  // Wording follows the exact thresholds techniqueFor() uses, so the explanation never contradicts the page.
  const active = mood.arousal >= 0.12;
  const bright = active ? mood.valence >= 0 : mood.valence >= 0.05;
  const near = Math.abs(mood.valence) < 0.15 ? 'скорее ' : '';
  const where = [reading.time && TIME_NAMES[reading.time], reading.season && SEASON_NAMES[reading.season]].filter(Boolean).join(', ');
  const reasons = [
    {
      input: 'Текст',
      cause: reading.hits.length ? `Слова «${reading.hits.slice(0, 4).join('», «')}»${where ? `; ${where}` : ''}` : 'В записи мало слов-настроений',
      effect: `${tone[0].toUpperCase() + tone.slice(1)} окраска (${mood.valence >= 0 ? '+' : ''}${mood.valence}), название «${design.title}»`,
    },
    {
      input: 'Фото',
      cause: `${photo.count} ${photo.count === 1 ? 'кадр' : photo.count < 5 ? 'кадра' : 'кадров'}, свет ${pct(photo.light)}, главный цвет ${hex(photo.palette[0])}`,
      effect: `Палитра страницы собрана из цветов снимков и сдвинута к ${mood.valence >= 0 ? 'охре' : 'синему'}`,
    },
    {
      input: 'Музыка',
      cause: [
        music.bpm ? `${music.bpm} BPM` : 'ритм не найден',
        `энергия ${pct(music.energy)}`,
        music.mode ? (music.key ?? (music.mode === 'major' ? 'мажор' : 'минор')) : 'лад не определён',
        music.genre ? GENRES[music.genre].label.toLowerCase() : null,
        music.year ? `${music.year} г.` : null,
      ].filter(Boolean).join(' · '),
      effect: `${tempo[0].toUpperCase() + tempo.slice(1)} ритм: ${rhythm.sceneSeconds} с на кадр${music.bpm ? ` (${beatsLabel(rhythm.beatsPerScene)})` : ', без привязки к долям'}, ${rhythm.transition < 200 ? 'резкая склейка' : `растворение ${rhythm.transition} мс`}${music.mode === 'minor' ? ', приглушённый цвет' : music.mode === 'major' ? ', открытый свет' : ''}`,
    },
    {
      input: 'Приём',
      cause: mood.nostalgia >= 0.5
        ? `Ностальгия ${pct(mood.nostalgia)} — она важнее остальных осей`
        : `Настроение ${near}${bright ? 'светлое' : 'тёмное'} (${mood.valence >= 0 ? '+' : ''}${mood.valence}) и ${active ? 'подвижное' : 'тихое'} (${mood.arousal >= 0 ? '+' : ''}${mood.arousal})`,
      effect: `${TECHNIQUES[technique].name}: ${TECHNIQUES[technique].why}`,
    },
  ];
  if (texture.grain > 0.4) reasons.push({ input: 'Фактура', cause: music.year ? `Песня ${music.year} года, воспоминания в тексте` : 'Воспоминания в тексте', effect: `Плёночное зерно ${pct(texture.grain)}` });
  reasons.push({ input: 'Голос', cause: `Ритм ${tempo}, окраска ${tone}`, effect: `Озвучка «${design.voice.label}»: скорость ${design.voice.rate}, высота ${design.voice.pitch}` });
  return reasons;
}
