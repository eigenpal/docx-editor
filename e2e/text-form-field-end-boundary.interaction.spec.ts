import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import type { DocxEditorInstance } from '../packages/core/src/editor/docx-editor.ts';

declare global {
  interface Window {
    __fieldBoundaryEditor: DocxEditorInstance;
  }
}

for (const navigation of ['paragraph-end', 'collapse-field'] as const) {
  test(`typing after a text form stays outside via ${navigation}`, async ({ page }) => {
    await page.goto('http://localhost:5273/@vite/client');
    await page.evaluate(
      async (root) => {
        const { createDocxEditor } = await import(
          `${root}/packages/core/src/editor/docx-editor.ts`
        );
        const bytes = new Uint8Array(
          await (
            await fetch(`${root}/e2e/fixtures/text-form-field-end-boundary.docx`)
          ).arrayBuffer()
        );
        const container = document.createElement('div');
        document.body.append(container);
        const editor = createDocxEditor({ container, document: bytes });
        const paragraphId = editor.surface!.session.paragraphIds()[0]!;
        editor.surface!.setSelection({
          anchor: { paragraphId, offset: 0 },
          head: { paragraphId, offset: 22 },
        });
        window.__fieldBoundaryEditor = editor;
      },
      `/@fs/${resolve(import.meta.dirname, '..')}`
    );

    await page.keyboard.press(navigation === 'paragraph-end' ? 'ControlOrMeta+End' : 'ArrowRight');
    expect(
      await page.evaluate(() => window.__fieldBoundaryEditor.surface!.state().selection.head.offset)
    ).toBe(22);
    await page.keyboard.type('BOUNDARY');
    const field = page.locator('[data-field-atom="form"]');
    await expect
      .poll(async () => (await field.allTextContents()).join(''))
      .toBe('Just a text form field');
    expect(
      await page.evaluate(() => window.__fieldBoundaryEditor.surface!.session.bodyText())
    ).toBe('Just a text form fieldBOUNDARY');
    await expect(
      page.locator('[data-field-atom="form"][data-text-form-selection="caret"]')
    ).toHaveCount(0);

    await page.evaluate(() => window.__fieldBoundaryEditor.surface!.undo());
    expect(
      await page.evaluate(() => window.__fieldBoundaryEditor.surface!.session.bodyText())
    ).toBe('Just a text form field');
    await expect
      .poll(async () => (await field.allTextContents()).join(''))
      .toBe('Just a text form field');
    await page.evaluate(() => window.__fieldBoundaryEditor.surface!.redo());
    expect(
      await page.evaluate(() => window.__fieldBoundaryEditor.surface!.session.bodyText())
    ).toBe('Just a text form fieldBOUNDARY');
    await expect
      .poll(async () => (await field.allTextContents()).join(''))
      .toBe('Just a text form field');

    const result = await page.evaluate(
      async (root) => {
        const { createDocxEditor } = await import(
          `${root}/packages/core/src/editor/docx-editor.ts`
        );
        const { findNode, textFormFieldsOf } = await import(
          `${root}/packages/core/src/store/index.ts`
        );
        const original = window.__fieldBoundaryEditor;
        const bytes = await original.save();
        original.destroy();
        const container = document.createElement('div');
        document.body.append(container);
        const reopened = createDocxEditor({ container, document: bytes });
        const session = reopened.surface!.session;
        const paragraph = findNode(session.part(), session.paragraphIds()[0]!);
        const result = {
          text: session.bodyText(),
          end: paragraph?.kind === 'paragraph' ? textFormFieldsOf(paragraph)[0]?.end : null,
        };
        reopened.destroy();
        return result;
      },
      `/@fs/${resolve(import.meta.dirname, '..')}`
    );
    expect(result).toEqual({ text: 'Just a text form fieldBOUNDARY', end: 22 });
  });
}
