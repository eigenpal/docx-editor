/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Read-only projection of a chart drawing from its chart part.
//
// The chart lays out from the values cached in its part and paints through the vector shape
// components; every label lowers to a read-only story laid out in its own frame. A chart
// renders whole or not at all: an unsupported chart type, or one past the bounds, projects
// null and the drawing keeps its labelled placeholder.

import {
  CHART_GRAPHIC_DATA_URI,
  CHARTEX_GRAPHIC_DATA_URI,
  CHART_NAMESPACE_URI,
  findDirectChild,
  findGraphicData,
  schemaAttributeValue,
  type ChartPart,
  type ChartPartResolver,
  type ChartexPartResolver,
  type OoxmlElement,
  type ShapeSchemeColorResolver,
} from '@docx-editor.dev/core/store';
import { readChartModel } from './chart-model.ts';
import { renderChart } from './chart-render.ts';
import { chartGraphic, themeKey, type ChartProjection } from './chart-graphic.ts';
import { projectChartex } from './chartex-projection.ts';

const EMU_PER_POINT = 12_700;

export type { ChartProjection } from './chart-graphic.ts';

export interface ChartProjectionContext {
  readonly resolveChartPart?: ChartPartResolver;
  readonly resolveChartexPart?: ChartexPartResolver;
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
}

interface ChartMemo {
  readonly cx: number;
  readonly cy: number;
  readonly chartSpace: OoxmlElement;
  readonly theme: string;
  readonly result: ChartProjection | null;
}

const PROJECTIONS = new WeakMap<OoxmlElement, ChartMemo>();

/**
 * The shapes and labels of a chart drawing, or null when the drawing is not a chart, its
 * part is missing, or the chart is outside the supported set.
 *
 * Layout keys label text by story identity, so an unchanged drawing projects the same objects
 * on every pass: the memo holds one result per anchor, extent, chart part and theme.
 */
export function projectChart(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  context: ChartProjectionContext
): ChartProjection | null {
  if (extent.cx <= 0 || extent.cy <= 0) return null;
  const data = findGraphicData(anchor);
  const uri = data ? schemaAttributeValue(data.attributes, 'uri') : undefined;
  if (data && uri === CHARTEX_GRAPHIC_DATA_URI)
    return projectChartex(anchor, data, extent, context);
  if (!data || !context.resolveChartPart || uri !== CHART_GRAPHIC_DATA_URI) return null;
  const reference = findDirectChild(data.children, {
    namespaceUri: CHART_NAMESPACE_URI,
    localName: 'chart',
  });
  const part = reference ? context.resolveChartPart(reference) : null;
  if (!part) return null;
  const theme = `${themeKey(context.resolveSchemeColor)}|${part.themeFaces.major}|${part.themeFaces.minor}`;
  const memo = PROJECTIONS.get(anchor);
  if (
    memo &&
    memo.cx === extent.cx &&
    memo.cy === extent.cy &&
    memo.chartSpace === part.chartSpace &&
    memo.theme === theme
  ) {
    return memo.result;
  }
  const result = projectChartPart(part, anchor.id, extent, context);
  PROJECTIONS.set(anchor, {
    cx: extent.cx,
    cy: extent.cy,
    chartSpace: part.chartSpace,
    theme,
    result,
  });
  return result;
}

function projectChartPart(
  { chartSpace, partName, themeFaces }: ChartPart,
  anchorId: string,
  extent: Readonly<{ cx: number; cy: number }>,
  context: ChartProjectionContext
): ChartProjection | null {
  const model = readChartModel(chartSpace);
  if (!model) return null;
  const rendered = renderChart(
    model,
    extent.cx / EMU_PER_POINT,
    extent.cy / EMU_PER_POINT,
    context.resolveSchemeColor,
    themeFaces
  );
  if (!rendered) return null;
  return chartGraphic(rendered.scene, rendered.labels, anchorId, partName, extent);
}
