import type { HistoryGroup } from '../store/store/history-group.ts';

export type { HistoryGroup };

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

/**
 * How one command runs: where it lands, and which gesture it belongs to.
 *
 * `historyGroup` is for a control that applies every intermediate value of one gesture — a
 * colour picker the user drags, a font-size stepper held down, a spacing slider. Each call
 * renders and replicates on its own, but consecutive calls carrying the same token are ONE
 * undo step: undo restores the formatting from before the first call, exactly as it was
 * (a mixed selection comes back mixed), and redo restores the last value applied. Mint a
 * new token per gesture (`Symbol('color-drag')`) and pass it with every call of that
 * gesture; anything else closes the group — a call without a token or with another token,
 * a call landing in another story, buffered typing flushed ahead of a call, an undo, a
 * redo, or a command that records a whole-package unit such as inserting an image or a
 * footnote. A call that changes nothing adds no entry and leaves the group open.
 *
 * In a collaborative session the shared undo manager is the undo authority, and the token
 * groups there too: frames of one gesture join one shared undo item however long the
 * gesture lasts, and a change of group starts a new item. Without a token that manager
 * keeps its own rule of joining local edits inside its capture window.
 *
 * @example
 * ```ts
 * const gesture = Symbol('color-drag');
 * picker.addEventListener('input', (event) => {
 *   editor.exec(
 *     { type: 'setMarkAttr', mark: 'color', attr: 'val', value: event.target.value },
 *     { historyGroup: gesture }
 *   );
 * });
 * ```
 */
export interface EditorExecOptions {
  /** The editing view the command addresses. Omitted, the command lands where the caret is. */
  readonly scope?: EditorScope;
  /** The gesture this call is one frame of. Omitted, the call is its own undo step. */
  readonly historyGroup?: HistoryGroup;
}
