/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Pie data labels: which best-fit labels move outside their slice, how crowded outside labels
// spread round the pie clear of each other, the title and the chart edge, and the leader lines
// of labels that moved away from their slice.

import { describe, expect, test } from 'bun:test';
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
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
const LEADER =
  '<c:showLeaderLines val="1"/><c:leaderLines><c:spPr><a:ln w="9525"><a:solidFill>' +
  '<a:srgbClr val="A6A6A6"/></a:solidFill></a:ln></c:spPr></c:leaderLines>';

function pie(values: readonly number[], separator: string, options: { title?: string } = {}) {
  const names = NAMES.slice(0, values.length);
  const labels =
    '<c:dLbls><c:dLblPos val="bestFit"/><c:showLegendKey val="0"/><c:showVal val="0"/>' +
    '<c:showCatName val="1"/><c:showSerName val="0"/><c:showPercent val="1"/>' +
    `<c:separator>${separator}</c:separator>${LEADER}</c:dLbls>`;
  const plot =
    '<c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>' +
    `<c:tx>${strCache(['Share'])}</c:tx>${labels}<c:cat>${strCache(names)}</c:cat>` +
    `<c:val>${numCache(values)}</c:val></c:ser><c:firstSliceAng val="0"/></c:pieChart>`;
  const projections = projectDrawingsInPackage(chartPackage(chartSpace(plot, options)));
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return (node as OoxmlElement).children.map(textOf).join('');
}

interface Placed {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

function labels(projection: DrawingProjection): Placed[] {
  return (projection.groupTextboxes ?? []).map((box) => ({
    text: textOf(box.story.content),
    x: (box.frameEmu.x + box.frameEmu.cx / 2) / EMU,
    y: (box.frameEmu.y + box.frameEmu.cy / 2) / EMU,
  }));
}

/** The pie's centre and radius, from the slices' outline points. */
function circle(projection: DrawingProjection) {
  const slices = projection.vectorShape!.components.filter(
    (component) => component.fillHex !== null && component.subpathsEmu[0]!.length > 8
  );
  const points = slices.flatMap((component) => component.subpathsEmu[0]!);
  const xs = points.map((point) => point.x / EMU);
  const ys = points.map((point) => point.y / EMU);
  const radius = (Math.max(...xs) - Math.min(...xs)) / 2;
  return { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: Math.max(...ys) - radius, radius };
}

/** Leader lines: open three-point strokes in the leader colour. */
function leaders(projection: DrawingProjection) {
  return projection
    .vectorShape!.components.filter(
      (component) => component.strokeHex === 'A6A6A6' && component.subpathsClosed?.[0] === false
    )
    .map((component) => component.subpathsEmu[0]!.map((p) => ({ x: p.x / EMU, y: p.y / EMU })));
}

describe('pie best-fit labels', () => {
  test('a wide label that crowds its slice moves outside the pie', () => {
    const projection = pie([70, 10, 6, 5, 3, 2, 2, 2], ' ');
    const { x, y, radius } = circle(projection);
    const placed = labels(projection);
    const at = (text: string) => placed.find((item) => item.text === text)!;
    // A tenth of the pie holds its label; a label as wide in six hundredths does not.
    expect(Math.hypot(at('Bravo 10%').x - x, at('Bravo 10%').y - y)).toBeLessThan(radius);
    expect(Math.hypot(at('Charlie 6%').x - x, at('Charlie 6%').y - y)).toBeGreaterThan(radius);
  });

  test('crowded outside labels spread round the pie without overlapping, inside the chart', () => {
    const projection = pie([70, 10, 6, 5, 3, 2, 2, 2], ' ');
    const boxes = (projection.groupTextboxes ?? [])
      .map((box) => ({ text: textOf(box.story.content), frame: box.frameEmu }))
      .filter((item) => /%$/.test(item.text))
      .map((item) => {
        const cx = (item.frame.x + item.frame.cx / 2) / EMU;
        const cy = (item.frame.y + item.frame.cy / 2) / EMU;
        // The frame is wider than the text; the text is about 4.6 points per character.
        const half = (item.text.length * 4.6) / 2;
        return { text: item.text, l: cx - half, r: cx + half, t: cy - 5.5, b: cy + 5.5 };
      });
    for (const a of boxes) {
      expect(a.t).toBeGreaterThanOrEqual(0);
      for (const b of boxes) {
        if (a === b) continue;
        const overlap = a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
        expect(overlap ? `${a.text} overlaps ${b.text}` : '').toBe('');
      }
    }
    // The last slice's label moves clockwise, past twelve o'clock; the one before it back.
    const { x } = circle(projection);
    const placed = labels(projection);
    expect(placed.find((item) => item.text === 'Hotel 2%')!.x).toBeGreaterThan(x);
    expect(placed.find((item) => item.text === 'Golf 2%')!.x).toBeLessThan(x);
  });

  test('a label moved away from its slice draws a leader that bends and ends level', () => {
    const projection = pie([70, 10, 6, 5, 3, 2, 2, 2], ' ');
    const lines = leaders(projection);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toHaveLength(3);
      // The last run is level and half a size long.
      expect(line[2]!.y).toBeCloseTo(line[1]!.y, 6);
      expect(Math.abs(line[2]!.x - line[1]!.x)).toBeCloseTo(0.5 * 10, 1);
    }
  });

  test('outside labels keep clear of the chart title', () => {
    const projection = pie([42, 25, 12, 8, 6, 4, 3], '\n', { title: 'Best fit' });
    const placed = labels(projection);
    const title = placed.find((item) => item.text === 'Best fit')!;
    for (const item of placed) {
      if (item === title || !/%/.test(item.text)) continue;
      const clear = Math.abs(item.y - title.y) > 14 || Math.abs(item.x - title.x) > 30;
      expect(clear ? '' : `${item.text} under the title`).toBe('');
    }
  });
});
