// Task 7 fix round 4 — nested table anchors, vMerge re-resolve, column ownership,
// layoutInCell frames, physical clipping, caps character boundary, HF memo geometry,
// incremental checkpoint differential (strict TDD).

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
import type { TextMeasurer } from '../semantic-records.ts';
import { emuToPoints } from '../drawing-layout.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
  type PageFurniture,
} from '../semantic-layout.ts';

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
const runCaps = (text: string) => `<w:r><w:rPr><w:caps/></w:rPr><w:t>${text}</w:t></w:r>`;

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

describe('task 7 fix round 4 — nested table deferred anchors', () => {
  test('nested table anchor publishes exactly once after finalized nested geometry', () => {
    const nestedAnchor = `<w:p>${run('N')}<w:r><w:drawing>${anchorCore({
      positionV: '<wp:positionV relativeFrom="margin"><wp:align>bottom</wp:align></wp:positionV>',
    })}</w:drawing></w:r></w:p>`;
    const doc = bodyDoc(
      '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
        '<w:tbl><w:tr><w:trPr><w:trHeight w:val="2400" w:hRule="atLeast"/></w:trPr>' +
        `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${nestedAnchor}</w:tc></w:tr></w:tbl>` +
        '</w:tc></w:tr></w:tbl>'
    );
    const part = load(doc);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const anchors = layout.pages.flatMap((p) => p.anchoredDrawings ?? []);
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0]!;
    expect(Number.isFinite(anchor.y)).toBe(true);
    expect(anchor.y).toBeGreaterThan(0);
    expect(anchor.y + HEIGHT).toBeLessThan(200);
  });
});

describe('task 7 fix round 4 — vMerge anchor re-resolve', () => {
  test('multi-row vMerge bottom anchor resolves against merged cell box not first row', () => {
    const doc = bodyDoc(
      '<w:tbl>' +
        '<w:tr><w:trPr><w:trHeight w:val="720" w:hRule="atLeast"/></w:trPr>' +
        '<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:vMerge w:val="restart"/></w:tcPr>' +
        `<w:p>${run('A')}<w:r><w:drawing>${anchorCore({
          positionV:
            '<wp:positionV relativeFrom="margin"><wp:align>bottom</wp:align></wp:positionV>',
        })}</w:drawing></w:r></w:p>` +
        '</w:tc></w:tr>' +
        '<w:tr><w:trPr><w:trHeight w:val="720" w:hRule="atLeast"/></w:trPr>' +
        '<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:vMerge/></w:tcPr>' +
        `<w:p>${run('continue')}</w:p>` +
        '</w:tc></w:tr>' +
        '</w:tbl>'
    );
    const part = load(doc);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const anchor = layout.pages[0]!.anchoredDrawings![0]!;
    const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table')!;
    expect(table?.kind).toBe('table');
    const mergedCell = table.rows[0]!.cells[0]!;
    const cellBottom = mergedCell.box.y + mergedCell.box.height;
    expect(mergedCell.box.height).toBeGreaterThan((720 / 72) * 2);
    expect(anchor.y + HEIGHT).toBeCloseTo(cellBottom, 0);
  });

  test('vMerge center frame re-resolves vertically within merged span', () => {
    const doc = bodyDoc(
      '<w:tbl>' +
        '<w:tr><w:trPr><w:trHeight w:val="600" w:hRule="exact"/></w:trPr>' +
        '<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:vMerge w:val="restart"/><w:vAlign w:val="center"/></w:tcPr>' +
        `<w:p>${run('A')}<w:r><w:drawing>${anchorCore({
          positionV:
            '<wp:positionV relativeFrom="margin"><wp:align>center</wp:align></wp:positionV>',
        })}</w:drawing></w:r></w:p>` +
        '</w:tc></w:tr>' +
        '<w:tr><w:trPr><w:trHeight w:val="600" w:hRule="exact"/></w:trPr>' +
        '<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:vMerge/></w:tcPr>' +
        `<w:p>${run('continue')}</w:p>` +
        '</w:tc></w:tr>' +
        '</w:tbl>'
    );
    const part = load(doc);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const anchor = layout.pages[0]!.anchoredDrawings![0]!;
    const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table')!;
    const mergedCell = table!.rows[0]!.cells[0]!;
    const cellMid = mergedCell.box.y + mergedCell.box.height / 2;
    expect(anchor.y + HEIGHT / 2).toBeCloseTo(cellMid, 0);
  });
});

describe('task 7 fix round 4 — column placement ownership', () => {
  test('paragraph fragment crossing columns uses column 2 x for anchor and lines', () => {
    const filler = run('word '.repeat(12));
    const part = load(
      bodyDoc(
        `<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>` +
          `<w:p>${filler}</w:p>` +
          `<w:p>${run('x '.repeat(40))}<w:r><w:drawing>${anchorCore({
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
    const columnWidth = (180 - 36) / 2;
    const column2X = columnWidth + 36;
    const anchor = layout.pages[0]!.anchoredDrawings![0]!;
    expect(anchor.x).toBeGreaterThan(columnWidth);
    expect(anchor.x).toBeCloseTo(column2X, 0);
    const para = layout.pages[0]!.fragments.find(
      (f) => f.kind === 'paragraph' && (f.anchoredDrawings?.length ?? 0) >= 0
    );
    const anchorPara = layout.pages[0]!.fragments.filter((f) => f.kind === 'paragraph').pop()!;
    expect(anchorPara.kind).toBe('paragraph');
    expect(anchorPara.box.x).toBeGreaterThan(columnWidth);
    expect(anchorPara.lines[anchorPara.lines.length - 1]!.box.x).toBeGreaterThan(columnWidth);
  });
});

describe('task 7 fix round 4 — layoutInCell frame matrix', () => {
  const cellFrameCases = [
    ['page', 'top', 'top'],
    ['page', 'bottom', 'bottom'],
    ['page', 'center', 'center'],
    ['margin', 'top', 'top'],
    ['margin', 'bottom', 'bottom'],
    ['topMargin', 'top', 'top'],
    ['bottomMargin', 'bottom', 'bottom'],
  ] as const;

  test.each(cellFrameCases)(
    'layoutInCell resolves vertical %s align %s against cell and clips',
    (frame, align) => {
      const doc = bodyDoc(
        '<w:tbl><w:tr><w:trPr><w:trHeight w:val="1800" w:hRule="exact"/></w:trPr>' +
          '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' +
          `<w:p><w:r><w:drawing>${anchorCore({
            positionV: `<wp:positionV relativeFrom="${frame}"><wp:align>${align}</wp:align></wp:positionV>`,
          })}</w:drawing></w:r></w:p></w:tc></w:tr></w:tbl>`
      );
      const part = load(doc);
      const layout = layoutSemanticDocument(part, 1, {
        measurer,
        inlineDrawingLayout: layoutContext(part),
        geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
      });
      const anchor = layout.pages[0]!.anchoredDrawings![0]!;
      const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table')!;
      const cell = table!.rows[0]!.cells[0]!;
      expect(anchor.layoutInCell).toBe(true);
      expect(anchor.y).toBeGreaterThanOrEqual(cell.box.y - 0.01);
      expect(anchor.y + anchor.height).toBeLessThanOrEqual(cell.box.y + cell.box.height + 0.01);
      expect(anchor.paintBounds.y).toBeGreaterThanOrEqual(cell.box.y - 0.01);
      expect(anchor.paintBounds.y + anchor.paintBounds.height).toBeLessThanOrEqual(
        cell.box.y + cell.box.height + 0.01
      );
    }
  );

  test('layoutInCell page-horizontal anchor clips within cell width', () => {
    const doc = bodyDoc(
      '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="1500" w:type="dxa"/></w:tcPr>' +
        `<w:p><w:r><w:drawing>${anchorCore({
          positionH: '<wp:positionH relativeFrom="page"><wp:align>left</wp:align></wp:positionH>',
        })}</w:drawing></w:r></w:p></w:tc></w:tr></w:tbl>`
    );
    const part = load(doc);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const anchor = layout.pages[0]!.anchoredDrawings![0]!;
    const cell = (
      layout.pages[0]!.fragments.find((f) => f.kind === 'table') as {
        rows: { cells: { box: { x: number; width: number } }[] }[];
      }
    ).rows[0]!.cells[0]!;
    expect(anchor.x).toBeGreaterThanOrEqual(cell.box.x - 0.01);
    expect(anchor.x).toBeLessThan(cell.box.x + cell.box.width);
    expect(anchor.paintBounds.x + anchor.paintBounds.width).toBeLessThanOrEqual(
      cell.box.x + cell.box.width + 0.01
    );
  });
});

describe('task 7 fix round 4 — physical page clipping', () => {
  test('page-bottom anchor paint clip uses physical content band not furniture shrink', () => {
    const headerPart = load(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:p>${run('header')}</w:p></w:hdr>`,
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
          anchorAttrs:
            'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="0" relativeHeight="1"',
          positionV: '<wp:positionV relativeFrom="page"><wp:align>bottom</wp:align></wp:positionV>',
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
    const physicalBottom = 792 - 72;
    expect(anchor.y + HEIGHT).toBeCloseTo(physicalBottom, 0);
    expect(anchor.paintBounds.y + anchor.paintBounds.height).toBeLessThanOrEqual(
      physicalBottom + 0.01
    );
    expect(anchor.y + HEIGHT).toBeGreaterThan(layout.pages[0]!.contentBox.height - 5);
  });
});

describe('task 7 fix round 4 — caps character boundary', () => {
  test('w:caps text uses displayed glyph widths for character anchor', () => {
    const part = load(
      bodyDoc(
        `<w:p>${runCaps('www')}<w:r><w:drawing>${anchorCore({
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
    expect(anchor.start).toBe(3);
    const lowercaseWidth = 3 * 3;
    const capsWidth = 3 * 12;
    expect(anchor.x).not.toBeCloseTo(lowercaseWidth, 0);
    expect(anchor.x).toBeCloseTo(capsWidth, 0);
  });
});

describe('task 7 fix round 4 — HF memo geometry', () => {
  test('shared header part relayouts when section page height and margins differ', () => {
    const headerPart = load(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:p><w:r><w:drawing>${anchorCore({
          positionV:
            '<wp:positionV relativeFrom="margin"><wp:align>bottom</wp:align></wp:positionV>',
        })}</w:drawing></w:r></w:p></w:hdr>`,
      '/word/header1.xml'
    );
    const hfCtx = layoutContext(headerPart, '/word/header1.xml');
    const tallStory = layoutHeaderFooterStory(
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
      hfCtx,
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
    const shortStory = layoutHeaderFooterStory(
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
      hfCtx,
      undefined,
      undefined,
      {
        pageNumber: 1,
        pageWidth: 612,
        pageHeight: 504,
        marginLeft: 36,
        marginRight: 36,
        marginTop: 36,
        marginBottom: 36,
      }
    );
    const tallY = tallStory.anchoredDrawings![0]!.y;
    const shortY = shortStory.anchoredDrawings![0]!.y;
    expect(tallY).not.toBeCloseTo(shortY, 0);
    expect(tallY).toBeGreaterThan(shortY);
  });
});

describe('task 7 fix round 4 — incremental checkpoint differential', () => {
  test('tail mutation relayouts while prefix anchor keeps identity on same open page', () => {
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

    const mutated = load(
      bodyDoc(
        `<w:p>${run('keep')}</w:p>` +
          `<w:p>${run('A')}<w:r><w:drawing>${anchorCore()}</w:drawing></w:r></w:p>` +
          `<w:p>${run('tail changed')}</w:p>`
      )
    );
    const second = layoutSemanticDocument(mutated, 2, {
      ...opts,
      inlineDrawingLayout: layoutContext(mutated),
    });

    expect(second.pages[0]!.anchoredDrawings![0]).toBe(anchorBefore);
    expect(second.pages[0]).not.toBe(first.pages[0]);
    const tailFragment = second.pages[0]!.fragments[second.pages[0]!.fragments.length - 1]!;
    expect(tailFragment.kind).toBe('paragraph');
    if (tailFragment.kind === 'paragraph') {
      expect(
        tailFragment.lines.some((line) => line.spans.some((s) => s.text?.includes('changed')))
      ).toBe(true);
    }
  });
});
