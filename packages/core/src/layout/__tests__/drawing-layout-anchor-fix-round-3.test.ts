// Task 7 fix round 3 — deferred table anchors, measured character frames, columns,
// physical page frames, HF attach-time parity, hits, incremental checkpoints,
// continuous sections, ST_PositiveCoordinate, split ownership (strict TDD).

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlDrawingNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { ST_POSITIVE_COORDINATE_MAX } from '../../store/package/ooxml-drawing-rules.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import type { TextMeasurer } from '../semantic-records.ts';
import { emuToPoints } from '../drawing-layout.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { hitTestSheet } from '../semantic-hit-test.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type PageFurniture,
} from '../semantic-layout.ts';
import { fragmentsOfParagraph, paragraphFragmentsOf } from '../semantic-records.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const measurer = createFixedMeasurer(6, 14);
const OWNER = '/word/document.xml';
const WIDTH = emuToPoints(914400);
const HEIGHT = emuToPoints(457200);

const proportional: TextMeasurer = {
  measure(text, _style) {
    let width = 0;
    for (const char of text) width += char === 'W' ? 12 : 3;
    return width;
  },
  lineMetrics: () => ({ height: 14, baseline: 11 }),
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
    readonly positionH?: string;
    readonly positionV?: string;
    readonly extent?: string;
  } = {}
): string {
  const anchorAttrs =
    options.anchorAttrs ??
    'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="952500"';
  const positionH =
    options.positionH ??
    '<wp:positionH relativeFrom="margin"><wp:align>left</wp:align></wp:positionH>';
  const positionV =
    options.positionV ??
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>';
  const extent = options.extent ?? 'cx="914400" cy="457200"';
  return (
    `<wp:anchor ${anchorAttrs}>` +
    '<wp:simplePos x="0" y="0"/>' +
    positionH +
    positionV +
    `<wp:extent ${extent}/>` +
    '<wp:wrapSquare wrapText="bothSides"/>' +
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

describe('task 7 fix round 3 — schema ST_PositiveCoordinate', () => {
  test('extent at max is typed; one-past-max demotes anchor', () => {
    const maxPart = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          extent: `cx="${ST_POSITIVE_COORDINATE_MAX}" cy="${ST_POSITIVE_COORDINATE_MAX}"`,
        })}</w:drawing></w:r></w:p>`
      )
    );
    expect(anchorKind(maxPart)).toBe('anchoredDrawing');

    const overPart = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          extent: `cx="${ST_POSITIVE_COORDINATE_MAX + 1}" cy="914400"`,
        })}</w:drawing></w:r></w:p>`
      )
    );
    expect(anchorKind(overPart)).toBe('generic');
  });
});

describe('task 7 fix round 3 — measured character frame', () => {
  test('proportional measurer places character anchor at glyph boundary not span midpoint', () => {
    const part = load(
      bodyDoc(
        `<w:p>${run('iiiWWW')}<w:r><w:drawing>${anchorCore({
          positionH:
            '<wp:positionH relativeFrom="character"><wp:align>left</wp:align></wp:positionH>',
        })}</w:drawing></w:r></w:p>`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer: proportional,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 200, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
    });
    const anchor = layout.pages[0]!.anchoredDrawings![0]!;
    expect(anchor.start).toBe(6);
    const interpolated = 10 + (120 * 4) / 7;
    expect(anchor.x).not.toBeCloseTo(interpolated, 0);
    expect(anchor.x).toBeCloseTo(3 * 3 + 3 * 12, 0);
  });
});

describe('task 7 fix round 3 — column ownership', () => {
  test('column frame resolves in column 2 after natural column fill', () => {
    const filler = run('word '.repeat(14));
    const part = load(
      bodyDoc(
        `<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>` +
          `<w:p>${filler}</w:p>` +
          `<w:p>${run('A')}<w:r><w:drawing>${anchorCore({
            positionH:
              '<wp:positionH relativeFrom="column"><wp:align>left</wp:align></wp:positionH>',
          })}</w:drawing></w:r></w:p>`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 200, height: 120, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
    });
    const anchor = layout.pages[0]!.anchoredDrawings![0]!;
    const columnWidth = (180 - 36) / 2;
    const column2X = columnWidth + 36;
    expect(anchor.x).toBeGreaterThan(columnWidth);
    expect(anchor.x).toBeCloseTo(column2X, 0);
  });
});

describe('task 7 fix round 3 — physical page/margin frames', () => {
  test('page-bottom margin anchor ignores body furniture reserve shrink', () => {
    const headerPart = load(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:p>${run('header line')}</w:p></w:hdr>`,
      '/word/header1.xml'
    );
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
      layoutContext(headerPart, '/word/header1.xml'),
      undefined,
      undefined,
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
    const bodyPart = load(
      bodyDoc(
        `<w:p><w:r><w:drawing>${anchorCore({
          positionV:
            '<wp:positionV relativeFrom="bottomMargin"><wp:align>bottom</wp:align></wp:positionV>',
        })}</w:drawing></w:r></w:p>`
      )
    );
    const furniture: PageFurniture = {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([['default', headerStory]]),
      footers: new Map(),
    };
    const layout = layoutSemanticDocument(bodyPart, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(bodyPart),
      furniture,
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const anchor = layout.pages[0]!.anchoredDrawings![0]!;
    const physicalBottom = 792 - 72 - 72;
    expect(anchor.y + HEIGHT).toBeCloseTo(physicalBottom, 0);
    expect(anchor.y + HEIGHT).toBeGreaterThan(layout.pages[0]!.contentBox.height - 10);
  });
});

describe('task 7 fix round 3 — table deferred anchors', () => {
  test('center vAlign uses finalized finite cell height', () => {
    const doc = bodyDoc(
      '<w:tbl><w:tr><w:trPr><w:trHeight w:val="2400" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr>' +
        '<w:tcW w:w="5000" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>' +
        `<w:p>${run('T')}</w:p>` +
        `<w:p>${run('A')}<w:r><w:drawing>${anchorCore({
          positionV:
            '<wp:positionV relativeFrom="margin"><wp:align>bottom</wp:align></wp:positionV>',
        })}</w:drawing></w:r></w:p>` +
        '</w:tc></w:tr></w:tbl>'
    );
    const part = load(doc);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const anchor = layout.pages[0]!.anchoredDrawings![0]!;
    expect(Number.isFinite(anchor.y)).toBe(true);
    expect(anchor.y).toBeGreaterThan(0);
    expect(anchor.y).toBeLessThan(200);
  });

  test('exact-height row keeps finite bottom anchor', () => {
    const doc = bodyDoc(
      '<w:tbl><w:tr><w:trPr><w:trHeight w:val="1440" w:hRule="exact"/></w:trPr><w:tc><w:tcPr>' +
        '<w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
        `<w:p>${run('A')}<w:r><w:drawing>${anchorCore({
          positionV:
            '<wp:positionV relativeFrom="margin"><wp:align>bottom</wp:align></wp:positionV>',
        })}</w:drawing></w:r></w:p>` +
        '</w:tc></w:tr></w:tbl>'
    );
    const part = load(doc);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const anchor = layout.pages[0]!.anchoredDrawings![0]!;
    expect(Number.isFinite(anchor.y + HEIGHT)).toBe(true);
  });
});

describe('task 7 fix round 3 — HF attach-time parity', () => {
  test('shared default header inside/outside alternates on pages 1 and 2 without PAGE field', () => {
    const headerPart = load(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:p><w:r><w:drawing>${anchorCore({
          positionH:
            '<wp:positionH relativeFrom="margin"><wp:align>inside</wp:align></wp:positionH>',
        })}</w:drawing></w:r></w:p></w:hdr>`,
      '/word/header1.xml'
    );
    const baseline = layoutHeaderFooterStory(
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
    const furniture: PageFurniture = {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([['default', baseline]]),
      footers: new Map(),
    };
    const body = load(
      bodyDoc(
        `<w:p>${run('one')}</w:p>` +
          `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` +
          `<w:p>${run('two')}</w:p>`
      )
    );
    const layout = layoutSemanticDocument(body, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(body),
      furniture,
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const page1 = layout.pages[0]!.header!.anchoredDrawings![0]!;
    const page2 = layout.pages[1]!.header!.anchoredDrawings![0]!;
    expect(page1.x).toBeCloseTo(0, 1);
    expect(page2.x).toBeCloseTo(468 - WIDTH, 1);
  });
});

describe('task 7 fix round 3 — HF hits outside flow box', () => {
  test('page-relative header anchor is hittable above the short story box', () => {
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
      layoutContext(headerPart, '/word/header1.xml'),
      undefined,
      undefined,
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
    const bodyPart = load(bodyDoc(`<w:p>${run('body')}</w:p>`));
    const layout = layoutSemanticDocument(bodyPart, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(bodyPart),
      furniture: {
        titlePage: false,
        evenAndOddHeaders: false,
        headers: new Map([['default', headerStory]]),
        footers: new Map(),
      },
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const page = layout.pages[0]!;
    const drawing = page.header!.anchoredDrawings![0]!;
    const sheetX = page.header!.box.x + drawing.hitBounds.x + 2;
    const sheetY = page.header!.box.y + drawing.hitBounds.y + 2;
    expect(sheetY).toBeLessThan(page.header!.box.y);
    const hit = hitTestSheet(layout, { x: sheetX, y: sheetY });
    expect(hit?.drawing?.drawingNodeId).toBe(drawing.drawingNodeId);
  });
});

describe('task 7 fix round 3 — incremental checkpoint', () => {
  test('changed tail on same open page preserves prefix anchor by identity', () => {
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
    const anchorBefore = first.pages[0]!.anchoredDrawings![0]!;
    const second = layoutSemanticDocument(part, 2, opts);
    expect(second.pages[0]!.anchoredDrawings![0]).toBe(anchorBefore);
  });
});

describe('task 7 fix round 3 — continuous sections', () => {
  test('following section marked continuous does not merge when prior is nextPage', () => {
    const part = load(
      bodyDoc(
        `<w:p>${run('one')}</w:p>` +
          `<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/></w:sectPr></w:pPr>${run('mid')}</w:p>` +
          `<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/></w:sectPr></w:pPr>` +
          `${run('A')}<w:r><w:drawing>${anchorCore()}</w:drawing></w:r></w:p>` +
          `<w:p>${run('two')}</w:p>`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    expect(layout.pages.length).toBeGreaterThan(1);
  });

  test('prior continuous merges anchors onto shared page', () => {
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

describe('task 7 fix round 3 — split ownership', () => {
  test('owning fragment range contains anchor.start exactly with one record', () => {
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
    const pagesWithAnchors = layout.pages.filter(
      (page) => (page.anchoredDrawings?.length ?? 0) > 0
    );
    expect(pagesWithAnchors).toHaveLength(1);
    const page = pagesWithAnchors[0]!;
    expect(page.anchoredDrawings).toHaveLength(1);
    const anchor = page.anchoredDrawings![0]!;
    const fragments = fragmentsOfParagraph(layout, anchor.anchorParagraphId);
    const owner = fragments.find(
      (fragment) => anchor.start >= fragment.range.start && anchor.start < fragment.range.end
    );
    expect(owner).toBeDefined();
    expect(
      layout.pages
        .flatMap((p) => p.anchoredDrawings ?? [])
        .filter((d) => d.drawingNodeId === anchor.drawingNodeId)
    ).toHaveLength(1);
  });
});
