// The context menu's Paste row while a drawing is selected. Where a paste goes depends on what
// the clipboard holds, so the row stays live on a shape that refuses text: a copied drawing
// still lands before the shape's anchor, and text refuses after the clipboard read.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { strFromU8, unzipSync } from 'fflate';
import { en } from '@docx-editor.dev/i18n';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { ContextMenu } from '../src/editor/contextmenu/index.ts';
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
const hadClipboardItem = 'ClipboardItem' in globalThis;

beforeEach(() => {
  clipboard = { text: '', html: null };
  if (!hadClipboardItem) (globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {};
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: {
      writeText: async () => {},
      readText: async () => clipboard.text,
      read: async () => [
        {
          types: clipboard.html ? ['text/plain', 'text/html'] : ['text/plain'],
          getType: async (type: string) =>
            new Blob([type === 'text/html' ? (clipboard.html ?? '') : clipboard.text]),
        },
      ],
    },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  if (!hadClipboardItem) delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
});

async function mount() {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={SOURCE}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        <ContextMenu t={t} />
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

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Select the drawing anchored in paragraph `index`: 0 holds the shape, 1 the line. */
function selectDrawing(editor: DocxEditorInstance, index: number): void {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[index];
  const drawing = surface
    .layout()
    .pages[0]!.anchoredDrawings!.find((record) => record.anchorParagraphId === paragraphId)!;
  act(() => {
    expect(surface.selectDrawing(drawing.drawingNodeId, drawing.anchorParagraphId)).toBe(true);
  });
}

function pasteRow(view: ReturnType<typeof render>): HTMLElement {
  act(() => {
    fireEvent.contextMenu(view.container.querySelector('.docx-paginated-surface')!, {
      clientX: 120,
      clientY: 140,
      button: 2,
    });
  });
  const row = view.container.querySelector<HTMLElement>('[data-slot="edit.paste"]');
  if (!row) throw new Error('no Paste row');
  return row;
}

async function firstParagraphXml(editor: DocxEditorInstance): Promise<string> {
  let xml = '';
  await act(async () => {
    xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  });
  return xml.slice(xml.indexOf('<w:body'), xml.indexOf('</w:p>'));
}

describe('Paste in the context menu with a shape that has no text selected', () => {
  test('stays live, and a copied drawing lands before the shape anchor', async () => {
    const { view, editor } = await mount();
    selectDrawing(editor, 1);
    const copied = editor.surface!.copyFlavours();
    clipboard = { text: copied.text, html: copied.html };
    selectDrawing(editor, 0);
    const row = pasteRow(view);
    expect(editor.snapshot().image).not.toBeNull();
    expect(row.getAttribute('aria-disabled')).toBeNull();
    await act(async () => {
      fireEvent.click(row);
    });
    for (let attempt = 0; attempt < 20; attempt++) await settle();
    const first = await firstParagraphXml(editor);
    expect(first.match(/<w:drawing[\s>]/g)).toHaveLength(2);
    expect(first.indexOf('name="Rule"')).toBeLessThan(first.indexOf('name="Plain"'));
    expect(document.querySelector('[data-docx-dialog="imageInsertError"]')).toBeNull();
  });

  test('refuses pasted text after the read, and the row stays live afterwards', async () => {
    const { view, editor } = await mount();
    clipboard = { text: 'ZULU', html: null };
    const before = await firstParagraphXml(editor);
    selectDrawing(editor, 0);
    const row = pasteRow(view);
    expect(row.getAttribute('aria-disabled')).toBeNull();
    await act(async () => {
      fireEvent.click(row);
    });
    for (let attempt = 0; attempt < 20; attempt++) await settle();
    expect(await firstParagraphXml(editor)).toBe(before);
    expect(editor.snapshot().lastRejection).toBe(SHAPE_PASTE_TEXT_REASON);
    // The reason shows once, translated, in the dialog a keyboard paste shows.
    const shown = document.querySelectorAll('[data-docx-dialog="imageInsertError"]');
    expect(shown).toHaveLength(1);
    expect(shown[0]!.getAttribute('aria-label')).toBe(en.clipboard.errors.pasteTitle);
    expect(shown[0]!.textContent).toContain(en.disabledReason.shapePasteText);
    act(() => {
      fireEvent.click(shown[0]!.querySelector('button')!);
    });
    // A refused payload does not disable Paste: the next clipboard may hold a drawing.
    selectDrawing(editor, 0);
    expect(pasteRow(view).getAttribute('aria-disabled')).toBeNull();
  });
});
