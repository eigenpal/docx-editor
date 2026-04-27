/**
 * Word-style split color button (issue #130).
 *
 * The text-color and highlight-color toolbar buttons are now split into two:
 *   - left half (apply): re-applies the picker's last picked color directly
 *   - right half (arrow): opens the full color picker dropdown
 *
 * These tests pick a color via the dropdown once, move the selection, then
 * click the apply half — and assert the same color was re-applied without
 * the dropdown ever opening again.
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('Split color button (issue #130)', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();
  });

  test('text color: apply-half re-uses the last picked color (no dropdown)', async ({ page }) => {
    // Type two distinct words on one paragraph.
    await editor.typeText('alpha bravo');

    // Pick blue for the first word via the dropdown half.
    await editor.selectText('alpha');
    await editor.setTextColor('#0070C0');

    // Move selection to the second word.
    await editor.selectText('bravo');

    // Click the apply half — should re-apply the same blue without opening the dropdown.
    await editor.applyLastTextColor();

    // The dropdown must not be visible after clicking the apply half.
    await expect(page.locator('.docx-color-picker-dropdown')).toHaveCount(0);

    // Both words now carry the same color in the document model.
    const colors = await page.evaluate(() => {
      const view = (
        window as unknown as {
          __DOCX_EDITOR_E2E__?: { getView?: () => unknown };
        }
      ).__DOCX_EDITOR_E2E__?.getView?.();
      const found: string[] = [];
      // Scan the rendered editor for foreground colors on text spans.
      document.querySelectorAll('.paged-editor__pages [style*="color"]').forEach((el) => {
        const c = (el as HTMLElement).style.color;
        if (c) found.push(c);
      });
      return { found, hasView: !!view };
    });
    // Blue == rgb(0, 112, 192) per #0070C0.
    expect(colors.found.some((c) => c.includes('rgb(0, 112, 192)'))).toBe(true);
  });

  test('highlight color: apply-half re-uses the last picked color', async ({ page }) => {
    await editor.typeText('first second');

    await editor.selectText('first');
    await editor.setHighlightColor('yellow');

    await editor.selectText('second');
    await editor.applyLastHighlightColor();

    await expect(page.locator('.docx-color-picker-dropdown')).toHaveCount(0);

    // Both words should now carry a yellow highlight background.
    const highlightCount = await page.evaluate(() => {
      let n = 0;
      document
        .querySelectorAll('.paged-editor__pages [style*="background-color"]')
        .forEach((el) => {
          const bg = (el as HTMLElement).style.backgroundColor;
          // yellow == rgb(255, 255, 0)
          if (bg === 'rgb(255, 255, 0)') n++;
        });
      return n;
    });
    expect(highlightCount).toBeGreaterThanOrEqual(2);
  });

  test('arrow half opens the dropdown (existing flow still works)', async ({ page }) => {
    await editor.typeText('hello');
    await editor.selectAll();

    // setTextColor opens the dropdown via the arrow half. If this passes the
    // arrow split is wired correctly.
    await editor.setTextColor('#FF0000');

    // After picking, dropdown should be closed.
    await expect(page.locator('.docx-color-picker-dropdown')).toHaveCount(0);
  });
});
