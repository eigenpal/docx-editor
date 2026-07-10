import { expect, forEachAdapter, openEditor } from './parity-fixture';

forEachAdapter('inserts and updates a painted table of contents', async (adapter, { page }) => {
  await openEditor(page, adapter);
  await expect
    .poll(() => page.evaluate(() => window.__DOCX_EDITOR_E2E__?.agentGetDocumentText() ?? ''))
    .toContain('Example');

  const headings = await page.evaluate(() => {
    const hook = window.__DOCX_EDITOR_E2E__;
    const paragraphs =
      hook?.agentGetPageContent(1)?.paragraphs.filter((paragraph) => paragraph.text.trim()) ?? [];
    const first = paragraphs.find((paragraph) => paragraph.text.trim() === 'Example');
    const insertionPoint = paragraphs.find((paragraph) => paragraph.paraId !== first?.paraId);
    if (!hook || !first || !insertionPoint) return null;
    return {
      first: { paraId: first.paraId, text: first.text.trim() },
      insertionText: insertionPoint.text.trim(),
    };
  });
  expect(headings).not.toBeNull();

  const body = page.locator('.layout-page-content');
  await body.getByText(headings!.insertionText, { exact: true }).first().click();
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('button', { name: 'Table of contents', exact: true }).click();

  await expect(
    body.locator('.layout-block-sdt-label', { hasText: 'Table of Contents' })
  ).toHaveCount(1);

  const updated = await page.evaluate(
    () => window.__DOCX_EDITOR_E2E__?.updateTableOfContents() ?? false
  );
  expect(updated).toBe(true);
  const entryAnchor = body.locator('a').filter({ hasText: headings!.first.text }).first();
  await expect(entryAnchor).toBeVisible();
  expect(await body.locator('a[href^="#_Toc"]').count()).toBeGreaterThanOrEqual(2);
  expect(await body.locator('.layout-run-tab').count()).toBeGreaterThan(0);
});
