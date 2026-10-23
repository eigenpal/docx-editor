// Pie and doughnut plots: slices from the first slice angle, clockwise, with exploded slices
// and data labels.

import { dataLabelFor, dataLabelText, elementText } from './chart-labels.ts';
import type { ChartPlot } from './chart-model.ts';
import { slice, type ChartScene } from './chart-scene.ts';
import { seriesLook, variesByPoint, type LookContext } from './chart-series.ts';
import { lineHeight, textBlock, type ChartLabel, type ChartTextStyle } from './chart-text.ts';
import type { Box } from './chart-axes.ts';
import { childVal } from './chart-model.ts';

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

/** Paint a pie or doughnut plot inside `box`. */
export function paintPie(plot: ChartPlot, box: Box, context: PieContext): void {
  const series = plot.series.filter((item) =>
    item.values.some((value) => value !== null && value > 0)
  );
  if (series.length === 0) return;
  const doughnut = plot.kind === 'doughnut';
  const rings = doughnut ? series : series.slice(0, 1);
  const anyLabels = rings.some((item) =>
    item.values.some((_, index) => dataLabelFor(plot, item, index) !== null)
  );
  const labelStyle = elementText(context.baseText, null);
  // An automatic plot area leaves room for labels round the pie; a placed one is the pie.
  const room = anyLabels && !context.placed ? 2 * 1.73 * labelStyle.sizePt : 0;
  const diameter = Math.max(1, Math.min(box.r - box.l, box.b - box.t) - room);
  // Exploded slices move out from the full radius; the pie does not shrink to fit them.
  const radius = diameter / 2;
  const cx = (box.l + box.r) / 2;
  const cy = (box.t + box.b) / 2;
  const hole = doughnut ? (radius * plot.holeSize) / 100 : 0;
  const ringWidth = (radius - hole) / rings.length;
  const pending: ChartLabel[] = [];
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
        const position = spec.position ?? 'bestFit';
        const distance =
          position === 'ctr'
            ? (inner + outer) / 2
            : position === 'outEnd'
              ? outer + extent + 4
              : doughnut
                ? (inner + outer) / 2
                : outer - extent - 4;
        const lx = ox + distance * sin;
        const ly = oy - distance * cos;
        pending.push({
          paragraphs: [[{ text, style }]],
          align: 'ctr',
          x: lx - (width * 1.3 + style.sizePt * 2) / 2,
          y: ly - height / 2,
          width: width * 1.3 + style.sizePt * 2,
          height,
          rotation: 0,
        });
      }
      angle += sweep;
    }
  }
  for (const label of pending) context.labels.push(label);
}
