// Task 7 fix round 1 — anchored frames, HF furniture, lifecycle, hits (strict TDD).

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlDrawingNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import { emuToPoints, resolveAnchoredDrawingPosition } from '../drawing-layout.ts';
import { hitTestPage, hitTestSheet } from '../semantic-hit-test.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type PageFurniture,
} from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const measurer = createFixedMeasurer(6, 14);
const OWNER = '/word/document.xml';
const WIDTH = emuToPoints(914400);

const READY: ImageResourceState = Object.freeze({
  kind: 'ready',
  partName: '/word/media/image1.png',
  contentId: 'c1',
  resourceKey: 'k1',
  mime: 'image/png',
  pixelWidth: 10,
  pixelHeight: 10,
  dpiX: 96,
  dpiY: 96,
});

function load(xml: string, owner = OWNER): OoxmlPart {
  const result = readOoxmlPart(xml, {
    name: owner,
    contentType: owner.includes('header')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
      : owner.includes('footer')
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
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

const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;

function anchorCore(
  options: {
    readonly anchorAttrs?: string;
    readonly simplePos?: string;
    readonly positionH?: string;
    readonly positionV?: string;
    readonly wrap?: string;
    readonly extent?: string;
  } = {}
): string {
  const anchorAttrs =
    options.anchorAttrs ??
    'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="952500"';
  const simplePos = options.simplePos ?? '<wp:simplePos x="0" y="0"/>';
  const positionH =
    options.positionH ??
    '<wp:positionH relativeFrom="margin"><wp:align>left</wp:align></wp:positionH>';
  const positionV =
    options.positionV ??
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>';
  const extent = options.extent ?? 'cx="914400" cy="457200"';
  const wrap = options.wrap ?? '<wp:wrapSquare wrapText="bothSides"/>';
  return (
    `<wp:anchor ${anchorAttrs}>` +
    simplePos +
    positionH +
    positionV +
    `<wp:extent ${extent}/>` +
    wrap +
    '<wp:docPr id="3" name="float"/>' +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor>'
  );
}

function bodyDoc(inner: string): string {
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body>${inner}</w:body></w:document>`
  );
}

function anchorFrameContext(
  overrides: Partial<import('../drawing-layout.ts').DrawingAnchorFrameContext> = {}
) {
  const contentWidth = 468;
  return Object.freeze({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    marginLeft: 72,
    marginRight: 72,
    marginTop: 72,
    marginBottom: 72,
    contentWidth,
    contentHeight: 648,
    physicalContentHeight: 648,
    paragraphBox: Object.freeze({ x: 0, y: 40, width: contentWidth, height: 20 }),
    anchorLineBox: Object.freeze({ x: 0, y: 40, width: contentWidth, height: 14 }),
    anchorCharacterX: 6,
    columnBox: Object.freeze({ x: 0, y: 40, width: contentWidth, height: 20 }),
    cellBox: null,
    layoutInCell: true,
    ownerPartName: OWNER,
    storyKind: 'body' as const,
    ...overrides,
  });
}

describe('task 7 fix round — signed coordinates from XML', () => {
  test('negative posOffset survives parser → projection → layout', () => {
    const part = load(
      bodyDoc(
        `<w:p>${run('A')}<w:r><w:drawing>${anchorCore({
          positionH:
            '<wp:positionH relativeFrom="margin"><wp:posOffset>-12700</wp:posOffset></wp:positionH>',
        })}</w:drawing></w:r></w:p>`
      )
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    expect(projection.position!.horizontal.offsetEmu).toBe(-12700);
    const resolved = resolveAnchoredDrawingPosition(projection, anchorFrameContext());
    expect(resolved.x).toBeCloseTo(-1, 3);
  });

  test('negative simplePos coordinates survive when simplePos="1"', () => {
    const part = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          anchorAttrs:
            'distT="0" distB="0" distL="0" distR="0" simplePos="1" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1"',
          simplePos: '<wp:simplePos x="-127000" y="-254000"/>',
          positionH:
            '<wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>',
          positionV: '<wp:positionV relativeFrom="page"><wp:align>bottom</wp:align></wp:positionV>',
        })}</w:drawing></w:r></w:p>`
      )
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    expect(projection.position!.simplePosition.xEmu).toBe(-127000);
    expect(projection.position!.simplePosition.yEmu).toBe(-254000);
    const resolved = resolveAnchoredDrawingPosition(projection, anchorFrameContext());
    expect(resolved.x).toBeCloseTo(emuToPoints(-127000) - 72, 3);
    expect(resolved.y).toBeCloseTo(emuToPoints(-254000) - 72, 3);
  });

  test('negative extent cx/cy demotes anchor to generic', () => {
    const part = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          extent: 'cx="-1" cy="457200"',
        })}</w:drawing></w:r></w:p>`
      )
    );
    const stack: import('../../store/package/ooxml-tree.ts').OoxmlElement[] = [part.root];
    let anchorKind = '';
    while (stack.length > 0) {
      const node = stack.shift()!;
      if (node.localName === 'anchor') {
        anchorKind = node.kind;
        break;
      }
      for (const child of node.children) {
        if (child.kind !== 'textValue') stack.push(child);
      }
    }
    expect(anchorKind).toBe('generic');
  });
});

describe('task 7 fix round — anchor child validity', () => {
  test('missing required simplePos demotes anchor', () => {
    const part = load(
      bodyDoc(`<w:p><w:r><w:drawing>${anchorCore({ simplePos: '' })}</w:drawing></w:r></w:p>`)
    );
    const stack: import('../../store/package/ooxml-tree.ts').OoxmlElement[] = [part.root];
    let anchorKind = '';
    while (stack.length > 0) {
      const node = stack.shift()!;
      if (node.localName === 'anchor') {
        anchorKind = node.kind;
        break;
      }
      for (const child of node.children) {
        if (child.kind !== 'textValue') stack.push(child);
      }
    }
    expect(anchorKind).toBe('generic');
  });

  test('misordered extent before positionH demotes anchor', () => {
    const xml = bodyDoc(
      `<w:p><w:r><w:drawing>` +
        '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
        '<wp:simplePos x="0" y="0"/>' +
        '<wp:extent cx="914400" cy="457200"/>' +
        '<wp:positionH relativeFrom="margin"><wp:align>left</wp:align></wp:positionH>' +
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        '<wp:wrapNone/>' +
        '<wp:docPr id="3" name="float"/><wp:cNvGraphicFramePr/>' +
        `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
        '<pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
        '</wp:anchor></w:drawing></w:r></w:p>'
    );
    const part = load(xml);
    const stack: import('../../store/package/ooxml-tree.ts').OoxmlElement[] = [part.root];
    let anchorKind = '';
    while (stack.length > 0) {
      const node = stack.shift()!;
      if (node.localName === 'anchor') {
        anchorKind = node.kind;
        break;
      }
      for (const child of node.children) {
        if (child.kind !== 'textValue') stack.push(child);
      }
    }
    expect(anchorKind).toBe('generic');
  });

  test('two wrap children demotes anchor', () => {
    const part = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          wrap: '<wp:wrapNone/><wp:wrapSquare wrapText="bothSides"/>',
        })}</w:drawing></w:r></w:p>`
      )
    );
    const stack2: import('../../store/package/ooxml-tree.ts').OoxmlElement[] = [part.root];
    let anchorKind2 = '';
    while (stack2.length > 0) {
      const node = stack2.shift()!;
      if (node.localName === 'anchor') {
        anchorKind2 = node.kind;
        break;
      }
      for (const child of node.children) {
        if (child.kind !== 'textValue') stack2.push(child);
      }
    }
    expect(anchorKind2).toBe('generic');
  });
});

describe('task 7 fix round — vertical frame matrix', () => {
  const verticalCases = [
    ['page', 'top', null, -72],
    ['page', 'bottom', null, 648 + 72 - emuToPoints(457200)],
    ['page', 'center', null, (648 + 72 - 72) / 2 - emuToPoints(457200) / 2],
    ['margin', 'top', null, 0],
    ['margin', 'bottom', null, 648 - emuToPoints(457200)],
    ['paragraph', 'top', null, 40],
    ['line', 'top', null, 40],
    ['topMargin', 'top', null, -72],
    ['bottomMargin', 'bottom', null, 648 - emuToPoints(457200)],
    ['insideMargin', 'top', null, 0],
    ['outsideMargin', 'bottom', null, 648 + 72 - emuToPoints(457200)],
  ] as const;

  test.each(verticalCases)('vertical %s align %s', (frame, align, _offset, expectedY) => {
    const part = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          positionV: `<wp:positionV relativeFrom="${frame}"><wp:align>${align}</wp:align></wp:positionV>`,
        })}</w:drawing></w:r></w:p>`
      )
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const resolved = resolveAnchoredDrawingPosition(
      projection,
      anchorFrameContext({ pageNumber: 1 })
    );
    expect(resolved.verticalFrame).toBe(frame);
    expect(resolved.y).toBeCloseTo(expectedY, 1);
  });

  test('vertical inside/outside align swap on even pages', () => {
    const inside = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          positionV:
            '<wp:positionV relativeFrom="margin"><wp:align>inside</wp:align></wp:positionV>',
        })}</w:drawing></w:r></w:p>`
      )
    );
    const outside = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          positionV:
            '<wp:positionV relativeFrom="margin"><wp:align>outside</wp:align></wp:positionV>',
        })}</w:drawing></w:r></w:p>`
      )
    );
    const oddInside = resolveAnchoredDrawingPosition(
      projectDrawing(drawingOf(inside), {
        ownerPartName: OWNER,
        limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
      })!,
      anchorFrameContext({ pageNumber: 1 })
    );
    const evenInside = resolveAnchoredDrawingPosition(
      projectDrawing(drawingOf(inside), {
        ownerPartName: OWNER,
        limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
      })!,
      anchorFrameContext({ pageNumber: 2 })
    );
    const oddOutside = resolveAnchoredDrawingPosition(
      projectDrawing(drawingOf(outside), {
        ownerPartName: OWNER,
        limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
      })!,
      anchorFrameContext({ pageNumber: 1 })
    );
    expect(oddInside.y).toBeCloseTo(0, 1);
    expect(evenInside.y).toBeCloseTo(648 - emuToPoints(457200), 1);
    expect(oddOutside.y).toBeCloseTo(648 - emuToPoints(457200), 1);
  });

  test('horizontal inside/outside align parity on odd/even pages', () => {
    const inside = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          positionH:
            '<wp:positionH relativeFrom="margin"><wp:align>inside</wp:align></wp:positionH>',
        })}</w:drawing></w:r></w:p>`
      )
    );
    const projection = projectDrawing(drawingOf(inside), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const odd = resolveAnchoredDrawingPosition(projection, anchorFrameContext({ pageNumber: 1 }));
    const even = resolveAnchoredDrawingPosition(projection, anchorFrameContext({ pageNumber: 2 }));
    expect(odd.x).toBeCloseTo(0, 1);
    expect(even.x).toBeCloseTo(468 - WIDTH, 1);
  });
});

describe('task 7 fix round — HF furniture integration', () => {
  function headerStoryWithAnchor(variant: 'default' | 'even' | 'first' = 'default') {
    const headerPart = load(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:p>${run('H')}<w:r><w:drawing>${anchorCore({
          anchorAttrs:
            'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1"',
          positionH: '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>',
          positionV: '<wp:positionV relativeFrom="page"><wp:align>top</wp:align></wp:positionV>',
        })}</w:drawing></w:r></w:p></w:hdr>`,
      `/word/header-${variant}.xml`
    );
    const ctx = layoutContext(headerPart, `/word/header-${variant}.xml`);
    return layoutHeaderFooterStory(
      headerPart,
      468,
      measurer,
      'prod',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ctx
    );
  }

  test('header anchored drawing attaches to page furniture with owner part', () => {
    const headerStory = headerStoryWithAnchor();
    expect(headerStory.flowHeight).toBeLessThan(emuToPoints(457200));
    expect(headerStory.anchoredDrawings?.length).toBe(1);
    expect(headerStory.anchoredDrawings![0]!.ownerPartName).toBe('/word/header-default.xml');

    const furniture: PageFurniture = {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([['default', headerStory]]),
      footers: new Map(),
    };
    const part = load(bodyDoc(`<w:p>${run('body')}</w:p>`));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      furniture,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const page = layout.pages[0]!;
    expect(page.header?.anchoredDrawings?.length).toBe(1);
    expect(page.header!.anchoredDrawings![0]!.ownerPartName).toBe('/word/header-default.xml');
    expect(headerStory.flowHeight).toBeLessThan(emuToPoints(457200));
    expect(page.contentBox.y).toBeGreaterThanOrEqual(page.box.y + 72);
  });

  test('even header variant attaches on even pages only', () => {
    const defaultStory = headerStoryWithAnchor('default');
    const evenStory = headerStoryWithAnchor('even');
    const furniture: PageFurniture = {
      titlePage: false,
      evenAndOddHeaders: true,
      headers: new Map([
        ['default', defaultStory],
        ['even', evenStory],
      ]),
      footers: new Map(),
    };
    const part = load(
      bodyDoc(
        `<w:p>${run('one')}</w:p>` +
          `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` +
          `<w:p>${run('two')}</w:p>`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      furniture,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    expect(layout.pages[0]!.header?.variant).toBe('default');
    expect(layout.pages[0]!.header?.anchoredDrawings?.[0]?.ownerPartName).toBe(
      '/word/header-default.xml'
    );
    expect(layout.pages[1]!.header?.variant).toBe('even');
    expect(layout.pages[1]!.header?.anchoredDrawings?.[0]?.ownerPartName).toBe(
      '/word/header-even.xml'
    );
  });
});

describe('task 7 fix round — page and fragment lifecycle', () => {
  test('split paragraph publishes anchor on the page containing the anchor line', () => {
    const part = load(
      bodyDoc(
        `<w:p>${run('L'.repeat(80))}</w:p>` +
          `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` +
          `<w:p>${run('A')}<w:r><w:drawing>${anchorCore({
            positionV:
              '<wp:positionV relativeFrom="line"><wp:posOffset>0</wp:posOffset></wp:positionV>',
          })}</w:drawing></w:r></w:p>`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 120, height: 80, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    const pagesWithAnchors = layout.pages.filter(
      (page) => (page.anchoredDrawings?.length ?? 0) > 0
    );
    expect(pagesWithAnchors.length).toBe(1);
    const anchorPage = pagesWithAnchors[0]!;
    const anchorParagraphId = anchorPage.anchoredDrawings![0]!.anchorParagraphId;
    const hostFragment = paragraphFragmentsOf(anchorPage).find(
      (f) => f.range.paragraphId === anchorParagraphId
    );
    expect(hostFragment).toBeDefined();
  });

  test('incremental pass preserves anchored drawing page placement', () => {
    const session = createLayoutSession();
    const part = load(
      bodyDoc(`<w:p>${run('A')}<w:r><w:drawing>${anchorCore()}</w:drawing></w:r></w:p>`)
    );
    const opts = { measurer, session, inlineDrawingLayout: layoutContext(part) };
    const first = layoutSemanticDocument(part, 1, opts);
    const second = layoutSemanticDocument(part, 2, opts);
    expect(second.pages[0]!.anchoredDrawings?.[0]?.x).toBeCloseTo(
      first.pages[0]!.anchoredDrawings![0]!.x,
      3
    );
    expect(second.pages[0]).toBe(first.pages[0]);
  });
});

describe('task 7 fix round — table cell contexts', () => {
  test('center vAlign shifts anchor paragraph box within cell', () => {
    const drawingRun = `<w:r><w:drawing>${anchorCore({
      positionV:
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>',
    })}</w:drawing></w:r>`;
    const doc = bodyDoc(
      '<w:tbl><w:tr><w:tc><w:tcPr>' +
        '<w:tcW w:w="5000" w:type="dxa"/>' +
        '<w:vAlign w:val="center"/>' +
        '</w:tcPr>' +
        `<w:p>${run('T')}</w:p>` +
        `<w:p>${drawingRun}</w:p>` +
        '</w:tc></w:tr></w:tbl>'
    );
    const part = load(doc);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const anchor = layout.pages[0]!.anchoredDrawings![0]!;
    expect(anchor.y).toBeGreaterThan(0);
  });

  test('layoutInCell=false resolves against page clip not cell content box', () => {
    const drawingRun = `<w:r><w:drawing>${anchorCore({
      anchorAttrs:
        'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="0" relativeHeight="1"',
      positionH: '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>',
      positionV: '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>',
    })}</w:drawing></w:r>`;
    const doc = bodyDoc(
      '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' +
        `<w:p>${drawingRun}</w:p></w:tc></w:tr></w:tbl>`
    );
    const part = load(doc);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const drawing = layout.pages[0]!.anchoredDrawings![0]!;
    expect(drawing.layoutInCell).toBe(false);
    expect(drawing.paintBounds.width).toBeGreaterThan(0);
    expect(drawing.x).toBeCloseTo(-72, 1);
  });
});

describe('task 7 fix round — clipping and hit order', () => {
  test('page-margin anchor may extend into margin with paint bounds on page', () => {
    const part = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          positionH:
            '<wp:positionH relativeFrom="leftMargin"><wp:align>left</wp:align></wp:positionH>',
          positionV:
            '<wp:positionV relativeFrom="topMargin"><wp:align>top</wp:align></wp:positionV>',
        })}</w:drawing></w:r></w:p>`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const drawing = layout.pages[0]!.anchoredDrawings![0]!;
    expect(drawing.x).toBeLessThan(0);
    expect(drawing.paintBounds.width).toBeGreaterThan(0);
  });

  test('behind-document anchor is hittable without displacing text hit', () => {
    const part = load(
      bodyDoc(
        `<w:p>${run('TEXT')}<w:r><w:drawing>${anchorCore({
          anchorAttrs:
            'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="1" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1"',
          positionH:
            '<wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionH>',
          positionV:
            '<wp:positionV relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionV>',
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
    const textHit = hitTestPage(layout, 0, { x: 2, y: 5 });
    expect(textHit?.position.offset).toBe(0);
    expect(textHit?.drawing ?? undefined).toBeUndefined();
    const drawingHit = hitTestPage(layout, 0, {
      x: drawing.hitBounds.x + drawing.hitBounds.width - 2,
      y: drawing.hitBounds.y + 2,
    });
    expect(drawingHit?.drawing?.drawingNodeId).toBe(drawing.drawingNodeId);
  });

  test('header furniture anchor is hittable in sheet coordinates', () => {
    const headerPart = load(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:p><w:r><w:drawing>${anchorCore({
          positionH:
            '<wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionH>',
          positionV:
            '<wp:positionV relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionV>',
        })}</w:drawing></w:r></w:p></w:hdr>`,
      '/word/header1.xml'
    );
    const hfCtx = layoutContext(headerPart, '/word/header1.xml');
    const headerStory = layoutHeaderFooterStory(
      headerPart,
      468,
      measurer,
      'prod',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      hfCtx
    );
    const furniture: PageFurniture = {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([['default', headerStory]]),
      footers: new Map(),
    };
    const part = load(bodyDoc(`<w:p>${run('body')}</w:p>`));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      furniture,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const page = layout.pages[0]!;
    const hfDrawing = page.header!.anchoredDrawings![0]!;
    const sheetX = page.header!.box.x + hfDrawing.hitBounds.x + 2;
    const sheetY = page.header!.box.y + hfDrawing.hitBounds.y + 2;
    const hit = hitTestSheet(layout, { x: sheetX, y: sheetY });
    expect(hit?.drawing?.drawingNodeId).toBe(hfDrawing.drawingNodeId);
  });
});
