// Task 9 fix round 3 — five high blockers (typed-drawings-and-images).

import { describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import { emuToPoints } from '../drawing-layout.ts';
import {
  compareDrawingPaintOrder,
  firstAvailableIntervalAtOrAfter,
  snapXToAvailableInterval,
  sortDrawingsForPaint,
} from '../drawing-exclusion.ts';
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

function layoutContext(part: OoxmlPart, owner = OWNER) {
  const atomProjections = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: owner,
    projectionForAtom: (atomId: string) => atomProjections.get(atomId) ?? null,
    project: (node: import('../../store/package/ooxml-tree.ts').OoxmlDrawingNode) =>
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

describe('line placement snaps to first available interval (blocker 1)', () => {
  test('interval helpers pick the first passage at or after x', () => {
    const intervals = Object.freeze([
      { start: 0, end: 80 },
      { start: 200, end: 468 },
    ]);
    expect(firstAvailableIntervalAtOrAfter(0, intervals)?.start).toBe(0);
    expect(firstAvailableIntervalAtOrAfter(100, intervals)?.start).toBe(200);
    const snap = snapXToAvailableInterval(100, intervals);
    expect(snap?.x).toBeCloseTo(200, 3);
    expect(snap?.available).toBeCloseTo(268, 3);
  });

  test('bothSides square wrap places trailing text in the right passage', () => {
    const imageLeft = emuToPoints(914400);
    const imageWidth = emuToPoints(1828800);
    const anchorPara =
      `<w:p><w:r><w:t>${'lead '.repeat(6)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({
        posH: `<wp:positionH relativeFrom="column"><wp:posOffset>${914400}</wp:posOffset></wp:positionH>`,
      })}</w:drawing></w:r>` +
      `<w:r><w:t>${'trail '.repeat(10)}</w:t></w:r></w:p>`;
    const part = load(bodyDoc(anchorPara));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
    });
    const lines = paragraphFragmentsOf(layout.pages[0]!).flatMap((f) => f.lines);
    const anchorLine = lines.find((line) => line.spans.some((span) => span.text.includes('trail')));
    expect(anchorLine).toBeDefined();
    const trailSpan = anchorLine!.spans.find((span) => span.text.includes('trail'));
    expect(trailSpan).toBeDefined();
    expect(trailSpan!.box.x).toBeGreaterThanOrEqual(imageLeft + imageWidth - 1);
    expect(trailSpan!.box.width).toBeGreaterThan(0);
  });

  test('oversized first token on a narrowed line closes instead of zero-width emit', () => {
    const anchorPara =
      `<w:p><w:r><w:drawing>${anchorCore({
        posH: '<wp:positionH relativeFrom="column"><wp:align>left</wp:align></wp:positionH>',
        extentCx: '4572000',
        extentCy: '914400',
      })}</w:drawing></w:r>` + `<w:r><w:t>${'overflowword '.repeat(8)}</w:t></w:r></w:p>`;
    const part = load(bodyDoc(anchorPara));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const lines = paragraphFragmentsOf(layout.pages[0]!).flatMap((f) => f.lines);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      for (const span of line.spans) {
        if (span.text.trim().length === 0) continue;
        expect(span.box.width).toBeGreaterThan(0);
      }
    }
  });
});

describe('topAndBottom advances y once before text (blocker 2)', () => {
  test('flow height includes skip once, not inside line height', () => {
    const topBottomWrap = '<wp:wrapTopAndBottom distT="0" distB="0" distL="0" distR="0"/>';
    const doc =
      `<w:p><w:r><w:t>${'above '.repeat(4)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({ wrap: topBottomWrap, extentCy: '1371600' })}</w:drawing></w:r>` +
      `<w:r><w:t>${'below '.repeat(4)}</w:t></w:r></w:p>`;
    const part = load(bodyDoc(doc));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
    });
    const lines = paragraphFragmentsOf(layout.pages[0]!).flatMap((f) => f.lines);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const imageHeight = emuToPoints(1371600);
    const belowLine = lines.find((line) => line.spans.some((span) => span.text.includes('below')));
    expect(belowLine).toBeDefined();
    const aboveLine = lines.find((line) => line.spans.some((span) => span.text.includes('above')));
    expect(aboveLine).toBeDefined();
    expect(belowLine!.box.y).toBeGreaterThanOrEqual(imageHeight - 2);
    const gap = belowLine!.box.y - (aboveLine!.box.y + aboveLine!.box.height);
    expect(belowLine!.box.y + belowLine!.box.height).toBeGreaterThan(imageHeight - 0.5);
    expect(gap).toBeGreaterThanOrEqual(0);
    if (gap > 0) expect(belowLine!.box.height).toBeLessThan(gap + 5);
  });
});

describe('table exclusion zones use cell-local coordinates (blocker 3)', () => {
  test('second cell anchor does not narrow first cell lines', () => {
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
      `<w:r><w:t>${'tail '.repeat(8)}</w:t></w:r></w:p></w:tc>` +
      '</w:tr></w:tbl>';
    const part = load(bodyDoc(table));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
    });
    const tableFragment = layout.pages[0]!.fragments.find((f) => f.kind === 'table');
    expect(tableFragment?.kind).toBe('table');
    if (tableFragment?.kind !== 'table') return;
    const cell1 = tableFragment.rows[0]!.cells[0]!;
    const cell2 = tableFragment.rows[0]!.cells[1]!;
    const cell1Lines = cell1.blocks.flatMap((b) => (b.kind === 'paragraph' ? b.lines : []));
    const cell2Lines = cell2.blocks.flatMap((b) => (b.kind === 'paragraph' ? b.lines : []));
    expect(cell1Lines.length).toBeGreaterThan(0);
    expect(cell2Lines.length).toBeGreaterThan(0);
    const cell1Max = Math.max(
      ...cell1Lines.flatMap((line) => line.spans.map((span) => span.box.x + span.box.width))
    );
    const cell1Width = cell1.box.width;
    expect(cell1Max).toBeLessThanOrEqual(cell1Width + 2);
    const imageWidth = emuToPoints(1828800);
    const narrowed = cell2Lines.some((line) =>
      line.spans.some(
        (span) =>
          span.text.trim().length > 0 && span.box.x + span.box.width <= imageWidth + span.box.x + 2
      )
    );
    expect(narrowed).toBe(true);
  });
});

describe('paint order comparator (blocker 4)', () => {
  test('relativeHeight beats source order when they disagree', () => {
    const lowHeight = Object.freeze({
      drawingNodeId: 'low',
      sourceOrder: 1,
      relativeHeight: 5,
      behindDocument: false,
    } as import('../drawing-layout.ts').AnchoredDrawingRecord);
    const highSource = Object.freeze({
      drawingNodeId: 'high',
      sourceOrder: 0,
      relativeHeight: 10,
      behindDocument: false,
    } as import('../drawing-layout.ts').AnchoredDrawingRecord);
    expect(compareDrawingPaintOrder(lowHeight, highSource)).toBeLessThan(0);
    const sorted = sortDrawingsForPaint([highSource, lowHeight]);
    expect(sorted[0]!.drawingNodeId).toBe('low');
    expect(sorted[1]!.drawingNodeId).toBe('high');
  });
});

function anchorPara(options?: Parameters<typeof anchorCore>[0], tail = 'x'): string {
  return (
    `<w:p><w:r><w:drawing>${anchorCore(options)}</w:drawing></w:r>` +
    `<w:r><w:t>${tail}</w:t></w:r></w:p>`
  );
}

describe('terminal-page deferred anchor (blocker 5)', () => {
  test('creates anchor-only next page with furniture and hittable anchor', () => {
    const filler = `<w:p><w:r><w:t>${'fill '.repeat(120)}</w:t></w:r></w:p>`;
    const anchors =
      anchorPara({ id: '1', allowOverlap: '0', relativeHeight: '1' }, 'x') +
      anchorPara({ id: '2', allowOverlap: '0', relativeHeight: '2' }, 'y');
    const part = load(bodyDoc(filler + anchors));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: {
        width: 612,
        height: 220,
        margin: { top: 72, right: 72, bottom: 72, left: 72 },
      },
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    const allAnchors = layout.pages.flatMap((p) => p.anchoredDrawings ?? []);
    expect(allAnchors.length).toBe(2);
    expect(new Set(allAnchors.map((d) => d.drawingNodeId)).size).toBe(2);
    const anchorOnlyPage = layout.pages.find(
      (page) => page.fragments.length === 0 && (page.anchoredDrawings?.length ?? 0) > 0
    );
    expect(anchorOnlyPage).toBeDefined();
  });
});
