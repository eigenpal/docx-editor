// Where a paste goes while a drawing is selected. Content goes in immediately before the
// selected drawing's anchor run; text pasted while a text box is selected replaces the text box's
// text; a shape with no text refuses text with a reason. Every paste lane asks the same question.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { forwardClipboardEvents } from '../chrome-clipboard.ts';
import { findNode } from '../../store/package/ooxml-edit.ts';
import { drawingPasteTarget, selectTextBoxForPaste } from '../drawing-paste-target.ts';
import { wrapInteropHtml } from '../clipboard-fragment-codec.ts';
import {
  GROUP_MEMBER_PASTE_REASON,
  LINKED_TEXT_BOX_PASTE_REASON,
  SHAPE_PASTE_TEXT_REASON,
  TEXT_BOX_PASTE_REASON,
  TEXT_BOX_PICTURE_PASTE_REASON,
} from '../surface-drawing-clipboard.ts';
import { PICTURE_SELECTED_INSERT_REASON } from '../docx-editor-images.ts';
import { imageFilePastePlan } from '../image-file-paste.ts';
import { pasteEvent } from './drawing-image-paste-fixture.ts';
import {
  GROUP,
  LINE,
  SHAPE_URI,
  anchor,
  documentBytes,
  p,
  saved,
  text,
  wsp,
} from './shape-selection-fixture.ts';
import {
  PNG,
  floating,
  PICTURE,
  INLINE_PICTURE,
  boxShape,
  BOX_TEXT,
  TEXT_BOX,
  SHAPE,
  VML_BOX,
  body,
  open,
  selectFirstDrawing,
  bodyText,
  boxText,
  drawingNames,
  OBJ,
  editors,
} from './drawing-paste-fixture.ts';

/** A clipboard that holds one image file. */
const imageFileTransfer = () => pasteEvent({ file: true }).clipboardData;

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

describe('a picture, line or group selected', () => {
  test('plain text goes in before the anchor run and the caret shows after it', async () => {
    const { editor, surface } = await open(body(PICTURE));
    const id = selectFirstDrawing(editor);
    expect(drawingPasteTarget(surface, 'text')).toEqual({
      kind: 'anchor',
      paragraphId: surface.session.paragraphIds()[0]!,
      offset: 'Alpha head'.length,
    });
    const before = await saved(editor);
    expect(editor.exec({ type: 'paste', text: 'ZULU' })).toMatchObject({ ok: true });
    expect(bodyText(editor)[0]).toBe(`Alpha headZULU${OBJ}Alpha tail.`);
    // The picture stays where it was; the caret is a text caret after the paste, not hidden.
    expect(editor.snapshot().image).toBeNull();
    expect(surface.drawingSelectionIntent().kind).toBe('none');
    expect(surface.state().selection.head).toEqual({
      paragraphId: surface.session.paragraphIds()[0]!,
      offset: 'Alpha headZULU'.length,
    });
    expect(findNode(surface.session.part(), id)).not.toBeNull();
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    expect(await saved(editor)).toBe(before);
  });

  test('several lines split the anchor paragraph, and the drawing stays with the tail', async () => {
    const { editor } = await open(body(PICTURE));
    selectFirstDrawing(editor);
    expect(editor.exec({ type: 'pasteWithoutFormatting', text: 'ZULU\nYANKEE' })).toMatchObject({
      ok: true,
    });
    expect(bodyText(editor).slice(0, 2)).toEqual(['Alpha headZULU', `YANKEE${OBJ}Alpha tail.`]);
  });

  test('HTML and an editor fragment go in before the anchor run', async () => {
    const { editor, surface } = await open(body(PICTURE));
    const picture = selectFirstDrawing(editor);
    const html = '<p><b>RICHONE</b></p><p>RICHTWO</p>';
    expect(editor.exec({ type: 'paste', text: 'RICHONE\nRICHTWO', html })).toMatchObject({
      ok: true,
    });
    expect(bodyText(editor).slice(0, 2)).toEqual(['Alpha headRICHONE', `RICHTWO${OBJ}Alpha tail.`]);

    // A fragment copied in the editor takes the same place.
    const [, second] = surface.session.paragraphIds().slice(1);
    surface.setSelection({
      anchor: { paragraphId: second!, offset: 0 },
      head: { paragraphId: second!, offset: 4 },
    });
    const copied = surface.copyFlavours();
    expect(copied.html).toContain('data-docx-fragment=');
    selectFirstDrawing(editor, picture);
    expect(surface.pasteRich(copied.text, copied.html)).toBe(true);
    expect(bodyText(editor)[1]).toBe(`RICHTWOBrav${OBJ}Alpha tail.`);
  });

  test('a copied drawing goes in before the selected drawing, and is selected', async () => {
    const { editor, surface } = await open(body(PICTURE) + p(LINE + text('Rule here')));
    const line = surface.layout().pages[0]!.anchoredDrawings!.find((d) => d.relativeHeight === 2)!;
    expect(surface.selectDrawing(line.drawingNodeId, line.anchorParagraphId)).toBe(true);
    const copied = surface.copyFlavours();
    const picture = selectFirstDrawing(editor);
    expect(drawingPasteTarget(surface, 'drawing')).toMatchObject({ kind: 'anchor' });
    expect(surface.pasteRich(copied.text, copied.html)).toBe(true);
    const xml = await saved(editor);
    expect(drawingNames(xml)).toEqual(['Rule', 'Photo', 'Rule']);
    expect(bodyText(editor)[0]).toBe(`Alpha head${OBJ}${OBJ}Alpha tail.`);
    expect(editor.snapshot().image?.id).not.toBe(picture);
  });

  test('suggesting mode proposes a copied drawing before the selected drawing', async () => {
    const { editor, surface } = await open(body(PICTURE) + p(LINE + text('Rule here')));
    const line = surface.layout().pages[0]!.anchoredDrawings!.find((d) => d.relativeHeight === 2)!;
    expect(surface.selectDrawing(line.drawingNodeId, line.anchorParagraphId)).toBe(true);
    const copied = surface.copyFlavours();
    surface.setEditingMode('suggest');
    selectFirstDrawing(editor);
    expect(surface.pasteRich(copied.text, copied.html)).toBe(true);
    const anchorParagraph = (await saved(editor)).split('</w:p>')[0]!;
    // The copy is a tracked insertion before the selected drawing, which stays untracked.
    expect(anchorParagraph).toMatch(/<w:ins [^>]*>(?:(?!<\/w:ins>).)*name="Rule"/s);
    expect(anchorParagraph.indexOf('name="Rule"')).toBeLessThan(
      anchorParagraph.indexOf('name="Photo"')
    );
    expect(anchorParagraph).not.toMatch(/<w:ins [^>]*>(?:(?!<\/w:ins>).)*name="Photo"/s);
  });

  test('a line and a whole group take text before the anchor run too', async () => {
    for (const drawing of [LINE, GROUP]) {
      const { editor } = await open(body(drawing));
      selectFirstDrawing(editor);
      expect(editor.exec({ type: 'paste', text: 'ZULU' })).toMatchObject({ ok: true });
      expect(bodyText(editor)[0]).toBe(`Alpha headZULU${OBJ}Alpha tail.`);
    }
  });

  test('a drawing canvas takes text before the anchor run, not into one of its boxes', async () => {
    const canvas = floating(
      'Canvas',
      '<wpc:wpc xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas">' +
        boxShape(BOX_TEXT) +
        boxShape(BOX_TEXT.replaceAll('Box', 'Other')) +
        '</wpc:wpc>',
      'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas'
    );
    const { editor, surface } = await open(body(canvas));
    selectFirstDrawing(editor);
    expect(drawingPasteTarget(surface, 'text')).toMatchObject({ kind: 'anchor' });
    expect(editor.exec({ type: 'paste', text: 'ZULU' })).toMatchObject({ ok: true });
    expect(bodyText(editor)[0]).toBe(`Alpha headZULU${OBJ}Alpha tail.`);
  });

  test('an inline picture stays, and the text goes in before it', async () => {
    const { editor } = await open(body(INLINE_PICTURE));
    selectFirstDrawing(editor);
    expect(editor.exec({ type: 'paste', text: 'ZULU' })).toMatchObject({ ok: true });
    expect(bodyText(editor)[0]).toBe(`Alpha headZULU${OBJ}Alpha tail.`);
  });

  test('a picture file goes in before the anchor run while editing', async () => {
    const { editor, surface } = await open(body(PICTURE));
    const picture = selectFirstDrawing(editor);
    const result = await editor.executeImageCommand({
      type: 'insertImage',
      data: PNG,
      mime: 'image/png',
      widthPoints: 10,
      heightPoints: 10,
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(bodyText(editor)[0]).toBe(`Alpha head${OBJ}${OBJ}Alpha tail.`);
    // The new picture comes first and is selected; the picture that was selected follows it.
    const names = drawingNames(await saved(editor));
    expect(names).toHaveLength(2);
    expect(names[1]).toBe('Photo');
    expect(editor.snapshot().image?.id).not.toBe(picture);
    expect(findNode(surface.session.part(), picture)).not.toBeNull();
  });

  test('suggesting mode proposes the text, and refuses a picture file with a reason', async () => {
    const { editor } = await open(body(PICTURE), 'suggest');
    selectFirstDrawing(editor);
    const result = await editor.executeImageCommand({
      type: 'insertImage',
      data: PNG,
      mime: 'image/png',
      widthPoints: 10,
      heightPoints: 10,
    });
    expect(result).toMatchObject({ ok: false, reason: PICTURE_SELECTED_INSERT_REASON });
    expect(editor.exec({ type: 'paste', text: 'ZULU' })).toMatchObject({ ok: true });
    const xml = await saved(editor);
    expect(xml).toMatch(/<w:ins [^>]*>(?:(?!<\/w:ins>).)*ZULU/s);
    expect(bodyText(editor)[0]).toBe(`Alpha headZULU${OBJ}Alpha tail.`);
  });
});

describe('a text box selected', () => {
  test('plain text replaces its text, and undo restores it', async () => {
    const { editor, surface } = await open(body(TEXT_BOX));
    selectFirstDrawing(editor);
    expect(drawingPasteTarget(surface, 'text')).toMatchObject({ kind: 'textBox' });
    const before = await saved(editor);
    const bodyBefore = bodyText(editor);
    expect(editor.exec({ type: 'paste', text: 'ZULU' })).toMatchObject({ ok: true });
    expect(boxText(editor)).toEqual(['ZULU']);
    expect(bodyText(editor)).toEqual(bodyBefore);
    // The caret is in the box, after the pasted text, so typing continues there.
    expect(surface.activeScope().kind).toBe('frame');
    expect(editor.exec({ type: 'insertText', text: '!' }).ok).toBe(true);
    expect(boxText(editor)).toEqual(['ZULU!']);
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    expect(await saved(editor)).toBe(before);
  });

  test('pasted HTML lands as the text of its paragraphs and survives save and reopen', async () => {
    const { editor } = await open(body(TEXT_BOX));
    selectFirstDrawing(editor);
    const html = '<p><b>RICHONE</b></p><p>RICHTWO</p>';
    expect(editor.exec({ type: 'paste', text: 'RICHONE\nRICHTWO', html })).toMatchObject({
      ok: true,
    });
    expect(boxText(editor)).toEqual(['RICHONE', 'RICHTWO']);
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: new Uint8Array(await editor.save()),
    });
    editors.push(reopened);
    expect(boxText(reopened)).toEqual(['RICHONE', 'RICHTWO']);
    expect(bodyText(reopened)[0]).toBe(`Alpha head${OBJ}Alpha tail.`);
  });

  test('HTML with a picture and no text goes in before the anchor run, not into the box', async () => {
    const { editor, surface } = await open(body(TEXT_BOX));
    selectFirstDrawing(editor);
    const src = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;
    editor.exec({
      type: 'paste',
      text: '',
      html: `<p><img src="${src}" width="10" height="10"></p>`,
    });
    expect(boxText(editor)).toEqual(['Box one.', 'Box two.']);
    expect(surface.activeScope().kind).toBe('body');
    expect(bodyText(editor)[0]).toBe(`Alpha head${OBJ}${OBJ}Alpha tail.`);
    expect(drawingNames(await saved(editor))[1]).toBe('Box');
  });

  test('the paste event from the selection overlay replaces the text too', async () => {
    const { editor } = await open(body(TEXT_BOX));
    const overlay = document.createElement('div');
    overlay.tabIndex = 0;
    document.body.append(overlay);
    const stop = forwardClipboardEvents(overlay, editor);
    selectFirstDrawing(editor);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (kind: string) => (kind === 'text/plain' ? 'From overlay' : ''),
        types: ['text/plain'],
        items: [],
      },
    });
    overlay.dispatchEvent(event);
    expect(boxText(editor)).toEqual(['From overlay']);
    stop();
  });

  test('a copied drawing goes in before the text box anchor run', async () => {
    const { editor, surface } = await open(body(TEXT_BOX) + p(LINE + text('Rule here')));
    const line = surface.layout().pages[0]!.anchoredDrawings!.find((d) => d.relativeHeight === 2)!;
    expect(surface.selectDrawing(line.drawingNodeId, line.anchorParagraphId)).toBe(true);
    const copied = surface.copyFlavours();
    selectFirstDrawing(editor);
    expect(surface.pasteRich(copied.text, copied.html)).toBe(true);
    expect(drawingNames(await saved(editor))).toEqual(['Rule', 'Box', 'Rule']);
    expect(boxText(editor)).toEqual(['Box one.', 'Box two.']);
  });

  test('suggesting mode proposes the replacement inside the box', async () => {
    const { editor } = await open(body(TEXT_BOX), 'suggest');
    selectFirstDrawing(editor);
    expect(editor.exec({ type: 'paste', text: 'ZULU' })).toMatchObject({ ok: true });
    const xml = await saved(editor);
    const box = xml.slice(xml.indexOf('<w:txbxContent>'), xml.indexOf('</w:txbxContent>'));
    expect(box).toMatch(/<w:ins [^>]*>(?:(?!<\/w:ins>).)*ZULU/s);
    expect(box).toMatch(/<w:del [^>]*>(?:(?!<\/w:del>).)*Box one\./s);
  });

  test('a legacy text box that cannot take a caret refuses, as Enter does', async () => {
    const { editor } = await open(body(VML_BOX));
    selectFirstDrawing(editor);
    const before = await saved(editor);
    expect(editor.exec({ type: 'paste', text: 'ZULU' })).toMatchObject({
      ok: false,
      reason: TEXT_BOX_PASTE_REASON,
    });
    expect(await saved(editor)).toBe(before);
  });

  test('a turned text box refuses text with a reason and keeps the document', async () => {
    const { editor, surface } = await open(
      body(floating('Turned', boxShape(BOX_TEXT, ' vert="vert"')))
    );
    selectFirstDrawing(editor);
    const before = await saved(editor);
    const refused = { ok: false, code: 'unsupported', reason: TEXT_BOX_PASTE_REASON };
    expect(editor.exec({ type: 'paste', text: 'ZULU' })).toEqual(refused);
    expect(editor.exec({ type: 'pasteWithoutFormatting', text: 'ZULU' })).toEqual(refused);
    expect(surface.state().lastRejection).toBe(TEXT_BOX_PASTE_REASON);
    expect(await saved(editor)).toBe(before);
  });

  test('a paste the text box refuses leaves the box, and the drawing stays selected', async () => {
    const { editor, surface } = await open(body(TEXT_BOX));
    // A fragment that holds an embedded object has no form the text box can take.
    const object =
      '<w:object xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<v:shape type="#_x0000_t75" style="width:10pt;height:12pt"><v:imagedata r:id="preview"/></v:shape></w:object>';
    const html = wrapInteropHtml('<p>AZ</p>', {
      bytes: documentBytes(p(`<w:r><w:t>A</w:t>${object}<w:t>Z</w:t></w:r>`)),
      lastMarkCovered: true,
    });
    const box = selectFirstDrawing(editor);
    const before = await saved(editor);
    expect(surface.pasteRich('AZ', html)).toBe(false);
    expect(surface.state().lastRejection).toBe('unsupported-content');
    expect(await saved(editor)).toBe(before);
    // The box's text is not left selected, so the next key cannot replace it.
    const { anchor: at, head } = surface.state().selection;
    expect(at).toEqual(head);
    expect(at.paragraphId).toBe(surface.session.paragraphIds()[0]!);
    expect(editor.snapshot().image?.id).toBe(box);
    expect(boxText(editor)).toEqual(['Box one.', 'Box two.']);
  });
});

describe('a shape with no text selected', () => {
  test('text refuses with a reason from every lane, and nothing changes', async () => {
    const { editor, surface } = await open(body(SHAPE));
    selectFirstDrawing(editor);
    const before = await saved(editor);
    const refused = { ok: false, code: 'unsupported', reason: SHAPE_PASTE_TEXT_REASON };
    expect(editor.exec({ type: 'paste', text: 'ZULU' })).toEqual(refused);
    expect(editor.exec({ type: 'paste', text: 'ZULU', html: '<p>ZULU</p>' })).toEqual(refused);
    expect(editor.exec({ type: 'pasteWithoutFormatting', text: 'ZULU' })).toEqual(refused);
    expect(surface.pasteRich('ZULU', null)).toBe(false);
    expect(await saved(editor)).toBe(before);
    // The shape stays selected, so the reader sees what refused.
    expect(editor.snapshot().image).not.toBeNull();
  });

  test('a picture file and a copied drawing still go in before the anchor run', async () => {
    const { editor, surface } = await open(body(SHAPE));
    selectFirstDrawing(editor);
    const copied = surface.copyFlavours();
    expect(surface.pasteRich(copied.text, copied.html)).toBe(true);
    expect(drawingNames(await saved(editor))).toEqual(['Plain', 'Plain']);
    selectFirstDrawing(editor);
    const result = await editor.executeImageCommand({
      type: 'insertImage',
      data: PNG,
      mime: 'image/png',
      widthPoints: 10,
      heightPoints: 10,
    });
    expect(result).toMatchObject({ ok: true });
    expect(bodyText(editor)[0]).toBe(`Alpha head${OBJ}${OBJ}${OBJ}Alpha tail.`);
  });

  test('a shape selected inside a group refuses text with its reason', async () => {
    const { editor, surface } = await open(body(GROUP));
    const group = selectFirstDrawing(editor);
    const shapes: string[] = [];
    const visit = (node: OoxmlNode) => {
      if (node.kind === 'textValue') return;
      if ((node as { localName?: string }).localName === 'wsp') shapes.push(node.id);
      node.children.forEach(visit);
    };
    visit(findNode(surface.session.part(), group)!);
    expect(surface.selectDrawingMember(shapes[0]!)).toBe(true);
    const before = await saved(editor);
    expect(editor.exec({ type: 'paste', text: 'ZULU' })).toEqual({
      ok: false,
      code: 'unsupported',
      reason: GROUP_MEMBER_PASTE_REASON,
    });
    expect(await saved(editor)).toBe(before);
  });
});

/** A picture data URL for pasted HTML. */
const PNG_SRC = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;

describe('what a paste carries', () => {
  test('a line break or a tab alone replaces the text of a selected text box', async () => {
    for (const pasted of ['\n', '\t']) {
      const { editor, surface } = await open(body(TEXT_BOX));
      selectFirstDrawing(editor);
      const bodyBefore = bodyText(editor);
      expect(drawingPasteTarget(surface, 'text')).toMatchObject({ kind: 'textBox' });
      expect(editor.exec({ type: 'paste', text: pasted })).toMatchObject({ ok: true });
      expect(boxText(editor)).toEqual(pasted === '\n' ? ['', ''] : ['\t']);
      expect(bodyText(editor)).toEqual(bodyBefore);
    }
  });

  test('a space on a shape with no text refuses, as other text does', async () => {
    const { editor } = await open(body(SHAPE));
    selectFirstDrawing(editor);
    const before = await saved(editor);
    expect(editor.exec({ type: 'paste', text: ' ' })).toEqual({
      ok: false,
      code: 'unsupported',
      reason: SHAPE_PASTE_TEXT_REASON,
    });
    expect(await saved(editor)).toBe(before);
  });

  test('HTML with a picture and only a line break of text goes before the anchor', async () => {
    const { editor } = await open(body(TEXT_BOX));
    selectFirstDrawing(editor);
    const html = `<p><img src="${PNG_SRC}" width="10" height="10"></p>`;
    expect(editor.exec({ type: 'paste', text: '\n', html })).toMatchObject({ ok: true });
    expect(boxText(editor)).toEqual(['Box one.', 'Box two.']);
    expect(bodyText(editor)[0]).toBe(`Alpha head${OBJ}${OBJ}Alpha tail.`);
  });

  test('HTML with text and a picture refuses on a text box, and the box keeps its text', async () => {
    const { editor, surface } = await open(body(TEXT_BOX));
    const box = selectFirstDrawing(editor);
    const before = await saved(editor);
    const html = `<p>ZULU <img src="${PNG_SRC}" width="10" height="10"></p>`;
    const refused = { ok: false, code: 'unsupported', reason: TEXT_BOX_PICTURE_PASTE_REASON };
    expect(editor.can({ type: 'paste', text: 'ZULU', html })).toEqual(refused);
    expect(editor.exec({ type: 'paste', text: 'ZULU', html })).toEqual(refused);
    expect(await saved(editor)).toBe(before);
    expect(editor.snapshot().image?.id).toBe(box);
    // Paste without formatting takes the text alone.
    expect(editor.exec({ type: 'pasteWithoutFormatting', text: 'ZULU' })).toMatchObject({
      ok: true,
    });
    expect(boxText(editor)).toEqual(['ZULU']);
    expect(surface.activeScope().kind).toBe('frame');
  });

  test('an editor fragment that holds a picture refuses on a text box too', async () => {
    const { surface } = await open(body(PICTURE));
    // Copy the picture's anchor with the text after it, "Alpha".
    const [first] = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: first!, offset: 'Alpha head'.length },
      head: { paragraphId: first!, offset: 'Alpha head'.length + 6 },
    });
    const copied = surface.copyFlavours();
    expect(copied.html).toContain('data-docx-fragment=');
    const other = await open(body(TEXT_BOX));
    selectFirstDrawing(other.editor);
    expect(other.surface.pasteRich(copied.text, copied.html)).toBe(false);
    expect(other.surface.state().lastRejection).toBe(TEXT_BOX_PICTURE_PASTE_REASON);
    expect(boxText(other.editor)).toEqual(['Box one.', 'Box two.']);
  });
});

describe('the Paste control while a drawing is selected', () => {
  const linked = () =>
    floating('Linked', boxShape('<wps:linkedTxbx id="1" seq="1"/>'), SHAPE_URI, 11);

  test('a probe with no payload stays live: a copied drawing could still land', async () => {
    const probe = { type: 'paste', text: ' ' } as const;
    for (const drawing of [SHAPE, linked(), TEXT_BOX, PICTURE]) {
      const { editor } = await open(body(drawing));
      selectFirstDrawing(editor);
      expect(editor.can(probe)).toEqual({ ok: true });
      expect(editor.can({ type: 'pasteWithoutFormatting', text: ' ' })).toEqual({ ok: true });
    }
    // A shape selected inside a group: the probe stays live there too.
    const { editor, surface } = await open(body(GROUP));
    const group = selectFirstDrawing(editor);
    const member = (findNode(surface.session.part(), group) as OoxmlNode & {
      children: OoxmlNode[];
    })!;
    const shapes: string[] = [];
    const visit = (node: OoxmlNode) => {
      if (node.kind === 'textValue') return;
      if ((node as { localName?: string }).localName === 'wsp') shapes.push(node.id);
      node.children.forEach(visit);
    };
    visit(member);
    expect(surface.selectDrawingMember(shapes[0]!)).toBe(true);
    expect(editor.can(probe)).toEqual({ ok: true });
  });

  test('a known payload refuses in can with the reason the paste gives', async () => {
    const { editor, surface } = await open(body(SHAPE));
    selectFirstDrawing(editor);
    const refused = { ok: false, code: 'unsupported', reason: SHAPE_PASTE_TEXT_REASON };
    expect(editor.can({ type: 'paste', text: 'ZULU' })).toEqual(refused);
    expect(editor.can({ type: 'pasteWithoutFormatting', text: 'ZULU' })).toEqual(refused);
    // A copied drawing is a known payload that lands, so it stays live.
    const copied = surface.copyFlavours();
    expect(editor.can({ type: 'paste', text: copied.text, html: copied.html! })).toEqual({
      ok: true,
    });
    // A copied chart carries its name as text, but it pastes where a drawing does.
    const chart = `<p data-docx-editor-chart="${'a'.repeat(32)}">Chart 1</p>`;
    expect(editor.can({ type: 'paste', text: 'Chart 1', html: chart })).toEqual({ ok: true });
  });
});

describe('the paste payload flavours', () => {
  test('HTML with visible text and no plain text replaces a text box text', async () => {
    const { editor, surface } = await open(body(TEXT_BOX));
    selectFirstDrawing(editor);
    expect(editor.exec({ type: 'paste', text: '', html: '<p>Hello there</p>' })).toMatchObject({
      ok: true,
    });
    expect(boxText(editor)).toEqual(['Hello there']);
    expect(surface.activeScope().kind).toBe('frame');
  });

  test('HTML with visible text and no plain text refuses on a shape with no text', async () => {
    const { editor } = await open(body(SHAPE));
    selectFirstDrawing(editor);
    const before = await saved(editor);
    expect(editor.exec({ type: 'paste', text: '', html: '<p>Hello</p>' })).toEqual({
      ok: false,
      code: 'unsupported',
      reason: SHAPE_PASTE_TEXT_REASON,
    });
    expect(await saved(editor)).toBe(before);
  });

  test('paste without formatting with empty text refuses and keeps the selection text', async () => {
    const { editor, surface } = await open(body(PICTURE));
    const [, second] = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: second!, offset: 0 },
      head: { paragraphId: second!, offset: 3 },
    });
    expect(editor.exec({ type: 'pasteWithoutFormatting', text: '' })).toMatchObject({
      ok: false,
      code: 'invalidArgs',
    });
    expect(bodyText(editor)[1]).toBe('Bravo');
  });
});

describe('a text box that cannot be entered for the paste', () => {
  test('selects the drawing again after the box was entered', async () => {
    const { editor, surface } = await open(body(TEXT_BOX));
    const box = selectFirstDrawing(editor);
    const anchorParagraph = surface.state().selection.anchor.paragraphId;
    let exited = 0;
    const textbox = {
      enterDrawing: () => {
        surface.setSelection({
          anchor: { paragraphId: anchorParagraph, offset: 0 },
          head: { paragraphId: anchorParagraph, offset: 0 },
        });
        return true;
      },
      paragraphIds: () => [],
      exit: () => {
        exited += 1;
      },
    } as unknown as Parameters<typeof selectTextBoxForPaste>[1];
    expect(selectTextBoxForPaste(surface, textbox, box)).toBe(false);
    expect(exited).toBe(1);
    expect(editor.snapshot().image?.id).toBe(box);
  });
});

describe('a linked text box selected', () => {
  test('text refuses with the linked text box reason', async () => {
    const linked = floating('Linked', boxShape('<wps:linkedTxbx id="1" seq="1"/>'), SHAPE_URI, 11);
    const { editor, surface } = await open(body(linked));
    selectFirstDrawing(editor);
    expect(drawingPasteTarget(surface, 'text')).toEqual({
      kind: 'refused',
      reason: LINKED_TEXT_BOX_PASTE_REASON,
    });
    const before = await saved(editor);
    expect(editor.exec({ type: 'paste', text: 'ZULU' })).toMatchObject({
      ok: false,
      reason: LINKED_TEXT_BOX_PASTE_REASON,
    });
    expect(await saved(editor)).toBe(before);
  });
});

describe('a drawing outside the body text', () => {
  /** The header part's XML after a save. */
  const headerXml = async (editor: DocxEditorInstance) =>
    strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/header1.xml']!);

  test('text pasted on a header text box replaces its text, and undo restores it', async () => {
    const { editor, surface } = await open(
      p(text('Body')),
      'edit',
      p(text('Header line ') + TEXT_BOX)
    );
    const scope = editor.findMatches('Box one.')[0]!.scope!;
    if (scope.kind !== 'frame') throw new Error('the header box has no frame scope');
    expect(surface.setActiveScope(scope)).toBe(true);
    expect(surface.selectDrawing(scope.drawingNodeId, scope.hostParagraphId)).toBe(true);
    const before = await headerXml(editor);
    expect(editor.exec({ type: 'paste', text: 'ZULU' })).toMatchObject({ ok: true });
    const after = await headerXml(editor);
    expect(after).toContain('ZULU');
    expect(after).not.toContain('Box one.');
    expect(after).toContain('Header line');
    expect(surface.activeScope().kind).toBe('frame');
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    expect(await headerXml(editor)).toBe(before);
  });

  test('an image file pasted on a header picture goes in before its anchor there', async () => {
    const { editor, surface } = await open(
      p(text('Body')),
      'edit',
      p(text('Header line ') + PICTURE)
    );
    expect(surface.setActiveScope(editor.findMatches('Header line')[0]!.scope!)).toBe(true);
    const drawing = surface.layout().pages[0]!.header!.anchoredDrawings![0]!;
    expect(surface.selectDrawing(drawing.drawingNodeId, drawing.anchorParagraphId)).toBe(true);
    const plan = imageFilePastePlan(editor, imageFileTransfer());
    expect(plan?.at).toMatchObject({
      part: '/word/header1.xml',
      paragraphId: drawing.anchorParagraphId,
      offset: 'Header line'.length,
    });
    const result = await editor.executeImageCommand({
      type: 'insertImage',
      data: PNG,
      mime: 'image/png',
      widthPoints: 10,
      heightPoints: 10,
      at: plan!.at!,
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    const header = await headerXml(editor);
    expect(header.indexOf('<wp:inline')).toBeGreaterThan(header.indexOf('Header line'));
    expect(header.indexOf('<wp:inline')).toBeLessThan(header.indexOf('<wp:anchor'));
    expect(await saved(editor)).not.toContain('<w:drawing');
  });

  test('a drawing anchored in a table cell takes text in that cell', async () => {
    const cell = (content: string) =>
      `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
    const table = (drawing: string) =>
      '<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/></w:tblPr><w:tblGrid>' +
      '<w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr>' +
      cell(p(text('Cell head ') + drawing + text('Cell tail'))) +
      cell(p(text('Next cell'))) +
      '</w:tr></w:tbl>' +
      p(text('After'));
    const pictureDoc = await open(table(INLINE_PICTURE));
    // A table fragment has no lines of its own: select the inline picture by its node.
    const cellSurface = pictureDoc.surface;
    const cellParagraph = cellSurface.session.paragraphIds()[0]!;
    const drawingIds: string[] = [];
    const collect = (node: OoxmlNode) => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'drawing') drawingIds.push(node.id);
      node.children.forEach(collect);
    };
    collect(findNode(cellSurface.session.part(), cellParagraph)!);
    expect(cellSurface.selectDrawing(drawingIds[0]!, cellParagraph)).toBe(true);
    expect(pictureDoc.editor.snapshot().image?.id).toBe(drawingIds[0]);
    expect(pictureDoc.editor.exec({ type: 'paste', text: 'ZULU' })).toMatchObject({ ok: true });
    expect(bodyText(pictureDoc.editor)).toEqual([
      `Cell headZULU${OBJ}Cell tail`,
      'Next cell',
      'After',
    ]);

    const boxDoc = await open(table(TEXT_BOX));
    selectFirstDrawing(boxDoc.editor);
    expect(boxDoc.editor.exec({ type: 'paste', text: 'ZULU' })).toMatchObject({ ok: true });
    expect(boxText(boxDoc.editor)).toEqual(['ZULU']);
    expect(bodyText(boxDoc.editor)[0]).toBe(`Cell head${OBJ}Cell tail`);
    expect(boxDoc.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    expect(boxText(boxDoc.editor)).toEqual(['Box one.', 'Box two.']);
  });
});

describe('a drawing in a note', () => {
  test('cannot be selected, so a paste in the note lands at its caret', async () => {
    const W_URI = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const files = unzipSync(
      documentBytes(p(text('Body') + '<w:r><w:footnoteReference w:id="1"/></w:r>'))
    );
    files['word/footnotes.xml'] = strToU8(
      `<w:footnotes xmlns:w="${W_URI}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
        `xmlns:wps="${SHAPE_URI}"><w:footnote w:id="1"><w:p><w:r><w:t>Note head</w:t></w:r>` +
        INLINE_PICTURE +
        '<w:r><w:t>tail</w:t></w:r></w:p></w:footnote></w:footnotes>'
    );
    files['word/_rels/document.xml.rels'] = strToU8(
      strFromU8(files['word/_rels/document.xml.rels']!).replace(
        '</Relationships>',
        '<Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>'
      )
    );
    files['[Content_Types].xml'] = strToU8(
      strFromU8(files['[Content_Types].xml']!).replace(
        '</Types>',
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>'
      )
    );
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: zipSync(files) });
    editors.push(editor);
    const surface = editor.surface!;
    expect(surface.setActiveScope(editor.findMatches('Note head')[0]!.scope!)).toBe(true);
    const part = surface.session.partFor(surface.storyScope())!;
    const drawings: { id: string; paragraphId: string }[] = [];
    const walk = (node: OoxmlNode, paragraphId: string) => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'drawing') drawings.push({ id: node.id, paragraphId });
      for (const child of node.children)
        walk(child, node.kind === 'paragraph' ? node.id : paragraphId);
    };
    walk(part.root, '');
    expect(surface.selectDrawing(drawings[0]!.id, drawings[0]!.paragraphId)).toBe(false);
    expect(drawingPasteTarget(surface, 'text')).toBeNull();
  });
});

describe('a picture file while an inline picture is selected', () => {
  test('goes in before the inline picture while editing, which stays', async () => {
    const { editor, surface } = await open(body(INLINE_PICTURE));
    const picture = selectFirstDrawing(editor);
    const result = await editor.executeImageCommand({
      type: 'insertImage',
      data: PNG,
      mime: 'image/png',
      widthPoints: 10,
      heightPoints: 10,
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(bodyText(editor)[0]).toBe(`Alpha head${OBJ}${OBJ}Alpha tail.`);
    const names = drawingNames(await saved(editor));
    expect(names).toHaveLength(2);
    expect(names[1]).toBe('Photo');
    expect(findNode(surface.session.part(), picture)).not.toBeNull();
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    expect(bodyText(editor)[0]).toBe(`Alpha head${OBJ}Alpha tail.`);
  });
});

describe('a paste the store refuses, and a copied chart', () => {
  test('a text box whose text is a locked content control returns the store refusal', async () => {
    const locked = floating(
      'Locked',
      boxShape(
        '<wps:txbx><w:txbxContent><w:p><w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr>' +
          '<w:sdtContent><w:r><w:t>Locked words</w:t></w:r></w:sdtContent></w:sdt></w:p>' +
          '</w:txbxContent></wps:txbx>'
      )
    );
    const { editor, surface } = await open(body(locked));
    const box = selectFirstDrawing(editor);
    const before = await saved(editor);
    const result = editor.exec({ type: 'paste', text: 'ZULU' });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ code: 'unsupported', reason: surface.state().lastRejection });
    expect(surface.state().lastRejection).toBeString();
    expect(await saved(editor)).toBe(before);
    // The box is left, and its drawing is selected again.
    expect(editor.snapshot().image?.id).toBe(box);
  });

  test('a copied chart pastes before the selected drawing anchor through exec', async () => {
    const { editor, surface } = await open(body(SHAPE));
    const last = surface.session.paragraphIds().at(-1)!;
    surface.setSelection({
      anchor: { paragraphId: last, offset: 0 },
      head: { paragraphId: last, offset: 0 },
    });
    expect(editor.exec({ type: 'insertChart', chartType: 'columnClustered' }).ok).toBe(true);
    const copied = surface.copyFlavours();
    expect(copied.html).toContain('data-docx-editor-chart=');
    selectFirstDrawing(editor);
    const command = { type: 'paste', text: copied.text, html: copied.html! } as const;
    expect(editor.can(command)).toEqual({ ok: true });
    expect(editor.exec(command)).toMatchObject({ ok: true, changed: true });
    const anchorParagraph = (await saved(editor)).split('</w:p>')[0]!;
    expect(anchorParagraph).toContain('c:chart');
    expect(anchorParagraph.indexOf('c:chart')).toBeLessThan(
      anchorParagraph.indexOf('name="Plain"')
    );
  });
});

describe('a copied chart, and a refusal after the caret moved', () => {
  /** Insert a chart in the last paragraph and copy it. */
  function copyNewChart(editor: DocxEditorInstance) {
    const surface = editor.surface!;
    const last = surface.session.paragraphIds().at(-1)!;
    surface.setSelection({
      anchor: { paragraphId: last, offset: 0 },
      head: { paragraphId: last, offset: 0 },
    });
    expect(editor.exec({ type: 'insertChart', chartType: 'columnClustered' }).ok).toBe(true);
    const copied = surface.copyFlavours();
    expect(copied.html).toContain('data-docx-editor-chart=');
    return { type: 'paste', text: copied.text, html: copied.html! } as const;
  }

  /** The first paragraph's saved markup. */
  const firstParagraph = async (editor: DocxEditorInstance) => {
    const xml = await saved(editor);
    return xml.slice(xml.indexOf('<w:body'), xml.indexOf('</w:p>'));
  };

  test('a copied chart goes in before an inline picture with the caret after it', async () => {
    const { editor, surface } = await open(body(INLINE_PICTURE));
    const command = copyNewChart(editor);
    const paragraphId = surface.session.paragraphIds()[0]!;
    const after = { paragraphId, offset: 'Alpha head'.length + 1 };
    surface.setSelection({ anchor: after, head: after });
    expect(editor.snapshot().image).not.toBeNull();
    expect(editor.exec(command)).toMatchObject({ ok: true, changed: true });
    const first = await firstParagraph(editor);
    expect(first.indexOf('c:chart')).toBeGreaterThan(first.indexOf('Alpha head'));
    expect(first.indexOf('c:chart')).toBeLessThan(first.indexOf('name="Photo"'));
    expect(bodyText(editor)[0]).toBe(`Alpha head${OBJ}${OBJ}Alpha tail.`);
  });

  test('a copied chart goes in before the anchor of a floating picture', async () => {
    const { editor } = await open(body(PICTURE));
    const command = copyNewChart(editor);
    selectFirstDrawing(editor);
    expect(editor.exec(command)).toMatchObject({ ok: true, changed: true });
    const first = await firstParagraph(editor);
    expect(first.indexOf('c:chart')).toBeGreaterThan(first.indexOf('Alpha head'));
    expect(first.indexOf('c:chart')).toBeLessThan(first.indexOf('name="Photo"'));
  });

  test('a paste refused after the caret moved selects the drawing again', async () => {
    const locked =
      '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
      text('Alpha head') +
      INLINE_PICTURE +
      '</w:sdtContent></w:sdt>';
    const { editor, surface } = await open(p(locked + text('Alpha tail.')));
    const paragraphId = surface.session.paragraphIds()[0]!;
    // The caret after the picture, as a press on its right half leaves it.
    const after = { paragraphId, offset: bodyText(editor)[0]!.indexOf(OBJ) + 1 };
    surface.setSelection({ anchor: after, head: after });
    const picture = editor.snapshot().image?.id;
    expect(picture).toBeString();
    const before = await saved(editor);
    expect(editor.exec({ type: 'paste', text: 'ZULU' }).ok).toBe(false);
    expect(await saved(editor)).toBe(before);
    expect(editor.snapshot().image?.id).toBe(picture);
  });
});

describe('an earlier paste refusal', () => {
  for (const payload of [
    { text: '\u0007' },
    { text: '', html: '<img src="https://example.invalid/a.png">' },
    { text: '', html: '<span> </span>' },
  ]) {
    test(`is not reported for a later paste that lands nothing: ${JSON.stringify(payload)}`, async () => {
      const { editor, surface } = await open(
        body(SHAPE) + p(text('x') + INLINE_PICTURE + text('y'))
      );
      selectFirstDrawing(editor);
      expect(editor.exec({ type: 'paste', text: 'abc' })).toMatchObject({
        ok: false,
        reason: SHAPE_PASTE_TEXT_REASON,
      });
      // The caret after the inline picture: the paste moves it before the picture.
      const paragraphId = surface.session.paragraphIds().at(-1)!;
      surface.setSelection({
        anchor: { paragraphId, offset: 2 },
        head: { paragraphId, offset: 2 },
      });
      const before = await saved(editor);
      expect(editor.exec({ type: 'paste', ...payload })).toEqual({ ok: true, changed: false });
      expect(await saved(editor)).toBe(before);
    });
  }
});

describe('a selected inline picture with the caret after it', () => {
  /** Select the inline picture with the caret at `start + 1`, as a right-half press leaves it. */
  async function caretAfterPicture() {
    const opened = await open(body(INLINE_PICTURE));
    const paragraphId = opened.surface.session.paragraphIds()[0]!;
    const after = { paragraphId, offset: 'Alpha head'.length + 1 };
    opened.surface.setSelection({ anchor: after, head: after });
    expect(opened.editor.snapshot().image).not.toBeNull();
    return opened;
  }

  test('text and a copied drawing go in before the picture, not after it', async () => {
    const { editor, surface } = await caretAfterPicture();
    expect(drawingPasteTarget(surface, 'text')).toMatchObject({ offset: 'Alpha head'.length });
    expect(editor.exec({ type: 'paste', text: 'ZULU' })).toMatchObject({ ok: true });
    expect(bodyText(editor)[0]).toBe(`Alpha headZULU${OBJ}Alpha tail.`);

    const again = await caretAfterPicture();
    // Copy the selected picture, which stays selected with the caret after it.
    const copied = again.surface.copyFlavours();
    expect(again.surface.pasteRich(copied.text, copied.html)).toBe(true);
    const names = drawingNames(await saved(again.editor));
    expect(names).toHaveLength(2);
    expect(bodyText(again.editor)[0]).toBe(`Alpha head${OBJ}${OBJ}Alpha tail.`);
  });

  test('an inserted picture goes in before the picture', async () => {
    const { editor } = await caretAfterPicture();
    const result = await editor.executeImageCommand({
      type: 'insertImage',
      data: PNG,
      mime: 'image/png',
      widthPoints: 10,
      heightPoints: 10,
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    const xml = await saved(editor);
    const first = xml.slice(xml.indexOf('<w:body'), xml.indexOf('</w:p>'));
    // The new picture comes first; the selected picture, named Photo, follows it.
    expect(drawingNames(first)).toHaveLength(2);
    expect(drawingNames(first)[1]).toBe('Photo');
    expect(first.indexOf('Alpha head')).toBeLessThan(first.indexOf('<w:drawing'));
  });
});
