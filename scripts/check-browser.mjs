// End-to-end check in Chromium: samples, creating days from a file and a link, playback, the day folder
// with video, the standalone player, reload persistence and the phone layout.
// Usage: npm run build && npm run preview  (in one terminal), then:  node scripts/check-browser.mjs [url]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { strFromU8, unzipSync } from 'fflate';

// Playwright is not a project dependency: use the copy installed with your browser tooling (npm i -g playwright).
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SAMPLES = join(ROOT, 'public', 'samples');
const BASE = process.argv[2] ?? 'http://127.0.0.1:4173/';
const STORY = 'Вечером ехала домой одна в последнем автобусе под дождём. Капли стекали по стеклу. На пустом сиденье напротив дрожал тёплый свет.';
const EXPECTED = {
  'Утро на кухне с мамой': 'Мазки и свет', 'Ночь в офисе перед сдачей': 'Линии и круги', 'Вечер в автобусе под дождём': 'Тушь и воздух',
  'Ночь на перроне с братом': 'Зерно и засветка', 'Вечер у моря с подругой': 'Мазки и свет', 'Летний день на пляже с друзьями': 'Цветные точки',
};

function serve(files) {
  const types = { '.html': 'text/html; charset=utf-8', '.webm': 'video/webm', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg' };
  const server = createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/^\/+/, '');
    if (!files[name]) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': types[extname(name)] ?? 'application/octet-stream' }).end(Buffer.from(files[name]));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function frameSeconds(page) {
  const text = await page.locator('#viewer-reasons').innerText();
  return Number(text.match(/([\d.]+) с на кадр/)[1]);
}

async function createDay(page, { music }) {
  await page.getByRole('button', { name: 'Записать день' }).first().click();
  await page.getByLabel('Как прошёл день?').fill(STORY);
  await page.locator('#day-photos').setInputFiles(join(SAMPLES, 'last-bus.webp'));
  if (music.file) {
    await page.locator('#song-file').setInputFiles(join(SAMPLES, music.file));
    // The editor reads the entry live: folder name, mood words and the measured song before saving.
    await page.locator('#live-music').filter({ hasText: 'BPM' }).waitFor({ timeout: 20000 });
    assert.match(await page.locator('#live-folder').innerText(), /Вечер в автобусе под дождём$/);
    assert.match(await page.locator('#live-text').innerText(), /«/);
    assert.equal(await page.locator('#live-photo .swatch').count() > 0, true);
  } else {
    await page.getByRole('radio', { name: 'Ссылка' }).check();
    await page.getByLabel('Ссылка на песню').fill(music.link);
    await page.getByLabel('Темп').selectOption(music.pace);
    await page.getByLabel('Энергия').selectOption(music.energy);
    await page.getByLabel('Лад').selectOption(music.mode);
  }
  await page.getByLabel('Исполнитель и название').fill(music.title);
  await page.getByRole('button', { name: 'Собрать страницу дня' }).click();
  await page.locator('#viewer').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#viewer-title').filter({ hasText: 'Вечер в автобусе под дождём' }).waitFor();
  return frameSeconds(page);
}

async function main() {
  // A UTF-8 locale lets Chromium keep the Cyrillic folder name of downloads.
  const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(() => { delete window.showDirectoryPicker; });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(BASE);
  await page.waitForSelector('body[data-ready=true]', { timeout: 60000 });

  // 1. Six sample days, each through the same pipeline, five techniques between them.
  const cards = await page.locator('.day-button').evaluateAll((buttons) => buttons.map((b) => [b.querySelector('.day-title').textContent, b.querySelector('.day-technique').textContent, b.querySelector('.day-folder').textContent]));
  assert.equal(cards.length, 6);
  for (const [title, technique, folder] of cards) {
    assert.equal(technique, EXPECTED[title], title);
    assert.match(folder, new RegExp(`^2026-\\d\\d-\\d\\d ${title}$`));
  }

  // 2. A day from an uploaded song: analysed, painted, saved, playable.
  const fast = await createDay(page, { music: { file: 'city.mp3', title: 'Демо — быстрый трек' } });
  const reasons = await page.locator('#viewer-reasons').innerText();
  assert.match(reasons, /13[0-4] BPM/);
  assert.match(reasons, /минор/); // the city score is in D minor
  const before = await page.locator('#viewer-canvas').evaluate((c) => c.toDataURL().length);
  await page.getByRole('button', { name: '▶ Смотреть' }).click();
  await page.waitForFunction(() => !document.getElementById('soundtrack').paused);
  await page.waitForTimeout(1500);
  const after = await page.locator('#viewer-canvas').evaluate((c) => c.toDataURL().length);
  assert.notEqual(before, after, 'the page animates while playing');
  await page.getByRole('button', { name: 'Без звука' }).click();
  assert.ok(await page.locator('#soundtrack').evaluate((a) => a.muted));
  await page.getByRole('button', { name: 'Со звуком' }).click();
  await page.getByRole('button', { name: '❚❚ Стоп' }).click();

  // 3. Save the day folder as ZIP with a recorded video, then open the standalone player from it.
  const download = page.waitForEvent('download', { timeout: 90000 });
  await page.getByRole('button', { name: 'Сохранить папку дня' }).click();
  const saved = await download;
  assert.match(saved.suggestedFilename(), /^\d{4}-\d\d-\d\d Вечер в автобусе под дождём\.zip$/);
  const zipPath = await saved.path();
  const zip = unzipSync(new Uint8Array(readFileSync(zipPath)));
  const folder = Object.keys(zip)[0].split('/')[0];
  assert.match(folder, /^\d{4}-\d\d-\d\d Вечер в автобусе под дождём$/);
  const files = Object.fromEntries(Object.entries(zip).map(([name, data]) => [name.slice(folder.length + 1), data]));
  assert.deepEqual(Object.keys(files).sort(), ['day.json', 'entry.txt', 'memory.html', 'memory.webm', 'photo-01.webp', 'poster.png', 'song.mp3', 'voice.txt']);
  assert.ok(files['memory.webm'].length > 50_000, `video bytes ${files['memory.webm'].length}`);
  const record = JSON.parse(strFromU8(files['day.json']));
  assert.equal(record.folder, folder);
  assert.equal(record.inputs.music.title, 'Демо — быстрый трек');
  const server = await serve(files);
  const player = await context.newPage();
  await player.goto(`http://127.0.0.1:${server.address().port}/memory.html`);
  await player.waitForFunction(() => document.getElementById('memory').readyState >= 1, null, { timeout: 15000 });
  const videoSeconds = await player.locator('#memory').evaluate(async (video) => {
    if (video.duration === Infinity) { video.currentTime = 1e9; await new Promise((r) => { video.ontimeupdate = r; }); }
    return video.duration;
  });
  assert.ok(videoSeconds > 10, `video lasts ${videoSeconds}s`);
  await player.close();
  server.close();
  await page.getByRole('button', { name: 'Закрыть день' }).click();

  // 4. The same words and photo with a slow linked song: a different rhythm, and the link opens the song.
  const slow = await createDay(page, { music: { link: 'https://example.com/team-song', pace: 'slow', energy: 'soft', mode: 'major', title: 'Team — Slow Song' } });
  assert.ok(slow > fast, `slow song ${slow}s per frame vs fast ${fast}s`);
  assert.equal(await page.getByRole('link', { name: 'Открыть песню ↗' }).getAttribute('href'), 'https://example.com/team-song');
  await page.getByRole('button', { name: 'Закрыть день' }).click();

  // 5. Same saved day, another song: a temporary preview. The office day crosses into another technique,
  //    and the folder saved during the preview still holds the saved song and design.
  await page.locator('.day-button', { hasText: 'Ночь в офисе перед сдачей' }).click();
  await page.locator('#play-day:not([disabled])').waitFor();
  assert.match(await page.locator('#viewer-technique').innerText(), /Линии и круги/i);
  await page.locator('.compare-option', { hasText: '«Окно»' }).click();
  await page.locator('#play-day:not([disabled])').waitFor();
  assert.match(await page.locator('#viewer-technique').innerText(), /Тушь и воздух/i);
  assert.match(await page.locator('#compare-note').innerText(), /остаётся своя песня/);
  assert.ok(await page.locator('#viewer-stage').evaluate((stage) => stage.classList.contains('is-preview')));
  assert.match(await page.locator('#soundtrack').getAttribute('src'), /morning\.mp3$/);
  await page.getByLabel('с видео').uncheck();
  const previewSave = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить папку дня' }).click();
  const previewZip = unzipSync(new Uint8Array(readFileSync(await (await previewSave).path())));
  const previewRecord = JSON.parse(strFromU8(previewZip[Object.keys(previewZip).find((name) => name.endsWith('/day.json'))]));
  assert.equal(previewRecord.design.technique, 'kandinsky');
  assert.ok(Object.keys(previewZip).some((name) => name.endsWith('/song.mp3')));
  assert.ok(Math.abs(previewRecord.inputs.music.bpm - 132) <= 2);
  await page.getByRole('button', { name: 'Закрыть день' }).click();
  await page.locator('.day-button', { hasText: 'Ночь в офисе перед сдачей' }).click();
  await page.locator('#play-day:not([disabled])').waitFor();
  assert.match(await page.locator('#viewer-technique').innerText(), /Линии и круги/i);
  assert.equal(await page.locator('.compare-option[aria-pressed=true] .compare-name').innerText(), 'Своя песня');
  await page.getByRole('button', { name: 'Закрыть день' }).click();

  // 6. Reload: both own days remain in the archive and reopen.
  await page.reload();
  await page.waitForSelector('body[data-ready=true]');
  await page.getByLabel('Показать').selectOption('mine');
  assert.equal(await page.locator('.day').count(), 2);
  // Search matches other forms of a word: «море» finds «у моря».
  await page.getByLabel('Показать').selectOption('all');
  await page.getByLabel('Поиск по записям').fill('море');
  assert.ok(await page.locator('.day-title', { hasText: 'Вечер у моря с подругой' }).count() === 1, 'море finds у моря');
  await page.getByLabel('Показать').selectOption('mine');
  await page.getByLabel('Поиск по записям').fill('автобус');
  await page.locator('.day-button').first().click();
  await page.locator('#viewer-title').filter({ hasText: 'Вечер в автобусе под дождём' }).waitFor();
  await page.getByRole('button', { name: 'Закрыть день' }).click();
  assert.deepEqual(errors, []);
  await context.close();

  // 7. Phone layout.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.goto(BASE);
  await phone.waitForSelector('body[data-ready=true]', { timeout: 60000 });
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390);
  await phone.locator('.day-button').first().click();
  await phone.locator('#viewer').waitFor({ state: 'visible' });
  assert.ok(await phone.locator('#viewer').evaluate((v) => v.scrollWidth <= v.clientWidth));
  await phone.getByRole('button', { name: 'Закрыть день' }).click();
  await phone.getByRole('button', { name: 'Записать день' }).first().click();
  assert.ok(await phone.locator('#editor').isVisible());
  await browser.close();
  console.log(`Browser checks passed. Same story and photo: fast file ${fast}s per frame, slow link ${slow}s per frame; video ${files['memory.webm'].length} bytes.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
