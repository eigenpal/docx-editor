/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Read-only projection of a chartex drawing (waterfall, funnel, histogram, ...) from its
// chartex part and the chart style parts it names. Like a classic chart it renders whole or
// not at all: a chart type outside `chartex-registry.ts`, or one past the bounds, projects
// null and the drawing keeps its labelled `chart` placeholder.

import {
  CHARTEX_NAMESPACE_URI,
  findDirectChild,
  type ChartexPart,
  type OoxmlElement,
} from '@docx-editor.dev/core/store';
import { chartGraphic, themeKey, type ChartProjection } from './chart-graphic.ts';
import type { ChartProjectionContext } from './chart-projection.ts';
import { readChartexModel } from './chartex-model.ts';
import { renderChartex } from './chartex-render.ts';

const EMU_PER_POINT = 12_700;

interface ChartexMemo {
  readonly cx: number;
  readonly cy: number;
  readonly part: ChartexPart;
  readonly theme: string;
  readonly result: ChartProjection | null;
}

const PROJECTIONS = new WeakMap<OoxmlElement, ChartexMemo>();

/**
 * The shapes and labels of the chartex chart in `graphicData`, or null. One result is kept
 * per anchor, extent, chartex part and theme, so an unchanged drawing projects the same
 * objects on every layout pass.
 */
export function projectChartex(
  anchor: OoxmlElement,
  graphicData: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  context: ChartProjectionContext
): ChartProjection | null {
  if (!context.resolveChartexPart) return null;
  const reference = findDirectChild(graphicData.children, {
    namespaceUri: CHARTEX_NAMESPACE_URI,
    localName: 'chart',
  });
  const part = reference ? context.resolveChartexPart(reference) : null;
  if (!part) return null;
  const theme = `${themeKey(context.resolveSchemeColor)}|${part.themeFaces.major}|${part.themeFaces.minor}`;
  const memo = PROJECTIONS.get(anchor);
  if (
    memo &&
    memo.cx === extent.cx &&
    memo.cy === extent.cy &&
    memo.part.chartSpace === part.chartSpace &&
    memo.part.style === part.style &&
    memo.part.colors === part.colors &&
    memo.theme === theme
  ) {
    return memo.result;
  }
  const model = readChartexModel(part.chartSpace);
  const rendered = model
    ? renderChartex(
        model,
        part,
        extent.cx / EMU_PER_POINT,
        extent.cy / EMU_PER_POINT,
        context.resolveSchemeColor,
        part.themeFaces
      )
    : null;
  const result = rendered
    ? chartGraphic(rendered.scene, rendered.labels, anchor.id, part.partName, extent)
    : null;
  PROJECTIONS.set(anchor, { cx: extent.cx, cy: extent.cy, part, theme, result });
  return result;
}
