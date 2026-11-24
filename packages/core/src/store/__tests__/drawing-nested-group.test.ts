// A `wpg:wgp` group can hold `wpg:grpSp` groups of its own. A nested group places itself in
// its parent's child space by its `a:xfrm` (`off`/`ext`) and authors its members in its own
// child space (`chOff`/`chExt`). These tests pin where nested members land, that pictures,
// shapes, and text boxes paint together across levels, and the nested groups still refused.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI, type OoxmlPart } from '../index.ts';
import { projectDrawingsInPart } from '../package/drawing-projection.ts';
import { MAX_GROUP_NESTING_DEPTH } from '../package/drawing-group-members.ts';
import { textboxStoriesInPart } from '../package/textbox-stories.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';

/** Outer child space: offset (100, 200), extent 3000 x 4000, drawn at 6000000 x 8000000 EMU. */
const SCALE = 2000;

function parsePart(body: string): OoxmlPart {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:pic="${PIC}" xmlns:r="${R}" xmlns:wps="${WPS}" xmlns:wpg="${WPG}">` +
    `<w:body>${body}</w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function picture(x: number, y: number, cx: number, cy: number): string {
  return (
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
  );
}

function bar(x: number, y: number, fill = '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>') {
  return (
    '<wps:wsp><wps:cNvPr id="3" name="Bar"/><wps:cNvSpPr/><wps:spPr>' +
    `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="200" cy="10"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}</wps:spPr><wps:bodyPr/></wps:wsp>`
  );
}

/** A text box without fill or outline: it paints only its text. */
function label(x: number, y: number, text: string): string {
  return (
    '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr>' +
    `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="100" cy="400"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent></wps:txbx>` +
    '<wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" vert="vert270"/></wps:wsp>'
  );
}

interface NestedOptions {
  readonly xfrmAttributes?: string;
  readonly fill?: string;
  readonly hidden?: boolean;
  readonly xfrm?: string;
}

/** A nested group at (1100, 1200) sized 1000 x 2000 whose child space is 500 x 500 at 0. */
function nested(members: string, options: NestedOptions = {}): string {
  const xfrm =
    options.xfrm ??
    `<a:xfrm${options.xfrmAttributes ?? ''}><a:off x="1100" y="1200"/>` +
      '<a:ext cx="1000" cy="2000"/><a:chOff x="0" y="0"/><a:chExt cx="500" cy="500"/></a:xfrm>';
  return (
    `<wpg:grpSp><wpg:cNvPr id="9" name="Inner"${options.hidden ? ' hidden="1"' : ''}/>` +
    `<wpg:cNvGrpSpPr/><wpg:grpSpPr>${xfrm}${options.fill ?? ''}</wpg:grpSpPr>` +
    `${members}</wpg:grpSp>`
  );
}

function groupDrawing(members: string, fill = ''): string {
  return (
    '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="10" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="6000000" cy="8000000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapNone/><wp:docPr id="1" name="Group 1"/>' +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="6000000" cy="8000000"/>' +
    `<a:chOff x="100" y="200"/><a:chExt cx="3000" cy="4000"/></a:xfrm>${fill}</wpg:grpSpPr>` +
    `${members}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing>`
  );
}

function projectionOf(drawing: string) {
  const projections = projectDrawingsInPart(parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`));
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

function topLeft(projection: ReturnType<typeof projectionOf>, index = 0) {
  const points = projection.vectorShape!.components[index]!.subpathsEmu[0]!;
  return {
    x: Math.min(...points.map((point) => point.x)),
    y: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

// The nested child space maps 1 unit to 2 outer units across and 4 down, and its origin
// lands at outer (1100, 1200), which is extent ((1100 - 100) * 2000, (1200 - 200) * 2000).
const NESTED_X = 1000 * SCALE;
const NESTED_Y = 1000 * SCALE;
const NESTED_SCALE_X = 2 * SCALE;
const NESTED_SCALE_Y = 4 * SCALE;

describe('nested drawing groups', () => {
  test('a picture beside a nested group of a line and a label paints whole', () => {
    const projection = projectionOf(
      groupDrawing(picture(2000, 3500, 1000, 500) + nested(bar(100, 50) + label(0, 0, 'Label')))
    );
    expect(projection.groupPicture).toMatchObject({
      embeddedRelationshipId: 'rIdImg',
      frameEmu: { x: 1900 * SCALE, y: 3300 * SCALE, cx: 1000 * SCALE, cy: 500 * SCALE },
    });
    // The label paints nothing of its own, so the bar is the one vector member.
    expect(projection.vectorShape?.components).toHaveLength(1);
    expect(topLeft(projection)).toEqual({
      x: NESTED_X + 100 * NESTED_SCALE_X,
      y: NESTED_Y + 50 * NESTED_SCALE_Y,
      right: NESTED_X + 300 * NESTED_SCALE_X,
      bottom: NESTED_Y + 60 * NESTED_SCALE_Y,
    });
    const text = projection.groupTextboxes;
    expect(text).toHaveLength(1);
    // Bottom-to-top text lays out across the 100 x 400 member box and turns a quarter back.
    const box = { cx: 100 * NESTED_SCALE_X, cy: 400 * NESTED_SCALE_Y };
    expect(text![0]!.frameEmu).toEqual({
      x: NESTED_X + (box.cx - box.cy) / 2,
      y: NESTED_Y + (box.cy - box.cx) / 2,
      cx: box.cy,
      cy: box.cx,
    });
    expect(text![0]!.rotationDegrees).toBe(270);
    expect(projection.diagnostics.map((d) => d.code)).not.toContain('unsupported-graphic');
  });

  test('a nested group offset reads with surrounding whitespace', () => {
    const spaced =
      '<a:xfrm><a:off x=" 1100 " y="1200"/><a:ext cx="1000" cy="2000"/>' +
      '<a:chOff x="0" y="0"/><a:chExt cx="500" cy="500"/></a:xfrm>';
    const projection = projectionOf(groupDrawing(nested(bar(0, 0), { xfrm: spaced })));
    expect(topLeft(projection)).toMatchObject({ x: NESTED_X, y: NESTED_Y });
  });

  test('a nested group with a child offset maps its members from that offset', () => {
    const offset =
      '<a:xfrm><a:off x="1100" y="1200"/><a:ext cx="1000" cy="2000"/>' +
      '<a:chOff x="-50" y="25"/><a:chExt cx="500" cy="500"/></a:xfrm>';
    const projection = projectionOf(groupDrawing(nested(bar(-50, 25), { xfrm: offset })));
    expect(topLeft(projection)).toMatchObject({ x: NESTED_X, y: NESTED_Y });
  });

  test('groups nest more than one level deep', () => {
    // The inner group fills its parent's child space one to one.
    const inner =
      '<a:xfrm><a:off x="0" y="0"/><a:ext cx="500" cy="500"/>' +
      '<a:chOff x="0" y="0"/><a:chExt cx="500" cy="500"/></a:xfrm>';
    const projection = projectionOf(
      groupDrawing(bar(100, 200) + nested(nested(bar(100, 50), { xfrm: inner })))
    );
    expect(projection.vectorShape?.components).toHaveLength(2);
    expect(topLeft(projection, 0)).toMatchObject({ x: 0, y: 0 });
    expect(topLeft(projection, 1)).toMatchObject({
      x: NESTED_X + 100 * NESTED_SCALE_X,
      y: NESTED_Y + 50 * NESTED_SCALE_Y,
    });
  });

  test('a group fill inherits through a nested group', () => {
    const red = '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>';
    const projection = projectionOf(
      groupDrawing(nested(bar(0, 0, '<a:grpFill/>'), { fill: '<a:grpFill/>' }), red)
    );
    expect(projection.vectorShape?.components.map((c) => c.fillHex)).toEqual(['FF0000']);
    // The nested group's own fill wins over the outer one.
    const own = projectionOf(
      groupDrawing(
        nested(bar(0, 0, '<a:grpFill/>'), {
          fill: '<a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>',
        }),
        red
      )
    );
    expect(own.vectorShape?.components.map((c) => c.fillHex)).toEqual(['00FF00']);
  });

  test('a nested group that collapses an axis puts its members on the line', () => {
    const flat =
      '<a:xfrm><a:off x="1100" y="1200"/><a:ext cx="0" cy="2000"/>' +
      '<a:chOff x="0" y="0"/><a:chExt cx="500" cy="500"/></a:xfrm>';
    const projection = projectionOf(groupDrawing(nested(bar(100, 50), { xfrm: flat })));
    expect(topLeft(projection)).toMatchObject({ x: NESTED_X, right: NESTED_X });
    // A picture inside such a group has no visible size, so the group stays unpainted.
    expect(
      projectionOf(groupDrawing(nested(picture(0, 0, 10, 10), { xfrm: flat }))).groupPicture
    ).toBeNull();
  });

  test('vertical member text turns its insets with it', () => {
    const insets = 'lIns="10" tIns="20" rIns="30" bIns="40"';
    const textOf = (vert: string) =>
      projectionOf(
        groupDrawing(
          bar(0, 0) +
            label(0, 0, 'Label').replace(
              'lIns="0" tIns="0" rIns="0" bIns="0" vert="vert270"',
              `${insets}${vert}`
            )
        )
      ).groupTextboxes![0]!;
    expect(textOf('').story.insetsEmu).toEqual({ top: 20, right: 30, bottom: 40, left: 10 });
    expect(textOf('').rotationDegrees).toBe(0);
    // Top-to-bottom text: its top edge is the shape's right edge.
    const down = textOf(' vert="vert"');
    expect(down.rotationDegrees).toBe(90);
    expect(down.story.insetsEmu).toEqual({ top: 30, right: 40, bottom: 10, left: 20 });
    // East Asian vertical text keeps upright glyphs, which a turned block cannot show.
    expect(textOf(' vert="eaVert"').rotationDegrees).toBe(0);
    // Bottom-to-top text: its top edge is the shape's left edge.
    const up = textOf(' vert="vert270"');
    expect(up.rotationDegrees).toBe(270);
    expect(up.story.insetsEmu).toEqual({ top: 10, right: 20, bottom: 30, left: 40 });
    // A member turned a half turn keeps adding the flow turn.
    const turned = projectionOf(
      groupDrawing(bar(0, 0) + label(0, 0, 'Label').replace('<a:xfrm>', '<a:xfrm rot="10800000">'))
    ).groupTextboxes![0]!;
    expect(turned.rotationDegrees).toBe(90);
  });

  const refused: readonly (readonly [string, string])[] = [
    ['a turned nested group', nested(bar(0, 0), { xfrmAttributes: ' rot="5400000"' })],
    ['a horizontally flipped nested group', nested(bar(0, 0), { xfrmAttributes: ' flipH="1"' })],
    ['a vertically flipped nested group', nested(bar(0, 0), { xfrmAttributes: ' flipV="1"' })],
    ['a nested group without a transform', nested(bar(0, 0), { xfrm: '' })],
    [
      'a nested group without a child extent',
      nested(bar(0, 0), {
        xfrm: '<a:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></a:xfrm>',
      }),
    ],
    [
      'a nested group with a negative extent',
      nested(bar(0, 0), {
        xfrm:
          '<a:xfrm><a:off x="0" y="0"/><a:ext cx="-10" cy="10"/>' +
          '<a:chOff x="0" y="0"/><a:chExt cx="10" cy="10"/></a:xfrm>',
      }),
    ],
    [
      'a nested group with an offset that does not read',
      nested(bar(0, 0), {
        xfrm:
          '<a:xfrm><a:off x="1.5" y="0"/><a:ext cx="10" cy="10"/>' +
          '<a:chOff x="0" y="0"/><a:chExt cx="10" cy="10"/></a:xfrm>',
      }),
    ],
    [
      'a nested group with a child offset that does not read',
      nested(bar(0, 0), {
        xfrm:
          '<a:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/>' +
          '<a:chOff x="0"/><a:chExt cx="10" cy="10"/></a:xfrm>',
      }),
    ],
    [
      'a nested group with an effect',
      nested(bar(0, 0), { fill: '<a:effectLst><a:outerShdw dist="38100"/></a:effectLst>' }),
    ],
    ['a nested group past the depth cap', deepNest(MAX_GROUP_NESTING_DEPTH + 1)],
    [
      'more members than the cap across levels',
      bar(0, 0).repeat(64) + nested(bar(0, 0).repeat(64)),
    ],
  ];

  test.each(refused)('%s leaves the group unpainted', (_name, members) => {
    const projection = projectionOf(groupDrawing(members));
    expect(projection.vectorShape).toBeNull();
    expect(projection.groupPicture).toBeNull();
    expect(projection.groupTextboxes).toBeUndefined();
  });

  test('a hidden nested group paints nothing, and the rest of the group still paints', () => {
    const projection = projectionOf(
      groupDrawing(bar(100, 200) + nested(bar(0, 0) + label(0, 0, 'Hidden'), { hidden: true }))
    );
    expect(projection.vectorShape?.components).toHaveLength(1);
    expect(projection.groupTextboxes).toBeUndefined();
  });

  test('nesting at the depth cap still paints', () => {
    expect(
      projectionOf(groupDrawing(deepNest(MAX_GROUP_NESTING_DEPTH))).vectorShape
    ).not.toBeNull();
  });

  test('a nested label is found as group text, and a placeholder group reveals none', () => {
    const roots = (members: string) =>
      textboxStoriesInPart(parsePart(`<w:p><w:r>${groupDrawing(members)}</w:r></w:p>`));
    expect(roots(label(0, 0, 'Top') + nested(label(0, 0, 'Inner')))).toHaveLength(2);
    const turned = nested(label(0, 0, 'Inner'), { xfrmAttributes: ' rot="60000"' });
    expect(roots(label(0, 0, 'Top') + turned)).toHaveLength(0);
  });
});

/** `depth` nested groups, each filling its parent's child space, around one bar. */
function deepNest(depth: number): string {
  const identity =
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="500" cy="500"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="500" cy="500"/></a:xfrm>';
  let members = bar(0, 0);
  for (let level = 0; level < depth; level += 1) members = nested(members, { xfrm: identity });
  return members;
}
