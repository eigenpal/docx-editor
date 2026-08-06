// Word emits decorative rules and signature marks as `wps:wsp` custom-geometry shapes
// wrapped in run-level `mc:AlternateContent` (Choice Requires="wps", Fallback VML).
// The projection must (1) select the wps Choice branch instead of dropping the atom, and
// (2) type solid-fill polygon geometry so paint can draw the shape instead of a card.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI } from '../index.ts';
import {
  indexInlineDrawingProjectionsInPart,
  DEFAULT_DRAWING_PROJECTION_LIMITS,
} from '../package/drawing-projection.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';
const OWNER = '/word/document.xml';

function parsePart(body: string) {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:wps="${WPS}" xmlns:mc="${MC}" xmlns:v="${V}"><w:body>${body}</w:body></w:document>`;
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
      '<a:cubicBezTo><a:pt x="1" y="1"/><a:pt x="2" y="2"/><a:pt x="0" y="38100"/></a:cubicBezTo>'
    );
    const part = parsePart(`<w:p><w:r>${mcWrapped(bezier)}</w:r></w:p>`);
    const atoms = indexInlineDrawingProjectionsInPart(part);
    expect(atoms.size).toBe(0);
  });

  test('limits are respected', () => {
    expect(DEFAULT_DRAWING_PROJECTION_LIMITS.maxVisitedElements).toBeGreaterThan(0);
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
