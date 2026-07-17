import { test, expect } from '@playwright/test';
import { findPageContaining } from '../../helpers/find-page';

const VUE_URL = process.env.VUE_E2E_URL ?? 'http://localhost:5174/?e2e=1';

/**
 * Vue parity for the torture-doc layout fixes (tab-stop grid suppression,
 * paragraph-border flow height, positioned-table anchoring). The fixes live in
 * core's pagination/painter pipeline, which the Vue composable drives through
 * the same painter — this spec proves the Vue adapter actually reaches them.
 */

const FIXTURE = 'e2e/fixtures/comprehensive-word-element-test.docx';

test('Vue: header right tab, callout gaps, and floating table match core layout', async ({
  page,
}) => {
  await page.goto(VUE_URL);
  await page.locator('.docx-editor-vue').waitFor();
  await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);
  await page.waitForSelector('.layout-page-header .layout-line', { timeout: 30000 });

  // Header right tab: CONFIDENTIAL right-aligns near the 9026tw stop (~602px).
  const page2 = page.locator('.layout-page').nth(1);
  await page2.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const confidentialRight = await page2.evaluate((pg) => {
    const content = pg.querySelector('.layout-page-content')!.getBoundingClientRect();
    const conf = [...pg.querySelectorAll('.layout-page-header .layout-run-text')].find((r) =>
      r.textContent?.includes('CONFIDENTIAL')
    );
    return conf ? conf.getBoundingClientRect().right - content.left : null;
  });
  expect(confidentialRight).not.toBeNull();
  expect(confidentialRight!).toBeGreaterThan(560);

  const calloutPage = await findPageContaining(page, '13. Borders, Shading & Callouts');
  const calloutGaps = await calloutPage.evaluate((pg) => {
    const labels = ['INFO:', 'WARNING:', 'SUCCESS:', 'ERROR:'];
    const boxes = labels
      .map((label) =>
        [...pg.querySelectorAll('.layout-paragraph')].find((p) => p.textContent?.startsWith(label))
      )
      .filter(Boolean)
      .map((p) => p!.querySelector('.layout-paragraph-border')!.getBoundingClientRect());
    const out: number[] = [];
    for (let j = 1; j < boxes.length; j++) out.push(boxes[j].top - boxes[j - 1].bottom);
    return out;
  });
  expect(calloutGaps).toHaveLength(3);
  for (const gap of calloutGaps) expect(gap).toBeGreaterThan(8);

  const floatPage = await findPageContaining(page, '16. Floating Table');
  const floatGeom = await floatPage.evaluate((pg) => {
    const content = pg.querySelector('.layout-page-content')!.getBoundingClientRect();
    const table = pg.querySelector('.layout-table')!.getBoundingClientRect();
    return {
      center: (table.left + table.right) / 2 - content.left,
      contentWidth: content.width,
    };
  });
  expect(Math.abs(floatGeom.center - floatGeom.contentWidth / 2)).toBeLessThan(4);
});
