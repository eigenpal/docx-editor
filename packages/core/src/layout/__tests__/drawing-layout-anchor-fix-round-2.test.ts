// Task 7 fix round 2 — schema numerics, real frames, HF/table/incremental/hits (strict TDD).

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlDrawingNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import {
  ST_COORDINATE_MAX,
  ST_POSITION_OFFSET_MAX,
  ST_POSITION_OFFSET_MIN,
} from '../../store/package/ooxml-drawing-rules.ts';
import * as invariantApi from '../../store/package/ooxml-validate.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import {
  anchorCharacterXOnLine,
  columnBoxForSection,
  emuToPoints,
  resolveAnchoredDrawingPosition,
} from '../drawing-layout.ts';
import { layoutHeaderFooterStory, remapPage } from '../hf-layout.ts';
import { hitTestPage, hitTestSheet } from '../semantic-hit-test.ts';
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

const HF_PAGE: import('../hf-layout.ts').HeaderFooterPageContext = {
  pageNumber: 2,
  pageWidth: 612,
  pageHeight: 792,
  marginLeft: 72,
  marginRight: 72,
  marginTop: 72,
  marginBottom: 72,
};

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
    readonly effectExtent?: string;
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
  const effectExtent = options.effectExtent ?? '';
  const wrap = options.wrap ?? '<wp:wrapSquare wrapText="bothSides"/>';
  return (
    `<wp:anchor ${anchorAttrs}>` +
    simplePos +
    positionH +
    positionV +
    `<wp:extent ${extent}/>` +
    effectExtent +
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

function anchorKind(part: OoxmlPart): string {
  const stack: import('../../store/package/ooxml-tree.ts').OoxmlElement[] = [part.root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.localName === 'anchor') return node.kind;
    for (const child of node.children) {
      if (child.kind !== 'textValue') stack.push(child);
    }
  }
  return '';
}

describe('task 7 fix round 2 — schema numeric types', () => {
  test('posOffset at int32 min/max is typed; one-past-max demotes anchor', () => {
    const minPart = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          positionV: `<wp:positionV relativeFrom="margin"><wp:posOffset>${ST_POSITION_OFFSET_MIN}</wp:posOffset></wp:positionV>`,
        })}</w:drawing></w:r></w:p>`
      )
    );
    expect(anchorKind(minPart)).toBe('anchoredDrawing');
    const maxPart = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          positionV: `<wp:positionV relativeFrom="margin"><wp:posOffset>${ST_POSITION_OFFSET_MAX}</wp:posOffset></wp:positionV>`,
        })}</w:drawing></w:r></w:p>`
      )
    );
    expect(anchorKind(maxPart)).toBe('anchoredDrawing');

    const overPart = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          positionV: `<wp:positionV relativeFrom="margin"><wp:posOffset>${ST_POSITION_OFFSET_MAX + 1}</wp:posOffset></wp:positionV>`,
        })}</w:drawing></w:r></w:p>`
      )
    );
    expect(anchorKind(overPart)).toBe('generic');

    const underPart = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          positionV: `<wp:positionV relativeFrom="margin"><wp:posOffset>${ST_POSITION_OFFSET_MIN - 1}</wp:posOffset></wp:positionV>`,
        })}</w:drawing></w:r></w:p>`
      )
    );
    expect(anchorKind(underPart)).toBe('generic');
  });

  test('simplePos accepts ST_Coordinate beyond int32 without truncation', () => {
    const beyondInt32 = ST_POSITION_OFFSET_MAX + 1;
    const part = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          anchorAttrs:
            'distT="0" distB="0" distL="0" distR="0" simplePos="1" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1"',
          simplePos: `<wp:simplePos x="${beyondInt32}" y="0"/>`,
        })}</w:drawing></w:r></w:p>`
      )
    );
    expect(anchorKind(part)).toBe('anchoredDrawing');
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    expect(projection.position!.simplePosition.xEmu).toBe(beyondInt32);
  });

  test('simplePos one-past ST_Coordinate max demotes; huge coordinate uses layout fallback', () => {
    const overPart = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          anchorAttrs:
            'distT="0" distB="0" distL="0" distR="0" simplePos="1" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1"',
          simplePos: `<wp:simplePos x="${ST_COORDINATE_MAX + 1}" y="0"/>`,
        })}</w:drawing></w:r></w:p>`
      )
    );
    expect(anchorKind(overPart)).toBe('generic');

    const hugePart = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          anchorAttrs:
            'distT="0" distB="0" distL="0" distR="0" simplePos="1" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1"',
          simplePos: `<wp:simplePos x="${ST_COORDINATE_MAX}" y="0"/>`,
        })}</w:drawing></w:r></w:p>`
      )
    );
    const projection = projectDrawing(drawingOf(hugePart), {
      ownerPartName: OWNER,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    const resolved = resolveAnchoredDrawingPosition(projection, {
      pageNumber: 1,
      pageWidth: 612,
      pageHeight: 792,
      marginLeft: 72,
      marginRight: 72,
      marginTop: 72,
      marginBottom: 72,
      contentWidth: 468,
      contentHeight: 648,
      paragraphBox: { x: 0, y: 0, width: 468, height: 20 },
      anchorLineBox: { x: 0, y: 0, width: 468, height: 14 },
      anchorCharacterX: 0,
      columnBox: { x: 0, y: 0, width: 468, height: 20 },
      cellBox: null,
      layoutInCell: true,
      ownerPartName: OWNER,
      storyKind: 'body',
    });
    expect(resolved.layoutFallback).toBe('unresolvable-frame');
  });
});

describe('task 7 fix round 2 — anchor child sequence and attrs', () => {
  test('effectExtent at legal position between extent and wrap is typed', () => {
    const part = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          effectExtent: '<wp:effectExtent l="0" t="0" r="0" b="0"/>',
        })}</w:drawing></w:r></w:p>`
      )
    );
    expect(anchorKind(part)).toBe('anchoredDrawing');
    expect(invariantApi.validateOoxmlPart(part).ok).toBe(true);
  });

  test('effectExtent after wrap demotes anchor', () => {
    const part = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>` +
          '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1">' +
          '<wp:simplePos x="0" y="0"/>' +
          '<wp:positionH relativeFrom="margin"><wp:align>left</wp:align></wp:positionH>' +
          '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
          '<wp:extent cx="914400" cy="457200"/>' +
          '<wp:wrapNone/>' +
          '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
          '<wp:docPr id="3" name="float"/><wp:cNvGraphicFramePr/>' +
          `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic/></a:graphicData></a:graphic>` +
          '</wp:anchor></w:drawing></w:r></w:p>'
      )
    );
    expect(anchorKind(part)).toBe('generic');
  });

  test('invalid relativeHeight and dist demote anchor', () => {
    const badHeight = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          anchorAttrs:
            'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="-1"',
        })}</w:drawing></w:r></w:p>`
      )
    );
    expect(anchorKind(badHeight)).toBe('generic');

    const badDist = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          anchorAttrs:
            'distT="wide" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1"',
        })}</w:drawing></w:r></w:p>`
      )
    );
    expect(anchorKind(badDist)).toBe('generic');
  });
});

describe('task 7 fix round 2 — real geometry frames', () => {
  test('character frame uses caret x not line x when paragraph is centered', () => {
    const part = load(
      bodyDoc(
        `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run('AB')}<w:r><w:drawing>${anchorCore({
          positionH:
            '<wp:positionH relativeFrom="character"><wp:align>left</wp:align></wp:positionH>',
        })}</w:drawing></w:r></w:p>`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 200, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
    });
    const page = layout.pages[0]!;
    const fragment = paragraphFragmentsOf(page)[0]!;
    const line = fragment.lines[0]!;
    expect(line.spans[0]!.box.x).toBeGreaterThan(line.box.x);
    const anchor = page.anchoredDrawings![0]!;
    expect(anchor.x).toBeCloseTo(anchorCharacterXOnLine(line, anchor.start), 1);
    expect(anchor.x).toBeGreaterThan(line.box.x);
  });

  test('column frame uses column width narrower than content when cols=2', () => {
    const part = load(
      bodyDoc(
        `<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>` +
          `<w:p><w:r><w:drawing>${anchorCore({
            positionH:
              '<wp:positionH relativeFrom="column"><wp:align>right</wp:align></wp:positionH>',
          })}</w:drawing></w:r></w:p>`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 200, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
    });
    const anchor = layout.pages[0]!.anchoredDrawings![0]!;
    const columnWidth = columnBoxForSection({
      contentWidth: 180,
      paragraphY: 0,
      paragraphHeight: 20,
      columnCount: 2,
      columnGapPt: 36,
    }).width;
    expect(anchor.x).toBeCloseTo(columnWidth - WIDTH, 1);
    expect(columnWidth).toBeLessThan(180);
  });
});

describe('task 7 fix round 2 — HF page geometry and hits', () => {
  function headerWithAnchor(pageCtx: typeof HF_PAGE) {
    const headerPart = load(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:p><w:r><w:drawing>${anchorCore({
          positionH:
            '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>',
          positionV:
            '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>',
        })}</w:drawing></w:r></w:p></w:hdr>`,
      '/word/header1.xml'
    );
    return layoutHeaderFooterStory(
      headerPart,
      468,
      measurer,
      'prod',
      undefined,
      undefined,
      { pageNumber: pageCtx.pageNumber, pageCount: 4, sectionPageCount: 2 },
      undefined,
      undefined,
      undefined,
      layoutContext(headerPart, '/word/header1.xml'),
      undefined,
      undefined,
      pageCtx
    );
  }

  test('HF page-relative anchor uses section margins not contentWidth as page height', () => {
    const story = headerWithAnchor(HF_PAGE);
    const drawing = story.anchoredDrawings![0]!;
    expect(drawing.x).toBeCloseTo(-72, 1);
    expect(drawing.y).toBeCloseTo(-72, 1);
  });

  test('HF inside/outside parity uses target page number on even pages', () => {
    const oddStory = headerWithAnchor({ ...HF_PAGE, pageNumber: 1 });
    const evenStory = headerWithAnchor({ ...HF_PAGE, pageNumber: 2 });
    const odd = load(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:p><w:r><w:drawing>${anchorCore({
          positionH:
            '<wp:positionH relativeFrom="margin"><wp:align>inside</wp:align></wp:positionH>',
        })}</w:drawing></w:r></w:p></w:hdr>`,
      '/word/h-odd.xml'
    );
    const even = load(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:p><w:r><w:drawing>${anchorCore({
          positionH:
            '<wp:positionH relativeFrom="margin"><wp:align>inside</wp:align></wp:positionH>',
        })}</w:drawing></w:r></w:p></w:hdr>`,
      '/word/h-even.xml'
    );
    const oddDrawing = layoutHeaderFooterStory(
      odd,
      468,
      measurer,
      'prod',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      layoutContext(odd, '/word/h-odd.xml'),
      undefined,
      undefined,
      { ...HF_PAGE, pageNumber: 1 }
    ).anchoredDrawings![0]!;
    const evenDrawing = layoutHeaderFooterStory(
      even,
      468,
      measurer,
      'prod',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      layoutContext(even, '/word/h-even.xml'),
      undefined,
      undefined,
      { ...HF_PAGE, pageNumber: 2 }
    ).anchoredDrawings![0]!;
    expect(oddDrawing.x).toBeCloseTo(0, 1);
    expect(evenDrawing.x).toBeCloseTo(468 - WIDTH, 1);
    expect(oddStory.flowHeight).toBeLessThan(792);
    expect(evenStory.flowHeight).toBeLessThan(792);
  });

  test('remapPage shifts HF box without double-shifting story-relative anchor y', () => {
    const story = headerWithAnchor(HF_PAGE);
    const furniture: PageFurniture = {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([['default', story]]),
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
    const baselineY = page.header!.anchoredDrawings![0]!.y;
    const remapped = remapPage(page, 5, 900);
    expect(remapped.header!.box.y).toBe(page.header!.box.y + (900 - page.box.y));
    expect(remapped.header!.anchoredDrawings![0]!.y).toBeCloseTo(baselineY, 3);
  });
});

describe('task 7 fix round 2 — tables and lifecycle', () => {
  test('preflight row measure does not publish anchored drawings', () => {
    const doc = bodyDoc(
      '<w:tbl><w:tr><w:trPr><w:trHeight w:val="2400" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr>' +
        '<w:tcW w:w="5000" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>' +
        `<w:p>${run('T')}</w:p>` +
        `<w:p>${run('A')}<w:r><w:drawing>${anchorCore()}</w:drawing></w:r></w:p>` +
        '</w:tc></w:tr></w:tbl>'
    );
    const part = load(doc);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const anchors = layout.pages[0]!.anchoredDrawings ?? [];
    expect(anchors).toHaveLength(1);
    const ids = anchors.map((drawing) => drawing.drawingNodeId);
    expect(new Set(ids).size).toBe(1);
  });

  test('split anchor paragraph publishes exactly one record on anchor page', () => {
    const part = load(
      bodyDoc(
        `<w:p>${run('x '.repeat(800))}<w:r><w:drawing>${anchorCore({
          positionV:
            '<wp:positionV relativeFrom="line"><wp:posOffset>0</wp:posOffset></wp:positionV>',
        })}</w:drawing></w:r></w:p>`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 80, height: 36, margin: { top: 4, right: 4, bottom: 4, left: 4 } },
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    const pagesWithAnchors = layout.pages.filter(
      (page) => (page.anchoredDrawings?.length ?? 0) > 0
    );
    expect(pagesWithAnchors).toHaveLength(1);
    const host = pagesWithAnchors[0]!;
    expect(host.anchoredDrawings).toHaveLength(1);
    const paragraphIds = paragraphFragmentsOf(host).map((fragment) => fragment.paragraphId);
    expect(new Set(paragraphIds).size).toBe(paragraphIds.length);
  });

  test('incremental relayout on same open page preserves anchor prefix by identity', () => {
    const session = createLayoutSession();
    const part = load(
      bodyDoc(
        `<w:p>${run('keep')}</w:p>` +
          `<w:p>${run('A')}<w:r><w:drawing>${anchorCore()}</w:drawing></w:r></w:p>` +
          `<w:p>${run('tail')}</w:p>`
      )
    );
    const opts = { measurer, session, inlineDrawingLayout: layoutContext(part) };
    const first = layoutSemanticDocument(part, 1, opts);
    const second = layoutSemanticDocument(part, 2, opts);
    expect(second.pages[0]).toBe(first.pages[0]);
    expect(second.pages[0]!.anchoredDrawings![0]!.x).toBeCloseTo(
      first.pages[0]!.anchoredDrawings![0]!.x,
      3
    );
  });

  test('continuous section merges anchors onto shared page', () => {
    const part = load(
      bodyDoc(
        `<w:p>${run('one')}</w:p>` +
          `<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/></w:sectPr></w:pPr>` +
          `${run('A')}<w:r><w:drawing>${anchorCore()}</w:drawing></w:r></w:p>` +
          `<w:p>${run('two')}</w:p>` +
          `<w:p>${run('B')}<w:r><w:drawing>${anchorCore({
            positionH:
              '<wp:positionH relativeFrom="margin"><wp:posOffset>12700</wp:posOffset></wp:positionH>',
          })}</w:drawing></w:r></w:p>`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]!.anchoredDrawings?.length).toBe(2);
  });
});

describe('task 7 fix round 2 — layer-aware hit order', () => {
  test('front anchor wins over glyph text; behind anchor yields to glyphs', () => {
    const part = load(
      bodyDoc(
        `<w:p>${run('TEXT')}<w:r><w:drawing>${anchorCore({
          anchorAttrs:
            'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="2"',
          positionH:
            '<wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionH>',
          positionV:
            '<wp:positionV relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionV>',
        })}</w:drawing></w:r>` +
          `<w:r><w:drawing>${anchorCore({
            anchorAttrs:
              'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="1" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1"',
            positionH:
              '<wp:positionH relativeFrom="margin"><wp:posOffset>914400</wp:posOffset></wp:positionH>',
            positionV:
              '<wp:positionV relativeFrom="margin"><wp:posOffset>914400</wp:posOffset></wp:positionV>',
          })}</w:drawing></w:r></w:p>`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const front = layout.pages[0]!.anchoredDrawings!.find((drawing) => !drawing.behindDocument)!;
    const behind = layout.pages[0]!.anchoredDrawings!.find((drawing) => drawing.behindDocument)!;
    const frontHit = hitTestPage(layout, 0, {
      x: front.hitBounds.x + 2,
      y: front.hitBounds.y + 2,
    });
    expect(frontHit?.drawing?.drawingNodeId).toBe(front.drawingNodeId);
    const textHit = hitTestPage(layout, 0, { x: 2, y: 5 });
    expect(textHit?.drawing?.drawingNodeId).toBe(front.drawingNodeId);
    const behindOnly = hitTestPage(layout, 0, {
      x: behind.hitBounds.x + behind.hitBounds.width - 2,
      y: behind.hitBounds.y + 2,
    });
    expect(behindOnly?.drawing?.drawingNodeId).toBe(behind.drawingNodeId);
  });

  test('overlapping front anchors prefer higher relativeHeight', () => {
    const part = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          anchorAttrs:
            'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1"',
          positionH:
            '<wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionH>',
          positionV:
            '<wp:positionV relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionV>',
        })}</w:drawing></w:r>` +
          `<w:r><w:drawing>${anchorCore({
            anchorAttrs:
              'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="9"',
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
    const top = layout.pages[0]!.anchoredDrawings!.find((drawing) => drawing.relativeHeight === 9)!;
    const hit = hitTestPage(layout, 0, { x: top.hitBounds.x + 2, y: top.hitBounds.y + 2 });
    expect(hit?.drawing?.drawingNodeId).toBe(top.drawingNodeId);
  });

  test('header furniture anchor remains hittable in sheet coordinates after remap', () => {
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
    const story = layoutHeaderFooterStory(
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
      layoutContext(headerPart, '/word/header1.xml'),
      undefined,
      undefined,
      HF_PAGE
    );
    const furniture: PageFurniture = {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([['default', story]]),
      footers: new Map(),
    };
    const part = load(bodyDoc(`<w:p>${run('body')}</w:p>`));
    let layout = layoutSemanticDocument(part, 1, {
      measurer,
      furniture,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    layout = { ...layout, pages: [remapPage(layout.pages[0]!, 0, 0)] };
    const page = layout.pages[0]!;
    const hfDrawing = page.header!.anchoredDrawings![0]!;
    const sheetX = page.header!.box.x + hfDrawing.hitBounds.x + 2;
    const sheetY = page.header!.box.y + hfDrawing.hitBounds.y + 2;
    const hit = hitTestSheet(layout, { x: sheetX, y: sheetY });
    expect(hit?.drawing?.drawingNodeId).toBe(hfDrawing.drawingNodeId);
  });
});
