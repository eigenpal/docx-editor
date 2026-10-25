import {
  forEachSemanticStory,
  forEachStoryParagraphFragment,
  type AnchoredDrawingRecord,
  type InlineDrawingRecord,
} from '@docx-editor.dev/core/layout';
import type { ExportSemanticLayout } from '@docx-editor.dev/core/export';
import type { MarkdownWarning } from './markdown-types.ts';
import { drawingKey, exportedResource, type MediaRendering } from './markdown-media.ts';

type Drawing = InlineDrawingRecord | AnchoredDrawingRecord;

/**
 * Chart warnings per page. A page past this many omitted charts gets one more warning that
 * counts the rest, so a long chart appendix cannot flood the warning list.
 */
export const MAX_CHART_WARNINGS_PER_PAGE = 5;

/** Why Markdown leaves out one chart, as a sentence. */
function chartOmission(drawing: Drawing, media: MediaRendering | undefined): string {
  const chart = drawing.chart!;
  const name = chart.title ? `The chart "${chart.title}"` : 'A chart';
  const resource = exportedResource(drawing);
  if (!media && resource) {
    return `${name} is omitted from Markdown because image export is off.`;
  }
  if (!resource) {
    return chart.shownAs === 'fallback'
      ? `${name} is omitted from Markdown because its saved fallback is not a picture.`
      : `${name} is omitted from Markdown because it has no saved fallback picture.`;
  }
  if (resource.kind !== 'ready') {
    return `${name} is omitted from Markdown because its saved fallback picture could not be read (${resource.kind}).`;
  }
  return `${name} is omitted from Markdown.`;
}

export function markdownWarnings(
  layout: ExportSemanticLayout,
  media?: MediaRendering
): MarkdownWarning[] {
  const warnings: MarkdownWarning[] =
    layout.contentWarnings?.map((warning) =>
      Object.freeze({
        code:
          warning.code === 'legacy-textbox'
            ? ('omitted-textbox' as const)
            : warning.code === 'legacy-drawing'
              ? ('omitted-drawing' as const)
              : ('content-scan-limit' as const),
        partName: warning.partName,
        message:
          warning.code === 'legacy-textbox'
            ? `Legacy text box content in ${warning.partName} may be omitted from Markdown.`
            : warning.code === 'legacy-drawing'
              ? media
                ? `Some legacy drawing content in ${warning.partName} could not be represented by layout and may be omitted from Markdown.`
                : `Legacy images or shapes in ${warning.partName} are omitted from Markdown and may affect page breaks.`
              : `Content checks stopped at the scan limit in ${warning.partName}.`,
      })
    ) ?? [];
  const warned = new Set<string>();
  const chartsByPage = new Map<number, number>();
  forEachSemanticStory(layout, ({ host, page }) => {
    const warn = (drawing: Drawing): void => {
      // A hidden record (an MC wrap footprint) has no content to omit.
      if (drawing.accessibility.hidden || media?.represented.has(drawingKey(drawing))) return;
      const textbox = drawing.textboxStory !== undefined;
      const code = textbox ? 'omitted-textbox' : 'omitted-drawing';
      // Each omitted chart gets its own warning that says why, up to a cap per page.
      const chart = textbox ? undefined : drawing.chart;
      const key = chart ? `${page.index}:chart:${drawing.drawingNodeId}` : `${page.index}:${code}`;
      if (warned.has(key)) return;
      warned.add(key);
      if (chart) {
        const count = (chartsByPage.get(page.index) ?? 0) + 1;
        chartsByPage.set(page.index, count);
        if (count > MAX_CHART_WARNINGS_PER_PAGE) return;
      }
      warnings.push(
        Object.freeze({
          code,
          message: chart
            ? chartOmission(drawing, media)
            : textbox
              ? 'Text box content is omitted from Markdown.'
              : 'Images and shapes are omitted from Markdown.',
          pageNumber: page.index + 1,
        })
      );
    };
    if ('anchoredDrawings' in host)
      for (const drawing of host.anchoredDrawings ?? []) warn(drawing);
    forEachStoryParagraphFragment(host, (paragraph, context) => {
      if (context.textboxDepth > 0) return;
      for (const line of paragraph.lines) for (const drawing of line.drawings ?? []) warn(drawing);
    });
  });
  for (const [pageIndex, count] of chartsByPage) {
    const rest = count - MAX_CHART_WARNINGS_PER_PAGE;
    if (rest <= 0) continue;
    warnings.push(
      Object.freeze({
        code: 'omitted-drawing' as const,
        message: `${rest} more ${rest === 1 ? 'chart is' : 'charts are'} omitted from Markdown on this page.`,
        pageNumber: pageIndex + 1,
      })
    );
  }
  return warnings.concat(media?.warnings ?? []);
}
