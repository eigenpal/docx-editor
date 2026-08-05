/** Options forwarded to paragraph flash highlighting during scroll. */
export interface ParagraphHighlightOptions {
  readonly color?: string;
  readonly durationMs?: number;
}

/** Options for scrolling to a paragraph by paraId. */
export interface ScrollToParaIdOptions {
  readonly highlight?: ParagraphHighlightOptions;
}
