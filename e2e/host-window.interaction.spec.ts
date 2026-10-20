import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('a live editor keeps edits and history across a popup and an iframe', async ({ page }) => {
  await page.goto('http://localhost:5273/@vite/client');
  const result = await page.evaluate(
    async (root) => {
      const { createDocxEditor } = await import(`${root}/packages/core/src/editor/docx-editor.ts`);
      const { openEditorWindow } = await import(
        `${root}/packages/core/src/editor/editor-window.ts`
      );
      const { refreshFixture } = await import(`${root}/examples/shared/refresh-demo-fixture.ts`);
      const home = document.createElement('div');
      document.body.replaceChildren(home);
      const editor = createDocxEditor({ container: home, document: refreshFixture() });
      const before = editor.surface.session.bodyText();
      const inserted = editor.exec({ type: 'insertText', text: 'Window edit ' });
      const after = editor.surface.session.bodyText();
      const selection = JSON.stringify(editor.snapshot().selection);
      const surface = editor.surface;
      const popup = await openEditorWindow({ name: 'release-window-check', styles: false });
      if (!popup) throw new Error('The popup did not open');
      const iframe = document.createElement('iframe');
      try {
        popup.onClose(() => editor.attach(home));
        editor.attach(popup.element);
        const moved =
          popup.element.querySelector('.docx-pages')?.ownerDocument === popup.window.document;
        const sameSelection = JSON.stringify(editor.snapshot().selection) === selection;
        const undo = editor.exec({ type: 'undo' });
        const undone = editor.surface.session.bodyText() === before;
        const redo = editor.exec({ type: 'redo' });
        const redone = editor.surface.session.bodyText() === after;
        popup.close();
        const returned = home.querySelector('.docx-pages')?.ownerDocument === document;
        document.body.append(iframe);
        const frameBody = iframe.contentDocument!.body;
        editor.attach(frameBody);
        const framed =
          frameBody.querySelector('.docx-pages')?.ownerDocument === iframe.contentDocument;
        editor.detach();
        const saved = await editor.save();
        editor.attach(home);
        return {
          inserted: inserted.ok,
          changed: after !== before,
          moved,
          sameSelection,
          undo: undo.ok,
          undone,
          redo: redo.ok,
          redone,
          returned,
          framed,
          sameSurface: editor.surface === surface,
          saved: saved.byteLength > 0,
          retained: editor.surface.session.bodyText() === after,
        };
      } finally {
        popup.close();
        editor.destroy();
        iframe.remove();
      }
    },
    `/@fs/${resolve(import.meta.dirname, '..')}`
  );
  for (const [name, value] of Object.entries(result)) expect(value, name).toBe(true);
});
