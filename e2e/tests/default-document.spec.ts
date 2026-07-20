import { test, expect } from '@playwright/test';

/**
 * Guards the document real visitors get at docx-editor.dev/editor.
 *
 * Every other spec boots the frozen fixture under ?e2e=1 so that reworking the
 * demo document does not rewrite the suite. That leaves the shipped document
 * with nothing asserting on it, which is what this spec covers: ?doc=default
 * forces the real one, and the checks below are the properties that would make
 * it embarrassing to ship broken.
 */
test.describe('default demo document', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?e2e=1&doc=default');
    await page.waitForSelector('[data-testid="docx-editor"]');
    await page.locator('.layout-page').first().waitFor();
  });

  test('parses and paginates', async ({ page }) => {
    // Multi-page: the element test document is ~20 sections across many pages,
    // so a single page means pagination fell over on load.
    await expect.poll(async () => page.locator('.layout-page').count()).toBeGreaterThan(5);
    await expect(page.locator('.layout-page-content').first()).toContainText('DOCX-EDITOR.DEV');
  });

  test('table of contents is generated, not an empty field', async ({ page }) => {
    // The heading sits on page 2, after the cover.
    const doc = page.locator('.paged-editor__pages');
    await expect(doc).toContainText('Table of Contents');

    // An empty TOC field still renders its heading, so the heading alone proves
    // nothing. Entries are what the field generated: each is a link to a
    // heading's bookmark, so count the anchors rather than match text that also
    // appears in the body.
    const entries = doc.locator('a[href^="#_Toc"]');
    await expect.poll(async () => entries.count()).toBeGreaterThan(20);
  });

  test('boots with the toned-down wording', async ({ page }) => {
    const doc = page.locator('.paged-editor__pages');
    await expect(doc).toContainText('PUBLIC SAMPLE');
    await expect(doc).not.toContainText('CONFIDENTIAL');
    await expect(doc).not.toContainText('INTERNAL – FOR TESTING ONLY');
  });

  test('renders without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.reload();
    await page.locator('.layout-page').first().waitFor();
    expect(errors).toEqual([]);
  });
});
