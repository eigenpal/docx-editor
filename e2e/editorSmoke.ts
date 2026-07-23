// Shared engine-neutral editing smoke flow (queue item 3), run identically against the
// React and Vue demos so the paired checkpoint fails if either adapter diverges. It drives
// only the engine-neutral EditorDriver on window (getBodyText / saveAndReopenText / editable)
// and real keyboard input — no framework-specific hooks.

import { test, expect, type Window as _Window } from '@playwright/test';

declare global {
  interface Window {
    __docxEditorDriver?: {
      editable: boolean;
      getBodyText(): string;
      saveAndReopenText(): string;
    };
  }
}

export function editorSmoke(adapter: string, baseUrl: string): void {
  test.describe(`${adapter} editing vertical`, () => {
    test('plain DOCX: edit maps to the canonical model and survives save + reopen', async ({ page }) => {
      await page.goto(`${baseUrl}/?edit=1`);
      await expect(page.getByTestId('editor-status')).toHaveText('Editable (paragraphs)');
      expect(await page.evaluate(() => window.__docxEditorDriver?.editable)).toBe(true);

      // Type at the end of the first paragraph.
      await page.getByTestId('editor-host').locator('p').first().click();
      await page.keyboard.press('End');
      const marker = `[${adapter.toUpperCase()}-SMOKE]`;
      await page.keyboard.type(` ${marker}`);

      // The CANONICAL model (not just the view) carries the edit...
      expect(await page.evaluate(() => window.__docxEditorDriver!.getBodyText())).toContain(marker);
      // ...and it survives a real save -> reopen round-trip.
      expect(await page.evaluate(() => window.__docxEditorDriver!.saveAndReopenText())).toContain(marker);
    });

    test('a document with a table opens read-only (no editing)', async ({ page }) => {
      await page.goto(`${baseUrl}/?edit=1&fixture=with-tables.docx`);
      await expect(page.getByTestId('editor-status')).toContainText('Read-only');
      expect(await page.evaluate(() => window.__docxEditorDriver?.editable)).toBe(false);
    });
  });
}
