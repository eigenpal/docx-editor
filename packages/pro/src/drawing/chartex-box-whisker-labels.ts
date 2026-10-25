/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The value labels of one box and whisker box, as measured against reference renderings.
//
// With value labels at the right (`pos="r"`, or no position), each label starts 0.08 pt right
// of its mark and is centred on its value: the quartiles and the median at the box's right
// edge, the whisker ends at the right end of their caps, each shown inner point and outlier at
// the right of its diamond, and the mean at the right of its x mark when that shows. Labels
// that meet still show. A label at the bottom of the plot stays at most 1.1 pt below it.

import { formatChartNumber } from './chart-number-format.ts';
import {
  estimateTextWidth,
  lineHeight,
  type ChartLabel,
  type ChartTextStyle,
} from './chart-text.ts';

/** From a mark's right edge to its label's text. */
const LABEL_GAP = 0.08;
/** A label's frame ends at most this far below the plot. */
const BOTTOM_REACH = 1.1;

/** Where one box's marks sit, in chart points. */
export interface BoxMarks {
  /** The box's right edge, and the right ends of the whisker caps. */
  readonly boxRight: number;
  readonly capRight: number;
  /** The centre line of the box, where points and the mean mark sit. */
  readonly center: number;
  readonly pointHalf: number;
  readonly meanHalf: number;
}

/** The values one box labels, by the mark they sit beside. */
export interface BoxLabelValues {
  readonly box: readonly number[];
  readonly whiskers: readonly number[];
  readonly points: readonly number[];
  readonly mean: number | null;
}

/** Whether labels at `position` are drawn: at the right, or with no position. */
export function boxLabelsDrawn(position: string | null): boolean {
  return position === null || position === 'r';
}

/** The labels of one box: each value's text right of its mark, centred on the value. */
export function boxWhiskerLabels(
  values: BoxLabelValues,
  marks: BoxMarks,
  at: (value: number) => number,
  plotBottom: number,
  style: ChartTextStyle,
  formatCode: string | null
): ChartLabel[] {
  const height = lineHeight(style);
  const labels: ChartLabel[] = [];
  const add = (value: number, anchor: number) => {
    const text = formatChartNumber(value, formatCode);
    const y = Math.min(at(value) - height / 2, plotBottom + BOTTOM_REACH - height);
    labels.push({
      paragraphs: [[{ text, style }]],
      align: 'l',
      x: anchor + LABEL_GAP,
      y,
      width: estimateTextWidth(text, style) * 1.3 + style.sizePt * 2,
      height,
      rotation: 0,
    });
  };
  for (const value of values.whiskers) add(value, marks.capRight);
  for (const value of values.box) add(value, marks.boxRight);
  for (const value of values.points) add(value, marks.center + marks.pointHalf);
  if (values.mean !== null) add(values.mean, marks.center + marks.meanHalf);
  return labels;
}
