import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorContextMenu } from '../src/editor/contextmenu/index.ts';
import { flush, SOURCE, docx } from './helpers/fixtures.ts';

const t = (key: string): string => key;

function mountMenu(source = SOURCE) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ready: DocxEditorInstance[] = [];
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        {
          document: source,
          onReady: (editor: Editor) => {
            ready.push(editor as DocxEditorInstance);
          },
        },
        {
          default: () =>
            h(DocxEditorViewport, null, {
              default: () => [h(DocxEditorContent), h(DocxEditorContextMenu, { t })],
            }),
        }
      ),
  });
  app.mount(container);
  return {
    container,
    editor: () => ready.at(-1)!,
    unmount: () => {
      app.unmount();
      container.remove();
    },
  };
}

function panel(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.docx-contextmenu');
}

function rows(container: HTMLElement): HTMLElement[] {
  const open = panel(container);
  return open
    ? [
        ...open.querySelectorAll<HTMLElement>(
          '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'
        ),
      ]
    : [];
}

async function openMenu(container: HTMLElement): Promise<void> {
  const scroller = container.querySelector('.docx-editor__scroll-container');
  if (!scroller) throw new Error('no scroll container');
  scroller.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 140,
      button: 2,
    })
  );
  await flush();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DocxEditorContextMenu', () => {
  test('right-click opens the panel on the first open', async () => {
    const mounted = mountMenu();
    try {
      await flush();
      expect(mounted.editor().surface).toBeTruthy();
      expect(panel(mounted.container)).toBeNull();
      await openMenu(mounted.container);
      expect(panel(mounted.container)?.style.left).toBe('120px');
      expect(panel(mounted.container)?.style.top).toBe('140px');
    } finally {
      mounted.unmount();
    }
  });

  test('the default set is the packaged rows, ending with review.comments', async () => {
    const mounted = mountMenu();
    try {
      await flush();
      await openMenu(mounted.container);
      expect(rows(mounted.container).map((row) => row.dataset.slot)).toEqual([
        'edit.cut',
        'edit.copy',
        'edit.paste',
        'edit.pasteWithoutFormatting',
        'format.copyFormatting',
        'format.pasteFormatting',
        'edit.delete',
        'edit.selectAll',
        'text.link',
        'review.comments',
      ]);
    } finally {
      mounted.unmount();
    }
  });

  test('review.comments row is present for Add a comment entry point', async () => {
    const mounted = mountMenu();
    try {
      await flush();
      await openMenu(mounted.container);
      const commentRow = mounted.container.querySelector('[data-slot="review.comments"]');
      expect(commentRow?.textContent).toContain('comments.addComment');
    } finally {
      mounted.unmount();
    }
  });
});


test('Vue field context action opens and saves the shared options dialog', async () => {
  const host = mountMenu(docx('<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:textInput><w:default w:val="Sample"/></w:textInput></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Sample</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'));
  try {
    await flush();
    const field = host.container.querySelector<HTMLElement>('[data-field-atom="form"]')!;
    field.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: 30, clientY: 30 }));
    await flush();
    const action = host.container.querySelector<HTMLElement>('[data-slot="field.edit"]')!;
    expect(action).not.toBeNull(); action.click(); await flush();
    const dialog = host.container.querySelector('dialog')!; expect(dialog).not.toBeNull();
    const [type, format] = dialog.querySelectorAll('select');
    const [text, max, enabled] = dialog.querySelectorAll('input');
    type!.value = 'regular'; type!.dispatchEvent(new Event('change'));
    text!.value = 'hello'; max!.value = '5'; format!.value = 'Uppercase'; enabled!.checked = false;
    dialog.querySelectorAll('button')[1]!.click(); await flush();
    expect(host.container.querySelector('dialog')).toBeNull();
    expect(host.container.querySelector('[data-field-atom="form"]')?.textContent).toBe('HELLO');
  } finally { host.unmount(); }
});
