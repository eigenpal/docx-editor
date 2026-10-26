/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Data label rules shared by every chart type: a point label's own text, the wrap at a fifth
// of the chart's width, and labels moved by hand; and the 3-D pie's plot area and tilt.

import { expect, test } from 'bun:test';
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
  strCache,
} from '../../../../core/src/store/__tests__/chart-fixture.ts';
import { installDrawing } from '../index.ts';

installDrawing();

const EMU = 12_700;
/** The fixture chart's size in points. */
const WIDTH = 432;
const HEIGHT = 252;

interface PointLabel {
  /** Own text, one paragraph per line. */
  readonly text?: string;
  /** Own text as raw `a:p` paragraphs, for fields. */
  readonly rich?: string;
  /** Shares of the chart size; `edge` places the left and top sides instead of moving. */
  readonly move?: { readonly x: number; readonly y: number; readonly edge?: boolean };
}

function pointLabel(index: number, label: PointLabel): string {
  const modes = label.move?.edge ? '<c:xMode val="edge"/><c:yMode val="edge"/>' : '';
  const layout = label.move
    ? `<c:layout><c:manualLayout>${modes}<c:x val="${label.move.x}"/>` +
      `<c:y val="${label.move.y}"/></c:manualLayout></c:layout>`
    : '';
  const paragraphs =
    label.rich ??
    (label.text
      ?.split('\n')
      .map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`)
      .join('') ||
      null);
  const tx = paragraphs
    ? `<c:tx><c:rich><a:bodyPr/><a:lstStyle/>${paragraphs}</c:rich></c:tx>`
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
  threeD: boolean | { readonly rotX: number; readonly perspective: number } = false,
  extra: { readonly serExt?: string; readonly widthPt?: number } = {}
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
    `<c:val>${numCache(values)}</c:val>${extra.serExt ?? ''}</c:ser></c:${kind}>`;
  const view = threeD === true ? { rotX: 30, perspective: 30 } : threeD || null;
  const space = chartSpace(plot).replace(
    '<c:chart>',
    view
      ? `<c:chart><c:view3D><c:rotX val="${view.rotX}"/><c:perspective val="${view.perspective}"/>` +
          '</c:view3D>'
      : '<c:chart>'
  );
  const size = extra.widthPt ? { cx: extra.widthPt * EMU, cy: HEIGHT * EMU } : {};
  const projections = projectDrawingsInPackage(chartPackage(space, size));
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

/** The disc's outline points in points: every coloured fill but the chart's white background. */
function discPoints(projection: DrawingProjection) {
  const points = projection
    .vectorShape!.components.filter(
      (component) => component.fillHex !== null && component.fillHex !== 'FFFFFF'
    )
    .flatMap((component) => component.subpathsEmu.flat());
  return { xs: points.map((point) => point.x / EMU), ys: points.map((point) => point.y / EMU) };
}

test('an automatic 3-D pie plot keeps a sixteenth of the chart clear and the disc a share of it', () => {
  const { xs, ys } = discPoints(pie([60, 40], ['Alpha', 'Bravo'], {}, true));
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

test('perspective lowers the tilt a 3-D pie is seen at, as measured', () => {
  // Measured height-to-width ratios of the whole disc, top face and rim.
  for (const [rotX, perspective, ratio] of [
    [10, 30, 0.265],
    [30, 0, 0.585],
    [30, 30, 0.57],
    [30, 80, 0.495],
    [50, 30, 0.81],
  ] as const) {
    const { xs, ys } = discPoints(pie([60, 40], ['Alpha', 'Bravo'], {}, { rotX, perspective }));
    const shown = (Math.max(...ys) - Math.min(...ys)) / (Math.max(...xs) - Math.min(...xs));
    expect(Math.abs(shown - ratio)).toBeLessThan(0.01);
  }
});

const C15 = 'http://schemas.microsoft.com/office/drawing/2012/chart';

test("a label's own text fills its fields from the point and keeps unknown ones", () => {
  const rich =
    '<a:p><a:r><a:t>Share </a:t></a:r><a:fld id="{1}" type="VALUE"><a:t>[VALUE]</a:t></a:fld>' +
    '<a:r><a:t> of </a:t></a:r>' +
    '<a:fld id="{2}" type="CATEGORYNAME"><a:t>[CATEGORY NAME]</a:t></a:fld>' +
    '<a:fld id="{3}" type="SOMEDAY"><a:t> (kept)</a:t></a:fld></a:p>';
  const texts = labels(pie([80, 20], ['Alpha', 'Bravo'], { 1: { rich } })).map(
    (label) => label.text
  );
  expect(texts).toContain('Share 20 of Bravo (kept)');
});

test('a cell range field shows the cached cell the label range names', () => {
  const serExt =
    `<c:extLst><c:ext uri="{02D57815-91ED-43cb-92C2-25804820EDAC}" xmlns:c15="${C15}">` +
    '<c15:datalabelsRange><c15:f>Sheet1!$C$2:$C$3</c15:f><c15:dlblRangeCache>' +
    '<c:ptCount val="2"/><c:pt idx="0"><c:v>North</c:v></c:pt><c:pt idx="1"><c:v>South</c:v></c:pt>' +
    '</c15:dlblRangeCache></c15:datalabelsRange></c:ext></c:extLst>';
  const rich = '<a:p><a:fld id="{1}" type="CELLRANGE"><a:t>[CELLRANGE]</a:t></a:fld></a:p>';
  const texts = labels(pie([80, 20], ['Alpha', 'Bravo'], { 0: { rich } }, false, { serExt })).map(
    (label) => label.text
  );
  expect(texts).toContain('North');
  expect(texts.some((text) => text.includes('[CELLRANGE]'))).toBe(false);
});

test('an edge-mode label puts its top side at the share of the chart height', () => {
  const placed = labels(
    pie([80, 20], ['Alpha', 'Bravo'], { 1: { text: 'E', move: { x: 0.1, y: 0.2, edge: true } } })
  ).find((label) => label.text === 'E')!;
  expect(placed.y - placed.height / 2).toBeCloseTo(0.2 * HEIGHT, 1);
});

test('a word wider than the wrap width keeps a frame wide enough not to break it', () => {
  // A 150 point chart wraps at 24 points; the category name alone is wider.
  const placed = labels(pie([80, 20], ['Administration', 'B'], {}, false, { widthPt: 150 })).find(
    (label) => label.text.startsWith('Administration')
  )!;
  expect(placed.width).toBeGreaterThan(50);
});

test('a bar label shows its own text and keeps its manual offset', () => {
  const bar = (move: boolean) => {
    const own = pointLabel(0, { text: 'Own', ...(move ? { move: { x: 0.05, y: -0.04 } } : {}) });
    const plot =
      '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/>' +
      `<c:order val="0"/><c:tx>${strCache(['Sales'])}</c:tx><c:dLbls>${own}` +
      '<c:showVal val="1"/></c:dLbls>' +
      `<c:cat>${strCache(['Q1', 'Q2'])}</c:cat><c:val>${numCache([5, 7])}</c:val></c:ser>` +
      `<c:axId val="1"/><c:axId val="2"/></c:barChart>${CATEGORY_VALUE_AXES}`;
    const projections = projectDrawingsInPackage(chartPackage(chartSpace(plot)));
    return labels(projections[0]!).find((label) => label.text === 'Own')!;
  };
  const still = bar(false);
  const moved = bar(true);
  expect(still).toBeDefined();
  expect(moved.x - still.x).toBeCloseTo(0.05 * WIDTH, 0);
  expect(moved.y - still.y).toBeCloseTo(-0.04 * HEIGHT, 0);
});
