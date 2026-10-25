// A plain-text summary of a chart drawing: its title and plot types, read from the chart part.
// A placeholder that stands in for an unpainted chart shows it, and a host component that
// replaces the placeholder can show it too. Chart text is file-derived, so the title is
// bounded and never parsed as markup.

import { CHART_NAMESPACE_URI, type ChartPartResolver } from './chart-parts.ts';
import { findGraphicData } from './drawing-group-frame.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

const DRAWINGML_MAIN = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const MAX_TITLE_UNITS = 200;
const MAX_PLOT_TYPES = 8;
const MAX_TITLE_NODES = 2000;

/**
 * The title and plot types of a chart, as text.
 *
 * @public
 */
export interface DrawingChartSummary {
  /** The chart title as plain text, or null when the chart has no typed title. */
  readonly title: string | null;
  /**
   * The chart's plot types in document order, named by their element without the `Chart`
   * suffix: `bar`, `line`, `pie`, `bar3D`, `scatter`, and so on.
   */
  readonly plotTypes: readonly string[];
}

function chartChild(element: OoxmlElement, localName: string): OoxmlElement | null {
  for (const child of element.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === CHART_NAMESPACE_URI && child.localName === localName) return child;
  }
  return null;
}

/** The `a:t` text under a title, depth-first, bounded in nodes and length. */
function titleText(title: OoxmlElement): string | null {
  let text = '';
  let visited = 0;
  const stack: OoxmlNode[] = [title];
  while (stack.length > 0 && visited < MAX_TITLE_NODES && text.length < MAX_TITLE_UNITS) {
    const node = stack.pop()!;
    visited += 1;
    if (node.kind === 'textValue') continue;
    if (node.namespaceUri === DRAWINGML_MAIN && node.localName === 't') {
      for (const child of node.children) if (child.kind === 'textValue') text += child.value;
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]!);
    }
  }
  const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_UNITS);
  return trimmed.length > 0 ? trimmed : null;
}

/** The summary of the chart behind a drawing anchor, or null when it holds no chart part. */
export function readChartSummary(
  anchor: OoxmlElement,
  resolveChartPart: ChartPartResolver | undefined
): DrawingChartSummary | null {
  if (!resolveChartPart) return null;
  const data = findGraphicData(anchor);
  const reference = data ? chartChild(data, 'chart') : null;
  const part = reference ? resolveChartPart(reference) : null;
  const chart = part ? chartChild(part.chartSpace, 'chart') : null;
  if (!chart) return null;
  const title = chartChild(chart, 'title');
  const plotArea = chartChild(chart, 'plotArea');
  const plotTypes: string[] = [];
  for (const child of plotArea?.children ?? []) {
    if (plotTypes.length >= MAX_PLOT_TYPES) break;
    if (child.kind === 'textValue' || child.namespaceUri !== CHART_NAMESPACE_URI) continue;
    if (child.localName.endsWith('Chart') && child.localName.length > 5) {
      plotTypes.push(child.localName.slice(0, -5));
    }
  }
  return Object.freeze({
    title: title ? titleText(title) : null,
    plotTypes: Object.freeze(plotTypes),
  });
}
