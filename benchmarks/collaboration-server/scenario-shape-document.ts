// The document and edit mix of the `shapeFormat` shapes: shapes with direct, theme, style,
// hidden and group fills, an outline with a dash and a join, a VML fallback, and a text box,
// each anchored in a paragraph that peers type in, split, join, and delete.

import type { EditKind } from './scenario-plan.ts';

const NS =
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml"';
const WPS_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const EXT = (cx: number, cy: number) =>
  `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
const RECT = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
const STYLE =
  '<wps:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef>' +
  '<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>' +
  '<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></wps:style>';

const anchor = (id: number, uri: string, cx: number, cy: number, payload: string, ns = '') =>
  `<w:drawing ${ns}><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" ` +
  `relativeHeight="${id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
  `<wp:docPr id="${id}" name="Shape ${id}"/><wp:cNvGraphicFramePr/>` +
  `<a:graphic><a:graphicData uri="${uri}">${payload}</a:graphicData></a:graphic></wp:anchor></w:drawing>`;

const wsp = (spPr: string, extra = '', id?: number) =>
  `<wps:wsp>${id === undefined ? '' : `<wps:cNvPr id="${id}" name="Member ${id}"/>`}<wps:cNvSpPr/>` +
  `<wps:spPr>${spPr}</wps:spPr>${extra}<wps:bodyPr/></wps:wsp>`;

const para = (text: string, run = '') =>
  `<w:p><w:r>${run}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** A direct fill and outline with dash and join, wrapped with a VML fallback. */
const ALTERNATE =
  `<mc:AlternateContent ${NS}><mc:Choice Requires="wps">` +
  anchor(
    1,
    WPS_URI,
    1828800,
    457200,
    wsp(
      `${EXT(1828800, 457200)}${RECT}<a:solidFill><a:srgbClr val="D9E2F3"/></a:solidFill>` +
        '<a:ln w="12700"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:prstDash val="dash"/><a:round/></a:ln>'
    )
  ) +
  '</mc:Choice><mc:Fallback><w:pict><v:rect id="_x0000_s1026" style="width:144pt;height:36pt" ' +
  'fillcolor="#d9e2f3" strokecolor="#1f3864" strokeweight="1pt"/></w:pict></mc:Fallback></mc:AlternateContent>';

/** A theme fill and outline with luminance transforms. */
const THEMED = anchor(
  2,
  WPS_URI,
  1371600,
  457200,
  wsp(
    `${EXT(1371600, 457200)}${RECT}<a:solidFill><a:schemeClr val="accent1"><a:lumMod val="75000"/>` +
      '<a:lumOff val="25000"/></a:schemeClr></a:solidFill><a:ln w="9525"><a:solidFill>' +
      '<a:schemeClr val="tx1"><a:lumMod val="50000"/><a:lumOff val="50000"/></a:schemeClr></a:solidFill></a:ln>',
    STYLE
  ),
  NS
);

/** A text box painted by its style alone. */
const STYLED_BOX = anchor(
  3,
  WPS_URI,
  1828800,
  685800,
  wsp(
    `${EXT(1828800, 685800)}${RECT}`,
    '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Text box words to type in</w:t></w:r></w:p>' +
      '</w:txbxContent></wps:txbx>' +
      STYLE
  ),
  NS
);

/** No fill and no line, with the earlier fill and line kept hidden. */
const HIDDEN = anchor(
  4,
  WPS_URI,
  914400,
  457200,
  wsp(
    `${EXT(914400, 457200)}${RECT}<a:noFill/><a:ln w="12700"><a:noFill/></a:ln>` +
      '<a:extLst><a:ext uri="{909E8E84-426E-40DD-AFC4-6F175D3DCCD1}">' +
      '<a14:hiddenFill xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main">' +
      '<a:solidFill><a:srgbClr val="FFE699"/></a:solidFill></a14:hiddenFill></a:ext></a:extLst>'
  ),
  NS
);

/** A group with a fill that one member takes and one member overrides. */
const GROUP = anchor(
  5,
  WPG_URI,
  2286000,
  457200,
  '<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2286000" cy="457200"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="2286000" cy="457200"/></a:xfrm>' +
    '<a:solidFill><a:srgbClr val="C00000"/></a:solidFill></wpg:grpSpPr>' +
    wsp(
      `${EXT(914400, 457200)}${RECT}<a:grpFill/><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>`,
      '',
      11
    ) +
    wsp(
      `<a:xfrm><a:off x="1371600" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>${RECT}` +
        '<a:solidFill><a:srgbClr val="00B050"/></a:solidFill>',
      '',
      12
    ) +
    '</wpg:wgp>',
  NS
);

/** A straight line: an outline and no fill. */
const LINE = anchor(
  6,
  WPS_URI,
  1828800,
  0,
  wsp(
    `${EXT(1828800, 0)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom>` +
      '<a:ln w="19050"><a:solidFill><a:srgbClr val="2F528F"/></a:solidFill><a:miter lim="800000"/></a:ln>'
  ),
  NS
);

export const SHAPE_FORMAT_BODY = [
  para('Opening paragraph before the shapes.'),
  para('Alternate content shape anchor with words.', ALTERNATE),
  para('Theme colored shape anchor paragraph.', THEMED),
  para('Text box anchor paragraph here.', STYLED_BOX),
  para('Hidden fill shape anchor text.', HIDDEN),
  para('Group anchor paragraph with members.', GROUP),
  para('Line anchor paragraph at the end.', LINE),
  para('Closing paragraph after the shapes.'),
].join('');

/** Fill and outline edits, with typing, splits, joins and deletes around their anchors. */
export const SHAPE_FORMAT_WEIGHTS: Partial<Record<EditKind, number>> = {
  shapeFill: 20,
  shapeOutline: 16,
  type: 18,
  delete: 8,
  split: 4,
  join: 4,
  format: 3,
  paragraphFormat: 1,
  deleteParagraph: 2,
  deleteImage: 2,
  resizeImage: 1,
  moveImage: 1,
  wrapImage: 0,
  tab: 0,
  break: 0,
  insertRow: 0,
  deleteRow: 0,
  list: 0,
  listLevel: 0,
  link: 0,
  unlink: 0,
  insertTable: 0,
  insertColumn: 0,
  deleteColumn: 0,
  cellFill: 0,
  pageBreak: 0,
  control: 0,
  footnote: 0,
  comment: 1,
};
