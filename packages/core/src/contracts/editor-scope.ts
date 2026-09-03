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
      /** A text box or floating frame with its own content. */
      kind: 'frame';
      id: string;
      /** Furniture or note story that owns this frame. Absence means the body story. */
      owner?: { kind: 'headerFooter'; rId: string } | { kind: 'note'; id: string };
    }
  /** Read-only aggregate across every view. Valid for queries, not for writes. */
  | { kind: 'all' };

/** A concrete editing view. */
export type ViewScope = Exclude<EditorScope, { kind: 'all' }>;
