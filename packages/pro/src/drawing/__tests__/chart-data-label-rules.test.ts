/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Data label rules shared by every chart type: a point label's own text, the wrap at a fifth
// of the chart's width, and labels moved by hand; and the 3-D pie's automatic plot area.

import { expect, test } from 'bun:test';
import {
  projectDrawingsInPackage,
  type DrawingProjection,
} from '../../../../core/src/store/package/drawing-projection.ts';
import type { OoxmlElement, OoxmlNode } from '../../../../core/src/store/package/ooxml-tree.ts';
import {
  chartPackage,
  chartSpace,
  numCache,
  strCache,
} from '../../../../core/src/store/__tests__/chart-fixture.ts';
import { installDrawing } from '../index.ts';

installDrawing();

const EMU = 12_700;
/** The fixture chart's size in points. */
const WIDTH = 432;
const HEIGHT = 252;

interface PointLabel {
  readonly text?: string;
  readonly move?: { readonly x: number; readonly y: number };
}

function pointLabel(index: number, label: PointLabel): string {
  const layout = label.move
    ? `<c:layout><c:manualLayout><c:x val="${label.move.x}"/><c:y val="${label.move.y}"/>` +
      '</c:manualLayout></c:layout>'
    : '';
  const tx = label.text
    ? `<c:tx><c:rich><a:bodyPr/><a:lstStyle/>${label.text
        .split('\n')
        .map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`)
        .join('')}</c:rich></c:tx>`
    : '';
  return (
    `<c:dLbl><c:idx val="${index}"/>${layout}${tx}<c:dLblPos val="outEnd"/>` +
    '<c:showVal val="1"/><c:showCatName val="1"/></c:dLbl>'
  );
}

function pie(
  values: readonly number[],
  names: readonly string[],
  points: Readonly<Record<number, PointLabel>> = {},
  threeD = false
): DrawingProjection {
  const own = Object.entries(points)
    .map(([index, label]) => pointLabel(Number(index), label))
    .join('');
  const labels =
    `<c:dLbls>${own}<c:txPr><a:bodyPr wrap="square" lIns="38100" rIns="38100"/><a:lstStyle/>` +
    '<a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>' +
    '<c:dLblPos val="outEnd"/><c:showVal val="1"/><c:showCatName val="1"/></c:dLbls>';
  const kind = threeD ? 'pie3DChart' : 'pieChart';
  const plot =
    `<c:${kind}><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>` +
    `<c:tx>${strCache(['Share'])}</c:tx>${labels}<c:cat>${strCache([...names])}</c:cat>` +
    `<c:val>${numCache(values)}</c:val></c:ser></c:${kind}>`;
  const space = chartSpace(plot).replace(
    '<c:chart>',
    threeD
      ? '<c:chart><c:view3D><c:rotX val="30"/><c:perspective val="30"/></c:view3D>'
      : '<c:chart>'
  );
  const projections = projectDrawingsInPackage(chartPackage(space));
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  const element = node as OoxmlElement;
  const text = element.children.map(textOf).join('');
  return element.localName === 'p' ? `${text}\n` : text;
}

function labels(projection: DrawingProjection) {
  return (projection.groupTextboxes ?? []).map((box) => ({
    text: textOf(box.story.content).trim(),
    x: (box.frameEmu.x + box.frameEmu.cx / 2) / EMU,
    y: (box.frameEmu.y + box.frameEmu.cy / 2) / EMU,
    width: box.frameEmu.cx / EMU,
    height: box.frameEmu.cy / EMU,
  }));
}

test('a point label with its own text shows that text, not the generated one', () => {
  const projection = pie([80, 20], ['Alpha', 'Bravo'], { 1: { text: 'Own words\n18,2' } });
  const texts = labels(projection).map((label) => label.text);
  expect(texts).toContain('Own words\n18,2');
  expect(texts.some((text) => text.includes('Bravo'))).toBe(false);
  expect(texts.some((text) => text.includes('Alpha'))).toBe(true);
});

test('a data label wraps at a fifth of the chart width, less its side insets', () => {
  const long = 'Household work and the care of family members';
  const projection = pie([80, 20], [long, 'Bravo']);
  const label = labels(projection).find((item) => item.text.startsWith('Household'))!;
  // 3 pt insets each side: the text wraps at 432 / 5 - 6 points.
  expect(label.width).toBeLessThanOrEqual(WIDTH / 5 - 6 + 0.01);
  expect(label.height).toBeGreaterThan(3 * 9);
});

test('a label moved by hand keeps its offset, as shares of the chart size', () => {
  for (const threeD of [false, true]) {
    const still = labels(pie([80, 20], ['Alpha', 'Bravo'], { 1: { text: 'B' } }, threeD));
    const moved = labels(
      pie([80, 20], ['Alpha', 'Bravo'], { 1: { text: 'B', move: { x: 0.05, y: 0.04 } } }, threeD)
    );
    const before = still.find((label) => label.text === 'B')!;
    const after = moved.find((label) => label.text === 'B')!;
    expect(after.x - before.x).toBeCloseTo(0.05 * WIDTH, 0);
    expect(after.y - before.y).toBeCloseTo(0.04 * HEIGHT, 0);
  }
});

test('an automatic 3-D pie plot keeps a sixteenth of the chart clear and the disc a share of it', () => {
  const projection = pie([60, 40], ['Alpha', 'Bravo'], {}, true);
  const points = projection
    // The chart space's white background is not part of the disc.
    .vectorShape!.components.filter(
      (component) => component.fillHex !== null && component.fillHex !== 'FFFFFF'
    )
    .flatMap((component) => component.subpathsEmu.flat());
  const ys = points.map((point) => point.y / EMU);
  const xs = points.map((point) => point.x / EMU);
  // The chart box is 11 points in from the edge, the plot a further sixteenth of the chart.
  const plotTop = 11 + HEIGHT / 16;
  const plotHeight = HEIGHT - 22 - HEIGHT / 8;
  const plotWidth = WIDTH - 22 - WIDTH / 8;
  const discHeight = Math.max(...ys) - Math.min(...ys);
  const discWidth = Math.max(...xs) - Math.min(...xs);
  // One of the two shares binds; neither is passed.
  expect(discHeight).toBeLessThanOrEqual(0.92 * plotHeight + 0.5);
  expect(discWidth).toBeLessThanOrEqual(0.93 * plotWidth + 0.5);
  expect(Math.max(discHeight / (0.92 * plotHeight), discWidth / (0.93 * plotWidth))).toBeCloseTo(
    1,
    2
  );
  expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(plotTop + 0.47 * plotHeight, 0);
  expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(WIDTH / 2, 0);
});
