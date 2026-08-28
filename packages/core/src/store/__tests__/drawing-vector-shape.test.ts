// Word emits decorative rules and signature marks as `wps:wsp` custom-geometry shapes
// wrapped in run-level `mc:AlternateContent` (Choice Requires="wps", Fallback VML).
// The projection must (1) select the wps Choice branch instead of dropping the atom, and
// (2) type solid-fill polygon geometry so paint can draw the shape instead of a card.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI, type OoxmlPackage } from '../index.ts';
import {
  indexInlineDrawingProjectionsInPart,
  DEFAULT_DRAWING_PROJECTION_LIMITS,
} from '../package/drawing-projection.ts';
import { createPackageShapeThemeResolvers } from '../package/theme-color-resolution.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';
const OWNER = '/word/document.xml';
const ELLIPSE_POINT_COUNT = 32;

function parsePart(body: string) {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:wps="${WPS}" xmlns:wpg="${WPG}" xmlns:mc="${MC}" xmlns:v="${V}">` +
    `<w:body>${body}</w:body></w:document>`;
  const parsed = readOoxmlPart(xml, {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

/** Double-rule custGeom shape, verbatim structure from Word's cover-page separator. */
function doubleRuleShapeDrawing(): string {
  return (
    '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="487593984" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>428612</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>145771</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="6696075" cy="47625"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapTopAndBottom/><wp:docPr id="5" name="Graphic 5"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<wps:wsp><wps:cNvSpPr><a:spLocks/></wps:cNvSpPr><wps:spPr>' +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="6696075" cy="47625"/></a:xfrm>' +
    '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/>' +
    '<a:pathLst>' +
    '<a:path w="6696075" h="47625">' +
    '<a:moveTo><a:pt x="6696075" y="38100"/></a:moveTo>' +
    '<a:lnTo><a:pt x="0" y="38100"/></a:lnTo>' +
    '<a:lnTo><a:pt x="0" y="47625"/></a:lnTo>' +
    '<a:lnTo><a:pt x="6696075" y="47625"/></a:lnTo>' +
    '<a:lnTo><a:pt x="6696075" y="38100"/></a:lnTo>' +
    '<a:close/></a:path>' +
    '<a:path w="6696075" h="47625">' +
    '<a:moveTo><a:pt x="6696075" y="0"/></a:moveTo>' +
    '<a:lnTo><a:pt x="0" y="0"/></a:lnTo>' +
    '<a:lnTo><a:pt x="0" y="9525"/></a:lnTo>' +
    '<a:lnTo><a:pt x="6696075" y="9525"/></a:lnTo>' +
    '<a:lnTo><a:pt x="6696075" y="0"/></a:lnTo>' +
    '<a:close/></a:path>' +
    '</a:pathLst></a:custGeom>' +
    '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>' +
    '</wps:spPr><wps:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0">' +
    '<a:prstTxWarp prst="textNoShape"><a:avLst/></a:prstTxWarp><a:noAutofit/></wps:bodyPr>' +
    '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>'
  );
}

function mcWrapped(drawing: string): string {
  return (
    '<mc:AlternateContent><mc:Choice Requires="wps">' +
    drawing +
    '</mc:Choice><mc:Fallback><w:pict>' +
    '<v:shape id="s1" style="position:absolute" coordsize="6696075,47625" path="m0,0l10,10e"/>' +
    '</w:pict></mc:Fallback></mc:AlternateContent>'
  );
}

describe('wps vector shape projection', () => {
  test('package theme colours honor the settings colour mapping', () => {
    const theme = readOoxmlPart(
      `<a:theme xmlns:a="${A}"><a:themeElements><a:clrScheme name="Test">` +
        '<a:accent1><a:srgbClr val="112233"/></a:accent1>' +
        '<a:accent2><a:srgbClr val="AABBCC"/></a:accent2>' +
        '<a:dk2><a:srgbClr val="334455"/></a:dk2>' +
        '</a:clrScheme><a:fmtScheme name="Test">' +
        '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
        '<a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/>' +
        '</a:fmtScheme></a:themeElements></a:theme>',
      { name: '/word/theme/theme1.xml', contentType: 'application/xml' }
    );
    const settings = readOoxmlPart(
      `<w:settings xmlns:w="${WML_NAMESPACE_URI}">` +
        '<w:clrSchemeMapping w:accent1="accent2" w:bg1="dark2"/>' +
        '</w:settings>',
      { name: '/word/settings.xml', contentType: 'application/xml' }
    );
    if (!theme.ok || !settings.ok) throw new Error('test package parts must parse');
    const pkg = {
      parts: new Map([
        ['/word/theme/theme1.xml', theme.part],
        ['/word/settings.xml', settings.part],
      ]),
      partBytes: new Map(),
      relationships: new Map(),
      externalTargets: [],
      contentTypes: {},
      mainDocumentPart: OWNER,
    } as unknown as OoxmlPackage;
    const themeResolvers = createPackageShapeThemeResolvers(pkg);
    const resolve = themeResolvers.resolveSchemeColor;
    expect(resolve('accent1')).toBe('AABBCC');
    expect(resolve('accent2')).toBe('AABBCC');
    expect(resolve('bg1')).toBe('334455');
    expect(resolve('missing')).toBeNull();
    expect(themeResolvers.resolveStyleMatrixReference('fill', 1)?.localName).toBe('solidFill');
    const changedTheme = readOoxmlPart(
      `<a:theme xmlns:a="${A}"><a:themeElements><a:clrScheme name="Changed">` +
        '<a:accent1><a:srgbClr val="FFFFFF"/></a:accent1>' +
        '</a:clrScheme></a:themeElements></a:theme>',
      { name: '/word/theme/theme1.xml', contentType: 'application/xml' }
    );
    if (!changedTheme.ok) throw new Error(changedTheme.reason);
    const changedPackage = {
      ...pkg,
      parts: new Map(pkg.parts).set('/word/theme/theme1.xml', changedTheme.part),
    };
    expect(createPackageShapeThemeResolvers(changedPackage).cacheToken).not.toBe(
      themeResolvers.cacheToken
    );
  });

  test('MC-wrapped anchored custGeom shape projects with typed vector geometry', () => {
    const part = parsePart(`<w:p><w:r>${mcWrapped(doubleRuleShapeDrawing())}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part);
    expect(atoms.size).toBe(1);
    const projection = [...atoms.values()][0]!;
    expect(projection.kind).toBe('anchored');
    expect(projection.extentEmu).toEqual({ cx: 6696075, cy: 47625 });
    expect(projection.picture).toBeNull();
    // Compatibility (generic) anchors must still read wrap and position — a dropped
    // position paints the shape at the page origin.
    expect(projection.wrap).toBe('topAndBottom');
    expect(projection.position?.horizontal).toEqual({
      relativeFrom: 'page',
      align: null,
      offsetEmu: 428612,
    });
    expect(projection.position?.vertical).toEqual({
      relativeFrom: 'paragraph',
      align: null,
      offsetEmu: 145771,
    });
    const shape = projection.vectorShape;
    expect(shape).not.toBeNull();
    expect(shape!.fillHex).toBe('000000');
    expect(shape!.strokeHex).toBeNull();
    expect(shape!.subpathsEmu).toHaveLength(2);
    // Points land in extent-EMU space (path w/h equals the extent here).
    expect(shape!.subpathsEmu[0]![0]).toEqual({ x: 6696075, y: 38100 });
    expect(shape!.subpathsEmu[1]![2]).toEqual({ x: 0, y: 9525 });
  });

  test('direct (unwrapped) wps shape also carries vector geometry', () => {
    const part = parsePart(`<w:p><w:r>${doubleRuleShapeDrawing()}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part);
    expect(atoms.size).toBe(1);
    expect([...atoms.values()][0]!.vectorShape).not.toBeNull();
  });

  test('scheme colours apply luminance and alpha transforms', () => {
    const drawing = doubleRuleShapeDrawing().replace(
      '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>',
      '<a:solidFill><a:schemeClr val="accent1">' +
        '<a:lumMod val="50000"/><a:alpha val="50000"/>' +
        '</a:schemeClr></a:solidFill>'
    );
    const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part, {
      resolveSchemeColor: (token) => (token === 'accent1' ? '4472C4' : null),
    });
    const shape = [...atoms.values()][0]!.vectorShape!;
    expect(shape.fillHex).toBe('203864');
    expect(shape.fillAlpha).toBe(0.5);
  });

  test('theme colours apply tint, shade, and luminance offset transforms', () => {
    const cases = [
      ['tint', '50000', 'C0C0C0'],
      ['shade', '50000', '404040'],
      ['lumOff', '10000', '9A9A9A'],
    ] as const;
    for (const [transform, value, expected] of cases) {
      const drawing = doubleRuleShapeDrawing().replace(
        '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>',
        `<a:solidFill><a:schemeClr val="accent1"><a:${transform} val="${value}"/>` +
          '</a:schemeClr></a:solidFill>'
      );
      const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
      const atoms = indexInlineDrawingProjectionsInPart(part, {
        resolveSchemeColor: () => '808080',
      });
      expect([...atoms.values()][0]!.vectorShape?.fillHex).toBe(expected);
    }
  });

  test('a shape style fill reference resolves its theme colour', () => {
    const drawing = doubleRuleShapeDrawing()
      .replace('<a:solidFill><a:srgbClr val="000000"/></a:solidFill>', '')
      .replace(
        '</wps:spPr>',
        '</wps:spPr><wps:style><a:fillRef idx="1">' +
          '<a:schemeClr val="accent1"/>' +
          '</a:fillRef></wps:style>'
      );
    const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
    const matrix = readOoxmlPart(
      `<a:solidFill xmlns:a="${A}"><a:schemeClr val="phClr"/></a:solidFill>`,
      { name: '/word/theme/test.xml', contentType: 'application/xml' }
    );
    if (!matrix.ok) throw new Error(matrix.reason);
    const atoms = indexInlineDrawingProjectionsInPart(part, {
      resolveSchemeColor: () => '4472C4',
      resolveStyleMatrixReference: () => matrix.part.root,
    });
    expect([...atoms.values()][0]!.vectorShape?.fillHex).toBe('4472C4');
  });

  test('explicit noFill does not fall through to a style fill reference', () => {
    const drawing = doubleRuleShapeDrawing()
      .replace('<a:solidFill><a:srgbClr val="000000"/></a:solidFill>', '<a:noFill/>')
      .replace(
        '</wps:spPr>',
        '</wps:spPr><wps:style><a:fillRef idx="1">' +
          '<a:schemeClr val="accent1"/>' +
          '</a:fillRef></wps:style>'
      );
    const matrix = readOoxmlPart(
      `<a:solidFill xmlns:a="${A}"><a:schemeClr val="phClr"/></a:solidFill>`,
      { name: '/word/theme/test.xml', contentType: 'application/xml' }
    );
    if (!matrix.ok) throw new Error(matrix.reason);
    const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
    const projection = [
      ...indexInlineDrawingProjectionsInPart(part, {
        resolveSchemeColor: () => '4472C4',
        resolveStyleMatrixReference: () => matrix.part.root,
      }).values(),
    ][0]!;
    expect(projection.vectorShape).toBeNull();
  });

  test('a line style reference paints without a direct line node', () => {
    const drawing = doubleRuleShapeDrawing().replace(
      '</wps:spPr>',
      '</wps:spPr><wps:style><a:lnRef idx="1">' +
        '<a:schemeClr val="accent1"/>' +
        '</a:lnRef></wps:style>'
    );
    const matrix = readOoxmlPart(
      `<a:ln xmlns:a="${A}" w="25400">` +
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
        '</a:ln>',
      { name: '/word/theme/test.xml', contentType: 'application/xml' }
    );
    if (!matrix.ok) throw new Error(matrix.reason);
    const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
    const shape = [
      ...indexInlineDrawingProjectionsInPart(part, {
        resolveSchemeColor: () => '4472C4',
        resolveStyleMatrixReference: () => matrix.part.root,
      }).values(),
    ][0]!.vectorShape!;
    expect(shape.strokeHex).toBe('4472C4');
    expect(shape.strokeWidthEmu).toBe(25_400);
  });

  test('an out-of-range colour transform refuses the vector payload', () => {
    const drawing = doubleRuleShapeDrawing().replace(
      '<a:solidFill><a:srgbClr val="000000"/></a:solidFill>',
      '<a:solidFill><a:schemeClr val="accent1">' +
        '<a:lumMod val="100001"/>' +
        '</a:schemeClr></a:solidFill>'
    );
    const part = parsePart(`<w:p><w:r>${mcWrapped(drawing)}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part, {
      resolveSchemeColor: () => '4472C4',
    });
    expect(atoms.size).toBe(0);
  });

  test('an MC wpg group projects each child with its own geometry and colour', () => {
    const drawing =
      '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="200000" cy="100000"/><wp:docPr id="13" name="Group 13"/>' +
      `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:grpSpPr>` +
      '<a:xfrm><a:chOff x="0" y="0"/><a:chExt cx="200000" cy="100000"/></a:xfrm>' +
      '</wpg:grpSpPr>' +
      '<wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100000" cy="100000"/></a:xfrm>' +
      '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>' +
      '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill></wps:spPr></wps:wsp>' +
      '<wps:wsp><wps:spPr><a:xfrm><a:off x="100000" y="0"/><a:ext cx="100000" cy="100000"/></a:xfrm>' +
      '<a:custGeom><a:pathLst><a:path w="100000" h="100000">' +
      '<a:moveTo><a:pt x="0" y="0"/></a:moveTo>' +
      '<a:cubicBezTo><a:pt x="25000" y="0"/><a:pt x="75000" y="100000"/>' +
      '<a:pt x="100000" y="100000"/></a:cubicBezTo><a:close/>' +
      '</a:path></a:pathLst></a:custGeom>' +
      '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></wps:spPr></wps:wsp>' +
      '</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing>';
    const wrapped =
      '<mc:AlternateContent><mc:Choice Requires="wpg">' +
      drawing +
      '</mc:Choice><mc:Fallback><w:pict><v:shape id="fallback"/></w:pict></mc:Fallback>' +
      '</mc:AlternateContent>';
    const directPart = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
    expect(
      indexInlineDrawingProjectionsInPart(directPart, {
        resolveSchemeColor: () => '4472C4',
      }).size
    ).toBe(1);
    const part = parsePart(`<w:p><w:r>${wrapped}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part, {
      resolveSchemeColor: () => '4472C4',
    });
    expect(atoms.size).toBe(1);
    const shape = [...atoms.values()][0]!.vectorShape!;
    expect(shape.components).toHaveLength(2);
    expect(shape.components?.map((component) => component.fillHex)).toEqual(['4472C4', 'FF0000']);
    expect(shape.components?.[0]!.subpathsEmu[0]).toHaveLength(ELLIPSE_POINT_COUNT);
    expect(shape.components?.[1]!.subpathsEmu[0]![0]).toEqual({ x: 100000, y: 0 });

    const rotated = parsePart(
      `<w:p><w:r>${drawing.replace('<a:xfrm><a:chOff', '<a:xfrm rot="60000"><a:chOff')}</w:r></w:p>`
    );
    expect(
      [
        ...indexInlineDrawingProjectionsInPart(rotated, {
          resolveSchemeColor: () => '4472C4',
        }).values(),
      ][0]!.vectorShape
    ).toBeNull();

    const childFlipped = parsePart(
      `<w:p><w:r>${drawing.replace(
        '<wps:wsp><wps:spPr><a:xfrm>',
        '<wps:wsp><wps:spPr><a:xfrm flipH="true">'
      )}</w:r></w:p>`
    );
    expect(
      [
        ...indexInlineDrawingProjectionsInPart(childFlipped, {
          resolveSchemeColor: () => '4472C4',
        }).values(),
      ][0]!.vectorShape
    ).toBeNull();

    const withMetadata = parsePart(
      `<w:p><w:r>${drawing.replace('<wpg:wgp>', '<wpg:wgp><wpg:cNvPr id="1"/>')}</w:r></w:p>`
    );
    expect(
      [
        ...indexInlineDrawingProjectionsInPart(withMetadata, {
          resolveSchemeColor: () => '4472C4',
        }).values(),
      ][0]!.vectorShape
    ).not.toBeNull();

    const nested = parsePart(
      `<w:p><w:r>${drawing.replace('</wpg:wgp>', '<wpg:grpSp/></wpg:wgp>')}</w:r></w:p>`
    );
    expect(
      [
        ...indexInlineDrawingProjectionsInPart(nested, {
          resolveSchemeColor: () => '4472C4',
        }).values(),
      ][0]!.vectorShape
    ).toBeNull();
  });

  test('an MC-wrapped wps textbox projects a story; the VML fallback never renders', () => {
    const drawing =
      '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="914400" cy="457200"/><wp:docPr id="9" name="TextBox 9"/>' +
      '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
      '<wps:wsp><wps:spPr><a:xfrm><a:ext cx="914400" cy="457200"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></wps:spPr>' +
      '<wps:txbx><w:txbxContent><w:p><w:r><w:t>boxed</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
      '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>';
    const part = parsePart(`<w:p><w:r>${mcWrapped(drawing)}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part);
    // ONE projection: the wps Choice branch carries the story; the VML fallback is not a
    // second drawing, so nothing double-renders.
    expect(atoms.size).toBe(1);
    const projection = [...atoms.values()][0]!;
    expect(projection.picture).toBeNull();
    expect(projection.vectorShape).toBeNull();
    const story = projection.textboxStory;
    expect(story).not.toBeNull();
    expect(story!.fillHex).toBe('FF0000');
    expect(story!.verticalAnchor).toBe('top');
    // Empty bodyPr means the OOXML inset defaults, not zero.
    expect(story!.insetsEmu).toEqual({ top: 45_720, right: 91_440, bottom: 45_720, left: 91_440 });
  });

  test('a wps txbx without txbxContent projects no story and keeps the placeholder path', () => {
    const drawing =
      '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="914400" cy="457200"/><wp:docPr id="11" name="TextBox 11"/>' +
      '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
      '<wps:wsp><wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
      '<wps:txbx></wps:txbx>' +
      '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>';
    const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part);
    expect(atoms.size).toBe(1);
    const projection = [...atoms.values()][0]!;
    expect(projection.textboxStory).toBeNull();
    expect(projection.picture).toBeNull();
    expect(projection.diagnostics.filter((d) => d.code === 'unsupported-graphic')).toHaveLength(1);
  });

  test('an MC-wrapped chart stays invisible, like its VML fallback always was', () => {
    const drawing =
      '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="914400" cy="457200"/><wp:docPr id="10" name="Chart 10"/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
      '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>' +
      '</a:graphicData></a:graphic></wp:inline></w:drawing>';
    const part = parsePart(`<w:p><w:r>${mcWrapped(drawing)}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part);
    expect(atoms.size).toBe(0);
  });

  test('unsupported path verbs refuse vector geometry and stay invisible under MC', () => {
    const bezier = doubleRuleShapeDrawing().replace(
      '<a:lnTo><a:pt x="0" y="38100"/></a:lnTo>',
      '<a:quadBezTo><a:pt x="1" y="1"/><a:pt x="0" y="38100"/></a:quadBezTo>'
    );
    const part = parsePart(`<w:p><w:r>${mcWrapped(bezier)}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part);
    expect(atoms.size).toBe(0);
  });

  test('limits are respected', () => {
    expect(DEFAULT_DRAWING_PROJECTION_LIMITS.maxVisitedElements).toBeGreaterThan(0);
  });

  test('an over-limit group does not project unbounded child geometry', () => {
    const child =
      '<wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      '<a:solidFill><a:srgbClr val="000000"/></a:solidFill></wps:spPr></wps:wsp>';
    const drawing =
      '<w:drawing><wp:inline><wp:extent cx="100" cy="100"/><wp:docPr id="14" name="Group"/>' +
      `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:grpSpPr>` +
      '<a:xfrm><a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/></a:xfrm>' +
      `</wpg:grpSpPr>${child.repeat(129)}</wpg:wgp></a:graphicData></a:graphic>` +
      '</wp:inline></w:drawing>';
    const part = parsePart(`<w:p><w:r>${drawing}</w:r></w:p>`);
    const projection = [...indexInlineDrawingProjectionsInPart(part).values()][0]!;
    expect(projection.vectorShape).toBeNull();
  });

  test('a drawing deep in a large document is still discovered', () => {
    // Real documents easily exceed the per-drawing walk budget in TOTAL element count;
    // the part scan must not silently stop before reaching a late drawing.
    const filler = '<w:p><w:r><w:t>x</w:t></w:r></w:p>'.repeat(3000);
    const part = parsePart(`${filler}<w:p><w:r>${mcWrapped(doubleRuleShapeDrawing())}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part);
    expect(atoms.size).toBe(1);
  });
});
