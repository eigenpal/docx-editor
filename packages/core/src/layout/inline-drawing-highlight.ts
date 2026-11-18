import type { ParagraphLineSpacing } from './paragraph-style.ts';
import type { PendingLine } from './pending-line.ts';

/** Publish the authored text highlight band beside an inline drawing. */
export function setInlineDrawingHighlightHeight(
  line: PendingLine,
  lineSpacing: ParagraphLineSpacing,
  naturalHeight: number
): void {
  if (
    line.drawings.length > 0 &&
    lineSpacing.rule !== 'atLeast' &&
    line.spans.some((span) => span.style.highlight && span.style.highlight !== 'none')
  ) {
    // The picture raises the baseline for adjacent text, but the highlight starts
    // at the line top. A snapped grid contributes the leading above the natural
    // content; the trailing half remains clear. Exact spacing uses the authored box.
    const gridLeading =
      lineSpacing.gridPitch === undefined ? 0 : Math.max(0, (line.height - naturalHeight) / 2);
    line.inlineDrawingHighlightHeight =
      lineSpacing.rule === 'exact'
        ? line.height
        : Math.min(line.height, naturalHeight + gridLeading);
  }
}
