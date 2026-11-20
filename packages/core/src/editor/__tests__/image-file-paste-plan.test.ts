// The host image-FILE paste plan: whether the file lane takes a paste, and where the picture
// lands, with the caret in text and with a picture, shape or text box selected.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { imageFilePastePlan, runImageFilePaste } from '../image-file-paste.ts';
import { PICTURE_SELECTED_INSERT_REASON, executeImageCommand } from '../docx-editor-images.ts';
import { stubReviewModule } from './review-test-module.ts';
import {
  BODY,
  PNG_1X1,
  bodyParagraphs,
  caretAtEndOf,
  decodePort,
  drawingDocument,
  pasteEvent,
  picturesPerParagraph,
  savedDocumentXml,
  selectFixtureDrawing,
} from './drawing-image-paste-fixture.ts';

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

async function mounted(reviewing = false, body = BODY): Promise<DocxEditorInstance> {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: drawingDocument(body),
    imageDecodePort: decodePort,
    ...(reviewing ? { author: 'Reviewer', modules: [stubReviewModule()] } : {}),
  });
  editors.push(editor);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.surface?.layout();
  }
  return editor;
}

const transfer = (options: Parameters<typeof pasteEvent>[0]) => pasteEvent(options).clipboardData;

const insertAt = (editor: DocxEditorInstance, at: ReturnType<typeof imageFilePastePlan>) =>
  executeImageCommand(editor, {
    type: 'insertImage',
    data: PNG_1X1,
    mime: 'image/png',
    widthPoints: 12,
    heightPoints: 12,
    ...(at?.at ? { at: at.at } : {}),
  });

test('stands down without an image file, or when the engine lands the text beside it', async () => {
  const editor = await mounted();
  caretAtEndOf(editor, 3);
  expect(imageFilePastePlan(editor, null)).toBeNull();
  expect(imageFilePastePlan(editor, transfer({ flavours: { 'text/plain': 'x' } }))).toBeNull();
  expect(
    imageFilePastePlan(editor, transfer({ file: true, flavours: { 'text/plain': 'Copied' } }))
  ).toBeNull();
  selectFixtureDrawing(editor, 'shape');
  expect(
    imageFilePastePlan(editor, transfer({ file: true, flavours: { 'text/plain': 'Copied' } }))
  ).toBeNull();
});

test('with the caret in text, lands at the caret', async () => {
  const editor = await mounted();
  caretAtEndOf(editor, 3);
  const plan = imageFilePastePlan(editor, transfer({ file: true }));
  expect(plan).toEqual({ at: undefined });
  expect((await insertAt(editor, plan)).ok).toBe(true);
  expect(picturesPerParagraph(await savedDocumentXml(editor))).toEqual([1, 0, 0, 1]);
});

for (const kind of ['picture', 'shape', 'textBox'] as const) {
  test(`with a ${kind} selected, lands inline just before its anchor run`, async () => {
    const editor = await mounted();
    const paragraph = selectFixtureDrawing(editor, kind);
    const plan = imageFilePastePlan(editor, transfer({ file: true }));
    const selection = editor.surface!.state().selection.anchor;
    expect(plan?.at).toMatchObject({
      paragraphId: selection.paragraphId,
      offset: selection.offset,
    });
    expect((await insertAt(editor, plan)).ok).toBe(true);
    const xml = await savedDocumentXml(editor);
    const counts = [1, 0, 0, 0];
    counts[paragraph]! += 1;
    expect(picturesPerParagraph(xml)).toEqual(counts);
    // The new picture is inline, and the selected drawing stays where it was, after it.
    const host = bodyParagraphs(xml)[paragraph]!;
    expect(host.indexOf('<wp:inline')).toBeGreaterThan(-1);
    expect(host.indexOf('<wp:inline')).toBeLessThan(host.indexOf('<wp:anchor'));
  });
}

test('with a drawing selected, stands down while viewing and refuses a stale target', async () => {
  const editor = await mounted();
  selectFixtureDrawing(editor, 'picture');
  const plan = imageFilePastePlan(editor, transfer({ file: true }));
  expect(plan?.at).toBeDefined();
  // The document changes during the file read: the captured target is stale.
  caretAtEndOf(editor, 3);
  expect(editor.exec({ type: 'insertText', text: '!' }).ok).toBe(true);
  expect(await insertAt(editor, plan)).toMatchObject({ ok: false, code: 'notFound' });
  expect(picturesPerParagraph(await savedDocumentXml(editor))).toEqual([1, 0, 0, 0]);

  selectFixtureDrawing(editor, 'picture');
  expect(editor.exec({ type: 'setEditingMode', mode: 'viewing' }).ok).toBe(true);
  expect(imageFilePastePlan(editor, transfer({ file: true }))).toBeNull();
});

test('with a drawing selected while suggesting, takes the paste and carries the refusal', async () => {
  const editor = await mounted(true);
  editor.surface!.setEditingMode('suggest');
  selectFixtureDrawing(editor, 'picture');
  const plan = imageFilePastePlan(editor, transfer({ file: true }));
  expect(plan).toEqual({
    at: undefined,
    refusal: { ok: false, code: 'invalidArgs', reason: PICTURE_SELECTED_INSERT_REASON },
  });
  expect(picturesPerParagraph(await savedDocumentXml(editor))).toEqual([1, 0, 0, 0]);
  // The caret in text still takes the file while suggesting.
  caretAtEndOf(editor, 3);
  expect(imageFilePastePlan(editor, transfer({ file: true }))).toEqual({ at: undefined });
});

test('with a drawing selected, stands down for a refusal outside suggesting mode', async () => {
  const editor = await mounted();
  selectFixtureDrawing(editor, 'picture');
  const locked = { ok: false, code: 'locked', reason: 'the document is protected' } as const;
  const refusing = { surface: editor.surface, canExecuteImageCommand: () => locked };
  expect(imageFilePastePlan(refusing, transfer({ file: true }))).toBeNull();
  // While suggesting, the lane reports whatever the editor refuses, unchanged.
  editor.surface!.setEditingMode('suggest');
  expect(imageFilePastePlan(refusing, transfer({ file: true }))).toEqual({
    at: undefined,
    refusal: locked,
  });
  // With the caret in text, the lane stands down as a refused paste in text does.
  caretAtEndOf(editor, 3);
  expect(imageFilePastePlan(refusing, transfer({ file: true }))).toBeNull();
});

test('with a picture anchored in a table cell selected, lands before it in that cell', async () => {
  const [first, ...rest] = BODY.split(/(?<=<\/w:p>)/);
  const table =
    '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="9000"/>' +
    `</w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="9000" w:type="dxa"/></w:tcPr>${first}</w:tc></w:tr></w:tbl>`;
  const editor = await mounted(false, table + rest.join(''));
  const paragraph = selectFixtureDrawing(editor, 'picture');
  const plan = imageFilePastePlan(editor, transfer({ file: true }));
  expect(plan?.at).toMatchObject(editor.surface!.state().selection.anchor);
  expect((await insertAt(editor, plan)).ok).toBe(true);
  const xml = await savedDocumentXml(editor);
  const cell = xml.slice(xml.indexOf('<w:tc>'), xml.indexOf('</w:tc>'));
  expect(cell.indexOf('<wp:inline')).toBeGreaterThan(-1);
  expect(cell.indexOf('<wp:inline')).toBeLessThan(cell.indexOf('<wp:anchor'));
  expect(paragraph).toBe(0);
});

describe('running the paste lane', () => {
  /** Dispatch a file paste on the body and run the lane from its listener, as hosts do. */
  function pasteOnBody(
    host: Parameters<typeof runImageFilePaste>[0],
    insert: Parameters<typeof runImageFilePaste>[2],
    refuse: Parameters<typeof runImageFilePaste>[3] = () => undefined
  ): Promise<void> | null {
    let run: Promise<void> | null = null;
    document.body.addEventListener(
      'paste',
      (event) => {
        run = runImageFilePaste(host, event as ClipboardEvent, insert, refuse);
      },
      { once: true }
    );
    document.body.dispatchEvent(pasteEvent({ file: true }));
    return run;
  }

  /** The editor, with a counted `focus`. */
  function focusCounted(editor: DocxEditorInstance) {
    let focused = 0;
    return {
      host: {
        surface: editor.surface,
        canExecuteImageCommand: editor.canExecuteImageCommand.bind(editor),
        focus: () => {
          focused += 1;
          return editor.focus();
        },
      },
      focused: () => focused,
    };
  }

  test('returns focus to the text only after a picture lands at a drawing', async () => {
    const editor = await mounted();
    selectFixtureDrawing(editor, 'picture');
    const { host, focused } = focusCounted(editor);
    const run = pasteOnBody(host, (_transfer, at) => insertAt(editor, { at }));
    expect(run).not.toBeNull();
    await run;
    expect(focused()).toBe(1);
    expect(picturesPerParagraph(await savedDocumentXml(editor))).toEqual([2, 0, 0, 0]);
  });

  test('leaves focus where it is after a refusal', async () => {
    const editor = await mounted();
    selectFixtureDrawing(editor, 'picture');
    const { host, focused } = focusCounted(editor);
    // The insert refuses: the document does not change.
    await pasteOnBody(host, async () => undefined);
    expect(focused()).toBe(0);
  });

  test('reports a suggesting-mode refusal without a file read, whatever happens next', async () => {
    const editor = await mounted(true);
    editor.surface!.setEditingMode('suggest');
    selectFixtureDrawing(editor, 'picture');
    const { host, focused } = focusCounted(editor);
    const refused: string[] = [];
    let reads = 0;
    const run = pasteOnBody(
      host,
      async () => {
        reads += 1;
      },
      (reason) => refused.push(reason)
    );
    expect(run).not.toBeNull();
    // The reader clicks into text at once: the refusal is already reported, and no file is read.
    caretAtEndOf(editor, 3);
    await run;
    expect(reads).toBe(0);
    expect(refused).toEqual([PICTURE_SELECTED_INSERT_REASON]);
    expect(focused()).toBe(0);
    expect(picturesPerParagraph(await savedDocumentXml(editor))).toEqual([1, 0, 0, 0]);
  });

  test('reports an insert that throws, without a rejection or a focus move', async () => {
    const editor = await mounted();
    selectFixtureDrawing(editor, 'picture');
    const { host, focused } = focusCounted(editor);
    const original = console.error;
    const reported: unknown[] = [];
    console.error = (...args: unknown[]) => void reported.push(args[1]);
    try {
      const failure = new Error('decoder crashed');
      await pasteOnBody(host, () => Promise.reject(failure));
      expect(reported).toEqual([failure]);
    } finally {
      console.error = original;
    }
    expect(focused()).toBe(0);
  });

  test('stands down without preventing the default when the lane does not take the paste', async () => {
    const editor = await mounted();
    caretAtEndOf(editor, 3);
    const event = pasteEvent({ flavours: { 'text/plain': 'x' } });
    const lane = runImageFilePaste(
      focusCounted(editor).host,
      event,
      async () => undefined,
      () => undefined
    );
    expect(lane).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });
});

test('with the caret after the selected drawing, lands before it all the same', async () => {
  const editor = await mounted();
  selectFixtureDrawing(editor, 'picture');
  const surface = editor.surface!;
  const at = surface.state().selection.anchor;
  const after = { paragraphId: at.paragraphId, offset: at.offset + 1 };
  surface.setSelection({ anchor: after, head: after });
  expect(editor.snapshot().image).not.toBeNull();
  const plan = imageFilePastePlan(editor, transfer({ file: true }));
  expect(plan?.at).toMatchObject({ paragraphId: at.paragraphId, offset: at.offset });
  expect((await insertAt(editor, plan)).ok).toBe(true);
  const host = bodyParagraphs(await savedDocumentXml(editor))[0]!;
  expect(host.indexOf('<wp:inline')).toBeLessThan(host.indexOf('<wp:anchor'));
});
