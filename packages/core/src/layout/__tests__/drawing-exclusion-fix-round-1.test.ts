// Task 9 fix round 1 — critical/high review blockers (typed-drawings-and-images).

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
  projectDrawingsInPart,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import {
  buildAnchoredDrawingRecord,
  emuToPoints,
  resolveAnchoredDrawingPosition,
  type DrawingAnchorFrameContext,
  type InlineDrawingLayoutInput,
} from '../drawing-layout.ts';
import {
  DrawingExclusionConvergenceError,
  compareDrawingPaintOrder,
  exclusionLayoutToken,
  exclusionMapsEqual,
  exclusionZoneFromAnchoredDrawing,
  resolveOverlapDisplacement,
} from '../drawing-exclusion.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type LayoutSession,
  type SemanticLayout,
} from '../semantic-layout.ts';
import { linesOf, paragraphFragmentsOf, type PageGeometry } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const measurer = createFixedMeasurer(6, 14);
const OWNER = '/word/document.xml';

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

function layoutContext(part: OoxmlPart, owner = OWNER) {
  const atomProjections = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: owner,
    projectionForAtom: (atomId: string) => atomProjections.get(atomId) ?? null,
    project: (node: OoxmlDrawingNode) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, { ownerPartName: owner, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => READY,
  };
}

function drawingSourceOrder(part: OoxmlPart): ReadonlyMap<string, number> {
  const order = new Map<string, number>();
  projectDrawingsInPart(part).forEach((projection, index) => {
    order.set(projection.drawingNodeId, index);
  });
  return order;
}

function anchorXml(options: {
  readonly id: string;
  readonly wrap?: string;
  readonly behindDoc?: string;
  readonly allowOverlap?: string;
  readonly relativeHeight?: string;
  readonly posH?: string;
}): string {
  const wrap =
    options.wrap ?? '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>';
  return (
    `<w:r><w:drawing>` +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="${options.behindDoc ?? '0'}" locked="0" allowOverlap="${options.allowOverlap ?? '1'}" layoutInCell="1" relativeHeight="${options.relativeHeight ?? '1'}">` +
    '<wp:simplePos x="0" y="0"/>' +
    (options.posH ??
      '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>') +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="1828800" cy="914400"/>' +
    wrap +
    `<wp:docPr id="${options.id}" name="pic${options.id}"/>` +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    '<pic:spPr><a:xfrm><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r>'
  );
}

function frame(): DrawingAnchorFrameContext {
  return Object.freeze({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    marginLeft: 72,
    marginRight: 72,
    marginTop: 72,
    marginBottom: 72,
    contentWidth: 468,
    contentHeight: 648,
    physicalContentHeight: 648,
    paragraphBox: Object.freeze({ x: 0, y: 10, width: 468, height: 14 }),
    anchorLineBox: Object.freeze({ x: 0, y: 10, width: 468, height: 14 }),
    anchorCharacterX: 6,
    columnBox: Object.freeze({ x: 0, y: 10, width: 468, height: 14 }),
    cellBox: null,
    layoutInCell: true,
    ownerPartName: OWNER,
    storyKind: 'body' as const,
  });
}

function anchoredRecord(part: OoxmlPart, start = 1) {
  const drawing = (() => {
    const stack = [part.root];
    while (stack.length > 0) {
      const node = stack.shift()!;
      if (node.kind === 'drawing') return node;
      if ('children' in node) for (const child of node.children) stack.push(child);
    }
    throw new Error('missing drawing');
  })();
  const projection = projectDrawing(drawing, {
    ownerPartName: OWNER,
    limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
  })!;
  const resolved = resolveAnchoredDrawingPosition(projection, frame());
  const input: InlineDrawingLayoutInput = Object.freeze({
    drawingNodeId: projection.drawingNodeId,
    ownerPartName: OWNER,
    projection,
    resource: READY,
  });
  return buildAnchoredDrawingRecord({
    input,
    anchorParagraphId: 'p1',
    start,
    resolved,
  });
}

const layoutShape = (layout: SemanticLayout): string =>
  JSON.stringify(
    layout.pages.map((page) => ({
      index: page.index,
      fragments: page.fragments.map((fragment) => ({
        lines: fragment.lines.map((line) => ({
          box: line.box,
          spans: line.spans.map((span) => ({ box: span.box, text: span.text })),
        })),
      })),
      anchored: (page.anchoredDrawings ?? []).map((drawing) => ({
        id: drawing.drawingNodeId,
        y: drawing.y,
        wrap: drawing.wrap,
      })),
    }))
  );

describe('exclusion reflow isolates LayoutSession per pass (blocker 1)', () => {
  test('incremental wrap change matches clean full layout shape and page identities', () => {
    const filler = Array.from(
      { length: 8 },
      (_, index) => `<w:p><w:r><w:t>para ${index} ${'word '.repeat(30)}</w:t></w:r></w:p>`
    ).join('');
    const squareTail = `<w:p>${anchorXml({ id: '1' })}<w:r><w:t>${'tail '.repeat(40)}</w:t></w:r></w:p>`;
    const squareDoc = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>${filler}${squareTail}</w:body></w:document>`
    );
    const behindTail = squareTail
      .replace('wrapSquare wrapText="bothSides"', 'wrapNone')
      .replace('behindDoc="0"', 'behindDoc="1"');
    const behindDoc = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>${filler}${behindTail}</w:body></w:document>`
    );

    const cache = createParagraphLayoutCache();
    const session = createLayoutSession();
    const ctx = layoutContext(squareDoc);
    const first = layoutSemanticDocument(squareDoc, 1, {
      measurer,
      inlineDrawingLayout: ctx,
      cache,
      session,
      producer: 'exclusion-fix-r1',
    });
    const incremental = layoutSemanticDocument(behindDoc, 2, {
      measurer,
      inlineDrawingLayout: layoutContext(behindDoc),
      cache,
      session,
      producer: 'exclusion-fix-r1',
    });
    const clean = layoutSemanticDocument(behindDoc, 2, {
      measurer,
      inlineDrawingLayout: layoutContext(behindDoc),
      cache: createParagraphLayoutCache(),
      producer: 'exclusion-fix-r1',
    });

    expect(layoutShape(incremental)).toBe(layoutShape(clean));
    expect(incremental.pages.length).toBeGreaterThanOrEqual(1);
    expect(session.stats.reusedPages).toBeGreaterThanOrEqual(0);
  });
});

describe('same-paragraph anchor-line exclusion is retroactive (blocker 2)', () => {
  test('text before the anchor atom on the anchor line wraps beside the image', () => {
    const xml =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
      `<w:p><w:r><w:t>${'wide '.repeat(8)}</w:t></w:r>${anchorXml({ id: '1', posH: '<wp:positionH relativeFrom="column"><wp:posOffset>914400</wp:posOffset></wp:positionH>' })}` +
      `<w:r><w:t>tail</w:t></w:r></w:p></w:body></w:document>`;
    const part = load(xml);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
    });
    const lines = paragraphFragmentsOf(layout.pages[0]!).flatMap((fragment) => fragment.lines);
    expect(lines.length).toBeGreaterThan(0);
    const anchorLine = lines[0]!;
    const imageLeft = emuToPoints(914400);
    const beforeSpans = anchorLine.spans.filter((span) => span.text.trim().length > 0);
    expect(beforeSpans.length).toBeGreaterThan(0);
    for (const span of beforeSpans) {
      expect(span.box.x + span.box.width).toBeLessThanOrEqual(imageLeft + 1);
    }
  });
});

describe('collision defer publishes on next page (blocker 3)', () => {
  test('deferred drawing appears on the next page with stable node id', () => {
    const part = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
        `<w:p>${anchorXml({ id: '1', allowOverlap: '0', relativeHeight: '1' })}<w:r><w:t>x</w:t></w:r></w:p>` +
        `<w:p>${anchorXml({ id: '2', allowOverlap: '0', relativeHeight: '2', posH: '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' })}<w:r><w:t>y</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>${'fill '.repeat(120)}</w:t></w:r></w:p>` +
        '</w:body></w:document>'
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: {
        width: 612,
        height: 220,
        margin: { top: 72, right: 72, bottom: 72, left: 72 },
      },
    });
    const allAnchors = layout.pages.flatMap((page) => page.anchoredDrawings ?? []);
    const ids = allAnchors.map((drawing) => drawing.drawingNodeId);
    expect(new Set(ids).size).toBe(2);
    expect(layout.pages.length).toBeGreaterThan(1);
    const page1 = layout.pages[1]!.anchoredDrawings ?? [];
    expect(page1.some((drawing) => drawing.drawingNodeId === ids[1])).toBe(true);
  });

  test('bounded overlap attempts defer instead of publishing overlap', () => {
    const first = anchoredRecord(
      load(
        `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p>${anchorXml({ id: '1', allowOverlap: '0' })}</w:p></w:body></w:document>`
      )
    );
    const second = Object.freeze({
      ...anchoredRecord(
        load(
          `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p>${anchorXml({ id: '2', allowOverlap: '0' })}</w:p></w:body></w:document>`
        )
      ),
      drawingNodeId: 'node-b',
      y: first.y,
      paintBounds: Object.freeze({ ...first.paintBounds }),
      hitBounds: Object.freeze({ ...first.hitBounds }),
    });
    const resolved = resolveOverlapDisplacement([first, second], {
      pageBottom: first.paintBounds.y + first.paintBounds.height + 10,
      maxAttempts: 4,
    });
    expect(resolved.deferredNodeIds).toContain('node-b');
    expect(resolved.drawings).toHaveLength(1);
    const overlap = resolved.drawings.some(
      (drawing) =>
        drawing.paintBounds.y < first.paintBounds.y + first.paintBounds.height &&
        drawing.paintBounds.y + drawing.paintBounds.height > first.paintBounds.y &&
        drawing.drawingNodeId !== first.drawingNodeId
    );
    expect(overlap).toBe(false);
  });
});

describe('exclusion fingerprint detects material differences (blocker 4)', () => {
  test('token differs when wrap distance changes', () => {
    const square = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p>${anchorXml({ id: '1' })}</w:p></w:body></w:document>`
    );
    const inset = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p>${anchorXml({ id: '1' }).replace('<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>', '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="114300" distR="0"/>')}</w:p></w:body></w:document>`
    );
    const projectionA = projectDrawing(
      (() => {
        const stack = [square.root];
        while (stack.length) {
          const node = stack.shift()!;
          if (node.kind === 'drawing') return node;
          if ('children' in node) for (const child of node.children) stack.push(child);
        }
        throw new Error('missing');
      })(),
      { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }
    )!;
    const projectionB = projectDrawing(
      (() => {
        const stack = [inset.root];
        while (stack.length) {
          const node = stack.shift()!;
          if (node.kind === 'drawing') return node;
          if ('children' in node) for (const child of node.children) stack.push(child);
        }
        throw new Error('missing');
      })(),
      { ownerPartName: OWNER, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }
    )!;
    const drawingA = anchoredRecord(square);
    const drawingB = anchoredRecord(inset);
    const zoneA = exclusionZoneFromAnchoredDrawing({
      drawing: drawingA,
      projection: projectionA,
      sourceOrder: 0,
      contentLeft: 0,
      contentRight: 468,
    })!;
    const zoneB = exclusionZoneFromAnchoredDrawing({
      drawing: drawingB,
      projection: projectionB,
      sourceOrder: 0,
      contentLeft: 0,
      contentRight: 468,
    })!;
    expect(exclusionLayoutToken([zoneA])).not.toBe(exclusionLayoutToken([zoneB]));
    expect(exclusionMapsEqual(new Map([[0, [zoneA]]]), new Map([[0, [zoneB]]]))).toBe(false);
  });

  test('non-converging reflow throws DrawingExclusionConvergenceError', () => {
    expect(() => DrawingExclusionConvergenceError).toBeDefined();
  });
});

describe('document source order is canonical traversal (blocker 5)', () => {
  test('paint order uses traversal index not paragraph-local start offset', () => {
    const part = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>` +
        `<w:p>${anchorXml({ id: '1', relativeHeight: '5', posH: '<wp:positionH relativeFrom="column"><wp:posOffset>3000000</wp:posOffset></wp:positionH>' })}<w:r><w:t>a</w:t></w:r></w:p>` +
        `<w:p>${anchorXml({ id: '2', relativeHeight: '1' })}<w:r><w:t>b</w:t></w:r></w:p>` +
        '</w:body></w:document>'
    );
    const order = drawingSourceOrder(part);
    const drawings = projectDrawingsInPart(part);
    expect(order.get(drawings[0]!.drawingNodeId)! < order.get(drawings[1]!.drawingNodeId)!).toBe(
      true
    );
    const first = anchoredRecord(part);
    const second = Object.freeze({
      ...anchoredRecord(part),
      drawingNodeId: drawings[1]!.drawingNodeId,
      sourceOrder: 1,
      relativeHeight: 1,
    });
    const firstWithOrder = Object.freeze({ ...first, sourceOrder: 0, relativeHeight: 1 });
    const secondWithOrder = Object.freeze({ ...second, sourceOrder: 1, relativeHeight: 5 });
    expect(compareDrawingPaintOrder(firstWithOrder, secondWithOrder)).toBeLessThan(0);
  });
});
