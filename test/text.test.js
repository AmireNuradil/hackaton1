import assert from 'node:assert/strict';
import test from 'node:test';
import { folderName, readText, titleFor } from '../src/text.js';

const title = (text, date = '2026-10-12') => titleFor(readText(text, date));

test('titles follow one pattern of 3–7 words, like the brief examples', () => {
  assert.equal(title('Срочная сдача проекта, ночь в офисе, в наушниках электронная музыка.'), 'Ночь в офисе перед сдачей');
  assert.equal(title('Гуляли по парку, всё в жёлтых листьях, было холодно, но мы пили какао и долго разговаривали.'), 'Осенний день в парке и какао');
  assert.equal(title('Вечером гуляли с девушкой у пруда, листья падали в воду.'), 'Осенний вечер у пруда с девушкой');
  assert.equal(title('Утро на кухне с мамой. Пили чай.'), 'Утро на кухне с мамой');
  assert.equal(title('We walked by the sea at sunset with friends and laughed.'), 'Evening by the sea with friends');
  for (const text of ['Тихо.', 'Просто хороший день без особых событий и планов.', 'Ночь.']) {
    const words = title(text).split(/\s+/).length;
    assert.ok(words >= 3 && words <= 7, title(text));
  }
});

test('season comes into the title only when the entry names it', () => {
  assert.equal(title('Весь день на пляже с друзьями!', '2026-10-01'), 'День на пляже с друзьями');
  assert.equal(readText('Весь день на пляже с друзьями!', '2026-10-01').season, 'autumn');
});

test('mood axes separate calm, joyful, tense and heavy days', () => {
  const calm = readText('Тихий тёплый вечер, пили какао, было уютно и спокойно.');
  const joyful = readText('Смеялись весь день, танцевали, было весело и ярко!');
  const tense = readText('Дедлайн, срочно, нервы, паника и шум в офисе.');
  const heavy = readText('Было грустно и пусто, шёл дождь, я ехала одна.');
  assert.ok(calm.valence > 0 && calm.arousal < 0);
  assert.ok(joyful.valence > 0 && joyful.arousal > 0);
  assert.ok(tense.valence < 0 && tense.arousal > 0);
  assert.ok(heavy.valence < 0 && heavy.arousal < 0);
  assert.ok(readText('Помню, как в детстве мы ездили к бабушке.').nostalgia >= 0.5);
});

test('negation softens and flips a mood word', () => {
  assert.ok(readText('Было не грустно.').valence > 0);
  assert.ok(readText('Было грустно.').valence < 0);
});

test('words like "радио" do not count as joy', () => {
  assert.deepEqual(readText('Играло радио.').hits, []);
});

test('folder names are safe on every file system', () => {
  assert.equal(folderName('2026-11-03', 'Ночь: в офисе / перед "сдачей"?'), '2026-11-03 Ночь в офисе перед сдачей');
});
