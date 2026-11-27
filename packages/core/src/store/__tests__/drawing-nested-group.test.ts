// A `wpg:wgp` group can hold `wpg:grpSp` groups of its own. A nested group places itself in
// its parent's child space by its `a:xfrm` (`off`/`ext`) and authors its members in its own
// child space (`chOff`/`chExt`). These tests pin where nested members land, that pictures,
// shapes, and text boxes paint together across levels, and which nested groups paint nothing.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI, type OoxmlPart } from '../index.ts';
import { projectDrawingsInPart } from '../package/drawing-projection.ts';
import { MAX_GROUP_SHAPE_CHILDREN } from '../package/drawing-group-frame.ts';
import { MAX_GROUP_NESTING_DEPTH } from '../package/drawing-group-members.ts';
import { textboxReadStoriesInPart, textboxStoriesInPart } from '../package/textbox-stories.ts';

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

/** The projection, and the node id of each element named `localName`, in document order. */
function projectionWithIds(drawing: string, localName: string) {
  const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
  const ids: string[] = [];
  const walk = (node: OoxmlPart['root']['children'][number]): void => {
    if (!('children' in node)) return;
    if ('localName' in node && node.localName === localName) ids.push(node.id);
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  const projections = projectDrawingsInPart(part);
  expect(projections).toHaveLength(1);
  return { projection: projections[0]!, ids };
}

/** The node ids of the members that the group paints without. */
function notShown(projection: ReturnType<typeof projectionOf>): string[] {
  return projection.diagnostics
    .filter((diagnostic) => diagnostic.code === 'group-member-not-shown')
    .map((diagnostic) => diagnostic.nodeId);
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
    // East Asian vertical text lays out as a turned block, as outside a group.
    expect(textOf(' vert="eaVert"').rotationDegrees).toBe(90);
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

  // The nested box is 1000 x 2000 outer units at (1100, 1200): 2000000 x 4000000 EMU at
  // (NESTED_X, NESTED_Y), centred at (NESTED_X + 1000000, NESTED_Y + 2000000).
  const CENTRE = { x: NESTED_X + 1_000_000, y: NESTED_Y + 2_000_000 };

  test('a flipped nested group mirrors its members about its centre', () => {
    // The bar spans x 100..300 of the 500-unit child width: 400000..1200000 EMU across the box.
    const flippedH = projectionOf(
      groupDrawing(nested(bar(100, 50), { xfrmAttributes: ' flipH="1"' }))
    );
    expect(topLeft(flippedH)).toMatchObject({
      x: NESTED_X + 2_000_000 - 300 * NESTED_SCALE_X,
      right: NESTED_X + 2_000_000 - 100 * NESTED_SCALE_X,
      y: NESTED_Y + 50 * NESTED_SCALE_Y,
    });
    expect(flippedH.vectorShape?.overflowVisible).toBe(true);
    const flippedV = projectionOf(
      groupDrawing(nested(bar(100, 50), { xfrmAttributes: ' flipV="1"' }))
    );
    expect(topLeft(flippedV)).toMatchObject({
      x: NESTED_X + 100 * NESTED_SCALE_X,
      bottom: NESTED_Y + 4_000_000 - 50 * NESTED_SCALE_Y,
    });
  });

  test('a turned nested group turns its members about its centre', () => {
    // A half turn: the same as both flips.
    const half = projectionOf(
      groupDrawing(nested(bar(100, 50), { xfrmAttributes: ' rot="10800000"' }))
    );
    const both = projectionOf(
      groupDrawing(nested(bar(100, 50), { xfrmAttributes: ' flipH="1" flipV="1"' }))
    );
    const round = (box: ReturnType<typeof topLeft>) =>
      Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v)]));
    expect(round(topLeft(half))).toEqual(round(topLeft(both)));
    // A quarter turn about the box centre. The outer scale is uniform, so the upright box stays
    // 2000000 x 4000000 EMU, and its child units are 4000 x 8000 EMU. The bar's top-left corner
    // (0, 0), 1000000 left of and 2000000 above the centre, turns clockwise to 2000000 right of
    // and 1000000 above it.
    const quarter = projectionOf(
      groupDrawing(nested(bar(0, 0), { xfrmAttributes: ' rot="5400000"' }))
    );
    const box = topLeft(quarter);
    expect(Math.round(box.right)).toBe(CENTRE.x + 2_000_000);
    expect(Math.round(box.y)).toBe(CENTRE.y - 1_000_000);
    // The 10-unit bar height (80000 EMU) now lies across, and its 200-unit width down.
    expect(Math.round(box.right - box.x)).toBe(80_000);
    expect(Math.round(box.bottom - box.y)).toBe(800_000);
    expect(quarter.vectorShape?.overflowVisible).toBe(true);
  });

  test('text in a turned or flipped group turns with its shape', () => {
    // Horizontal text: the box keeps its size and its centre turns with the nested group.
    const horizontal = (attributes: string) =>
      projectionOf(
        groupDrawing(
          bar(100, 200) +
            nested(
              label(0, 0, 'Inner').replace(
                'lIns="0" tIns="0" rIns="0" bIns="0" vert="vert270"',
                'lIns="0" tIns="0" rIns="0" bIns="0"'
              ),
              { xfrmAttributes: attributes }
            )
        )
      ).groupTextboxes![0]!;
    const upright = horizontal('');
    expect(upright.rotationDegrees).toBe(0);
    const quarter = horizontal(' rot="5400000"');
    expect(quarter.rotationDegrees).toBe(90);
    expect(quarter.frameEmu.cx).toBe(upright.frameEmu.cx);
    // The label's centre sits at (50, 200) of the 500-unit child space: left of the box centre.
    const flipped = horizontal(' flipH="1"');
    expect(flipped.rotationDegrees).toBe(0);
    expect(flipped.frameEmu.x + flipped.frameEmu.cx / 2).toBe(
      2 * CENTRE.x - (upright.frameEmu.x + upright.frameEmu.cx / 2)
    );
    expect(horizontal(' flipV="1"').rotationDegrees).toBe(180);
    // The vertical flow turns after the group flips: a horizontal flip keeps its direction, and
    // a vertical flip turns it upside down.
    const vertical = (vert: string, attributes: string) =>
      projectionOf(
        groupDrawing(
          bar(100, 200) +
            nested(label(0, 0, 'Inner').replace('vert="vert270"', `vert="${vert}"`), {
              xfrmAttributes: attributes,
            })
        )
      ).groupTextboxes![0]!.rotationDegrees;
    expect(vertical('vert270', ' flipH="1"')).toBe(270);
    expect(vertical('vert', ' flipH="1"')).toBe(90);
    expect(vertical('vert', ' flipV="1"')).toBe(270);
    expect(vertical('vert270', ' flipV="1"')).toBe(90);
  });

  test('upright text keeps only its flow turn in a turned group', () => {
    const upright = (vert: string) =>
      projectionOf(
        groupDrawing(
          bar(100, 200) +
            nested(label(0, 0, 'Inner').replace('vert="vert270"', `vert="${vert}" upright="1"`), {
              xfrmAttributes: ' rot="5400000" flipH="1"',
            })
        )
      ).groupTextboxes![0]!.rotationDegrees;
    expect(upright('horz')).toBe(0);
    expect(upright('vert')).toBe(90);
  });

  test('a nested group size reads with surrounding whitespace', () => {
    const padded =
      '<a:xfrm><a:off x="1100" y="1200"/><a:ext cx=" 1000 " cy="2000"/>' +
      '<a:chOff x="0" y="0"/><a:chExt cx="500" cy=" 500"/></a:xfrm>';
    const projection = projectionOf(
      groupDrawing(bar(100, 200) + nested(bar(0, 0), { xfrm: padded }))
    );
    expect(projection.vectorShape?.components).toHaveLength(2);
  });

  test('a large hidden nested group leaves the visible text listed', () => {
    let hiddenMembers = '';
    for (let index = 0; index < 140; index += 1) hiddenMembers += bar(0, 0);
    const stories = textboxStoriesInPart(
      parsePart(
        `<w:p><w:r>${groupDrawing(label(0, 0, 'Shown') + nested(hiddenMembers, { hidden: true }))}</w:r></w:p>`
      )
    );
    expect(stories).toHaveLength(1);
  });

  test('text in a turned outer group turns with the group', () => {
    const drawing = groupDrawing(bar(100, 200) + label(100, 200, 'Label')).replace(
      '<a:xfrm><a:off x="0" y="0"/><a:ext cx="6000000"',
      '<a:xfrm rot="5400000"><a:off x="0" y="0"/><a:ext cx="6000000"'
    );
    const projection = projectionOf(drawing);
    expect(projection.vectorShape?.rotationDegrees).toBe(90);
    expect(projection.groupTextboxes?.[0]?.rotationDegrees).toBe(0); // 270 + 90
  });

  test('a picture inside a turned nested group paints turned about the group centre', () => {
    const projection = projectionOf(
      groupDrawing(nested(picture(0, 0, 100, 100), { xfrmAttributes: ' rot="5400000"' }))
    );
    // The picture keeps its upright 400000 x 800000 EMU box. Its centre, 800000 left of and
    // 1600000 above the group centre, turns to 1600000 right of and 800000 above it.
    const centre = { x: CENTRE.x + 1_600_000, y: CENTRE.y - 800_000 };
    expect(projection.groupPicture).toMatchObject({
      embeddedRelationshipId: 'rIdImg',
      frameEmu: { x: centre.x - 200_000, y: centre.y - 400_000, cx: 400_000, cy: 800_000 },
      rotationDegrees: 90,
    });
    expect(projection.groupPicture?.flipH).toBeUndefined();
    expect(projection.vectorShape).toBeNull();
    expect(notShown(projection)).toEqual([]);
  });

  // The outline of a picture member strokes over the picture. In a turned or flipped nested
  // group the picture moves with the group, and its outline moves with it.
  const OUTLINED = picture(0, 0, 100, 100).replace(
    '</pic:spPr>',
    '<a:ln w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></pic:spPr>'
  );

  test('the outline of a picture in a turned nested group turns with the picture', () => {
    const projection = projectionOf(
      groupDrawing(nested(OUTLINED, { xfrmAttributes: ' rot="5400000"' }))
    );
    // The 400000 x 800000 EMU picture turns a quarter turn about its own centre.
    const centre = { x: CENTRE.x + 1_600_000, y: CENTRE.y - 800_000 };
    expect(projection.groupPicture?.rotationDegrees).toBe(90);
    expect(projection.vectorShape?.components).toHaveLength(1);
    const outline = topLeft(projection);
    expect(outline.x).toBeCloseTo(centre.x - 400_000, 3);
    expect(outline.right).toBeCloseTo(centre.x + 400_000, 3);
    expect(outline.y).toBeCloseTo(centre.y - 200_000, 3);
    expect(outline.bottom).toBeCloseTo(centre.y + 200_000, 3);
  });

  test('the outline of a picture in a flipped nested group moves with the picture', () => {
    const projection = projectionOf(
      groupDrawing(nested(OUTLINED, { xfrmAttributes: ' flipH="1"' }))
    );
    const frame = projection.groupPicture!.frameEmu;
    expect(projection.groupPicture?.flipH).toBe(true);
    const outline = topLeft(projection);
    expect(outline.x).toBeCloseTo(frame.x, 3);
    expect(outline.right).toBeCloseTo(frame.x + frame.cx, 3);
    expect(outline.y).toBeCloseTo(frame.y, 3);
    expect(outline.bottom).toBeCloseTo(frame.y + frame.cy, 3);
  });

  const refused: readonly (readonly [string, string])[] = [
    [
      'a nested group turned by an invalid angle',
      nested(bar(0, 0), { xfrmAttributes: ' rot="90deg"' }),
    ],
    ['a nested group with an invalid flip', nested(bar(0, 0), { xfrmAttributes: ' flipH="yes"' })],
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

  // Each case holds one nested group that paint cannot place. Its node id is the last
  // `wpg:grpSp` that the walk reads: the deepest one in the depth case.
  const unplaced = refused.filter(([name]) => name.startsWith('a nested group'));

  test.each(unplaced)('%s paints nothing, and the rest of the group paints', (name, members) => {
    const { projection, ids } = projectionWithIds(groupDrawing(bar(100, 200) + members), 'grpSp');
    expect(projection.vectorShape?.components).toHaveLength(1);
    expect(topLeft(projection)).toEqual({ x: 0, y: 0, right: 200 * SCALE, bottom: 10 * SCALE });
    expect(projection.groupPicture).toBeNull();
    // The depth case nests one group past the cap; paint omits that innermost group.
    const omitted = name.includes('depth cap') ? ids[ids.length - 1]! : ids[0]!;
    expect(notShown(projection)).toEqual([omitted]);
    expect(projection.diagnostics.map((d) => d.code)).not.toContain('unsupported-graphic');
  });

  test('a nested group with an effect paints its members flat', () => {
    const shadowed = nested(bar(0, 0), {
      fill: '<a:effectLst><a:outerShdw dist="38100"/></a:effectLst>',
    });
    const projection = projectionOf(groupDrawing(shadowed));
    expect(projection.vectorShape?.components).toHaveLength(1);
    expect(topLeft(projection)).toMatchObject({ x: NESTED_X, y: NESTED_Y });
    // The group effect paints nothing: the bar casts no shadow.
    expect(projection.vectorShape?.components[0]!.shadow).toBeUndefined();
    expect(projection.diagnostics).toEqual([]);
  });

  test('a hidden nested group paints nothing, and the rest of the group still paints', () => {
    const projection = projectionOf(
      groupDrawing(bar(100, 200) + nested(bar(0, 0) + label(0, 0, 'Hidden'), { hidden: true }))
    );
    expect(projection.vectorShape?.components).toHaveLength(1);
    expect(projection.groupTextboxes).toBeUndefined();
    expect(notShown(projection)).toEqual([]);
    // An invalid spelling of the flag leaves out the nested group, and reports it.
    const invalid = nested(bar(0, 0)).replace('name="Inner"', 'name="Inner" hidden="maybe"');
    const spelled = projectionWithIds(groupDrawing(bar(100, 200) + invalid), 'grpSp');
    expect(spelled.projection.vectorShape?.components).toHaveLength(1);
    expect(topLeft(spelled.projection)).toMatchObject({ x: 0, y: 0 });
    expect(notShown(spelled.projection)).toEqual([spelled.ids[0]!]);
  });

  test('a hidden shape or picture paints nothing, and the rest of the group still paints', () => {
    const hiddenBar = bar(0, 0).replace(
      '<wps:cNvPr id="3" name="Bar"/>',
      '<wps:cNvPr id="3" name="Bar" hidden="1"/>'
    );
    const shapes = projectionOf(groupDrawing(bar(100, 200) + nested(hiddenBar + bar(0, 0))));
    expect(shapes.vectorShape?.components).toHaveLength(2);
    const hiddenPicture = picture(2000, 3500, 1000, 500).replace(
      'name="Picture"',
      'name="Picture" hidden="true"'
    );
    const pictured = projectionOf(groupDrawing(hiddenPicture + bar(100, 200)));
    expect(pictured.groupPicture).toBeNull();
    expect(pictured.vectorShape?.components).toHaveLength(1);
    // An invalid spelling of the flag leaves out that shape, and reports it.
    const invalid = bar(0, 0).replace(
      '<wps:cNvPr id="3" name="Bar"/>',
      '<wps:cNvPr id="3" name="Bar" hidden="yes"/>'
    );
    const spelled = projectionWithIds(groupDrawing(bar(100, 200) + invalid), 'wsp');
    expect(spelled.projection.vectorShape?.components).toHaveLength(1);
    expect(topLeft(spelled.projection)).toMatchObject({ x: 0, y: 0 });
    expect(notShown(spelled.projection)).toEqual([spelled.ids[1]!]);
  });

  test('a trailing extension list is not a member', () => {
    const projection = projectionOf(
      groupDrawing(bar(100, 200) + nested(bar(0, 0) + '<wpg:extLst/>') + '<wpg:extLst/>')
    );
    expect(projection.vectorShape?.components).toHaveLength(2);
  });

  test('nesting at the depth cap still paints', () => {
    expect(
      projectionOf(groupDrawing(deepNest(MAX_GROUP_NESTING_DEPTH))).vectorShape
    ).not.toBeNull();
  });

  test('group text stays readable, nested, hidden, or past the member budget', () => {
    const roots = (members: string) =>
      textboxReadStoriesInPart(parsePart(`<w:p><w:r>${groupDrawing(members)}</w:r></w:p>`));
    const selectable = (members: string) =>
      textboxStoriesInPart(parsePart(`<w:p><w:r>${groupDrawing(members)}</w:r></w:p>`));
    expect(roots(label(0, 0, 'Top') + nested(label(0, 0, 'Inner')))).toHaveLength(2);
    // A turned nested group paints, so its text reveals too.
    const turned = nested(label(0, 0, 'Inner'), { xfrmAttributes: ' rot="60000"' });
    expect(roots(label(0, 0, 'Top') + turned)).toHaveLength(2);
    const glowing = nested(label(0, 0, 'Inner'), {
      fill: '<a:effectLst><a:glow rad="1"/></a:effectLst>',
    });
    // A nested group with an effect paints flat, so its text lays out and selects.
    const placed = roots(label(0, 0, 'Top') + glowing);
    expect(placed.map((story) => story.unplaced)).toEqual([undefined, undefined]);
    expect(roots(label(0, 0, 'Top') + nested(label(0, 0, 'Inner')))[0]!.unplaced).toBeUndefined();
    // A picture in a turned nested group paints, and the text beside it lays out.
    const pictured = nested(picture(0, 0, 100, 100) + label(0, 0, 'Inner'), {
      xfrmAttributes: ' rot="60000"',
    });
    expect(roots(label(0, 0, 'Top') + pictured).map((story) => story.unplaced)).toEqual([
      undefined,
      undefined,
    ]);
    // A group past the member budget paints a placeholder. Its text stays listed for
    // paragraph reads, marked so that selection skips it.
    const crowded = label(0, 0, 'Top') + bar(0, 0).repeat(MAX_GROUP_SHAPE_CHILDREN);
    expect(roots(crowded).map((story) => story.unplaced)).toEqual([true]);
    expect(selectable(crowded)).toHaveLength(0);
    const hidden = label(0, 0, 'Hidden').replace(
      '<wps:wsp>',
      '<wps:wsp><wps:cNvPr id="9" name="Hidden" hidden="1"/>'
    );
    expect(hidden).toContain('hidden="1"');
    // Hidden member text stays readable, marked so that selection skips it.
    const withHidden = roots(label(0, 0, 'Top') + nested(hidden));
    expect(withHidden.map((story) => story.unplaced)).toEqual([undefined, true]);
    expect(selectable(label(0, 0, 'Top') + nested(hidden))).toHaveLength(1);
    expect(selectable(label(0, 0, 'Top') + glowing)).toHaveLength(2);
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
