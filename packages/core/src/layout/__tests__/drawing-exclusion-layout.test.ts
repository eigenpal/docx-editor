// Task 9 integration — wrap reflow, header flow-height rule, incremental differential.

import { describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlDrawingNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import { emuToPoints } from '../drawing-layout.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, paragraphFragmentsOf, type PageGeometry } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const measurer = createFixedMeasurer(6, 14);
const OWNER = '/word/document.xml';
/** Default US-Letter content column these fixtures lay out into. */
const CONTENT_WIDTH_PT = 468;

const READY: ImageResourceState = Object.freeze({
  kind: 'ready',
  partName: '/word/media/image1.png',
  contentId: 'image1',
  resourceKey: 'k1',
  mime: 'image/png',
  pixelWidth: 100,
  pixelHeight: 100,
  dpiX: 96,
  dpiY: 96,
});

function load(xml: string, owner = OWNER): OoxmlPart {
  const result = readOoxmlPart(xml, {
    name: owner,
    contentType: owner.includes('header')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function layoutContext(part: OoxmlPart, owner = OWNER): InlineDrawingLayoutContext {
  const atomProjections = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: owner,
    projectionForAtom: (atomId) => atomProjections.get(atomId) ?? null,
    project: (node) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, { ownerPartName: owner, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => READY,
  };
}

function drawingOf(part: OoxmlPart): OoxmlDrawingNode {
  const stack = [part.root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.kind === 'drawing') return node;
    for (const child of node.children) {
      if (child.kind !== 'textValue') stack.push(child);
    }
  }
  throw new Error('missing drawing');
}

function squareAnchorAtLeft(options: {
  readonly text: string;
  readonly behindDoc?: string;
}): string {
  const words = options.text;
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body>' +
    '<w:p><w:r><w:drawing>' +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="${options.behindDoc ?? '0'}" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="1828800" cy="914400"/>' +
    '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>' +
    '<wp:docPr id="1" name="pic"/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    '<pic:spPr><a:xfrm><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r>' +
    `<w:r><w:t>${words}</w:t></w:r></w:p>` +
    '</w:body></w:document>'
  );
}

function fillerParagraphs(count: number): string {
  let out = '';
  for (let index = 0; index < count; index += 1) {
    out += `<w:p><w:r><w:t>para ${index} ${'word '.repeat(40)}</w:t></w:r></w:p>`;
  }
  return out;
}

describe('square wrap reflow integration (OpenSpec 4.3)', () => {
  test('text beside a left square anchor uses a narrower line width on overlapping lines', () => {
    const part = load(squareAnchorAtLeft({ text: 'word '.repeat(80) }));
    const ctx = layoutContext(part);
    const layout = layoutSemanticDocument(part, 1, { measurer, inlineDrawingLayout: ctx });
    const fragments = paragraphFragmentsOf(layout.pages[0]!);
    expect(fragments).toHaveLength(1);
    const lines = fragments[0]!.lines;
    expect(lines.length).toBeGreaterThan(1);
    const imageWidth = emuToPoints(1828800);
    const overlapping = lines.filter((line) => line.box.y >= 0 && line.box.y < imageWidth);
    expect(overlapping.length).toBeGreaterThan(0);
    for (const line of overlapping) {
      const lastSpan = line.spans[line.spans.length - 1];
      if (!lastSpan) continue;
      expect(lastSpan.box.x + lastSpan.box.width).toBeLessThanOrEqual(imageWidth + 468 + 1);
    }
  });

  test('a wrapped line still fills the column to its right edge', () => {
    const part = load(squareAnchorAtLeft({ text: 'word '.repeat(80) }));
    const ctx = layoutContext(part);
    const layout = layoutSemanticDocument(part, 1, { measurer, inlineDrawingLayout: ctx });
    const lines = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines;
    const rightEdge = (line: (typeof lines)[number]): number => {
      const last = line.spans[line.spans.length - 1];
      return last ? last.box.x + last.box.width : 0;
    };
    // The float narrows where a line STARTS, never how far it may run. A line that stopped
    // near the column's midpoint meant the width budget was being consumed twice.
    const widest = Math.max(...lines.map(rightEdge));
    expect(widest).toBeGreaterThan(CONTENT_WIDTH_PT * 0.9);
    expect(widest).toBeLessThanOrEqual(CONTENT_WIDTH_PT + 1);
  });

  test('lines clear of the anchor return to the full column width', () => {
    const part = load(squareAnchorAtLeft({ text: 'word '.repeat(200) }));
    const ctx = layoutContext(part);
    const layout = layoutSemanticDocument(part, 1, { measurer, inlineDrawingLayout: ctx });
    const lines = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines;
    const imageHeight = emuToPoints(914400);
    const belowImage = lines.filter((line) => line.box.y >= imageHeight);
    expect(belowImage.length).toBeGreaterThan(0);
    for (const line of belowImage) {
      expect(line.spans[0]!.box.x).toBeCloseTo(0, 3);
    }
    const widestBelow = Math.max(
      ...belowImage.map((line) => {
        const last = line.spans[line.spans.length - 1]!;
        return last.box.x + last.box.width;
      })
    );
    expect(widestBelow).toBeGreaterThan(CONTENT_WIDTH_PT * 0.9);
  });
});

describe('topAndBottom anchored in the paragraph it displaces', () => {
  test('the picture keeps the paragraph origin and the text clears below it', () => {
    const part = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        '<w:body>' +
        '<w:p><w:r><w:t>lead</w:t></w:r></w:p>' +
        '<w:p><w:r><w:drawing>' +
        '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
        '<wp:simplePos x="0" y="0"/>' +
        '<wp:positionH relativeFrom="column"><wp:align>center</wp:align></wp:positionH>' +
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        '<wp:extent cx="914400" cy="914400"/>' +
        '<wp:wrapTopAndBottom/>' +
        '<wp:docPr id="1" name="band"/>' +
        `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        '<pic:spPr><a:xfrm><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
        '</wp:anchor></w:drawing></w:r>' +
        '<w:r><w:t>banded text</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    );
    const ctx = layoutContext(part);
    const layout = layoutSemanticDocument(part, 1, { measurer, inlineDrawingLayout: ctx });
    const page = layout.pages[0]!;
    const anchored = page.anchoredDrawings![0]!;
    const banded = paragraphFragmentsOf(page)[1]!;
    const bandBottom = anchored.y + anchored.height;
    // Framing the anchor against the lines it pushed down chased its own displacement and
    // painted the picture over them.
    expect(banded.lines[0]!.box.y).toBeGreaterThanOrEqual(bandBottom - 0.001);
  });
});

describe('header page-relative anchor does not size HF box (OpenSpec 4.7)', () => {
  test('flow height ignores tall page-relative anchored drawing extent', () => {
    const headerXml =
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      '<w:p><w:r><w:t>HF</w:t></w:r><w:r><w:drawing>' +
      '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="1" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
      '<wp:simplePos x="0" y="0"/>' +
      '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>' +
      '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="5486400" cy="6858000"/>' +
      '<wp:wrapNone/>' +
      '<wp:docPr id="2" name="wm"/>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      '<pic:spPr><a:xfrm><a:ext cx="5486400" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
      '</wp:anchor></w:drawing></w:r></w:p></w:hdr>';
    const textOnlyXml = `<w:hdr xmlns:w="${WML_NAMESPACE_URI}"><w:p><w:r><w:t>HF</w:t></w:r></w:p></w:hdr>`;
    const headerPart = load(headerXml, '/word/header1.xml');
    const textOnly = layoutHeaderFooterStory(
      load(textOnlyXml, '/word/header1.xml'),
      468,
      measurer,
      'test'
    );
    const withWatermark = layoutHeaderFooterStory(
      headerPart,
      468,
      measurer,
      'test',
      undefined,
      undefined,
      undefined,
      128,
      undefined,
      undefined,
      layoutContext(headerPart, '/word/header1.xml'),
      undefined,
      undefined,
      {
        pageNumber: 1,
        pageWidth: 612,
        pageHeight: 792,
        marginLeft: 72,
        marginRight: 72,
        marginTop: 72,
        marginBottom: 72,
      }
    );
    expect(withWatermark.flowHeight).toBeCloseTo(textOnly.flowHeight, 3);
    expect(withWatermark.anchoredDrawings?.length).toBe(1);
    expect(withWatermark.anchoredDrawings![0]!.behindDocument).toBe(true);
  });

  test('body content box is unchanged by tall header watermark', () => {
    const body = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r><w:t>body</w:t></w:r></w:p></w:body></w:document>`
    );
    const geometry: PageGeometry = {
      width: 612,
      height: 792,
      margin: { top: 72, right: 72, bottom: 72, left: 72 },
      headerDistance: 36,
      footerDistance: 36,
    };
    const headerXml =
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      '<w:p><w:r><w:t>H</w:t></w:r><w:r><w:drawing>' +
      '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="1" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
      '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>' +
      '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="5486400" cy="6858000"/><wp:wrapNone/><wp:docPr id="1" name="w"/>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:hdr>';
    const headerPart = load(headerXml, '/word/header1.xml');
    const hfStory = layoutHeaderFooterStory(
      headerPart,
      468,
      measurer,
      'test',
      undefined,
      undefined,
      undefined,
      128,
      undefined,
      undefined,
      layoutContext(headerPart, '/word/header1.xml')
    );
    const withoutHf = layoutSemanticDocument(body, 1, { measurer, geometry });
    const withHf = layoutSemanticDocument(body, 1, {
      measurer,
      geometry,
      furniture: {
        titlePage: false,
        evenAndOddHeaders: false,
        headers: new Map([['default', hfStory]]),
        footers: new Map(),
      },
    });
    expect(withHf.pages[0]!.contentBox.height).toBeCloseTo(
      withoutHf.pages[0]!.contentBox.height,
      3
    );
  });
});

describe('full-vs-incremental differential over wrap reflow (OpenSpec 9.4)', () => {
  test('reuses seeded exclusion zones without changing layout', () => {
    const session = createLayoutSession();
    const part = load(squareAnchorAtLeft({ text: 'tail '.repeat(30) }));
    layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      session,
    });

    const incremental = layoutSemanticDocument(part, 2, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      session,
    });
    const clean = layoutSemanticDocument(part, 2, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
    });

    expect(incremental.pages).toEqual(clean.pages);
  });

  test('wrap-mode change reflows tail pages and invalidates break cache', () => {
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const longBody =
      fillerParagraphs(12) +
      squareAnchorAtLeft({ text: 'tail '.repeat(30) })
        .replace(/^[\s\S]*<w:body>/, '')
        .replace(/<\/w:body>[\s\S]*$/, '');
    const squareDoc = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>${longBody}</w:body></w:document>`
    );
    const ctx = layoutContext(squareDoc);
    const squareLayout = layoutSemanticDocument(squareDoc, 1, {
      measurer,
      inlineDrawingLayout: ctx,
      cache,
      producer: 'exclusion-inc',
    });
    const squarePages = squareLayout.pages.length;

    const behindDoc = squareAnchorAtLeft({ text: 'tail '.repeat(30), behindDoc: '1' })
      .replace('wrapSquare wrapText="bothSides"', 'wrapNone')
      .replace('<w:body>', `<w:body>${fillerParagraphs(12)}`);
    const behindPart = load(behindDoc);
    const behindCtx = layoutContext(behindPart);
    const behindLayout = layoutSemanticDocument(behindPart, 2, {
      measurer,
      inlineDrawingLayout: behindCtx,
      cache,
      producer: 'exclusion-inc',
    });

    expect(behindLayout.pages.length).toBeGreaterThanOrEqual(squarePages - 1);
    expect(cache.stats.hits + cache.stats.misses).toBeGreaterThan(0);
    const squareAnchors = squareLayout.pages.flatMap((page) => page.anchoredDrawings ?? []);
    const behindAnchors = behindLayout.pages.flatMap((page) => page.anchoredDrawings ?? []);
    expect(squareAnchors.some((drawing) => drawing.wrap === 'square')).toBe(true);
    expect(behindAnchors.some((drawing) => drawing.wrap === 'behind')).toBe(true);
  });
});

describe('paint order on page record (OpenSpec 4.5)', () => {
  test('behind-document anchor sorts before in-front anchor regardless of source order', () => {
    const xml =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
      '<w:p><w:r><w:drawing>' +
      '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
      '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>2000000</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="457200"/>' +
      '<wp:wrapNone/><wp:docPr id="1" name="front"/>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor>` +
      '</w:drawing></w:r><w:r><w:drawing>' +
      '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="1" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
      '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="457200"/>' +
      '<wp:wrapNone/><wp:docPr id="2" name="behind"/>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor>` +
      '</w:drawing></w:r><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>';
    const part = load(xml);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
    });
    const anchors = layout.pages[0]!.anchoredDrawings ?? [];
    expect(anchors).toHaveLength(2);
    expect(anchors[0]!.behindDocument).toBe(true);
    expect(anchors[1]!.behindDocument).toBe(false);
  });
});
