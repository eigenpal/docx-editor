/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Funnel charts, with the rules measured against reference renderings: one centred bar per
// category, top to bottom, its width the share of the largest value; bars the slot over one
// plus the gap width (0.34 when unset); category labels right-aligned beside the plot, every
// n-th one when slots are short; data labels centred on their bar in the light text colour,
// shown only when they fit inside it.

import { describe, expect, test } from 'bun:test';
import {
  projectDrawingsInPackage,
  type DrawingProjection,
} from '../../../../core/src/store/package/drawing-projection.ts';
import type { OoxmlElement, OoxmlNode } from '../../../../core/src/store/package/ooxml-tree.ts';
import {
  CX,
  chartexPackage,
  type ChartexDocxOptions,
} from '../../../../core/src/store/__tests__/chartex-fixture.ts';
import {
  FUNNEL_DEFAULT_GAP_WIDTH,
  funnelBars,
  funnelGapWidth,
  funnelLabelStep,
} from '../chartex-funnel.ts';
import type { ChartexAxis } from '../chartex-model.ts';
import { installDrawing } from '../index.ts';

installDrawing();

const EMU = 12_700;
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
/** The fixture's chart: 432 by 252 points. */
const CHART_HEIGHT = 3200400 / EMU;

interface FunnelOptions {
  readonly categories?: readonly string[];
  readonly values?: readonly (number | null)[];
  /** Undefined: an empty title element; null: no title element. */
  readonly title?: string | null;
  /** The data label position; null: no data labels. */
  readonly labels?: string | null;
  /** The axis gap width attribute; null: none. */
  readonly gapWidth?: string | null;
  /** Category axis: shown, hidden, or no axis element. */
  readonly axis?: 'shown' | 'hidden' | 'none';
  readonly legend?: string | null;
  /** Extra markup at the start of the series (`cx:dataPt` overrides). */
  readonly points?: string;
  readonly labelTxPr?: string;
}

function funnelChartSpace(options: FunnelOptions = {}): string {
  const categories = options.categories ?? ['Leads', 'Qualified', 'Proposals', 'Won'];
  const values = options.values ?? [400, 300, 150, 40];
  const points = (list: readonly (string | number | null)[]) =>
    list
      .map((value, index) => (value === null ? '' : `<cx:pt idx="${index}">${value}</cx:pt>`))
      .join('');
  const title =
    options.title === null
      ? ''
      : options.title === undefined
        ? '<cx:title pos="t" align="ctr" overlay="0"/>'
        : `<cx:title pos="t" align="ctr" overlay="0"><cx:tx><cx:txData><cx:v>${options.title}</cx:v></cx:txData></cx:tx></cx:title>`;
  const labels =
    options.labels === null
      ? ''
      : `<cx:dataLabels pos="${options.labels ?? 'ctr'}">${options.labelTxPr ?? ''}` +
        '<cx:visibility seriesName="0" categoryName="0" value="1"/></cx:dataLabels>';
  const gap = options.gapWidth === null ? '' : ` gapWidth="${options.gapWidth ?? '0.06'}"`;
  const axis =
    options.axis === 'none'
      ? ''
      : `<cx:axis id="0"${options.axis === 'hidden' ? ' hidden="1"' : ''}><cx:catScaling${gap}/><cx:tickLabels/></cx:axis>`;
  const legend = options.legend
    ? `<cx:legend pos="${options.legend}" align="ctr" overlay="0"/>`
    : '';
  return (
    `<cx:chartSpace xmlns:cx="${CX}" xmlns:a="${A}"><cx:chartData><cx:data id="0">` +
    `<cx:strDim type="cat"><cx:lvl ptCount="${categories.length}">${points(categories)}</cx:lvl></cx:strDim>` +
    `<cx:numDim type="val"><cx:lvl ptCount="${values.length}" formatCode="General">${points(values)}</cx:lvl></cx:numDim>` +
    `</cx:data></cx:chartData><cx:chart>${title}<cx:plotArea><cx:plotAreaRegion>` +
    '<cx:series layoutId="funnel"><cx:tx><cx:txData><cx:v>Count</cx:v></cx:txData></cx:tx>' +
    `${options.points ?? ''}${labels}<cx:dataId val="0"/></cx:series></cx:plotAreaRegion>` +
    `${axis}</cx:plotArea>${legend}</cx:chart></cx:chartSpace>`
  );
}

function project(options: FunnelOptions = {}, docx: ChartexDocxOptions = {}): DrawingProjection {
  const projections = projectDrawingsInPackage(
    chartexPackage(funnelChartSpace(options), { alternateContent: true, ...docx })
  );
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return (node as OoxmlElement).children.map(textOf).join('');
}

/** The first `w:color` value in a story, or null. */
function colorOf(node: OoxmlNode): string | null {
  if (node.kind === 'textValue') return null;
  const element = node as OoxmlElement;
  if (element.localName === 'color') {
    return element.attributes.find((attribute) => attribute.localName === 'val')?.value ?? null;
  }
  for (const child of element.children) {
    const found = colorOf(child);
    if (found) return found;
  }
  return null;
}

/** The text size of a story's first run, in points. */
function sizeOf(node: OoxmlNode): number | null {
  if (node.kind === 'textValue') return null;
  const element = node as OoxmlElement;
  if (element.localName === 'sz') {
    const raw = element.attributes.find((attribute) => attribute.localName === 'val')?.value;
    return raw === undefined ? null : Number(raw) / 2;
  }
  for (const child of element.children) {
    const found = sizeOf(child);
    if (found !== null) return found;
  }
  return null;
}

function labels(projection: DrawingProjection) {
  return (projection.groupTextboxes ?? []).map((box) => ({
    text: textOf(box.story.content),
    color: colorOf(box.story.content),
    size: sizeOf(box.story.content),
    left: box.frameEmu.x / EMU,
    right: (box.frameEmu.x + box.frameEmu.cx) / EMU,
    x: (box.frameEmu.x + box.frameEmu.cx / 2) / EMU,
    y: (box.frameEmu.y + box.frameEmu.cy / 2) / EMU,
  }));
}

interface Bar {
  readonly hex: string;
  readonly l: number;
  readonly t: number;
  readonly r: number;
  readonly b: number;
}

/** Filled rectangles other than the chart area and legend keys, top to bottom. */
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
    if (bar.b - bar.t > 7.5 || bar.r - bar.l > 7.5) out.push(bar);
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Stroked vertical lines: the category axis. */
function verticalLines(projection: DrawingProjection) {
  return (projection.vectorShape?.components ?? [])
    .filter((component) => component.strokeHex && !component.fillHex)
    .flatMap((component) => component.subpathsEmu)
    .filter((path) => path.length === 2 && path[0]!.x === path[1]!.x)
    .map((path) => ({ x: path[0]!.x / EMU, t: path[0]!.y / EMU, b: path[1]!.y / EMU }));
}

function axis(gapWidth: number | null): ChartexAxis {
  return { gapWidth } as ChartexAxis;
}

describe('bars from values', () => {
  test('each positive value takes its share of the largest, in point order', () => {
    expect(funnelBars([50, 400, 200])).toEqual([
      { index: 0, value: 50, share: 0.125 },
      { index: 1, value: 400, share: 1 },
      { index: 2, value: 200, share: 0.5 },
    ]);
  });

  test('zero, negative, missing and non-finite values draw no bar', () => {
    expect(
      funnelBars([300, 0, -120, null, Number.NaN, Infinity, 75]).map((bar) => bar.index)
    ).toEqual([0, 6]);
    expect(funnelBars([])).toEqual([]);
    expect(funnelBars([0, -5, null])).toEqual([]);
  });

  test('the gap width defaults to 0.34 and stays within bounds', () => {
    expect(funnelGapWidth(null)).toBe(FUNNEL_DEFAULT_GAP_WIDTH);
    expect(funnelGapWidth(axis(null))).toBe(0.34);
    expect(funnelGapWidth(axis(0.06))).toBe(0.06);
    expect(funnelGapWidth(axis(-1))).toBe(0);
    expect(funnelGapWidth(axis(1e9))).toBe(5);
  });

  test('labels skip slots shorter than their pitch, never past the category count', () => {
    expect(funnelLabelStep(37.5, 10.8, 6)).toBe(1);
    expect(funnelLabelStep(7.5, 10.8, 30)).toBe(2);
    expect(funnelLabelStep(2.4, 10.8, 90)).toBe(5);
    expect(funnelLabelStep(0, 10.8, 4)).toBe(4);
    expect(funnelLabelStep(1e-12, 10.8, 3)).toBe(3);
  });
});

describe('geometry', () => {
  const projection = project();
  const columns = bars(projection);

  test('every positive value paints one bar in the series colour', () => {
    expect(projection.vectorShape).not.toBeNull();
    // A drawn chart keeps its summary too.
    expect(projection.chartSummary?.plotTypes).toEqual(['funnel']);
    expect(columns.map((bar) => bar.hex)).toEqual(['4472C4', '4472C4', '4472C4', '4472C4']);
  });

  test('bars share one centre; widths follow the values', () => {
    const centre = (bar: Bar) => (bar.l + bar.r) / 2;
    for (const bar of columns) expect(centre(bar)).toBeCloseTo(centre(columns[0]!), 2);
    const full = columns[0]!.r - columns[0]!.l;
    expect(columns[1]!.r - columns[1]!.l).toBeCloseTo((full * 300) / 400, 2);
    expect(columns[3]!.r - columns[3]!.l).toBeCloseTo((full * 40) / 400, 2);
  });

  test('a bar is its slot over one plus the gap width, centred in the slot', () => {
    const pitch = columns[1]!.t - columns[0]!.t;
    expect(columns[0]!.b - columns[0]!.t).toBeCloseTo(pitch / 1.06, 2);
    const wide = bars(project({ gapWidth: '1' }));
    const widePitch = wide[1]!.t - wide[0]!.t;
    expect(wide[0]!.b - wide[0]!.t).toBeCloseTo(widePitch / 2, 2);
    const auto = bars(project({ gapWidth: null }));
    const autoPitch = auto[1]!.t - auto[0]!.t;
    expect(auto[0]!.b - auto[0]!.t).toBeCloseTo(autoPitch / 1.34, 2);
  });

  test('the plot sits under the title and above the bottom margin; the axis runs down its left', () => {
    // 5.5 margin, a 14 pt title line, a 3.84 gap, 0.98 inset; 5.5 margin and 1.22 inset below.
    const top = 5.5 + 14 * 1.22 + 3.84 + 0.98;
    const bottom = CHART_HEIGHT - 5.5 - 1.22;
    const [line] = verticalLines(projection);
    expect(line!.t).toBeCloseTo(top, 1);
    expect(line!.b).toBeCloseTo(bottom, 1);
    expect(columns[0]!.l).toBeCloseTo(line!.x, 1);
    const pitch = (bottom - top) / 4;
    expect(columns[0]!.t).toBeCloseTo(top + (pitch - pitch / 1.06) / 2, 1);
  });

  test('the widest bar reaches the right edge of the plot', () => {
    expect(columns[0]!.r).toBeCloseTo(432 - 6.6 - 0.24, 1);
  });

  test('a point with its own fill keeps it', () => {
    const own = bars(
      project({
        points:
          '<cx:dataPt idx="2"><cx:spPr><a:solidFill><a:srgbClr val="C00000"/></a:solidFill></cx:spPr></cx:dataPt>',
      })
    );
    expect(own.map((bar) => bar.hex)).toEqual(['4472C4', '4472C4', 'C00000', '4472C4']);
  });

  test('zero, negative and missing values leave their slot empty', () => {
    const projection = project({
      values: [300, 0, -120, null, 80],
      categories: ['A', 'B', 'C', 'D', 'E'],
    });
    const sparse = bars(projection);
    expect(sparse).toHaveLength(2);
    // The last bar keeps the fifth slot: four slots below the first.
    const [line] = verticalLines(projection);
    const slot = (line!.b - line!.t) / 5;
    expect(sparse[1]!.t - sparse[0]!.t).toBeCloseTo(4 * slot, 1);
    expect(sparse[1]!.r - sparse[1]!.l).toBeCloseTo(((sparse[0]!.r - sparse[0]!.l) * 80) / 300, 2);
    expect(labels(projection).map((item) => item.text)).not.toContain('0');
  });
});

describe('labels', () => {
  test('category labels end beside the plot, centred on their slot', () => {
    const projection = project();
    const columns = bars(projection);
    const [line] = verticalLines(projection);
    for (const [index, name] of ['Leads', 'Qualified', 'Proposals', 'Won'].entries()) {
      const label = labels(projection).find((item) => item.text === name)!;
      expect(label.right).toBeCloseTo(line!.x - 6.6, 1);
      expect(label.y).toBeCloseTo((columns[index]!.t + columns[index]!.b) / 2, 1);
    }
  });

  test('data labels sit at the centre of their bar in the light text colour, whatever their position', () => {
    for (const position of ['ctr', 'inEnd', 'outEnd', 'inBase']) {
      const projection = project({ labels: position });
      const columns = bars(projection);
      const label = labels(projection).find((item) => item.text === '300')!;
      expect(label.x).toBeCloseTo((columns[1]!.l + columns[1]!.r) / 2, 1);
      expect(label.y).toBeCloseTo((columns[1]!.t + columns[1]!.b) / 2, 1);
      expect(label.color).toBe('FFFFFF');
    }
  });

  test('a data label wider than its bar does not show', () => {
    const texts = labels(project({ values: [9000, 3200, 1500, 210] })).map((item) => item.text);
    expect(texts).toContain('1500');
    expect(texts).not.toContain('210');
  });

  test('labels whose text properties end in their own colour keep it', () => {
    const txPr =
      '<cx:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr/><a:endParaRPr lang="en-US">' +
      '<a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:endParaRPr></a:p></cx:txPr>';
    const label = labels(project({ labelTxPr: txPr })).find((item) => item.text === '400')!;
    expect(label.color).toBe('000000');
  });

  test('a colour and size on the default run alone do not reach the labels', () => {
    const txPr =
      '<cx:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200"><a:solidFill>' +
      '<a:srgbClr val="000000"/></a:solidFill></a:defRPr></a:pPr>' +
      '<a:endParaRPr lang="en-US"/></a:p></cx:txPr>';
    const label = labels(project({ labelTxPr: txPr })).find((item) => item.text === '400')!;
    expect(label.color).toBe('FFFFFF');
    expect(label.size).toBe(9);
  });

  test('labels off show none; a hidden axis shows no category labels and no line', () => {
    expect(labels(project({ labels: null })).map((item) => item.text)).not.toContain('400');
    const hidden = project({ axis: 'hidden' });
    expect(labels(hidden).map((item) => item.text)).not.toContain('Leads');
    expect(verticalLines(hidden)).toEqual([]);
  });

  test('without an axis element the category labels and line still show', () => {
    const bare = project({ axis: 'none' });
    expect(labels(bare).map((item) => item.text)).toContain('Leads');
    expect(verticalLines(bare)).toHaveLength(1);
    const columns = bars(bare);
    const pitch = columns[1]!.t - columns[0]!.t;
    expect(columns[0]!.b - columns[0]!.t).toBeCloseTo(pitch / 1.34, 2);
  });

  test('short slots show every n-th category label, from the first', () => {
    const categories = Array.from({ length: 30 }, (_, index) => `Stage ${index + 1}`);
    const values = categories.map((_, index) => 3000 - 95 * index);
    const texts = labels(project({ categories, values, labels: null })).map((item) => item.text);
    expect(texts).toContain('Stage 1');
    expect(texts).toContain('Stage 3');
    expect(texts).not.toContain('Stage 2');
  });

  test('a label wider than a third of the room is cut with an ellipsis', () => {
    const long =
      'A category name that keeps going well past any reasonable width for an axis label';
    const texts = labels(project({ categories: [long, 'Short', 'Mid'], values: [3, 2, 1] }));
    const cut = texts.find((item) => item.text.endsWith('…'))!;
    expect(cut.text.startsWith('A category name')).toBe(true);
    const [line] = verticalLines(
      project({ categories: [long, 'Short', 'Mid'], values: [3, 2, 1] })
    );
    // The plot starts a third of the room plus the label room from the left margin.
    expect(line!.x).toBeCloseTo(5.5 + (432 - 6.6 - 0.24 - 5.5) / 3 + 6.18, 1);
  });

  test('the legend lists the series in its colour', () => {
    const projection = project({ legend: 't' });
    expect(labels(projection).map((item) => item.text)).toContain('Count');
  });
});

describe('edge cases', () => {
  test('a series without values keeps the placeholder', () => {
    const projection = project({ categories: [], values: [] });
    expect(projection.vectorShape ?? null).toBeNull();
  });

  test('a series with no positive value paints the frame and labels without bars', () => {
    const projection = project({ values: [0, -1, -2, 0] });
    expect(projection.vectorShape).not.toBeNull();
    expect(bars(projection)).toEqual([]);
    expect(labels(projection).map((item) => item.text)).toContain('Leads');
  });

  test('the largest category count the model reads paints within bounds', () => {
    const count = 4_096;
    // Long names, so every label would need cutting.
    const name = 'word '.repeat(60);
    const categories = Array.from({ length: count }, (_, index) => `${name}${index}`);
    const values = categories.map((_, index) => count - index);
    const started = performance.now();
    const projection = project({ categories, values, title: null });
    expect(performance.now() - started).toBeLessThan(20_000);
    expect(projection.vectorShape).not.toBeNull();
    // Slots far shorter than a line show only every n-th category label.
    expect(labels(projection).length).toBeLessThan(count / 10);
  });

  test('a category count past the bound keeps the placeholder', () => {
    const count = 4_097;
    const categories = Array.from({ length: count }, (_, index) => `C${index}`);
    const values = categories.map(() => 1);
    expect(project({ categories, values }).vectorShape ?? null).toBeNull();
  });

  test('without style parts the default look applies', () => {
    expect(bars(project({}, { noStyleParts: true })).map((bar) => bar.hex)).toEqual(
      bars(project()).map((bar) => bar.hex)
    );
  });
});
