/**
 * Vue parity for issue #777 (render-level) — the VML header logo paints and an
 * anchored image with no explicit alignment is left-aligned (Word default), not
 * centered. The parsing + alignment fixes live in core; this proves they reach
 * the Vue-mounted painter too.
 */

import { test, expect } from '@playwright/test';

test('Vue: VML header logo renders and a left-anchored image is left-aligned (#777)', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles('e2e/fixtures/issue-777-vml-header.docx');
  // The Vue demo boots with sample.docx, which already has `[data-page-number]`.
  // Wait for a marker unique to this fixture (scoped to painted pages — the
  // hidden body PM also carries the same text and would trip strict mode).
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll('.layout-page-content')).some((el) =>
            (el.textContent ?? '').includes('Body text below the left-aligned logo.')
          )
        ),
      { timeout: 15000 }
    )
    .toBe(true);
  await expect(page.locator('.layout-page-header img').first()).toBeVisible({
    timeout: 15000,
  });

  const headerImg = page.locator('.layout-page-header img').first();
  const src = await headerImg.getAttribute('src');
  expect(src && src.length).toBeGreaterThan(0);

  const align = await page.evaluate(() => {
    const lines = Array.from(
      document.querySelectorAll('.layout-page-content .layout-line[data-flex-line="true"]')
    ) as HTMLElement[];
    const imageLine = lines.find((l) => l.querySelector('img'));
    return imageLine ? getComputedStyle(imageLine).justifyContent : null;
  });
  expect(align).toBe('flex-start');
});
