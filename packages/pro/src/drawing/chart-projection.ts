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
  CHART_NAMESPACE_URI,
  findDirectChild,
  findGraphicData,
  schemaAttributeValue,
  shapeThemeCacheToken,
  type ChartPart,
  type ChartPartResolver,
  type GroupTextboxProjection,
  type OoxmlElement,
  type ShapeSchemeColorResolver,
  type VectorShapeProjection,
} from '@docx-editor.dev/core/store';
import { readChartModel } from './chart-model.ts';
import { renderChart } from './chart-render.ts';
import { chartLabelTextbox } from './chart-text.ts';

const EMU_PER_POINT = 12_700;
/** Labels one chart may set; past it the chart does not render. */
const MAX_LABELS = 4_096;

export interface ChartProjection {
  readonly vectorShape: VectorShapeProjection | null;
  readonly groupTextboxes: readonly GroupTextboxProjection[] | null;
}

export interface ChartProjectionContext {
  readonly resolveChartPart?: ChartPartResolver;
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
}

const SCHEME_SLOTS = ['dk1', 'lt1', 'dk2', 'lt2', 'tx1', 'bg1', 'tx2', 'bg2'] as const;

/** What the theme contributes to a chart: its scheme colours. */
function themeKey(resolveSchemeColor?: ShapeSchemeColorResolver): string {
  if (!resolveSchemeColor) return '';
  const token = shapeThemeCacheToken(resolveSchemeColor);
  if (token !== undefined) return token;
  const slots = [...SCHEME_SLOTS, 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
  return slots.map((slot) => resolveSchemeColor(slot) ?? '').join(',');
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
  if (!context.resolveChartPart || extent.cx <= 0 || extent.cy <= 0) return null;
  const data = findGraphicData(anchor);
  if (!data || schemaAttributeValue(data.attributes, 'uri') !== CHART_GRAPHIC_DATA_URI) return null;
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
  if (!rendered || rendered.labels.length > MAX_LABELS) return null;
  const texts: GroupTextboxProjection[] = [];
  for (const [index, label] of rendered.labels.entries()) {
    const textbox = chartLabelTextbox(label, `${anchorId}#chart-label:${index}`, partName);
    if (textbox) texts.push(textbox);
  }
  const components = rendered.scene.components;
  const subpathsEmu: (readonly Readonly<{ x: number; y: number }>[])[] = [];
  for (const component of components) {
    for (const path of component.subpathsEmu) subpathsEmu.push(path);
  }
  return Object.freeze({
    vectorShape: components.length
      ? Object.freeze({
          extentEmu: Object.freeze({ cx: extent.cx, cy: extent.cy }),
          subpathsEmu,
          fillHex: null,
          fillAlpha: 1,
          strokeHex: null,
          strokeAlpha: 1,
          strokeWidthEmu: 0,
          components,
        })
      : null,
    groupTextboxes: texts.length ? Object.freeze(texts) : null,
  });
}
