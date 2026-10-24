/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Chart geometry rules measured against reference renderings: horizontal value axis tick
// density, tick label placement beside a vertical axis, round legend keys of bubble charts,
// dot patterns with round caps, and the place of a trendline's equation.

import { describe, expect, test } from 'bun:test';
import {
  projectDrawingsInPackage,
  type DrawingProjection,
} from '../../../../core/src/store/package/drawing-projection.ts';
import type { OoxmlElement, OoxmlNode } from '../../../../core/src/store/package/ooxml-tree.ts';
import {
  CATEGORY_VALUE_AXES,
  chartPackage,
  chartSpace,
  numCache,
  series,
  strCache,
} from '../../../../core/src/store/__tests__/chart-fixture.ts';
import { ChartScene } from '../chart-scene.ts';
import { installDrawing } from '../index.ts';

installDrawing();

const EMU = 12_700;
const XY_AXES =
  '<c:valAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>' +
  '<c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/>' +
  '<c:tickLblPos val="nextTo"/><c:crossAx val="2"/><c:crossBetween val="midCat"/></c:valAx>' +
  '<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>' +
  '<c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/>' +
  '<c:majorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>' +
  '<c:crossBetween val="midCat"/></c:valAx>';

function project(chartXml: string): DrawingProjection {
  const projections = projectDrawingsInPackage(chartPackage(chartXml));
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return (node as OoxmlElement).children.map(textOf).join('');
}

function labels(projection: DrawingProjection) {
  return (projection.groupTextboxes ?? []).map((box) => ({
    text: textOf(box.story.content),
    x: (box.frameEmu.x + box.frameEmu.cx / 2) / EMU,
    y: (box.frameEmu.y + box.frameEmu.cy / 2) / EMU,
  }));
}

function scatter(xs: readonly number[], extra = '', kind = 'scatterChart') {
  return (
    `<c:${kind}><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>` +
    '<c:ser><c:idx val="0"/><c:order val="0"/>' +
    `<c:tx>${strCache(['Points'])}</c:tx><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${extra}` +
    `<c:xVal>${numCache(xs)}</c:xVal><c:yVal>${numCache(xs.map((_, index) => index + 1))}</c:yVal>` +
    `</c:ser><c:axId val="1"/><c:axId val="2"/></c:${kind}>` +
    XY_AXES
  );
}

describe('chart geometry', () => {
  test('a horizontal value axis takes up to ten intervals when its labels have room', () => {
    const texts = labels(project(chartSpace(scatter([10, 20, 30, 46])))).map((item) => item.text);
    // 0 to 50 in fives, not in tens.
    for (const tick of ['0', '5', '15', '25', '45', '50']) expect(texts).toContain(tick);
  });

  test('labels beside a vertical axis sit a little above their tick', () => {
    const plot =
      '<c:barChart><c:barDir val="col"/>' +
      series(0, 'Alpha', ['A', 'B'], [2, 4]) +
      '<c:axId val="1"/><c:axId val="2"/></c:barChart>' +
      CATEGORY_VALUE_AXES;
    const projection = project(chartSpace(plot));
    const grid = projection.vectorShape!.components.find(
      (component) => component.subpathsEmu.length > 2 && component.fillHex === null
    )!;
    const lines = grid.subpathsEmu.map((path) => path[0]!.y / EMU).sort((a, b) => b - a);
    const zero = labels(projection).find((item) => item.text === '0')!;
    // The bottom gridline is the zero tick; the label's centre is 0.08 of its 10-point size above.
    expect(lines[0]! - zero.y).toBeCloseTo(0.8, 2);
  });

  test('bubble charts key their legend entries with circles', () => {
    const plot =
      '<c:bubbleChart><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/>' +
      `<c:tx>${strCache(['Bubbles'])}</c:tx><c:xVal>${numCache([1, 2])}</c:xVal>` +
      `<c:yVal>${numCache([1, 2])}</c:yVal><c:bubbleSize>${numCache([1, 4])}</c:bubbleSize></c:ser>` +
      '<c:bubbleScale val="100"/><c:axId val="1"/><c:axId val="2"/></c:bubbleChart>' +
      XY_AXES;
    const projection = project(chartSpace(plot, { legend: 'b' }));
    const key = projection.vectorShape!.components.find(
      (component) =>
        component.fillHex === '4472C4' &&
        component.subpathsEmu.length === 1 &&
        Math.max(...component.subpathsEmu[0]!.map((p) => p.x)) -
          Math.min(...component.subpathsEmu[0]!.map((p) => p.x)) <
          10 * EMU
    )!;
    expect(key).toBeDefined();
    expect(key.subpathsEmu[0]!.length).toBeGreaterThan(4);
  });

  test('a dot pattern with round caps paints separate dots a width apart', () => {
    const scene = new ChartScene();
    scene.line(
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
      ],
      { hex: '4472C4', alpha: 1, widthPt: 1.5, cap: 'round', dash: [1, 1] }
    );
    const dots = scene.components[0]!.subpathsEmu;
    const starts = dots.map((path) => path[0]!.x / EMU);
    const lengths = dots.map((path) => (path[path.length - 1]!.x - path[0]!.x) / EMU);
    // Each dot is the round cap alone; dots repeat every two widths.
    expect(Math.max(...lengths)).toBeLessThan(0.05);
    expect(starts[1]! - starts[0]!).toBeCloseTo(3, 1);
    expect(dots.length).toBe(10);
  });

  test('a trendline equation is centred on the line end, just left of it', () => {
    const trend =
      '<c:trendline><c:trendlineType val="linear"/><c:dispRSqr val="0"/><c:dispEq val="1"/></c:trendline>';
    const projection = project(chartSpace(scatter([1, 2, 3, 4], trend)));
    const equation = labels(projection).find((item) => item.text.startsWith('y = '))!;
    const line = projection.vectorShape!.components.find(
      (component) => component.strokeHex === '4472C4' && component.subpathsClosed?.[0] === false
    )!;
    const points = line.subpathsEmu.flat();
    const end = points.reduce((best, point) => (point.x > best.x ? point : best));
    expect(Math.abs(equation.y - end.y / EMU)).toBeLessThan(0.5);
    expect(equation.x).toBeLessThan(end.x / EMU);
  });

  test('a dot marker is a short bar from the point to its right', () => {
    const plot =
      '<c:lineChart><c:grouping val="standard"/>' +
      series(
        0,
        'Close',
        ['A', 'B'],
        [2, 4],
        '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="dot"/><c:size val="10"/></c:marker>'
      ) +
      '<c:axId val="1"/><c:axId val="2"/></c:lineChart>' +
      CATEGORY_VALUE_AXES;
    const projection = project(chartSpace(plot));
    const marks = projection.vectorShape!.components.find(
      (component) => component.fillHex === '4472C4' && component.subpathsEmu.length === 2
    )!;
    const bar = marks.subpathsEmu[0]!.map((p) => ({ x: p.x / EMU, y: p.y / EMU }));
    const xs = bar.map((p) => p.x);
    const ys = bar.map((p) => p.y);
    expect(bar).toHaveLength(4);
    // Markers paint at 0.96 of their size: 0.55 and 0.24 of 9.6 points.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(5.28, 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2.3, 1);
  });

  test('a legend entry whose line is hidden keys narrowly, as a square key does', () => {
    const legendGap = (line: string) => {
      const plot =
        '<c:lineChart><c:grouping val="standard"/>' +
        series(0, 'High', ['A', 'B'], [2, 4], line) +
        series(1, 'Low', ['A', 'B'], [1, 3], line) +
        '<c:axId val="1"/><c:axId val="2"/></c:lineChart>' +
        CATEGORY_VALUE_AXES;
      const placed = labels(project(chartSpace(plot, { legend: 'b' })));
      return (
        placed.find((item) => item.text === 'Low')!.x -
        placed.find((item) => item.text === 'High')!.x
      );
    };
    const shown = legendGap('<c:marker><c:symbol val="none"/></c:marker>');
    const hidden = legendGap(
      '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>'
    );
    // A line key is 2.32 sizes to its text, a narrow key 0.77: 15.5 points at 10 points.
    expect(shown - hidden).toBeCloseTo(15.5, 0);
  });

  test('a 3-D view that names no angles looks square on: no tops or sides show', () => {
    const plot =
      '<c:bar3DChart><c:barDir val="col"/><c:grouping val="clustered"/>' +
      series(0, 'Alpha', ['A', 'B'], [2, 4]) +
      '<c:axId val="1"/><c:axId val="2"/><c:axId val="0"/></c:bar3DChart>' +
      CATEGORY_VALUE_AXES;
    const xml = chartSpace(plot).replace(
      '<c:plotArea>',
      '<c:view3D><c:rAngAx val="1"/></c:view3D><c:plotArea>'
    );
    const fills = project(xml).vectorShape!.components.map((component) => component.fillHex);
    expect(fills.filter((hex) => hex === '4472C4')).toHaveLength(2);
    expect(fills).not.toContain('2C497D');
    expect(fills).not.toContain('345795');
  });
});
