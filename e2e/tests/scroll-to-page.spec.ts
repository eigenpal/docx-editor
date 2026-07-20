/**
 * E2E coverage for scrollToPage(n) and getTotalPages() (issue #280).
 * Uses the checked-in multi-page issue-68-large.docx fixture (screenshots/
 * is gitignored and cannot hold paraid-test.docx).
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';
import { waitPageShellInViewport } from '../helpers/wait-in-viewport';
import * as path from 'path';

test.describe('scrollToPage / getTotalPages (issue #280)', () => {
  test.beforeEach(async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    const docPath = path.resolve(process.cwd(), 'e2e/fixtures/issue-68-large.docx');
    await editor.loadDocxFile(docPath);
    await page.waitForFunction(() => (window.__DOCX_EDITOR_E2E__?.getTotalPages() ?? 0) > 1, {
      timeout: 10000,
    });
  });

  test('getTotalPages reports the layout page count (>1) without scrolling', async ({ page }) => {
    const total = await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.getTotalPages() ?? 0);
    // Multi-page fixture is the whole point of this suite.
    expect(total).toBeGreaterThan(1);
  });

  test('scrollToPage(2) brings the second page into the viewport', async ({ page }) => {
    await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.scrollToPage(2));
    await waitPageShellInViewport(page, 2);
  });

  test('scrollToPage(N) brings the last page into the viewport', async ({ page }) => {
    const total = await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.getTotalPages() ?? 0);
    expect(total).toBeGreaterThan(2);
    await page.evaluate((n) => window.__DOCX_EDITOR_E2E__?.scrollToPage(n), total);
    await waitPageShellInViewport(page, total, 25000);
  });

  test('scrollToPage with out-of-range / invalid input is a no-op (no crash)', async ({ page }) => {
    for (const bad of [-1, 0, 999, 1.5]) {
      await page.evaluate((n) => window.__DOCX_EDITOR_E2E__?.scrollToPage(n), bad);
    }
    await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.scrollToPage(2));
    await waitPageShellInViewport(page, 2);
  });
});
