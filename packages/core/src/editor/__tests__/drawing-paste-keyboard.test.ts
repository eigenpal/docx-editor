// A keyboard paste on the pages while a drawing is selected. The paste chord's keydown reaches
// the pages before the paste event, and must keep the drawing selected, so the paste goes
// where the selected drawing sends it: into a text box, or refused on a shape with no text.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { textboxStoriesInPart } from '../../store/package/textbox-stories.ts';
import { SHAPE_PASTE_TEXT_REASON } from '../surface-drawing-clipboard.ts';
import { forwardClipboardEvents } from '../chrome-clipboard.ts';
import {
  EMU,
  SHAPE_URI,
  SOLID,
  anchor,
  documentBytes,
  p,
  saved,
  text,
  wsp,
} from './shape-selection-fixture.ts';

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const boxShape = (body: string) =>
  wsp(100 * EMU, 60 * EMU, 'rect', SOLID('FFE699')).replace(
    '<wps:bodyPr/>',
    `${body}<wps:bodyPr/>`
  );
const floating = (name: string, graphic: string) =>
  anchor({
    id: 9,
    name,
    x: 250 * EMU,
    y: 150 * EMU,
    cx: 100 * EMU,
    cy: 60 * EMU,
    graphic,
    uri: SHAPE_URI,
  });
const TEXT_BOX = floating(
  'Box',
  boxShape(
    '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Box text</w:t></w:r></w:p></w:txbxContent></wps:txbx>'
  )
);
const SHAPE = floating('Plain', boxShape(''));

async function open(drawing: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: documentBytes(p(text('Alpha') + drawing + text('tail')) + p(text('Bravo'))),
  });
  editors.push(editor);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.surface?.layout();
  }
  const surface = editor.surface!;
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  const select = () => {
    const first = surface.session.paragraphIds()[0];
    const drawing = surface
      .layout()
      .pages[0]!.anchoredDrawings!.find((record) => record.anchorParagraphId === first)!;
    expect(surface.selectDrawing(drawing.drawingNodeId, drawing.anchorParagraphId)).toBe(true);
    return drawing;
  };
  return { editor, surface, pages, select };
}

/** A paste event that carries `value` as plain text. */
function pasteEvent(value: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/plain' ? value : ''),
      types: ['text/plain'],
      items: [],
    },
  });
  return event;
}

/** A paste event with bold HTML and its plain text. */
function richPasteEvent(): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) =>
        type === 'text/html' ? '<p><b>Bold</b></p>' : type === 'text/plain' ? 'Bold' : '',
      types: ['text/plain', 'text/html'],
      items: [],
    },
  });
  return event;
}

const key = (init: KeyboardEventInit) =>
  new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

/** The text box story's paragraphs. */
const boxText = (editor: DocxEditorInstance) => {
  const part = editor.surface!.session.part();
  const story = textboxStoriesInPart(part)[0]!;
  return story.root.children
    .filter((child) => child.kind === 'paragraph')
    .map((paragraph) => paragraphTextOf(part, paragraph.id));
};

const firstParagraph = (editor: DocxEditorInstance) =>
  paragraphTextOf(editor.surface!.session.part(), editor.surface!.session.paragraphIds()[0]!);

describe('a keyboard paste on the pages with a drawing selected', () => {
  for (const [name, chord] of [
    ['Ctrl+V', { key: 'v', ctrlKey: true }],
    ['Command+V', { key: 'v', metaKey: true }],
    ['Ctrl+Shift+V', { key: 'V', ctrlKey: true, shiftKey: true }],
    ['Shift+Insert', { key: 'Insert', shiftKey: true }],
    // A Russian layout types `м` on the V key: the chord is still the paste chord.
    ['Ctrl+V on a Russian layout', { key: 'м', code: 'KeyV', ctrlKey: true }],
    ['Ctrl+Shift+V on a Hebrew layout', { key: 'ה', code: 'KeyV', ctrlKey: true, shiftKey: true }],
  ] as const) {
    test(`${name} then the paste replaces a selected text box's text`, async () => {
      const { editor, surface, pages, select } = await open(TEXT_BOX);
      select();
      pages.dispatchEvent(key(chord));
      expect(surface.drawingSelectionIntent().kind).toBe('pointer');
      pages.dispatchEvent(pasteEvent('ZULU'));
      expect(boxText(editor)).toEqual(['ZULU']);
      expect(firstParagraph(editor)).toBe('Alpha￼tail');
    });
  }

  test('a paste input keeps the drawing selected too', async () => {
    const { surface, pages, select } = await open(TEXT_BOX);
    select();
    for (const inputType of ['insertFromPaste', 'insertFromPasteAsQuotation']) {
      pages.dispatchEvent(
        new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType })
      );
      expect(surface.drawingSelectionIntent().kind).toBe('pointer');
    }
  });

  test('Ctrl+V then the paste refuses on a shape with no text, and keeps it selected', async () => {
    const { editor, surface, pages, select } = await open(SHAPE);
    const drawing = select();
    const before = await saved(editor);
    pages.dispatchEvent(key({ key: 'v', ctrlKey: true }));
    pages.dispatchEvent(pasteEvent('ZULU'));
    expect(await saved(editor)).toBe(before);
    expect(surface.state().lastRejection).toBe(SHAPE_PASTE_TEXT_REASON);
    expect(editor.snapshot().image?.id).toBe(drawing.drawingNodeId);
  });

  test('Escape out of a text box, then Ctrl+V, replaces the box text', async () => {
    const { editor, surface, pages } = await open(TEXT_BOX);
    expect(surface.setActiveScope(editor.findMatches('Box text')[0]!.scope!)).toBe(true);
    pages.dispatchEvent(key({ key: 'Escape' }));
    expect(surface.activeScope().kind).toBe('body');
    expect(editor.snapshot().image).not.toBeNull();
    pages.dispatchEvent(key({ key: 'v', ctrlKey: true }));
    pages.dispatchEvent(pasteEvent('ZULU'));
    expect(boxText(editor)).toEqual(['ZULU']);
  });

  test('copy and cut chords on a Russian layout keep the drawing selected', async () => {
    const { surface, pages, select } = await open(TEXT_BOX);
    for (const chord of [
      { key: 'с', code: 'KeyC', ctrlKey: true },
      { key: 'ч', code: 'KeyX', metaKey: true },
    ]) {
      select();
      pages.dispatchEvent(key(chord));
      expect(surface.drawingSelectionIntent().kind).toBe('pointer');
    }
  });

  test('Ctrl+Shift+V on a Russian layout pastes without formatting at a body caret', async () => {
    const { editor, surface, pages } = await open(TEXT_BOX);
    const last = surface.session.paragraphIds().at(-1)!;
    surface.setSelection({
      anchor: { paragraphId: last, offset: 5 },
      head: { paragraphId: last, offset: 5 },
    });
    pages.dispatchEvent(key({ key: 'М', code: 'KeyV', ctrlKey: true, shiftKey: true }));
    pages.dispatchEvent(richPasteEvent());
    const xml = await saved(editor);
    expect(xml).toContain('Bold');
    expect(xml).not.toContain('<w:b/>');
  });

  test('Ctrl+Shift+V on a Russian layout from a focused overlay pastes without formatting', async () => {
    const { editor, surface } = await open(TEXT_BOX);
    const overlay = document.createElement('div');
    overlay.tabIndex = 0;
    document.body.append(overlay);
    const stop = forwardClipboardEvents(overlay, editor);
    const last = surface.session.paragraphIds().at(-1)!;
    surface.setSelection({
      anchor: { paragraphId: last, offset: 5 },
      head: { paragraphId: last, offset: 5 },
    });
    overlay.dispatchEvent(key({ key: 'М', code: 'KeyV', ctrlKey: true, shiftKey: true }));
    overlay.dispatchEvent(richPasteEvent());
    const xml = await saved(editor);
    expect(xml).toContain('Bold');
    expect(xml).not.toContain('<w:b/>');
    stop();
  });

  test('another key still ends the drawing selection', async () => {
    const { surface, pages, select } = await open(TEXT_BOX);
    select();
    pages.dispatchEvent(key({ key: 'v', altKey: true, ctrlKey: true }));
    expect(surface.drawingSelectionIntent().kind).toBe('none');
  });
});
