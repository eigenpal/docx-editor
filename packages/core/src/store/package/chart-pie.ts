// Pie and doughnut plots: slices from the first slice angle, clockwise, with exploded slices
// and data labels.

import { dataLabelFor, dataLabelText, elementText } from './chart-labels.ts';
import type { ChartPlot } from './chart-model.ts';
import { slice, type ChartScene } from './chart-scene.ts';
import { seriesLook, variesByPoint, type LookContext } from './chart-series.ts';
import { lineHeight, textBlock, type ChartLabel, type ChartTextStyle } from './chart-text.ts';
import type { Box } from './chart-axes.ts';
import { child, children, childVal } from './chart-model.ts';
import { mergeStroke, readChartShapeProperties, type ChartStroke } from './chart-style.ts';
import { isElement } from './drawing-projection-walk.ts';
import type { OoxmlElement } from './ooxml-tree.ts';

export interface PieContext {
  readonly look: LookContext;
  readonly scene: ChartScene;
  readonly labels: ChartLabel[];
  readonly baseText: ChartTextStyle;
  readonly date1904: boolean;
  /** The plot area has a manual inner layout. */
  readonly placed: boolean;
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
  /** Label box centre as placed before collisions. */
  readonly cx: number;
  cy: number;
  readonly width: number;
  readonly height: number;
}

const FIT_SLACK = 0.75;
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

/** Spread outside labels on each side so none overlaps the next, away from the centre line. */
function separate(labels: PieLabel[], cy: number): void {
  for (const right of [true, false]) {
    const side = labels.filter((item) => item.outside && item.right === right);
    const upper = side.filter((item) => item.cy < cy).sort((a, b) => b.cy - a.cy);
    const lower = side.filter((item) => item.cy >= cy).sort((a, b) => a.cy - b.cy);
    for (let index = 1; index < upper.length; index += 1) {
      const below = upper[index - 1]!;
      const item = upper[index]!;
      const limit = below.cy - (below.height + item.height) / 2;
      if (item.cy > limit) item.cy = limit;
    }
    for (let index = 1; index < lower.length; index += 1) {
      const above = lower[index - 1]!;
      const item = lower[index]!;
      const limit = above.cy + (above.height + item.height) / 2;
      if (item.cy < limit) item.cy = limit;
    }
  }
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
            item.categories?.[index] ?? null,
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
  separate(pending, cy);
  const leader = leaderStroke(rings[0]?.dLbls ?? plot.dLbls, context);
  for (const item of pending) {
    const moved = Math.abs(item.cy - (item.label.y + item.height / 2));
    const label = { ...item.label, y: item.cy - item.height / 2 };
    context.labels.push(label);
    // A label pushed away from its slice keeps a leader line back to the slice edge.
    if (item.outside && moved > 1) {
      const edgeX = item.right ? item.cx - item.width / 2 : item.cx + item.width / 2;
      context.scene.line(
        [
          { x: item.anchor.x, y: item.anchor.y },
          { x: edgeX, y: item.cy },
        ],
        leader
      );
    }
  }
}
