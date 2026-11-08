// The chart lanes of the package store: insert a chart (`insertChart`), and edit the chart
// part behind a chart drawing (`setChartData`, `setChartType`, `setChartFormat`,
// `setChartColor`). Each is ONE package undo unit. An insert writes the chart part, its
// embedded workbook, both relationships, and the drawing; an edit writes the chart part and,
// for a data edit, the workbook. Layout keys chart drawings on the chart part's root, so an
// edit of the part alone lays the chart out again.

import type { StoryScope, TreePackageStore } from './tree-package-store.ts';
import {
  transactPackageImage,
  type ImageIntentResult,
  type ImageTransactOptions,
} from './tree-package-images.ts';
import { findNode } from '../package/ooxml-edit.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { allocateDrawingPropertyId } from '../package/drawing-package-edit.ts';
import { chartDrawingOf } from './tree-op-chart-drawing.ts';
import { chartTargetOf, type ChartEdit, type ChartTarget } from '../package/chart-edit/data.ts';
import {
  buildInlineChartDrawing,
  withChartSpace,
  withChartWorkbook,
  withNewChart,
} from '../package/chart-edit/package.ts';
import { ChartRefusal } from '../package/chart-edit/tree.ts';
import type { ChartType, NewChartData } from '../package/chart-edit/types.ts';

/** The result of a chart lane: the store's result, or a chart refusal key. */
export type ChartIntentResult =
  ImageIntentResult | { readonly ok: false; readonly reason: 'chart'; readonly detail: string };

/** A chart insert at one place in a story. */
export interface InsertChartInput {
  readonly paragraphId: string;
  readonly offset: number;
  readonly chartType: ChartType;
  readonly data?: NewChartData;
  readonly widthPoints: number;
  readonly heightPoints: number;
  /** The `wp:docPr` name, such as `Chart 1`. */
  readonly name: string;
  readonly expectedPackageRevision?: number;
  readonly actorId?: string;
}

const refused = (error: unknown): ChartIntentResult | null =>
  error instanceof ChartRefusal ? { ok: false, reason: 'chart', detail: error.reason } : null;

/** Insert a new chart with an embedded workbook, as one package undo unit. */
export function insertChart(
  store: TreePackageStore,
  scope: StoryScope,
  input: InsertChartInput
): ChartIntentResult {
  let refusal: ChartIntentResult | null = null;
  const options: ImageTransactOptions = {
    ...(input.expectedPackageRevision !== undefined
      ? { expectedPackageRevision: input.expectedPackageRevision }
      : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
  };
  const outcome = transactPackageImage(
    store,
    scope,
    (ctx, owner) => {
      try {
        const added = withNewChart(
          store.currentPackage(),
          owner,
          input.chartType,
          input.data,
          input.actorId
        );
        const docPr = allocateDrawingPropertyId(added.pkg);
        if (!docPr.ok) return null;
        if (!ctx.applyPackage(() => added.pkg)) return null;
        const drawing = buildInlineChartDrawing({
          docPrId: docPr.id,
          relationshipId: added.relationshipId,
          name: input.name.replaceAll('{number}', String(docPr.id)),
          widthPoints: input.widthPoints,
          heightPoints: input.heightPoints,
        });
        if (
          !ctx.apply({
            op: 'insertDrawing',
            paragraphId: input.paragraphId,
            offset: input.offset,
            drawing,
          })
        )
          return null;
        return drawing.id;
      } catch (error) {
        refusal = refused(error);
        if (refusal) return null;
        throw error;
      }
    },
    options
  );
  return refusal ?? outcome;
}

/** The chart part behind the chart drawing `drawingNodeId` of a story, or null. */
export function chartTargetIn(
  pkg: OoxmlPackage,
  ownerPart: string,
  drawingNodeId: string
): ChartTarget | null {
  const part = pkg.parts.get(ownerPart);
  if (!part) return null;
  const chart = chartDrawingOf(part, drawingNodeId);
  const drawing = chart ? chart.chartDrawing : findNode(part, drawingNodeId);
  return drawing ? chartTargetOf(pkg, ownerPart, drawing) : null;
}

/** Edit the chart part behind a chart drawing, as one package undo unit. */
export function editChart(
  store: TreePackageStore,
  scope: StoryScope,
  drawingNodeId: string,
  edit: (pkg: OoxmlPackage, target: ChartTarget) => ChartEdit,
  options?: { readonly actorId?: string }
): ChartIntentResult {
  let refusal: ChartIntentResult | null = null;
  const outcome = transactPackageImage(
    store,
    scope,
    (ctx, owner) => {
      try {
        const pkg = store.currentPackage();
        const target = chartTargetIn(pkg, owner, drawingNodeId);
        if (!target) throw new ChartRefusal('chart.errors.noChart');
        const change = edit(pkg, target);
        let next = withChartSpace(pkg, target.part, change.chartSpace);
        if (change.workbook)
          next = withChartWorkbook(next, change.workbook.part, change.workbook.bytes);
        if (!ctx.applyPackage(() => next)) return null;
        return drawingNodeId;
      } catch (error) {
        refusal = refused(error);
        if (refusal) return null;
        throw error;
      }
    },
    options?.actorId ? { actorId: options.actorId } : undefined
  );
  return refusal ?? outcome;
}

/** The chart lanes of one package store, as the editor session hands them on. */
export interface ChartLanes {
  insert(scope: StoryScope, input: InsertChartInput): ChartIntentResult;
  edit(
    scope: StoryScope,
    drawingNodeId: string,
    edit: (pkg: OoxmlPackage, target: ChartTarget) => ChartEdit,
    options?: { readonly actorId?: string }
  ): ChartIntentResult;
}

/** The chart lanes over `store`. */
export const chartLanesFor = (store: TreePackageStore): ChartLanes => ({
  insert: (scope, input) => insertChart(store, scope, input),
  edit: (scope, drawingNodeId, edit, options) =>
    editChart(store, scope, drawingNodeId, edit, options),
});
