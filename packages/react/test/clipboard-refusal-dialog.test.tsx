// A copy, cut, or paste that the editor refuses on a drawing shows its translated reason in the
// dialog a refused picture insert uses: from the pages and from the selection overlay, once
// per refused event, and never for an earlier action. The Vue twin is
// `packages/vue/test/clipboard-refusal-dialog.test.ts`.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { en } from '@docx-editor.dev/i18n';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import type { DocxEditorPopups } from '../src/editor/popup-config';
import {
  caretAtEndOf,
  decodePort,
  drawingDocument,
  pasteEvent,
  selectFixtureDrawing,
} from '../../core/src/editor/__tests__/drawing-image-paste-fixture.ts';

afterEach(cleanup);

const dialogs = () => document.querySelectorAll('[data-docx-dialog="imageInsertError"]');

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(popups?: DocxEditorPopups) {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={drawingDocument()}
      imageDecodePort={decodePort}
      popups={popups}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  for (let attempt = 0; attempt < 50 && !instance?.surface; attempt++) await settle();
  for (let attempt = 0; attempt < 5; attempt++) {
    instance!.surface!.layout();
    await settle();
  }
  return { view, editor: instance! };
}

const overlayOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.docx-image-selection-overlay');

async function selectShape(container: HTMLElement, editor: DocxEditorInstance) {
  await act(async () => {
    selectFixtureDrawing(editor, 'shape');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  for (let attempt = 0; attempt < 50 && !overlayOf(container); attempt++) await settle();
  const overlay = overlayOf(container);
  if (!overlay) throw new Error('overlay missing');
  return overlay;
}

const textPaste = () => pasteEvent({ flavours: { 'text/plain': 'ZULU' } });

describe('a refused paste on a shape with no text', () => {
  test('from the overlay, shows the translated reason once and gives focus back', async () => {
    const { view, editor } = await mount();
    const overlay = await selectShape(view.container, editor);
    overlay.focus();
    act(() => {
      overlay.dispatchEvent(textPaste());
    });
    await settle();
    const shown = dialogs();
    expect(shown).toHaveLength(1);
    const dialog = shown[0]!;
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.getAttribute('aria-label')).toBe(en.clipboard.errors.pasteTitle);
    expect(dialog.textContent).toContain(en.disabledReason.shapePasteText);
    expect(dialog.textContent).not.toContain(en.imageInsert.errors.title);
    act(() => {
      fireEvent.click(dialog.querySelector('button')!);
    });
    await settle();
    expect(dialogs()).toHaveLength(0);
    // The shape stays selected, and the keyboard returns to its overlay.
    expect(editor.snapshot().image).not.toBeNull();
    expect(document.activeElement).toBe(overlayOf(view.container));
  });

  test('from the pages, shows the reason', async () => {
    const { view, editor } = await mount();
    await selectShape(view.container, editor);
    const pages = view.container.querySelector<HTMLElement>('.docx-pages')!;
    act(() => {
      pages.dispatchEvent(textPaste());
    });
    await settle();
    expect(dialogs()).toHaveLength(1);
    expect(dialogs()[0]!.textContent).toContain(en.disabledReason.shapePasteText);
  });

  test('an earlier refusal does not show for a later paste that lands', async () => {
    const { view, editor } = await mount();
    const overlay = await selectShape(view.container, editor);
    act(() => {
      overlay.dispatchEvent(textPaste());
    });
    await settle();
    act(() => {
      fireEvent.click(dialogs()[0]!.querySelector('button')!);
    });
    act(() => caretAtEndOf(editor, 3));
    await settle();
    const pages = view.container.querySelector<HTMLElement>('.docx-pages')!;
    act(() => {
      pages.dispatchEvent(textPaste());
    });
    await settle();
    expect(editor.findMatches('ZULU')).toHaveLength(1);
    expect(dialogs()).toHaveLength(0);
  });

  test('popups.imageInsertError receives the paste title and reason', async () => {
    const seen: { message: string; title?: string }[] = [];
    const { view, editor } = await mount({
      imageInsertError: (props) => {
        seen.push({ message: props.message, title: props.title });
        return null;
      },
    });
    const overlay = await selectShape(view.container, editor);
    act(() => {
      overlay.dispatchEvent(textPaste());
    });
    await settle();
    expect(seen.at(-1)).toEqual({
      message: en.disabledReason.shapePasteText,
      title: en.clipboard.errors.pasteTitle,
    });
  });
});
