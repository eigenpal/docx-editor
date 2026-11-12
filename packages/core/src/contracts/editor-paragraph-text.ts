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
  /**
   * Model text in the editor's configured `fieldResults` offsets, including tracked deletions.
   * Pass slices of it as `HighlightRange.expectedText`. It holds placeholder characters, such as
   * U+FFFC for a field, so check `keptText` instead.
   */
  readonly text: string;
  /**
   * The text a reader sees, for spelling and grammar checks. Tracked deletions, move-from
   * revisions and optional hyphens are left out. Insertions and hidden text are included.
   * A non-breaking hyphen reads as U+2011 and a symbol character reads as U+FFFC.
   */
  readonly keptText: string;
  /**
   * Ordered spans mapping `keptText` to `text`. Each span has the same length in both texts.
   * A range that crosses a gap between spans needs one highlight per span.
   */
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
   * Read again after a `change` event. An unchanged paragraph returns the same object, so an
   * object you have already checked needs no new check.
   * @public
   */
  getParagraphs(): readonly ParagraphText[];
}
