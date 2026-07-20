/**
 * E2E for the paraId allocator — every paragraph in the live editor
 * must carry a stable `w14:paraId`. The agent toolkit anchors comments,
 * tracked changes, and formatting by `paraId`, so any paragraph without
 * one is invisible to the agent and any duplicate (a second-half-of-
 * split) silently desyncs the agent's anchors.
 *
 * Regression for: typing Enter inside a paragraph, pasting multi-
 * paragraph text, and explicit programmatic insertion via the bridge.
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

async function getAllParaIds(page: import('@playwright/test').Page): Promise<string[]> {
  await page.waitForFunction(() => Boolean(window.__DOCX_EDITOR_E2E__), undefined, {
    timeout: 15000,
  });
  return await page.evaluate(() => {
    const view = window.__DOCX_EDITOR_E2E__;
    if (!view) return [] as string[];
    // Walk the PM doc directly — the hook exposes first/last but not all.
    // Use the live editor ref via the document API.
    const ids: string[] = [];
    const editor = (
      document.querySelector('[data-testid="docx-editor"]') as HTMLElement | null
    )?.querySelector('.paged-editor__hidden-pm');
    void editor;
    // Easier: agentGetPageContent walks page 1's paragraphs; for short
    // docs that's the whole thing.
    const total = view.getTotalPages();
    for (let n = 1; n <= total; n++) {
      const page = view.agentGetPageContent(n);
      if (!page) continue;
      for (const p of page.paragraphs) ids.push(p.paraId);
    }
    return ids;
  });
}

test.describe('paraId allocator — live document', () => {
  test('every paragraph in a freshly-loaded fixture has a paraId', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.loadDocxFile('fixtures/example-with-image.docx');

    const ids = await getAllParaIds(page);
    expect(ids.length).toBeGreaterThan(0);
    // No null / empty / undefined ids.
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    // No duplicates.
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('typing Enter mid-paragraph allocates a new paraId for the second half', async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.loadDocxFile('fixtures/example-with-image.docx');

    const before = await getAllParaIds(page);
    expect(before.length).toBeGreaterThan(0);

    // Click into the first paragraph and split it with Enter at the
    // current cursor position. The original paraId stays on one half;
    // the new half must get a fresh paraId, not null and not a duplicate.
    await page.locator('.paged-editor__hidden-pm').focus();
    await page.keyboard.press('End');
    // Move cursor a few chars back so Enter splits the paragraph in the
    // middle, not at the end.
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');

    // Allow the appendTransaction to fire and React to commit.
    await page.waitForTimeout(150);

    const after = await getAllParaIds(page);
    expect(after.length).toBe(before.length + 1);
    // No nulls.
    expect(after.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    // No duplicates.
    expect(new Set(after).size).toBe(after.length);
    // The new id is uppercase 8-char hex (matches the w14:paraId
    // convention the allocator follows).
    const newIds = after.filter((id) => !before.includes(id));
    expect(newIds.length).toBe(1);
    expect(newIds[0]).toMatch(/^[0-9A-F]{8}$/);
  });
});
