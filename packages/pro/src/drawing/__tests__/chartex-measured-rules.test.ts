/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Layout rules measured against reference renderings of probe charts: the value scale and
// when value labels are left out, the height of a top legend row, the funnel plot with
// skipped category labels, and box and whisker value labels.

import { describe, expect, test } from 'bun:test';
import {
  projectDrawingsInPackage,
  type DrawingProjection,
} from '../../../../core/src/store/package/drawing-projection.ts';
import type { OoxmlElement, OoxmlNode } from '../../../../core/src/store/package/ooxml-tree.ts';
import {
  CX,
  chartexPackage,
  waterfallChartSpace,
} from '../../../../core/src/store/__tests__/chartex-fixture.ts';
import { installDrawing } from '../index.ts';

installDrawing();

const EMU = 12_700;
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function project(xml: string, heightPt: number): DrawingProjection {
  const [projection] = projectDrawingsInPackage(
    chartexPackage(xml, { cy: Math.round(heightPt * EMU) })
  );
  return projection!;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return (node as OoxmlElement).children.map(textOf).join('');
}

function labels(projection: DrawingProjection) {
  return (projection.groupTextboxes ?? []).map((box) => ({
    text: textOf(box.story.content),
    left: box.frameEmu.x / EMU,
    y: (box.frameEmu.y + box.frameEmu.cy / 2) / EMU,
    bottom: (box.frameEmu.y + box.frameEmu.cy) / EMU,
  }));
}

/** Horizontal strokes across most of the chart: the gridlines and the category axis. */
function gridlines(projection: DrawingProjection): number[] {
  const ys = new Set<number>();
  for (const component of projection.vectorShape?.components ?? []) {
    if (component.fillHex) continue;
    for (const path of component.subpathsEmu) {
      for (let index = 1; index < path.length; index += 1) {
        const a = path[index - 1]!;
        const b = path[index]!;
        if (a.y === b.y && Math.abs(b.x - a.x) > 300 * EMU) ys.add(Math.round(a.y / EMU));
      }
    }
  }
  return [...ys].sort((a, b) => a - b);
}

const WATERFALL = waterfallChartSpace({
  categories: ['Start', 'Sales', 'Returns', 'Costs', 'Other', 'End'],
  values: [1000, 420, -130, -260, 75, 1105],
  subtotals: [0, 5],
});

describe('value axis density', () => {
  test('a short plot keeps the coarser scale with its labels', () => {
    const texts = labels(project(WATERFALL, 150)).map((label) => label.text);
    expect(texts).toContain('1500');
    expect(texts).not.toContain('1600');
  });

  test('the denser scale wins when it fits the bare plot; its close labels are left out', () => {
    const projection = project(WATERFALL, 162);
    const texts = labels(projection).map((label) => label.text);
    expect(texts).not.toContain('1600');
    expect(texts).not.toContain('1500');
    expect(gridlines(projection).length).toBeGreaterThanOrEqual(9);
  });

  test('a taller plot shows the denser scale and its labels', () => {
    const texts = labels(project(WATERFALL, 180)).map((label) => label.text);
    expect(texts).toContain('1600');
    expect(texts).toContain('200');
  });
});

function funnel(count: number): string {
  const points = (list: readonly (string | number)[]) =>
    list.map((value, index) => `<cx:pt idx="${index}">${value}</cx:pt>`).join('');
  const categories = Array.from({ length: count }, (_, index) => `Stage ${index + 1}`);
  const values = categories.map((_, index) => 10 * count - 9 * index);
  return (
    `<cx:chartSpace xmlns:cx="${CX}" xmlns:a="${A}"><cx:chartData><cx:data id="0">` +
    `<cx:strDim type="cat"><cx:lvl ptCount="${count}">${points(categories)}</cx:lvl></cx:strDim>` +
    `<cx:numDim type="val"><cx:lvl ptCount="${count}" formatCode="General">${points(values)}</cx:lvl></cx:numDim>` +
    '</cx:data></cx:chartData><cx:chart><cx:title pos="t" align="ctr" overlay="0"/><cx:plotArea>' +
    '<cx:plotAreaRegion><cx:series layoutId="funnel"><cx:dataId val="0"/></cx:series></cx:plotAreaRegion>' +
    '<cx:axis id="0"><cx:catScaling gapWidth="0.06"/><cx:tickLabels/></cx:axis></cx:plotArea>' +
    '</cx:chart></cx:chartSpace>'
  );
}

/** The funnel's category axis line: its top and bottom, in points. */
function axisLine(projection: DrawingProjection): { t: number; b: number } {
  for (const component of projection.vectorShape?.components ?? []) {
    if (component.fillHex) continue;
    for (const path of component.subpathsEmu) {
      if (path.length === 2 && path[0]!.x === path[1]!.x) {
        return { t: path[0]!.y / EMU, b: path[1]!.y / EMU };
      }
    }
  }
  throw new Error('no axis line');
}

describe('funnel plot with skipped labels', () => {
  test('labels for every category keep the full plot', () => {
    const line = axisLine(project(funnel(20), 259.2));
    expect(line.b - line.t).toBeCloseTo(225.1, 0);
  });

  test('a last category without a label ends the plot a text size higher', () => {
    const line = axisLine(project(funnel(24), 259.2));
    expect(line.b - line.t).toBeCloseTo(216.2, 0);
  });

  test('small slots move the plot down so the first label fits', () => {
    const few = axisLine(project(funnel(16), 180));
    const many = axisLine(project(funnel(60), 180));
    expect(many.t - few.t).toBeCloseTo(3.1, 0);
    expect(many.b - many.t).toBeCloseTo(few.b - few.t, 1);
  });
});

function boxWhisker(values: readonly number[], position = 'r'): string {
  const points = (list: readonly (string | number)[]) =>
    list.map((value, index) => `<cx:pt idx="${index}">${value}</cx:pt>`).join('');
  return (
    `<cx:chartSpace xmlns:cx="${CX}" xmlns:a="${A}"><cx:chartData><cx:data id="0">` +
    `<cx:strDim type="cat"><cx:lvl ptCount="${values.length}">${points(values.map(() => 'Only'))}</cx:lvl></cx:strDim>` +
    `<cx:numDim type="val"><cx:lvl ptCount="${values.length}" formatCode="General">${points(values)}</cx:lvl></cx:numDim>` +
    '</cx:data></cx:chartData><cx:chart><cx:plotArea><cx:plotAreaRegion>' +
    `<cx:series layoutId="boxWhisker"><cx:dataLabels pos="${position}">` +
    '<cx:visibility seriesName="0" categoryName="0" value="1"/></cx:dataLabels><cx:dataId val="0"/>' +
    '<cx:layoutPr><cx:visibility meanLine="0" meanMarker="1" nonoutliers="1" outliers="1"/>' +
    '<cx:statistics quartileMethod="exclusive"/></cx:layoutPr></cx:series></cx:plotAreaRegion>' +
    '<cx:axis id="0"><cx:catScaling/><cx:tickLabels/></cx:axis>' +
    '<cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis>' +
    '</cx:plotArea></cx:chart></cx:chartSpace>'
  );
}

describe('box and whisker value labels', () => {
  const SPREAD = [0, 20, 35, 50, 62, 80, 100];

  test('quartiles, whisker ends, inner points and the mean are labelled', () => {
    const texts = labels(project(boxWhisker(SPREAD), 230)).map((label) => label.text);
    // Quartiles twice (box edge and inner point), whisker ends once, the mean in full.
    for (const text of ['100', '35', '62', '49.57142857']) expect(texts).toContain(text);
    expect(texts.filter((text) => text === '80')).toHaveLength(3);
    expect(texts.filter((text) => text === '0')).toHaveLength(2);
  });

  test('a label starts right of its mark, and stays inside the plot bottom', () => {
    const projection = project(boxWhisker(SPREAD), 230);
    const all = labels(projection);
    const box = all.filter((label) => label.text === '80').map((label) => label.left);
    // The box label sits at the box's right edge, right of the point label.
    expect(Math.max(...box)).toBeGreaterThan(Math.min(...box) + 100);
    const zero = all.filter((label) => label.text === '0');
    const axisZero = zero.reduce((a, b) => (a.left < b.left ? a : b));
    const whiskerZero = zero.reduce((a, b) => (a.left < b.left ? b : a));
    expect(whiskerZero.y).toBeLessThan(axisZero.y - 2);
  });

  test('labels at another position are not drawn', () => {
    const texts = labels(project(boxWhisker(SPREAD, 't'), 230)).map((label) => label.text);
    expect(texts).not.toContain('49.57142857');
  });
});
