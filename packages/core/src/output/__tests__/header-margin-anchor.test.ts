import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  createFixedMeasurer,
  hitTestSheet,
  enumerateDocumentSections,
  geometryOfSection,
  layoutSemanticDocument,
  type PageFurniture,
  type SemanticLayout,
} from '../../layout/index.ts';
import { layoutHeaderFooterStory, type HeaderFooterStoryLayout } from '../../layout/hf-layout.ts';
import { furnitureDrawingExclusionsForPage } from '../../layout/furniture-drawing-exclusion.ts';
import { headerFooterAnchoredDrawingOrigin } from '../../layout/header-footer-drawing-origin.ts';
import type { InlineDrawingLayoutContext } from '../../layout/drawing-layout.ts';
import {
  readOoxmlPackage,
  resolveHeaderFooterPartsBySection,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import {
  load,
  layoutContext,
  squareAnchorAtLeft,
} from '../../layout/__tests__/anchored-drawing-test-fixtures.ts';
import { mockReadyImageResource } from '../../store/__tests__/drawing-ready-fixture.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

const measurer = createFixedMeasurer(6, 14);

const OFF_H_EMU = -930_275; // -73.25pt
const OFF_V_EMU = -989_965; // -77.95pt
const SIZE_EMU = 809_625; //  63.75pt

type HorizontalFrame = 'character' | 'margin' | 'page';
type VerticalFrame =
  | 'bottomMargin'
  | 'insideMargin'
  | 'line'
  | 'margin'
  | 'outsideMargin'
  | 'page'
  | 'paragraph'
  | 'topMargin';

interface AnchorOptions {
  readonly horizontalFrame?: HorizontalFrame;
  readonly verticalFrame?: VerticalFrame;
  readonly horizontalOffsetEmu?: number;
  readonly verticalOffsetEmu?: number;
  readonly verticalAlign?: 'bottom' | 'center' | 'top';
  readonly storyLineCount?: number;
  readonly topAndBottom?: boolean;
  readonly storyDistance?: number;
  readonly inTable?: boolean;
  readonly secondPage?: boolean;
}

function logoDrawing(options: AnchorOptions = {}): string {
  const horizontalFrame = options.horizontalFrame ?? 'margin';
  const verticalFrame = options.verticalFrame ?? 'margin';
  const horizontalOffsetEmu = options.horizontalOffsetEmu ?? OFF_H_EMU;
  const verticalOffsetEmu = options.verticalOffsetEmu ?? OFF_V_EMU;
  const verticalPosition = options.verticalAlign
    ? `<wp:align>${options.verticalAlign}</wp:align>`
    : `<wp:posOffset>${verticalOffsetEmu}</wp:posOffset>`;
  return (
    '<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0"' +
    ' relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="${horizontalFrame}"><wp:posOffset>${horizontalOffsetEmu}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="${verticalFrame}">${verticalPosition}</wp:positionV>` +
    `<wp:extent cx="${SIZE_EMU}" cy="${SIZE_EMU}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    (options.topAndBottom ? '<wp:wrapTopAndBottom/>' : '<wp:wrapSquare wrapText="bothSides"/>') +
    '<wp:docPr id="1" name="logo"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${SIZE_EMU}" cy="${SIZE_EMU}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></wps:spPr>' +
    '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>'
  );
}

function storyDoc(kind: 'header' | 'footer', options: AnchorOptions = {}): Uint8Array {
  const ns = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}"`;
  const lineCount = options.storyLineCount ?? 3;
  const trailingParagraphs =
    lineCount === 3
      ? '<w:p><w:r><w:t>Address line</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Tel line</w:t></w:r></w:p>'
      : Array.from(
          { length: Math.max(0, lineCount - 1) },
          (_, index) => `<w:p><w:r><w:t>Story line ${index + 2}</w:t></w:r></w:p>`
        ).join('');
  const paragraphs =
    '<w:p><w:r><w:t>Company Name Co., Ltd.</w:t></w:r>' +
    `<w:r>${logoDrawing(options)}</w:r></w:p>` +
    trailingParagraphs;
  const storyParagraph = options.inTable
    ? `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>${paragraphs}</w:tc></w:tr></w:tbl>`
    : paragraphs;
  const partName = `${kind}1.xml`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        `<Override PartName="/word/${partName}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>` +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/${kind}" Target="${partName}"/></Relationships>`
    ),
    [`word/${partName}`]: strToU8(
      `<w:${kind === 'header' ? 'hdr' : 'ftr'} ${ns}>${storyParagraph}</w:${kind === 'header' ? 'hdr' : 'ftr'}>`
    ),
    'word/document.xml': strToU8(
      `<w:document ${ns}><w:body><w:p><w:r><w:t>body text</w:t></w:r></w:p>` +
        (options.secondPage
          ? '<w:p><w:r><w:br w:type="page"/><w:t>page two</w:t></w:r></w:p>'
          : '') +
        `<w:sectPr><w:${kind}Reference w:type="default" r:id="rId1"/>` +
        '<w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1560" w:right="1700" w:bottom="2694" w:left="1701" w:header="851" w:footer="0"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

function openPackage(bytes: Uint8Array): OoxmlPackage {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

function drawingLayoutFor(part: OoxmlPart): InlineDrawingLayoutContext {
  const atomProjections = indexInlineDrawingProjectionsInPart(part);
  const ready = mockReadyImageResource({
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  });
  return {
    ownerPartName: part.name,
    projectionForAtom: (atomId) => atomProjections.get(atomId) ?? null,
    project: (node) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, {
        ownerPartName: part.name,
        limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
      }),
    resourceOf: () => ready,
  };
}

function furnitureWithDrawings(
  pkg: OoxmlPackage,
  part: OoxmlPart,
  storyDistance?: number
): readonly (PageFurniture | undefined)[] {
  const sections = enumerateDocumentSections(part);
  const bySection = resolveHeaderFooterPartsBySection(pkg);
  return sections.map((section, index) => {
    const parts = bySection[index];
    if (!parts || (parts.headers.size === 0 && parts.footers.size === 0)) return undefined;
    const geometry = geometryOfSection(section.properties);
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    const pageContext = {
      pageNumber: 1,
      ...(storyDistance === undefined ? {} : { storyDistance }),
      pageWidth: geometry.width,
      pageHeight: geometry.height,
      marginLeft: geometry.margin.left,
      marginRight: geometry.margin.right,
      marginTop: geometry.margin.top,
      marginBottom: geometry.margin.bottom,
    };
    const stampRId = (story: HeaderFooterStoryLayout, rId: string): HeaderFooterStoryLayout => ({
      ...story,
      rId,
      withPageContext: (ctx) => stampRId(story.withPageContext(ctx), rId),
    });
    const mapStories = (source: typeof parts.headers) => {
      const laid = new Map();
      for (const [variant, hfPart] of source)
        laid.set(
          variant,
          stampRId(
            layoutHeaderFooterStory(
              hfPart,
              width,
              measurer,
              'test',
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              drawingLayoutFor(hfPart),
              undefined,
              undefined,
              pageContext,
              undefined,
              // Word 2013 mode: before it, header text does not wrap around header objects.
              { compatibilityMode: 15 }
            ),
            'rId1'
          )
        );
      return laid;
    };
    return {
      titlePage: parts.titlePage,
      evenAndOddHeaders: parts.evenAndOddHeaders,
      headers: mapStories(parts.headers),
      footers: mapStories(parts.footers),
    };
  });
}

function layoutHeaderDoc(options: AnchorOptions = {}): SemanticLayout {
  return layoutStoryDoc('header', options);
}

function layoutStoryDoc(kind: 'header' | 'footer', options: AnchorOptions = {}): SemanticLayout {
  const pkg = openPackage(storyDoc(kind, options));
  const part = pkg.parts.get(pkg.mainDocumentPart)!;
  return layoutSemanticDocument(part, 1, {
    measurer,
    producer: 'test',
    sectionFurniture: furnitureWithDrawings(pkg, part, options.storyDistance),
  });
}

function paintedPosition(layout: SemanticLayout): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const element = container.querySelector<HTMLElement>('.docx-drawing-layer-front > *');
  if (!element) throw new Error('expected one painted anchored drawing');
  const story = element.closest<HTMLElement>('[data-docx-hf]');
  return {
    x: parseFloat(element.style.left) + (story ? parseFloat(story.style.left) : 0),
    y: parseFloat(element.style.top) + (story ? parseFloat(story.style.top) : 0),
    width: parseFloat(element.style.width),
    height: parseFloat(element.style.height),
  };
}

describe('header anchor relativeFrom="margin"', () => {
  test('resolves against the content box, not the story box', () => {
    const layout = layoutHeaderDoc();
    const page = layout.pages[0]!;
    const story = page.header!;
    const drawing = story.anchoredDrawings![0]!;
    const sheetY = story.box.y + drawing.paintBounds.y;
    const sheetX = story.box.x + drawing.paintBounds.x;

    expect(sheetY).toBeCloseTo(page.contentBox.y - 77.95, 2);
    expect(sheetX).toBeCloseTo(page.contentBox.x - 73.25, 2);
  });

  test('paints the standalone negative-offset reproduction at the content-margin position', () => {
    const layout = layoutHeaderDoc();
    const page = layout.pages[0]!;
    const position = paintedPosition(layout);

    expect(position.y).toBeCloseTo(page.contentBox.y - 77.95, 2);
    expect(position.x).toBeCloseTo(page.contentBox.x - 73.25, 2);
  });

  test('rebases only the margin axis when horizontal and vertical frames differ', () => {
    const horizontalPage = layoutHeaderDoc({
      horizontalFrame: 'page',
      horizontalOffsetEmu: 127_000,
    });
    const horizontalPagePosition = paintedPosition(horizontalPage);
    expect(horizontalPagePosition.x).toBeCloseTo(10, 2);
    expect(horizontalPagePosition.y).toBeCloseTo(horizontalPage.pages[0]!.contentBox.y - 77.95, 2);

    const verticalPage = layoutHeaderDoc({
      verticalFrame: 'page',
      verticalOffsetEmu: 127_000,
    });
    const verticalPagePosition = paintedPosition(verticalPage);
    expect(verticalPagePosition.x).toBeCloseTo(verticalPage.pages[0]!.contentBox.x - 73.25, 2);
    expect(verticalPagePosition.y).toBeCloseTo(10, 2);
  });

  test('clips a stronger negative offset at the physical sheet edge after rebasing', () => {
    const layout = layoutHeaderDoc({
      horizontalOffsetEmu: 0,
      verticalOffsetEmu: -1_143_000,
    });
    const page = layout.pages[0]!;
    const position = paintedPosition(layout);
    const unclippedTop = page.contentBox.y - 90;

    expect(unclippedTop).toBeLessThan(0);
    expect(position.y).toBeCloseTo(0, 5);
    expect(position.height).toBeCloseTo(63.75 + unclippedTop, 5);
  });

  test('computes wrap exclusions at the rebased margin position', () => {
    const layout = layoutHeaderDoc({
      horizontalOffsetEmu: 0,
      verticalOffsetEmu: -254_000,
    });
    const story = layout.pages[0]!.header!;
    const drawing = story.anchoredDrawings![0]!;
    const laterLines = story.fragments
      .slice(1)
      .flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []));
    const overlappingLines = laterLines.filter(
      (line) => line.box.y >= drawing.y && line.box.y < drawing.y + drawing.height
    );

    expect(drawing.y).toBeGreaterThan(0);
    expect(overlappingLines.length).toBeGreaterThan(0);
    for (const line of overlappingLines) expect(line.contentX).toBeGreaterThanOrEqual(63.75);
  });
});

describe('margin alignment uses the effective content-box extent', () => {
  test.each([
    ['header', 'center', 3],
    ['header', 'bottom', 3],
    ['footer', 'center', 12],
    ['footer', 'bottom', 12],
  ] as const)('%s margin align="%s" follows expanded content insets', (kind, align, lineCount) => {
    const layout = layoutStoryDoc(kind, {
      horizontalOffsetEmu: 0,
      verticalAlign: align,
      storyLineCount: lineCount,
    });
    const page = layout.pages[0]!;
    const story = page[kind]!;
    const drawing = story.anchoredDrawings![0]!;
    const expectedY =
      align === 'center'
        ? page.contentBox.y + (page.contentBox.height - drawing.height) / 2
        : page.contentBox.y + page.contentBox.height - drawing.height;

    expect(story.box.y + drawing.y).toBeCloseTo(expectedY, 5);
    if (kind === 'header') expect(page.contentBox.y).toBeGreaterThan(78);
    else
      expect(page.box.height - page.contentBox.y - page.contentBox.height).toBeGreaterThan(134.7);
  });
});

describe('header non-margin frames', () => {
  test.each([
    ['page', -78],
    ['topMargin', -42.55],
    // The bottom-margin top on the sheet (841.9 - 134.7) less the 42.55pt header top.
    ['bottomMargin', 664.65],
    ['paragraph', 0],
    ['line', 0],
  ] as const)(
    'preserves the existing %s vertical frame origin and authored offset',
    (verticalFrame, expectedOrigin) => {
      const layout = layoutHeaderDoc({ verticalFrame });
      const drawing = layout.pages[0]!.header!.anchoredDrawings![0]!;
      expect(drawing.verticalFrameOrigin).toBeCloseTo(expectedOrigin, 5);
      expect(drawing.y).toBeCloseTo(expectedOrigin - 77.95, 5);
      expect(drawing.y - drawing.verticalFrameOrigin).toBeCloseTo(-77.95, 5);
    }
  );

  test('places page and top-margin offsets from the sheet top', () => {
    const pageFrame = layoutHeaderDoc({ verticalFrame: 'page', verticalOffsetEmu: 127_000 });
    expect(paintedPosition(pageFrame).y).toBeCloseTo(10, 2);

    const topMargin = layoutHeaderDoc({
      verticalFrame: 'topMargin',
      verticalOffsetEmu: 127_000,
    });
    expect(paintedPosition(topMargin).y).toBeCloseTo(10, 2);
  });

  test.each(['header'] as const)(
    '%s top-margin anchors retain their full on-page bounds',
    (kind) => {
      const layout = layoutStoryDoc(kind, {
        verticalFrame: 'topMargin',
        verticalOffsetEmu: 127_000,
      });
      const story = layout.pages[0]![kind]!;
      const drawing = story.anchoredDrawings![0]!;
      expect(story.box.y + drawing.y).toBeCloseTo(10, 5);
      expect(story.box.y + drawing.paintBounds.y).toBeCloseTo(10, 5);
      expect(drawing.paintBounds.height).toBeCloseTo(drawing.height, 5);
      expect(paintedPosition(layout).y).toBeCloseTo(10, 2);
      expect(paintedPosition(layout).height).toBeCloseTo(drawing.height, 2);
    }
  );

  test('top-margin body exclusion uses the same sheet position as painting', () => {
    const layout = layoutHeaderDoc({
      horizontalOffsetEmu: 0,
      verticalFrame: 'topMargin',
      verticalOffsetEmu: 1_016_000,
    });
    const page = layout.pages[0]!;
    const drawing = page.header!.anchoredDrawings![0]!;
    const zone = furnitureDrawingExclusionsForPage(page)[0]!;
    expect(zone).toBeDefined();
    expect(zone.verticalBand.y + page.contentBox.y).toBeCloseTo(80, 5);
    expect(zone.verticalBand.height).toBeCloseTo(drawing.height, 5);
    expect(paintedPosition(layout).y).toBeCloseTo(80, 2);
  });

  test('preserves the authored negative offset for the character horizontal frame', () => {
    const layout = layoutHeaderDoc({ horizontalFrame: 'character' });
    const drawing = layout.pages[0]!.header!.anchoredDrawings![0]!;
    expect(drawing.x - drawing.horizontalFrameOrigin).toBeCloseTo(-73.25, 5);
  });
});

describe('footer anchor relativeFrom="margin"', () => {
  test('uses the same page content-box origin despite the footer story being near the bottom', () => {
    const layout = layoutStoryDoc('footer');
    const page = layout.pages[0]!;
    const story = page.footer!;
    const drawing = story.anchoredDrawings![0]!;

    expect(story.box.y + drawing.paintBounds.y).toBeCloseTo(page.contentBox.y - 77.95, 2);
    expect(paintedPosition(layout).y).toBeCloseTo(page.contentBox.y - 77.95, 2);
  });
});

describe('header anchors that extend past the bottom of the sheet', () => {
  test.each([
    ['paragraph', 740],
    ['topMargin', 800],
  ] as const)('clip a %s picture only at the sheet bottom', (verticalFrame, offsetPt) => {
    const layout = layoutHeaderDoc({
      horizontalOffsetEmu: 0,
      verticalFrame,
      verticalOffsetEmu: offsetPt * 12_700,
    });
    const page = layout.pages[0]!;
    const story = page.header!;
    const drawing = story.anchoredDrawings![0]!;
    const top = story.box.y + drawing.paintBounds.y;

    expect(top + drawing.paintBounds.height).toBeCloseTo(page.box.y + page.box.height, 2);
    expect(top + 63.75).toBeGreaterThan(page.box.y + page.box.height);
  });
});

describe('footer anchor relativeFrom="paragraph"', () => {
  test('keeps a picture that extends past the bottom margin whole up to the sheet edge', () => {
    // -200pt reaches above the footer story and the 134.7pt bottom margin, into the body.
    const layout = layoutStoryDoc('footer', {
      horizontalOffsetEmu: 0,
      verticalFrame: 'paragraph',
      verticalOffsetEmu: -2_540_000,
    });
    const page = layout.pages[0]!;
    const story = page.footer!;
    const drawing = story.anchoredDrawings![0]!;
    const sheetTop = story.box.y + drawing.paintBounds.y;

    expect(drawing.paintBounds.height).toBeCloseTo(63.75, 2);
    expect(paintedPosition(layout).y).toBeCloseTo(sheetTop, 2);
    expect(paintedPosition(layout).height).toBeCloseTo(63.75, 2);
  });

  test('clips a picture that crosses the sheet top at the sheet edge', () => {
    const probe = layoutStoryDoc('footer', { verticalFrame: 'paragraph' }).pages[0]!.footer!;
    // Place the picture top 20pt above the sheet top.
    const offsetPt = -(probe.box.y + 20);
    const layout = layoutStoryDoc('footer', {
      horizontalOffsetEmu: 0,
      verticalFrame: 'paragraph',
      verticalOffsetEmu: Math.round(offsetPt * 12_700),
    });
    const page = layout.pages[0]!;
    const story = page.footer!;
    const drawing = story.anchoredDrawings![0]!;

    expect(story.box.y + drawing.paintBounds.y).toBeCloseTo(page.box.y, 2);
    expect(drawing.paintBounds.height).toBeCloseTo(63.75 - 20, 2);
  });

  test('keeps a line-relative picture whole when it extends into the body area', () => {
    const layout = layoutStoryDoc('footer', {
      horizontalOffsetEmu: 0,
      verticalFrame: 'line',
      verticalOffsetEmu: -2_540_000,
    });
    const drawing = layout.pages[0]!.footer!.anchoredDrawings![0]!;
    expect(drawing.paintBounds.height).toBeCloseTo(63.75, 2);
  });
});

test('top-margin anchors cache partial story-origin contexts separately', () => {
  const pkg = openPackage(
    storyDoc('header', {
      verticalFrame: 'topMargin',
      verticalOffsetEmu: 127_000,
    })
  );
  const main = pkg.parts.get(pkg.mainDocumentPart)!;
  const story = furnitureWithDrawings(pkg, main)[0]!.headers.get('default')!;
  const context = { pageNumber: 1, pageCount: 1, sectionPageCount: 1, storyTop: 40 };
  const first = story.withPageContext(context);
  const second = story.withPageContext({ ...context, storyTop: 50 });
  expect(first.anchoredDrawings![0]!.y).toBeCloseTo(-30, 5);
  expect(second.anchoredDrawings![0]!.y).toBeCloseTo(-40, 5);
  expect(second).not.toBe(first);
  expect(story.withPageContext(context).anchoredDrawings).toBe(first.anchoredDrawings);
});

for (const fullContext of [false, true]) {
  test(`header top-margin bands reserve their story-local height with ${fullContext ? 'full' : 'partial'} retained contexts`, () => {
    const pkg = openPackage(
      storyDoc('header', {
        verticalFrame: 'topMargin',
        verticalOffsetEmu: 127_000,
        storyLineCount: 1,
        topAndBottom: true,
      })
    );
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const story = furnitureWithDrawings(pkg, main)[0]!.headers.get('default')!;
    const context = {
      pageNumber: 1,
      pageCount: 1,
      sectionPageCount: 1,
      storyTop: 20,
      ...(fullContext ? { contentInsetTop: 90, contentInsetBottom: 72 } : {}),
    };
    const first = story.withPageContext(context);
    const second = story.withPageContext({ ...context, storyTop: 30 });
    expect(
      first.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph' ? fragment.lines : []
      )[0]!.box.y
    ).toBeCloseTo(53.75, 5);
    expect(
      second.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph' ? fragment.lines : []
      )[0]!.box.y
    ).toBeCloseTo(43.75, 5);
    expect(first.flowHeight - second.flowHeight).toBeCloseTo(10, 5);
    expect(story.withPageContext(context).flowHeight).toBe(first.flowHeight);
    expect(story.withPageContext(context).fragments).toBe(first.fragments);
  });
}

for (const control of ['paragraph', 'footer', 'cell'] as const) {
  test(`top-margin flow correction leaves ${control} coordinates unchanged`, () => {
    const kind = control === 'footer' ? 'footer' : 'header';
    const pkg = openPackage(
      storyDoc(kind, {
        verticalFrame: control === 'paragraph' ? 'paragraph' : 'topMargin',
        verticalOffsetEmu: 127_000,
        storyLineCount: 1,
        topAndBottom: true,
        inTable: control === 'cell',
      })
    );
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const furniture = furnitureWithDrawings(pkg, main)[0]!;
    const story = (kind === 'footer' ? furniture.footers : furniture.headers).get('default')!;
    const context = { pageNumber: 1, pageCount: 1, sectionPageCount: 1, storyTop: 20 };
    const first = story.withPageContext(context);
    const second = story.withPageContext({ ...context, storyTop: 30 });
    expect(second.flowHeight).toBeCloseTo(first.flowHeight, 5);
    if (control === 'paragraph')
      expect(
        first.fragments.flatMap((fragment) =>
          fragment.kind === 'paragraph' ? fragment.lines : []
        )[0]!.box.y
      ).toBeCloseTo(73.75, 5);
  });
}

test('header top-margin flow places the body below the sheet-relative band and header line', () => {
  const page = layoutHeaderDoc({
    verticalFrame: 'topMargin',
    verticalOffsetEmu: 127_000,
    storyLineCount: 1,
    topAndBottom: true,
    storyDistance: 42.55,
  }).pages[0]!;
  const header = page.header!;
  const line = header.fragments.flatMap((fragment) =>
    fragment.kind === 'paragraph' ? fragment.lines : []
  )[0]!;
  expect(header.box.y + line.box.y).toBeCloseTo(73.75, 5);
  expect(page.contentBox.y).toBeCloseTo(73.75 + line.box.height, 5);
  const body = page.fragments.flatMap((fragment) =>
    fragment.kind === 'paragraph' ? fragment.lines : []
  )[0]!;
  expect(page.contentBox.y + body.box.y).toBeCloseTo(73.75 + line.box.height, 5);
});

test('body top-margin bands keep their page-content coordinates', () => {
  const xml = squareAnchorAtLeft({ text: 'Body text' })
    .replace(/<wp:wrapSquare[^>]*\/>/, '<wp:wrapTopAndBottom/>')
    .replace(
      'relativeFrom="paragraph"><wp:posOffset>0',
      'relativeFrom="topMargin"><wp:posOffset>1016000'
    );
  const part = load(xml);
  const page = layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
  }).pages[0]!;
  const drawing = page.anchoredDrawings![0]!;
  const line = page.fragments.flatMap((fragment) =>
    fragment.kind === 'paragraph' ? fragment.lines : []
  )[0]!;
  expect(page.contentBox.y + drawing.y).toBeCloseTo(80, 5);
  expect(line.box.y).toBeCloseTo(drawing.y + drawing.height, 5);
});

// The fixture sheet is A4, 841.9pt high, with a 134.7pt bottom margin. The top band ends at
// the body content top: the 78pt top margin, or lower where the header pushes the body down.
// The picture is 63.75pt square. Expected values are sheet tops of the picture.
const SHEET = 841.9;
const BOTTOM_BAND_TOP = SHEET - 134.7;
const PICTURE = 63.75;

function placed(kind: 'header' | 'footer', options: AnchorOptions) {
  const page = layoutStoryDoc(kind, { horizontalOffsetEmu: 0, ...options }).pages[0]!;
  const story = (kind === 'header' ? page.header : page.footer)!;
  const drawing = story.anchoredDrawings![0]!;
  return {
    top: headerFooterAnchoredDrawingOrigin(drawing, story.box, page.box).y - page.box.y,
    bodyTop: page.contentBox.y - page.box.y,
  };
}

describe('margin-band frames are bands of the sheet', () => {
  for (const kind of ['header', 'footer'] as const) {
    test.each([
      ['topMargin', undefined, () => 10],
      ['topMargin', 'center', (bodyTop: number) => (bodyTop - PICTURE) / 2],
      ['topMargin', 'bottom', (bodyTop: number) => bodyTop - PICTURE],
      ['bottomMargin', undefined, () => BOTTOM_BAND_TOP + 10],
      ['bottomMargin', 'center', () => BOTTOM_BAND_TOP + (SHEET - BOTTOM_BAND_TOP - PICTURE) / 2],
      ['bottomMargin', 'bottom', () => SHEET - PICTURE],
      // Page 1 is odd: the inside and outside margins are the top band.
      ['insideMargin', undefined, () => 10],
      ['outsideMargin', 'bottom', (bodyTop: number) => bodyTop - PICTURE],
    ] as const)(`${kind} %s %s`, (verticalFrame, verticalAlign, expected) => {
      const { top, bodyTop } = placed(kind, {
        verticalFrame,
        verticalOffsetEmu: 127_000,
        ...(verticalAlign ? { verticalAlign } : {}),
      });
      expect(top).toBeCloseTo(expected(bodyTop), 2);
    });
  }

  test('the top band of a header ends where the header pushes the body down', () => {
    const { top, bodyTop } = placed('header', {
      verticalFrame: 'topMargin',
      verticalAlign: 'bottom',
    });
    expect(bodyTop).toBeGreaterThan(78);
    expect(top).toBeCloseTo(bodyTop - PICTURE, 2);
  });

  test('page 2 is even: the inside and outside margins are the bottom band', () => {
    for (const verticalFrame of ['insideMargin', 'outsideMargin'] as const) {
      const layout = layoutStoryDoc('footer', {
        horizontalOffsetEmu: 0,
        verticalFrame,
        verticalOffsetEmu: 127_000,
        secondPage: true,
      });
      const page = layout.pages[1]!;
      const story = page.footer!;
      const drawing = story.anchoredDrawings![0]!;
      const top = headerFooterAnchoredDrawingOrigin(drawing, story.box, page.box).y - page.box.y;
      expect(top).toBeCloseTo(BOTTOM_BAND_TOP + 10, 2);
    }
  });

  test('a footer picture laid out in its table cell stays in the cell', () => {
    for (const verticalFrame of ['topMargin', 'bottomMargin', 'insideMargin', 'page'] as const) {
      const layout = layoutStoryDoc('footer', {
        horizontalFrame: 'page',
        horizontalOffsetEmu: 127_000,
        verticalFrame,
        verticalOffsetEmu: 127_000,
        inTable: true,
      });
      const page = layout.pages[0]!;
      const story = page.footer!;
      const drawing = story.anchoredDrawings![0]!;
      expect(drawing.verticalPageTop).toBeUndefined();
      expect(drawing.horizontalPageLeft).toBeUndefined();
      const origin = headerFooterAnchoredDrawingOrigin(drawing, story.box, page.box);
      expect(origin.y).toBeGreaterThanOrEqual(story.box.y);
      expect(origin.y).toBeLessThan(story.box.y + story.box.height);
      expect(origin.x).toBeGreaterThanOrEqual(story.box.x);
    }
  });

  test('a press on a footer bottom-margin picture hits the picture', () => {
    const layout = layoutStoryDoc('footer', {
      horizontalOffsetEmu: 0,
      verticalFrame: 'bottomMargin',
      verticalOffsetEmu: 127_000,
    });
    const page = layout.pages[0]!;
    const drawing = page.footer!.anchoredDrawings![0]!;
    const point = {
      x: page.footer!.box.x + drawing.x + PICTURE / 2,
      y: page.box.y + BOTTOM_BAND_TOP + 10 + PICTURE / 2,
    };
    const hit = hitTestSheet(layout, point);
    expect(hit?.position.paragraphId).toBe(drawing.anchorParagraphId);
    expect(hit?.position.offset).toBe(drawing.start);
  });

  test('a footer bottom-margin picture paints where layout places it', () => {
    const layout = layoutStoryDoc('footer', {
      horizontalOffsetEmu: 0,
      verticalFrame: 'bottomMargin',
      verticalOffsetEmu: 127_000,
    });
    const page = layout.pages[0]!;
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const picture = container.querySelector<HTMLElement>('.docx-drawing-layer-front > *');
    expect(picture).not.toBeNull();
    expect(parseFloat(picture!.style.top)).toBeCloseTo(page.box.y + BOTTOM_BAND_TOP + 10, 2);
  });

  test('a wrapped footer picture on a margin band keeps the footer layout stable', () => {
    for (const verticalFrame of ['bottomMargin', 'outsideMargin', 'topMargin'] as const)
      for (let offset = -40; offset <= 140; offset += 20) {
        const options = {
          horizontalOffsetEmu: 0,
          verticalFrame,
          verticalOffsetEmu: offset * 12_700,
          topAndBottom: true,
          storyLineCount: 3,
        };
        const first = layoutStoryDoc('footer', options).pages[0]!;
        const again = layoutStoryDoc('footer', options).pages[0]!;
        const footer = first.footer!;
        // The footer ends at the sheet bottom (w:footer="0") and lays out the same each time.
        expect(footer.box.y + footer.box.height).toBeCloseTo(first.box.y + SHEET, 2);
        expect(again.footer!.box).toEqual(footer.box);
        expect(again.footer!.anchoredDrawings![0]!.y).toBeCloseTo(
          footer.anchoredDrawings![0]!.y,
          6
        );
      }
  });
});

describe('alignment against a paragraph or a line', () => {
  for (const kind of ['header', 'footer'] as const) {
    test(`${kind} paragraph: center and bottom place the picture at the paragraph top`, () => {
      const top = placed(kind, { verticalFrame: 'paragraph', verticalAlign: 'top' }).top;
      for (const verticalAlign of ['center', 'bottom'] as const)
        expect(placed(kind, { verticalFrame: 'paragraph', verticalAlign }).top).toBeCloseTo(top, 2);
    });

    test(`${kind} line: center and bottom align to the line top`, () => {
      const lineTop = placed(kind, { verticalFrame: 'line', verticalAlign: 'top' }).top;
      expect(placed(kind, { verticalFrame: 'line', verticalAlign: 'center' }).top).toBeCloseTo(
        lineTop - PICTURE / 2,
        2
      );
      expect(placed(kind, { verticalFrame: 'line', verticalAlign: 'bottom' }).top).toBeCloseTo(
        lineTop - PICTURE,
        2
      );
    });
  }
});
