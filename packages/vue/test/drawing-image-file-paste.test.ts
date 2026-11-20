// Pasting an image file while a picture, shape or text box is selected — parity with the React
// adapter. Focus sits on the selection overlay, beside the pages, so the overlay runs the
// image-file lane itself. The overlay also forwards copy, cut and paste to the editor, bound for
// exactly its lifetime.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h, nextTick } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { en } from '@docx-editor.dev/i18n';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { flush } from './helpers/fixtures.ts';
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

/** Any refusal dialog the editor shows. */
const DIALOG = '[role="dialog"], [role="alertdialog"]';

const unmounts: (() => void)[] = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  document.body.innerHTML = '';
});

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ready: DocxEditorInstance[] = [];
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        {
          document: drawingDocument(),
          author: 'Reviewer',
          modules: [stubReviewModule()],
          imageDecodePort: decodePort,
          onReady: (editor: Editor) => {
            ready.push(editor as DocxEditorInstance);
          },
        },
        { default: () => h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }) }
      ),
  });
  app.mount(container);
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    app.unmount();
    container.remove();
  };
  unmounts.push(unmount);
  for (let attempt = 0; attempt < 50 && !ready.at(-1)?.surface; attempt++) await flush();
  const editor = ready.at(-1)!;
  for (let attempt = 0; attempt < 5; attempt++) {
    editor.surface!.layout();
    await flush();
  }
  return { container, editor, unmount };
}

const overlayOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.docx-image-selection-overlay');

async function select(container: HTMLElement, editor: DocxEditorInstance, kind: DrawingKind) {
  const paragraph = selectFixtureDrawing(editor, kind);
  for (let attempt = 0; attempt < 50 && !overlayOf(container); attempt++) await flush();
  const overlay = overlayOf(container);
  if (!overlay) throw new Error('overlay missing');
  return { overlay, paragraph };
}

async function pictures(editor: DocxEditorInstance): Promise<number[]> {
  return picturesPerParagraph(await savedDocumentXml(editor));
}

/** One short turn: `flush` waits 150 ms, too long to poll with. */
async function tick(): Promise<void> {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Wait until the saved document holds `total` pictures, then a little longer for extras. */
async function picturesOnceSettled(editor: DocxEditorInstance, total: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const counts = await pictures(editor);
    if (counts.reduce((sum, count) => sum + count, 0) >= total) break;
    await tick();
  }
  await flush();
  return pictures(editor);
}

describe('an image file pasted while a drawing is selected', () => {
  for (const kind of ['picture', 'shape', 'textBox'] as const) {
    test(`inserts one picture at the selected ${kind}'s anchor`, async () => {
      const { container, editor } = await mount();
      const before = await pictures(editor);
      expect(before).toEqual([1, 0, 0, 0]);
      const { overlay, paragraph } = await select(container, editor, kind);
      let reads = 0;
      const event = pasteEvent({ file: true, onFileRead: () => (reads += 1) });
      overlay.dispatchEvent(event);
      // The image-file lane read the file once: the engine alone would not.
      expect(reads).toBe(1);
      const after = await picturesOnceSettled(editor, 2);
      const expected = [...before];
      expected[paragraph]! += 1;
      expect(after).toEqual(expected);
      // The overlay unmounts with the selection, and the text takes the keyboard.
      await flush();
      expect(overlayOf(container)).toBeNull();
      const pages = container.querySelector('.docx-pages')!;
      expect(pages.contains(document.activeElement)).toBe(true);
      expect(document.querySelector(DIALOG)).toBeNull();
    });
  }

  test('reports the suggesting-mode refusal in a dialog, and inserts nothing', async () => {
    const { container, editor } = await mount();
    expect(editor.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
    await flush();
    const { overlay } = await select(container, editor, 'picture');
    let reads = 0;
    const event = pasteEvent({ file: true, onFileRead: () => (reads += 1) });
    overlay.dispatchEvent(event);
    // The image-file lane takes the paste and reports the refusal without a file read.
    expect(event.defaultPrevented).toBe(true);
    expect(reads).toBe(0);
    let dialog: Element | null = null;
    for (let attempt = 0; attempt < 100 && !dialog; attempt++) {
      await tick();
      dialog = document.querySelector(DIALOG);
    }
    expect(dialog?.textContent).toContain(en.disabledReason.pictureSelected);
    expect(await pictures(editor)).toEqual([1, 0, 0, 0]);
  });

  test('inserts one picture at the caret when the caret is in text', async () => {
    const { container, editor } = await mount();
    caretAtEndOf(editor, 3);
    await flush();
    expect(overlayOf(container)).toBeNull();
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    pages.dispatchEvent(pasteEvent({ file: true }));
    expect(await picturesOnceSettled(editor, 2)).toEqual([1, 0, 0, 1]);
    expect(document.querySelector(DIALOG)).toBeNull();
  });

  test('pastes text, not the file, when the clipboard holds visible text beside it', async () => {
    let reads = 0;
    const { container, editor } = await mount();
    const { overlay } = await select(container, editor, 'picture');
    overlay.dispatchEvent(
      pasteEvent({
        file: true,
        flavours: { 'text/plain': 'Pasted' },
        onFileRead: () => (reads += 1),
      })
    );
    await flush();
    expect(editor.findMatches('Pasted')).toHaveLength(1);
    // The engine pasted the text; the image-file lane never read the file.
    expect(reads).toBe(0);
    expect(await picturesOnceSettled(editor, 2)).toEqual([1, 0, 0, 0]);
  });

  test('still pastes text and a copied drawing from the overlay', async () => {
    const { container, editor } = await mount();
    let { overlay } = await select(container, editor, 'textBox');
    overlay.dispatchEvent(pasteEvent({ flavours: { 'text/plain': 'Typed' } }));
    await flush();
    expect(editor.findMatches('Typed')).toHaveLength(1);

    ({ overlay } = await select(container, editor, 'picture'));
    const copy = editor.surface!.copyFlavours();
    expect(copy.drawingNodeId).toBeString();
    overlay.dispatchEvent(
      pasteEvent({ flavours: { 'text/plain': copy.text, 'text/html': copy.html! } })
    );
    expect(await picturesOnceSettled(editor, 2)).toEqual([2, 0, 0, 0]);
  });

  test('does nothing while the document is open for viewing', async () => {
    const { container, editor } = await mount();
    const { overlay } = await select(container, editor, 'picture');
    expect(editor.exec({ type: 'setEditingMode', mode: 'viewing' }).ok).toBe(true);
    await flush();
    (overlayOf(container) ?? overlay).dispatchEvent(pasteEvent({ file: true }));
    expect(await picturesOnceSettled(editor, 2)).toEqual([1, 0, 0, 0]);
    // No refusal dialog: a paste the editor cannot take stays silent, as it does in text.
    expect(document.querySelector('[role="alertdialog"], [role="dialog"]')).toBeNull();
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

  test('binds once on mount, rebinds a new overlay, and unbinds', async () => {
    const { container, editor, unmount } = await mount();
    const first = (await select(container, editor, 'picture')).overlay;
    const copied = copyEvent();
    first.dispatchEvent(copied.event);
    // One binding writes each flavour once; a doubled one writes them twice.
    expect(copied.written).toEqual(['text/plain', 'text/html']);
    expect(copied.event.defaultPrevented).toBe(true);

    // Ending the selection removes the overlay and its listeners.
    caretAtEndOf(editor, 3);
    await flush();
    expect(overlayOf(container)).toBeNull();
    const stale = copyEvent();
    first.dispatchEvent(stale.event);
    expect(stale.written).toEqual([]);

    // A new overlay element is bound in turn.
    const second = (await select(container, editor, 'shape')).overlay;
    expect(second).not.toBe(first);
    const again = copyEvent();
    second.dispatchEvent(again.event);
    expect(again.written).toEqual(['text/plain', 'text/html']);

    // Unmounting the editor removes the binding too.
    unmount();
    const afterUnmount = copyEvent();
    second.dispatchEvent(afterUnmount.event);
    expect(afterUnmount.written).toEqual([]);
  });

  test('removes the image-file paste listener with the overlay', async () => {
    const { container, editor } = await mount();
    const first = (await select(container, editor, 'picture')).overlay;
    caretAtEndOf(editor, 3);
    await flush();
    expect(overlayOf(container)).toBeNull();
    // The removed overlay no longer takes an image file.
    let staleReads = 0;
    const stale = pasteEvent({ file: true, onFileRead: () => (staleReads += 1) });
    first.dispatchEvent(stale);
    expect(stale.defaultPrevented).toBe(false);
    expect(staleReads).toBe(0);
    expect(await picturesOnceSettled(editor, 2)).toEqual([1, 0, 0, 0]);
    // The next overlay takes it once: one listener, not one per overlay so far.
    const { overlay: second, paragraph } = await select(container, editor, 'shape');
    let liveReads = 0;
    const live = pasteEvent({ file: true, onFileRead: () => (liveReads += 1) });
    second.dispatchEvent(live);
    expect(liveReads).toBe(1);
    const expected = [1, 0, 0, 0];
    expected[paragraph]! += 1;
    expect(await picturesOnceSettled(editor, 2)).toEqual(expected);
  });
});
