// Screenshots of the dashboards for the READMEs and the docs.
//
// Run the stack in examples/telemetry-stack and its simulation first, then, from the repository
// root:
//
//   node assets/observability/screenshots/capture.mjs [time range, default now-10m]
//
// Each screenshot shows one part of a dashboard, cut at its row headers. They are written next to
// the docs page that shows them, so the docs site builds them in without fetching anything.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve(import.meta.dirname, '../../../package.json'));
const { chromium } = require('@playwright/test');

const GRAFANA = process.env.GRAFANA_URL ?? 'http://localhost:3300';
const FROM = process.argv[2] ?? 'now-10m';
const OUT = path.resolve(import.meta.dirname, '../../../docs/site/content/telemetry/images');
const SHOTS = [
  { uid: 'docx-editor-experience', file: 'editor-experience.png', from: null, to: 'Input delay by app version (95th percentile)' },
  { uid: 'docx-editor-experience', file: 'editor-tracked-changes.png', from: 'Tracked changes', to: null },
  { uid: 'docx-editor-collaboration', file: 'collaboration.png', from: null, to: 'Server work' },
];

const browser = await chromium.launch();
// Tall enough that Grafana renders every panel; it skips panels outside the viewport.
const page = await browser.newPage({ viewport: { width: 1440, height: 4200 }, deviceScaleFactor: 2 });
let open = null;
for (const shot of SHOTS) {
  if (open !== shot.uid) {
    await page.goto(`${GRAFANA}/d/${shot.uid}?orgId=1&from=${FROM}&to=now&kiosk&theme=dark`);
    // Let every query finish and every chart draw.
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(6_000);
    open = shot.uid;
  }
  const rowTop = async (title) => {
    const box = await page.getByText(title, { exact: true }).first().boundingBox();
    if (!box) throw new Error(`No row named ${title}`);
    return box.y;
  };
  const contentBottom = () =>
    page.evaluate(() =>
      Math.max(...[...document.querySelectorAll('.react-grid-item')].map((item) => item.getBoundingClientRect().bottom))
    );
  const top = shot.from ? (await rowTop(shot.from)) - 6 : 0;
  const bottom = shot.to ? (await rowTop(shot.to)) - 12 : (await contentBottom()) + 12;
  await page.screenshot({
    path: path.join(OUT, shot.file),
    clip: { x: 0, y: top, width: 1440, height: bottom - top },
  });
  console.log('wrote', shot.file);
}
await browser.close();
