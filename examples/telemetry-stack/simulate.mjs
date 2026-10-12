// Simulated people, so the dashboards have data to show.
//
// Opens headless browser pages on the telemetry examples and edits like people do: typing,
// new paragraphs, a broken file now and then, and a picture insert while a picture is selected,
// which the editor refuses. Every 20 seconds each page sends its performance summary early,
// as it would when its tab goes to the background.
//
//   node examples/telemetry-stack/simulate.mjs [minutes] [people]
//
// Every person is a headless browser on this machine. Many people load the CPU, and the
// dashboards then show that load as input delay, as they would on a busy laptop.
//
// Start the stack and the example apps first. See README.md.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve(import.meta.dirname, '../../package.json'));
const { chromium } = require('@playwright/test');

const MINUTES = Number(process.argv[2] ?? 4);
const PEOPLE = Number(process.argv[3] ?? 2);
const SINGLE_USER = process.env.SINGLE_USER_URL ?? 'http://localhost:5181/';
const COLLABORATION = process.env.COLLABORATION_URL ?? 'http://localhost:5182/';
const WORDS = 'the parties agree that this clause applies to every later amendment of the terms'.split(' ');
const BROKEN_FILE = { name: 'broken.docx', mimeType: 'application/zip', buffer: Buffer.from('not a zip') };
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = (items) => items[Math.floor(Math.random() * items.length)];

/** The page goes hidden for a moment: each editor sends its summary, and exporters flush. */
const flush = (page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    delete document.visibilityState;
  });

async function clickIntoText(page) {
  const lines = page.locator('.docx-editor [contenteditable="true"] [data-paragraph-id]');
  const count = await lines.count();
  if (count === 0) return;
  await lines.nth(Math.floor(Math.random() * Math.min(count, 40))).click();
}

/** Select a picture and insert another one: the editor refuses it with `edit.picture-selected`. */
async function refusedPictureInsert(page) {
  const box = await page.evaluate(async () => {
    const scroller = [...document.querySelectorAll('*')].find(
      (element) =>
        element.scrollHeight > element.clientHeight + 500 &&
        getComputedStyle(element).overflowY !== 'visible'
    );
    if (!scroller) return null;
    for (let top = 0; top < scroller.scrollHeight; top += 300) {
      scroller.scrollTop = top;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const picture = [...document.querySelectorAll('[data-drawing-paragraph-id]')]
        .map((element) => element.getBoundingClientRect())
        .find((rect) => rect.width > 20 && rect.top > 130 && rect.bottom < innerHeight - 40);
      if (picture) return { x: picture.x + picture.width / 2, y: picture.y + picture.height / 2 };
    }
    return null;
  });
  if (!box) return;
  await page.mouse.click(box.x, box.y);
  await page.locator('.docx-editor input[type=file]').setInputFiles({
    name: 'picture.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
}

/** Turn on suggesting mode, so edits become tracked changes and refusals count as tracked. */
async function suggest(page) {
  await page.getByRole('button', { name: 'Editing mode' }).click();
  await page.getByRole('menuitemradio', { name: /Suggesting/ }).click();
}

async function person(browser, url, id, deadline, suggesting) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto(url);
  await page.waitForSelector('.docx-editor [contenteditable="true"]', { timeout: 60_000 });
  if (suggesting) await suggest(page).catch(() => {});
  let lastFlush = Date.now();
  while (Date.now() < deadline) {
    const roll = Math.random();
    if (roll < 0.03 && url.startsWith(SINGLE_USER)) {
      // A broken file, then the sample again.
      await page.getByTestId('open-file').setInputFiles(BROKEN_FILE);
      await pause(1_000);
      await page.reload();
      await page.waitForSelector('.docx-editor [contenteditable="true"]', { timeout: 60_000 });
      if (suggesting) await suggest(page).catch(() => {});
    } else if (roll < 0.08) {
      await refusedPictureInsert(page).catch(() => {});
    } else {
      await clickIntoText(page).catch(() => {});
      await page.keyboard.press('End');
      for (let word = 0; word < 3 + Math.floor(Math.random() * 6); word += 1) {
        await page.keyboard.type(` ${pick(WORDS)}`, { delay: 40 + Math.random() * 120 });
      }
      if (Math.random() < 0.3) await page.keyboard.press('Enter');
    }
    await pause(500 + Math.random() * 1_500);
    if (Date.now() - lastFlush > 20_000) {
      await flush(page);
      lastFlush = Date.now();
    }
  }
  await flush(page);
  await pause(1_000);
  await page.close();
  console.log(`person ${id} done`);
}

const browser = await chromium.launch();
const deadline = Date.now() + MINUTES * 60_000;
console.log(`${PEOPLE} people on each example for ${MINUTES} minutes`);
const people = [];
for (let id = 0; id < PEOPLE; id += 1) {
  // Half the people run the next release, so the dashboards can compare versions.
  const version = id % 2 === 0 ? '1.0.0' : '1.1.0';
  // Every other person suggests, so the tracked-change panels have data.
  const suggesting = id % 2 === 1;
  people.push(person(browser, `${SINGLE_USER}?version=${version}`, `single-${id}`, deadline, suggesting));
  people.push(person(browser, `${COLLABORATION}?version=${version}`, `room-${id}`, deadline, !suggesting));
}
const results = await Promise.allSettled(people);
await browser.close();
const failed = results.filter((result) => result.status === 'rejected');
for (const result of failed) console.error('person failed:', result.reason);
if (failed.length > 0) process.exit(1);
