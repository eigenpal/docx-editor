import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { createInlineDrawingLayoutBundle } from '../inline-drawing-source.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-records.ts';
import { tablePageRestartTestRecorder } from '../table-page-restart.ts';

// A picture in a long table decodes after the first layout. The decode moves the drawing
// epoch, so the table is the first changed block of the next pass, while its rows read as
// before: the structure rows do not hold the picture's resource. That pass must not keep
// the table's earlier pages, or the picture on them stays pending.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  ),
  (char) => char.charCodeAt(0)
);

const PICTURE =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="457200" cy="457200"/><wp:docPr id="1" name="Picture 1"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rPicture"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
  '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
const cell = (content: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${content}</w:p></w:tc>`;
const text = (value: string) => `<w:r><w:t>${value}</w:t></w:r>`;
const ROWS = Array.from(
  { length: 120 },
  (_, r) => `<w:tr>${cell(r === 1 ? PICTURE : text(`R${r}a`))}${cell(text(`R${r}b`))}</w:tr>`
).join('');
const BORDERS = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map((edge) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
  .join('');
const DOCUMENT =
  `<w:document xmlns:w="${W}" xmlns:r="${R}" ` +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' +
  `<w:p>${text('Before')}</w:p>` +
  '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
  `<w:tblBorders>${BORDERS}</w:tblBorders></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${ROWS}</w:tbl>` +
  `<w:p>${text('After')}</w:p>` +
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" ' +
  'w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
  '</w:body></w:document>';

function open() {
  const loaded = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="png" ContentType="image/png"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rPicture" Type="${R}/image" Target="media/image1.png"/></Relationships>`
      ),
      'word/media/image1.png': PNG_1X1,
      'word/document.xml': strToU8(DOCUMENT),
    })
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  const pkg = loaded.package;
  const reader = {
    currentPackage: () => pkg,
    packageRevision: () => 0,
    part: () => pkg.parts.get(pkg.mainDocumentPart)!,
  };
  const bundle = createInlineDrawingLayoutBundle({
    session: reader,
    decodePort: {
      async decode() {
        return { pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 };
      },
    },
    onResourcesChanged: () => {},
  });
  const part = reader.part();
  /** One layout pass; `retained` carries the session and cache an editor keeps. */
  const lay = (retained?: {
    session: ReturnType<typeof createLayoutSession>;
    cache: ReturnType<typeof createParagraphLayoutCache>;
  }): SemanticLayout =>
    layoutSemanticDocument(part, 0, {
      measurer: createFixedMeasurer(6, 14),
      inlineDrawingLayout: bundle.bodyContext,
      drawingTokenForParagraph: (paragraph) =>
        bundle.drawingTokenForParagraph(paragraph, part.name),
      drawingLayoutEpoch: bundle.cacheTokenForPart(part.name),
      ...retained,
    });
  return { bundle, lay };
}

function pictureResources(layout: SemanticLayout): string[] {
  const kinds: string[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(visit);
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.drawings))
      for (const drawing of record.drawings as { resource: { kind: string } }[])
        kinds.push(drawing.resource.kind);
    for (const [key, child] of Object.entries(record)) if (key !== 'drawings') visit(child);
  };
  visit(layout.pages);
  return kinds;
}

test('a picture that decodes after the first pass shows ready on the kept table pages', async () => {
  const { bundle, lay } = open();
  try {
    const retained = { session: createLayoutSession(), cache: createParagraphLayoutCache() };
    const first = lay(retained);
    expect(first.pages.length).toBeGreaterThan(2);
    expect(pictureResources(first)).toEqual(['pending']);
    for (let turn = 0; turn < 50 && bundle.pendingResourceCount() > 0; turn += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bundle.pendingResourceCount()).toBe(0);

    const restarts = tablePageRestartTestRecorder();
    const next = lay(retained);
    restarts.dispose();
    expect(pictureResources(next)).toEqual(['ready']);
    expect(JSON.stringify(next.pages)).toBe(JSON.stringify(lay().pages));
    // The resource change paginates the table whole: no page is kept.
    expect(restarts.restarts).toBe(0);
  } finally {
    bundle.dispose();
  }
});
