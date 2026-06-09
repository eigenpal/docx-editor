import { test, expect } from '@playwright/test';

// Regression for #736 — Vue: the blinking text caret disappeared while typing
// (and only came back on a click). The caret/selection overlay was repainted
// synchronously on every transaction, before the rAF-coalesced layout repaint,
// so it resolved against stale painted DOM and vanished. It now runs through
// the layout gate (`syncCoordinator.onRender` + `requestRender`), painting only
// once the layout is current. React was never affected (different overlay path).
test('Vue: caret stays visible and follows the text while typing (#736)', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.locator('.paged-editor__pages').waitFor();

  await page.locator('input[type="file"]').first().setInputFiles('e2e/fixtures/demo.docx');
  await page.waitForSelector('[data-page-number]');

  // Click a painted body span to place the caret in the body text.
  const span = page.locator('.layout-page-content span[data-doc-from]').first();
  await span.click();
  await expect(page.locator('.vue-caret')).toHaveCount(1);

  // Insert a big chunk in a single transaction (paste-like). The doc-change
  // only schedules the layout (rAF), so the caret's new position can't resolve
  // against the not-yet-repainted DOM — the unfixed overlay cleared the caret
  // and never re-painted it (#736). After the gated repaint it must be present.
  const marker = 'QQQQQQQQQQ';
  await page.keyboard.insertText(marker);
  await expect(page.locator('.vue-caret')).toHaveCount(1);

  // And it must keep up across further bursts.
  for (let i = 0; i < 2; i++) {
    await page.keyboard.insertText(marker);
    await expect(page.locator('.vue-caret')).toHaveCount(1);
  }

  // The caret must sit on the typed text, not stranded at a stale spot. Assert
  // it lands within the bounding box of a run that holds the typed marker (a
  // few px of tolerance), which also covers the "wrong place" symptom in #736.
  const run = page.locator('.layout-page-content .layout-run-text', { hasText: marker }).last();
  const runBox = await run.boundingBox();
  const caretBox = await page.locator('.vue-caret').boundingBox();
  expect(runBox).not.toBeNull();
  expect(caretBox).not.toBeNull();
  const caretCenterY = caretBox!.y + caretBox!.height / 2;
  expect(caretCenterY).toBeGreaterThan(runBox!.y - 8);
  expect(caretCenterY).toBeLessThan(runBox!.y + runBox!.height + 8);
  // Caret x is at or just past the run (it's at the insertion point after the
  // typed text), never far to the left of where the text was painted.
  expect(caretBox!.x).toBeGreaterThan(runBox!.x);
  expect(caretBox!.x).toBeLessThan(runBox!.x + runBox!.width + 12);
});
