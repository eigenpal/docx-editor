// The documents and helpers that the drawing paste tests share: a probe body with one drawing
// anchored mid-paragraph, the drawings it can hold, and a mounted editor to paste into.

import { expect } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { textboxStoriesInPart } from '../../store/package/textbox-stories.ts';
import { validateRasterHeader, type ImageDecodePort } from '../../store/package/image-resources.ts';
import {
  EMU,
  SHAPE_URI,
  SOLID,
  anchor,
  documentBytes,
  p,
  text,
  wsp,
} from './shape-selection-fixture.ts';
import { stubReviewModule } from './review-test-module.ts';

/** The editors that `open` mounted. Each test file destroys them after each test. */
export const editors: DocxEditorInstance[] = [];

export const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ),
  (c) => c.charCodeAt(0)
);
export const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
export const PIC =
  '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr>' +
  '<pic:cNvPr id="9" name="p.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>' +
  '<a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdP"/>' +
  '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/>' +
  `<a:ext cx="${100 * EMU}" cy="${60 * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
  '</pic:spPr></pic:pic>';

export const floating = (name: string, graphic: string, uri = SHAPE_URI, id = 9) =>
  anchor({ id, name, x: 250 * EMU, y: 150 * EMU, cx: 100 * EMU, cy: 60 * EMU, graphic, uri });
export const PICTURE = floating('Photo', PIC, PIC_URI);
export const INLINE_PICTURE =
  `<w:r><w:drawing><wp:inline><wp:extent cx="${100 * EMU}" cy="${60 * EMU}"/>` +
  `<wp:docPr id="9" name="Photo"/><a:graphic><a:graphicData uri="${PIC_URI}">${PIC}` +
  '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
export const boxShape = (body: string, extra = '') =>
  wsp(100 * EMU, 60 * EMU, 'rect', SOLID('FFE699')).replace(
    '<wps:bodyPr/>',
    `${body}<wps:bodyPr${extra}/>`
  );
export const BOX_TEXT =
  '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Box one.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Box two.</w:t></w:r></w:p></w:txbxContent></wps:txbx>';
export const TEXT_BOX = floating('Box', boxShape(BOX_TEXT));
export const SHAPE = floating('Plain', boxShape(''));
export const VML_BOX =
  '<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" ' +
  'xmlns:o="urn:schemas-microsoft-com:office:office" id="Box" o:spid="_x0000_s1026" ' +
  'style="position:absolute;margin-left:200pt;margin-top:150pt;width:100pt;height:40pt;z-index:1">' +
  '<v:textbox><w:txbxContent><w:p><w:r><w:t>Legacy box</w:t></w:r></w:p></w:txbxContent>' +
  '</v:textbox></v:shape></w:pict></w:r>';

/** The probe body: the drawing anchored mid-paragraph, drawn lower on the page. */
export const body = (drawing: string) =>
  p(text('Alpha head ') + drawing + text('Alpha tail.')) + p(text('Bravo')) + p(text('Charlie'));

/** The document, with the picture's image part when a picture refers to one. */
export function bytesOf(markup: string, header?: string): Uint8Array {
  const files = unzipSync(documentBytes(markup, header));
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
export const testDecodePort: ImageDecodePort = Object.freeze({
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

export async function open(markup: string, mode: 'edit' | 'suggest' = 'edit', header?: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: bytesOf(markup, header),
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
export function selectFirstDrawing(editor: DocxEditorInstance, wanted?: string): string {
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
export const bodyText = (editor: DocxEditorInstance) =>
  editor
    .surface!.session.paragraphIds()
    .map((id) => paragraphTextOf(editor.surface!.session.part(), id));

/** The paragraphs of the first text box story in the body. */
export const boxText = (editor: DocxEditorInstance) => {
  const part = editor.surface!.session.part();
  const story = textboxStoriesInPart(part)[0]!;
  return story.root.children
    .filter((child) => child.kind === 'paragraph')
    .map((paragraph) => paragraphTextOf(part, paragraph.id));
};

/** The `wp:docPr` names in document order, the drawings of the anchor paragraph first. */
export const drawingNames = (xml: string) =>
  [...xml.matchAll(/<wp:docPr [^>]*name="([^"]*)"/g)].map((m) => m[1]);

export const OBJ = '￼';
