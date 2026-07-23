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
      // ...and the PAGINATED pane (repainted from the canonical model by the incremental
      // painter) reflects the edit — the marker's letters appear as positioned spans.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const paged = document.querySelector('.docx-paged-pane');
            return paged ? paged.textContent!.replace(/\s+/g, '') : '';
          }),
        )
        .toContain(marker.replace(/\s+/g, ''));
    });

    test('pressing Enter splits a paragraph and the split survives save + reopen', async ({ page }) => {
      await page.goto(`${baseUrl}/?edit=1`);
      await expect(page.getByTestId('editor-status')).toHaveText('Editable (paragraphs)');

      const before = await page.evaluate(() => window.__docxEditorDriver!.getBodyText().split('\n').length);
      // Split the first paragraph: click into it, go to its start, press Enter.
      await page.getByTestId('editor-host').locator('p').first().click();
      await page.keyboard.press('Home');
      await page.keyboard.press('Enter');

      // The canonical model has one MORE paragraph (an empty head), and it round-trips.
      expect(await page.evaluate(() => window.__docxEditorDriver!.getBodyText().split('\n').length)).toBe(before + 1);
      expect(await page.evaluate(() => window.__docxEditorDriver!.saveAndReopenText().split('\n').length)).toBe(before + 1);

      // The caret stays live: typing after the split lands in the canonical model.
      await page.keyboard.type('X');
      expect(await page.evaluate(() => window.__docxEditorDriver!.getBodyText())).toContain('X');
    });

    test('undo and redo drive the canonical store through a structural split', async ({ page }) => {
      await page.goto(`${baseUrl}/?edit=1`);
      await expect(page.getByTestId('editor-status')).toHaveText('Editable (paragraphs)');
      const before = await page.evaluate(() => window.__docxEditorDriver!.getBodyText());
      const count = () => page.evaluate(() => window.__docxEditorDriver!.getBodyText().split('\n').length);
      const beforeCount = before.split('\n').length;

      // Split the first paragraph (a structural edit that mints a new block id).
      await page.getByTestId('editor-host').locator('p').first().click();
      await page.keyboard.press('Home');
      await page.keyboard.press('Enter');
      expect(await count()).toBe(beforeCount + 1);

      // Undo reverts the split ON THE CANONICAL MODEL (the view's own history could not — it
      // would restore a stale id the mapper rejects).
      await page.keyboard.press('ControlOrMeta+z');
      expect(await page.evaluate(() => window.__docxEditorDriver!.getBodyText())).toBe(before);

      // Redo re-applies it.
      await page.keyboard.press('ControlOrMeta+Shift+z');
      expect(await count()).toBe(beforeCount + 1);
    });

    test('multi-step undo then redo stays consistent with the canonical model', async ({ page }) => {
      await page.goto(`${baseUrl}/?edit=1`);
      await expect(page.getByTestId('editor-status')).toHaveText('Editable (paragraphs)');
      const line0 = async () => (await page.evaluate(() => window.__docxEditorDriver!.getBodyText())).split('\n')[0];
      await page.getByTestId('editor-host').locator('p').first().click();
      await page.keyboard.press('End');
      await page.keyboard.type('AB'); // two per-keystroke commits

      expect(await line0()).toMatch(/AB$/);
      await page.keyboard.press('ControlOrMeta+z'); // undo B
      expect(await line0()).toMatch(/A$/);
      await page.keyboard.press('ControlOrMeta+z'); // undo A
      expect(await line0()).toMatch(/paragraph\.$/);
      await page.keyboard.press('ControlOrMeta+Shift+z'); // redo A
      expect(await line0()).toMatch(/A$/);
      await page.keyboard.press('ControlOrMeta+Shift+z'); // redo B
      expect(await line0()).toMatch(/AB$/);
    });

    test('undo restores the caret to the edited paragraph, not the document end', async ({ page }) => {
      await page.goto(`${baseUrl}/?edit=1`);
      await expect(page.getByTestId('editor-status')).toHaveText('Editable (paragraphs)');
      await page.getByTestId('editor-host').locator('p').first().click();
      await page.keyboard.press('End'); // put the caret in the first paragraph
      await page.keyboard.press('Enter'); // split it (a structural edit that mints a new block)
      await page.keyboard.press('ControlOrMeta+z'); // undo; the caret must return to the FIRST paragraph
      await page.keyboard.type('Q');

      const lines = (await page.evaluate(() => window.__docxEditorDriver!.getBodyText())).split('\n');
      // The fix: the caret returns to where it was (the first paragraph). The old bug placed it
      // at the document END because the split's tail id no longer resolved after the undo.
      expect(lines[0].includes('Q'), `body=${JSON.stringify(lines)}`).toBe(true);
      expect(lines[lines.length - 1].includes('Q')).toBe(false);
    });

    test('a refused edit snaps back without corrupting the model, and the editor keeps working', async ({ page }) => {
      await page.goto(`${baseUrl}/?edit=1`);
      await expect(page.getByTestId('editor-status')).toHaveText('Editable (paragraphs)');
      const before = await page.evaluate(() => window.__docxEditorDriver!.getBodyText());

      // Select the whole document and type: a multi-paragraph delete the mapper refuses.
      await page.getByTestId('editor-host').locator('p').first().click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('Z');
      // The canonical model is untouched — nothing was dropped.
      expect(await page.evaluate(() => window.__docxEditorDriver!.getBodyText())).toBe(before);

      // The editor still works after the snap-back: a plain edit commits normally.
      await page.getByTestId('editor-host').locator('p').first().click();
      await page.keyboard.press('End');
      await page.keyboard.type('!OK');
      expect(await page.evaluate(() => window.__docxEditorDriver!.getBodyText())).toContain('!OK');
    });

    test('a document with a table opens read-only (no editing)', async ({ page }) => {
      await page.goto(`${baseUrl}/?edit=1&fixture=with-tables.docx`);
      await expect(page.getByTestId('editor-status')).toContainText('Read-only');
      expect(await page.evaluate(() => window.__docxEditorDriver?.editable)).toBe(false);
    });
  });
}
