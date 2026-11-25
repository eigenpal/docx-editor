// The room the outline of an inline VML text box takes on its line (`v:stroke`, ECMA-376
// Part 4, 19.1.2.21). The standard does not define this room; the editor reserves it in whole
// points.

import { describe, expect, test } from 'bun:test';
import { projectDrawingsInPart } from '../package/drawing-projection.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const PT = 12_700;

function effectExtent(stroke: string, style = 'width:100pt;height:72pt') {
  const shape =
    `<w:pict><v:rect id="box" style="${style}" fillcolor="#FFF7D6" ${stroke}>` +
    '<v:textbox inset="0,0,0,0"><w:txbxContent><w:p><w:r><w:t>ab</w:t></w:r></w:p>' +
    '</w:txbxContent></v:textbox></v:rect></w:pict>';
  const loaded = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:v="${V}"><w:body><w:p><w:r>${shape}</w:r></w:p></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  const [projection] = projectDrawingsInPart(loaded.part);
  if (!projection?.textboxStory) throw new Error('no text box');
  const { left, top, right, bottom } = projection.effectExtentEmu;
  return [left, top, right, bottom].map((value) => value / PT);
}

const weight = (points: number) => `strokecolor="#1F2937" strokeweight="${points}pt"`;

describe('an inline VML text box', () => {
  test('a box without an outline takes no room past its box', () => {
    expect(effectExtent('stroked="f"')).toEqual([0, 0, 0, 0]);
  });
  test('a 1pt outline takes a point at the right and the bottom', () => {
    expect(effectExtent(weight(1))).toEqual([0, 0, 1, 1]);
    expect(effectExtent(weight(0.75))).toEqual([0, 0, 1, 1]);
  });
  test('the weight rounds to whole points, and the left and top take the smaller half', () => {
    expect(effectExtent(weight(1.5))).toEqual([1, 1, 1, 1]);
    expect(effectExtent(weight(2.25))).toEqual([1, 1, 1, 1]);
    expect(effectExtent(weight(3))).toEqual([1, 1, 2, 2]);
    expect(effectExtent(weight(4.5))).toEqual([2, 2, 3, 3]);
    expect(effectExtent(weight(6))).toEqual([3, 3, 3, 3]);
    expect(effectExtent(weight(8))).toEqual([4, 4, 4, 4]);
  });
  test('a floating box takes no room on a line', () => {
    expect(
      effectExtent(
        weight(6),
        'position:absolute;margin-left:0;margin-top:0;width:100pt;height:72pt'
      )
    ).toEqual([0, 0, 0, 0]);
  });
});
