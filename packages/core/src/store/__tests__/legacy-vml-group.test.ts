// A legacy VML group of shapes, connectors and text boxes paints as vector members with
// member stories, the way a drawing canvas paints.

import { describe, expect, test } from 'bun:test';
import { projectDrawingsInPart, type DrawingProjection } from '../package/drawing-projection.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';
const EMU = 12_700;

const PICTURE_TEMPLATE =
  '<v:shapetype id="_x0000_t75" coordsize="21600,21600" filled="f" stroked="f" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path gradientshapeok="t" o:connecttype="rect" o:extrusionok="f"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>';
// The connector template as some writers save it, with an editing lock.
const LINE_TEMPLATE =
  '<v:shapetype id="_x0000_t32" coordsize="21600,21600" o:oned="t" filled="f" o:spt="32" path="m,l21600,21600e"><v:path fillok="f" arrowok="t" o:connecttype="none"/><o:lock v:ext="edit" shapetype="t"/></v:shapetype>';

function box(id: string, left: number, text: string): string {
  return `<v:roundrect id="${id}" style="width:5040;height:16200;left:${left};position:absolute;top:2700;v-text-anchor:middle" fillcolor="#dce6f2" stroked="t" strokecolor="#1f3864" strokeweight="1pt" arcsize="10923f"><v:textbox><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent></v:textbox></v:roundrect>`;
}

function arrow(left: number): string {
  return `<v:shape style="width:3240;height:0;left:${left};position:absolute;top:10800" fillcolor="this" stroked="t" strokecolor="#1f3864" strokeweight="1.5pt" type="#_x0000_t32"><v:stroke endarrow="block"/></v:shape>`;
}

function canvasGroup(members: string): string {
  return `<w:pict><v:group id="canvas" style="width:432pt;height:72pt;mso-wrap-distance-left:0;mso-wrap-distance-right:0" coordsize="21600,21600" coordorigin="0,0" editas="canvas">${PICTURE_TEMPLATE}<v:shape style="width:21600;height:21600;position:absolute" type="#_x0000_t75"><v:fill o:detectmouseclick="t"/></v:shape>${members}</v:group></w:pict>`;
}

function project(content: string): DrawingProjection[] {
  const xml = `<w:document xmlns:w="${W}" xmlns:v="${V}" xmlns:o="${O}"><w:body><w:p><w:r>${content}</w:r></w:p></w:body></w:document>`;
  const loaded = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!loaded.ok) throw new Error(loaded.reason);
  return projectDrawingsInPart(loaded.part);
}

describe('legacy VML groups as vector members', () => {
  test('a canvas group paints its shapes, connectors and text', () => {
    const [projection] = project(
      canvasGroup(`${box('a', 0, 'Start')}${LINE_TEMPLATE}${arrow(5040)}${box('b', 8280, 'End')}`)
    );
    expect(projection).toBeDefined();
    expect(projection!.legacyGraphic).toBeUndefined();
    const shape = projection!.vectorShape!;
    expect(shape.extentEmu).toEqual({ cx: 432 * EMU, cy: 72 * EMU });
    // The empty background frame paints nothing; two boxes and one connector remain.
    expect(shape.components).toHaveLength(3);
    expect(shape.components[0]).toMatchObject({ fillHex: 'DCE6F2', strokeHex: '1F3864' });
    const connector = shape.components[1]!;
    expect(connector).toMatchObject({ fillHex: null, strokeHex: '1F3864' });
    expect(connector.arrowheadsEmu).toHaveLength(1);
    // 5040 of 21600 across 432pt is 100.8pt; the connector runs to 8280 (165.6pt).
    const xs = connector.subpathsEmu[0]!.map((point) => point.x / EMU);
    expect(xs[0]).toBeCloseTo(100.8, 3);
    expect(xs[1]).toBeCloseTo(165.6, 3);
    const texts = projection!.groupTextboxes!;
    expect(texts.map((member) => member.frameEmu.x / EMU)).toEqual([0, 165.6]);
    expect(texts[0]!.story).toMatchObject({
      verticalAnchor: 'center',
      fillHex: null,
      strokeHex: null,
    });
    expect(texts[0]!.frameEmu.cy / EMU).toBeCloseTo(54, 3);
  });

  test('a group with text refuses when a member is outside the subset', () => {
    const picture = '<v:shape style="width:100;height:100" type="#_x0000_t75" filled="t"/>';
    expect(project(canvasGroup(`${box('a', 0, 'Start')}${picture}`))).toHaveLength(0);
  });

  test('a group of shapes without text keeps painting as vectors', () => {
    const [projection] = project(
      canvasGroup('<v:oval style="width:5000;height:5000;position:absolute" fillcolor="red"/>')
    );
    expect(projection!.vectorShape!.components).toHaveLength(1);
    expect(projection!.groupTextboxes).toBeUndefined();
  });
});
