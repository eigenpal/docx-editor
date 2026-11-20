// Pasting an image file while a picture, shape or text box is selected. Focus sits on the
// selection overlay, beside the pages, so the overlay runs the image-file lane itself. The
// overlay also forwards copy, cut and paste to the editor, bound for exactly its lifetime.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { en } from '@docx-editor.dev/i18n';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import {
  caretAtEndOf,
  decodePort,
  drawingDocument,
  pasteEvent,
  picturesPerParagraph,
  savedDocumentXml,
  selectFixtureDrawing,
  type DrawingKind,
} from '../../core/src/editor/__tests__/drawing-image-paste-fixture.ts';
import { stubReviewModule } from '../../core/src/editor/__tests__/review-test-module.ts';

afterEach(cleanup);

/** Any refusal dialog the editor shows. */
const DIALOG = '[role="dialog"], [role="alertdialog"]';

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(options: { strict?: boolean } = {}) {
  let instance: DocxEditorInstance | null = null;
  const tree: ReactNode = (
    <DocxEditorRoot
      document={drawingDocument()}
      author="Reviewer"
      modules={[stubReviewModule()]}
      imageDecodePort={decodePort}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const view = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
  for (let attempt = 0; attempt < 50 && !instance?.surface; attempt++) await settle();
  for (let attempt = 0; attempt < 5; attempt++) {
    instance!.surface!.layout();
    await settle();
  }
  return { view, editor: instance! };
}

const overlayOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.docx-image-selection-overlay');

async function select(container: HTMLElement, editor: DocxEditorInstance, kind: DrawingKind) {
  let paragraph = -1;
  await act(async () => {
    paragraph = selectFixtureDrawing(editor, kind);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  for (let attempt = 0; attempt < 50 && !overlayOf(container); attempt++) await settle();
  const overlay = overlayOf(container);
  if (!overlay) throw new Error('overlay missing');
  return { overlay, paragraph };
}

async function pictures(editor: DocxEditorInstance): Promise<number[]> {
  let xml = '';
  await act(async () => {
    xml = await savedDocumentXml(editor);
  });
  return picturesPerParagraph(xml);
}

/** Wait until the saved document holds `total` pictures, then a little longer for extras. */
async function picturesOnceSettled(editor: DocxEditorInstance, total: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const counts = await pictures(editor);
    if (counts.reduce((sum, count) => sum + count, 0) >= total) break;
    await settle();
  }
  for (let attempt = 0; attempt < 5; attempt++) await settle();
  return pictures(editor);
}

describe('an image file pasted while a drawing is selected', () => {
  for (const kind of ['picture', 'shape', 'textBox'] as const) {
    test(`inserts one picture at the selected ${kind}'s anchor`, async () => {
      const { view, editor } = await mount();
      const before = await pictures(editor);
      expect(before).toEqual([1, 0, 0, 0]);
      const { overlay, paragraph } = await select(view.container, editor, kind);
      let reads = 0;
      const event = pasteEvent({ file: true, onFileRead: () => (reads += 1) });
      act(() => {
        overlay.dispatchEvent(event);
      });
      // The image-file lane read the file once: the engine alone would not.
      expect(reads).toBe(1);
      const after = await picturesOnceSettled(editor, 2);
      const expected = [...before];
      expected[paragraph]! += 1;
      expect(after).toEqual(expected);
      // The overlay unmounts with the selection, and the text takes the keyboard.
      await settle();
      expect(overlayOf(view.container)).toBeNull();
      const pages = view.container.querySelector('.docx-pages')!;
      expect(pages.contains(document.activeElement)).toBe(true);
      expect(document.querySelector(DIALOG)).toBeNull();
    });
  }

  test('reports the suggesting-mode refusal in a dialog, and inserts nothing', async () => {
    const { view, editor } = await mount();
    act(() => {
      expect(editor.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
    });
    await settle();
    const { overlay } = await select(view.container, editor, 'picture');
    let reads = 0;
    const event = pasteEvent({ file: true, onFileRead: () => (reads += 1) });
    act(() => {
      overlay.dispatchEvent(event);
    });
    // The image-file lane takes the paste and reports the refusal without a file read.
    expect(event.defaultPrevented).toBe(true);
    expect(reads).toBe(0);
    let dialog: Element | null = null;
    for (let attempt = 0; attempt < 100 && !dialog; attempt++) {
      await settle();
      dialog = document.querySelector(DIALOG);
    }
    expect(dialog?.textContent).toContain(en.disabledReason.pictureSelected);
    expect(await pictures(editor)).toEqual([1, 0, 0, 0]);
  });

  test('inserts one picture at the caret when the caret is in text', async () => {
    const { view, editor } = await mount();
    act(() => caretAtEndOf(editor, 3));
    await settle();
    expect(overlayOf(view.container)).toBeNull();
    const pages = view.container.querySelector<HTMLElement>('.docx-pages')!;
    act(() => {
      pages.dispatchEvent(pasteEvent({ file: true }));
    });
    expect(await picturesOnceSettled(editor, 2)).toEqual([1, 0, 0, 1]);
    expect(document.querySelector(DIALOG)).toBeNull();
  });

  test('pastes text, not the file, when the clipboard holds visible text beside it', async () => {
    let reads = 0;
    const { view, editor } = await mount();
    const { overlay } = await select(view.container, editor, 'picture');
    act(() => {
      overlay.dispatchEvent(
        pasteEvent({
          file: true,
          flavours: { 'text/plain': 'Pasted' },
          onFileRead: () => (reads += 1),
        })
      );
    });
    await settle();
    expect(editor.findMatches('Pasted')).toHaveLength(1);
    // The engine pasted the text; the image-file lane never read the file.
    expect(reads).toBe(0);
    expect(await picturesOnceSettled(editor, 2)).toEqual([1, 0, 0, 0]);
  });

  test('still pastes text and a copied drawing from the overlay', async () => {
    const { view, editor } = await mount();
    let { overlay } = await select(view.container, editor, 'textBox');
    act(() => {
      overlay.dispatchEvent(pasteEvent({ flavours: { 'text/plain': 'Typed' } }));
    });
    await settle();
    expect(editor.findMatches('Typed')).toHaveLength(1);

    ({ overlay } = await select(view.container, editor, 'picture'));
    const copy = editor.surface!.copyFlavours();
    expect(copy.drawingNodeId).toBeString();
    act(() => {
      overlay.dispatchEvent(
        pasteEvent({ flavours: { 'text/plain': copy.text, 'text/html': copy.html! } })
      );
    });
    expect(await picturesOnceSettled(editor, 2)).toEqual([2, 0, 0, 0]);
  });

  test('does nothing while the document is open for viewing', async () => {
    const { view, editor } = await mount();
    const { overlay } = await select(view.container, editor, 'picture');
    act(() => {
      expect(editor.exec({ type: 'setEditingMode', mode: 'viewing' }).ok).toBe(true);
    });
    await settle();
    const event = pasteEvent({ file: true });
    act(() => {
      (overlayOf(view.container) ?? overlay).dispatchEvent(event);
    });
    expect(await picturesOnceSettled(editor, 2)).toEqual([1, 0, 0, 0]);
    // No refusal dialog: a paste the editor cannot take stays silent, as it does in text.
    expect(document.querySelector(DIALOG)).toBeNull();
  });
});

describe('the overlay clipboard binding', () => {
  /** A copy event that counts the flavours the editor writes. */
  function copyEvent() {
    const written: string[] = [];
    const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: {
        setData: (type: string) => written.push(type),
        getData: () => '',
        types: [],
        items: [],
        files: [],
      },
    });
    return { event, written };
  }

  for (const strict of [false, true]) {
    test(`binds once on mount, rebinds a new overlay, and unbinds${strict ? ' under StrictMode' : ''}`, async () => {
      const { view, editor } = await mount({ strict });
      const first = (await select(view.container, editor, 'picture')).overlay;
      const copied = copyEvent();
      act(() => {
        first.dispatchEvent(copied.event);
      });
      // One binding writes each flavour once; a doubled one writes them twice.
      expect(copied.written).toEqual(['text/plain', 'text/html']);
      expect(copied.event.defaultPrevented).toBe(true);

      // Ending the selection removes the overlay and its listeners.
      act(() => caretAtEndOf(editor, 3));
      await settle();
      expect(overlayOf(view.container)).toBeNull();
      const stale = copyEvent();
      first.dispatchEvent(stale.event);
      expect(stale.written).toEqual([]);

      // A new overlay element is bound in turn.
      const second = (await select(view.container, editor, 'shape')).overlay;
      expect(second).not.toBe(first);
      const again = copyEvent();
      act(() => {
        second.dispatchEvent(again.event);
      });
      expect(again.written).toEqual(['text/plain', 'text/html']);

      // Unmounting the editor removes the binding too.
      view.unmount();
      const afterUnmount = copyEvent();
      second.dispatchEvent(afterUnmount.event);
      expect(afterUnmount.written).toEqual([]);
    });
  }
});
