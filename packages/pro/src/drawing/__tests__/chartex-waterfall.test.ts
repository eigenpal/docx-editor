/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Waterfall charts, with the rules measured against reference renderings: running totals
// reset at each subtotal, data colours 0/1/2 for increase/decrease/total, columns one and a
// half gap widths apart, connector lines between column ends, labels against the end each
// column grows to, and the automatic frame (title, legend row, plot top).

import { describe, expect, test } from 'bun:test';
import {
  projectDrawingsInPackage,
  type DrawingProjection,
} from '../../../../core/src/store/package/drawing-projection.ts';
import type { OoxmlElement, OoxmlNode } from '../../../../core/src/store/package/ooxml-tree.ts';
import {
  chartexPackage,
  waterfallChartSpace,
  type ChartexDocxOptions,
  type WaterfallOptions,
} from '../../../../core/src/store/__tests__/chartex-fixture.ts';
import { waterfallSteps } from '../chartex-waterfall.ts';
import { installDrawing } from '../index.ts';

installDrawing();

const EMU = 12_700;

function project(options: WaterfallOptions = {}, docx: ChartexDocxOptions = {}): DrawingProjection {
  const projections = projectDrawingsInPackage(
    chartexPackage(waterfallChartSpace(options), { alternateContent: true, ...docx })
  );
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
    top: box.frameEmu.y / EMU,
    bottom: (box.frameEmu.y + box.frameEmu.cy) / EMU,
  }));
}

interface Bar {
  readonly hex: string;
  readonly l: number;
  readonly t: number;
  readonly r: number;
  readonly b: number;
}

/** Filled rectangles taller or wider than a legend key, left to right. */
function bars(projection: DrawingProjection): Bar[] {
  const out: Bar[] = [];
  for (const component of projection.vectorShape?.components ?? []) {
    if (!component.fillHex || component.fillHex === 'FFFFFF') continue;
    const path = component.subpathsEmu[0]!;
    const xs = path.map((point) => point.x / EMU);
    const ys = path.map((point) => point.y / EMU);
    const bar = {
      hex: component.fillHex,
      l: Math.min(...xs),
      t: Math.min(...ys),
      r: Math.max(...xs),
      b: Math.max(...ys),
    };
    if (bar.r - bar.l > 10) out.push(bar);
  }
  return out.sort((a, b) => a.l - b.l);
}

/** Stroked open paths in `hex`, as their subpaths. */
function strokes(projection: DrawingProjection, hex: string) {
  return (projection.vectorShape?.components ?? [])
    .filter((component) => component.strokeHex === hex && !component.fillHex)
    .map((component) =>
      component.subpathsEmu.map((path) =>
        path.map((point) => ({ x: point.x / EMU, y: point.y / EMU }))
      )
    );
}

describe('running totals', () => {
  test('a subtotal is drawn from zero and restarts the total', () => {
    expect(waterfallSteps([100, 40, -30, 60, 25], new Set([0, 3]))).toEqual([
      { index: 0, kind: 'total', value: 100, from: 0, to: 100 },
      { index: 1, kind: 'increase', value: 40, from: 100, to: 140 },
      { index: 2, kind: 'decrease', value: -30, from: 140, to: 110 },
      { index: 3, kind: 'total', value: 60, from: 0, to: 60 },
      { index: 4, kind: 'increase', value: 25, from: 60, to: 85 },
    ]);
  });

  test('a point without a value draws nothing and keeps the total', () => {
    const steps = waterfallSteps([10, null, 5], new Set());
    expect(steps[1]).toBeNull();
    expect(steps[2]).toEqual({ index: 2, kind: 'increase', value: 5, from: 10, to: 15 });
  });
});

describe('columns', () => {
  const projection = project({ values: [100, 40, -30, 110], subtotals: [0, 3] });
  const columns = bars(projection);

  test('every point paints, coloured by kind from the data colours', () => {
    expect(projection.vectorShape).not.toBeNull();
    // A drawn chart keeps its summary too.
    expect(projection.chartSummary?.plotTypes).toEqual(['waterfall']);
    expect(columns.map((bar) => bar.hex)).toEqual(['A5A5A5', '4472C4', 'ED7D31', 'A5A5A5']);
  });

  test('columns float from the running total before them to the one after', () => {
    const [start, up, down, end] = columns as [Bar, Bar, Bar, Bar];
    const perUnit = (start.b - start.t) / 100;
    const y = (value: number) => start.b - value * perUnit;
    expect(up.b).toBeCloseTo(y(100), 1);
    expect(up.t).toBeCloseTo(y(140), 1);
    expect(down.t).toBeCloseTo(y(140), 1);
    expect(down.b).toBeCloseTo(y(110), 1);
    expect(end.t).toBeCloseTo(y(110), 1);
    expect(end.b).toBeCloseTo(y(0), 1);
  });

  test('a column is the slot over one and a half: a gap of half a column', () => {
    const slot = (columns[1]!.l + columns[1]!.r) / 2 - (columns[0]!.l + columns[0]!.r) / 2;
    expect(columns[0]!.r - columns[0]!.l).toBeCloseTo(slot / 1.5, 2);
  });

  test('connector lines join each column end to the next column', () => {
    const [connectors] = strokes(projection, 'D9D9D9').filter((paths) => paths.length === 3);
    expect(connectors).toBeDefined();
    for (const [index, segment] of connectors!.entries()) {
      expect(segment[0]!.x).toBeCloseTo(columns[index]!.r, 1);
      expect(segment[1]!.x).toBeCloseTo(columns[index + 1]!.l, 1);
    }
    expect(connectors![0]![0]!.y).toBeCloseTo(columns[0]!.t, 1);
    expect(connectors![1]![0]!.y).toBeCloseTo(columns[1]!.t, 1);
    expect(connectors![2]![0]!.y).toBeCloseTo(columns[2]!.b, 1);
  });

  test('connector lines off leave the columns unjoined', () => {
    const plain = project({ connectorLines: false });
    expect(strokes(plain, 'D9D9D9').some((paths) => paths.length === 3)).toBe(false);
  });
});

describe('labels and frame', () => {
  test('a label sits against the end its column grows to', () => {
    const projection = project({ values: [100, 40, -30, 110], subtotals: [0, 3] });
    const columns = bars(projection);
    const texts = labels(projection);
    const up = texts.find((label) => label.text === '40')!;
    const down = texts.find((label) => label.text === '-30')!;
    expect(up.bottom).toBeCloseTo(columns[1]!.t, 1);
    expect(down.top).toBeCloseTo(columns[2]!.b, 1);
    expect(up.x).toBeCloseTo((columns[1]!.l + columns[1]!.r) / 2, 1);
  });

  test('labels off show no data labels; formats come from the data', () => {
    const plain = labels(project({ labels: false })).map((label) => label.text);
    expect(plain).not.toContain('-30');
    const percent = labels(
      project({ values: [0.5, 0.25, 0.75], formatCode: '0.0%', subtotals: [] })
    );
    expect(percent.map((label) => label.text)).toContain('25.0%');
  });

  test('an empty title element shows the default caption, and the legend lists the kinds', () => {
    const projection = project();
    const texts = labels(projection);
    expect(texts[0]!.text).toBe('Chart Title');
    const legend = ['Increase', 'Decrease', 'Total'].map(
      (name) => texts.find((label) => label.text === name)!
    );
    expect(new Set(legend.map((label) => label.y.toFixed(2))).size).toBe(1);
    expect(legend[0]!.x).toBeLessThan(legend[1]!.x);
  });

  test('the plot starts below the title and the legend row', () => {
    // 5.5 margin, a 14 pt title line, 3.84 gap, a 9 pt legend box, 3.84 gap, 5.41 room.
    const top = 5.5 + 14 * 1.22 + 3.84 + (9 * 1.22 + 14) + 3.84 + 5.41;
    const [grid] = strokes(project(), 'D9D9D9').filter((paths) => paths.length > 3);
    const ys = grid!.map((path) => path[0]!.y);
    expect(Math.min(...ys)).toBeCloseTo(top, 1);
    const [bare] = strokes(project({ title: null, legend: null }), 'D9D9D9').filter(
      (paths) => paths.length > 3
    );
    expect(Math.min(...bare!.map((path) => path[0]!.y))).toBeCloseTo(5.5 + 5.41, 1);
  });

  test('without style parts the default look applies', () => {
    const styled = bars(project());
    const bare = bars(project({}, { noStyleParts: true }));
    expect(bare.map((bar) => bar.hex)).toEqual(styled.map((bar) => bar.hex));
  });

  test('a long category set turns its labels and cuts them with an ellipsis', () => {
    const projection = project({
      categories: ['Opening balance carried forward', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
      values: [5, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    });
    // The label box reaches a third of the box under the title and legend (about 64 pt).
    const turned = (projection.groupTextboxes ?? []).filter(
      (box) => Math.abs(box.rotationDegrees - 300) < 1e-6
    );
    expect(turned.length).toBe(10);
    expect(textOf(turned[0]!.story.content)).toBe('Opening…');
  });
});

describe('point and series shape properties', () => {
  const FILL = (hex: string) => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
  const LINE = (hex: string) => `<a:ln w="28575">${FILL(hex)}</a:ln>`;

  test('a point paints its column with its own shape properties', () => {
    const projection = project({
      seriesExtra:
        `<cx:dataPt idx="1"><cx:spPr>${FILL('70AD47')}</cx:spPr></cx:dataPt>` +
        `<cx:dataPt idx="2"><cx:spPr>${FILL('7030A0')}${LINE('000000')}</cx:spPr></cx:dataPt>`,
    });
    expect(bars(projection).map((bar) => bar.hex)).toEqual([
      'A5A5A5',
      '70AD47',
      '7030A0',
      'A5A5A5',
    ]);
    const outlined = (projection.vectorShape?.components ?? []).filter(
      (component) => component.fillHex === '7030A0'
    );
    expect(outlined[0]!.strokeHex).toBe('000000');
  });

  test('the series outline reaches every column, its connector lines and its legend keys', () => {
    const projection = project({
      seriesExtra:
        `<cx:spPr>${LINE('C00000')}</cx:spPr>` +
        `<cx:dataPt idx="1"><cx:spPr>${FILL('FFC000')}</cx:spPr></cx:dataPt>`,
    });
    const components = projection.vectorShape?.components ?? [];
    const columns = bars(projection);
    expect(columns.map((bar) => bar.hex)).toEqual(['A5A5A5', 'FFC000', 'ED7D31', 'A5A5A5']);
    // The point names only a fill: it keeps the series outline.
    for (const hex of ['A5A5A5', 'FFC000', 'ED7D31', '4472C4']) {
      const filled = components.filter((component) => component.fillHex === hex);
      expect(filled.length).toBeGreaterThan(0);
      for (const component of filled) expect(component.strokeHex).toBe('C00000');
    }
    expect(strokes(projection, 'C00000').some((paths) => paths.length === 3)).toBe(true);
  });
});
