// A `wpg:wgp` group can hold a raster picture beside its vector members, for example a
// scanned page with ruled lines drawn over it. The vector projection accepts `wps:wsp`
// members only, so a picture member made the whole group project as nothing. These tests pin
// the group picture projection: which groups it accepts, where the picture lands inside the
// drawing extent, and every group it still refuses.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI, type OoxmlPart } from '../index.ts';
import {
  indexInlineDrawingProjectionsInPart,
  projectDrawingsInPart,
} from '../package/drawing-projection.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';

/** Group child space: offset (100, 200), extent 3000 x 4000, drawn at 6000000 x 8000000 EMU. */
const SCALE = 2000;

function parsePart(body: string): OoxmlPart {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:pic="${PIC}" xmlns:r="${R}" xmlns:wps="${WPS}" xmlns:wpg="${WPG}" ` +
    `xmlns:mc="${MC}" xmlns:v="${V}"><w:body>${body}</w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

interface PictureOptions {
  readonly x?: number;
  readonly y?: number;
  readonly cx?: number;
  readonly cy?: number;
  readonly xfrmAttributes?: string;
  readonly blip?: string;
  readonly fill?: string;
  readonly geometry?: string;
}

function pictureMember(options: PictureOptions = {}): string {
  const { x = 100, y = 200, cx = 3000, cy = 1000 } = options;
  return (
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill>${options.blip ?? '<a:blip r:embed="rIdImg"/>'}` +
    `${options.fill ?? '<a:stretch><a:fillRect/></a:stretch>'}</pic:blipFill>` +
    `<pic:spPr><a:xfrm${options.xfrmAttributes ?? ''}><a:off x="${x}" y="${y}"/>` +
    `<a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `${options.geometry ?? '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'}</pic:spPr></pic:pic>`
  );
}

/** A thin black bar in group child space. */
function barMember(y: number, x = 600, line = ''): string {
  return (
    '<wps:wsp><wps:cNvPr id="3" name="Bar"/><wps:cNvSpPr/><wps:spPr>' +
    `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="1000" cy="10"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    `<a:solidFill><a:srgbClr val="000000"/></a:solidFill>${line}</wps:spPr><wps:bodyPr/></wps:wsp>`
  );
}

function textboxMember(): string {
  return (
    '<wps:wsp><wps:spPr><a:xfrm><a:off x="600" y="3000"/><a:ext cx="1000" cy="500"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Box</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
    '<wps:bodyPr/></wps:wsp>'
  );
}

function groupDrawing(members: string, groupXfrmAttributes = ''): string {
  return (
    '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="10" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>360000</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>180000</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="6000000" cy="8000000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapNone/><wp:docPr id="1" name="Group 1"/>' +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    `<a:xfrm${groupXfrmAttributes}><a:off x="0" y="0"/><a:ext cx="6000000" cy="8000000"/>` +
    '<a:chOff x="100" y="200"/><a:chExt cx="3000" cy="4000"/></a:xfrm></wpg:grpSpPr>' +
    `${members}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing>`
  );
}

function mcWrapped(drawing: string): string {
  return (
    `<mc:AlternateContent><mc:Choice Requires="wpg">${drawing}</mc:Choice>` +
    '<mc:Fallback><w:pict><v:group id="fallback"/></w:pict></mc:Fallback></mc:AlternateContent>'
  );
}

function projectionsOf(run: string) {
  return projectDrawingsInPart(parsePart(`<w:p><w:r>${run}</w:r></w:p>`));
}

describe('group picture projection', () => {
  test('an MC-wrapped group projects its picture member and its vector members', () => {
    const drawing = groupDrawing(
      pictureMember({ blip: '<a:blip r:embed="rIdImg"><a:extLst/></a:blip>' }) +
        barMember(2100) +
        barMember(2600)
    );
    const projections = projectionsOf(mcWrapped(drawing));
    expect(projections).toHaveLength(1);
    const projection = projections[0]!;
    expect(projection.picture).toBeNull();
    expect(projection.groupPicture).toMatchObject({
      embeddedRelationshipId: 'rIdImg',
      linkedRelationshipId: null,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      frameEmu: { x: 0, y: 0, cx: 3000 * SCALE, cy: 1000 * SCALE },
    });
    // The picture member is not a vector member; only the two bars are.
    expect(projection.vectorShape?.components).toHaveLength(2);
    expect(projection.vectorShape?.components[0]!.subpathsEmu[0]![0]).toEqual({
      x: 500 * SCALE,
      y: 1900 * SCALE,
    });
    expect(projection.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'unsupported-graphic'
    );
  });

  test('the picture frame maps through the group child offset and extent', () => {
    const [projection] = projectionsOf(
      groupDrawing(
        pictureMember({
          x: 1100,
          y: 1200,
          cx: 500,
          cy: 250,
          fill: '<a:srcRect l="10000" t="20000"/><a:stretch><a:fillRect/></a:stretch>',
        })
      )
    );
    expect(projection!.groupPicture).toMatchObject({
      crop: { left: 0.1, top: 0.2, right: 0, bottom: 0 },
      frameEmu: { x: 1000 * SCALE, y: 1000 * SCALE, cx: 500 * SCALE, cy: 250 * SCALE },
    });
    // A picture-only group has no vector members to paint.
    expect(projection!.vectorShape).toBeNull();
  });

  test('a linked picture member names its link and never an embedded part', () => {
    const [projection] = projectionsOf(
      mcWrapped(groupDrawing(pictureMember({ blip: '<a:blip r:link="rIdLink"/>' })))
    );
    expect(projection!.groupPicture).toMatchObject({
      embeddedRelationshipId: null,
      linkedRelationshipId: 'rIdLink',
    });
  });

  test('only an MC-wrapped group picture is marked as alternate content', () => {
    // Layout drops an MC-wrapped group whose picture resource fails; a bare group keeps its card.
    const drawing = groupDrawing(pictureMember() + barMember(2100));
    expect(projectionsOf(mcWrapped(drawing))[0]!.groupPicture?.alternateContent).toBe(true);
    expect(projectionsOf(drawing)[0]!.groupPicture?.alternateContent).toBe(false);
  });

  test('a picture frame partly outside the group extent keeps its frame', () => {
    // Half the picture lies left of the child offset; paint clips it to the extent.
    const [projection] = projectionsOf(groupDrawing(pictureMember({ x: -1400 })));
    expect(projection!.groupPicture?.frameEmu).toEqual({
      x: -1500 * SCALE,
      y: 0,
      cx: 3000 * SCALE,
      cy: 1000 * SCALE,
    });
  });

  test('the run-level atom index carries the group picture', () => {
    const part = parsePart(`<w:p><w:r>${mcWrapped(groupDrawing(pictureMember()))}</w:r></w:p>`);
    const atoms = [...indexInlineDrawingProjectionsInPart(part).values()];
    expect(atoms).toHaveLength(1);
    expect(atoms[0]!.groupPicture?.embeddedRelationshipId).toBe('rIdImg');
  });

  const refused: readonly (readonly [string, string])[] = [
    ['two picture members', groupDrawing(pictureMember() + pictureMember({ y: 1500 }))],
    ['a picture above a vector member', groupDrawing(barMember(2100) + pictureMember())],
    ['a rotated picture', groupDrawing(pictureMember({ xfrmAttributes: ' rot="5400000"' }))],
    ['a flipped picture', groupDrawing(pictureMember({ xfrmAttributes: ' flipH="1"' }))],
    [
      'a picture with a blip effect',
      groupDrawing(pictureMember({ blip: '<a:blip r:embed="rIdImg"><a:grayscl/></a:blip>' })),
    ],
    [
      'a tiled picture',
      groupDrawing(pictureMember({ fill: '<a:tile tx="0" ty="0" sx="100000" sy="100000"/>' })),
    ],
    [
      'a picture with a non-rectangle geometry',
      groupDrawing(
        pictureMember({ geometry: '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>' })
      ),
    ],
    ['a picture without a relationship', groupDrawing(pictureMember({ blip: '<a:blip/>' }))],
    ['a picture without an extent', groupDrawing(pictureMember({ cx: 0 }))],
    ['a picture beside a text box member', groupDrawing(pictureMember() + textboxMember())],
    ['a picture beside a nested group', groupDrawing(pictureMember() + '<wpg:grpSp/>')],
    ['a rotated group', groupDrawing(pictureMember(), ' rot="60000"')],
    // A zero child extent is legal for a group of straight lines, but leaves a picture no size.
    [
      'a group with a zero child extent',
      groupDrawing(pictureMember()).replace('<a:chExt cx="3000"', '<a:chExt cx="0"'),
    ],
    // Frame bounds: a frame with no visible part, or one that reaches more than one extent
    // past the group, is refused before its coordinates reach any output.
    ['a picture right of the group extent', groupDrawing(pictureMember({ x: 3100 }))],
    ['a picture above the group extent', groupDrawing(pictureMember({ y: -800 }))],
    [
      'a picture offset far past the group extent',
      groupDrawing(pictureMember({ x: 999999999999999 }) + barMember(2100)),
    ],
    [
      'a picture reaching more than one extent past the group',
      groupDrawing(pictureMember({ x: -2950, cx: 3200 })),
    ],
    // The picture makes its vector members visible, so they get the same outer bound.
    [
      'a vector member far past a picture group',
      groupDrawing(pictureMember() + barMember(2100, 999999999999999)),
    ],
    [
      'a vector member stroke wider than a picture group',
      groupDrawing(
        pictureMember() +
          barMember(
            2100,
            600,
            '<a:ln w="7000"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>'
          )
      ),
    ],
  ];

  for (const [name, drawing] of refused) {
    test(`${name} stays unpainted`, () => {
      // Under MC the unpaintable group stays invisible, as it was before group pictures.
      expect(projectionsOf(mcWrapped(drawing))).toHaveLength(0);
      // A bare drawing still projects, for its placeholder, but with no picture to paint.
      const [bare] = projectionsOf(drawing);
      expect(bare!.groupPicture).toBeNull();
      expect(bare!.picture).toBeNull();
    });
  }
});
