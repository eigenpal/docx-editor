// The chart commands on the editor's selection (`insertChart`, `setChartData`, `setChartType`,
// `setChartFormat`, `setChartColor`), the chart reads (`chartData`, `chartFormat`), and the
// selected chart as the snapshot reports it (`EditorSnapshot.chart`) for the chart controls
// and the Chart pane. The edits themselves are DOM-free (`store/package/chart-edit/`).

import { createT, en } from '@docx-editor.dev/i18n';
import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import type {
  ChartDataRead,
  ChartFormatRead,
  ChartType,
  NewChartData,
  SelectedChartState,
} from '../contracts/chart.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { resolveSelectedDrawingRecord } from './docx-editor-images.ts';
import { chartTargetIn } from '../store/store/tree-package-charts.ts';
import {
  chartDataEdit,
  chartEditable,
  readChartData,
  readChartFormatOf,
  type ChartTarget,
} from '../store/package/chart-edit/data.ts';
import { withChartColor, withChartFormat, withChartType } from '../store/package/chart-edit/format.ts';
import { sampleChartData } from '../store/package/chart-edit/insert.ts';
import { isChartType } from '../store/package/chart-edit/type.ts';
import { paragraphLength } from '../store/store/tree-op-segments.ts';
import { findNode } from '../store/package/ooxml-edit.ts';

/** The chart command types. */
export type ChartCommand = Extract<
  EditorCommand,
  { type: 'insertChart' | 'setChartData' | 'setChartType' | 'setChartFormat' | 'setChartColor' }
>;

const CHART_COMMANDS: ReadonlySet<string> = new Set([
  'insertChart',
  'setChartData',
  'setChartType',
  'setChartFormat',
  'setChartColor',
]);

/** Whether `command` is a chart command. */
export const isChartCommand = (command: EditorCommand): command is ChartCommand =>
  CHART_COMMANDS.has(command.type);

/** The widest new chart, in points: six inches. */
const NEW_CHART_WIDTH = 432;
/** The height of a new chart for its width: 3.5 by 6 inches. */
const NEW_CHART_ASPECT = 252 / 432;

/** The selected chart drawing and the chart part behind it, or null. */
function selectedChart(
  surface: PaginatedSurface | null,
  drawingNodeId?: string
): { drawingNodeId: string; target: ChartTarget } | null {
  if (!surface) return null;
  const id = drawingNodeId ?? resolveSelectedDrawingRecord(surface)?.drawingNodeId;
  if (!id) return null;
  const owner = surface.session.part().name;
  const target = chartTargetIn(surface.session.currentPackage(), owner, id);
  return target ? { drawingNodeId: id, target } : null;
}

/**
 * The selected chart, while exactly one chart drawing is selected, else null. Reference-stable
 * while nothing about it changes, as the snapshot contract asks.
 */
export function createChartStateCache(): (
  surface: PaginatedSurface | null
) => SelectedChartState | null {
  let last: SelectedChartState | null = null;
  return (surface) => {
    const chart = selectedChart(surface);
    if (!chart) return (last = null);
    const data = chartEditable(chart.target);
    const format = readChartFormatOf(chart.target);
    const next: SelectedChartState = {
      drawingNodeId: chart.drawingNodeId,
      editable: data.editable,
      ...(data.reason ? { reason: data.reason } : {}),
      formattable: format.ok,
      ...(format.ok ? {} : { formatReason: format.reason }),
    };
    if (
      last &&
      last.drawingNodeId === next.drawingNodeId &&
      last.editable === next.editable &&
      last.reason === next.reason &&
      last.formattable === next.formattable &&
      last.formatReason === next.formatReason
    )
      return last;
    return (last = next);
  };
}

/** The data of the selected chart, or of the chart drawing `drawingNodeId`. */
export function chartDataOf(surface: PaginatedSurface | null, drawingNodeId?: string): ChartDataRead {
  const chart = selectedChart(surface, drawingNodeId);
  if (!chart || !surface) return { ok: false, reason: 'chart.errors.noChart' };
  return readChartData(surface.session.currentPackage(), chart.target);
}

/** The type and elements of the selected chart, or of the chart drawing `drawingNodeId`. */
export function chartFormatOf(
  surface: PaginatedSurface | null,
  drawingNodeId?: string
): ChartFormatRead {
  const chart = selectedChart(surface, drawingNodeId);
  if (!chart) return { ok: false, reason: 'chart.errors.noChart' };
  return readChartFormatOf(chart.target);
}

const english = createT(en);

/** A translation, or the English one when the host has none for `key`. */
function translated(
  translate: ((key: string, params?: Record<string, string | number>) => string) | undefined,
  key: 'chart.sample.category' | 'chart.sample.series' | 'chart.sample.name',
  params: Record<string, string | number>
): string {
  const text = translate?.(key, params);
  return text && text !== key ? text : english(key, params);
}

/** The sample data of a new chart, with the names in the host's language. */
function localSample(
  type: ChartType,
  translate: ((key: string, params?: Record<string, string | number>) => string) | undefined
): NewChartData {
  const sample = sampleChartData(type);
  // A scatter chart's categories are X values: numbers, in any language.
  const numbered = sample.categories.every((c) => /^\d+$/.test(c));
  return {
    categories: numbered
      ? sample.categories
      : sample.categories.map((_, i) =>
          translated(translate, 'chart.sample.category', { number: i + 1 })
        ),
    series: sample.series.map((s, i) => ({
      ...s,
      name: translated(translate, 'chart.sample.series', { number: i + 1 }),
    })),
  };
}

/** A chart lane's result as a command result. */
function resultOf(
  outcome: ReturnType<PaginatedSurface['editChart']>,
  surface: PaginatedSurface
): ExecResult {
  if (outcome.ok) return { ok: true, changed: outcome.change !== null };
  const reason = outcome.detail ?? outcome.reason;
  return {
    ok: false,
    code: reason.startsWith('chart.errors.') ? 'invalidArgs' : 'unsupported',
    reason: reason || surface.state().lastRejection || 'the chart edit was refused',
  };
}

/** Insert a chart at the caret and select it. */
function insertChart(
  surface: PaginatedSurface,
  command: Extract<ChartCommand, { type: 'insertChart' }>,
  translate: ((key: string, params?: Record<string, string | number>) => string) | undefined
): ExecResult {
  if (!isChartType(command.chartType))
    return { ok: false, code: 'invalidArgs', reason: 'chart.errors.unsupportedType' };
  const { anchor, head } = surface.state().selection;
  const paragraphId = head.paragraphId;
  const paragraph = findNode(surface.session.part(), paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph')
    return { ok: false, code: 'notFound', reason: 'the caret is not in a paragraph' };
  // A range selection inserts after its end, as a picture does, and keeps the text.
  const offset =
    anchor.paragraphId === paragraphId
      ? Math.max(anchor.offset, head.offset)
      : Math.min(head.offset, paragraphLength(paragraph));
  const fragment = surface
    .layout()
    .pages.flatMap((page) => page.fragments)
    .find((f) => f.kind === 'paragraph' && f.paragraphId === paragraphId);
  const width = Math.max(72, Math.min(NEW_CHART_WIDTH, fragment?.box.width ?? NEW_CHART_WIDTH));
  const outcome = surface.insertChart({
    paragraphId,
    offset,
    chartType: command.chartType,
    data: command.data ?? localSample(command.chartType, translate),
    widthPoints: width,
    heightPoints: Math.round(width * NEW_CHART_ASPECT),
    name: translated(translate, 'chart.sample.name', { number: '{number}' }),
  });
  if (outcome.ok && outcome.drawingNodeId) surface.selectDrawing(outcome.drawingNodeId, paragraphId);
  return resultOf(outcome, surface);
}

/** Run one chart command against the surface. */
export function execChartCommand(
  surface: PaginatedSurface,
  command: ChartCommand,
  translate?: (key: string, params?: Record<string, string | number>) => string
): ExecResult {
  if (command.type === 'insertChart') return insertChart(surface, command, translate);
  const chart = selectedChart(surface, command.drawingNodeId);
  if (!chart) return { ok: false, code: 'notFound', reason: 'chart.errors.noChart' };
  const outcome = surface.editChart(chart.drawingNodeId, (pkg, target) => {
    switch (command.type) {
      case 'setChartData':
        return chartDataEdit(pkg, target, command.data);
      case 'setChartType':
        return { chartSpace: withChartType(target.chartSpace, command.chartType) };
      case 'setChartFormat':
        return { chartSpace: withChartFormat(target.chartSpace, command.format) };
      default:
        return { chartSpace: withChartColor(target.chartSpace, command.index, command.color) };
    }
  });
  return resultOf(outcome, surface);
}
