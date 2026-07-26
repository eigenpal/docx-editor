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

/** Layout-stable identity for one visual line fragment (task 5.5). */
export interface VisualLineIdentity {
  readonly lineId: string;
  readonly fragmentId: string;
  readonly lineIndex: number;
  readonly fragmentIndex: number;
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
  readonly line: VisualLineIdentity;
}

/** Exact caret edge measured during layout for whitespace or slice boundaries (task 5.5). */
export interface CaretEdgeItem {
  readonly type: 'caretEdge';
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly paragraphId: string;
  readonly graphemeOffset: number;
  readonly affinity: 'upstream' | 'downstream';
  readonly line: VisualLineIdentity;
  /** Geometry-trusted for vertical/page/caret overlay (cumulative advance proof). */
  readonly navigable: boolean;
  /** Whole-grapheme horizontal boundary for semantic hit/word/ArrowLeft/Right. */
  readonly horizontalNavigable: boolean;
  readonly shaping: 'per-grapheme-advance' | 'unsupported';
  /** UTF-16 offset in the paragraph at this caret edge — exact paint-slice provenance. */
  readonly utf16Offset: number;
}

/** A positioned rectangle — a table/cell border box and/or a shading fill. Backends
 *  stroke the border when `stroke` is set and paint `fill` (hex 'RRGGBB') behind it. */
export interface RectItem {
  readonly type: 'rect';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly stroke?: boolean;
  readonly fill?: string;
}

export type DisplayItem = TextItem | CaretEdgeItem | RectItem;

export interface Page {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  /** The laid-out text area: the page box inset by the section margin. Published so the
   *  rulers can draw their margin zones from what the engine ACTUALLY laid out rather
   *  than from a guessed default. The engine's margin is uniform on all four sides today,
   *  while Word carries four independent values — this is the former, and must not be
   *  presented as per-side fidelity it does not have. */
  readonly contentBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly items: readonly DisplayItem[];
}

export interface LayoutResult {
  readonly pages: readonly Page[];
  /** Convergence status (design D6); a bounded pure layout always converges. */
  readonly status: 'converged' | 'nonConverged';
}
