// Where a paste goes while a drawing is selected. Content goes in immediately before the
// selected drawing's anchor run; text pasted while a text box is selected replaces the text box's
// text; a shape with no text refuses text with a reason. Every paste lane asks the same question.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { paragraphTextOf, type OoxmlNode } from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { forwardClipboardEvents } from '../chrome-clipboard.ts';
import { findNode } from '../../store/package/ooxml-edit.ts';
import { textboxStoriesInPart } from '../../store/package/textbox-stories.ts';
import { drawingPasteTarget } from '../drawing-paste-target.ts';
import { wrapInteropHtml } from '../clipboard-fragment-codec.ts';
import {
  GROUP_MEMBER_PASTE_REASON,
  SHAPE_PASTE_TEXT_REASON,
  TEXT_BOX_PASTE_REASON,
} from '../surface-drawing-clipboard.ts';
import { PICTURE_SELECTED_INSERT_REASON } from '../docx-editor-images.ts';
import { validateRasterHeader, type ImageDecodePort } from '../../store/package/image-resources.ts';
import {
  EMU,
  GROUP,
  LINE,
  SHAPE_URI,
  SOLID,
  anchor,
  documentBytes,
  p,
  saved,
  text,
  wsp,
} from './shape-selection-fixture.ts';
import { stubReviewModule } from './review-test-module.ts';

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ),
  (c) => c.charCodeAt(0)
);
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const PIC =
  '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr>' +
  '<pic:cNvPr id="9" name="p.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>' +
  '<a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdP"/>' +
  '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/>' +
  `<a:ext cx="${100 * EMU}" cy="${60 * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
  '</pic:spPr></pic:pic>';

const floating = (name: string, graphic: string, uri = SHAPE_URI, id = 9) =>
  anchor({ id, name, x: 250 * EMU, y: 150 * EMU, cx: 100 * EMU, cy: 60 * EMU, graphic, uri });
const PICTURE = floating('Photo', PIC, PIC_URI);
const INLINE_PICTURE =
  `<w:r><w:drawing><wp:inline><wp:extent cx="${100 * EMU}" cy="${60 * EMU}"/>` +
  `<wp:docPr id="9" name="Photo"/><a:graphic><a:graphicData uri="${PIC_URI}">${PIC}` +
  '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
const boxShape = (body: string, extra = '') =>
  wsp(100 * EMU, 60 * EMU, 'rect', SOLID('FFE699')).replace(
    '<wps:bodyPr/>',
    `${body}<wps:bodyPr${extra}/>`
  );
const BOX_TEXT =
  '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Box one.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Box two.</w:t></w:r></w:p></w:txbxContent></wps:txbx>';
const TEXT_BOX = floating('Box', boxShape(BOX_TEXT));
const SHAPE = floating('Plain', boxShape(''));
const VML_BOX =
  '<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" ' +
  'xmlns:o="urn:schemas-microsoft-com:office:office" id="Box" o:spid="_x0000_s1026" ' +
  'style="position:absolute;margin-left:200pt;margin-top:150pt;width:100pt;height:40pt;z-index:1">' +
  '<v:textbox><w:txbxContent><w:p><w:r><w:t>Legacy box</w:t></w:r></w:p></w:txbxContent>' +
  '</v:textbox></v:shape></w:pict></w:r>';

/** The probe body: the drawing anchored mid-paragraph, drawn lower on the page. */
const body = (drawing: string) =>
  p(text('Alpha head ') + drawing + text('Alpha tail.')) + p(text('Bravo')) + p(text('Charlie'));

/** The document, with the picture's image part when a picture refers to one. */
function bytesOf(markup: string): Uint8Array {
  const files = unzipSync(documentBytes(markup));
  if (markup.includes('rIdP')) {
    files['word/_rels/document.xml.rels'] = strToU8(
      strFromU8(files['word/_rels/document.xml.rels']!).replace(
        '</Relationships>',
        '<Relationship Id="rIdP" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/p.png"/></Relationships>'
      )
    );
    files['[Content_Types].xml'] = strToU8(
      strFromU8(files['[Content_Types].xml']!).replace(
        '<Default Extension="xml"',
        '<Default Extension="png" ContentType="image/png"/><Default Extension="xml"'
      )
    );
    files['word/media/p.png'] = PNG;
  }
  return zipSync(files);
}

/** Decodes the PNG header only: the test DOM has no image decoder. */
const testDecodePort: ImageDecodePort = Object.freeze({
  async decode(bytes: Uint8Array, mime: string) {
    const header = validateRasterHeader(bytes, mime as 'image/png');
    if (!header) throw new Error('invalid image');
    return Object.freeze({
      pixelWidth: header.pixelWidth,
      pixelHeight: header.pixelHeight,
      dpiX: 96,
      dpiY: 96,
    });
  },
});

async function open(markup: string, mode: 'edit' | 'suggest' = 'edit') {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: bytesOf(markup),
    author: 'Reviewer',
    modules: [stubReviewModule()],
    imageDecodePort: testDecodePort,
  });
  editors.push(editor);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.surface?.layout();
  }
  if (mode !== 'edit') editor.surface!.setEditingMode(mode);
  return { editor, container, surface: editor.surface! };
}

/** Select the first drawing of the first paragraph, inline or floating, or the drawing `wanted`. */
function selectFirstDrawing(editor: DocxEditorInstance, wanted?: string): string {
  const surface = editor.surface!;
  const page = surface.layout().pages[0]!;
  const first = surface.session.paragraphIds()[0];
  const anchored = page.anchoredDrawings?.find((drawing) =>
    wanted ? drawing.drawingNodeId === wanted : drawing.anchorParagraphId === first
  );
  const inline = page.fragments.flatMap((fragment) =>
    'lines' in fragment ? fragment.lines.flatMap((line) => line.drawings ?? []) : []
  )[0];
  const id = anchored?.drawingNodeId ?? inline!.drawingNodeId;
  const paragraphId = anchored?.anchorParagraphId ?? inline!.paragraphId;
  expect(surface.selectDrawing(id, paragraphId)).toBe(true);
  expect(editor.snapshot().image?.id).toBe(id);
  return id;
}

/** Each body paragraph as text, with each drawing as its object character. */
const bodyText = (editor: DocxEditorInstance) =>
  editor
    .surface!.session.paragraphIds()
    .map((id) => paragraphTextOf(editor.surface!.session.part(), id));

/** The paragraphs of the first text box story in the body. */
const boxText = (editor: DocxEditorInstance) => {
  const part = editor.surface!.session.part();
  const story = textboxStoriesInPart(part)[0]!;
  return story.root.children
    .filter((child) => child.kind === 'paragraph')
    .map((paragraph) => paragraphTextOf(part, paragraph.id));
};

/** The `wp:docPr` names in document order, the drawings of the anchor paragraph first. */
const drawingNames = (xml: string) =>
  [...xml.matchAll(/<wp:docPr [^>]*name="([^"]*)"/g)].map((m) => m[1]);

const OBJ = '￼';

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
