// Task 9 integration — wrap reflow, header flow-height rule, incremental differential.

import { describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlNode,
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
import {
  collectExclusionZonesByPage,
  observeExclusionZoneCollectionsForTest,
} from '../drawing-exclusion.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { drawingAtomIdentities, drawingSourceOrderInPart } from '../inline-drawing-source.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  observeExclusionLayoutPassesForTest,
} from '../semantic-layout.ts';
import {
  paragraphFragmentsOf,
  paragraphFragmentsOfBlocks,
  type LayoutBox,
  type LineRecord,
  type PageGeometry,
} from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

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

/** Transaction-shaped insertion: keeps the anchor paragraph/node ids used by exclusion order. */
function withLeadingParagraph(part: OoxmlPart, paragraph: OoxmlNode): OoxmlPart {
  const visit = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (node.localName === 'body') return { ...node, children: [paragraph, ...node.children] };
    return {
      ...node,
      children: node.children.map(visit),
    };
  };
  return { ...part, root: visit(part.root) as OoxmlPart['root'] };
}

function firstParagraph(part: OoxmlPart): OoxmlNode {
  const queue: OoxmlNode[] = [part.root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.kind === 'paragraph') return node;
    if (node.kind !== 'textValue') queue.push(...node.children);
  }
  throw new Error('missing paragraph');
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

function fixedCollisionAnchorParagraph(name: string, docPrId: number, mcWrapped = false): string {
  const drawing =
    '<w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="0" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>1000000</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>2000000</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="914400"/>' +
    '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>' +
    `<wp:docPr id="${docPrId}" name="${name}"/>` +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    '<pic:spPr><a:xfrm><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing>';
  const atom = mcWrapped
    ? `<mc:AlternateContent><mc:Choice Requires="wps">${drawing}</mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent>`
    : drawing;
  return `<w:p><w:r>${atom}</w:r><w:r><w:t>x</w:t></w:r></w:p>`;
}

function withDrawingNodeIds(part: OoxmlPart, ids: readonly string[]): OoxmlPart {
  let drawingIndex = 0;
  const visit = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    let changed = false;
    const children = node.children.map((child) => {
      const next = visit(child);
      if (next !== child) changed = true;
      return next;
    });
    if (node.localName === 'drawing' && node.namespaceUri === WML_NAMESPACE_URI) {
      const id = ids[drawingIndex++] ?? node.id;
      return { ...node, id, ...(changed ? { children } : {}) };
    }
    return changed ? { ...node, children } : node;
  };
  return { ...part, root: visit(part.root) as OoxmlPart['root'] };
}

/** Copy-on-write reorder: only the document/body spine changes; both paragraph atoms survive. */
function reverseBodyChildren(part: OoxmlPart): OoxmlPart {
  const visit = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (node.localName === 'body') {
      return { ...node, children: [...node.children].reverse() };
    }
    let changed = false;
    const children = node.children.map((child) => {
      const next = visit(child);
      if (next !== child) changed = true;
      return next;
    });
    return changed ? { ...node, children } : node;
  };
  return { ...part, root: visit(part.root) as OoxmlPart['root'] };
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
  test('publishes the first stable non-empty exclusion candidate without a cold twin pass', () => {
    const part = load(squareAnchorAtLeft({ text: 'tail '.repeat(30) }));
    let passes = 0;
    const stop = observeExclusionLayoutPassesForTest(() => {
      passes += 1;
    });
    try {
      layoutSemanticDocument(part, 1, {
        measurer,
        inlineDrawingLayout: layoutContext(part),
      });
    } finally {
      stop();
    }
    expect(passes).toBe(2);
  });

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

  test('drops seeded zones before publishing when the edited pass collects none', () => {
    const session = createLayoutSession();
    const text = 'tail '.repeat(80);
    const anchored = load(squareAnchorAtLeft({ text }));
    const baseContext = layoutContext(anchored);
    layoutSemanticDocument(anchored, 1, {
      measurer,
      inlineDrawingLayout: baseContext,
      drawingLayoutEpoch: 'with-anchor',
      session,
    });

    // The leading paragraph moves the live anchor, so the previous-page seed A first relays to
    // a distinct non-empty map B. The context then models the anchor becoming non-excluding
    // between relays: the pass laid under B collects zero zones and must be run once more empty.
    const lead = firstParagraph(
      load(
        `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r><w:t>lead</w:t></w:r></w:p></w:body></w:document>`
      )
    );
    const movedAnchor = withLeadingParagraph(anchored, lead);
    let collectedMaps = 0;
    const relayContext: InlineDrawingLayoutContext = {
      ...baseContext,
      projectionForAtom: (atomId) => {
        const projection = baseContext.projectionForAtom?.(atomId) ?? null;
        return collectedMaps <= 2 ? projection : null;
      },
    };
    const incremental = (() => {
      const stopObserving = observeExclusionZoneCollectionsForTest((context) => {
        if (context === relayContext) collectedMaps += 1;
      });
      try {
        return layoutSemanticDocument(movedAnchor, 2, {
          measurer,
          inlineDrawingLayout: relayContext,
          drawingLayoutEpoch: 'moved-anchor',
          session,
        });
      } finally {
        stopObserving();
      }
    })();
    const cleanContext = layoutContext(movedAnchor);
    const clean = layoutSemanticDocument(movedAnchor, 2, {
      measurer,
      inlineDrawingLayout: {
        ...cleanContext,
        projectionForAtom: () => null,
        project: cleanContext.project,
      },
      drawingLayoutEpoch: 'non-excluding-anchor',
    });

    expect(incremental.pages).toEqual(clean.pages);
    expect(collectedMaps).toBe(3);
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

  test('copy-on-write MC anchor reorder invalidates collision, exclusion, and paint source order', () => {
    const part = withDrawingNodeIds(
      load(
        `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}" xmlns:mc="${MC}" xmlns:wps="${WPS}"><w:body>` +
          fixedCollisionAnchorParagraph('first', 1, true) +
          fixedCollisionAnchorParagraph('second', 2, true) +
          '</w:body></w:document>'
      ),
      ['z-inner-drawing', 'a-inner-drawing']
    );
    const reorderedPart = reverseBodyChildren(part);
    const initialAtoms = drawingAtomIdentities(part)!;
    const reorderedAtoms = drawingAtomIdentities(reorderedPart)!;
    const initialIds = [...initialAtoms.keys()];
    expect(initialIds).toHaveLength(2);
    expect([...reorderedAtoms.keys()]).toEqual([...initialIds].reverse());
    for (const drawingId of initialIds) {
      expect(reorderedAtoms.get(drawingId)).toBe(initialAtoms.get(drawingId));
    }

    const context = layoutContext(part);
    const projectionIds = initialIds.map(
      (atomId) => context.projectionForAtom?.(atomId)?.drawingNodeId
    );
    expect(projectionIds).toEqual(['z-inner-drawing', 'a-inner-drawing']);
    const initialSourceOrder = drawingSourceOrderInPart(part, context);
    expect(projectionIds.map((drawingId) => initialSourceOrder.get(drawingId!))).toEqual([0, 1]);
    const alternateContext: InlineDrawingLayoutContext = {
      ...context,
      projectionForAtom(atomId) {
        const projection = context.projectionForAtom?.(atomId) ?? null;
        return projection
          ? { ...projection, drawingNodeId: `alternate:${projection.drawingNodeId}` }
          : null;
      },
    };
    const alternateSourceOrder = drawingSourceOrderInPart(part, alternateContext);
    expect(alternateSourceOrder).not.toBe(initialSourceOrder);
    expect(
      projectionIds.map((drawingId) => alternateSourceOrder.get(`alternate:${drawingId}`))
    ).toEqual([0, 1]);
    expect(drawingSourceOrderInPart(part, context)).toBe(initialSourceOrder);
    const reorderedSourceOrder = drawingSourceOrderInPart(reorderedPart, context);
    expect(projectionIds.map((drawingId) => reorderedSourceOrder.get(drawingId!))).toEqual([1, 0]);
    const cache = createParagraphLayoutCache<readonly PendingLine[]>();
    const session = createLayoutSession();
    const stableOptions = {
      measurer,
      inlineDrawingLayout: context,
      drawingLayoutEpoch: 'stable-drawing-epoch',
      drawingLayoutToken: 'stable-drawing-token',
      cache,
      session,
      producer: 'cow-drawing-order',
    } as const;
    const initial = layoutSemanticDocument(part, 1, stableOptions);
    const initialAnchors = initial.pages[0]!.anchoredDrawings ?? [];
    expect(initialAnchors.map((drawing) => drawing.drawingNodeId)).toEqual(initialIds);
    expect(initialAnchors.map((drawing) => drawing.sourceOrder)).toEqual([0, 1]);
    expect(initialAnchors[1]!.y).toBeGreaterThan(initialAnchors[0]!.y);

    const reordered = layoutSemanticDocument(reorderedPart, 2, stableOptions);
    const reorderedAnchors = reordered.pages[0]!.anchoredDrawings ?? [];
    expect(reorderedAnchors.map((drawing) => drawing.drawingNodeId)).toEqual([
      initialIds[1],
      initialIds[0],
    ]);
    expect(reorderedAnchors.map((drawing) => drawing.sourceOrder)).toEqual([0, 1]);
    expect(reorderedAnchors[1]!.y).toBeGreaterThan(reorderedAnchors[0]!.y);

    const zones = collectExclusionZonesByPage(reordered.pages, context, CONTENT_WIDTH_PT).get(0);
    expect(zones?.map((zone) => zone.drawingNodeId)).toEqual([initialIds[1], initialIds[0]]);
    expect(zones?.map((zone) => zone.sourceOrder)).toEqual([0, 1]);
    expect(zones?.[1]!.y).toBeGreaterThan(zones?.[0]!.y ?? Number.POSITIVE_INFINITY);
  });
});

describe('a table clear of a float does not inherit its wrap band', () => {
  const CELL_TEXT = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';
  /** Column-relative left edge of the square anchor these fixtures place. */
  const FLOAT_LEFT = emuToPoints(3000000);
  const FLOAT_RIGHT = FLOAT_LEFT + emuToPoints(1828800);

  /**
   * A square-wrapped picture at the top of the page and a table pushed well past its band.
   * `withFloat: false` keeps the same paragraph and only drops the drawing, so the table
   * lands in the same flow with nothing to wrap around.
   */
  function floatAboveTable(withFloat: boolean): string {
    const anchor =
      '<w:r><w:drawing>' +
      '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
      '<wp:simplePos x="0" y="0"/>' +
      '<wp:positionH relativeFrom="column"><wp:posOffset>3000000</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="1828800" cy="914400"/>' +
      '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>' +
      '<wp:docPr id="1" name="pic"/>' +
      `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      '<pic:spPr><a:xfrm><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
      '</wp:anchor></w:drawing></w:r>';
    const cell = (width: string, text: string): string =>
      `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>` +
      '<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>' +
      `<w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    return (
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      '<w:body>' +
      `<w:p>${withFloat ? anchor : ''}<w:r><w:t>lead</w:t></w:r></w:p>` +
      fillerParagraphs(6) +
      '<w:tbl>' +
      '<w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="7000"/></w:tblGrid>' +
      `<w:tr>${cell('2000', 'label')}${cell('7000', CELL_TEXT)}</w:tr>` +
      '</w:tbl>' +
      '</w:body></w:document>'
    );
  }

  interface WideCell {
    readonly lines: readonly LineRecord[];
    readonly box: LayoutBox;
    readonly tableTop: number;
    readonly bandBottom: number;
  }

  /**
   * A paragraph cache is what makes this observable: the row is laid out twice, once by the
   * natural-height probe and once where it lands, and the cache is what carries a break
   * between them.
   */
  function wideCell(withFloat: boolean): WideCell {
    const part = load(floatAboveTable(withFloat));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      cache: createParagraphLayoutCache(),
      inlineDrawingLayout: layoutContext(part),
    });
    const page = layout.pages[0]!;
    const anchor = (page.anchoredDrawings ?? [])[0];
    const table = page.fragments.find((fragment) => fragment.kind === 'table');
    if (table?.kind !== 'table') throw new Error('missing table fragment');
    const cell = table.rows[0]!.cells[1]!;
    return {
      lines: paragraphFragmentsOfBlocks(cell.blocks).flatMap((paragraph) => paragraph.lines),
      box: cell.box,
      tableTop: table.box.y,
      bandBottom: anchor ? anchor.y + anchor.height : 0,
    };
  }

  test('no cell line steps over the float to resume at its far edge', () => {
    const floated = wideCell(true);
    // The premise: the table sits entirely below the picture, so nothing in it may wrap.
    expect(floated.tableTop).toBeGreaterThan(floated.bandBottom);
    expect(floated.lines.length).toBeGreaterThan(1);

    for (const line of floated.lines) {
      for (const span of line.spans) {
        // Resuming exactly at the picture's right edge is the signature of a line that
        // thought it had to step over it.
        expect(Math.abs(span.box.x - FLOAT_RIGHT)).toBeGreaterThan(0.5);
      }
      const last = line.spans[line.spans.length - 1]!;
      expect(last.box.x + last.box.width).toBeLessThanOrEqual(
        floated.box.x + floated.box.width + 1
      );
    }
  });

  test('the cell breaks exactly as it does with no float in the document at all', () => {
    const floated = wideCell(true);
    const plain = wideCell(false);
    const shape = (cell: WideCell): readonly string[][] =>
      cell.lines.map((line) =>
        line.spans.map((span) => `${span.text}@${(span.box.x - cell.box.x).toFixed(2)}`)
      );
    // The natural-height probe places the row at y=0 to keep its height free of any page
    // position. Wrap zones ARE page positions, so consulting them there breaks the cell
    // around a picture hundreds of points above it, and the placed row used to inherit that
    // break through a cache keyed on zone geometry alone.
    expect(shape(floated)).toEqual(shape(plain));
    expect(floated.box.height).toBeCloseTo(plain.box.height, 3);
  });
});
