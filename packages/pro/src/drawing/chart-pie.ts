/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Pie and doughnut plots: slices from the first slice angle, clockwise, with exploded slices
// and data labels.

import { categoryLabel } from './chart-number-format.ts';
import { isElement, type OoxmlElement } from '@docx-editor.dev/core/store';
import { dataLabelFor, dataLabelText, elementText } from './chart-labels.ts';
import type { ChartPlot } from './chart-model.ts';
import { slice, type ChartScene, type Point } from './chart-scene.ts';
import { seriesLook, variesByPoint, type LookContext } from './chart-series.ts';
import { lineHeight, textBlock, type ChartLabel, type ChartTextStyle } from './chart-text.ts';
import type { Box } from './chart-axes.ts';
import { child, children, childVal } from './chart-model.ts';
import { mergeStroke, readChartShapeProperties, type ChartStroke } from './chart-style.ts';

export interface PieContext {
  readonly look: LookContext;
  readonly scene: ChartScene;
  readonly labels: ChartLabel[];
  readonly baseText: ChartTextStyle;
  readonly date1904: boolean;
  /** The plot area has a manual inner layout. */
  readonly placed: boolean;
  /** Boxes outside labels keep clear of, such as the chart title. */
  readonly avoid?: readonly Box[];
  /** The chart's own box, which outside labels stay inside. */
  readonly bounds?: Box;
}

function explosionOf(plot: ChartPlot, seriesIndex: number, pointIndex: number): number {
  const series = plot.series[seriesIndex]!;
  const point = series.points.get(pointIndex);
  const own = point ? childVal(point, 'explosion') : undefined;
  const raw = own !== undefined && /^\d{1,3}$/.test(own) ? Number(own) : NaN;
  return raw >= 0 && raw <= 400 ? raw : series.explosion;
}

interface PieLabel {
  readonly label: ChartLabel;
  /** Where a leader line starts: the slice edge at its middle angle. */
  readonly anchor: { readonly x: number; readonly y: number };
  readonly outside: boolean;
  readonly right: boolean;
  /** Label box centre, moved as collisions resolve. */
  cx: number;
  cy: number;
  /** Where the label sat before it moved. */
  readonly naturalX: number;
  readonly naturalY: number;
  /** Clockwise angle from twelve o'clock the label sits at, moved as collisions resolve. */
  angle: number;
  readonly middle: number;
  /** The slice centre, and the distance from it to the label's nearest side. */
  readonly origin: { readonly x: number; readonly y: number };
  readonly reach: number;
  /** The way the label last moved round the pie: 1 clockwise, -1 back, 0 not yet. */
  drift: number;
  readonly lineHeight: number;
  readonly size: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The fit test shrinks a label by this much before it checks the label lies in its slice:
 * measured best-fit labels classify alike for any value from 0.75 to 0.9.
 */
const FIT_SLACK = 0.85;
/** A leader line ends in a level run this long, this far from the text. */
const LEADER_RUN = 0.5;
const LEADER_GAP = 0.16;
/** Labels further than this from their slice edge, in sizes, take a leader line. */
const LEADER_REACH = 0.75;
/** How far outside labels may reach past the plot area, in points. */
const LABEL_REACH = 10;
const DEFAULT_LEADER: ChartStroke = {
  hex: 'A6A6A6',
  alpha: 1,
  widthPt: 0.75,
  cap: 'butt',
  dash: null,
};

/** The leader line stroke a `c:dLbls` names, directly or in its extension. */
function leaderStroke(dLbls: OoxmlElement | null, context: PieContext): ChartStroke {
  const direct = child(dLbls, 'leaderLines');
  let element = direct;
  if (!element) {
    // The 2012 extension carries leader lines for chart types older schemas lack them for.
    for (const ext of children(child(dLbls, 'extLst'), 'ext')) {
      for (const node of ext.children) {
        if (isElement(node) && node.localName === 'leaderLines') element = node;
      }
    }
  }
  const own = readChartShapeProperties(child(element, 'spPr'), context.look.resolveSchemeColor);
  return mergeStroke(own.line, DEFAULT_LEADER) ?? DEFAULT_LEADER;
}

/** Whether the angle (clockwise from twelve o'clock, degrees) lies in a slice. */
function inSweep(angle: number, from: number, sweep: number): boolean {
  const offset = (((angle - from) % 360) + 360) % 360;
  return offset <= sweep;
}

/** Whether a label box centred at (x, y) lies inside a slice. */
function fitsInSlice(
  x: number,
  y: number,
  width: number,
  height: number,
  geometry: { cx: number; cy: number; inner: number; outer: number; from: number; sweep: number }
): boolean {
  if (geometry.sweep >= 359.9) return true;
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    // The test is lenient: a label may reach a little past its slice's edges.
    const px = x + (dx * width * FIT_SLACK) / 2 - geometry.cx;
    const py = y + (dy * height * FIT_SLACK) / 2 - geometry.cy;
    const distance = Math.hypot(px, py);
    if (distance > geometry.outer || distance < geometry.inner) return false;
    const angle = (Math.atan2(px, -py) * 180) / Math.PI;
    if (!inSweep(angle, geometry.from, geometry.sweep)) return false;
  }
  return true;
}

/** Paint a pie or doughnut plot inside `box`. */
export function paintPie(plot: ChartPlot, box: Box, context: PieContext): void {
  const series = plot.series.filter((item) =>
    item.values.some((value) => value !== null && value > 0)
  );
  if (series.length === 0) return;
  const doughnut = plot.kind === 'doughnut';
  const rings = doughnut ? series : series.slice(0, 1);
  // Labels that may sit outside the pie need room round it; a placed plot area is the pie.
  const outsideLabels = rings.some((item) =>
    item.values.some((_, index) => {
      const spec = dataLabelFor(plot, item, index);
      return spec !== null && spec.position !== 'inEnd' && spec.position !== 'ctr';
    })
  );
  const labelStyle = elementText(context.baseText, null);
  const room = outsideLabels && !context.placed ? 2 * 1.38 * labelStyle.sizePt : 0;
  const diameter = Math.max(1, Math.min(box.r - box.l, box.b - box.t) - room);
  const cx = (box.l + box.r) / 2;
  const cy = (box.t + box.b) / 2;
  // Exploded slices move out from the full radius; the pie does not shrink to fit them.
  const run = (radius: number, paint: boolean): PieLabel[] => {
    const hole = doughnut ? (radius * plot.holeSize) / 100 : 0;
    const ringWidth = (radius - hole) / rings.length;
    const pending: PieLabel[] = [];
    for (const [ringIndex, item] of rings.entries()) {
      const total = item.values.reduce<number>(
        (sum, value) => sum + (value !== null && value > 0 ? value : 0),
        0
      );
      if (!(total > 0)) continue;
      const inner = doughnut ? hole + ringIndex * ringWidth : 0;
      const outer = doughnut ? inner + ringWidth : radius;
      let angle = plot.firstSliceAngle;
      const count = item.values.length;
      for (let index = 0; index < count; index += 1) {
        const value = item.values[index];
        if (value === null || value === undefined || !(value > 0)) continue;
        const sweep = (value / total) * 360;
        const middle = angle + sweep / 2;
        const explosion = (explosionOf(plot, plot.series.indexOf(item), index) / 100) * radius;
        const radians = (middle * Math.PI) / 180;
        const ox = cx + explosion * Math.sin(radians);
        const oy = cy - explosion * Math.cos(radians);
        const look = seriesLook(
          plot,
          item,
          context.look,
          variesByPoint(plot) || item.points.has(index) ? { index, count } : undefined
        );
        if (paint)
          context.scene.path(
            [slice(ox, oy, outer, inner, angle, angle + sweep)],
            true,
            look.fill,
            look.line,
            'round'
          );
        const spec = dataLabelFor(plot, item, index);
        if (spec) {
          const style = elementText(context.baseText, spec.txPr, context.look.resolveSchemeColor);
          const text = dataLabelText(
            spec,
            value,
            value / total,
            categoryLabel(item, index, context.date1904),
            item.name,
            item.formatCode,
            context.date1904
          );
          const block = textBlock(text, style);
          const width = block.width;
          const height = lineHeight(style) * block.lines;
          const sin = Math.sin(radians);
          const cos = Math.cos(radians);
          const extent = (width / 2) * Math.abs(sin) + (height / 2) * Math.abs(cos);
          const position = spec.position ?? (doughnut ? 'ctr' : 'bestFit');
          const geometry = { cx: ox, cy: oy, inner, outer, from: angle, sweep };
          const inside = position === 'ctr' || doughnut ? (inner + outer) / 2 : outer - extent - 4;
          let outside = position === 'outEnd';
          if (position === 'bestFit') {
            // A label that does not fit inside its slice moves out, next to the slice.
            outside = !fitsInSlice(ox + inside * sin, oy - inside * cos, width, height, geometry);
          }
          // Outside-end labels keep a little gap; best-fit ones that move out sit at the edge.
          const distance = outside ? outer + extent + (position === 'outEnd' ? 6 : 0) : inside;
          const frame = width * 1.3 + style.sizePt * 2;
          const lx = ox + distance * sin;
          const ly = oy - distance * cos;
          pending.push({
            label: {
              paragraphs: [[{ text, style }]],
              align: 'ctr',
              x: lx - frame / 2,
              y: ly - height / 2,
              width: frame,
              height,
              rotation: 0,
            },
            anchor: { x: ox + outer * sin, y: oy - outer * cos },
            outside,
            right: sin >= 0,
            cx: lx,
            cy: ly,
            naturalX: lx,
            naturalY: ly,
            angle: middle,
            middle,
            origin: { x: ox, y: oy },
            reach: outer + (position === 'outEnd' ? 6 : 0),
            drift: 0,
            lineHeight: lineHeight(style),
            size: style.sizePt,
            width,
            height,
          });
        }
        angle += sweep;
      }
    }
    return pending;
  };
  // Labels that move out of their slices may reach a little past the plot area, not past the
  // chart: the pie shrinks until they fit, down to half its size.
  let radius = diameter / 2;
  for (let pass = 0; pass < 3 && !context.placed; pass += 1) {
    let overflow = 0;
    for (const item of run(radius, false)) {
      if (!item.outside) continue;
      overflow = Math.max(
        overflow,
        item.cx + item.width / 2 - (box.r + LABEL_REACH),
        box.l - LABEL_REACH - (item.cx - item.width / 2),
        box.t - LABEL_REACH - (item.cy - item.height / 2),
        item.cy + item.height / 2 - (box.b + LABEL_REACH)
      );
    }
    if (overflow <= 0.5) break;
    radius = Math.max(diameter / 4, radius - overflow);
  }
  const pending = run(radius, true);
  relax(pending, context.avoid ?? [], context.bounds ?? null);
  const leader = leaderStroke(rings[0]?.dLbls ?? plot.dLbls, context);
  for (const item of pending) {
    const label = {
      ...item.label,
      x: item.label.x + (item.cx - item.naturalX),
      y: item.cy - item.height / 2,
    };
    context.labels.push(label);
    // A label moved away from its slice keeps a leader line back to the slice edge: to a
    // point beside the line of text nearest the pie, then level into the text. A label still
    // within three quarters of its size of the slice edge needs none.
    const box = labelBox(item);
    const gapX = Math.max(box.l - item.anchor.x, 0, item.anchor.x - box.r);
    const gapY = Math.max(box.t - item.anchor.y, 0, item.anchor.y - box.b);
    const moved = Math.hypot(item.cx - item.naturalX, item.cy - item.naturalY);
    if (item.outside && moved > 1 && Math.hypot(gapX, gapY) > LEADER_REACH * item.size) {
      context.scene.line(leaderPath(item, cy), leader);
    }
  }
}

/** The leader of a moved label: from the slice edge to a bend, then level to the text. */
function leaderPath(item: PieLabel, pieY: number): Point[] {
  const top = item.cy - item.height / 2;
  const lines = Math.max(1, Math.round(item.height / item.lineHeight));
  const line = item.cy < pieY ? lines - 1 : 0;
  const y = top + (line + 1) * item.lineHeight - 0.35 * item.size;
  const left = item.cx - item.width / 2;
  const right = item.cx + item.width / 2;
  const fromLeft = item.anchor.x < item.cx;
  const end = fromLeft ? left - LEADER_GAP * item.size : right + LEADER_GAP * item.size;
  const bend = fromLeft ? end - LEADER_RUN * item.size : end + LEADER_RUN * item.size;
  return [
    { x: item.anchor.x, y: item.anchor.y },
    { x: bend, y },
    { x: end, y },
  ];
}

function overlaps(a: Box, b: Box): boolean {
  return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
}

/** A label's text box, widened by `pad` sizes either side for the collision test. */
function labelBox(item: PieLabel, pad = 0): Box {
  const extra = pad * item.size;
  return {
    l: item.cx - item.width / 2 - extra,
    r: item.cx + item.width / 2 + extra,
    t: item.cy - item.height / 2,
    b: item.cy + item.height / 2,
  };
}

/** Room kept beside each outside label when labels crowd, in sizes. */
const LABEL_PAD = 0.25;

/** Degrees a label moves round the pie per step, and the most it may move in all. */
const STEP = 0.5;
const MAX_TURN = 150;
const MAX_STEPS = 1_000;

/** Place an outside label at its angle: its nearest side touches the circle it sits on. */
function placeAt(item: PieLabel): void {
  const radians = (item.angle * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const extent = (item.width / 2) * Math.abs(sin) + (item.height / 2) * Math.abs(cos);
  item.cx = item.origin.x + (item.reach + extent) * sin;
  item.cy = item.origin.y - (item.reach + extent) * cos;
}

/** The way round the pie that takes a label away from a box it hits. */
function awayFrom(item: PieLabel, box: Box, pieX: number, pieY: number): number {
  const angle =
    (Math.atan2((box.l + box.r) / 2 - pieX, pieY - (box.t + box.b) / 2) * 180) / Math.PI;
  const difference = ((((item.angle - angle) % 360) + 540) % 360) - 180;
  return difference >= 0 ? 1 : -1;
}

/**
 * Spread outside labels round the pie so none overlaps another, the title or the inside
 * labels, and none leaves the chart: overlapping neighbours step apart round the pie, and a
 * label that hits something else keeps stepping the way it was going.
 */
function relax(labels: PieLabel[], avoid: readonly Box[], bounds: Box | null): void {
  const outside = labels.filter((item) => item.outside);
  if (outside.length === 0) return;
  const fixed: Box[] = [...avoid];
  for (const item of labels) if (!item.outside) fixed.push(labelBox(item));
  const pieX = outside[0]!.origin.x;
  const pieY = outside[0]!.origin.y;
  const escapes = (box: Box) =>
    bounds !== null &&
    (box.l < bounds.l || box.r > bounds.r || box.t < bounds.t || box.b > bounds.b);
  const turn = (item: PieLabel, way: number) => {
    const next = item.angle + way * STEP;
    if (Math.abs(next - item.middle) > MAX_TURN) return false;
    item.angle = next;
    item.drift = way;
    placeAt(item);
    return true;
  };
  for (let step = 0; step < MAX_STEPS; step += 1) {
    let moved = false;
    const order = [...outside].sort(
      (a, b) => (((a.angle % 360) + 360) % 360) - (((b.angle % 360) + 360) % 360)
    );
    // Neighbours round the pie, the last and first too when three or more go round it.
    const pairs = order.length > 2 ? order.length : order.length - 1;
    for (let index = 0; index < pairs; index += 1) {
      const a = order[index]!;
      const b = order[(index + 1) % order.length]!;
      if (!overlaps(labelBox(a, LABEL_PAD), labelBox(b, LABEL_PAD))) continue;
      moved = turn(a, -1) || moved;
      moved = turn(b, 1) || moved;
    }
    for (const item of outside) {
      const box = labelBox(item, LABEL_PAD);
      const hit = fixed.find((other) => overlaps(box, other));
      if (hit) {
        moved = turn(item, item.drift || awayFrom(item, hit, pieX, pieY)) || moved;
      } else if (escapes(box)) {
        const edge = box.t < bounds!.t ? 0 : box.b > bounds!.b ? 180 : box.l < bounds!.l ? 270 : 90;
        const difference = ((((item.angle - edge) % 360) + 540) % 360) - 180;
        moved = turn(item, item.drift || (difference >= 0 ? 1 : -1)) || moved;
      }
    }
    if (!moved) break;
  }
}
