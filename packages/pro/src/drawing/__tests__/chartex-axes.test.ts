/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The chartex category and value axes, with the rules measured against reference renderings
// of waterfall charts (9 pt labels): the label box limit of a third of the frame's box height,
// one row against the whole text, two staggered rows tried at 1.335 slots and kept at 1.293,
// turned labels at the first of 30, 60 and 90 degrees whose footprint fits, the plot moves
// that keep labels inside the box, the 6.49 pt value label gap and the room above the plot.

import { describe, expect, test } from 'bun:test';
import {
  projectDrawingsInPackage,
  type DrawingProjection,
} from '../../../../core/src/store/package/drawing-projection.ts';
import type { OoxmlElement, OoxmlNode } from '../../../../core/src/store/package/ooxml-tree.ts';
import {
  chartexPackage,
  waterfallChartSpace,
  type WaterfallOptions,
} from '../../../../core/src/store/__tests__/chartex-fixture.ts';
import { DEFAULT_CHART_TEXT } from '../chart-labels.ts';
import { estimateTextWidth } from '../chart-text.ts';
import { categoryBand, cutToWidth } from '../chartex-axes.ts';
import { installDrawing } from '../index.ts';

installDrawing();

const EMU = 12_700;
const STYLE = { ...DEFAULT_CHART_TEXT, sizePt: 9 };
/** 'Missing parts' at 9 pt. */
const MISSING = estimateTextWidth('Missing parts', STYLE);

/** Category labels over `count` slots of `slot` points, inside a wide box. */
function band(texts: readonly string[], slot: number, limit = 200) {
  const edges = { l: 20, r: 20 + slot * texts.length };
  return categoryBand(texts, STYLE, edges, { l: -1e6, r: 1e6 }, limit);
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return (node as OoxmlElement).children.map(textOf).join('');
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

function project(options: WaterfallOptions, cx = 432, cy = 165.6): DrawingProjection {
  const projections = projectDrawingsInPackage(
    chartexPackage(waterfallChartSpace(options), {
      alternateContent: true,
      cx: Math.round(cx * EMU),
      cy: Math.round(cy * EMU),
    })
  );
  return projections[0]!;
}

/** A chart like the measured probes: no title, legend or data labels; small values. */
function probe(categories: readonly string[], cx = 432, cy = 165.6) {
  return project(
    {
      categories,
      values: categories.map((_, index) => (index % 2 === 0 ? 5 : -3)),
      subtotals: [],
      title: null,
      legend: null,
      labels: false,
    },
    cx,
    cy
  );
}

/** The plot box: the extent of the horizontal gridlines, in chart points. */
function plotOf(projection: DrawingProjection) {
  let l = Infinity;
  let r = -Infinity;
  let t = Infinity;
  let b = -Infinity;
  for (const component of projection.vectorShape?.components ?? []) {
    if (component.strokeHex !== 'D9D9D9' || component.fillHex) continue;
    for (const path of component.subpathsEmu) {
      if (path.length !== 2 || path[0]!.y !== path[1]!.y) continue;
      l = Math.min(l, path[0]!.x / EMU, path[1]!.x / EMU);
      r = Math.max(r, path[0]!.x / EMU, path[1]!.x / EMU);
      t = Math.min(t, path[0]!.y / EMU);
      b = Math.max(b, path[0]!.y / EMU);
    }
  }
  return { l, r, t, b };
}

function categoryLabels(projection: DrawingProjection, names: readonly string[]) {
  return (projection.groupTextboxes ?? []).filter((box) =>
    names.some((name) => textOf(box.story.content).startsWith(name.slice(0, 3)))
  );
}

describe('label boxes', () => {
  test('a label longer than its box is cut at a word boundary with an ellipsis', () => {
    expect(cutToWidth('Late delivery charge applied', STYLE, 51.5)).toBe('Late…');
    expect(cutToWidth('Late delivery charge applied', STYLE, 59)).toBe('Late delivery…');
    expect(cutToWidth('Abcdefghijklmnop', STYLE, 51.5)).toBe('Abcdefghijkl…');
    expect(cutToWidth('Short', STYLE, 51.5)).toBe('Short');
  });

  test('the box is at most a third of the frame box height', () => {
    // 165.6 pt tall: the frame leaves 154.6 pt, so boxes reach 51.5 pt.
    const short = probe(Array(8).fill('Late delivery charge applied twice'));
    const tall = probe(Array(8).fill('Late delivery charge applied twice'), 432, 187.2);
    const texts = (projection: DrawingProjection) =>
      new Set(categoryLabels(projection, ['Late']).map((box) => textOf(box.story.content)));
    expect([...texts(short)]).toEqual(['Late…']);
    expect([...texts(tall)]).toEqual(['Late delivery…']);
  });
});

describe('arrangements', () => {
  test('one row needs the widest text 1.51 pt narrower than the slot', () => {
    expect(band(Array(8).fill('Missing parts'), MISSING + 1.55).rows).toBe(1);
    expect(band(Array(8).fill('Missing parts'), MISSING + 1.45).rows).toBe(2);
  });

  test('one row weighs the whole text, not its cut box, and shows it whole', () => {
    const texts = ['Ab', 'Ab', 'Late delivery charge'];
    const cut = band(texts, 60, 51.5);
    expect(cut.rows).toBe(2);
    expect(cut.texts[2]).toBe('Late…');
    const whole = band(texts, 80, 51.5);
    expect(whole.rows).toBe(1);
    expect(whole.texts[2]).toBe('Late delivery charge');
  });

  test('two staggered rows hold boxes up to 1.293 slots once the plot narrowed', () => {
    expect(band(Array(10).fill('Missing parts'), MISSING / 1.28).rows).toBe(2);
    const turned = band(Array(10).fill('Missing parts'), MISSING / 1.36);
    expect(turned.rows).toBe(1);
    expect(turned.angle).toBe(30);
  });

  test('turned labels take the first of 30, 60 and 90 degrees whose footprint fits', () => {
    // Footprints of 'Missing parts': 30 degrees 47.55 pt, 60 degrees 33.8 pt.
    expect(band(Array(10).fill('Missing parts'), 31).angle).toBe(30);
    expect(band(Array(10).fill('Missing parts'), 29).angle).toBe(60);
    expect(band(Array(20).fill('Missing parts'), 22).angle).toBe(60);
    expect(band(Array(20).fill('Missing parts'), 20).angle).toBe(90);
  });

  test('turned labels are not cut to their slot', () => {
    const turned = band(Array(16).fill('Missing parts'), 25);
    expect(turned.angle).toBe(60);
    expect(turned.texts[0]).toBe('Missing parts');
  });
});

describe('plot edges', () => {
  test('staggered labels narrow the plot so the last ends 0.94 pt past the box', () => {
    const texts = Array(10).fill('Missing parts');
    const placed = categoryBand(texts, STYLE, { l: 20, r: 420 }, { l: 5.5, r: 420 + 0.94 }, 200);
    expect(placed.rows).toBe(2);
    const slot = (placed.r - placed.l) / 10;
    expect(placed.r - slot / 2 + MISSING / 2).toBeCloseTo(420.94, 6);
  });

  test('turned labels move the plot right so the first starts at the box edge', () => {
    const texts = Array(12).fill('Missing parts');
    const placed = categoryBand(texts, STYLE, { l: 20, r: 420 }, { l: 5.5, r: 420.94 }, 200);
    expect(placed.angle).toBe(30);
    const slot = (placed.r - placed.l) / 12;
    const line = 9 * 1.22;
    const left = placed.l + slot / 2 - MISSING * Math.cos(Math.PI / 6) - (line / 2) * 0.5;
    expect(left).toBeCloseTo(5.5, 6);
  });

  test('a rejected 30 degree try moves the plot once and 60 degrees keeps the move', () => {
    const texts = Array(10).fill('Missing parts');
    const box = { l: 5.5, r: 312 };
    // The first check passes (47.55 pt over a 29.2 pt slot), the moved slot fails.
    const moved = categoryBand(texts, STYLE, { l: 20, r: 312 }, box, 200);
    expect(moved.angle).toBe(60);
    const line = 9 * 1.22;
    const reach30 = MISSING * Math.cos(Math.PI / 6) + (line / 2) * 0.5;
    expect(moved.l).toBeCloseTo(5.5 + reach30 - 29.2 / 2, 6);
    // Far below the first check, 30 degrees is not tried: only the 60 degree move applies.
    const untried = categoryBand(texts, STYLE, { l: 20, r: 270 }, box, 200);
    expect(untried.angle).toBe(60);
    const reach60 = MISSING * 0.5 + (line / 2) * Math.sin(Math.PI / 3);
    expect(untried.l).toBeCloseTo((5.5 + reach60 - 270 / 20) / (1 - 1 / 20), 6);
  });
});

describe('measured charts', () => {
  test('long labels turn by 30, 60 and 90 degrees as the slots shrink', () => {
    const angle = (count: number) =>
      categoryLabels(probe(Array(count).fill('Missing parts')), ['Missing parts'])[0]!
        .rotationDegrees;
    expect(angle(8)).toBe(0);
    expect(angle(12)).toBeCloseTo(330, 6);
    expect(angle(16)).toBeCloseTo(300, 6);
    expect(angle(20)).toBeCloseTo(270, 6);
  });

  test('turned labels keep the axis text size', () => {
    const projection = probe(Array(12).fill('Missing parts'));
    const [turned] = categoryLabels(projection, ['Missing parts']);
    expect(turned!.rotationDegrees).toBeCloseTo(330, 6);
    expect(sizeOf(turned!.story.content)).toBe(9);
  });

  test('the plot of turned labels starts 6.9 pt plus their band above the bottom margin', () => {
    const plot = plotOf(probe(Array(12).fill('Missing parts')));
    const band30 = 6.9 + MISSING * 0.5 + 9 * 1.22 * Math.cos(Math.PI / 6);
    expect(plot.b).toBeCloseTo(165.6 - 5.5 - band30, 1);
  });

  test('value labels end 6.49 pt left of the plot and the plot keeps half a line above', () => {
    const projection = probe(['A', 'B', 'C', 'D']);
    const plot = plotOf(projection);
    // One-digit tick labels from the 5.5 pt margin.
    expect(plot.l).toBeCloseTo(5.5 + estimateTextWidth('8', STYLE) + 6.49, 1);
    expect(plot.t).toBeCloseTo(5.5 + (9 * 1.22) / 2 - 0.08, 2);
  });
});
