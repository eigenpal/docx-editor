// Task 9 fix round 5 — topAndBottom cross-paragraph propagation (typed-drawings-and-images).

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
  collectExclusionZonesFromDrawings,
  filterExclusionZonesForParagraphOrder,
} from '../drawing-exclusion.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
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

function anchorCore(options?: {
  readonly id?: string;
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
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">` +
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

const topBottomWrap = '<wp:wrapTopAndBottom distT="0" distB="0" distL="0" distR="0"/>';

describe('topAndBottom page collection includes vertical bands (blocker 1)', () => {
  test('collectExclusionZonesFromDrawings retains topAndBottom zones', () => {
    const doc =
      `<w:p><w:r><w:t>lead</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({ wrap: topBottomWrap })}</w:drawing></w:r></w:p>`;
    const part = load(bodyDoc(doc));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
    });
    const drawing = layout.pages[0]!.anchoredDrawings![0]!;
    const zones = collectExclusionZonesFromDrawings([drawing], layoutContext(part), 0, 468);
    expect(zones.length).toBe(1);
    expect(zones[0]!.input.mode).toBe('topAndBottom');
  });

  test('document-order filter keeps earlier anchor zones for later paragraphs', () => {
    const doc =
      `<w:p><w:r><w:t>before</w:t></w:r></w:p>` +
      `<w:p><w:r><w:drawing>${anchorCore({ wrap: topBottomWrap, id: '1' })}</w:drawing></w:r></w:p>` +
      `<w:p><w:r><w:t>later</w:t></w:r></w:p>`;
    const part = load(bodyDoc(doc));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
    });
    const drawing = layout.pages[0]!.anchoredDrawings![0]!;
    const zones = collectExclusionZonesFromDrawings([drawing], layoutContext(part), 0, 468);
    const orderOf = (id: string) => {
      const fragments = paragraphFragmentsOf(layout.pages[0]!);
      const index = fragments.findIndex((f) => f.paragraphId === id);
      return index >= 0 ? index : undefined;
    };
    const anchorOrder = orderOf(drawing.anchorParagraphId);
    expect(anchorOrder).toBe(1);
    const filtered = filterExclusionZonesForParagraphOrder(zones, 2, orderOf);
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.input.mode).toBe('topAndBottom');
    const blocked = filterExclusionZonesForParagraphOrder(zones, 0, orderOf);
    expect(blocked.length).toBe(0);
  });
});

function bandBottomOf(layout: ReturnType<typeof layoutSemanticDocument>): number {
  const drawing = layout.pages
    .flatMap((p) => p.anchoredDrawings ?? [])
    .find((d) => d.wrap === 'topAndBottom');
  expect(drawing).toBeDefined();
  return drawing!.y + drawing!.paintBounds.height;
}

describe('topAndBottom body cross-paragraph skip (blocker 2)', () => {
  test('following paragraph lines clear the vertical band', () => {
    const anchorPara =
      `<w:p><w:r><w:drawing>${anchorCore({ wrap: topBottomWrap, extentCy: '1371600' })}</w:drawing></w:r>` +
      `<w:r><w:t>${'below '.repeat(2)}</w:t></w:r></w:p>`;
    const followerPara = `<w:p><w:r><w:t>${'follow '.repeat(4)}</w:t></w:r></w:p>`;
    const part = load(bodyDoc(anchorPara + followerPara));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
    });
    const bandBottom = bandBottomOf(layout);
    const fragments = paragraphFragmentsOf(layout.pages[0]!);
    expect(fragments.length).toBeGreaterThanOrEqual(2);
    const followerLine = fragments[1]!.lines.find((line) =>
      line.spans.some((span) => span.text.includes('follow'))
    );
    expect(followerLine).toBeDefined();
    expect(followerLine!.box.y).toBeGreaterThanOrEqual(bandBottom - 2);
  });

  test('anchor paragraph does not double-apply topAndBottom skip', () => {
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

describe('topAndBottom table and HF cross-paragraph skip (blocker 3)', () => {
  test('second paragraph in same table cell clears the band', () => {
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
    const cell = tableFragment.rows[0]!.cells[0]!;
    const blocks = cell.blocks.filter((b) => b.kind === 'paragraph');
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const bandBottom = bandBottomOf(layout);
    const secondLines = blocks[1]!.lines;
    const secondLine = secondLines.find((line) =>
      line.spans.some((span) => span.text.includes('cell2'))
    );
    expect(secondLine).toBeDefined();
    expect(secondLine!.box.y).toBeGreaterThanOrEqual(bandBottom - 2);
  });

  function hfStory(xml: string, owner: string) {
    const part = load(xml, owner);
    return layoutHeaderFooterStory(
      part,
      468,
      measurer,
      'hf-exclusion-r5',
      undefined,
      undefined,
      undefined,
      128,
      undefined,
      undefined,
      layoutContext(part, owner)
    );
  }

  test('following header paragraph clears the band', () => {
    const headerXml =
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      `<w:p><w:r><w:t>${'hdr1 '.repeat(2)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({ wrap: topBottomWrap, extentCy: '1371600' })}</w:drawing></w:r></w:p>` +
      `<w:p><w:r><w:t>${'hdr2 '.repeat(4)}</w:t></w:r></w:p>` +
      '</w:hdr>';
    const story = hfStory(headerXml, '/word/header1.xml');
    const anchor = story.anchoredDrawings![0]!;
    const bandBottom = anchor.y + anchor.paintBounds.height;
    const paras = story.fragments.filter((f) => f.kind === 'paragraph');
    expect(paras.length).toBeGreaterThanOrEqual(2);
    const secondLine = paras[1]!.lines.find((line) =>
      line.spans.some((span) => span.text.includes('hdr2'))
    );
    expect(secondLine).toBeDefined();
    expect(secondLine!.box.y).toBeGreaterThanOrEqual(bandBottom - 2);
  });
});

describe('topAndBottom page continuation (blocker 4)', () => {
  test('paragraph continuation on next page after topAndBottom anchor starts below band', () => {
    const imageHeight = emuToPoints(1371600);
    const filler = `<w:p><w:r><w:t>${'fill '.repeat(120)}</w:t></w:r></w:p>`;
    const anchorPara =
      `<w:p><w:r><w:t>${'anchor '.repeat(2)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({ wrap: topBottomWrap, extentCy: '1371600' })}</w:drawing></w:r>` +
      `<w:r><w:t>${'tail '.repeat(80)}</w:t></w:r></w:p>`;
    const part = load(bodyDoc(filler + anchorPara));
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
    const anchorPageIndex = layout.pages.findIndex((page) =>
      page.anchoredDrawings?.some((d) => d.wrap === 'topAndBottom')
    );
    expect(anchorPageIndex).toBeGreaterThanOrEqual(0);
    const anchorPage = layout.pages[anchorPageIndex]!;
    const tailSpansOnAnchor = paragraphFragmentsOf(anchorPage)
      .flatMap((f) => f.lines)
      .flatMap((l) => l.spans)
      .filter((s) => s.text.includes('tail'));
    const continuationPage = layout.pages[anchorPageIndex + 1];
    const tailSpansOnContinuation = continuationPage
      ? paragraphFragmentsOf(continuationPage)
          .flatMap((f) => f.lines)
          .flatMap((l) => l.spans)
          .filter((s) => s.text.includes('tail'))
      : [];
    expect(tailSpansOnAnchor.length + tailSpansOnContinuation.length).toBeGreaterThan(0);
    if (continuationPage && tailSpansOnContinuation.length > 0) {
      for (const span of tailSpansOnContinuation) {
        expect(span.box.y).toBeGreaterThanOrEqual(0);
      }
    }
    const belowOnAnchorPage = tailSpansOnAnchor.filter((s) => {
      const line = paragraphFragmentsOf(anchorPage)
        .flatMap((f) => f.lines)
        .find((l) => l.spans.includes(s));
      return line && line.box.y >= imageHeight - 2;
    });
    if (tailSpansOnAnchor.length > 0) {
      expect(belowOnAnchorPage.length).toBeGreaterThan(0);
    }
  });
});
