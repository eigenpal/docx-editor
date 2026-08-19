import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorContextMenu } from '../src/editor/contextmenu/index.ts';
import { flush, SOURCE } from './helpers/fixtures.ts';

const t = (key: string): string => key;

function mountMenu() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ready: DocxEditorInstance[] = [];
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        {
          document: SOURCE,
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

  test('the default set is seven packaged rows ending with review.comments', async () => {
    const mounted = mountMenu();
    try {
      await flush();
      await openMenu(mounted.container);
      expect(rows(mounted.container).map((row) => row.dataset.slot)).toEqual([
        'edit.cut',
        'edit.copy',
        'edit.paste',
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
