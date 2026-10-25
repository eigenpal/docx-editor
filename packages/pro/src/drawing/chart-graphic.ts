/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The projection of a painted chart, classic or chartex: its scene's vector components over
// the drawing extent, and its labels as read-only stories.

import {
  shapeThemeCacheToken,
  type GroupTextboxProjection,
  type ShapeSchemeColorResolver,
  type VectorShapeProjection,
} from '@docx-editor.dev/core/store';
import type { ChartScene } from './chart-scene.ts';
import { chartLabelTextbox, type ChartLabel } from './chart-text.ts';

/** Labels one chart may set; past it the chart does not render. */
const MAX_LABELS = 4_096;

export interface ChartProjection {
  readonly vectorShape: VectorShapeProjection | null;
  readonly groupTextboxes: readonly GroupTextboxProjection[] | null;
}

const SCHEME_SLOTS = ['dk1', 'lt1', 'dk2', 'lt2', 'tx1', 'bg1', 'tx2', 'bg2'] as const;

/** What the theme contributes to a chart: its scheme colours. */
export function themeKey(resolveSchemeColor?: ShapeSchemeColorResolver): string {
  if (!resolveSchemeColor) return '';
  const token = shapeThemeCacheToken(resolveSchemeColor);
  if (token !== undefined) return token;
  const slots = [...SCHEME_SLOTS, 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
  return slots.map((slot) => resolveSchemeColor(slot) ?? '').join(',');
}

/**
 * The projection of a painted chart scene and its labels; null past the label bound. Every
 * label lowers to a read-only story with an id from the anchor and its order.
 */
export function chartGraphic(
  scene: ChartScene,
  labels: readonly ChartLabel[],
  anchorId: string,
  partName: string,
  extent: Readonly<{ cx: number; cy: number }>
): ChartProjection | null {
  if (labels.length > MAX_LABELS) return null;
  const texts: GroupTextboxProjection[] = [];
  for (const [index, label] of labels.entries()) {
    const textbox = chartLabelTextbox(label, `${anchorId}#chart-label:${index}`, partName);
    if (textbox) texts.push(textbox);
  }
  const components = scene.components;
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
