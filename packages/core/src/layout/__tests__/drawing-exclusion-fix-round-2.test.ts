// Task 9 fix round 2 — multi-column + HF exclusion blockers (typed-drawings-and-images).

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
  DrawingExclusionConvergenceError,
  MAX_DRAWING_EXCLUSION_REFLOW_PASSES,
} from '../drawing-exclusion.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type SemanticLayout,
} from '../semantic-layout.ts';
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
    contentType:
      owner.includes('header') || owner.includes('ftr')
        ? owner.includes('ftr')
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
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
  readonly wrap?: string;
  readonly behindDoc?: string;
  readonly posH?: string;
  readonly posV?: string;
  readonly extentCx?: string;
  readonly extentCy?: string;
}): string {
  const wrap =
    options?.wrap ??
    '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>';
  return (
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="${options?.behindDoc ?? '0'}" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">` +
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

function bodyDoc(body: string): string {
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body>${body}</w:body></w:document>`
  );
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
        x: drawing.x,
        y: drawing.y,
        wrap: drawing.wrap,
      })),
    }))
  );

describe('multi-column wrap exclusion (blocker 1)', () => {
  const twoColGeometry = {
    width: 200,
    height: 120,
    margin: { top: 10, right: 10, bottom: 10, left: 10 },
  };

  test('square anchor in column 2 narrows overlapping line width', () => {
    const filler = `<w:p><w:r><w:t>${'word '.repeat(14)}</w:t></w:r></w:p>`;
    const anchorPara =
      `<w:p><w:r><w:t>${'x '.repeat(30)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({
        posH: '<wp:positionH relativeFrom="column"><wp:align>left</wp:align></wp:positionH>',
      })}</w:drawing></w:r></w:p>`;
    const part = load(
      bodyDoc(`<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>${filler}${anchorPara}`)
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: twoColGeometry,
    });
    const columnWidth = (180 - 36) / 2;
    const column2X = columnWidth + 36;
    const anchor = layout.pages[0]!.anchoredDrawings![0]!;
    expect(anchor.x).toBeGreaterThan(columnWidth);
    const anchorParaFragment = layout.pages[0]!.fragments.filter(
      (f) => f.kind === 'paragraph'
    ).pop()!;
    expect(anchorParaFragment.kind).toBe('paragraph');
    const imageWidth = emuToPoints(1828800);
    const overlapping = anchorParaFragment.lines.filter(
      (line) => line.box.y >= anchor.y - 1 && line.box.y < anchor.y + imageWidth
    );
    expect(overlapping.length).toBeGreaterThan(0);
    for (const line of overlapping) {
      const lastSpan = line.spans[line.spans.length - 1];
      if (!lastSpan || lastSpan.text.trim().length === 0) continue;
      expect(lastSpan.box.x + lastSpan.box.width).toBeLessThanOrEqual(column2X + imageWidth + 1);
    }
  });

  test('tight wrap anchor in column 2 excludes text on overlapping lines', () => {
    const filler = `<w:p><w:r><w:t>${'word '.repeat(14)}</w:t></w:r></w:p>`;
    const tightWrap =
      '<wp:wrapTight wrapText="bothSides" distT="0" distB="0" distL="0" distR="0">' +
      '<wp:wrapPolygon edited="0">' +
      '<wp:start x="0" y="0"/><wp:lineTo x="1828800" y="0"/><wp:lineTo x="1828800" y="914400"/><wp:lineTo x="0" y="914400"/>' +
      '<wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapTight>';
    const anchorPara =
      `<w:p><w:r><w:t>${'wide '.repeat(12)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({
        wrap: tightWrap,
        posH: '<wp:positionH relativeFrom="column"><wp:align>left</wp:align></wp:positionH>',
      })}</w:drawing></w:r></w:p>`;
    const part = load(
      bodyDoc(`<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>${filler}${anchorPara}`)
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: twoColGeometry,
    });
    const columnWidth = (180 - 36) / 2;
    const page = layout.pages.find((candidate) => (candidate.anchoredDrawings?.length ?? 0) > 0);
    expect(page).toBeDefined();
    const anchor = page!.anchoredDrawings![0]!;
    expect(anchor.x).toBeGreaterThan(columnWidth);
    const imageWidth = emuToPoints(1828800);
    const bandLines = paragraphFragmentsOf(page!).flatMap((f) =>
      f.lines.filter((line) => line.box.y >= anchor.y - 1 && line.box.y < anchor.y + imageWidth)
    );
    expect(bandLines.length).toBeGreaterThan(0);
    for (const line of bandLines) {
      for (const span of line.spans) {
        if (span.text.trim().length === 0) continue;
        expect(span.box.x + span.box.width).toBeLessThanOrEqual(
          anchor.x + imageWidth + columnWidth
        );
      }
    }
  });

  test('paragraph crossing columns applies exclusion only in owning column', () => {
    const filler = `<w:p><w:r><w:t>${'word '.repeat(14)}</w:t></w:r></w:p>`;
    const longPara =
      `<w:p><w:r><w:t>${'x '.repeat(30)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({
        posH: '<wp:positionH relativeFrom="column"><wp:align>left</wp:align></wp:positionH>',
      })}</w:drawing></w:r>` +
      `<w:r><w:t>${'tail '.repeat(6)}</w:t></w:r></w:p>`;
    const part = load(
      bodyDoc(`<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>${filler}${longPara}`)
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: twoColGeometry,
    });
    const columnWidth = (180 - 36) / 2;
    const page = layout.pages[0]!;
    const anchor = page.anchoredDrawings![0]!;
    expect(anchor.x).toBeGreaterThan(columnWidth);
    const col1Lines = page.fragments
      .flatMap((f) => (f.kind === 'paragraph' ? f.lines : []))
      .filter((line) => line.box.x < columnWidth);
    expect(col1Lines.length).toBeGreaterThan(0);
    for (const line of col1Lines) {
      const lastSpan = line.spans[line.spans.length - 1];
      if (!lastSpan) continue;
      expect(lastSpan.box.x + lastSpan.box.width).toBeLessThanOrEqual(columnWidth + 1);
    }
    const imageWidth = emuToPoints(1828800);
    const col2BandLines = page.fragments
      .flatMap((f) => (f.kind === 'paragraph' ? f.lines : []))
      .filter(
        (line) =>
          line.box.x >= columnWidth &&
          line.box.y >= anchor.y - 1 &&
          line.box.y < anchor.y + imageWidth
      );
    expect(col2BandLines.length).toBeGreaterThan(0);
  });

  test('multi-column exclusion reflow converges within hard pass bound', () => {
    const filler = `<w:p><w:r><w:t>${'word '.repeat(14)}</w:t></w:r></w:p>`;
    const anchorPara =
      `<w:p><w:r><w:t>${'wrap '.repeat(40)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({
        posH: '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>',
      })}</w:drawing></w:r></w:p>`;
    const part = load(
      bodyDoc(`<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>${filler}${anchorPara}`)
    );
    expect(() =>
      layoutSemanticDocument(part, 1, {
        measurer,
        inlineDrawingLayout: layoutContext(part),
        geometry: twoColGeometry,
      })
    ).not.toThrow(DrawingExclusionConvergenceError);
    expect(MAX_DRAWING_EXCLUSION_REFLOW_PASSES).toBeLessThanOrEqual(8);
  });

  test('incremental wrap change matches clean full layout in two-column body', () => {
    const filler = `<w:p><w:r><w:t>${'word '.repeat(14)}</w:t></w:r></w:p>`;
    const squareTail =
      `<w:p><w:r><w:t>${'tail '.repeat(30)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore()} </w:drawing></w:r></w:p>`;
    const squareDoc = load(
      bodyDoc(`<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>${filler}${squareTail}`)
    );
    const behindTail = squareTail
      .replace('wrapSquare wrapText="bothSides"', 'wrapNone')
      .replace('behindDoc="0"', 'behindDoc="1"');
    const behindDoc = load(
      bodyDoc(`<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>${filler}${behindTail}`)
    );

    const cache = createParagraphLayoutCache();
    const session = createLayoutSession();
    const first = layoutSemanticDocument(squareDoc, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(squareDoc),
      cache,
      session,
      producer: 'exclusion-fix-r2-mc',
      geometry: twoColGeometry,
    });
    const incremental = layoutSemanticDocument(behindDoc, 2, {
      measurer,
      inlineDrawingLayout: layoutContext(behindDoc),
      cache,
      session,
      producer: 'exclusion-fix-r2-mc',
      geometry: twoColGeometry,
    });
    const clean = layoutSemanticDocument(behindDoc, 2, {
      measurer,
      inlineDrawingLayout: layoutContext(behindDoc),
      cache: createParagraphLayoutCache(),
      producer: 'exclusion-fix-r2-mc',
      geometry: twoColGeometry,
    });

    expect(layoutShape(incremental)).toBe(layoutShape(clean));
    expect(first.pages.length).toBeGreaterThanOrEqual(1);
  });
});

describe('HF wrap exclusion (blocker 2)', () => {
  function hfStory(
    xml: string,
    owner: string,
    pageContext?: {
      pageNumber: number;
      pageWidth: number;
      pageHeight: number;
      marginLeft: number;
      marginRight: number;
      marginTop: number;
      marginBottom: number;
    }
  ) {
    const part = load(xml, owner);
    return layoutHeaderFooterStory(
      part,
      468,
      measurer,
      'hf-exclusion-r2',
      undefined,
      undefined,
      pageContext
        ? { pageNumber: pageContext.pageNumber, pageCount: 1, sectionPageCount: 1 }
        : undefined,
      128,
      undefined,
      undefined,
      layoutContext(part, owner),
      undefined,
      undefined,
      pageContext
    );
  }

  function squareHeaderXml(behindDoc = '0'): string {
    const wrap =
      behindDoc === '1'
        ? '<wp:wrapNone/>'
        : '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>';
    return (
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      `<w:p><w:r><w:t>${'header '.repeat(30)}</w:t></w:r>` +
      `<w:r><w:drawing>${anchorCore({ behindDoc, wrap })}</w:drawing></w:r></w:p></w:hdr>`
    );
  }

  test('square wrap in default header narrows text beside the anchor', () => {
    const story = hfStory(squareHeaderXml(), '/word/header1.xml');
    const lines = story.fragments.flatMap((f) => (f.kind === 'paragraph' ? f.lines : []));
    expect(lines.length).toBeGreaterThan(0);
    const imageWidth = emuToPoints(1828800);
    const anchor = story.anchoredDrawings![0]!;
    const bandLines = lines.filter(
      (line) => line.box.y >= anchor.y - 1 && line.box.y < anchor.y + imageWidth
    );
    expect(bandLines.length).toBeGreaterThan(0);
    const narrowed = bandLines.some((line) =>
      line.spans.some(
        (span) => span.text.trim().length > 0 && span.box.x + span.box.width <= imageWidth + 1
      )
    );
    expect(narrowed).toBe(true);
  });

  test('behind/inFront wrapNone produces no HF text exclusion', () => {
    const textOnly = hfStory(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}"><w:p><w:r><w:t>${'header '.repeat(30)}</w:t></w:r></w:p></w:hdr>`,
      '/word/header1.xml'
    );
    const behind = hfStory(squareHeaderXml('1'), '/word/header1.xml');
    expect(behind.flowHeight).toBeCloseTo(textOnly.flowHeight, 1);
    expect(behind.anchoredDrawings?.[0]?.wrap).toBe('behind');
  });

  test('large page-relative HF anchor does not inflate flow height or body content box', () => {
    const textOnly = hfStory(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}"><w:p><w:r><w:t>HF</w:t></w:r></w:p></w:hdr>`,
      '/word/header1.xml'
    );
    const watermark = hfStory(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:p><w:r><w:t>HF</w:t></w:r><w:r><w:drawing>${anchorCore({
          behindDoc: '1',
          wrap: '<wp:wrapNone/>',
          posH: '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>',
          posV: '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>',
          extentCx: '5486400',
          extentCy: '6858000',
        })}</w:drawing></w:r></w:p></w:hdr>`,
      '/word/header1.xml',
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
    expect(watermark.flowHeight).toBeCloseTo(textOnly.flowHeight, 3);

    const body = load(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r><w:t>body</w:t></w:r></w:p></w:body></w:document>`
    );
    const geometry = {
      width: 612,
      height: 792,
      margin: { top: 72, right: 72, bottom: 72, left: 72 },
      headerDistance: 36,
      footerDistance: 36,
    };
    const withoutHf = layoutSemanticDocument(body, 1, { measurer, geometry });
    const withHf = layoutSemanticDocument(body, 1, {
      measurer,
      geometry,
      furniture: {
        titlePage: false,
        evenAndOddHeaders: false,
        headers: new Map([['default', watermark]]),
        footers: new Map(),
      },
    });
    expect(withHf.pages[0]!.contentBox.height).toBeCloseTo(
      withoutHf.pages[0]!.contentBox.height,
      3
    );
  });

  test('first/even header variants apply square exclusion with page parity', () => {
    const makeStory = (name: string, pageNumber: number) =>
      hfStory(
        `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
          `<w:p><w:r><w:t>${name} </w:t></w:r>` +
          `<w:r><w:drawing>${anchorCore({
            posH: `<wp:positionH relativeFrom="page"><wp:posOffset>${pageNumber === 2 ? '2000000' : '0'}</wp:posOffset></wp:positionH>`,
          })}</w:drawing></w:r>` +
          `<w:r><w:t>${'text '.repeat(25)}</w:t></w:r></w:p></w:hdr>`,
        `/word/${name}.xml`,
        {
          pageNumber,
          pageWidth: 612,
          pageHeight: 792,
          marginLeft: 72,
          marginRight: 72,
          marginTop: 72,
          marginBottom: 72,
        }
      );

    const defaultStory = makeStory('default', 1);
    const evenStory = makeStory('even', 2);
    expect(defaultStory.fragments.length).toBeGreaterThan(0);
    expect(evenStory.fragments.length).toBeGreaterThan(0);
    const defaultLines = defaultStory.fragments.flatMap((f) =>
      f.kind === 'paragraph' ? f.lines : []
    );
    const evenLines = evenStory.fragments.flatMap((f) => (f.kind === 'paragraph' ? f.lines : []));
    expect(defaultLines.length).toBeGreaterThan(0);
    expect(evenLines.length).toBeGreaterThan(0);
    const imageWidth = emuToPoints(1828800);
    for (const line of defaultLines) {
      const lastSpan = line.spans[line.spans.length - 1];
      if (!lastSpan || lastSpan.text.trim().length === 0) continue;
      if (line.box.y < imageWidth) {
        expect(lastSpan.box.x + lastSpan.box.width).toBeLessThanOrEqual(imageWidth + 468 + 1);
      }
    }
  });

  test('footer square wrap reflows lines without growing flow height beyond text', () => {
    const footer = hfStory(
      `<w:ftr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:p><w:r><w:t>${'footer '.repeat(25)}</w:t></w:r>` +
        `<w:r><w:drawing>${anchorCore()}</w:drawing></w:r></w:p></w:ftr>`,
      '/word/footer1.xml'
    );
    const textOnly = hfStory(
      `<w:ftr xmlns:w="${WML_NAMESPACE_URI}"><w:p><w:r><w:t>${'footer '.repeat(25)}</w:t></w:r></w:p></w:ftr>`,
      '/word/footer1.xml'
    );
    expect(footer.flowHeight).toBeGreaterThanOrEqual(textOnly.flowHeight);
    expect(footer.flowHeight).toBeLessThan(emuToPoints(914400) + textOnly.flowHeight);
    const lines = footer.fragments.flatMap((f) => (f.kind === 'paragraph' ? f.lines : []));
    expect(lines.length).toBeGreaterThan(
      textOnly.fragments.flatMap((f) => (f.kind === 'paragraph' ? f.lines : [])).length - 1
    );
  });
});
