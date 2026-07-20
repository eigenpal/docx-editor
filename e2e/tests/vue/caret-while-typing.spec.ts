import { test, expect } from '@playwright/test';

// Regression for #736 — Vue: the blinking text caret disappeared while typing
// (and only came back on a click). The caret/selection overlay was repainted
// synchronously on every transaction, before the rAF-coalesced layout repaint,
// so it resolved against stale painted DOM and vanished. This test preserves
// coverage of the user-visible caret behavior independently of its coordination
// mechanism. React was never affected (different overlay path).
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

  const caretBox = await page.locator('.vue-caret').boundingBox();
  expect(caretBox).not.toBeNull();
  const caretCenterY = caretBox!.y + caretBox!.height / 2;

  // The marker can wrap across painter runs. Find the inserted fragment on the
  // caret's line instead of assuming all ten characters remain in one run.
  const typedRunBoxes = await page
    .locator('.layout-page-content .layout-run-text')
    .evaluateAll((runs) =>
      runs
        .filter((run) => run.textContent?.includes('Q'))
        .map((run) => {
          const rect = run.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })
    );
  const currentRun = typedRunBoxes.find(
    (box) =>
      caretCenterY > box.y - 8 &&
      caretCenterY < box.y + box.height + 8 &&
      caretBox!.x > box.x &&
      caretBox!.x < box.x + box.width + 12
  );
  expect(currentRun).toBeDefined();
});
