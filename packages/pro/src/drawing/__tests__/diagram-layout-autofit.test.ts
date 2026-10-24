/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Text autofit in the SmartArt layout engine, against drawings Office saved for synthetic
// probes: how values in different units refer to each other, the default margins and child
// text size, how a size rule grows a box, and how a font rule shrinks text until both the
// text and the layout fit.

import { describe, expect, test } from 'bun:test';
import { readDiagramModel } from '../diagram-layout-model.ts';
import { solveDiagramLayout } from '../diagram-layout-solve.ts';
import { synthesizeDiagramDrawing } from '../diagram-layout-synthesis.ts';
import { buildDiagramLayoutTree } from '../diagram-layout-tree.ts';
import { isElement } from '../../../../core/src/store/package/drawing-projection-walk.ts';
import { readOoxmlPart, type OoxmlElement } from '../../../../core/src/store/package/ooxml-tree.ts';
import { drawingShapes, loadLayoutFixtures } from './smartart-layout-harness.ts';

const fixtures = loadLayoutFixtures(
  new URL('./fixtures/smartart-layout-cases.json.gz', import.meta.url).pathname
);

function parse(xml: string): OoxmlElement {
  const read = readOoxmlPart(xml, { name: '/part.xml', contentType: 'application/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part.root;
}

function lay(id: string) {
  const item = fixtures.cases.find((entry) => entry.id === id);
  if (!item) throw new Error(`no fixture case ${id}`);
  const source = (key: 'data' | 'layout' | 'style' | 'colors') =>
    parse(fixtures.parts[item.parts[key]]!);
  const drawing = synthesizeDiagramDrawing(
    {
      dataModel: source('data'),
      layoutDef: source('layout'),
      styleDef: source('style'),
      colorsDef: source('colors'),
    },
    { cx: item.frame[0], cy: item.frame[1] },
    { fontFamily: item.fonts[0] }
  );
  if (!drawing) throw new Error(`case ${id} did not lay out`);
  return { item, drawing, shapes: drawingShapes(drawing) };
}

/** The saved shapes of a case named `presName`, in drawing order. */
function saved(id: string, presName: string) {
  const item = fixtures.cases.find((entry) => entry.id === id)!;
  return item.shapes.filter((shape) => shape.presName === presName);
}

/** `bodyPr` insets of each `dsp:sp` in drawing order, in EMU: left, top, right, bottom. */
function insets(drawing: OoxmlElement): (number[] | null)[] {
  const out: (number[] | null)[] = [];
  const visit = (element: OoxmlElement) => {
    if (element.localName === 'sp') {
      let found: number[] | null = null;
      const find = (node: OoxmlElement) => {
        if (node.localName === 'bodyPr') {
          found = ['lIns', 'tIns', 'rIns', 'bIns'].map((name) =>
            Number(node.attributes.find((attribute) => attribute.localName === name)?.value)
          );
          return;
        }
        for (const child of node.children) if (isElement(child)) find(child);
      };
      find(element);
      out.push(found);
      return;
    }
    for (const child of element.children) if (isElement(child)) visit(child);
  };
  visit(drawing);
  return out;
}

const EMU_PER_POINT = 12_700;
const near = (value: number, want: number, tolerance = 0.005) =>
  expect(Math.abs(value - want)).toBeLessThanOrEqual(Math.abs(want) * tolerance + 1);

describe('SmartArt units', () => {
  test('a font size that sizes geometry counts in millimetres', () => {
    // `h = 0.52 primFontSz` with custom 40 pt text: the solved size stays 65, so the box
    // is 0.52 × 65 mm high, not 0.52 × 65 pt.
    const { shapes } = lay('probe-v3-s40-1-1');
    near(shapes[0]!.xfrm!.cy, 0.52 * 65 * 36_000);
  });

  test('a width that sizes a text margin counts in points', () => {
    // `lMarg = 0.09 w`: a 432 pt (152.4 mm) wide box gives a 13.72 pt margin.
    const { drawing, shapes } = lay('probe-v2-d-twokids-1');
    const child = shapes.findIndex((shape) => shape.xfrm && shape.prst === 'rect');
    near(insets(drawing)[child]![0]!, 0.09 * 152.4 * EMU_PER_POINT);
  });

  test('a constant text margin counts in points', () => {
    // `lMarg val="1"` on a connector label is one point.
    const item = fixtures.cases.find((entry) => entry.id === 'mixed1-short-4-hierarchy2')!;
    const model = readDiagramModel(parse(fixtures.parts[item.parts.data]!))!;
    const tree = buildDiagramLayoutTree(model, parse(fixtures.parts[item.parts.layout]!))!;
    const solution = solveDiagramLayout(tree, { cx: item.frame[0], cy: item.frame[1] })!;
    const label = solution.states.find((state) => state.node.name === 'connTx')!;
    expect(label.values.get('lMarg')).toBe(EMU_PER_POINT);
    expect(label.values.get('rMarg')).toBe(EMU_PER_POINT);
  });
});

describe('SmartArt text defaults', () => {
  test('a margin no constraint sets is 0.56 of the primary size', () => {
    const { drawing, shapes } = lay('probe-v2-d-twokids-1');
    const child = shapes.findIndex((shape) => shape.prst === 'rect');
    // The child text is 18 pt, its node's primary size 23 pt.
    expect(insets(drawing)[child]![2]).toBe(Math.round(0.56 * 23 * EMU_PER_POINT));
  });

  test('child text without a secondary size is 78% of the primary size', () => {
    const { shapes } = lay('probe-v2-d-twokids-1');
    expect(shapes.map((shape) => shape.fontSizes[0])).toEqual([2300, 1800, 2300, 1800]);
  });
});

describe('SmartArt size rules', () => {
  test.each([
    // Custom 40 pt text in two paragraphs needs between 1.4375 and 1.5 times the box.
    ['probe-v3-s40-2-1', 1.5],
    ['probe-v3-s40-3-1', 2.25],
    ['probe-v3-s30-2-1', 1.125],
  ])('an unbounded height doubles until the text fits, then halves five times (%s)', (id, k) => {
    const { shapes } = lay(id);
    near(shapes[0]!.xfrm!.cy, k * 0.52 * 65 * 36_000);
    near(shapes[0]!.xfrm!.cy, saved(id, 'parentText')[0]!.xfrm!.cy);
  });
});

describe('SmartArt font rules', () => {
  test('text shrinks until the stacked list fits its frame', () => {
    // Boxes sized in font units: 65 pt overflows the frame, 24 pt is the largest that fits.
    const { shapes } = lay('list1-short-1-list1');
    const sizes = shapes.filter((shape) => shape.fontSizes.length > 0);
    expect(sizes.map((shape) => shape.fontSizes[0])).toEqual([2400, 2400, 2400]);
  });

  test('every node a rule names shrinks together', () => {
    const { shapes } = lay('list1-long-1-list1');
    const sizes = shapes.filter((shape) => shape.fontSizes.length > 0);
    expect(new Set(sizes.map((shape) => shape.fontSizes[0]))).toEqual(new Set([1200]));
  });

  test('text that cannot fit its font-sized box at any size keeps the size the layout fits', () => {
    const { shapes } = lay('list1-twoparas-1-list1');
    const sizes = shapes.filter((shape) => shape.fontSizes.length > 0);
    expect(sizes.map((shape) => shape.fontSizes[0])).toEqual([2400, 2400, 2400]);
  });

  test('an unbounded height after the font rule grows the box for each size tried', () => {
    // One node: 65 pt fits once the box grows. Two nodes: 37 pt is the largest whose grown
    // boxes still fit the frame.
    expect(lay('probe-v2-a-one-1').shapes[0]!.fontSizes).toEqual([6500]);
    const two = lay('probe-v2-c-two-1').shapes;
    expect(two.map((shape) => shape.fontSizes[0])).toEqual([3700, 3700]);
    near(two[0]!.xfrm!.cy, saved('probe-v2-c-two-1', 'parentText')[0]!.xfrm!.cy);
  });

  test('a line overflow the font cannot clear leaves the size to the text', () => {
    // Process steps take the whole width and the line scales them down at any size.
    const { shapes } = lay('process-short-1-process1');
    const steps = shapes.filter((shape) => shape.prst === 'roundRect');
    expect(steps.map((shape) => shape.fontSizes[0])).toEqual([2100, 2100, 2100]);
    near(steps[0]!.xfrm!.cy, saved('process-short-1-process1', 'node')[0]!.xfrm!.cy, 0.01);
  });

  test('custom text keeps its size without dragging its group down', () => {
    const { shapes } = lay('mixed1-twoparas-4-hierarchy2');
    const sizes = shapes.filter((shape) => shape.fontSizes.length > 0).map((s) => s.fontSizes[0]);
    // Four nodes autofit to 10 pt; the two custom ones keep 18 and 14 pt.
    expect(sizes).toEqual([1000, 1000, 1000, 1000, 1800, 1400]);
  });

  test('custom text on a child point keeps the node it shows in', () => {
    const { shapes } = lay('mixed-twoparas-3-vList5');
    const descendant = saved('mixed-twoparas-3-vList5', 'descendantText');
    const made = shapes.filter((shape) =>
      descendant.some((entry) => entry.modelId === shape.modelId)
    );
    expect(made[0]!.fontSizes[0]).toBe(1600);
  });

  test('a box holding text of fixed sizes still grows for it', () => {
    // Every run sets its size: no font rule applies, but the height rule grows the box.
    const { shapes } = lay('probe-v3-kid20-3-1');
    near(shapes[1]!.xfrm!.cy, saved('probe-v3-kid20-3-1', 'childText')[0]!.xfrm!.cy);
  });
});
