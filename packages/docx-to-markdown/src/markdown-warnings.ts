import {
  forEachSemanticStory,
  forEachStoryParagraphFragment,
  type AnchoredDrawingRecord,
  type InlineDrawingRecord,
} from '@docx-editor.dev/core/layout';
import type { ExportSemanticLayout } from '@docx-editor.dev/core/export';
import type { MarkdownWarning } from './markdown-types.ts';
import { drawingKey, type MediaRendering } from './markdown-media.ts';

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
  forEachSemanticStory(layout, ({ host, page }) => {
    const warn = (drawing: InlineDrawingRecord | AnchoredDrawingRecord): void => {
      if (media?.represented.has(drawingKey(drawing))) return;
      const textbox = drawing.kind === 'anchoredDrawing' && drawing.textboxStory !== undefined;
      const code = textbox ? 'omitted-textbox' : 'omitted-drawing';
      const key = `${page.index}:${code}`;
      if (warned.has(key)) return;
      warned.add(key);
      warnings.push(
        Object.freeze({
          code,
          message: textbox
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
  return warnings.concat(media?.warnings ?? []);
}
