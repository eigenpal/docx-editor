/**
 * Vue parity for #856 — the shared-core fix (paintPage sizes the header box to
 * the in-flow band, not a floating shape's extent) + shared CSS must reach the
 * Vue painter: the header box must not cover the body, so clicks land in the
 * document text. (Vue renders this fixture's anchored shape content inline
 * rather than as a positioned textbox, a separate pre-existing difference, so
 * this asserts the box/click invariant, not the shape geometry.)
 */
import { test, expect } from '@playwright/test';

test('Vue: header box does not cover the body', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles('e2e/fixtures/issue-856-custom-header.docx');
  await page.waitForSelector('[data-page-number]');
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => {
    const header = document.querySelector('.layout-page-header') as HTMLElement | null;
    const content = document.querySelector('.layout-page-content') as HTMLElement | null;
    const hr = header?.getBoundingClientRect();
    const cr = content?.getBoundingClientRect();
    const probeX = cr ? cr.left + 80 : 0;
    const probeY = cr ? cr.top + 140 : 0;
    const top = document.elementsFromPoint(probeX, probeY)[0] as HTMLElement | undefined;
    return {
      headerHeight: hr ? Math.round(hr.height) : -1,
      topElementIsBody: !!top?.closest('.layout-page-content'),
      topElementInHeader: !!top?.closest('.layout-page-header'),
    };
  });

  expect(info.headerHeight).toBeLessThan(120);
  expect(info.topElementIsBody).toBe(true);
  expect(info.topElementInHeader).toBe(false);
});
