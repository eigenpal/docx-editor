import { test, expect } from '@playwright/test';

/**
 * Regression for #746 — after #738, `ensureParaIdsInState` assigns a paraId to
 * every paragraph in the PM state at load, but Vue's `getDocument()` returns
 * the cached `document.value`, which was only refreshed by `fromProseDoc` on a
 * doc-changing transaction — so the host Document was missing those ids until
 * the first edit. The cache is now synced with the allocated ids at load, so
 * getDocument() exposes the same paraIds as PM immediately, without an edit.
 */
test('Vue: getDocument() exposes PM paraIds before the first edit (#746)', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.waitForSelector('.layout-page-content .layout-run-text');

  const result = await page.evaluate(() => {
    const hook = (window as unknown as { __DOCX_EDITOR_E2E__: Record<string, () => unknown> })
      .__DOCX_EDITOR_E2E__;
    const docIds = hook.getDocumentParaIds() as (string | null)[];
    const pmFirst = hook.getFirstTextblockParaId() as string | null;
    const pmAttr0 = (hook.getParagraphAttrs as (i: number) => { paraId?: string | null } | null)(
      0
    )?.paraId;
    return { docIds, pmFirst, pmAttr0 };
  });

  // PM has ids at load (the #738 fix).
  expect(result.pmAttr0, 'PM should have a paraId at load').toBeTruthy();

  // getDocument() must expose ids on (essentially) every paragraph — not just
  // the lone one the DOCX shipped — and must include the PM's first paragraph.
  const nonNull = result.docIds.filter(Boolean);
  expect(nonNull.length).toBeGreaterThan(1);
  expect(result.docIds.every(Boolean), 'every getDocument paraId should be non-null').toBe(true);
  expect(result.docIds).toContain(result.pmAttr0);
});
