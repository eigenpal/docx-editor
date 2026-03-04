/**
 * Comment and Track Changes Commands
 *
 * PM commands for adding/removing comments and accepting/rejecting tracked changes.
 */

import type { EditorState, Transaction } from 'prosemirror-state';

type Dispatch = (tr: Transaction) => void;
type Command = (state: EditorState, dispatch?: Dispatch) => boolean;

/**
 * Add a comment mark to the current selection.
 */
export function addCommentMark(commentId: number): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;

    const commentType = state.schema.marks.comment;
    if (!commentType) return false;

    if (dispatch) {
      const tr = state.tr.addMark(from, to, commentType.create({ commentId }));
      dispatch(tr);
    }
    return true;
  };
}

/**
 * Remove a comment mark by ID from the entire document.
 */
export function removeCommentMark(commentId: number): Command {
  return (state, dispatch) => {
    const commentType = state.schema.marks.comment;
    if (!commentType) return false;

    if (dispatch) {
      const tr = state.tr;
      state.doc.descendants((node, pos) => {
        if (node.isText) {
          for (const mark of node.marks) {
            if (mark.type === commentType && mark.attrs.commentId === commentId) {
              tr.removeMark(pos, pos + node.nodeSize, mark);
            }
          }
        }
      });
      if (tr.steps.length > 0) {
        dispatch(tr);
      }
    }
    return true;
  };
}

/**
 * Accept a tracked change at the given range.
 * - Insertion: remove mark, keep text
 * - Deletion: remove mark AND text
 */
export function acceptChange(from: number, to: number): Command {
  return (state, dispatch) => {
    const insertionType = state.schema.marks.insertion;
    const deletionType = state.schema.marks.deletion;
    if (!insertionType && !deletionType) return false;

    if (dispatch) {
      const tr = state.tr;

      // Collect deletion ranges first (iterate backwards to maintain positions)
      const deletionRanges: Array<{ from: number; to: number }> = [];

      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return;
        const nodeEnd = pos + node.nodeSize;
        const rangeFrom = Math.max(from, pos);
        const rangeTo = Math.min(to, nodeEnd);

        if (deletionType) {
          const delMark = node.marks.find((m) => m.type === deletionType);
          if (delMark) {
            deletionRanges.push({ from: rangeFrom, to: rangeTo });
          }
        }

        if (insertionType) {
          const insMark = node.marks.find((m) => m.type === insertionType);
          if (insMark) {
            tr.removeMark(rangeFrom, rangeTo, insertionType);
          }
        }
      });

      // Delete deletion ranges in reverse order
      for (const range of deletionRanges.reverse()) {
        tr.delete(range.from, range.to);
      }

      if (tr.steps.length > 0) {
        dispatch(tr);
      }
    }
    return true;
  };
}

/**
 * Reject a tracked change at the given range.
 * - Insertion: remove mark AND text
 * - Deletion: remove mark, keep text
 */
export function rejectChange(from: number, to: number): Command {
  return (state, dispatch) => {
    const insertionType = state.schema.marks.insertion;
    const deletionType = state.schema.marks.deletion;
    if (!insertionType && !deletionType) return false;

    if (dispatch) {
      const tr = state.tr;

      // Collect insertion ranges (iterate backwards to maintain positions)
      const insertionRanges: Array<{ from: number; to: number }> = [];

      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return;
        const nodeEnd = pos + node.nodeSize;
        const rangeFrom = Math.max(from, pos);
        const rangeTo = Math.min(to, nodeEnd);

        if (insertionType) {
          const insMark = node.marks.find((m) => m.type === insertionType);
          if (insMark) {
            insertionRanges.push({ from: rangeFrom, to: rangeTo });
          }
        }

        if (deletionType) {
          const delMark = node.marks.find((m) => m.type === deletionType);
          if (delMark) {
            tr.removeMark(rangeFrom, rangeTo, deletionType);
          }
        }
      });

      // Delete insertion ranges in reverse order
      for (const range of insertionRanges.reverse()) {
        tr.delete(range.from, range.to);
      }

      if (tr.steps.length > 0) {
        dispatch(tr);
      }
    }
    return true;
  };
}

/**
 * Accept all tracked changes in the document.
 */
export function acceptAllChanges(): Command {
  return (state, dispatch) => {
    return acceptChange(0, state.doc.content.size)(state, dispatch);
  };
}

/**
 * Reject all tracked changes in the document.
 */
export function rejectAllChanges(): Command {
  return (state, dispatch) => {
    return rejectChange(0, state.doc.content.size)(state, dispatch);
  };
}

/**
 * Find the next tracked change after the given position.
 * Returns the range { from, to } or null if none found.
 */
export function findNextChange(
  state: EditorState,
  startPos: number
): { from: number; to: number; type: 'insertion' | 'deletion' } | null {
  const insertionType = state.schema.marks.insertion;
  const deletionType = state.schema.marks.deletion;
  if (!insertionType && !deletionType) return null;

  let result: { from: number; to: number; type: 'insertion' | 'deletion' } | null = null;

  state.doc.descendants((node, pos) => {
    if (result) return false; // stop early
    if (!node.isText) return;
    if (pos + node.nodeSize <= startPos) return;

    const from = Math.max(pos, startPos);
    const to = pos + node.nodeSize;

    for (const mark of node.marks) {
      if (mark.type === insertionType || mark.type === deletionType) {
        result = {
          from,
          to,
          type: mark.type === insertionType ? 'insertion' : 'deletion',
        };
        return false;
      }
    }
  });

  // Wrap around
  if (!result && startPos > 0) {
    return findNextChange(state, 0);
  }

  return result;
}

/**
 * Find the previous tracked change before the given position.
 */
export function findPreviousChange(
  state: EditorState,
  startPos: number
): { from: number; to: number; type: 'insertion' | 'deletion' } | null {
  const insertionType = state.schema.marks.insertion;
  const deletionType = state.schema.marks.deletion;
  if (!insertionType && !deletionType) return null;

  let result: { from: number; to: number; type: 'insertion' | 'deletion' } | null = null;

  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    if (pos >= startPos) return false; // stop past cursor

    for (const mark of node.marks) {
      if (mark.type === insertionType || mark.type === deletionType) {
        result = {
          from: pos,
          to: pos + node.nodeSize,
          type: mark.type === insertionType ? 'insertion' : 'deletion',
        };
      }
    }
  });

  // Wrap around
  if (!result) {
    return findPreviousChange(state, state.doc.content.size);
  }

  return result;
}
