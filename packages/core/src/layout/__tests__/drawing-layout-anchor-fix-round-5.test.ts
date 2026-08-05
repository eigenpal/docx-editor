// Task 7 final fix — table preflight sinks, column subtree shift, displayText parity,
// layoutInCell inside/outside cell parity, layout-authority part-name constant (strict TDD).

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
import { caretAt, hitTestSemantic } from '../semantic-interaction.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const measurer = createFixedMeasurer(6, 14);
const OWNER = '/word/document.xml';
const WIDTH = emuToPoints(914400);
const HEIGHT = emuToPoints(457200);
const ATOM = '\uFFFC';

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
    project: (node: OoxmlDrawingNode) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, { ownerPartName: owner, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () => READY,
  };
}

const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const runCaps = (text: string) => `<w:r><w:rPr><w:caps/></w:rPr><w:t>${text}</w:t></w:r>`;

function inlineDrawingInner(): string {
  return (
    '<w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="914400" cy="457200"/>' +
    '<wp:docPr id="1" name="pic"/>' +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}">` +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    '</a:graphicData></a:graphic></wp:inline></w:drawing>'
  );
}

function anchorCore(
  options: {
    readonly anchorAttrs?: string;
    readonly positionH?: string;
    readonly positionV?: string;
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
  return (
    `<wp:anchor ${anchorAttrs}>` +
    '<wp:simplePos x="0" y="0"/>' +
    positionH +
    positionV +
    '<wp:extent cx="914400" cy="457200"/>' +
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

describe('task 7 final — table preflight strips anchor sinks', () => {
  test('vMerge finalize geometry wins over preflight probe; dedupe keeps one exact record', () => {
    const doc = bodyDoc(
      '<w:tbl>' +
        '<w:tr><w:trPr><w:trHeight w:val="720" w:hRule="atLeast"/></w:trPr>' +
        '<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:vMerge w:val="restart"/><w:vAlign w:val="center"/></w:tcPr>' +
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
    const anchors = layout.pages[0]!.anchoredDrawings ?? [];
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0]!;
    const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table')!;
    const mergedCell = table!.rows[0]!.cells[0]!;
    const cellBottom = mergedCell.box.y + mergedCell.box.height;
    expect(mergedCell.box.height).toBeGreaterThan((720 / 72) * 2);
    expect(anchor.y + HEIGHT).toBeCloseTo(cellBottom, 0);
    expect(anchor.y).toBeGreaterThan(mergedCell.box.y + mergedCell.box.height / 3);
  });

  test('nested table preflight does not publish probe anchors to page collector', () => {
    const nestedAnchor = `<w:p>${run('N')}<w:r><w:drawing>${anchorCore({
      positionV: '<wp:positionV relativeFrom="margin"><wp:align>bottom</wp:align></wp:positionV>',
    })}</w:drawing></w:r></w:p>`;
    const doc = bodyDoc(
      '<w:tbl><w:tr><w:trPr><w:trHeight w:val="2400" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
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
    expect(new Set(anchors.map((a) => a.drawingNodeId)).size).toBe(1);
    expect(anchors[0]!.y + HEIGHT).toBeLessThan(200);
  });
});

describe('task 7 final — column offset shifts subtree once', () => {
  test('column 2 span, inline image, caret, and hit share one column x without double shift', () => {
    const filler = run('word '.repeat(12));
    const part = load(
      bodyDoc(
        `<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>` +
          `<w:p>${filler}</w:p>` +
          `<w:p>${run('xy ')}<w:r>${inlineDrawingInner()}</w:r>${run('z')}</w:p>`
      )
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 200, height: 120, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
    });
    const columnWidth = (180 - 36) / 2;
    const column2X = columnWidth + 36;
    const page = layout.pages[0]!;
    const para = page.fragments.filter((f) => f.kind === 'paragraph').pop()!;
    expect(para.kind).toBe('paragraph');
    expect(para.box.x).toBeGreaterThan(columnWidth);
    const line = para.lines[0]!;
    expect(line.box.x).toBeCloseTo(column2X, 0);
    const textSpan = line.spans.find((s) => s.text === 'xy ')!;
    expect(textSpan.box.x).toBeGreaterThan(columnWidth);
    expect(textSpan.box.x).toBeLessThan(column2X + columnWidth);
    const drawing = para.lines.flatMap((entry) => entry.drawings ?? [])[0]!;
    expect(drawing.x).toBeGreaterThan(columnWidth);
    expect(drawing.hitBounds.x).toBeGreaterThan(columnWidth);
    const pid = para.paragraphId;
    const caret = caretAt(layout, { paragraphId: pid, offset: 1 }, measurer);
    expect(caret).not.toBeNull();
    expect(caret!.x).toBeGreaterThan(columnWidth);
    const hit = hitTestSemantic(layout, {
      x: caret!.x + 0.5,
      y: caret!.y + caret!.height / 2,
      pageIndex: 0,
    });
    expect(hit).not.toBeNull();
    expect(hit!.position.offset).toBe(1);
    expect(hit!.x).toBeCloseTo(caret!.x, 0);
    expect(para.box.x).toBeCloseTo(column2X, 0);
    expect(line.box.x).toBeCloseTo(column2X, 0);
    expect(textSpan.box.x).toBeCloseTo(column2X, 0);
  });
});

describe('task 7 final — displayText parity for anchor, caret, and hit', () => {
  test('w:caps boundary: anchor, caret, and hit agree on displayed glyph width', () => {
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
    const page = layout.pages[0]!;
    const para = page.fragments.find((f) => f.kind === 'paragraph')!;
    expect(para?.kind).toBe('paragraph');
    const pid = para!.paragraphId;
    const anchor = page.anchoredDrawings![0]!;
    const capsWidth = 3 * 12;
    const lowercaseWidth = 3 * 3;
    expect(anchor.start).toBe(3);
    expect(anchor.x).toBeCloseTo(capsWidth, 0);
    expect(anchor.x).not.toBeCloseTo(lowercaseWidth, 0);
    const caret = caretAt(layout, { paragraphId: pid, offset: 3 }, proportional);
    expect(caret!.x).toBeCloseTo(capsWidth, 0);
    const hit = hitTestSemantic(layout, {
      x: capsWidth - 7,
      y: para!.lines[0]!.box.y + 5,
      pageIndex: 0,
    });
    expect(hit!.position.offset).toBe(2);
    expect(hit!.x).toBeGreaterThan(capsWidth - 15);
    expect(hit!.x).toBeLessThan(capsWidth);
  });
});

describe('task 7 final — layoutInCell inside/outside cell parity', () => {
  function layoutInCellInsideOutside(pageNumber: number) {
    const table =
      '<w:tbl><w:tr><w:trPr><w:trHeight w:val="1200" w:hRule="exact"/></w:trPr>' +
      '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' +
      `<w:p><w:r><w:drawing>${anchorCore({
        positionH:
          '<wp:positionH relativeFrom="insideMargin"><wp:align>inside</wp:align></wp:positionH>',
        positionV:
          '<wp:positionV relativeFrom="insideMargin"><wp:align>inside</wp:align></wp:positionV>',
      })}</w:drawing></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const lead =
      pageNumber > 1
        ? '<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/></w:sectPr></w:pPr>' +
          run('break') +
          '</w:p>'
        : '';
    const doc = bodyDoc(lead + table);
    const part = load(doc);
    return layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
  }

  test('layoutInCell inside align on odd page resolves to cell inner edge not page origin', () => {
    const layout = layoutInCellInsideOutside(1);
    const page = layout.pages[0]!;
    const anchor = page.anchoredDrawings![0]!;
    const cell = (
      page.fragments.find((f) => f.kind === 'table') as {
        rows: { cells: { box: { x: number; y: number; width: number; height: number } }[] }[];
      }
    ).rows[0]!.cells[0]!;
    expect(anchor.x).toBeCloseTo(cell.box.x, 0);
    expect(anchor.y).toBeCloseTo(cell.box.y, 0);
  });

  test('layoutInCell inside align on even page resolves to opposite cell inner edge', () => {
    const layout = layoutInCellInsideOutside(2);
    const page = layout.pages[1] ?? layout.pages[0]!;
    const anchor = page.anchoredDrawings![0]!;
    const cell = (
      page.fragments.find((f) => f.kind === 'table') as {
        rows: { cells: { box: { x: number; y: number; width: number; height: number } }[] }[];
      }
    ).rows[0]!.cells[0]!;
    expect(anchor.x + WIDTH).toBeCloseTo(cell.box.x + cell.box.width, 0);
    expect(anchor.y + HEIGHT).toBeCloseTo(cell.box.y + cell.box.height, 0);
  });

  test('layoutInCell outside align flips with odd/even against cell edges', () => {
    const doc = bodyDoc(
      '<w:tbl><w:tr><w:trPr><w:trHeight w:val="1200" w:hRule="exact"/></w:trPr>' +
        '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' +
        `<w:p><w:r><w:drawing>${anchorCore({
          positionH:
            '<wp:positionH relativeFrom="outsideMargin"><wp:align>outside</wp:align></wp:positionH>',
          positionV:
            '<wp:positionV relativeFrom="outsideMargin"><wp:align>outside</wp:align></wp:positionV>',
        })}</w:drawing></w:r></w:p></w:tc></w:tr></w:tbl>`
    );
    const part = load(doc);
    const oddLayout = layoutSemanticDocument(part, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(part),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const oddAnchor = oddLayout.pages[0]!.anchoredDrawings![0]!;
    const oddCell = (
      oddLayout.pages[0]!.fragments.find((f) => f.kind === 'table') as {
        rows: { cells: { box: { x: number; width: number; y: number; height: number } }[] }[];
      }
    ).rows[0]!.cells[0]!;
    expect(oddAnchor.x + WIDTH).toBeCloseTo(oddCell.box.x + oddCell.box.width, 0);

    const evenDoc = bodyDoc(
      '<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/></w:sectPr></w:pPr>' +
        `${run('pad')}</w:p>` +
        '<w:tbl><w:tr><w:trPr><w:trHeight w:val="1200" w:hRule="exact"/></w:trPr>' +
        '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' +
        `<w:p><w:r><w:drawing>${anchorCore({
          positionH:
            '<wp:positionH relativeFrom="outsideMargin"><wp:align>outside</wp:align></wp:positionH>',
          positionV:
            '<wp:positionV relativeFrom="outsideMargin"><wp:align>outside</wp:align></wp:positionV>',
        })}</w:drawing></w:r></w:p></w:tc></w:tr></w:tbl>`
    );
    const evenPart = load(evenDoc);
    const evenLayout = layoutSemanticDocument(evenPart, 1, {
      measurer,
      inlineDrawingLayout: layoutContext(evenPart),
      geometry: { width: 612, height: 792, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    });
    const evenPage = evenLayout.pages[1] ?? evenLayout.pages[0]!;
    const evenAnchor = evenPage.anchoredDrawings![0]!;
    const evenCell = (
      evenPage.fragments.find((f) => f.kind === 'table') as {
        rows: { cells: { box: { x: number; y: number } }[] }[];
      }
    ).rows[0]!.cells[0]!;
    expect(evenAnchor.x).toBeCloseTo(evenCell.box.x, 0);
    expect(evenAnchor.y).toBeCloseTo(evenCell.box.y, 0);
  });
});
