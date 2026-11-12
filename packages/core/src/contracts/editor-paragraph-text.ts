/** A continuous kept-text span mapped to model offsets. @public */
export interface ParagraphTextSpan {
  /** UTF-16 offset in `ParagraphText.text`. */
  readonly start: number;
  /** Number of UTF-16 code units in both texts. */
  readonly length: number;
  /** UTF-16 offset in `ParagraphText.keptText`. */
  readonly keptStart: number;
}

/**
 * Proofing settings of a continuous stretch of `ParagraphText.keptText`. Check the text in
 * `lang`, and skip it when `noProof` is true. @public
 */
export interface ParagraphTextProofing {
  /** UTF-16 offset in `ParagraphText.keptText`. */
  readonly keptStart: number;
  /** Number of UTF-16 code units. */
  readonly length: number;
  /**
   * The language tag the document sets for this text, such as `en-GB`, or `null` when the
   * document sets none. Right-to-left and complex-script text uses its complex-script tag.
   */
  readonly lang: string | null;
  /** True when the document asks proofing tools to skip this text (`w:noProof`). */
  readonly noProof: boolean;
}

/** Immutable paragraph text and offsets for `setHighlights()`. @public */
export interface ParagraphText {
  /** The paragraph's `HighlightRange.blockId`, scoped to the open document. */
  readonly blockId: string;
  /**
   * Model text in the editor's configured `fieldResults` offsets, including tracked deletions
   * and hidden text. Highlight offsets count in this text. Check `keptText`, not this text.
   */
  readonly text: string;
  /**
   * The text a reader sees, for spelling and grammar checks. Tracked deletions, move-from
   * revisions, hidden text (`w:vanish`) and optional hyphens are left out. Insertions are
   * included. A non-breaking hyphen reads as U+2011. An object, such as a field (unless
   * `fieldResults` is `'editable'`), a picture, a note reference or a symbol, reads as U+FFFC,
   * so treat U+FFFC as a word boundary.
   */
  readonly keptText: string;
  /**
   * Ordered spans mapping `keptText` to `text`. Each span has the same length in both texts.
   * A range that crosses a gap between spans needs one highlight per span. To convert a
   * `keptText` range, call `keptTextRanges()`.
   */
  readonly keptSpans: readonly ParagraphTextSpan[];
  /** Ordered stretches that cover all of `keptText`, with their language and proofing flag. */
  readonly proofing: readonly ParagraphTextProofing[];
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
