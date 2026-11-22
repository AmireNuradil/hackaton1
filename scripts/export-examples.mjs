// Renders the sample days' pages to examples/ for the submission (poster frame of each page + the feed).
// Usage: npm run build && npm run preview, then: node scripts/export-examples.mjs [url]
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = fileURLToPath(new URL('../examples/', import.meta.url));
const BASE = process.argv[2] ?? 'http://127.0.0.1:4173/';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(BASE);
await page.waitForSelector('body[data-ready=true]', { timeout: 60000 });
const days = await page.locator('.day-button').evaluateAll((buttons) => buttons.map((b) => ({ id: b.dataset.day, folder: b.querySelector('.day-folder').textContent, technique: b.querySelector('.day-technique').textContent })));
const rows = [];
for (const day of days) {
  await page.click(`.day-button[data-day="${day.id}"]`);
  await page.waitForTimeout(1200);
  const data = await page.locator('#viewer-canvas').evaluate((canvas) => canvas.toDataURL('image/jpeg', 0.88));
  const file = `${day.id.replace('sample-', '')}.jpg`;
  writeFileSync(OUT + file, Buffer.from(data.split(',')[1], 'base64'));
  rows.push(`| ![${day.folder}](${file}) | «${day.folder}» | ${day.technique} |`);
  await page.click('#close-viewer');
}
await page.locator('#feed').scrollIntoViewIfNeeded();
await page.waitForTimeout(1500);
await page.locator('#feed').screenshot({ path: `${OUT}feed.png` });
writeFileSync(`${OUT}README.md`, `# Примеры дней\n\nКадры страниц шести вымышленных дней, собранных прототипом. Названия папок придуманы системой по тексту записи.\n\n| Страница | Папка дня | Приём |\n|---|---|---|\n${rows.join('\n')}\n\n![Лента дней](feed.png)\n`);
await browser.close();
console.log(rows.join('\n'));
