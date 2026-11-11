/** A continuous kept-text span mapped to model offsets. @public */
export interface ParagraphTextSpan {
  /** UTF-16 offset in `ParagraphText.text`. */
  readonly start: number;
  /** Number of UTF-16 code units in both texts. */
  readonly length: number;
  /** UTF-16 offset in `ParagraphText.keptText`. */
  readonly keptStart: number;
}

/** Immutable paragraph text and offsets for `setHighlights()`. @public */
export interface ParagraphText {
  /** The paragraph's `HighlightRange.blockId`, scoped to the open document. */
  readonly blockId: string;
  /** Model text, including tracked deletions, in the editor's configured `fieldResults` offsets. */
  readonly text: string;
  /** Text without tracked deletions or move-from revisions. Insertions are included. */
  readonly keptText: string;
  /** Ordered spans mapping `keptText` to `text`. Split ranges at gaps to avoid marking deleted text. */
  readonly keptSpans: readonly ParagraphTextSpan[];
}

/** Read paragraph text to compute highlight ranges, such as spelling marks. @public */
export interface EditorParagraphText {
  /**
   * One paragraph's text, or `null` if the open document has no paragraph with that id.
   * Returns the same object while the underlying paragraph node is unchanged.
   * @public
   */
  getParagraphText(blockId: string): ParagraphText | null;
  /**
   * Paragraphs across document stories, including pages that have not been painted.
   * Includes body text, tables, content controls, headers, footers, notes and supported text boxes.
   * Body comes first, then other story parts; paragraphs follow model order within each story.
   * Text-box paragraphs follow their host paragraph. Repeated headers and footers appear once.
   * Read again after a `change` event. Unchanged paragraph nodes retain their result objects.
   * @public
   */
  getParagraphs(): readonly ParagraphText[];
}
