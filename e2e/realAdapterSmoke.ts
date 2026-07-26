// Paired browser smoke for the PRODUCTION adapters (comprehensive 4.8). Unlike editorSmoke (which
// drives the engine mount via __docxEditorDriver), this drives the stable engine-neutral
// EditorDriver that the REAL @docx-editor.dev/react and @docx-editor.dev/vue packages expose from
// createEditor — so the same scenario proves both published package entries load, paginate, report
// editability, save, and round-trip identically. Run against the ?realAdapter=1 route.

// Pins its fixture explicitly (M6D.1 follow-up).
//
// This gate proves the hidden input-host MECHANISM, not which document the demo opens by
// default. When M6D.1 changed the React default to the comprehensive fixture, these
// assertions — written against `editable-sample.docx` content — went red, and the paired
// gate broke because the two adapters no longer opened the same document. A gate must
// control its own input.
import { test, expect } from '@playwright/test';

declare global {
  interface Window {
    __docxAdapterDriver?: {
      editable(): boolean;
      displaySnapshot(): { pageCount: number; text: string };
      save(): Promise<ArrayBuffer>;
      saveAndReopenText(): Promise<string>;
    };
  }
}

export function realAdapterSmoke(adapter: string, baseUrl: string): void {
  test.describe(`${adapter} production adapter`, () => {
    test('the real package entry loads, paginates, reports editable, saves, and round-trips', async ({
      page,
    }) => {
      await page.goto(`${baseUrl}/?realAdapter=1&fixture=editable-sample.docx`);
      await expect(page.getByTestId('adapter-status')).toHaveText('Editable (paragraphs)');

      // The stable driver is exposed by the real adapter's createEditor.
      await page.waitForFunction(() => !!window.__docxAdapterDriver);
      expect(await page.evaluate(() => window.__docxAdapterDriver!.editable())).toBe(true);

      // Layout produced a paginated display the adapter painted (positioned text items).
      const pageCount = await page.evaluate(
        () => window.__docxAdapterDriver!.displaySnapshot().pageCount
      );
      expect(pageCount).toBeGreaterThan(0);
      expect(await page.locator('[data-page-index]').count()).toBe(pageCount);
      expect(await page.locator('[data-doc-from]').count()).toBeGreaterThan(0);
      const fontPaint = await page
        .locator('[data-doc-from]')
        .first()
        .evaluate((element) => {
          const run = element as HTMLElement;
          const paths = [...run.querySelectorAll('svg[aria-hidden="true"] path')].map((path) => ({
            d: path.getAttribute('d'),
            transform: path.getAttribute('transform'),
          }));
          return {
            paths,
            semanticText: run.querySelector('span')?.textContent,
            width: run.style.width,
            height: run.style.height,
          };
        });
      expect(fontPaint.paths.length).toBeGreaterThan(0);
      expect(fontPaint.paths.every(({ d, transform }) => d !== null && transform !== null)).toBe(
        true
      );
      expect(fontPaint.semanticText?.length).toBeGreaterThan(0);
      expect(Number.parseFloat(fontPaint.width)).toBeGreaterThan(0);
      expect(Number.parseFloat(fontPaint.height)).toBeGreaterThan(0);

      // The visible text includes the fixture's content (space-reconstructed from geometry).
      const text = await page.evaluate(() => window.__docxAdapterDriver!.displaySnapshot().text);
      expect(text).toContain('Edit me');

      // save() yields real DOCX bytes; save+reopen round-trips the same text.
      const saveLen = await page.evaluate(
        async () => (await window.__docxAdapterDriver!.save()).byteLength
      );
      expect(saveLen).toBeGreaterThan(0);
      const reopened = await page.evaluate(() => window.__docxAdapterDriver!.saveAndReopenText());
      expect(reopened).toContain('Edit me');
    });
  });
}
