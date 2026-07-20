/**
 * Image right-click layout menu — Scope B (anchor↔anchor transitions).
 *
 * Asserts:
 *   1. Right-click on a floating image opens the layout menu, not the text menu.
 *   2. The menu highlights the image's current wrap type.
 *   3. The "In Line with Text" option is disabled (Scope C will enable it).
 *   4. Clicking "Top and Bottom" on a wrap-square float converts it to a block
 *      image; clicking "Behind Text" converts it to a wrapNone float.
 *   5. Right-click on an inline image opens the menu but every anchor option
 *      is disabled (inline↔anchor lives in Scope C).
 */
import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/image-layout-modes-demo.docx';

async function loadFixture(page: Page) {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();
  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
  await page.waitForSelector('.paged-editor__pages');
  await page.waitForSelector('[data-page-number]');
  await page.waitForTimeout(1500);
}

test.describe('Image right-click layout menu', () => {
  test('right-click on floating image opens the layout menu', async ({ page }) => {
    await loadFixture(page);
    await page.locator('.layout-page-floating-image').first().click({ button: 'right' });
    await expect(page.locator('[data-testid="image-context-menu"]')).toBeVisible();
    // Text context menu should NOT have opened.
    await expect(page.locator('.docx-text-context-menu')).toHaveCount(0);
  });

  test('menu highlights current wrap type for a floating image', async ({ page }) => {
    await loadFixture(page);
    await page.locator('.layout-page-floating-image').first().click({ button: 'right' });
    const menu = page.locator('[data-testid="image-context-menu"]');
    await expect(menu).toBeVisible();
    // The fixture's wrap-square float anchors on the left → "Square Left".
    await expect(menu.locator('[data-wrap-type="squareLeft"][data-current="true"]')).toHaveCount(1);
    // "In Line with Text" is enabled when the image is floating (Scope C).
    await expect(menu.locator('[data-wrap-type="inline"][data-disabled="false"]')).toHaveCount(1);
  });

  test('clicking "Square Right" flips the float to right-anchored', async ({ page }) => {
    await loadFixture(page);
    expect(await page.locator('.layout-page-floating-image').count()).toBe(1);

    await page.locator('.layout-page-floating-image').first().click({ button: 'right' });
    await page.locator('[data-testid="image-context-menu"] [data-wrap-type="squareRight"]').click();
    await page.waitForTimeout(400);

    // Stays in the floating layer — anchor↔anchor transition.
    expect(await page.locator('.layout-page-floating-image').count()).toBe(1);

    // Re-open the menu — current option should now read 'squareRight'.
    await page.evaluate(() => {
      const img = document.querySelector('.layout-page-floating-image') as HTMLElement | null;
      if (!img) throw new Error('no floating image');
      const rect = img.getBoundingClientRect();
      img.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 2,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        })
      );
    });
    await expect(
      page.locator(
        '[data-testid="image-context-menu"] [data-wrap-type="squareRight"][data-current="true"]'
      )
    ).toHaveCount(1);
  });

  test('clicking "Behind Text" keeps the image in the floating layer (wrapNone)', async ({
    page,
  }) => {
    await loadFixture(page);
    expect(await page.locator('.layout-page-floating-image').count()).toBe(1);

    await page.locator('.layout-page-floating-image').first().click({ button: 'right' });
    await page.locator('[data-testid="image-context-menu"] [data-wrap-type="behind"]').click();
    await page.waitForTimeout(400);

    // Still in the floating layer — wrapNone is anchored, not block.
    expect(await page.locator('.layout-page-floating-image').count()).toBe(1);

    // Lines that overlapped the float used to have wrap margins; with wrapNone,
    // those margins are released and text paints OVER the image, so a normal
    // right-click would land on the text span. Synthesise the contextmenu event
    // directly on the image element instead.
    await page.evaluate(() => {
      const img = document.querySelector('.layout-page-floating-image') as HTMLElement | null;
      if (!img) throw new Error('no floating image');
      const rect = img.getBoundingClientRect();
      img.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 2,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        })
      );
    });
    await expect(
      page.locator(
        '[data-testid="image-context-menu"] [data-wrap-type="behind"][data-current="true"]'
      )
    ).toHaveCount(1);
  });

  test('right-click on inline image: every option is enabled, inline marked current', async ({
    page,
  }) => {
    await loadFixture(page);
    // Synthesise a contextmenu event directly on the inline <img> — React's
    // onContextMenu delegation makes a Playwright right-click click land on
    // the surrounding text spans rather than the inline image.
    await page.evaluate(() => {
      const img = document.querySelector('.layout-line .layout-run-image') as HTMLElement | null;
      if (!img) throw new Error('no inline image');
      const rect = img.getBoundingClientRect();
      img.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 2,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        })
      );
    });
    const menu = page.locator('[data-testid="image-context-menu"]');
    await expect(menu).toBeVisible();
    // Inline is the current option (marked with the ● dot) but stays
    // clickable — picking it is a no-op via PM command early-return,
    // matching Word's behavior.
    await expect(menu.locator('[data-wrap-type="inline"][data-current="true"]')).toHaveCount(1);
    // No options are visually disabled — the menu reads consistently
    // regardless of the image's current state.
    for (const wt of ['inline', 'squareLeft', 'squareRight', 'behind', 'inFront']) {
      await expect(menu.locator(`[data-wrap-type="${wt}"][data-disabled="false"]`)).toHaveCount(1);
    }
  });

  test('inline → Square Left: image promotes to a left-anchored float', async ({ page }) => {
    await loadFixture(page);
    expect(await page.locator('.layout-line .layout-run-image').count()).toBe(1);
    expect(await page.locator('.layout-page-floating-image').count()).toBe(1);

    await page.evaluate(() => {
      const img = document.querySelector('.layout-line .layout-run-image') as HTMLElement | null;
      if (!img) throw new Error('no inline image');
      const rect = img.getBoundingClientRect();
      img.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 2,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        })
      );
    });
    await page.locator('[data-testid="image-context-menu"] [data-wrap-type="squareLeft"]').click();
    await page.waitForTimeout(400);

    // The previously inline image is now in the floating layer.
    expect(await page.locator('.layout-line .layout-run-image').count()).toBe(0);
    expect(await page.locator('.layout-page-floating-image').count()).toBe(2);
  });

  test('floating → In Line with Text: image returns to text flow', async ({ page }) => {
    await loadFixture(page);
    expect(await page.locator('.layout-page-floating-image').count()).toBe(1);
    expect(await page.locator('.layout-line .layout-run-image').count()).toBe(1);

    await page.evaluate(() => {
      const img = document.querySelector('.layout-page-floating-image img') as HTMLElement | null;
      if (!img) throw new Error('no floating image');
      const rect = img.getBoundingClientRect();
      img.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 2,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        })
      );
    });
    await page.locator('[data-testid="image-context-menu"] [data-wrap-type="inline"]').click();
    await page.waitForTimeout(400);

    // The previously floating image is now inline in a layout-line.
    expect(await page.locator('.layout-page-floating-image').count()).toBe(0);
    expect(await page.locator('.layout-line .layout-run-image').count()).toBe(2);
  });

  test('Escape closes the layout menu', async ({ page }) => {
    await loadFixture(page);
    await page.locator('.layout-page-floating-image').first().click({ button: 'right' });
    await expect(page.locator('[data-testid="image-context-menu"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="image-context-menu"]')).toHaveCount(0);
  });
});
