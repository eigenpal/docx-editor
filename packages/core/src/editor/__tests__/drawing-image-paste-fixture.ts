// Shared fixtures for pasting an image file while a drawing is selected: a document with a
// floating picture, a shape and a text box, each anchored in its own paragraph, and a paste
// event that carries an image file.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { DocxEditorInstance } from '../docx-editor-types.ts';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import type { ImageDecodePort } from '../../store/package/image-resources.ts';
import { validateRasterHeader } from '../../store/package/image-resources.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';
import {
  A,
  CT,
  EMU,
  OD,
  R,
  REL,
  SHAPE_URI,
  SOLID,
  W,
  WP,
  WPS,
  anchor,
  spPr,
  wsp,
} from './shape-selection-fixture.ts';

const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const PICTURE_URI = PIC;

/** A 1x1 PNG: the picture in the document and the pasted file. */
export const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

/** The `relativeHeight` of each drawing, which names it in the layout. */
export const DRAWINGS = { picture: 1, shape: 2, textBox: 3 } as const;
export type DrawingKind = keyof typeof DRAWINGS;

const picture =
  `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name="Logo"/><pic:cNvPicPr/></pic:nvPicPr>` +
  '<pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${60 * EMU}" cy="${60 * EMU}"/></a:xfrm>` +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>';

const textBox =
  `<wps:wsp><wps:cNvSpPr txBox="1"/>${spPr(120 * EMU, 40 * EMU, 'rect', SOLID('FFFFFF'))}` +
  '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Boxed</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
  '<wps:bodyPr/></wps:wsp>';

const run = (value: string) => `<w:r><w:t>${value}</w:t></w:r>`;

/** Each drawing floats to the right of the text, in its own paragraph; `Delta` has none. */
export const BODY =
  `<w:p>${run('Alpha')}${anchor({ id: DRAWINGS.picture, name: 'Logo', x: 300 * EMU, y: 0, cx: 60 * EMU, cy: 60 * EMU, graphic: picture, uri: PICTURE_URI })}</w:p>` +
  `<w:p>${run('Bravo')}${anchor({ id: DRAWINGS.shape, name: 'Shape', x: 300 * EMU, y: 100 * EMU, cx: 60 * EMU, cy: 40 * EMU, graphic: wsp(60 * EMU, 40 * EMU, 'rect', SOLID('9DC3E6')), uri: SHAPE_URI })}</w:p>` +
  `<w:p>${run('Charlie')}${anchor({ id: DRAWINGS.textBox, name: 'Box', x: 300 * EMU, y: 200 * EMU, cx: 120 * EMU, cy: 40 * EMU, graphic: textBox, uri: SHAPE_URI })}</w:p>` +
  `<w:p>${run('Delta')}</w:p>`;

/** {@link BODY} with a plain first paragraph: a shape and a text box, and no image parts. */
export const SHAPES_BODY = BODY.replace(/<w:p>.*?<\/w:p>/, `<w:p>${run('Alpha')}</w:p>`);

export function drawingDocument(body = BODY): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}" xmlns:r="${R}">` +
        `<w:body>${body}</w:body></w:document>`
    ),
    // A body without the picture has no image relationship to carry.
    ...(body.includes('rIdImage')
      ? {
          'word/_rels/document.xml.rels': strToU8(
            `<Relationships xmlns="${REL}"><Relationship Id="rIdImage" Type="${R}/image" Target="media/image1.png"/></Relationships>`
          ),
          'word/media/image1.png': PNG_1X1,
        }
      : {}),
  });
}

/** Decodes the PNG header, as a browser host decodes pasted bytes. */
export const decodePort: ImageDecodePort = {
  async decode(bytes, mime) {
    const header = validateRasterHeader(bytes, mime);
    if (!header) throw new Error('invalid image');
    if (header.pixelWidth * header.pixelHeight > resolveImageResourceLimits().maxPixels) {
      throw new Error('too large');
    }
    return Object.freeze({
      pixelWidth: header.pixelWidth,
      pixelHeight: header.pixelHeight,
      dpiX: 96,
      dpiY: 96,
    });
  },
};

/** Select a fixture drawing as a press on it does. Returns its anchor paragraph's index. */
export function selectFixtureDrawing(editor: DocxEditorInstance, kind: DrawingKind): number {
  const surface = editor.surface!;
  for (const page of surface.layout().pages)
    for (const drawing of page.anchoredDrawings ?? []) {
      if (drawing.relativeHeight !== DRAWINGS[kind]) continue;
      if (!surface.selectDrawing(drawing.drawingNodeId, drawing.anchorParagraphId))
        throw new Error(`the ${kind} cannot be selected`);
      return surface.session.paragraphIds().indexOf(drawing.anchorParagraphId);
    }
  throw new Error(`no ${kind} in the layout`);
}

/** Put the caret at the end of body paragraph `index`. */
export function caretAtEndOf(editor: DocxEditorInstance, index: number): void {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[index]!;
  const offset = (paragraphTextOf(surface.session.part(), paragraphId) ?? '').length;
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

/**
 * A bubbling paste event over an in-memory transfer. `file` adds an image file; `flavours`
 * adds string flavours such as `text/plain` and `text/html`. `onFileRead` runs each time the
 * image-file lane reads the file's bytes: the spy on the insert path. The engine prevents the
 * default of every paste it sees, so `defaultPrevented` cannot tell whether the lane ran.
 */
export function pasteEvent(options: {
  readonly file?: boolean;
  readonly flavours?: Readonly<Record<string, string>>;
  readonly onFileRead?: () => void;
}): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  const files = options.file ? [new File([PNG_1X1], 'pasted.png', { type: 'image/png' })] : [];
  for (const file of files) {
    const read = file.arrayBuffer.bind(file);
    file.arrayBuffer = () => {
      options.onFileRead?.();
      return read();
    };
  }
  const flavours = options.flavours ?? {};
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files,
      items: [
        ...files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
        ...Object.keys(flavours).map((type) => ({ kind: 'string', type, getAsFile: () => null })),
      ],
      types: [...Object.keys(flavours), ...(files.length ? ['Files'] : [])],
      getData: (type: string) => flavours[type] ?? '',
      setData: () => undefined,
    },
  });
  return event;
}

/** The saved main document part. */
export async function savedDocumentXml(editor: DocxEditorInstance): Promise<string> {
  return strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
}

/** The top-level body paragraphs of saved markup, in order. A text box holds its own. */
export function bodyParagraphs(xml: string): string[] {
  const body = xml.slice(xml.indexOf('<w:body>'));
  const paragraphs: string[] = [];
  let depth = 0;
  let start = -1;
  for (const match of body.matchAll(/<w:p[ >]|<\/w:p>/g)) {
    if (match[0] === '</w:p>') {
      depth -= 1;
      if (depth === 0) paragraphs.push(body.slice(start, match.index! + 6));
    } else {
      if (depth === 0) start = match.index!;
      depth += 1;
    }
  }
  return paragraphs;
}

/** How many pictures each body paragraph holds, in order, in saved markup. */
export function picturesPerParagraph(xml: string): number[] {
  return bodyParagraphs(xml).map((paragraph) => paragraph.split('<pic:pic').length - 1);
}
