import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import type { DocxEditorInstance } from '../packages/core/src/editor/docx-editor.ts';

declare global {
  interface Window {
    __dateRemount: { editor: DocxEditorInstance; release(): void; previous: Element };
  }
}

test('regional date input keeps its meaning when fonts replace the focused surface', async ({
  page,
}) => {
  await page.goto('http://localhost:5273/@vite/client');
  await page.evaluate(
    async (root) => {
      const { createDocxEditor } = await import(`${root}/packages/core/src/editor/docx-editor.ts`);
      const { formFieldDocx } = await import(
        `${root}/packages/core/src/editor/__tests__/form-field-docx.fixture.ts`
      );
      const { sha256FontBytes } = await import(`${root}/packages/core/src/layout/index.ts`);
      const bytes = new Uint8Array(
        await (
          await fetch(`${root}/packages/core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf`)
        ).arrayBuffer()
      );
      document.body.innerHTML = '<div id="editor" style="height:400px;overflow:auto"></div>';
      const container = document.getElementById('editor')!;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => {
        release = resolve;
      });
      const editor = createDocxEditor({
        container,
        document: formFieldDocx(true),
        locale: 'en-GB',
        fonts: async () => {
          await ready;
          return {
            sources: [
              {
                request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
                id: 'date-remount',
                bytes,
                hash: sha256FontBytes(bytes),
                faceIndex: 0,
              },
            ],
          };
        },
      });
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 10 },
      });
      window.__dateRemount = { editor, release, previous: container.querySelector('.docx-pages')! };
    },
    `/@fs/${resolve(import.meta.dirname, '..')}`
  );

  await page.keyboard.insertText('03/04/2030');
  await page.evaluate(() => window.__dateRemount.release());
  await page.waitForFunction(
    () =>
      !window.__dateRemount.previous.isConnected &&
      window.__dateRemount.editor.fontMeasurement().measurer === 'shaped'
  );
  await expect(page.locator('.docx-pages')).toBeFocused();
  await page.evaluate(() => {
    const surface = window.__dateRemount.editor.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    const position = { paragraphId, offset: 13 };
    surface.setSelection({ anchor: position, head: position });
  });
  expect(await page.evaluate(() => window.__dateRemount.editor.surface!.session.bodyText())).toBe(
    '04/03/2030 tail'
  );
  await page.evaluate(() => window.__dateRemount.editor.destroy());
});
