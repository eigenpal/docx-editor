// The text of a shape in a canvas (`wpc:wpc`) or a group (`wpg:wgp`) lays out in the text
// rectangle of the shape's geometry (`a:rect`, ECMA-376 Part 1, 20.1.9.22), as the text of a
// top-level shape does.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument, type SemanticLayout } from '../index.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import type { GroupTextboxStoryRecord } from '../group-textbox-layout.ts';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const WPC = 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas';
const NS = `xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}" xmlns:wpg="${WPG}" xmlns:wpc="${WPC}"`;

const PT = 12_700;
/** The member box: 120pt by 72pt. */
const CX = 120;
const CY = 72;

interface ShapeOptions {
  /** `a:xfrm` attributes, such as ` flipH="1"`. */
  readonly xfrm?: string;
  /** `wps:bodyPr` attributes after the zero insets. */
  readonly body?: string;
  /** Outline width in points; 0 for no outline. */
  readonly linePt?: number;
  readonly insets?: string;
}

const NO_INSETS = 'lIns="0" tIns="0" rIns="0" bIns="0"';
const preset = (name: string, guides = '') =>
  `<a:prstGeom prst="${name}"><a:avLst>${guides}</a:avLst></a:prstGeom>`;
/** A rectangle whose text rectangle is its right three quarters and its lower two thirds. */
const CUSTOM =
  '<a:custGeom><a:avLst/><a:gdLst><a:gd name="il" fmla="*/ w 1 4"/><a:gd name="it" fmla="*/ h 1 3"/></a:gdLst>' +
  '<a:rect l="il" t="it" r="r" b="b"/><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo>' +
  '<a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="100" y="100"/></a:lnTo><a:lnTo><a:pt x="0" y="100"/></a:lnTo>' +
  '<a:close/></a:path></a:pathLst></a:custGeom>';

function shape(geometry: string, x: number, y: number, options: ShapeOptions = {}): string {
  const line =
    options.linePt === 0
      ? '<a:ln><a:noFill/></a:ln>'
      : `<a:ln w="${(options.linePt ?? 1) * PT}"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>`;
  return (
    '<wps:wsp><wps:cNvPr id="3" name="S"/><wps:cNvSpPr/><wps:spPr>' +
    `<a:xfrm${options.xfrm ?? ''}><a:off x="${x * PT}" y="${y * PT}"/><a:ext cx="${CX * PT}" cy="${CY * PT}"/></a:xfrm>` +
    `${geometry}<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>${line}</wps:spPr>` +
    '<wps:txbx><w:txbxContent><w:p><w:r><w:t>ab</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
    `<wps:bodyPr wrap="square" ${options.insets ?? NO_INSETS}${options.body ?? ''}><a:noAutofit/></wps:bodyPr></wps:wsp>`
  );
}

function inline(uri: string, widthPt: number, heightPt: number, graphic: string): string {
  return (
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${widthPt * PT}" cy="${heightPt * PT}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    '<wp:docPr id="1" name="D"/><wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${uri}">${graphic}</a:graphicData></a:graphic>` +
    '</wp:inline></w:drawing></w:r>'
  );
}

/** A canvas with one member at (10pt, 10pt). */
const canvas = (member: string) =>
  inline(WPC, CX + 20, CY + 20, `<wpc:wpc><wpc:bg/><wpc:whole/>${member}</wpc:wpc>`);

/** A group with one member at (10pt, 10pt) of its child space. */
function group(member: string, options: { xfrm?: string; scaleX?: number; scaleY?: number } = {}) {
  const [chx, chy] = [CX + 20, CY + 20];
  const [cx, cy] = [chx * (options.scaleX ?? 1), chy * (options.scaleY ?? 1)];
  return inline(
    WPG,
    cx,
    cy,
    `<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm${options.xfrm ?? ''}><a:off x="0" y="0"/>` +
      `<a:ext cx="${cx * PT}" cy="${cy * PT}"/><a:chOff x="0" y="0"/><a:chExt cx="${chx * PT}" cy="${chy * PT}"/>` +
      `</a:xfrm></wpg:grpSpPr>${member}</wpg:wgp>`
  );
}

function documentPart(run: string): OoxmlPart {
  const doc = readOoxmlPart(
    `<w:document ${NS}><w:body><w:p>${run}</w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!doc.ok) throw new Error(doc.reason);
  return doc.part;
}

function layout(run: string): SemanticLayout {
  const part = documentPart(run);
  const atoms = indexInlineDrawingProjectionsInPart(part);
  const context: InlineDrawingLayoutContext = {
    ownerPartName: part.name,
    projectionForAtom: (atomId) => atoms.get(atomId) ?? null,
    project: (node) =>
      atoms.get(node.id) ??
      projectDrawing(node, { ownerPartName: part.name, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () =>
      Object.freeze({
        kind: 'unrenderable' as const,
        partName: null,
        mime: 'unknown' as const,
        reason: 'unsupported-format' as const,
      }),
  };
  return layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    producer: 'test',
    inlineDrawingLayout: context,
  });
}

function drawingOf(run: string) {
  const page = layout(run).pages[0]!;
  for (const fragment of page.fragments) {
    if (fragment.kind !== 'paragraph') continue;
    for (const line of fragment.lines) if (line.drawings?.[0]) return line.drawings[0];
  }
  throw new Error('no inline drawing');
}

function member(run: string): GroupTextboxStoryRecord {
  const stories = drawingOf(run).groupTextboxStories;
  if (!stories?.[0]) throw new Error('no member story');
  return stories[0];
}

/** The text area of a member in its box: left, top, width and height, in points. */
function area(record: GroupTextboxStoryRecord) {
  const { contentOffset, contentWidth, contentHeight } = record.story;
  return [contentOffset.x, contentOffset.y, contentWidth, contentHeight].map(
    (value) => Math.round(value * 100) / 100
  );
}

const TRIANGLE = preset('triangle');
const RIGHT_TRIANGLE = preset('rtTriangle');

for (const [name, host] of [
  ['canvas', canvas],
  ['group', group],
] as const) {
  describe(`a shape in a ${name}`, () => {
    test('a triangle keeps its text in the lower half, between the quarter lines', () => {
      const record = member(host(shape(TRIANGLE, 10, 10, { linePt: 0 })));
      expect(record.box).toEqual({ x: 10, y: 10, width: CX, height: CY });
      expect(area(record)).toEqual([CX / 4, CY / 2, CX / 2, CY / 2]);
    });

    test('an ellipse keeps its text in the inscribed rectangle', () => {
      const inset = (side: number) => (side / 2) * (1 - Math.SQRT1_2);
      const [x, y, width, height] = area(
        member(host(shape(preset('ellipse'), 10, 10, { linePt: 0 })))
      );
      expect(x).toBeCloseTo(inset(CX), 1);
      expect(y).toBeCloseTo(inset(CY), 1);
      expect(width).toBeCloseTo(CX - 2 * inset(CX), 1);
      expect(height).toBeCloseTo(CY - 2 * inset(CY), 1);
    });

    test('a custom geometry keeps its text in its `a:rect`', () => {
      const record = member(host(shape(CUSTOM, 10, 10, { linePt: 0 })));
      expect(area(record)).toEqual([CX / 4, CY / 3, (CX * 3) / 4, (CY * 2) / 3]);
    });

    test('the body insets and the inner half of the outline add to the text rectangle', () => {
      const record = member(
        host(
          shape(TRIANGLE, 10, 10, {
            linePt: 6,
            insets: 'lIns="25400" tIns="12700" rIns="0" bIns="0"',
          })
        )
      );
      // 2pt left and 1pt top insets, and 3pt of outline on each side.
      expect(area(record)).toEqual([CX / 4 + 5, CY / 2 + 4, CX / 2 - 8, CY / 2 - 7]);
    });

    test('a rectangle keeps the whole box, less the inner half of its outline', () => {
      expect(area(member(host(shape(preset('rect'), 10, 10, { linePt: 6 }))))).toEqual([
        3,
        3,
        CX - 6,
        CY - 6,
      ]);
      expect(area(member(host(shape(preset('rect'), 10, 10, { linePt: 0 }))))).toEqual([
        0,
        0,
        CX,
        CY,
      ]);
    });

    // A right triangle names the rectangle from (w/12, 7h/12) to (7w/12, 11h/12).
    const RECT = { left: CX / 12, top: (CY * 7) / 12, right: (CX * 5) / 12, bottom: CY / 12 };
    const WIDTH = CX / 2;
    const HEIGHT = CY / 3;

    test('a right triangle names an off-centre rectangle', () => {
      const record = member(host(shape(RIGHT_TRIANGLE, 10, 10, { linePt: 0 })));
      expect(area(record)).toEqual([RECT.left, RECT.top, WIDTH, HEIGHT]);
      expect(record.rotationDegrees).toBe(0);
    });

    test('a horizontal flip mirrors the rectangle and keeps the text readable', () => {
      const record = member(host(shape(RIGHT_TRIANGLE, 10, 10, { linePt: 0, xfrm: ' flipH="1"' })));
      expect(area(record)).toEqual([RECT.right, RECT.top, WIDTH, HEIGHT]);
      expect(record.rotationDegrees).toBe(0);
    });

    test('a vertical flip mirrors the rectangle and turns the text upside down', () => {
      const record = member(host(shape(RIGHT_TRIANGLE, 10, 10, { linePt: 0, xfrm: ' flipV="1"' })));
      // The story lays out in the mirrored rectangle and then turns a half turn with the box.
      expect(area(record)).toEqual([RECT.left, RECT.bottom, WIDTH, HEIGHT]);
      expect(record.rotationDegrees).toBe(180);
    });

    test('a turned shape turns its text rectangle with it', () => {
      const record = member(
        host(shape(RIGHT_TRIANGLE, 10, 10, { linePt: 0, xfrm: ' rot="5400000"' }))
      );
      expect(area(record)).toEqual([RECT.left, RECT.top, WIDTH, HEIGHT]);
      expect(record.rotationDegrees).toBe(90);
    });

    test('upright text in a quarter-turned shape swaps the sides of its area about its centre', () => {
      const record = member(
        host(
          shape(RIGHT_TRIANGLE, 10, 10, { linePt: 0, xfrm: ' rot="5400000"', body: ' upright="1"' })
        )
      );
      const centre = { x: RECT.left + WIDTH / 2, y: RECT.top + HEIGHT / 2 };
      expect(area(record)).toEqual([centre.x - HEIGHT / 2, centre.y - WIDTH / 2, HEIGHT, WIDTH]);
      expect(record.rotationDegrees).toBe(0);
    });

    test('vertical text lays out across the rectangle and turns a quarter', () => {
      const record = member(
        host(shape(RIGHT_TRIANGLE, 10, 10, { linePt: 0, body: ' vert="vert"' }))
      );
      // The box swaps its sides about its centre; the rectangle's edges turn with the text.
      expect(record.box).toEqual({
        x: 10 + (CX - CY) / 2,
        y: 10 + (CY - CX) / 2,
        width: CY,
        height: CX,
      });
      expect(area(record)).toEqual([RECT.top, RECT.right, HEIGHT, WIDTH]);
      expect(record.rotationDegrees).toBe(90);
    });

    // These modes turn the text a quarter clockwise, with the first line at the left
    // (ST_TextVerticalType, ECMA-376 Part 1, 20.1.10.83).
    for (const mode of ['wordArtVert', 'wordArtVertRtl', 'mongolianVert']) {
      test(`${mode} text turns a quarter and starts at the left of the rectangle`, () => {
        const turned = (body: string) =>
          member(host(shape(RIGHT_TRIANGLE, 10, 10, { linePt: 0, body })));
        const record = turned(` vert="${mode}"`);
        const plain = turned(' vert="vert"');
        expect(record.box).toEqual(plain.box);
        expect(record.rotationDegrees).toBe(90);
        // The left of the turned text is the bottom of the story before the turn: the text
        // ends there, where `vert` text with a bottom anchor ends.
        const { contentOffset, flowHeight } = record.story;
        expect(contentOffset.x).toBeCloseTo(RECT.top, 6);
        expect(contentOffset.y + flowHeight).toBeCloseTo(RECT.right + WIDTH, 6);
        // A bottom anchor puts it at the right, where `vert` text starts.
        const anchored = turned(` vert="${mode}" anchor="b"`);
        expect(anchored.story.contentOffset.y).toBeCloseTo(plain.story.contentOffset.y, 6);
      });
    }
  });
}

describe('a shape in a transformed group', () => {
  const RECT = { left: CX / 12, top: (CY * 7) / 12, right: (CX * 5) / 12, bottom: CY / 12 };

  test('a horizontal flip of the group mirrors the text rectangle', () => {
    const record = member(
      group(shape(RIGHT_TRIANGLE, 10, 10, { linePt: 0 }), { xfrm: ' flipH="1"' })
    );
    expect(area(record).slice(0, 2)).toEqual([RECT.right, RECT.top]);
    expect(record.rotationDegrees).toBe(0);
  });

  test('a vertical flip of the group mirrors the rectangle and turns the text upside down', () => {
    const record = member(
      group(shape(RIGHT_TRIANGLE, 10, 10, { linePt: 0 }), { xfrm: ' flipV="1"' })
    );
    expect(area(record).slice(0, 2)).toEqual([RECT.left, RECT.bottom]);
    expect(record.rotationDegrees).toBe(180);
  });

  test('the flips of a group and of its member cancel', () => {
    const record = member(
      group(shape(RIGHT_TRIANGLE, 10, 10, { linePt: 0, xfrm: ' flipH="1"' }), {
        xfrm: ' flipH="1"',
      })
    );
    expect(area(record).slice(0, 2)).toEqual([RECT.left, RECT.top]);
  });

  test('a group that scales its axes unevenly evaluates the geometry at the scaled box', () => {
    // A round rectangle with the largest corners: the radius is half the shorter side.
    const round = preset('roundRect', '<a:gd name="adj" fmla="val 50000"/>');
    const record = member(
      group(shape(round, 10, 10, { linePt: 0 }), { scaleX: 1.5, scaleY: 0.75 })
    );
    expect(record.box).toEqual({ x: 15, y: 7.5, width: CX * 1.5, height: CY * 0.75 });
    // The corner radius follows the scaled height, 54pt, not the authored 72pt.
    const inset = CY * 0.75 * 0.5 * (1 - Math.SQRT1_2);
    const [x, y] = area(record);
    expect(x).toBeCloseTo(inset, 1);
    expect(y).toBeCloseTo(inset, 1);
  });
});
