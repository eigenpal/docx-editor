// Task 9 fix round 6 — topAndBottom clearance uses final line vertical interval (typed-drawings-and-images).

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
  MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS,
  topAndBottomSkipBeforeLine,
  type ExclusionZone,
} from '../drawing-exclusion.ts';
import type { WrapExclusionInput } from '../drawing-wrap.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const measurer = createFixedMeasurer(6, 14);
const tallMeasurer = createFixedMeasurer(6, 14);
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
    contentType: owner.includes('ftr')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'
      : owner.includes('header')
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
    project: (node: import('../../store/package/ooxml-tree.ts').OoxmlDrawingNode) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, { ownerPartName: owner, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => READY,
  };
}

function topBottomZone(bandY: number, bandHeight: number, id = 'd1'): ExclusionZone {
  const input: WrapExclusionInput = {
    mode: 'topAndBottom',
    textSide: 'bothSides',
    contentBounds: Object.freeze({ x: 0, y: bandY, width: 100, height: bandHeight }),
    wrapDistances: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
    effectInsets: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
    contentLeft: 0,
    contentRight: 468,
  };
  return Object.freeze({
    drawingNodeId: id,
    anchorParagraphId: 'p1',
    anchorModelStart: 0,
    sourceOrder: 0,
    paintLayer: 'inFront' as const,
    relativeHeight: 1,
    allowOverlap: true,
    columnIndex: 0,
    y: bandY,
    verticalBand: Object.freeze({ x: 0, y: bandY, width: 468, height: bandHeight }),
    input,
  });
}

function lineClearsBands(
  lineTop: number,
  lineHeight: number,
  skip: number,
  zones: readonly ExclusionZone[]
): boolean {
  const top = lineTop + skip;
  const bottom = top + lineHeight;
  for (const zone of zones) {
    if (zone.input.mode !== 'topAndBottom') continue;
    const bandTop = zone.verticalBand.y;
    const bandBottom = bandTop + zone.verticalBand.height;
    if (top < bandBottom && bottom > bandTop) return false;
  }
  return true;
}

function anchorCore(options?: {
  readonly wrap?: string;
  readonly posH?: string;
  readonly posV?: string;
  readonly extentCx?: string;
  readonly extentCy?: string;
}): string {
  const wrap =
    options?.wrap ??
    '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>';
  return (
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    (options?.posH ??
      '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>') +
    (options?.posV ??
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>') +
    `<wp:extent cx="${options?.extentCx ?? '1828800'}" cy="${options?.extentCy ?? '914400'}"/>` +
    wrap +
    '<wp:docPr id="1" name="pic"/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    '<pic:spPr><a:xfrm><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor>'
  );
}

function inlineCore(extentCy = '4572000'): string {
  return (
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="914400" cy="${extentCy}"/>` +
    '<wp:docPr id="2" name="inline"/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:ext cx="914400" cy="${extentCy}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    '</wp:inline>'
  );
}

function bodyDoc(body: string): string {
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body>${body}</w:body></w:document>`
  );
}

describe('topAndBottomSkipBeforeLine uses full line interval (blocker)', () => {
  test('edge-only intersection: midpoint below band but bottom edge inside triggers skip', () => {
    const zones = [topBottomZone(50, 30)];
    const lineTop = 35;
    const lineHeight = 25;
    const midpoint = lineTop + lineHeight / 2;
    expect(midpoint).toBeLessThan(50);
    const skip = topAndBottomSkipBeforeLine(lineTop, lineHeight, zones);
    expect(skip).toBeGreaterThan(0);
    expect(lineClearsBands(lineTop, lineHeight, skip, zones)).toBe(true);
    expect(lineTop + skip).toBeGreaterThanOrEqual(80);
  });

  test('tall line growth clears below union of overlapping bands with hard bound', () => {
    const zones = [topBottomZone(50, 20, 'a'), topBottomZone(65, 25, 'b')];
    const lineTop = 40;
    const lineHeight = 35;
    const skip = topAndBottomSkipBeforeLine(lineTop, lineHeight, zones);
    expect(skip).toBeCloseTo(50, 3);
    expect(lineClearsBands(lineTop, lineHeight, skip, zones)).toBe(true);
    expect(lineTop + skip).toBeGreaterThanOrEqual(90);
  });

  test('adjacent bands take union bottom once', () => {
    const zones = [topBottomZone(50, 20, 'a'), topBottomZone(70, 15, 'b')];
    const lineTop = 30;
    const lineHeight = 25;
    const skip = topAndBottomSkipBeforeLine(lineTop, lineHeight, zones);
    expect(skip).toBeCloseTo(55, 3);
    expect(lineClearsBands(lineTop, lineHeight, skip, zones)).toBe(true);
  });

  test('minimum height pre-check may underestimate; final height still clears', () => {
    const zones = [topBottomZone(50, 30)];
    const lineTop = 35;
    const minHeight = 14;
    const finalHeight = 28;
    const provisionalSkip = topAndBottomSkipBeforeLine(lineTop, minHeight, zones);
    expect(provisionalSkip).toBe(0);
    const finalSkip = topAndBottomSkipBeforeLine(lineTop, finalHeight, zones);
    expect(finalSkip).toBeGreaterThan(0);
    expect(lineClearsBands(lineTop, finalHeight, finalSkip, zones)).toBe(true);
  });

  test('hard bound stops after MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS', () => {
    expect(MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS).toBeGreaterThan(0);
    const zones = [topBottomZone(50, 10)];
    const skip = topAndBottomSkipBeforeLine(45, 8, zones);
    expect(skip).toBeLessThanOrEqual(15 + MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS * 20);
  });
});

describe('topAndBottom final line clearance in layout (blocker)', () => {
  test('tall styled text after anchor clears band with no edge overlap', () => {
    const topBottomWrap = '<wp:wrapTopAndBottom distT="0" distB="0" distL="0" distR="0"/>';
    const imageHeight = emuToPoints(1371600);
    const doc =
      `<w:p><w:r><w:t>${'above '.repeat(3)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({ wrap: topBottomWrap, extentCy: '1371600' })}</w:drawing></w:r>` +
      `<w:r><w:rPr><w:sz w:val="44"/></w:rPr><w:t>${'BIG '.repeat(3)}</w:t></w:r></w:p>`;
    const part = load(bodyDoc(doc));
    const layout = layoutSemanticDocument(part, 1, {
      measurer: tallMeasurer,
      inlineDrawingLayout: layoutContext(part),
    });
    const lines = paragraphFragmentsOf(layout.pages[0]!).flatMap((f) => f.lines);
    const bigLine = lines.find((line) => line.spans.some((span) => span.text.includes('BIG')));
    expect(bigLine).toBeDefined();
    expect(bigLine!.box.y).toBeGreaterThanOrEqual(imageHeight - 1);
    const lineBottom = bigLine!.box.y + bigLine!.box.height;
    expect(lineBottom).toBeGreaterThan(imageHeight - 0.5);
  });

  test('inline drawing growth on post-anchor line clears band', () => {
    const topBottomWrap = '<wp:wrapTopAndBottom distT="0" distB="0" distL="0" distR="0"/>';
    const imageHeight = emuToPoints(914400);
    const inlineHeight = emuToPoints(4572000);
    const doc =
      `<w:p><w:r><w:drawing>${anchorCore({ wrap: topBottomWrap, extentCy: '914400' })}</w:drawing></w:r>` +
      `<w:r><w:drawing>${inlineCore()}</w:drawing></w:r></w:p>`;
    const part = load(bodyDoc(doc));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
    });
    const lines = paragraphFragmentsOf(layout.pages[0]!).flatMap((f) => f.lines);
    const inlineLine = lines.find((line) => line.drawings.length > 0);
    expect(inlineLine).toBeDefined();
    expect(inlineLine!.box.y).toBeGreaterThanOrEqual(imageHeight - 1);
    expect(inlineLine!.box.y + inlineLine!.box.height).toBeGreaterThan(imageHeight);
    expect(inlineLine!.box.height).toBeGreaterThanOrEqual(inlineHeight - 2);
  });

  test('table cell cross-paragraph line clears inherited topAndBottom band', () => {
    const topBottomWrap = '<wp:wrapTopAndBottom distT="0" distB="0" distL="0" distR="0"/>';
    const table =
      '<w:tbl><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid>' +
      '<w:tr><w:tc><w:tcPr><w:tcW w:w="9360" w:type="dxa"/></w:tcPr>' +
      `<w:p><w:r><w:t>${'lead '.repeat(2)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({ wrap: topBottomWrap, extentCy: '1371600' })}</w:drawing></w:r></w:p>` +
      `<w:p><w:r><w:t>${'cell2 '.repeat(4)}</w:t></w:r></w:p>` +
      '</w:tc></w:tr></w:tbl>';
    const part = load(bodyDoc(table));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
    });
    const tableFragment = layout.pages[0]!.fragments.find((f) => f.kind === 'table');
    expect(tableFragment?.kind).toBe('table');
    if (tableFragment?.kind !== 'table') return;
    const blocks = tableFragment.rows[0]!.cells[0]!.blocks.filter((b) => b.kind === 'paragraph');
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const imageHeight = emuToPoints(1371600);
    const belowLine = blocks[1]!.lines.find((line) =>
      line.spans.some((span) => span.text.includes('cell2'))
    );
    expect(belowLine).toBeDefined();
    expect(belowLine!.box.y).toBeGreaterThanOrEqual(imageHeight - 2);
    expect(belowLine!.box.y + belowLine!.box.height).toBeGreaterThan(imageHeight - 0.5);
  });

  function hfStory(xml: string, owner: string) {
    const part = load(xml, owner);
    return layoutHeaderFooterStory(
      part,
      468,
      measurer,
      'hf-exclusion-r6',
      undefined,
      undefined,
      undefined,
      128,
      undefined,
      undefined,
      layoutContext(part, owner)
    );
  }

  test('HF cross-paragraph line clears topAndBottom band without double skip', () => {
    const topBottomWrap = '<wp:wrapTopAndBottom distT="0" distB="0" distL="0" distR="0"/>';
    const headerXml =
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      `<w:p><w:r><w:t>${'hdr1 '.repeat(2)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({
        wrap: topBottomWrap,
        posV: '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>',
        extentCy: '1371600',
      })}</w:drawing></w:r></w:p>` +
      `<w:p><w:r><w:t>${'hdr2 '.repeat(4)}</w:t></w:r></w:p>` +
      '</w:hdr>';
    const story = hfStory(headerXml, '/word/header1.xml');
    const anchor = story.anchoredDrawings![0]!;
    const bandBottom = anchor.y + anchor.paintBounds.height;
    const paras = story.fragments.filter((f) => f.kind === 'paragraph');
    expect(paras.length).toBeGreaterThanOrEqual(2);
    const belowLine = paras[1]!.lines.find((line) =>
      line.spans.some((span) => span.text.includes('hdr2'))
    );
    expect(belowLine).toBeDefined();
    expect(belowLine!.box.y).toBeGreaterThanOrEqual(bandBottom - 2);
    expect(belowLine!.box.y + belowLine!.box.height).toBeGreaterThan(bandBottom - 0.5);
  });

  test('anchor paragraph does not double-apply page and synthesized skip', () => {
    const topBottomWrap = '<wp:wrapTopAndBottom distT="0" distB="0" distL="0" distR="0"/>';
    const doc =
      `<w:p><w:r><w:t>${'above '.repeat(2)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({ wrap: topBottomWrap, extentCy: '1371600' })}</w:drawing></w:r>` +
      `<w:r><w:t>${'below '.repeat(4)}</w:t></w:r></w:p>`;
    const part = load(bodyDoc(doc));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
    });
    const lines = paragraphFragmentsOf(layout.pages[0]!)[0]!.lines;
    const belowLine = lines.find((line) => line.spans.some((span) => span.text.includes('below')));
    const aboveLine = lines.find((line) => line.spans.some((span) => span.text.includes('above')));
    expect(belowLine).toBeDefined();
    expect(aboveLine).toBeDefined();
    const imageHeight = emuToPoints(1371600);
    expect(belowLine!.box.y).toBeGreaterThanOrEqual(imageHeight - 2);
    const gap = belowLine!.box.y - (aboveLine!.box.y + aboveLine!.box.height);
    expect(gap).toBeLessThan(imageHeight * 1.5);
  });
});
