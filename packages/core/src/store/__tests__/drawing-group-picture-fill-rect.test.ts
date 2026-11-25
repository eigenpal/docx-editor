// A picture member of a drawing group (`wpg:wgp`, with nested `wpg:grpSp`, CT_WordprocessingGroup;
// ECMA-376 Part 1, 20.4.2.39 and 20.4.2.32) keeps the placement, the clip and the colour effects of its fill:
//
// - `a:stretch/a:fillRect` (CT_RelativeRect; Part 1, 20.1.8.30) insets the picture in the
//   member's box, or lets it reach past the box. A positive percentage is an inset and a
//   negative percentage is an outset. The projected frame is the part of the box that the
//   picture covers, and the crop is the part of the picture inside the box.
// - `a:srcRect` (Part 1, 20.1.8.55) picks the part of the source that stretches over the fill
//   rectangle, so the two compose.
// - The member's geometry (`a:prstGeom`, Part 1, 20.1.9.18) clips the picture.
// - The blip keeps its colour effects (`a:alphaModFix`, Part 1, 20.1.8.6).
// - A `wps:wsp` shape whose fill is `a:blipFill` (CT_BlipFillProperties; Part 1, 20.1.8.14)
//   paints as a picture member, like a `pic:pic` (CT_Picture; Part 1, 20.2.2.5). A tiled fill
//   (`a:tile`, Part 1, 20.1.8.58) is not a picture member.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI, type OoxmlPart } from '../index.ts';
import { projectDrawingsInPart } from '../package/drawing-projection.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';

/** Group child space: offset (100, 200), extent 3000 x 4000, drawn at 6000000 x 8000000 EMU. */
const SCALE = 2000;
/** The box of the default member: (100, 200) sized 3000 x 1000 in child space. */
const BOX = { x: 0, y: 0, cx: 3000 * SCALE, cy: 1000 * SCALE };
const NO_CROP = { left: 0, top: 0, right: 0, bottom: 0 };

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

interface PictureOptions {
  /** The fill mode children of the blip fill, after the blip. */
  readonly fill?: string;
  readonly blip?: string;
  readonly xfrmAttributes?: string;
  readonly geometry?: string;
}

const RECT = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
const ELLIPSE = '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>';
const STRETCH = '<a:stretch><a:fillRect/></a:stretch>';

function fillRect(attributes: string): string {
  return `<a:stretch><a:fillRect ${attributes}/></a:stretch>`;
}

function pictureMember(options: PictureOptions = {}): string {
  return (
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill>${options.blip ?? '<a:blip r:embed="rIdImg"/>'}` +
    `${options.fill ?? STRETCH}</pic:blipFill>` +
    `<pic:spPr><a:xfrm${options.xfrmAttributes ?? ''}><a:off x="100" y="200"/>` +
    `<a:ext cx="3000" cy="1000"/></a:xfrm>${options.geometry ?? RECT}</pic:spPr></pic:pic>`
  );
}

/** A `wps:wsp` shape at the box of the default member, with the given fill. */
function shapeMember(fill: string, afterFill = '', body = ''): string {
  return (
    '<wps:wsp><wps:cNvPr id="3" name="Shape"/><wps:cNvSpPr/><wps:spPr>' +
    '<a:xfrm><a:off x="100" y="200"/><a:ext cx="3000" cy="1000"/></a:xfrm>' +
    `${RECT}${fill}${afterFill}</wps:spPr>${body}<wps:bodyPr/></wps:wsp>`
  );
}

/** A thin green bar in the lower half of the group. */
const BAR =
  '<wps:wsp><wps:cNvPr id="4" name="Bar"/><wps:cNvSpPr/><wps:spPr>' +
  '<a:xfrm><a:off x="600" y="2100"/><a:ext cx="1000" cy="10"/></a:xfrm>' +
  `${RECT}<a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>`;

function blipFill(mode = STRETCH, blip = '<a:blip r:embed="rIdImg"/>'): string {
  return `<a:blipFill>${blip}${mode}</a:blipFill>`;
}

function groupDrawing(members: string, groupXfrmAttributes = ''): string {
  return (
    '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="10" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="6000000" cy="8000000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapNone/><wp:docPr id="1" name="Group 1"/>' +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    `<a:xfrm${groupXfrmAttributes}><a:off x="0" y="0"/><a:ext cx="6000000" cy="8000000"/>` +
    '<a:chOff x="100" y="200"/><a:chExt cx="3000" cy="4000"/></a:xfrm></wpg:grpSpPr>' +
    `${members}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing>`
  );
}

/** The projection of the one group drawing, and the node ids of its members in order. */
function project(members: string, groupXfrmAttributes = '') {
  const part = parsePart(`<w:p><w:r>${groupDrawing(members, groupXfrmAttributes)}</w:r></w:p>`);
  const memberIds: string[] = [];
  const walk = (node: OoxmlPart['root']['children'][number], inGroup: boolean): void => {
    if (!('children' in node)) return;
    const name = 'localName' in node ? node.localName : '';
    if (inGroup && (name === 'pic' || name === 'wsp')) memberIds.push(node.id);
    for (const child of node.children) walk(child, inGroup || name === 'wgp');
  };
  walk(part.root, false);
  const projections = projectDrawingsInPart(part);
  expect(projections).toHaveLength(1);
  return { projection: projections[0]!, memberIds };
}

function pictureOf(members: string, groupXfrmAttributes = '') {
  const { projection } = project(members, groupXfrmAttributes);
  expect(projection.diagnostics).toEqual([]);
  expect(projection.groupPicture).not.toBeNull();
  return projection.groupPicture!;
}

function expectCrop(
  crop: Readonly<{ left: number; top: number; right: number; bottom: number }>,
  expected: typeof NO_CROP
): void {
  expect(crop.left).toBeCloseTo(expected.left, 9);
  expect(crop.top).toBeCloseTo(expected.top, 9);
  expect(crop.right).toBeCloseTo(expected.right, 9);
  expect(crop.bottom).toBeCloseTo(expected.bottom, 9);
}

describe('the fill rectangle of a group picture', () => {
  test('a positive inset shrinks the frame and leaves the picture whole', () => {
    // 25% from the left and 10% from the top of the 6000000 x 2000000 box.
    const picture = pictureOf(pictureMember({ fill: fillRect('l="25000" t="10000"') }));
    expect(picture.frameEmu).toEqual({ x: 1_500_000, y: 200_000, cx: 4_500_000, cy: 1_800_000 });
    expect(picture.crop).toEqual(NO_CROP);
    expect(picture.rotationDegrees).toBeUndefined();
    expect(picture.memberClipUnit).toBeUndefined();
  });

  test('a negative inset keeps the frame at the box and crops the part past it', () => {
    // The picture is 1.5 boxes wide and starts half a box left of the box: a third of it is
    // cut on the left. It is 2 boxes high and ends one box under the box: half is cut below.
    const picture = pictureOf(pictureMember({ fill: fillRect('l="-50000" b="-100000"') }));
    expect(picture.frameEmu).toEqual(BOX);
    expectCrop(picture.crop, { left: 1 / 3, top: 0, right: 0, bottom: 0.5 });
  });

  test('an inset on one edge and an outset on another apply together', () => {
    // Left: inset by a quarter. Right: the picture reaches a quarter past the box. The picture
    // is one box wide, from 0.25 to 1.25, so a quarter of it is cut on the right.
    const picture = pictureOf(pictureMember({ fill: fillRect('l="25000" r="-25000"') }));
    expect(picture.frameEmu).toEqual({ ...BOX, x: 1_500_000, cx: 4_500_000 });
    expectCrop(picture.crop, { left: 0, top: 0, right: 0.25, bottom: 0 });
  });

  test('a source rectangle stretches over the fill rectangle before the box cuts it', () => {
    const source = '<a:srcRect l="20000" r="10000"/>';
    // With an inset, the frame shrinks and the crop is the source rectangle alone.
    const inset = pictureOf(pictureMember({ fill: source + fillRect('l="50000"') }));
    expect(inset.frameEmu).toEqual({ ...BOX, x: 3_000_000, cx: 3_000_000 });
    expectCrop(inset.crop, { left: 0.2, top: 0, right: 0.1, bottom: 0 });
    // With an outset, the box cuts a third of the 70% of the source that is shown.
    const outset = pictureOf(pictureMember({ fill: source + fillRect('l="-50000"') }));
    expect(outset.frameEmu).toEqual(BOX);
    expectCrop(outset.crop, { left: 0.2 + 0.7 / 3, top: 0, right: 0.1, bottom: 0 });
  });

  test('a fill rectangle that leaves no part of the picture in the box paints no picture', () => {
    for (const attributes of ['l="60000" r="60000"', 'l="100000"', 'r="-100000" l="150000"']) {
      const { projection, memberIds } = project(
        pictureMember({ fill: fillRect(attributes) }) + BAR
      );
      expect(projection.groupPicture).toBeNull();
      // The bar still paints, and the report names the picture.
      expect(projection.vectorShape?.components.map((c) => c.fillHex)).toEqual(['00FF00']);
      expect(projection.diagnostics).toEqual([
        { code: 'group-member-not-shown', nodeId: memberIds[0]!, detail: null },
      ]);
    }
  });

  test('the off-centre part of a turned member turns about the centre of the box', () => {
    // The picture covers the right half of the box. A quarter turn clockwise about the box
    // centre (3000000, 1000000) moves the centre of that half from 1500000 right of the box
    // centre to 1500000 under it. The frame keeps its upright size.
    const turned = pictureOf(
      pictureMember({ fill: fillRect('l="50000"'), xfrmAttributes: ' rot="5400000"' })
    );
    expect(turned.rotationDegrees).toBe(90);
    expect(turned.frameEmu.cx).toBe(3_000_000);
    expect(turned.frameEmu.cy).toBe(2_000_000);
    expect(turned.frameEmu.x + turned.frameEmu.cx / 2).toBeCloseTo(3_000_000, 3);
    expect(turned.frameEmu.y + turned.frameEmu.cy / 2).toBeCloseTo(2_500_000, 3);
    // A mirrored member shows that half on the left of its box.
    const mirrored = pictureOf(
      pictureMember({ fill: fillRect('l="50000"'), xfrmAttributes: ' flipH="1"' })
    );
    expect(mirrored.flipH).toBe(true);
    expect(mirrored.rotationDegrees).toBeUndefined();
    expect(mirrored.frameEmu).toEqual({ ...BOX, cx: 3_000_000 });
  });

  test('the off-centre part of a member in a turned group turns with the group', () => {
    // The group turns a quarter turn about its centre (3000000, 4000000). The box centre
    // moves from (3000000, 1000000) to (6000000, 4000000), and the right half of the box
    // then lies 1500000 under that centre.
    const picture = pictureOf(pictureMember({ fill: fillRect('l="50000"') }), ' rot="5400000"');
    expect(picture.rotationDegrees).toBe(90);
    expect(picture.frameEmu.x + picture.frameEmu.cx / 2).toBeCloseTo(6_000_000, 3);
    expect(picture.frameEmu.y + picture.frameEmu.cy / 2).toBeCloseTo(5_500_000, 3);
    expect({ cx: picture.frameEmu.cx, cy: picture.frameEmu.cy }).toEqual({
      cx: 3_000_000,
      cy: 2_000_000,
    });
  });

  // `l="unknown"` is outside ST_Percentage, so the rectangle of the picture is unknown.
  test('a fill rectangle edge spelled outside the schema does not paint as no inset', () => {
    const { projection } = project(pictureMember({ fill: fillRect('l="unknown"') }));
    expect(projection.groupPicture).toBeNull();
  });
});

describe('the geometry clip of a group picture', () => {
  test('an ellipse member clips its picture to a ring in the unit square of the frame', () => {
    const picture = pictureOf(pictureMember({ geometry: ELLIPSE }));
    expect(picture.frameEmu).toEqual(BOX);
    const ring = picture.memberClipUnit!;
    expect(ring.length).toBeGreaterThanOrEqual(8);
    // Every point lies on the ellipse that touches the four sides of the unit square.
    for (const point of ring) {
      expect(Math.hypot(point.x - 0.5, point.y - 0.5)).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(Math.hypot(point.x - 0.5, point.y - 0.5)).toBeGreaterThan(0.45);
    }
    expect(Math.min(...ring.map((point) => point.x))).toBeCloseTo(0, 9);
    expect(Math.max(...ring.map((point) => point.x))).toBeCloseTo(1, 9);
    expect(Math.min(...ring.map((point) => point.y))).toBeCloseTo(0, 9);
    expect(Math.max(...ring.map((point) => point.y))).toBeCloseTo(1, 9);
    // The ring is the member's clip, not a clip in the unit square of the drawing extent.
    expect(picture.clipUnit).toBeUndefined();
  });

  test('a rectangle member has no clip ring', () => {
    expect(pictureOf(pictureMember()).memberClipUnit).toBeUndefined();
    expect(pictureOf(pictureMember({ geometry: '' })).memberClipUnit).toBeUndefined();
  });

  test('the ring stays on the box when a fill rectangle shrinks the frame', () => {
    // The frame is the right half of the box. In the unit square of that half, the ellipse of
    // the box runs from -1 to 1 across.
    const picture = pictureOf(pictureMember({ geometry: ELLIPSE, fill: fillRect('l="50000"') }));
    expect(picture.frameEmu).toEqual({ ...BOX, x: 3_000_000, cx: 3_000_000 });
    const ring = picture.memberClipUnit!;
    expect(Math.min(...ring.map((point) => point.x))).toBeCloseTo(-1, 9);
    expect(Math.max(...ring.map((point) => point.x))).toBeCloseTo(1, 9);
    expect(Math.min(...ring.map((point) => point.y))).toBeCloseTo(0, 9);
    expect(Math.max(...ring.map((point) => point.y))).toBeCloseTo(1, 9);
  });
});

describe('the blip colour effects of a group picture', () => {
  test('a:alphaModFix reads as the opacity of the picture', () => {
    const picture = pictureOf(
      pictureMember({ blip: '<a:blip r:embed="rIdImg"><a:alphaModFix amt="50000"/></a:blip>' })
    );
    expect(picture.effects).toEqual({ opacity: 0.5, grayscale: false, brightness: 0, contrast: 0 });
  });

  test('a:grayscl reads as a grayscale picture', () => {
    const picture = pictureOf(
      pictureMember({ blip: '<a:blip r:embed="rIdImg"><a:grayscl/></a:blip>' })
    );
    expect(picture.effects).toMatchObject({ grayscale: true });
    expect(picture.effects?.opacity).toBeUndefined();
  });

  test('a blip without a colour effect records none', () => {
    expect(pictureOf(pictureMember()).effects).toBeUndefined();
    // An extension list is not a colour effect.
    const extended = pictureMember({ blip: '<a:blip r:embed="rIdImg"><a:extLst/></a:blip>' });
    expect(pictureOf(extended).effects).toBeUndefined();
  });

  test('each picture of a group keeps its own effects', () => {
    const { projection } = project(
      pictureMember() +
        pictureMember({ blip: '<a:blip r:embed="rIdTwo"><a:alphaModFix amt="25000"/></a:blip>' })
    );
    expect(projection.groupPicture?.effects).toBeUndefined();
    expect(projection.groupPictureLayers?.map((layer) => layer.effects?.opacity)).toEqual([0.25]);
  });
});

describe('a shape member with a picture fill', () => {
  test('reads as a picture member at the node of the shape', () => {
    const { projection, memberIds } = project(shapeMember(blipFill()));
    expect(projection.diagnostics).toEqual([]);
    expect(projection.picture).toBeNull();
    expect(projection.groupPicture).toMatchObject({
      embeddedRelationshipId: 'rIdImg',
      linkedRelationshipId: null,
      frameEmu: BOX,
      crop: NO_CROP,
      memberNodeId: memberIds[0]!,
    });
    // The vector projection does not paint a fill for the same member.
    expect(projection.vectorShape).toBeNull();
  });

  test('keeps its fill rectangle, source rectangle and blip effects', () => {
    const fill = blipFill(
      `<a:srcRect t="10000"/>${fillRect('l="50000"')}`,
      '<a:blip r:embed="rIdImg"><a:alphaModFix amt="40000"/></a:blip>'
    );
    const picture = pictureOf(shapeMember(fill));
    expect(picture.frameEmu).toEqual({ ...BOX, x: 3_000_000, cx: 3_000_000 });
    expectCrop(picture.crop, { left: 0, top: 0.1, right: 0, bottom: 0 });
    expect(picture.effects?.opacity).toBe(0.4);
  });

  test('paints its outline over the picture, and no fill', () => {
    const line = '<a:ln w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>';
    const { projection } = project(shapeMember(blipFill(), line));
    expect(projection.groupPicture).not.toBeNull();
    expect(
      projection.vectorShape?.components.map((c) => ({ fill: c.fillHex, stroke: c.strokeHex }))
    ).toEqual([{ fill: null, stroke: 'FF0000' }]);
    expect(projection.diagnostics).toEqual([]);
  });

  test('keeps its document order among the other members', () => {
    // Bar, picture shape, bar: the first bar paints under the picture and the second over it.
    const { projection } = project(BAR + shapeMember(blipFill()) + BAR);
    expect(projection.groupPicture).not.toBeNull();
    expect(projection.vectorShape?.components.map((c) => c.picturesBelow)).toEqual([0, undefined]);
    expect(projection.diagnostics).toEqual([]);
  });

  test('keeps its text beside the picture', () => {
    const text =
      '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Label</w:t></w:r></w:p></w:txbxContent></wps:txbx>';
    const { projection } = project(shapeMember(blipFill(), '', text));
    expect(projection.groupPicture).toMatchObject({ frameEmu: BOX });
    expect(projection.groupTextboxes).toHaveLength(1);
    expect(projection.diagnostics).toEqual([]);
  });

  test('a solid fill before the picture fill is the fill of the shape', () => {
    // The first fill choice wins (EG_FillProperties allows one).
    const { projection } = project(
      shapeMember('<a:solidFill><a:srgbClr val="0000FF"/></a:solidFill>', blipFill())
    );
    expect(projection.groupPicture).toBeNull();
    expect(projection.vectorShape?.components.map((c) => c.fillHex)).toEqual(['0000FF']);
  });

  const TILED = blipFill('<a:tile tx="0" ty="0" sx="100000" sy="100000"/>');

  test('a tiled picture fill is not a picture member', () => {
    const { projection } = project(shapeMember(TILED) + BAR);
    expect(projection.groupPicture).toBeNull();
    expect(projection.groupPictureLayers).toBeUndefined();
    // The other member still paints, and no component carries a fill for the tiled shape.
    expect(projection.vectorShape?.components.map((c) => c.fillHex)).toEqual(['00FF00']);
    // A tiled `pic:pic` is not a picture member either, and the report names it.
    const tiledPicture = project(
      pictureMember({ fill: '<a:tile tx="0" ty="0" sx="100000" sy="100000"/>' }) + BAR
    );
    expect(tiledPicture.projection.groupPicture).toBeNull();
    expect(tiledPicture.projection.diagnostics).toEqual([
      { code: 'group-member-not-shown', nodeId: tiledPicture.memberIds[0]!, detail: null },
    ]);
  });

  // A tiled picture fill does not paint. The bar still paints, and the diagnostic names the
  // shape, as it names a tiled `pic:pic` in the same place.
  test('a shape whose picture fill cannot paint is reported as a member not shown', () => {
    const { projection, memberIds } = project(shapeMember(TILED) + BAR);
    expect(projection.diagnostics).toEqual([
      { code: 'group-member-not-shown', nodeId: memberIds[0]!, detail: null },
    ]);
  });
});

describe('the frame of a picture member', () => {
  const LINE = '<a:ln w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>';
  const SHADOW =
    '<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000">' +
    '<a:srgbClr val="000000"/></a:outerShdw></a:effectLst>';

  // A fill on `pic:spPr` shows where the picture is transparent, so it paints under the
  // picture. The outline paints over it. The shadow of a picture member does not paint.
  test('its fill paints under the picture and its outline over it, with no shadow', () => {
    const framed = pictureMember({
      geometry: `${RECT}<a:solidFill><a:srgbClr val="0000FF"/></a:solidFill>${LINE}${SHADOW}`,
    });
    const { projection } = project(framed);
    expect(projection.groupPicture).not.toBeNull();
    expect(
      projection.vectorShape?.components.map((c) => ({
        fill: c.fillHex,
        stroke: c.strokeHex,
        picturesBelow: c.picturesBelow,
        shadow: c.shadow !== undefined,
      }))
    ).toEqual([
      { fill: '0000FF', stroke: null, picturesBelow: 0, shadow: false },
      { fill: null, stroke: 'FF0000', picturesBelow: undefined, shadow: false },
    ]);
    expect(projection.diagnostics).toEqual([]);
  });

  // A `donut` has two filled outlines, so it gives no clip ring. The picture paints as a
  // rectangle, and the diagnostic names the member.
  test('a geometry that gives no clip ring is reported, and the picture still paints', () => {
    const { projection, memberIds } = project(
      pictureMember({ geometry: '<a:prstGeom prst="donut"><a:avLst/></a:prstGeom>' })
    );
    expect(projection.groupPicture).toMatchObject({ frameEmu: BOX });
    expect(projection.groupPicture?.memberClipUnit).toBeUndefined();
    expect(projection.diagnostics).toEqual([
      { code: 'group-member-not-shown', nodeId: memberIds[0]!, detail: null },
    ]);
  });

  // The outline of a turned picture is placed as a turned shape member is placed: the box
  // scales first and then turns, so unequal group scales do not skew it.
  test('the outline of a turned picture keeps the size of the picture frame', () => {
    const { projection } = project(
      pictureMember({ xfrmAttributes: ' rot="5400000"', geometry: RECT + LINE })
    );
    const points = projection.vectorShape!.components[0]!.subpathsEmu.flat();
    const span = (axis: 'x' | 'y') =>
      Math.max(...points.map((point) => point[axis])) -
      Math.min(...points.map((point) => point[axis]));
    // The frame is 6000000 x 2000000 EMU; a quarter turn swaps the sides of the outline.
    expect(span('x')).toBeCloseTo(BOX.cy, 0);
    expect(span('y')).toBeCloseTo(BOX.cx, 0);
  });

  // A shape often carries `wps:style`, and the outline then comes from the theme
  // line that `a:lnRef` names (CT_StyleMatrixReference; ECMA-376 Part 1, 20.1.4.2.19).
  test('a shape with a picture fill takes its outline from its style', () => {
    const themeLine = readOoxmlPart(
      `<a:ln xmlns:a="${A}" w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`,
      { name: '/word/theme/theme1.xml', contentType: 'application/xml' }
    );
    if (!themeLine.ok) throw new Error(themeLine.reason);
    const style =
      '<wps:style><a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef>' +
      '<a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef>' +
      '<a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>' +
      '<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></wps:style>';
    const part = parsePart(
      `<w:p><w:r>${groupDrawing(shapeMember(blipFill(), '', style))}</w:r></w:p>`
    );
    const [projection] = projectDrawingsInPart(part, {
      resolveSchemeColor: () => '4472C4',
      resolveStyleMatrixReference: (kind) => (kind === 'line' ? themeLine.part.root : null),
    });
    expect(projection!.groupPicture).not.toBeNull();
    expect(
      projection!.vectorShape?.components.map((c) => ({
        fill: c.fillHex,
        stroke: c.strokeHex,
        width: c.strokeWidthEmu,
      }))
    ).toEqual([{ fill: null, stroke: '4472C4', width: 12_700 }]);
  });

  // The bound on a member's place applies to its upright box, as for a shape member. A turned
  // group can move a small picture at one end past the extent, and the picture still paints.
  test('a picture at the end of a quarter-turned group still paints', () => {
    const small = pictureMember().replace('cx="3000" cy="1000"', 'cx="500" cy="500"');
    const { projection } = project(small + BAR, ' rot="5400000"');
    expect(projection.groupPicture).not.toBeNull();
    expect(projection.diagnostics).toEqual([]);
  });
});

// `a:blipFill/@rotWithShape` false (CT_BlipFillProperties; Part 1, 20.1.8.14): the fill does
// not turn or mirror with its shape. It stretches upright over the bounding box of the turned
// geometry, and the turned geometry cuts it.
describe('a picture fill that does not turn with its shape', () => {
  const upright = (xfrmAttributes: string, attribute = ' rotWithShape="0"') =>
    pictureOf(
      shapeMember(
        `<a:blipFill${attribute}><a:blip r:embed="rIdImg"/>${STRETCH}</a:blipFill>`
      ).replace('<a:xfrm>', `<a:xfrm${xfrmAttributes}>`)
    );
  // The shape is 6 000 000 by 2 000 000 EMU at the top left of the extent.
  const CENTRE = { x: 3_000_000, y: 1_000_000 };

  test('a quarter turn: the fill takes the turned box, upright', () => {
    const picture = upright(' rot="5400000"');
    expect(picture.rotationDegrees).toBeUndefined();
    expect(picture.flipH).toBeUndefined();
    expect(picture.frameEmu.cx).toBeCloseTo(2_000_000, 3);
    expect(picture.frameEmu.cy).toBeCloseTo(6_000_000, 3);
    expect(picture.frameEmu.x + picture.frameEmu.cx / 2).toBeCloseTo(CENTRE.x, 3);
    expect(picture.frameEmu.y + picture.frameEmu.cy / 2).toBeCloseTo(CENTRE.y, 3);
    expectCrop(picture.crop, NO_CROP);
    // The turned rectangle fills its own bounding box.
    const ring = picture.memberClipUnit!;
    expect(ring).toHaveLength(4);
    for (const point of ring) {
      expect(Math.min(Math.abs(point.x), Math.abs(point.x - 1))).toBeCloseTo(0, 9);
      expect(Math.min(Math.abs(point.y), Math.abs(point.y - 1))).toBeCloseTo(0, 9);
    }
  });

  test('a 30 degree turn: the turned rectangle cuts the upright fill', () => {
    const picture = upright(' rot="1800000"');
    const cos = Math.cos(Math.PI / 6);
    const sin = Math.sin(Math.PI / 6);
    expect(picture.rotationDegrees).toBeUndefined();
    expect(picture.frameEmu.cx).toBeCloseTo(6_000_000 * cos + 2_000_000 * sin, 3);
    expect(picture.frameEmu.cy).toBeCloseTo(6_000_000 * sin + 2_000_000 * cos, 3);
    expect(picture.frameEmu.x + picture.frameEmu.cx / 2).toBeCloseTo(CENTRE.x, 3);
    // The top left corner of the shape lands on the left edge of the bounding box.
    const [topLeft, topRight] = picture.memberClipUnit!;
    expect(topLeft!.x).toBeCloseTo((2_000_000 * sin) / picture.frameEmu.cx, 9);
    expect(topLeft!.y).toBeCloseTo(0, 9);
    expect(topRight!.x).toBeCloseTo(1, 9);
  });

  test('a mirrored shape does not mirror the fill', () => {
    const picture = upright(' flipH="1"');
    expect(picture.flipH).toBeUndefined();
    expect(picture.rotationDegrees).toBeUndefined();
    expect(picture.frameEmu).toEqual({ x: 0, y: 0, cx: 6_000_000, cy: 2_000_000 });
  });

  test('the turn of the group does not turn the fill', () => {
    const picture = pictureOf(
      shapeMember(`<a:blipFill rotWithShape="0"><a:blip r:embed="rIdImg"/>${STRETCH}</a:blipFill>`),
      ' rot="5400000"'
    );
    expect(picture.rotationDegrees).toBeUndefined();
    expect(picture.frameEmu.cx).toBeCloseTo(2_000_000, 3);
    expect(picture.frameEmu.cy).toBeCloseTo(6_000_000, 3);
  });

  test('a fill that turns with its shape keeps the turn', () => {
    for (const attribute of [' rotWithShape="1"', '']) {
      const picture = upright(' rot="5400000"', attribute);
      expect(picture.rotationDegrees).toBe(90);
      expect(picture.frameEmu).toEqual({ x: 0, y: 0, cx: 6_000_000, cy: 2_000_000 });
    }
  });

  test('an upright shape keeps its plain frame', () => {
    const picture = upright('');
    expect(picture.memberClipUnit).toBeUndefined();
    expect(picture.frameEmu).toEqual({ x: 0, y: 0, cx: 6_000_000, cy: 2_000_000 });
  });

  test('an ellipse takes the bounding box of the turned ellipse, with small child units', () => {
    // The child space is 3000 by 4000 units for 6 000 000 by 8 000 000 EMU. The ring flattens
    // at the painted size, so the box is that of the true ellipse: for semi-axes a = 3 000 000
    // and b = 1 000 000 turned 45 degrees, each side is 2 * sqrt((a^2 + b^2) / 2).
    const picture = pictureOf(
      shapeMember(`<a:blipFill rotWithShape="0"><a:blip r:embed="rIdImg"/>${STRETCH}</a:blipFill>`)
        .replace('<a:xfrm>', '<a:xfrm rot="2700000">')
        .replace('prst="rect"', 'prst="ellipse"')
    );
    const side = 2 * Math.sqrt((3_000_000 ** 2 + 1_000_000 ** 2) / 2);
    expect(Math.abs(picture.frameEmu.cx - side) / side).toBeLessThan(0.002);
    expect(Math.abs(picture.frameEmu.cy - side) / side).toBeLessThan(0.002);
    expect(picture.memberClipUnit!.length).toBeGreaterThan(40);
  });
});

// The ring of a picture member flattens at the painted size. A custom geometry with many
// curves passes the point limit at that size, and then keeps the ring of its own extent.
test('a custom geometry with many curves still clips its picture, with small child units', () => {
  const curves = Array.from({ length: 40 }, (_, at) => {
    const angle = (step: number) => ((at + step) / 40) * 2 * Math.PI;
    const point = (step: number, reach: number) =>
      `<a:pt x="${Math.round(1500 + 1500 * reach * Math.cos(angle(step)))}" ` +
      `y="${Math.round(500 + 500 * reach * Math.sin(angle(step)))}"/>`;
    return `<a:cubicBezTo>${point(1 / 3, 0.6)}${point(2 / 3, 0.6)}${point(1, 1)}</a:cubicBezTo>`;
  }).join('');
  const geometry =
    '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/>' +
    '<a:pathLst><a:path w="3000" h="1000"><a:moveTo><a:pt x="3000" y="500"/></a:moveTo>' +
    `${curves}<a:close/></a:path></a:pathLst></a:custGeom>`;
  const picture = pictureOf(pictureMember({ geometry }));
  expect(picture.memberClipUnit!.length).toBeGreaterThan(40);
});
