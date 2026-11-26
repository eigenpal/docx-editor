// Automatic text in a text box takes its colour from the box's fill: white on a dark fill,
// black on a light one (17.3.2.6 color, CT_Color; the fill is 20.1.8.54 solidFill).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/index.ts';
import type { InlineDrawingLayoutContext } from '../../layout/drawing-layout.ts';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';

function textboxXml(fill: string, story: string): string {
  return (
    `<w:document ${NS}><w:body><w:p><w:r><w:drawing>` +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" ' +
    'behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="5486400" cy="406400"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="Text Box 1"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>' +
    '<a:ext cx="5486400" cy="406400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr>` +
    `<wps:txbx><w:txbxContent>${story}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></wps:bodyPr></wps:wsp>' +
    '</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

function paintedRuns(fill: string, story: string): HTMLElement[] {
  return paintedTextboxRuns(textboxXml(fill, story));
}

function paintedTextboxRuns(documentXml: string): HTMLElement[] {
  const loaded = readOoxmlPart(documentXml, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.part;
  const atoms = indexInlineDrawingProjectionsInPart(part);
  const drawingLayout: InlineDrawingLayoutContext = {
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
  const layout = layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    producer: 'test',
    inlineDrawingLayout: drawingLayout,
  });
  const container = document.createElement('div');
  document.body.append(container);
  paintSemanticLayout(container, layout, { scale: 1 });
  const content = container.querySelector<HTMLElement>('.docx-drawing-textbox-content');
  expect(content).not.toBeNull();
  const runs = [...content!.querySelectorAll<HTMLElement>('span')].filter(
    (span) => span.textContent && span.children.length === 0
  );
  expect(runs.length).toBeGreaterThan(0);
  return runs;
}

// The colour a run inherits: its own inline colour, or the nearest ancestor's.
function colorOf(element: HTMLElement): string {
  for (let at: HTMLElement | null = element; at; at = at.parentElement) {
    if (at.style.color) return at.style.color.toLowerCase();
  }
  return 'inherited black';
}
const WHITE = ['#ffffff', 'rgb(255, 255, 255)'];
const BLACK = ['#000000', 'rgb(0, 0, 0)', 'inherited black'];

test('automatic text on a dark text box fill paints white', () => {
  const [run] = paintedRuns(
    '990033',
    '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Heading</w:t></w:r></w:p>'
  );
  expect(WHITE).toContain(colorOf(run!));
});

test('automatic text on a light text box fill stays black', () => {
  const [run] = paintedRuns('FFFFFF', '<w:p><w:r><w:t>Heading</w:t></w:r></w:p>');
  expect(BLACK).toContain(colorOf(run!));
});

test('a run with its own colour keeps it on a dark fill', () => {
  const [run] = paintedRuns(
    '990033',
    '<w:p><w:r><w:rPr><w:color w:val="FFFF00"/></w:rPr><w:t>Heading</w:t></w:r></w:p>'
  );
  expect(['#ffff00', 'rgb(255, 255, 0)']).toContain(colorOf(run!));
});

test('light paragraph shading inside a dark box turns automatic text black again', () => {
  const [run] = paintedRuns(
    '990033',
    '<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="FFFF99"/></w:pPr>' +
      '<w:r><w:t>Heading</w:t></w:r></w:p>'
  );
  expect(BLACK).toContain(colorOf(run!));
});

function cellStory(cellFill: string, run: string): string {
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>' +
    `<w:tcPr><w:tcW w:w="4000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${cellFill}"/></w:tcPr>` +
    `<w:p>${run}</w:p></w:tc></w:tr></w:tbl><w:p/>`
  );
}

test('a light-shaded cell inside a dark box paints automatic text black', () => {
  const [run] = paintedRuns('990033', cellStory('FFFFFF', '<w:r><w:t>Answer</w:t></w:r>'));
  expect(BLACK).toContain(colorOf(run!));
});

test('a dark-shaded cell inside a light box paints automatic text white', () => {
  const [run] = paintedRuns('FFFFFF', cellStory('990033', '<w:r><w:t>Answer</w:t></w:r>'));
  expect(WHITE).toContain(colorOf(run!));
});

test('a run with its own colour keeps it in a light cell inside a dark box', () => {
  const [run] = paintedRuns(
    '990033',
    cellStory('FFFFFF', '<w:r><w:rPr><w:color w:val="FFFF00"/></w:rPr><w:t>Answer</w:t></w:r>')
  );
  expect(['#ffff00', 'rgb(255, 255, 0)']).toContain(colorOf(run!));
});

// An inline text box in a dark-shaded body cell.
function inlineBoxInDarkCellXml(boxFill: string): string {
  return (
    `<w:document ${NS}><w:body>` +
    '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>' +
    '<w:tcPr><w:tcW w:w="6000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="990033"/></w:tcPr>' +
    '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="2743200" cy="406400"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:docPr id="1" name="Text Box 1"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>' +
    '<a:ext cx="2743200" cy="406400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    `${boxFill}<a:ln><a:noFill/></a:ln></wps:spPr>` +
    '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Answer</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
    '<wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></wps:bodyPr></wps:wsp>' +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>' +
    '</w:tc></w:tr></w:tbl><w:p/></w:body></w:document>'
  );
}

test('a white text box inside a dark-shaded cell paints automatic text black', () => {
  const [run] = paintedTextboxRuns(
    inlineBoxInDarkCellXml('<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>')
  );
  expect(BLACK.filter((color) => color !== 'inherited black')).toContain(colorOf(run!));
});

// Automatic text in an unfilled box paints black even over a dark cell: the box's text
// follows the box, not the shading around it.
test('an unfilled text box inside a dark-shaded cell paints automatic text black', () => {
  const [run] = paintedTextboxRuns(inlineBoxInDarkCellXml('<a:noFill/>'));
  expect(BLACK.filter((color) => color !== 'inherited black')).toContain(colorOf(run!));
});

// An inline group with one text box member, in a dark-shaded body cell or in the body.
function groupXml(memberFill: string, inDarkCell: boolean): string {
  const group =
    '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="2743200" cy="406400"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:docPr id="1" name="Group 1"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">' +
    '<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/>' +
    '<a:ext cx="2743200" cy="406400"/><a:chOff x="0" y="0"/><a:chExt cx="2743200" cy="406400"/>' +
    '</a:xfrm></wpg:grpSpPr>' +
    '<wps:wsp><wps:cNvPr id="2" name="Member"/><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm>' +
    '<a:off x="0" y="0"/><a:ext cx="2743200" cy="406400"/></a:xfrm>' +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${memberFill}<a:ln><a:noFill/></a:ln></wps:spPr>` +
    '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Answer</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
    '<wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></wps:bodyPr></wps:wsp>' +
    '</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  const body = inDarkCell
    ? '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>' +
      '<w:tcPr><w:tcW w:w="6000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="990033"/></w:tcPr>' +
      `${group}</w:tc></w:tr></w:tbl><w:p/>`
    : group;
  const ns = `${NS} xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"`;
  return `<w:document ${ns}><w:body>${body}</w:body></w:document>`;
}

test('automatic text in a group member with a dark fill paints white', () => {
  const [run] = paintedTextboxRuns(
    groupXml('<a:solidFill><a:srgbClr val="990033"/></a:solidFill>', false)
  );
  expect(WHITE).toContain(colorOf(run!));
});

test('a white group member inside a dark-shaded cell paints automatic text black', () => {
  const [run] = paintedTextboxRuns(
    groupXml('<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>', true)
  );
  expect(BLACK.filter((color) => color !== 'inherited black')).toContain(colorOf(run!));
});

test('an unfilled group member inside a dark-shaded cell paints automatic text black', () => {
  const [run] = paintedTextboxRuns(groupXml('<a:noFill/>', true));
  expect(BLACK.filter((color) => color !== 'inherited black')).toContain(colorOf(run!));
});

test('automatic text on a dark gradient text box fill paints white', () => {
  const gradient =
    '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"/></a:gs>' +
    '<a:gs pos="100000"><a:srgbClr val="202060"/></a:gs></a:gsLst><a:lin ang="0" scaled="0"/></a:gradFill>';
  const xml = textboxXml('FFFFFF', '<w:p><w:r><w:t>Heading</w:t></w:r></w:p>').replace(
    '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>',
    gradient
  );
  const [run] = paintedTextboxRuns(xml);
  expect(WHITE).toContain(colorOf(run!));
});
