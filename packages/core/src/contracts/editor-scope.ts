/** The engine-owned identity of one gesture. Create it with `Editor.beginHistoryGroup()`. @public */
declare const historyGroupBrand: unique symbol;
export interface HistoryGroup {
  readonly [historyGroupBrand]: true;
  /** Closed after `end()`, document replacement, detach, or destruction. */
  readonly state: 'open' | 'closed';
  /** End this gesture without reverting any edits. Safe to call more than once. */
  end(): void;
}

/** The history authority's result for this frame. @public */
export interface HistoryGroupOutcome {
  readonly kind: 'started' | 'extended' | 'split' | 'none';
  readonly reason?:
    | 'history-boundary'
    | 'undo-redo'
    | 'no-history'
    | 'package-unit'
    | 'composition';
}

/**
 * The editor is N+1 editing views: one body plus one per header/footer relationship, plus
 * footnotes, text boxes, and other addressable regions. Commands must name their target.
 *
 * This set is open-ended. Treat it as non-exhaustive as more regions become addressable.
 */
export type EditorScope =
  | { kind: 'body' }
  | { kind: 'headerFooter'; rId: string }
  /**
   * A footnote/endnote region.
   *
   * `id` encodes kind and signed note id as `footnote:<id>` or `endnote:<id>`. Use
   * `formatNoteScopeId` or `parseNoteScopeId` from the store package.
   */
  | { kind: 'note'; id: string }
  | {
      /**
       * A text box or floating frame with its own content.
       *
       * Addressing one takes the drawing that hosts it as well as the story root: a frame is
       * reached THROUGH its drawing, and nothing can reveal or select it from `id` alone.
       */
      kind: 'frame';
      id: string;
      /** The drawing that hosts this frame. */
      drawingNodeId: string;
      /** The paragraph that anchors that drawing. */
      hostParagraphId: string;
      /** Furniture or note story that owns this frame. Absence means the body story. */
      owner?: { kind: 'headerFooter'; rId: string } | { kind: 'note'; id: string };
    }
  /** Read-only aggregate across every view. Valid for queries, not for writes. */
  | { kind: 'all' };

/** A concrete editing view. */
export type ViewScope = Exclude<EditorScope, { kind: 'all' }>;

/** Options for a command's editing view and explicit gesture. @public */
export interface EditorExecOptions {
  /** Omitted, the command addresses the current selection. */
  readonly scope?: EditorScope;
  /**
   * An open handle from this editor. Supported for synchronous formatting commands.
   * Intervening writes and undo/redo can split a gesture; inspect `ExecResult.history`.
   * Read-only commands do not close a gesture. Ungrouped collaboration uses timed capture.
   * See the core history grouping guide for gesture bindings and boundary rules.
   */
  readonly historyGroup?: HistoryGroup;
}

/** Optional diagnostic notification; subscribing does not change history behavior. @public */
export interface HistoryDiagnostic {
  readonly kind: 'split' | 'possible-ungrouped-gesture' | 'possible-fragmented-gesture';
  readonly reason: string;
}
