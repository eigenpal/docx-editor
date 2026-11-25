// A group with a gradient fill (`a:gradFill`, ECMA-376 Part 1, 20.1.8.33) hands that fill to
// each member that says `a:grpFill` (CT_GroupFillProperties; Part 1, 20.1.8.35: the member "is
// part of a group and should inherit the fill properties of the group"). Such members paint
// ONE gradient that spans the box of the group that sets the fill, so each member shows its
// own part of it. The root group (`wpg:wgp`) spans the whole drawing extent. A nested group
// (`wpg:grpSp`, CT_WordprocessingGroup; Part 1, 20.4.2.32) with a gradient of its own spans its own
// box. A member with a fill of its own is not changed. The standard does not state the span;
// `spanningGroupGradient` records the rule.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI, type OoxmlPart } from '../index.ts';
import { projectDrawingsInPart } from '../package/drawing-projection.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';

/** Root child space: offset (100, 200), extent 3000 x 4000, drawn at 6000000 x 8000000 EMU. */
const SCALE = 2000;
const EXTENT = { cx: 3000 * SCALE, cy: 4000 * SCALE };

const GROUP_FILL = '<a:grpFill/>';
const GREEN = '<a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>';
/** A left-to-right gradient from red to blue. */
const GRADIENT =
  '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>' +
  '<a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>';

function parsePart(body: string): OoxmlPart {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:wps="${WPS}" xmlns:wpg="${WPG}"><w:body>${body}</w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

/** A rectangle member in the child space of its group. */
function box(x: number, y: number, cx: number, cy: number, fill: string): string {
  return (
    '<wps:wsp><wps:cNvPr id="3" name="Box"/><wps:cNvSpPr/><wps:spPr>' +
    `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}</wps:spPr><wps:bodyPr/></wps:wsp>`
  );
}

/** A nested group at (1100, 1200) sized 1000 x 2000 whose child space is 500 x 500 at 0. */
function nested(members: string, fill: string): string {
  return (
    '<wpg:grpSp><wpg:cNvPr id="9" name="Inner"/><wpg:cNvGrpSpPr/><wpg:grpSpPr>' +
    '<a:xfrm><a:off x="1100" y="1200"/><a:ext cx="1000" cy="2000"/>' +
    `<a:chOff x="0" y="0"/><a:chExt cx="500" cy="500"/></a:xfrm>${fill}</wpg:grpSpPr>` +
    `${members}</wpg:grpSp>`
  );
}
/** The nested box in the drawing extent: ((1100 - 100) * 2000, (1200 - 200) * 2000). */
const NESTED_BOX = { x: 1000 * SCALE, y: 1000 * SCALE, cx: 1000 * SCALE, cy: 2000 * SCALE };

function components(members: string, fill = '') {
  const drawing =
    '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="10" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    `<wp:extent cx="${EXTENT.cx}" cy="${EXTENT.cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    '<wp:wrapNone/><wp:docPr id="1" name="Group 1"/>' +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${EXTENT.cx}" cy="${EXTENT.cy}"/>` +
    `<a:chOff x="100" y="200"/><a:chExt cx="3000" cy="4000"/></a:xfrm>${fill}</wpg:grpSpPr>` +
    `${members}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
  const projections = projectDrawingsInPart(parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`));
  expect(projections).toHaveLength(1);
  expect(projections[0]!.diagnostics).toEqual([]);
  return projections[0]!.vectorShape?.components ?? [];
}

type Component = ReturnType<typeof components>[number];

/** The two ends of a linear gradient in the drawing extent, in EMU. */
function gradientLine(component: Component) {
  const gradient = component.fillGradient;
  if (!gradient || gradient.kind !== 'linear') throw new Error('no linear gradient');
  const [a, b, c, d, e, f] = gradient.matrix;
  const [x1, y1, x2, y2] = gradient.coords as readonly [number, number, number, number];
  const point = (x: number, y: number) => ({ x: a * x + c * y + e, y: b * x + d * y + f });
  return { from: point(x1, y1), to: point(x2, y2) };
}

function expectLine(
  component: Component,
  expected: Readonly<{ x: number; y: number; cx: number; cy: number }>
): void {
  // A left-to-right gradient runs along the middle of its box, from the left to the right edge.
  const { from, to } = gradientLine(component);
  expect(from.x).toBeCloseTo(expected.x, 3);
  expect(to.x).toBeCloseTo(expected.x + expected.cx, 3);
  expect(from.y).toBeCloseTo(expected.y + expected.cy / 2, 3);
  expect(to.y).toBeCloseTo(expected.y + expected.cy / 2, 3);
}

function left(component: Component): number {
  return Math.min(...component.subpathsEmu[0]!.map((point) => point.x));
}

describe('a gradient group fill', () => {
  test('two members that say a:grpFill paint one gradient over the whole extent', () => {
    const [first, second] = components(
      box(100, 200, 1000, 1000, GROUP_FILL) + box(2100, 3200, 1000, 1000, GROUP_FILL),
      GRADIENT
    );
    expect(first!.fillGradient?.stops.map((stop) => stop.hex)).toEqual(['FF0000', '0000FF']);
    // One placement for both members, so each shows its own part of the gradient.
    expect(second!.fillGradient).toEqual(first!.fillGradient);
    for (const component of [first!, second!]) {
      expectLine(component, { x: 0, y: 0, ...EXTENT });
    }
    // The members keep their own geometry: left third and right third of the extent.
    expect(left(first!)).toBe(0);
    expect(left(second!)).toBe(2000 * SCALE);
  });

  test('a member with a fill of its own keeps it', () => {
    const [solid, spanning, own] = components(
      box(600, 2100, 1000, 10, GREEN) +
        box(100, 200, 1000, 1000, GROUP_FILL) +
        box(2100, 200, 1000, 1000, GRADIENT),
      GRADIENT
    );
    expect(solid!.fillHex).toBe('00FF00');
    expect(solid!.fillGradient).toBeUndefined();
    expectLine(spanning!, { x: 0, y: 0, ...EXTENT });
    // A member that authors the same gradient itself paints it over its own box.
    expectLine(own!, { x: 2000 * SCALE, y: 0, cx: 1000 * SCALE, cy: 1000 * SCALE });
  });

  test('a nested group with a gradient of its own spans the nested box', () => {
    const members = box(0, 0, 100, 100, GROUP_FILL) + box(400, 400, 100, 100, GROUP_FILL);
    // The outer group has another fill: the nested gradient wins for the nested members.
    for (const outerFill of ['', GREEN]) {
      const [first, second] = components(nested(members, GRADIENT), outerFill);
      expect(second!.fillGradient).toEqual(first!.fillGradient);
      expectLine(first!, NESTED_BOX);
      expectLine(second!, NESTED_BOX);
    }
  });

  test('a nested group that says a:grpFill hands on the outer gradient over the extent', () => {
    const [inner, outer] = components(
      nested(box(0, 0, 100, 100, GROUP_FILL), GROUP_FILL) + box(100, 200, 1000, 1000, GROUP_FILL),
      GRADIENT
    );
    expect(inner!.fillGradient).toEqual(outer!.fillGradient);
    expectLine(inner!, { x: 0, y: 0, ...EXTENT });
    expect(left(inner!)).toBe(NESTED_BOX.x);
  });

  test('a solid group fill paints each member flat', () => {
    const [member] = components(box(100, 200, 1000, 1000, GROUP_FILL), GREEN);
    expect(member!.fillHex).toBe('00FF00');
    expect(member!.fillGradient).toBeUndefined();
  });
});
