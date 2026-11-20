// The host image-FILE paste plan: whether the file lane takes a paste, and where the picture
// lands, with the caret in text and with a picture, shape or text box selected.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { imageFilePastePlan } from '../clipboard-file-lane.ts';
import { PICTURE_SELECTED_INSERT_REASON, executeImageCommand } from '../docx-editor-images.ts';
import { stubReviewModule } from './review-test-module.ts';
import {
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

async function mounted(reviewing = false): Promise<DocxEditorInstance> {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: drawingDocument(),
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

test('with a drawing selected while suggesting, takes the paste and reports the refusal', async () => {
  const editor = await mounted(true);
  editor.surface!.setEditingMode('suggest');
  selectFixtureDrawing(editor, 'picture');
  const plan = imageFilePastePlan(editor, transfer({ file: true }));
  expect(plan).toEqual({ at: undefined });
  // The insert the adapters then run refuses with the reason they show.
  expect(await insertAt(editor, plan)).toMatchObject({
    ok: false,
    reason: PICTURE_SELECTED_INSERT_REASON,
  });
  expect(picturesPerParagraph(await savedDocumentXml(editor))).toEqual([1, 0, 0, 0]);
  // The caret in text still takes the file while suggesting.
  caretAtEndOf(editor, 3);
  expect(imageFilePastePlan(editor, transfer({ file: true }))).toEqual({ at: undefined });
});

test('with a drawing selected, stands down for any other refusal, as a paste in text does', async () => {
  const editor = await mounted();
  selectFixtureDrawing(editor, 'picture');
  const refusing = {
    surface: editor.surface,
    canExecuteImageCommand: () =>
      ({ ok: false, code: 'locked', reason: 'the document is protected' }) as const,
  };
  expect(imageFilePastePlan(refusing, transfer({ file: true }))).toBeNull();
  const pictureSelected = {
    surface: editor.surface,
    canExecuteImageCommand: () =>
      ({ ok: false, code: 'invalidArgs', reason: PICTURE_SELECTED_INSERT_REASON }) as const,
  };
  expect(imageFilePastePlan(pictureSelected, transfer({ file: true }))).toEqual({ at: undefined });
  // With the caret in text, the picture-selected refusal cannot apply, so the lane stands down.
  caretAtEndOf(editor, 3);
  expect(imageFilePastePlan(pictureSelected, transfer({ file: true }))).toBeNull();
});
