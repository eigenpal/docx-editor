// Small body-flow policies extracted from the story loop.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import {
  anchoredDrawingAtomsInParagraph,
  type DrawingAnchorFrameContext,
} from './drawing-layout.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { PendingLine } from './paragraph-flow.ts';
import type { ParagraphBorders } from './paragraph-style.ts';

type BodyAnchorFrameBase = Omit<
  DrawingAnchorFrameContext,
  'paragraphBox' | 'anchorLineBox' | 'anchorCharacterX' | 'columnBox' | 'cellBox' | 'layoutInCell'
>;

interface BodyAnchorFrameInput {
  readonly pageNumber: number;
  readonly onPageParityRead: () => void;
  readonly geometry: {
    readonly width: number;
    readonly height: number;
    readonly margin: { readonly left: number; readonly right: number; readonly bottom: number };
  };
  readonly insets: { readonly top: number; readonly bottom: number; readonly height: number };
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly ownerPartName: string;
}

/** Build the drawing/table anchor facts for the current body sheet. */
export function bodyAnchorFrameBase(input: BodyAnchorFrameInput): BodyAnchorFrameBase {
  const { geometry, insets } = input;
  return Object.freeze({
    pageNumber: input.pageNumber,
    onPageParityRead: input.onPageParityRead,
    pageWidth: geometry.width,
    pageHeight: geometry.height,
    marginLeft: geometry.margin.left,
    marginRight: geometry.margin.right,
    marginBottom: geometry.margin.bottom,
    // Effective insets keep page-relative anchors stable when tall furniture moves body text.
    contentInsetTop: insets.top,
    contentInsetBottom: insets.bottom,
    contentWidth: input.contentWidth,
    contentHeight: input.contentHeight,
    contentBandHeight: insets.height,
    ownerPartName: input.ownerPartName,
    storyKind: 'body',
  });
}

interface PaintableParagraph {
  readonly paragraph: OoxmlElement;
  readonly listItem?: unknown;
  readonly shading: string | undefined;
  readonly borders: ParagraphBorders;
}

/** Whether a section-mark paragraph contributes no visible sheet content. */
export function paragraphPaintsNothing(
  entry: PaintableParagraph,
  lines: readonly PendingLine[],
  drawingContext: InlineDrawingLayoutContext | undefined
): boolean {
  return entry.shading === undefined && paragraphHoldsNothing(entry, lines, drawingContext);
}

/**
 * Whether a paragraph holds nothing but its mark: no text, list marker, drawing, break, or
 * border rule. Shading is not content: it only fills the box the paragraph occupies.
 */
export function paragraphHoldsNothing(
  entry: PaintableParagraph,
  lines: readonly PendingLine[],
  drawingContext: InlineDrawingLayoutContext | undefined
): boolean {
  if (entry.listItem !== undefined) return false;
  const { top, bottom, left, right, between, bar } = entry.borders;
  if (top ?? bottom ?? left ?? right ?? between ?? bar) return false;
  if (
    drawingContext &&
    anchoredDrawingAtomsInParagraph(entry.paragraph, drawingContext).length > 0
  ) {
    return false;
  }
  return lines.every(
    (line) =>
      line.drawings.length === 0 &&
      !line.pageBreakAfter &&
      !line.columnBreakAfter &&
      line.spans.every((span) => span.text.length === 0)
  );
}

/** Whether a line holds text or a picture, not just break characters. */
const lineHoldsContent = (line: PendingLine): boolean =>
  line.drawings.length > 0 || line.spans.some((span) => /[^\f\n]/.test(span.text));

/**
 * Whether a paragraph opens with a page break and has content after it: its first line holds
 * nothing but the break. That line never takes a sheet of its own. It stays at the bottom of
 * the page it starts on, and the break then starts the content on the next sheet.
 *
 * A list marker, border, shading, or anchored drawing is content on the first line, so those
 * paragraphs keep the ordinary fit rule. So does a paragraph with nothing after the break.
 * Layout also keeps that rule when the paragraph anchors floating tables or text frames.
 */
export function opensWithPageBreak(
  entry: PaintableParagraph,
  lines: readonly PendingLine[],
  drawingContext: InlineDrawingLayoutContext | undefined
): boolean {
  const first = lines[0];
  return (
    first !== undefined &&
    first.start === 0 &&
    first.pageBreakAfter === true &&
    !lineHoldsContent(first) &&
    lines.some((line, index) => index > 0 && lineHoldsContent(line)) &&
    paragraphPaintsNothing(entry, [], drawingContext)
  );
}
