import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  validateOoxmlPart,
  type OoxmlDrawingNode,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { IMAGE_WRAP_TARGETS, type ImageWrapTarget } from '../package/drawing-projection.ts';
import { applyTreeOp, validateTreeOp, type TreeDocOp } from '../store/tree-ops.ts';
import { segmentsOf } from '../store/tree-op-segments.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parse(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, metadata);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  expect(validateOoxmlPart(result.part).ok).toBe(true);
  return result.part;
}

function refuse(part: OoxmlPart, op: TreeDocOp): string {
  const validation = validateTreeOp(part, op);
  if (validation) return validation;
  const result = applyTreeOp(part, op);
  if (result.ok) throw new Error('expected rejection');
  return result.reason;
}

function drawingTemplate(): OoxmlDrawingNode {
  const part = parse(
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      '<w:body><w:p><w:r><w:drawing>' +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="914400" cy="457200"/>' +
      '<wp:docPr id="1" name="pic"/>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}">` +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic>' +
      '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
  );
  return findDrawing(part.root)!;
}

function findDrawing(node: OoxmlNode): OoxmlDrawingNode | null {
  if (node.kind === 'drawing') return node;
  if (node.kind === 'textValue') return null;
  for (const child of node.children) {
    const found = findDrawing(child);
    if (found) return found;
  }
  return null;
}

function paragraphOf(part: OoxmlPart): OoxmlElement {
  const body = part.root.children[0] as OoxmlElement;
  return body.children.find((c) => c.kind === 'paragraph') as OoxmlElement;
}

function anchoredWithWrap(wrapXml: string, extent = 'cx="914400" cy="457200"'): string {
  return (
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" relativeHeight="251658240" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    `<wp:extent ${extent}/>` +
    wrapXml +
    '<wp:docPr id="2" name="float"/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:ext ${extent.replace('cx', 'cx').replace('cy', 'cy')}/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

function wrapChild(anchor: OoxmlElement): OoxmlElement | undefined {
  return anchor.children.find(
    (c) =>
      c.kind !== 'textValue' &&
      (String(c.kind).startsWith('drawingWrap') ||
        (c.namespaceUri === WP && String(c.localName).startsWith('wrap')))
  ) as OoxmlElement | undefined;
}

describe('task 11 fix round 1 — insertDrawing at UTF-16 offset', () => {
  test('splits text and preserves run properties at an interior offset', () => {
    const host = parse(
      `<w:document xmlns:w="${W}"><w:body><w:p>` +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r>' +
        '</w:p></w:body></w:document>'
    );
    const paragraph = paragraphOf(host);
    const drawing = drawingTemplate();
    const next = apply(host, {
      op: 'insertDrawing',
      paragraphId: paragraph.id,
      offset: 2,
      drawing,
    });
    const segs = segmentsOf(paragraphOf(next) as never);
    expect(segs.map((s) => [s.start, s.end])).toEqual([
      [0, 2],
      [2, 3],
      [3, 6],
    ]);
    expect(segs[0]!.end - segs[0]!.start).toBe(2);
    expect(segs[1]!.node.kind).toBe('drawing');
    const run = paragraphOf(next).children.find((c) => c.kind === 'run') as OoxmlElement;
    expect(
      run.children.some(
        (c) => c.kind === 'runProperties' || (c.kind === 'generic' && c.localName === 'rPr')
      )
    ).toBe(true);
  });

  test('refuses surrogate-pair interior offsets', () => {
    const host = parse(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>\uD83D\uDE00!</w:t></w:r></w:p></w:body></w:document>`
    );
    const paragraph = paragraphOf(host);
    expect(
      refuse(host, {
        op: 'insertDrawing',
        paragraphId: paragraph.id,
        offset: 1,
        drawing: drawingTemplate(),
      })
    ).toBe('splits-surrogate-pair');
  });

  test('refuses atomic segment interior offsets', () => {
    const host = parse(
      `<w:document xmlns:w="${W}"><w:body><w:p>` +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText>PAGE</w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>1</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '</w:p></w:body></w:document>'
    );
    const paragraph = paragraphOf(host);
    expect(
      refuse(host, {
        op: 'insertDrawing',
        paragraphId: paragraph.id,
        offset: 0,
        drawing: drawingTemplate(),
      })
    ).toBe('invalid-range');
  });
});

describe('task 11 fix round 1 — wrap conversions', () => {
  test.each(IMAGE_WRAP_TARGETS)('%s produces schema-valid wrap output', (target) => {
    const inlinePart = parse(
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
        '<wp:inline distT="5" distB="6" distL="7" distR="8"><wp:extent cx="914400" cy="457200"/>' +
        '<wp:docPr id="1" name="inline" descr="keep"/>' +
        `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
    );
    const anchoredPart = parse(
      anchoredWithWrap(
        '<wp:wrapSquare wrapText="bothSides" distT="1" distB="2" distL="3" distR="4"/>'
      )
    );
    const sourcePart = target === 'inline' ? inlinePart : anchoredPart;
    const sourceDrawing = findDrawing(sourcePart.root)!;
    const beforeDocPrFp = canonicalOoxmlFingerprint(
      (sourceDrawing.children[0] as OoxmlElement).children.find(
        (c) => c.kind === 'drawingDocPr' || c.localName === 'docPr'
      )! as OoxmlElement
    );
    const next =
      target === 'inline'
        ? sourcePart
        : apply(sourcePart, {
            op: 'setDrawingWrap',
            drawingNodeId: sourceDrawing.id,
            wrap: target,
          });
    expect(validateOoxmlPart(next).ok).toBe(true);
    const anchor = findDrawing(next.root)!.children[0] as OoxmlElement;
    if (target === 'inline') {
      expect(anchor.kind).toBe('inlineDrawing');
      expect(anchor.attributes.find((a) => a.localName === 'distL')?.value).toBe('7');
      return;
    }
    expect(anchor.kind).toBe('anchoredDrawing');
    const wrap = wrapChild(anchor)!;
    if (target === 'topAndBottom') {
      expect(wrap.localName).toBe('wrapTopAndBottom');
    }
    if (target === 'tight' || target === 'through') {
      expect(wrap.localName).toBe(target === 'tight' ? 'wrapTight' : 'wrapThrough');
      const polygon = wrap.children.find(
        (c) => c.kind === 'drawingWrapPolygon' || c.localName === 'wrapPolygon'
      ) as OoxmlElement;
      expect(polygon).toBeDefined();
      expect(polygon.children.some((c) => c.kind === 'drawingWrapPolygonStart')).toBe(true);
      const start = polygon.children.find(
        (c) => c.kind === 'drawingWrapPolygonStart'
      ) as OoxmlElement;
      const lineTo = polygon.children.filter(
        (c) => c.kind === 'drawingWrapPolygonLineTo'
      ) as OoxmlElement[];
      expect(
        lineTo.some((pt) => pt.attributes.find((a) => a.localName === 'x')?.value === '914400')
      ).toBe(true);
      expect(
        lineTo.some((pt) => pt.attributes.find((a) => a.localName === 'y')?.value === '457200')
      ).toBe(true);
    }
    if (target !== 'inline') {
      const docPr = anchor.children.find((c) => c.kind === 'drawingDocPr') as OoxmlElement;
      expect(canonicalOoxmlFingerprint(docPr)).toBe(beforeDocPrFp);
    }
  });
});

describe('task 11 fix round 1 — positionDrawing align XOR offset', () => {
  test('replaces align with posOffset on the horizontal axis', () => {
    const part = parse(anchoredWithWrap('<wp:wrapSquare wrapText="bothSides"/>'));
    const drawing = findDrawing(part.root)!;
    const next = apply(part, {
      op: 'positionDrawing',
      drawingNodeId: drawing.id,
      position: { horizontalEmu: 12345, relativeToH: 'column' },
    });
    const posH = (findDrawing(next.root)!.children[0] as OoxmlElement).children.find(
      (c) => c.kind === 'drawingPositionH'
    ) as OoxmlElement;
    expect(posH.children.some((c) => c.localName === 'align')).toBe(false);
    expect(posH.children.some((c) => c.localName === 'posOffset')).toBe(true);
  });
});

describe('task 11 fix round 1 — drawing locks', () => {
  test('honours OOXML false lexical values and partial lock updates', () => {
    const xml =
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
      '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="457200"/>' +
      '<wp:docPr id="1" name="pic"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noMove="0" noResize="false"/></wp:cNvGraphicFramePr>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
    const part = parse(xml);
    const drawing = findDrawing(part.root)!;
    expect(
      refuse(part, {
        op: 'positionDrawing',
        drawingNodeId: drawing.id,
        position: { verticalEmu: 1 },
      })
    ).not.toBe('drawing-locked');
    const locked = apply(part, {
      op: 'setDrawingLocks',
      drawingNodeId: drawing.id,
      locks: { resize: true },
    });
    const frameLocks = (
      (findDrawing(locked.root)!.children[0] as OoxmlElement).children.find(
        (c) => c.localName === 'cNvGraphicFramePr'
      ) as OoxmlElement
    ).children.find((c) => c.localName === 'graphicFrameLocks') as OoxmlElement;
    expect(frameLocks.attributes.find((a) => a.localName === 'noResize')?.value).toBe('1');
    expect(frameLocks.attributes.find((a) => a.localName === 'noMove')?.value).toBe('0');
    expect(
      refuse(locked, {
        op: 'resizeDrawing',
        drawingNodeId: drawing.id,
        extentEmu: { cx: 1, cy: 1 },
      })
    ).toBe('drawing-locked');
  });
});

describe('task 11 fix round 1 — drawing hyperlink metadata', () => {
  test('requires package transaction to add hyperlink target', () => {
    const part = parse(
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
        '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="457200"/>' +
        '<wp:docPr id="1" name="pic"/>' +
        `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
    );
    const drawing = findDrawing(part.root)!;
    expect(
      refuse(part, {
        op: 'setDrawingMetadata',
        drawingNodeId: drawing.id,
        title: '',
        description: '',
        hyperlink: 'https://example.com',
      })
    ).toBe('packageTransactionRequired');
  });

  test('preserves hlinkClick on title-only edits and removes on null hyperlink', () => {
    const withLink =
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
      '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="457200"/>' +
      '<wp:docPr id="1" name="pic"><a:hlinkClick r:id="rId99"/></wp:docPr>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
    const part = parse(withLink);
    const drawing = findDrawing(part.root)!;
    const titled = apply(part, {
      op: 'setDrawingMetadata',
      drawingNodeId: drawing.id,
      title: 'New title',
      description: 'New descr',
    });
    const docPrAfterTitle = (
      (findDrawing(titled.root)!.children[0] as OoxmlElement).children.find(
        (c) => c.kind === 'drawingDocPr'
      ) as OoxmlElement
    ).children.find((c) => c.localName === 'hlinkClick');
    expect(docPrAfterTitle).toBeDefined();
    const removed = apply(part, {
      op: 'setDrawingMetadata',
      drawingNodeId: drawing.id,
      title: 'New title',
      description: 'New descr',
      hyperlink: null,
    });
    const docPrRemoved = (findDrawing(removed.root)!.children[0] as OoxmlElement).children.find(
      (c) => c.kind === 'drawingDocPr'
    ) as OoxmlElement;
    expect(docPrRemoved.children.some((c) => c.localName === 'hlinkClick')).toBe(false);
  });
});

describe('task 11 fix round 1 — srcRect sequence and crop', () => {
  test('inserts srcRect before stretch and replaces in place', () => {
    const xml =
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
      '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="457200"/>' +
      '<wp:docPr id="1" name="pic"/>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>` +
      '<a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
    const part = parse(xml);
    const drawing = findDrawing(part.root)!;
    const inserted = apply(part, {
      op: 'cropDrawing',
      drawingNodeId: drawing.id,
      crop: { left: 1000, top: 2000, right: 3000, bottom: 4000 },
    });
    const blipFill = (findDrawing(inserted.root)!.children[0] as OoxmlElement).children
      .flatMap((c) => (c.kind === 'drawingGraphic' ? c.children : []))
      .flatMap((c) => (c.kind === 'drawingGraphicData' ? c.children : []))
      .flatMap((c) => (c.kind === 'picture' ? c.children : []))
      .find((c) => c.kind === 'pictureBlipFill') as OoxmlElement;
    const order = blipFill.children.map((c) => c.localName);
    expect(order.indexOf('srcRect')).toBeLessThan(order.indexOf('stretch'));
    const croppedAgain = apply(inserted, {
      op: 'cropDrawing',
      drawingNodeId: drawing.id,
      crop: { left: 5000, top: 6000, right: 7000, bottom: 8000 },
    });
    const srcRect = blipFillOf(croppedAgain).children.find(
      (c) => c.localName === 'srcRect'
    ) as OoxmlElement;
    expect(srcRect.attributes.find((a) => a.localName === 'l')?.value).toBe('5000');
    expect(validateOoxmlPart(croppedAgain).ok).toBe(true);
  });
});

function blipFillOf(part: OoxmlPart): OoxmlElement {
  const drawing = findDrawing(part.root)!;
  const anchor = drawing.children[0] as OoxmlElement;
  const graphic = anchor.children.find((c) => c.kind === 'drawingGraphic') as OoxmlElement;
  const data = graphic.children.find((c) => c.kind === 'drawingGraphicData') as OoxmlElement;
  const picture = data.children.find((c) => c.kind === 'picture') as OoxmlElement;
  return picture.children.find((c) => c.kind === 'pictureBlipFill') as OoxmlElement;
}

describe('task 11 fix round 1 — mutation effects name owning paragraph', () => {
  test('geometry and delete ops dirty the owning paragraph id', () => {
    const part = parse(
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
        '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="457200"/>' +
        '<wp:docPr id="1" name="pic"/>' +
        `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
    );
    const drawing = findDrawing(part.root)!;
    const paragraphId = paragraphOf(part).id;
    const resize = applyTreeOp(part, {
      op: 'resizeDrawing',
      drawingNodeId: drawing.id,
      extentEmu: { cx: 100, cy: 100 },
    });
    expect(resize.ok && resize.effect.dirty.includes(paragraphId)).toBe(true);
    const del = applyTreeOp(part, { op: 'deleteDrawing', drawingNodeId: drawing.id });
    expect(del.ok && del.effect.dirty.includes(paragraphId)).toBe(true);
  });
});
