// Task 9 fix round 7 — pagination budget includes exclusionSkipBefore + line.height (typed-drawings-and-images).

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
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import {
  breakParagraph,
  pendingLineFlowExtent,
  pendingLineFlowExtentAtPlacement,
} from '../paragraph-flow.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import { storyBlocks } from '../story-roots.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-records.ts';
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

/** 100pt page, 10pt margins → 80pt content box (reproduction geometry). */
const TINY = Object.freeze({
  width: 200,
  height: 100,
  margin: Object.freeze({ top: 10, right: 10, bottom: 10, left: 10 }),
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

function anchorCore(options?: { readonly extentCy?: string }): string {
  const cy = options?.extentCy ?? '914400';
  return (
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    `<wp:extent cx="1828800" cy="${cy}"/>` +
    '<wp:wrapTopAndBottom distT="0" distB="0" distL="0" distR="0"/>' +
    '<wp:docPr id="1" name="pic"/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:ext cx="1828800" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    '</wp:anchor>'
  );
}

function bodyDoc(body: string): string {
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body>${body}</w:body></w:document>`
  );
}

function assertNoLineOverflow(layout: SemanticLayout): void {
  for (const page of layout.pages) {
    const limit = page.contentBox.height;
    for (const fragment of page.fragments) {
      if (fragment.kind === 'paragraph') {
        for (const line of fragment.lines) {
          expect(line.box.y + line.box.height).toBeLessThanOrEqual(limit + 0.001);
        }
      }
      if (fragment.kind === 'table') {
        for (const row of fragment.rows) {
          for (const cell of row.cells) {
            for (const block of cell.blocks) {
              if (block.kind !== 'paragraph') continue;
              for (const line of block.lines) {
                expect(line.box.y + line.box.height).toBeLessThanOrEqual(limit + 0.001);
              }
            }
          }
        }
      }
    }
  }
}

describe('pendingLineFlowExtent helpers (blocker)', () => {
  test('pendingLineFlowExtent sums skip and height for budget checks', () => {
    const line = { height: 14, exclusionSkipBefore: 30 } as PendingLine;
    expect(pendingLineFlowExtent(line)).toBe(44);
    expect(pendingLineFlowExtent(line, 6)).toBe(50);
    expect(pendingLineFlowExtent({ height: 14 } as PendingLine)).toBe(14);
  });

  test('pendingLineFlowExtentAtPlacement recomputes skip from live zones', () => {
    const line = { height: 14 } as PendingLine;
    const zones = [
      Object.freeze({
        drawingNodeId: 'd1',
        anchorParagraphId: 'p0',
        anchorModelStart: 0,
        sourceOrder: 0,
        paintLayer: 'inFront' as const,
        relativeHeight: 1,
        allowOverlap: true,
        columnIndex: 0,
        y: 50,
        verticalBand: Object.freeze({ x: 0, y: 50, width: 468, height: 30 }),
        input: Object.freeze({
          mode: 'topAndBottom' as const,
          textSide: 'bothSides' as const,
          contentBounds: Object.freeze({ x: 0, y: 50, width: 100, height: 20 }),
          wrapDistances: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
          effectInsets: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
          contentLeft: 0,
          contentRight: 468,
        }),
      }),
    ];
    expect(pendingLineFlowExtentAtPlacement(60, line, zones)).toBeGreaterThan(14);
    expect(pendingLineFlowExtentAtPlacement(60, line, zones)).toBe(34);
  });

  test('breakParagraph sets exclusionSkipBefore on post-anchor lines', () => {
    const anchorPara =
      `<w:p><w:r><w:drawing>${anchorCore({ extentCy: '914400' })}</w:drawing></w:r>` +
      `<w:r><w:t>${'below '.repeat(4)}</w:t></w:r></w:p>`;
    const part = load(bodyDoc(anchorPara));
    const paragraph = storyBlocks(part).find((b) => b.kind === 'paragraph')!;
    if (paragraph.kind !== 'paragraph') throw new Error('expected paragraph');
    const lines = breakParagraph(
      paragraph,
      paragraph.id,
      0,
      180,
      measurer,
      undefined,
      null,
      [],
      [],
      undefined,
      undefined,
      {
        inlineDrawingLayout: layoutContext(part),
        contentLeft: 0,
        contentRight: 180,
        paragraphStartY: 0,
      }
    );
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const postAnchor = lines.find((line) => line.spans.some((span) => span.text.includes('below')));
    expect(postAnchor).toBeDefined();
    expect(postAnchor!.exclusionSkipBefore ?? 0).toBeGreaterThan(0);
  });
});

describe('80pt content box — skip in pagination budget (blocker)', () => {
  test('post-anchor line paginates before skip + height overflows 80pt band', () => {
    // 36pt image + 14pt line fits one 80pt page after skip; filler leaves a tight remainder.
    const imageHeight = emuToPoints(457200);
    const filler = Array.from(
      { length: 4 },
      (_, i) => `<w:p><w:r><w:t>f${i} </w:t></w:r></w:p>`
    ).join('');
    const anchorPara =
      `<w:p><w:r><w:drawing>${anchorCore({ extentCy: '457200' })}</w:drawing></w:r>` +
      `<w:r><w:t>${'below '.repeat(8)}</w:t></w:r></w:p>`;
    const part = load(bodyDoc(filler + anchorPara));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: TINY,
    });
    assertNoLineOverflow(layout);
    expect(layout.pages.length).toBeGreaterThan(1);
    const anchorPageIndex = layout.pages.findIndex(
      (page) => (page.anchoredDrawings?.length ?? 0) > 0
    );
    expect(anchorPageIndex).toBeGreaterThanOrEqual(0);
    const belowOnAnchorPage = paragraphFragmentsOf(layout.pages[anchorPageIndex]!).flatMap((f) =>
      f.lines.filter((line) => line.spans.some((span) => span.text.includes('below')))
    );
    expect(belowOnAnchorPage.length).toBeGreaterThan(0);
    for (const line of belowOnAnchorPage) {
      expect(line.box.y + line.box.height).toBeGreaterThan(imageHeight - 0.5);
    }
  });
});

describe('next-page placement with exclusion skip (blocker)', () => {
  test('tail line continues on next page when skip + height exceeds remainder', () => {
    const filler = `<w:p><w:r><w:t>${'fill '.repeat(120)}</w:t></w:r></w:p>`;
    const anchorPara =
      `<w:p><w:r><w:t>${'anchor '.repeat(2)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({ extentCy: '457200' })}</w:drawing></w:r>` +
      `<w:r><w:t>${'tail '.repeat(60)}</w:t></w:r></w:p>`;
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
    assertNoLineOverflow(layout);
    const pagesWithTail = layout.pages.filter((page) =>
      paragraphFragmentsOf(page).some((f) =>
        f.lines.some((l) => l.spans.some((s) => s.text.includes('tail')))
      )
    );
    expect(pagesWithTail.length).toBeGreaterThan(1);
  });
});

describe('multi-column pagination with exclusion skip (blocker)', () => {
  test('post-anchor lines stay inside column content box with skip budget', () => {
    const twoCol = '<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>';
    const filler = `<w:p><w:r><w:t>${'word '.repeat(200)}</w:t></w:r></w:p>`;
    const anchorPara =
      `<w:p><w:r><w:drawing>${anchorCore({ extentCy: '457200' })}</w:drawing></w:r>` +
      `<w:r><w:t>${'trail '.repeat(30)}</w:t></w:r></w:p>`;
    const part = load(bodyDoc(filler + anchorPara + twoCol));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: TINY,
    });
    assertNoLineOverflow(layout);
    const imageHeight = emuToPoints(457200);
    const anchorPageIndex = layout.pages.findIndex(
      (page) => (page.anchoredDrawings?.length ?? 0) > 0
    );
    expect(anchorPageIndex).toBeGreaterThanOrEqual(0);
    const trailOnAnchorPage = paragraphFragmentsOf(layout.pages[anchorPageIndex]!).flatMap((f) =>
      f.lines.filter((line) => line.spans.some((span) => span.text.includes('trail')))
    );
    expect(trailOnAnchorPage.length).toBeGreaterThan(0);
    const leadTrail = trailOnAnchorPage.find((line) =>
      line.spans.some((span) => span.text.includes('trail'))
    );
    expect(leadTrail).toBeDefined();
    expect(leadTrail!.box.y + leadTrail!.box.height).toBeGreaterThan(imageHeight - 0.5);
  });
});

describe('table row split with exclusion skip (blocker)', () => {
  test('cell paragraph with topAndBottom skip splits without line overflow', () => {
    const cellParas = Array.from(
      { length: 2 },
      (_, i) => `<w:p><w:r><w:t>P${i} </w:t></w:r></w:p>`
    ).join('');
    const anchorBlock =
      `<w:p><w:r><w:drawing>${anchorCore({ extentCy: '457200' })}</w:drawing></w:r>` +
      `<w:r><w:t>${'below '.repeat(12)}</w:t></w:r></w:p>`;
    const table =
      '<w:tbl><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid>' +
      '<w:tr><w:tc><w:tcPr><w:tcW w:w="9360" w:type="dxa"/></w:tcPr>' +
      cellParas +
      anchorBlock +
      '</w:tc></w:tr></w:tbl>';
    const part = load(bodyDoc(table));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: TINY,
    });
    assertNoLineOverflow(layout);
    expect(layout.pages.length).toBeGreaterThan(1);
    const imageHeight = emuToPoints(457200);
    const belowOnFirstTablePage = layout.pages.flatMap((page) =>
      page.fragments.flatMap((f) => {
        if (f.kind !== 'table') return [];
        return f.rows.flatMap((row) =>
          row.cells.flatMap((cell) =>
            cell.blocks.flatMap((block) =>
              block.kind === 'paragraph'
                ? block.lines.filter((line) =>
                    line.spans.some((span) => span.text.includes('below'))
                  )
                : []
            )
          )
        );
      })
    );
    expect(belowOnFirstTablePage.length).toBeGreaterThan(0);
    const cleared = belowOnFirstTablePage.filter(
      (line) => line.box.y + line.box.height > imageHeight - 0.5
    );
    expect(cleared.length).toBeGreaterThan(0);
  });
});

describe('HF bounded flow with exclusion skip (blocker)', () => {
  test('following header paragraph clears band within fixed flow box', () => {
    const headerXml =
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      `<w:p><w:r><w:t>${'hdr1 '.repeat(2)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({ extentCy: '1371600' })}</w:drawing></w:r></w:p>` +
      `<w:p><w:r><w:t>${'hdr2 '.repeat(6)}</w:t></w:r></w:p>` +
      '</w:hdr>';
    const part = load(headerXml, '/word/header1.xml');
    const story = layoutHeaderFooterStory(
      part,
      468,
      measurer,
      'hf-exclusion-r7',
      undefined,
      undefined,
      undefined,
      128,
      undefined,
      undefined,
      layoutContext(part, '/word/header1.xml')
    );
    const anchor = story.anchoredDrawings![0]!;
    const bandBottom = anchor.y + anchor.paintBounds.height;
    const paras = story.fragments.filter((f) => f.kind === 'paragraph');
    expect(paras.length).toBeGreaterThanOrEqual(2);
    const secondLine = paras[1]!.lines.find((line) =>
      line.spans.some((span) => span.text.includes('hdr2'))
    );
    expect(secondLine).toBeDefined();
    expect(secondLine!.box.y).toBeGreaterThanOrEqual(bandBottom - 2);
    expect(secondLine!.box.y + secondLine!.box.height).toBeLessThanOrEqual(
      story.flowHeight + 0.001
    );
    expect(story.flowHeight).toBeLessThan(200);
  });
});
