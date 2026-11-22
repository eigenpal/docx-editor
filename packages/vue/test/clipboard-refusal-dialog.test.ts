// A copy, cut, or paste that the editor refuses on a drawing shows its translated reason in the
// dialog a refused picture insert uses — parity with
// `packages/react/test/clipboard-refusal-dialog.test.tsx`.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { en } from '@docx-editor.dev/i18n';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import type { DocxEditorPopups } from '../src/editor/popup-config';
import { flush } from './helpers/fixtures.ts';
import {
  caretAtEndOf,
  decodePort,
  drawingDocument,
  pasteEvent,
  selectFixtureDrawing,
} from '../../core/src/editor/__tests__/drawing-image-paste-fixture.ts';

const unmounts: (() => void)[] = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  document.body.innerHTML = '';
});

const dialogs = () => document.querySelectorAll('[data-docx-dialog="imageInsertError"]');

async function mount(popups?: DocxEditorPopups) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ready: DocxEditorInstance[] = [];
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        {
          document: drawingDocument(),
          imageDecodePort: decodePort,
          ...(popups ? { popups } : {}),
          onReady: (editor: Editor) => {
            ready.push(editor as DocxEditorInstance);
          },
        },
        { default: () => h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }) }
      ),
  });
  app.mount(container);
  unmounts.push(() => {
    app.unmount();
    container.remove();
  });
  for (let attempt = 0; attempt < 50 && !ready.at(-1)?.surface; attempt++) await flush();
  const editor = ready.at(-1)!;
  for (let attempt = 0; attempt < 5; attempt++) {
    editor.surface!.layout();
    await flush();
  }
  return { container, editor };
}

const overlayOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.docx-image-selection-overlay');

async function selectShape(container: HTMLElement, editor: DocxEditorInstance) {
  selectFixtureDrawing(editor, 'shape');
  for (let attempt = 0; attempt < 50 && !overlayOf(container); attempt++) await flush();
  const overlay = overlayOf(container);
  if (!overlay) throw new Error('overlay missing');
  return overlay;
}

const textPaste = () => pasteEvent({ flavours: { 'text/plain': 'ZULU' } });

describe('a refused paste on a shape with no text', () => {
  test('from the overlay, shows the translated reason once and gives focus back', async () => {
    const { container, editor } = await mount();
    const overlay = await selectShape(container, editor);
    overlay.focus();
    overlay.dispatchEvent(textPaste());
    await flush();
    const shown = dialogs();
    expect(shown).toHaveLength(1);
    const dialog = shown[0]!;
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.getAttribute('aria-label')).toBe(en.clipboard.errors.pasteTitle);
    expect(dialog.textContent).toContain(en.disabledReason.shapePasteText);
    expect(dialog.textContent).not.toContain(en.imageInsert.errors.title);
    dialog.querySelector('button')!.click();
    await flush();
    expect(dialogs()).toHaveLength(0);
    // The shape stays selected, and the keyboard returns to its overlay.
    expect(editor.snapshot().image).not.toBeNull();
    expect(document.activeElement).toBe(overlayOf(container));
  });

  test('from the pages, shows the reason', async () => {
    const { container, editor } = await mount();
    await selectShape(container, editor);
    container.querySelector<HTMLElement>('.docx-pages')!.dispatchEvent(textPaste());
    await flush();
    expect(dialogs()).toHaveLength(1);
    expect(dialogs()[0]!.textContent).toContain(en.disabledReason.shapePasteText);
  });

  test('an earlier refusal does not show for a later paste that lands', async () => {
    const { container, editor } = await mount();
    const overlay = await selectShape(container, editor);
    overlay.dispatchEvent(textPaste());
    await flush();
    dialogs()[0]!.querySelector('button')!.click();
    caretAtEndOf(editor, 3);
    await flush();
    container.querySelector<HTMLElement>('.docx-pages')!.dispatchEvent(textPaste());
    await flush();
    expect(editor.findMatches('ZULU')).toHaveLength(1);
    expect(dialogs()).toHaveLength(0);
  });

  test('popups.imageInsertError receives the paste title and reason', async () => {
    const seen: { message: string; title?: string }[] = [];
    const { container, editor } = await mount({
      imageInsertError: (props) => {
        seen.push({ message: props.message, title: props.title });
        return null;
      },
    });
    const overlay = await selectShape(container, editor);
    overlay.dispatchEvent(textPaste());
    await flush();
    expect(seen.at(-1)).toEqual({
      message: en.disabledReason.shapePasteText,
      title: en.clipboard.errors.pasteTitle,
    });
  });
});
