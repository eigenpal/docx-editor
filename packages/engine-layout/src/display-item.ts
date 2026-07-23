// The positioned display-list IR (document-engine task 8.9 / design D7). One
// anchored DisplayItem[] drives every output backend (DOM, PDF, print, hit-test);
// no backend re-derives geometry. All coordinates are fixed-point integers so the
// same model + ports produce byte-identical geometry in browser, worker, and
// server. Each item carries a document anchor (paragraph id + text offset) for
// hit-testing and navigation.

export interface Anchor {
  readonly paragraphId: string;
  /** Character offset within the paragraph where this item's text begins. */
  readonly offset: number;
}

/** A positioned run of text (fixed-point coordinates). */
export interface TextItem {
  readonly type: 'text';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly anchor: Anchor;
}

export type DisplayItem = TextItem;

export interface Page {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly items: readonly DisplayItem[];
}

export interface LayoutResult {
  readonly pages: readonly Page[];
  /** Convergence status (design D6); a bounded pure layout always converges. */
  readonly status: 'converged' | 'nonConverged';
}
