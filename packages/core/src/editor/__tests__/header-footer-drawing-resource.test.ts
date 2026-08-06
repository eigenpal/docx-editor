// A picture in a header or footer has to survive its own decode.
//
// Image resources resolve ASYNCHRONOUSLY: layout publishes a `pending` record, the decode
// settles, and the next pass is supposed to pick up the ready one. For the body that works
// because a drawing's resource rides its paragraph's flow key. A header/footer story reaches
// the session context only through its flow height and content key — both of which describe
// the AUTHORED part and are identical before and after a decode, since the extent is
// authored. The unchanged-pass early exit then found every key equal and returned the
// previous pages by identity, furniture included, so the picture stayed a "loading"
// placeholder for the rest of the session with nothing left to invalidate it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { validateRasterHeader, type ImageDecodePort } from '../../store/package/image-resources.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';
import type { HeaderFooterStoryRecord } from '../../layout/semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const HDR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FTR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

const NS = `xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"`;

function picture(): string {
  return (
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
    '<pic:nvPicPr><pic:cNvPr id="1" name="pic"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdImg"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic>'
  );
}

/** Anchored the way a letterhead is: `wrapNone`, offset out past the text column. */
function anchoredDrawing(): string {
  return (
    '<w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" ' +
    'layoutInCell="1" allowOverlap="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>5000000</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="457200" cy="457200"/><wp:wrapNone/><wp:docPr id="1" name="pic"/>' +
    `${picture()}</wp:anchor></w:drawing></w:r>`
  );
}

function inlineDrawing(): string {
  return (
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="457200" cy="457200"/><wp:docPr id="2" name="pic"/>' +
    `${picture()}</wp:inline></w:drawing></w:r>`
  );
}

function docx(options: { readonly headerBody: string; readonly footerBody: string }): Uint8Array {
  const rels = (target: string) =>
    strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdImg" Type="${IMG}" Target="${target}"/></Relationships>`
    );
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document ${NS}><w:body>` +
        '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
        '<w:sectPr>' +
        '<w:headerReference r:id="rIdHdr" w:type="default"/>' +
        '<w:footerReference r:id="rIdFtr" w:type="default"/>' +
        '<w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdHdr" Type="${HDR}" Target="header1.xml"/>` +
        `<Relationship Id="rIdFtr" Type="${FTR}" Target="footer1.xml"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(`<w:hdr ${NS}><w:p>${options.headerBody}</w:p></w:hdr>`),
    'word/footer1.xml': strToU8(`<w:ftr ${NS}><w:p>${options.footerBody}</w:p></w:ftr>`),
    'word/_rels/header1.xml.rels': rels('media/image1.png'),
    'word/_rels/footer1.xml.rels': rels('media/image1.png'),
    'word/media/image1.png': PNG_1X1,
  });
}

/** Validates the real bytes, like the browser port does, but without a browser. */
function decodePort(): ImageDecodePort {
  return Object.freeze({
    async decode(bytes, mime) {
      const header = validateRasterHeader(bytes, mime);
      if (!header) throw new Error('invalid raster');
      const limits = resolveImageResourceLimits();
      if (header.pixelWidth * header.pixelHeight > limits.maxPixels) throw new Error('too large');
      return Object.freeze({ ...header, dpiX: 96, dpiY: 96 });
    },
  });
}

/** Resource resolution and the relayout it triggers are both asynchronous. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}

function storyDrawingKinds(story: HeaderFooterStoryRecord | undefined): string[] {
  if (!story) return [];
  const kinds = (story.anchoredDrawings ?? []).map((drawing) => drawing.resource.kind);
  for (const fragment of story.fragments) {
    if (fragment.kind === 'table') continue;
    for (const line of fragment.lines) {
      for (const drawing of line.drawings ?? []) kinds.push(drawing.resource.kind);
    }
  }
  return kinds;
}

async function mount(bytes: Uint8Array): Promise<{
  surface: PaginatedSurface;
  container: HTMLElement;
}> {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, {
    scale: 1,
    imageDecodePort: decodePort(),
  });
  if (!opened.ok) throw new Error(opened.reason);
  await settle();
  return { surface: opened.surface, container };
}

describe('header/footer picture resources reach the page', () => {
  test('an anchored header picture stops being pending once it decodes', async () => {
    const { surface, container } = await mount(
      docx({ headerBody: anchoredDrawing(), footerBody: '<w:r><w:t>f</w:t></w:r>' })
    );
    const page = surface.layout().pages[0]!;
    expect(storyDrawingKinds(page.header)).toEqual(['ready']);
    // And the painter shows the picture rather than the loading placeholder.
    expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(0);
    expect(container.querySelectorAll('.docx-drawing-ready').length).toBeGreaterThan(0);
    surface.destroy();
    container.remove();
  });

  test('an inline footer picture does too', async () => {
    const { surface, container } = await mount(
      docx({ headerBody: '<w:r><w:t>h</w:t></w:r>', footerBody: inlineDrawing() })
    );
    const page = surface.layout().pages[0]!;
    expect(storyDrawingKinds(page.footer)).toEqual(['ready']);
    expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(0);
    surface.destroy();
    container.remove();
  });

  test('every page carries the resolved picture, not just the first', async () => {
    const { surface, container } = await mount(
      docx({ headerBody: anchoredDrawing(), footerBody: inlineDrawing() })
    );
    for (const page of surface.layout().pages) {
      expect(storyDrawingKinds(page.header)).toEqual(['ready']);
      expect(storyDrawingKinds(page.footer)).toEqual(['ready']);
    }
    surface.destroy();
    container.remove();
  });
});
