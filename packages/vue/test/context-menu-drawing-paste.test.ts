// The context menu's Paste row while a drawing is selected, parity with the React adapter.
// Where a paste goes depends on what the clipboard holds, so the row stays live on a shape that
// refuses text: a copied drawing still lands before the shape's anchor, and text refuses after
// the clipboard read.
import './dom-setup.ts';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createApp, h } from 'vue';
import { strFromU8, unzipSync } from 'fflate';
import { en } from '@docx-editor.dev/i18n';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorContextMenu } from '../src/editor/contextmenu/index.ts';
import { SHAPE_PASTE_TEXT_REASON } from '../../core/src/editor/surface-drawing-clipboard.ts';
import {
  EMU,
  LINE,
  SOLID,
  anchor,
  documentBytes,
  p,
  text,
  wsp,
} from '../../core/src/editor/__tests__/shape-selection-fixture.ts';
import { flush } from './helpers/fixtures.ts';

/** A shape with no text, anchored mid-paragraph, and a line anchored in the next paragraph. */
const SHAPE = anchor({
  id: 9,
  name: 'Plain',
  x: 250 * EMU,
  y: 150 * EMU,
  cx: 100 * EMU,
  cy: 60 * EMU,
  graphic: wsp(100 * EMU, 60 * EMU, 'rect', SOLID('FFE699')),
  uri: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
});
const SOURCE = documentBytes(
  p(text('Alpha') + SHAPE + text('tail')) + p(LINE + text('Rule here')) + p(text('Charlie'))
);

const t = (key: string): string => key;

let clipboard: { text: string; html: string | null } = { text: '', html: null };
/** Whether the browser lets the page read the clipboard. */
let readAllowed = true;
const refused = () => Promise.reject(new Error('Read permission denied.'));
const hadClipboardItem = 'ClipboardItem' in globalThis;
const unmounts: (() => void)[] = [];

beforeEach(() => {
  clipboard = { text: '', html: null };
  readAllowed = true;
  // A new window focus period: an earlier test's copy is not the clipboard content.
  window.dispatchEvent(new Event('blur'));
  if (!hadClipboardItem) (globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {};
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: {
      writeText: async () => {},
      write: async () => {},
      readText: async () => (readAllowed ? clipboard.text : refused()),
      read: async () => (readAllowed ? clipboardItems() : refused()),
    },
    configurable: true,
  });
});

function clipboardItems() {
  return [
    {
      types: clipboard.html ? ['text/plain', 'text/html'] : ['text/plain'],
      getType: async (type: string) =>
        new Blob([type === 'text/html' ? (clipboard.html ?? '') : clipboard.text]),
    },
  ];
}

afterEach(() => {
  // Leave no copy behind for the next test file in a serial run.
  window.dispatchEvent(new Event('blur'));
  for (const unmount of unmounts.splice(0)) unmount();
  document.body.innerHTML = '';
  if (!hadClipboardItem) delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
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
  unmounts.push(() => {
    app.unmount();
    container.remove();
  });
  for (let attempt = 0; attempt < 50 && !ready.at(-1)?.surface; attempt++) await flush();
  const editor = ready.at(-1)!;
  editor.surface!.layout();
  await flush();
  return { container, editor };
}

/** Select the drawing anchored in paragraph `index`: 0 holds the shape, 1 the line. */
function selectDrawing(editor: DocxEditorInstance, index: number): void {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[index];
  const drawing = surface
    .layout()
    .pages[0]!.anchoredDrawings!.find((record) => record.anchorParagraphId === paragraphId)!;
  expect(surface.selectDrawing(drawing.drawingNodeId, drawing.anchorParagraphId)).toBe(true);
}

async function pasteRow(container: HTMLElement): Promise<HTMLElement> {
  return menuRow(container, 'edit.paste');
}

async function menuRow(container: HTMLElement, slot: string): Promise<HTMLElement> {
  container.querySelector('.docx-editor__scroll-container')!.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 140,
      button: 2,
    })
  );
  await flush();
  const row = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  if (!row) throw new Error(`no ${slot} row`);
  return row;
}

async function firstParagraphXml(editor: DocxEditorInstance): Promise<string> {
  const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  return xml.slice(xml.indexOf('<w:body'), xml.indexOf('</w:p>'));
}

describe('Paste in the context menu with a shape that has no text selected', () => {
  test('stays live, and a copied drawing lands before the shape anchor', async () => {
    const { container, editor } = await mount();
    selectDrawing(editor, 1);
    const copied = editor.surface!.copyFlavours();
    clipboard = { text: copied.text, html: copied.html };
    selectDrawing(editor, 0);
    await flush();
    const row = await pasteRow(container);
    expect(editor.snapshot().image).not.toBeNull();
    expect(row.getAttribute('aria-disabled')).toBeNull();
    row.click();
    await flush();
    const first = await firstParagraphXml(editor);
    expect(first.match(/<w:drawing[\s>]/g)).toHaveLength(2);
    expect(first.indexOf('name="Rule"')).toBeLessThan(first.indexOf('name="Plain"'));
    expect(document.querySelector('[data-docx-dialog="imageInsertError"]')).toBeNull();
  });

  test('refuses pasted text after the read, and the row stays live afterwards', async () => {
    const { container, editor } = await mount();
    clipboard = { text: 'ZULU', html: null };
    const before = await firstParagraphXml(editor);
    selectDrawing(editor, 0);
    await flush();
    const row = await pasteRow(container);
    expect(row.getAttribute('aria-disabled')).toBeNull();
    row.click();
    await flush();
    expect(await firstParagraphXml(editor)).toBe(before);
    expect(editor.snapshot().lastRejection).toBe(SHAPE_PASTE_TEXT_REASON);
    // The reason shows once, translated, in the dialog a keyboard paste shows.
    const shown = document.querySelectorAll('[data-docx-dialog="imageInsertError"]');
    expect(shown).toHaveLength(1);
    expect(shown[0]!.getAttribute('aria-label')).toBe(en.clipboard.errors.pasteTitle);
    expect(shown[0]!.textContent).toContain(en.disabledReason.shapePasteText);
    shown[0]!.querySelector('button')!.click();
    await flush();
    // A refused payload does not disable Paste: the next clipboard may hold a drawing.
    selectDrawing(editor, 0);
    await flush();
    expect((await pasteRow(container)).getAttribute('aria-disabled')).toBeNull();
  });
});

describe('Copy and Paste in the context menu when the clipboard read is refused', () => {
  test('a line copied from the menu pastes from the menu, and Paste stays live', async () => {
    const { container, editor } = await mount();
    readAllowed = false;
    selectDrawing(editor, 1);
    await flush();
    (await menuRow(container, 'edit.copy')).click();
    await flush();
    // Paste into the first paragraph's text, at its start.
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    await flush();
    (await pasteRow(container)).click();
    await flush();
    const first = await firstParagraphXml(editor);
    expect(first.match(/name="Rule"/g)).toHaveLength(1);
    expect(document.querySelector('[data-docx-dialog="imageInsertError"]')).toBeNull();
    // The refused read does not disable Paste while the editor copy can still paste.
    const again = await pasteRow(container);
    expect(again.getAttribute('aria-disabled')).toBeNull();
    expect(again.getAttribute('title')).toBeNull();
  });
});
