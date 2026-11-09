// Paragraph text for hosts that compute their own ranges: the read half of `setHighlights()`.

/** A run of characters in a paragraph's text. @public */
export interface TextSpan {
  /** UTF-16 offset of the first character. */
  readonly start: number;
  /** Number of UTF-16 code units. */
  readonly length: number;
}

/**
 * One paragraph's text in the offsets that `findMatches()` returns and `setHighlights()` takes.
 * A range computed from `text` passes to `setHighlights()` without conversion. @public
 */
export interface ParagraphText {
  /** The paragraph: `HighlightRange.blockId`. IDs belong to the open document. */
  readonly blockId: string;
  /** Model text. Tracked deletions are included, and a field counts as one character. */
  readonly text: string;
  /** Tracked deletions in `text`, in order. Skip them to read the text the document keeps. */
  readonly deletions: readonly TextSpan[];
}

/** Read paragraph text to compute your own highlight ranges, such as spelling marks. @public */
export interface EditorParagraphText {
  /**
   * One paragraph's text, or `null` when the open document has no paragraph with that id.
   *
   * @example
   * ```ts
   * const paragraph = editor.getParagraphText(match.blockId);
   * ```
   * @public
   */
  getParagraphText(blockId: string): ParagraphText | null;
  /**
   * The text of each paragraph on the painted pages, in page order.
   *
   * The editor paints only the pages near the viewport, so the result changes as the reader
   * scrolls. Read it again after a `change` event and after the painted pages change. Body
   * text, tables, headers, footers, notes, and anchored text boxes are included.
   *
   * @example
   * ```ts
   * for (const { blockId, text } of editor.getPaintedParagraphs()) check(blockId, text);
   * ```
   * @public
   */
  getPaintedParagraphs(): readonly ParagraphText[];
}
