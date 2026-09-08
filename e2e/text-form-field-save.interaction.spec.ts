import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type { DocxEditorInstance } from '../packages/core/src/editor/docx-editor.ts';

declare global {
  interface Window {
    __dateSave: DocxEditorInstance;
    __dateAutosaves: Promise<ArrayBuffer>[];
  }
}

async function openDateField(page: Page) {
  await page.goto('http://localhost:5273/@vite/client');
  await page.evaluate(
    async (root) => {
      const { createDocxEditor } = await import(`${root}/packages/core/src/editor/docx-editor.ts`);
      const { formFieldDocx } = await import(
        `${root}/packages/core/src/editor/__tests__/form-field-docx.fixture.ts`
      );
      const container = document.createElement('div');
      container.style.height = '400px';
      document.body.replaceChildren(container);
      const editor = createDocxEditor({
        container,
        document: formFieldDocx(true),
        locale: 'en-GB',
      });
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 10 },
      });
      window.__dateSave = editor;
    },
    `/@fs/${resolve(import.meta.dirname, '..')}`
  );
}

for (const changeLocale of [false, true]) {
  test(`save preserves an active regional date (locale changed: ${changeLocale})`, async ({
    page,
  }) => {
    await openDateField(page);
    await page.keyboard.insertText('03/04/2030');
    const result = await page.evaluate(async (changeLocale) => {
      const editor = window.__dateSave;
      if (changeLocale) editor.setLocale('en-US');
      const selection = editor.surface!.state().selection;
      const focused = document.activeElement;
      const bytes = await editor.save();
      const after = editor.surface!.state().selection;
      const keptFocus = document.activeElement === focused;
      editor.load(bytes);
      const text = editor.surface!.session.bodyText();
      editor.destroy();
      return { selection, after, keptFocus, text };
    }, changeLocale);
    expect(result.text).toBe('04/03/2030 tail');
    expect(result.after).toEqual(result.selection);
    expect(result.keptFocus).toBe(true);
  });
}

test('autosave retains invalid date input without opening a dialog', async ({ page }) => {
  await openDateField(page);
  await page.keyboard.insertText('invalid');
  const result = await page.evaluate(async () => {
    const editor = window.__dateSave;
    const focused = document.activeElement;
    const selection = editor.surface!.state().selection;
    let errorCode: string | undefined;
    try {
      await editor.save();
    } catch (error) {
      errorCode = (error as { code?: string }).code;
    }
    return {
      errorCode,
      selection,
      after: editor.surface!.state().selection,
      text: editor.surface!.session.bodyText(),
      keptFocus: document.activeElement === focused,
    };
  });
  expect(result.errorCode).toBe('invalidArgs');
  expect(result.text).toBe('invalid tail');
  expect(result.after).toEqual(result.selection);
  expect(result.keptFocus).toBe(true);
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.evaluate(() => window.__dateSave.destroy());
});

test('autosave from a change callback preserves the caret through undo', async ({ page }) => {
  await openDateField(page);
  await page.evaluate(() => {
    window.__dateAutosaves = [];
    let calls = 0;
    window.__dateSave.on('change', () => {
      if (calls++ < 2) window.__dateAutosaves.push(window.__dateSave.save());
    });
  });
  await page.keyboard.insertText('3/4/30');
  await page.waitForFunction(() => window.__dateAutosaves.length > 0);
  const result = await page.evaluate(async () => {
    await Promise.all(window.__dateAutosaves);
    const editor = window.__dateSave;
    const text = editor.surface!.session.bodyText();
    const caret = editor.surface!.state().selection.head.offset;
    editor.surface!.undo();
    return {
      text,
      caret,
      restoredText: editor.surface!.session.bodyText(),
      restoredCaret: editor.surface!.state().selection.head.offset,
    };
  });
  expect(result).toEqual({
    text: '04/03/1930 tail',
    caret: 10,
    restoredText: '3/4/30 tail',
    restoredCaret: 6,
  });
  await expect(page.locator('.docx-pages')).toBeFocused();
  await page.evaluate(() => window.__dateSave.destroy());
});
