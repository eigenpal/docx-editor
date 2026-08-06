// A picture in a footnote or a text box has to reach the page like a body picture does.
//
// Both are stories laid out OUTSIDE the body flow, and both were dropping their drawings
// entirely: a note story was flowed with no drawing context at all, so a footnote picture
// contributed no record and painted nothing; a text-box story's inner picture was never even
// projected, so there was nothing to resolve. On top of that, resource resolution is
// asynchronous — the first pass publishes `pending` and a later pass must pick the ready one
// up, which only happens if the key that governs reuse carries the resource identity.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { validateRasterHeader, type ImageDecodePort } from '../../store/package/image-resources.ts';
import { resolveImageResourceLimits } from '../../store/runtime/limits.ts';
import type { BlockFragmentRecord, PageRecord } from '../../layout/semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const FOOTNOTES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

const NS = `xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}" xmlns:wps="${WPS}"`;

function picture(id: number): string {
  return (
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="pic"/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rIdImg"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic>'
  );
}

function inlinePicture(id: number): string {
  return (
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="457200" cy="457200"/><wp:docPr id="${id}" name="pic"/>` +
    `${picture(id)}</wp:inline></w:drawing></w:r>`
  );
}

/** An anchored text box whose story holds one inline picture. */
function textboxWithPicture(): string {
  return (
    '<w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" ' +
    'layoutInCell="1" allowOverlap="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="2743200" cy="1828800"/><wp:wrapNone/><wp:docPr id="10" name="box"/>' +
    `<a:graphic><a:graphicData uri="${WPS}">` +
    '<wps:wsp><wps:cNvSpPr txBox="1"/>' +
    '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="1828800"/></a:xfrm>' +
    '<a:prstGeom prst="rect"/></wps:spPr>' +
    '<wps:txbx><w:txbxContent>' +
    `<w:p><w:r><w:t>in the box</w:t></w:r>${inlinePicture(11)}</w:p>` +
    '</w:txbxContent></wps:txbx>' +
    '<wps:bodyPr/></wps:wsp>' +
    '</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

function docx(options: { readonly bodyRuns: string; readonly footnoteRuns: string }): Uint8Array {
  const imageRels = strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rIdImg" Type="${IMG}" Target="media/image1.png"/></Relationships>`
  );
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document ${NS}><w:body>` +
        `<w:p><w:r><w:t>body</w:t></w:r>${options.bodyRuns}</w:p>` +
        '<w:sectPr>' +
        '<w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdFn" Type="${FOOTNOTES}" Target="footnotes.xml"/>` +
        `<Relationship Id="rIdImg" Type="${IMG}" Target="media/image1.png"/>` +
        '</Relationships>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes ${NS}>` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>note </w:t></w:r>${options.footnoteRuns}</w:p></w:footnote>` +
        '</w:footnotes>'
    ),
    'word/_rels/footnotes.xml.rels': imageRels,
    'word/media/image1.png': PNG_1X1,
  });
}

const FOOTNOTE_REFERENCE = '<w:r><w:footnoteReference w:id="1"/></w:r>';

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

function blockDrawingKinds(blocks: readonly BlockFragmentRecord[]): string[] {
  const kinds: string[] = [];
  const visit = (block: BlockFragmentRecord): void => {
    if (block.kind === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) for (const inner of cell.blocks) visit(inner);
      }
      return;
    }
    for (const line of block.lines) {
      for (const drawing of line.drawings ?? []) kinds.push(drawing.resource.kind);
    }
  };
  for (const block of blocks) visit(block);
  return kinds;
}

function footnoteDrawingKinds(page: PageRecord): string[] {
  const kinds: string[] = [];
  for (const note of page.footnotes?.notes ?? []) {
    kinds.push(...blockDrawingKinds(note.fragments));
  }
  return kinds;
}

function textboxDrawingKinds(page: PageRecord): string[] {
  const kinds: string[] = [];
  for (const drawing of page.anchoredDrawings ?? []) {
    const story = drawing.textboxStory;
    if (!story) continue;
    kinds.push(...blockDrawingKinds(story.fragments));
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

describe('pictures in stories outside the body flow', () => {
  test('a footnote picture lays out and resolves', async () => {
    const { surface, container } = await mount(
      docx({ bodyRuns: FOOTNOTE_REFERENCE, footnoteRuns: inlinePicture(2) })
    );
    const page = surface.layout().pages[0]!;
    expect(footnoteDrawingKinds(page)).toEqual(['ready']);
    expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(0);
    surface.destroy();
    container.remove();
  });

  test('a picture inside a text box lays out and resolves', async () => {
    const { surface, container } = await mount(
      docx({ bodyRuns: textboxWithPicture(), footnoteRuns: '<w:r><w:t>plain</w:t></w:r>' })
    );
    const page = surface.layout().pages[0]!;
    expect(textboxDrawingKinds(page)).toEqual(['ready']);
    surface.destroy();
    container.remove();
  });
});
