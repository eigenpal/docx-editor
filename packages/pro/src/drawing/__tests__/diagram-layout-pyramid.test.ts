/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The pyramid algorithm (`pyra`) against drawings Office saved for synthetic pyramids: level
// sizes and slopes, accent text beside the levels, and levels a user resized and moved.

import { describe, expect, test } from 'bun:test';
import { isElement } from '../../../../core/src/store/package/drawing-projection-walk.ts';
import { readOoxmlPart, type OoxmlElement } from '../../../../core/src/store/package/ooxml-tree.ts';
import { synthesizeDiagramDrawing } from '../diagram-layout-synthesis.ts';
import { drawingShapes, loadLayoutFixtures } from './smartart-layout-harness.ts';

const fixtures = loadLayoutFixtures(
  new URL('./fixtures/smartart-layout-cases.json.gz', import.meta.url).pathname
);

function parse(xml: string): OoxmlElement {
  const read = readOoxmlPart(xml, { name: '/part.xml', contentType: 'application/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part.root;
}

function lay(id: string, edit: (layout: string) => string = (layout) => layout) {
  const item = fixtures.cases.find((entry) => entry.id === id)!;
  const source = (key: 'data' | 'layout' | 'style' | 'colors') => fixtures.parts[item.parts[key]]!;
  return synthesizeDiagramDrawing(
    {
      dataModel: parse(source('data')),
      layoutDef: parse(edit(source('layout'))),
      styleDef: parse(source('style')),
      colorsDef: parse(source('colors')),
    },
    { cx: item.frame[0], cy: item.frame[1] },
    { fontFamily: item.fonts[0] }
  );
}

/** Adjust guides of each shape's preset geometry, in drawing order. */
function guides(drawing: OoxmlElement): string[][] {
  const out: string[][] = [];
  const walk = (element: OoxmlElement) => {
    if (element.localName === 'prstGeom') {
      const list: string[] = [];
      const collect = (node: OoxmlElement) => {
        if (node.localName === 'gd') {
          const name = node.attributes.find((a) => a.localName === 'name')?.value;
          const formula = node.attributes.find((a) => a.localName === 'fmla')?.value;
          list.push(`${name} ${formula}`);
        }
        for (const child of node.children) if (isElement(child)) collect(child);
      };
      collect(element);
      out.push(list);
      return;
    }
    for (const child of element.children) if (isElement(child)) walk(child);
  };
  walk(drawing);
  return out;
}

const PT = 12_700;

describe('SmartArt pyramid', () => {
  test('levels stack in equal heights and widen by one step each', () => {
    const drawing = lay('probe-p5-pyr3-1')!;
    const boxes = drawingShapes(drawing).map((shape) => shape.xfrm!);
    expect(boxes.map((box) => [box.x, box.y, box.cx, box.cy].map((v) => v / PT))).toEqual([
      [144, 0, 144, 84],
      [72, 84, 288, 84],
      [0, 168, 432, 84],
    ]);
    // Each side slopes half a step over a level's height: 72 / 84.
    expect(guides(drawing)).toEqual([['adj val 85714'], ['adj val 85714'], ['adj val 85714']]);
  });

  test('accent text fills the row beside each level, turned half a turn', () => {
    const drawing = lay('probe-p5-pyr-acct-1')!;
    const shapes = drawingShapes(drawing);
    const saved = fixtures.cases.find((entry) => entry.id === 'probe-p5-pyr-acct-1')!.shapes;
    shapes.forEach((shape, index) => {
      const want = saved[index]!;
      expect(shape.prst).toBe(want.prst);
      expect(shape.xfrm!.rot).toBe(want.xfrm!.rot);
      for (const key of ['x', 'y', 'cx', 'cy'] as const) {
        expect(Math.abs(shape.xfrm![key] - want.xfrm![key])).toBeLessThanOrEqual(PT);
        expect(Math.abs(shape.txXfrm![key] - want.txXfrm![key])).toBeLessThanOrEqual(PT);
      }
    });
    expect(guides(drawing)[0]).toEqual(['adj1 val 0', 'adj2 val 58286']);
  });

  test('a resized and moved level keeps its slope and the stack fits the box', () => {
    // The top level is 1.6 times as tall: the stack shrinks to fit, every level as wide as
    // the slope at its foot, and the top level stays inside the box.
    const boxes = drawingShapes(lay('pyramid-short-1-pyramid1')!).map((shape) => shape.xfrm!);
    const saved = fixtures.cases.find((entry) => entry.id === 'pyramid-short-1-pyramid1')!.shapes;
    boxes.forEach((box, index) => {
      const want = saved[index]!.xfrm!;
      for (const key of ['x', 'y', 'cx', 'cy'] as const) {
        expect(Math.abs(box[key] - want[key])).toBeLessThanOrEqual(PT);
      }
    });
  });

  test('an inverted pyramid keeps its placeholder', () => {
    const inverted = (layout: string) =>
      layout.replaceAll(
        '<dgm:param type="linDir" val="fromB"/>',
        '<dgm:param type="linDir" val="fromT"/>'
      );
    expect(lay('probe-p5-pyr3-1', inverted)).toBeNull();
  });
});
