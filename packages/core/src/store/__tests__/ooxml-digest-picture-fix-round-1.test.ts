// Whole-branch blocker 1 — typed picture semantic digest (strict TDD).

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  writeOoxmlPackage,
  readOoxmlPackage,
  type OoxmlPart,
} from '../index.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { zipSync, strToU8 } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function inlinePictureXml(options: {
  readonly srcRect?: string;
  readonly xfrm?: string;
  readonly blipEffects?: string;
  readonly prstGeom?: string;
  readonly fillMode?: 'stretch' | 'tile';
  readonly docPr?: string;
  readonly locks?: string;
}): string {
  const srcRect = options.srcRect ?? '<a:srcRect/>';
  const xfrm =
    options.xfrm ??
    '<a:xfrm rot="0" flipH="0" flipV="0"><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>';
  const blipEffects = options.blipEffects ?? '';
  const prstGeom = options.prstGeom ?? '<a:prstGeom prst="rect"/>';
  const fill =
    options.fillMode === 'tile'
      ? '<a:tile tx="0" ty="0" sx="100000" sy="100000" flip="none" algn="tl"/>'
      : '<a:stretch><a:fillRect/></a:stretch>';
  const docPr = options.docPr ?? '<wp:docPr id="1" name="pic" descr="desc" title="title"/>';
  const locks = options.locks ?? '';
  return (
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p><w:r><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    '<wp:extent cx="914400" cy="914400"/>' +
    docPr +
    locks +
    `<a:graphic><a:graphicData uri="${PIC_URI}">` +
    '<pic:pic>' +
    `<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rIdImage">${blipEffects}</a:blip>${srcRect}${fill}</pic:blipFill>` +
    `<pic:spPr>${xfrm}${prstGeom}</pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

function parse(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, metadata);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function packageFromPart(part: OoxmlPart) {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="png" ContentType="image/png"/>' +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(serializeOoxmlPart(part)),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdImage" Type="${R}/image" Target="media/image1.png"/></Relationships>`
    ),
    'word/media/image1.png': Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]),
  });
}

describe('picture semantic digest — typed semantic properties', () => {
  test('srcRect crop 1000 vs 9000 permille differs', () => {
    const crop1000 = parse(
      inlinePictureXml({ srcRect: '<a:srcRect l="1000" t="0" r="0" b="0"/>' })
    );
    const crop9000 = parse(
      inlinePictureXml({ srcRect: '<a:srcRect l="9000" t="0" r="0" b="0"/>' })
    );
    expect(diffSemanticDigests(semanticDigest([crop1000]), semanticDigest([crop9000]))).not.toEqual(
      []
    );
  });

  test('xfrm rotation and flip differences are reported', () => {
    const base = parse(inlinePictureXml({}));
    const rotated = parse(
      inlinePictureXml({
        xfrm: '<a:xfrm rot="4500000" flipH="1" flipV="1"><a:off x="100" y="200"/><a:ext cx="914400" cy="914400"/></a:xfrm>',
      })
    );
    expect(diffSemanticDigests(semanticDigest([base]), semanticDigest([rotated]))).not.toEqual([]);
  });

  test('blip lum/grayscale effects differ', () => {
    const plain = parse(inlinePictureXml({}));
    const effected = parse(
      inlinePictureXml({
        blipEffects: '<a:lum bright="20000" contrast="10000"/><a:grayscl val="1"/>',
      })
    );
    expect(diffSemanticDigests(semanticDigest([plain]), semanticDigest([effected]))).not.toEqual(
      []
    );
  });

  test('preset geometry and fill mode differ', () => {
    const rectStretch = parse(inlinePictureXml({}));
    const ellipseTile = parse(
      inlinePictureXml({
        prstGeom: '<a:prstGeom prst="ellipse"/>',
        fillMode: 'tile',
      })
    );
    expect(
      diffSemanticDigests(semanticDigest([rectStretch]), semanticDigest([ellipseTile]))
    ).not.toEqual([]);
  });

  test('docPr metadata and graphic frame locks differ', () => {
    const base = parse(inlinePictureXml({}));
    const locked = parse(
      inlinePictureXml({
        docPr: '<wp:docPr id="2" name="other" descr="other-desc" title="other-title"/>',
        locks: `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A}" noChangeAspect="1"/></wp:cNvGraphicFramePr>`,
      })
    );
    expect(diffSemanticDigests(semanticDigest([base]), semanticDigest([locked]))).not.toEqual([]);
  });

  test('unchanged save/reopen digest is equal', () => {
    const part = parse(
      inlinePictureXml({
        srcRect: '<a:srcRect l="25000" t="10000" r="15000" b="5000"/>',
        xfrm: '<a:xfrm rot="900000" flipH="1" flipV="0"><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>',
        blipEffects: '<a:lum bright="12000" contrast="8000"/>',
      })
    );
    const opened = readOoxmlPackage(packageFromPart(part));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const saved = writeOoxmlPackage(opened.package);
    const reopened = readOoxmlPackage(saved);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(
      diffSemanticDigests(
        semanticDigest([part]),
        semanticDigest([reopened.package.parts.get('/word/document.xml')!])
      )
    ).toEqual([]);
  });
});
