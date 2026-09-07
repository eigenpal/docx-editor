import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import type { DocxEditorInstance } from '../packages/core/src/editor/docx-editor.ts';

// Real Chromium is required: happy-dom does not move focus when setBaseAndExtent
// writes a selection into a contenteditable. Gate the resolver so the remount
// happens after the focus transfer, independently of network/CI timing.
declare global {
  interface Window {
    __fontFocus: {
      editor: DocxEditorInstance;
      releaseFonts(): void;
      oldPages: Element;
    };
  }
}

for (const target of ['textarea', 'input', 'button', 'button-empty-selection', 'editor'] as const) {
  test(`font remount preserves ${target} focus and the saved editor range`, async ({ page }) => {
    await page.goto('http://localhost:5273/@vite/client');
    await page.evaluate(
      async (root) => {
        const { createDocxEditor } = await import(
          `${root}/packages/core/src/editor/docx-editor.ts`
        );
        const { blankDocumentBytes } = await import(
          `${root}/packages/core/src/editor/blank-document.ts`
        );
        const { sha256FontBytes } = await import(`${root}/packages/core/src/layout/index.ts`);
        const bytes = new Uint8Array(
          await (
            await fetch(`${root}/packages/core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf`)
          ).arrayBuffer()
        );
        document.body.innerHTML =
          '<div id="editor"></div><textarea id="box"></textarea><input id="input"><button id="button">Outside</button>';
        const container = document.getElementById('editor')!;
        container.style.height = '400px';
        container.style.overflow = 'auto';
        let releaseFonts!: () => void;
        const ready = new Promise<void>((resolve) => {
          releaseFonts = resolve;
        });
        const editor = createDocxEditor({
          container,
          document: blankDocumentBytes(),
          fonts: async () => {
            await ready;
            return {
              sources: [
                {
                  request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
                  id: 'focus-test',
                  bytes,
                  hash: sha256FontBytes(bytes),
                  faceIndex: 0,
                },
              ],
            };
          },
        });
        const surface = editor.surface!;
        surface.type('Contratto di locazione');
        const paragraphId = surface.session.paragraphIds()[0]!;
        surface.setSelection({
          anchor: { paragraphId, offset: 3 },
          head: { paragraphId, offset: 8 },
        });
        window.__fontFocus = {
          editor,
          releaseFonts,
          oldPages: container.querySelector('.docx-pages')!,
        };
      },
      `/@fs/${resolve(import.meta.dirname, '..')}`
    );

    const selector =
      target === 'editor'
        ? '.docx-pages'
        : target === 'textarea'
          ? '#box'
          : target === 'input'
            ? '#input'
            : '#button';
    await page.locator(selector).focus();
    if (target === 'button-empty-selection') {
      await page.evaluate(() => document.getSelection()?.removeAllRanges());
    }
    const before = await page.evaluate(() => window.__fontFocus.editor.surface!.state().selection);
    await page.evaluate(() => window.__fontFocus.releaseFonts());
    await page.waitForFunction(
      () =>
        !window.__fontFocus.oldPages.isConnected &&
        window.__fontFocus.editor.fontMeasurement().measurer === 'shaped' &&
        !window.__fontFocus.editor.fontMeasurement().resolving
    );
    await expect(page.locator(selector)).toBeFocused();
    expect(await page.evaluate(() => window.__fontFocus.editor.surface!.state().selection)).toEqual(
      before
    );
    if (target === 'editor') {
      expect(await page.evaluate(() => document.getSelection()?.toString())).toBe('tratt');
    } else if (target === 'textarea' || target === 'input') {
      await page.keyboard.press('Delete');
      await page.keyboard.type('hello');
      await expect(page.locator(selector)).toHaveValue('hello');
      expect(await page.evaluate(() => window.__fontFocus.editor.surface!.session.bodyText())).toBe(
        'Contratto di locazione'
      );
    }
    await page.evaluate(() => window.__fontFocus.editor.destroy());
  });
}
