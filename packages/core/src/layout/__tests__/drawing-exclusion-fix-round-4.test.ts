// Task 9 fix round 4 — four high blockers (typed-drawings-and-images).

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
import {
  buildAnchoredDrawingRecord,
  emuToPoints,
  resolveAnchoredDrawingPosition,
  type DrawingAnchorFrameContext,
} from '../drawing-layout.ts';
import {
  MAX_ANCHOR_PAGE_DEFERRALS,
  collectExclusionZonesFromDrawings,
  compareDrawingCollisionOrder,
  compareDrawingPaintOrder,
  exclusionZoneFromAnchoredDrawing,
  localizeExclusionZones,
  resolveOverlapDisplacement,
} from '../drawing-exclusion.ts';
import { hitTestPage } from '../semantic-hit-test.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

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
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function drawingOf(part: OoxmlPart): OoxmlDrawingNode {
  const stack: import('../../store/package/ooxml-tree.ts').OoxmlElement[] = [part.root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.kind === 'drawing') return node;
    for (const child of node.children) {
      if (child.kind !== 'textValue') stack.push(child);
    }
  }
  throw new Error('missing drawing');
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

function anchorCore(options?: {
  readonly id?: string;
  readonly wrap?: string;
  readonly behindDoc?: string;
  readonly allowOverlap?: string;
  readonly relativeHeight?: string;
  readonly posH?: string;
  readonly posV?: string;
  readonly extentCx?: string;
  readonly extentCy?: string;
}): string {
  const wrap =
    options?.wrap ??
    '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>';
  return (
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="${options?.behindDoc ?? '0'}" locked="0" allowOverlap="${options?.allowOverlap ?? '1'}" layoutInCell="1" relativeHeight="${options?.relativeHeight ?? '1'}">` +
    '<wp:simplePos x="0" y="0"/>' +
    (options?.posH ??
      '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>') +
    (options?.posV ??
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>') +
    `<wp:extent cx="${options?.extentCx ?? '1828800'}" cy="${options?.extentCy ?? '914400'}"/>` +
    wrap +
    `<wp:docPr id="${options?.id ?? '1'}" name="pic"/>` +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    '<pic:spPr><a:xfrm><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor>'
  );
}

function bodyDoc(body: string): string {
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body>${body}</w:body></w:document>`
  );
}

function anchorFrame(): DrawingAnchorFrameContext {
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
    anchorCharacterX: 0,
    columnBox: Object.freeze({ x: 0, y: 0, width: 468, height: 14 }),
    cellBox: null,
    layoutInCell: true,
    ownerPartName: OWNER,
    storyKind: 'body',
  });
}

function anchoredRecord(
  part: OoxmlPart,
  overrides: { readonly drawingNodeId?: string; readonly sourceOrder?: number } = {}
) {
  const projection = projectDrawing(drawingOf(part), {
    ownerPartName: OWNER,
    limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
  })!;
  return buildAnchoredDrawingRecord({
    input: Object.freeze({
      drawingNodeId: overrides.drawingNodeId ?? projection.drawingNodeId,
      ownerPartName: OWNER,
      projection,
      resource: READY,
    }),
    anchorParagraphId: 'p',
    start: 0,
    resolved: resolveAnchoredDrawingPosition(projection, anchorFrame()),
    ...(overrides.sourceOrder !== undefined ? { sourceOrder: overrides.sourceOrder } : {}),
  });
}

describe('behindDocument produces no text exclusion (blocker 1)', () => {
  test('authored square wrap with behindDoc skips exclusion zone', () => {
    const part = load(
      bodyDoc(
        `<w:p><w:r><w:t>TEXT</w:t></w:r><w:r><w:drawing>${anchorCore({
          behindDoc: '1',
          posH: '<wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionH>',
          posV: '<wp:positionV relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionV>',
        })}</w:drawing></w:r></w:p>`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const drawing = layout.pages[0]!.anchoredDrawings![0]!;
    expect(drawing.behindDocument).toBe(true);
    expect(drawing.paintBounds.width).toBeGreaterThan(0);
    const textHit = hitTestPage(layout, 0, { x: 2, y: 5 });
    expect(textHit?.position.offset).toBe(0);
    expect(textHit?.drawing ?? undefined).toBeUndefined();
    const drawingHit = hitTestPage(layout, 0, {
      x: drawing.hitBounds.x + drawing.hitBounds.width - 2,
      y: drawing.hitBounds.y + 2,
    });
    expect(drawingHit?.drawing?.drawingNodeId).toBe(drawing.drawingNodeId);
  });

  test('exclusionZoneFromAnchoredDrawing returns null when behindDocument', () => {
    const part = load(
      bodyDoc(`<w:p><w:r><w:drawing>${anchorCore({ behindDoc: '1' })}</w:drawing></w:r></w:p>`)
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const record = anchoredRecord(part);
    expect(
      exclusionZoneFromAnchoredDrawing({
        drawing: record,
        projection,
        sourceOrder: 0,
        contentLeft: 0,
        contentRight: 468,
      })
    ).toBeNull();
  });
});

describe('table cell-local zones feed breakParagraph (blocker 2)', () => {
  test('second-column trail text x matches image right edge in cell coordinates', () => {
    const imageWidth = emuToPoints(1828800);
    const table =
      '<w:tbl><w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>' +
      '<w:tr>' +
      '<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr>' +
      `<w:p><w:r><w:t>${'cell1 '.repeat(20)}</w:t></w:r></w:p></w:tc>` +
      '<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr>' +
      `<w:p><w:r><w:t>${'cell2 '.repeat(6)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({
        id: '2',
        posH: '<wp:positionH relativeFrom="column"><wp:align>left</wp:align></wp:positionH>',
      })}</w:drawing></w:r>` +
      `<w:r><w:t>${'trail '.repeat(8)}</w:t></w:r></w:p></w:tc>` +
      '</w:tr></w:tbl>';
    const part = load(bodyDoc(table));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
    });
    const tableFragment = layout.pages[0]!.fragments.find((f) => f.kind === 'table');
    expect(tableFragment?.kind).toBe('table');
    if (tableFragment?.kind !== 'table') return;
    const cell2 = tableFragment.rows[0]!.cells[1]!;
    const cell2Lines = cell2.blocks.flatMap((b) => (b.kind === 'paragraph' ? b.lines : []));
    const besideImageLine = cell2Lines.find((line) =>
      line.spans.some(
        (span) => span.text.includes('cell2') && span.box.x - cell2.box.x >= imageWidth - 2
      )
    );
    expect(besideImageLine).toBeDefined();
    const besideSpan = besideImageLine!.spans.find(
      (span) => span.text.includes('cell2') && span.box.x - cell2.box.x >= imageWidth - 2
    );
    expect(besideSpan).toBeDefined();
    expect(besideSpan!.box.x - cell2.box.x).toBeGreaterThanOrEqual(imageWidth - 1);
    expect(besideSpan!.box.x - cell2.box.x).toBeLessThan(imageWidth + 20);
  });

  test('localizeExclusionZones shifts polygon x exactly once', () => {
    const part = load(bodyDoc(`<w:p><w:r><w:drawing>${anchorCore()}</w:drawing></w:r></w:p>`));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
    });
    const drawing = layout.pages[0]!.anchoredDrawings![0]!;
    const ctx = layoutContext(part);
    const zones = collectExclusionZonesFromDrawings([drawing], ctx, 0, 468);
    expect(zones.length).toBe(1);
    const localized = localizeExclusionZones(zones, 120, 0);
    const zone = localized[0]!;
    expect(zone.input.contentBounds.x).toBeCloseTo(zones[0]!.input.contentBounds.x - 120, 3);
    expect(zone.input.contentLeft).toBeCloseTo(zones[0]!.input.contentLeft - 120, 3);
    if (zone.input.polygon && zones[0]!.input.polygon) {
      expect(zone.input.polygon[0]!.x).toBeCloseTo(zones[0]!.input.polygon[0]!.x - 120, 3);
    }
  });
});

describe('collision order independent of paint metadata (blocker 3)', () => {
  test('compareDrawingCollisionOrder uses source order then node id only', () => {
    const lowSource = Object.freeze({
      drawingNodeId: 'aaa',
      sourceOrder: 0,
      relativeHeight: 99,
      behindDocument: false,
    } as import('../drawing-layout.ts').AnchoredDrawingRecord);
    const highSource = Object.freeze({
      drawingNodeId: 'bbb',
      sourceOrder: 1,
      relativeHeight: 1,
      behindDocument: true,
    } as import('../drawing-layout.ts').AnchoredDrawingRecord);
    expect(compareDrawingCollisionOrder(lowSource, highSource)).toBeLessThan(0);
    expect(compareDrawingPaintOrder(highSource, lowSource)).toBeLessThan(0);
  });

  test('overlap displacement ignores relativeHeight; paint sort does not', () => {
    const part = load(
      bodyDoc(`<w:p><w:r><w:drawing>${anchorCore({ allowOverlap: '0' })}</w:drawing></w:r></w:p>`)
    );
    const first = Object.freeze({
      ...anchoredRecord(part, { drawingNodeId: 'a', sourceOrder: 0 }),
      relativeHeight: 1,
    });
    const secondBase = anchoredRecord(part, { drawingNodeId: 'b', sourceOrder: 1 });
    const second = Object.freeze({
      ...secondBase,
      y: first.y,
      paintBounds: Object.freeze({ ...first.paintBounds }),
      hitBounds: Object.freeze({ ...first.hitBounds }),
    });
    const lowHeightResolved = resolveOverlapDisplacement(
      [first, Object.freeze({ ...second, relativeHeight: 99 })],
      { pageBottom: 648 }
    );
    const highHeightResolved = resolveOverlapDisplacement(
      [
        Object.freeze({ ...first, relativeHeight: 99 }),
        Object.freeze({ ...second, relativeHeight: 1 }),
      ],
      { pageBottom: 648 }
    );
    expect(lowHeightResolved.drawings[1]!.y).toBeCloseTo(highHeightResolved.drawings[1]!.y, 3);
  });

  test('changing relativeHeight alone does not move paragraph text', () => {
    const base = anchorCore({ id: '1', relativeHeight: '1' });
    const shifted = anchorCore({ id: '1', relativeHeight: '999999' });
    const para =
      `<w:p><w:r><w:t>${'lead '.repeat(6)}</w:t></w:r>` +
      `<w:r><w:drawing>${base}</w:drawing></w:r>` +
      `<w:r><w:t>${'trail '.repeat(10)}</w:t></w:r></w:p>`;
    const partA = load(bodyDoc(para));
    const partB = load(bodyDoc(para.replace(base, shifted)));
    const layoutA = layoutSemanticDocument(partA, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(partA),
    });
    const layoutB = layoutSemanticDocument(partB, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(partB),
    });
    const spansA = paragraphFragmentsOf(layoutA.pages[0]!)
      .flatMap((f) => f.lines)
      .flatMap((l) => l.spans);
    const spansB = paragraphFragmentsOf(layoutB.pages[0]!)
      .flatMap((f) => f.lines)
      .flatMap((l) => l.spans);
    const trailA = spansA.find((s) => s.text.includes('trail'));
    const trailB = spansB.find((s) => s.text.includes('trail'));
    expect(trailA).toBeDefined();
    expect(trailB).toBeDefined();
    expect(trailB!.box.x).toBeCloseTo(trailA!.box.x, 3);
    expect(trailB!.box.y).toBeCloseTo(trailA!.box.y, 3);
  });
});

describe('bounded terminal deferred-page carry (blocker 4)', () => {
  test(`oversized anchor defers at most ${MAX_ANCHOR_PAGE_DEFERRALS} pages then publishes fallback`, () => {
    const tallCy = String(914400 * 20);
    const doc = `<w:p><w:r><w:drawing>${anchorCore({
      allowOverlap: '0',
      extentCy: tallCy,
      posV: '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>',
    })}</w:drawing></w:r><w:r><w:t>x</w:t></w:r></w:p>`;
    const part = load(bodyDoc(doc));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: {
        width: 612,
        height: 220,
        margin: { top: 72, right: 72, bottom: 72, left: 72 },
      },
    });
    const anchors = layout.pages.flatMap((p) => p.anchoredDrawings ?? []);
    expect(anchors.length).toBe(1);
    expect(anchors[0]!.layoutFallback).toBe('page-defer-exhausted');
    expect(layout.pages.length).toBeLessThanOrEqual(MAX_ANCHOR_PAGE_DEFERRALS + 2);
    expect(layout.pages.length).toBeGreaterThan(1);
  });
});
