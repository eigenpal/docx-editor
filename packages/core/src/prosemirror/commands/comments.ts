/**
 * Comment and Track Changes Commands
 *
 * PM commands for adding/removing comments and accepting/rejecting tracked changes.
 */

import type { Command } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';

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
 * Resolve a tracked change: accept or reject.
 * - Accept: keep insertions (remove mark), delete deletions (remove text)
 * - Reject: keep deletions (remove mark), delete insertions (remove text)
 */
function resolveChange(from: number, to: number, mode: 'accept' | 'reject'): Command {
  return (state, dispatch) => {
    const insertionType = state.schema.marks.insertion;
    const deletionType = state.schema.marks.deletion;
    if (!insertionType && !deletionType) return false;

    // "keep" mark type: remove the mark but keep the text
    // "remove" mark type: remove both the mark and the text
    const keepType = mode === 'accept' ? insertionType : deletionType;
    const removeType = mode === 'accept' ? deletionType : insertionType;

    if (dispatch) {
      const tr = state.tr;
      const deleteRanges: Array<{ from: number; to: number }> = [];

      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return;
        const nodeEnd = pos + node.nodeSize;
        const rangeFrom = Math.max(from, pos);
        const rangeTo = Math.min(to, nodeEnd);

        if (removeType && node.marks.some((m) => m.type === removeType)) {
          deleteRanges.push({ from: rangeFrom, to: rangeTo });
        }

        if (keepType && node.marks.some((m) => m.type === keepType)) {
          tr.removeMark(rangeFrom, rangeTo, keepType);
        }
      });

      for (const range of deleteRanges.reverse()) {
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
 * Accept a tracked change at the given range.
 * - Insertion: remove mark, keep text
 * - Deletion: remove mark AND text
 */
export function acceptChange(from: number, to: number): Command {
  return resolveChange(from, to, 'accept');
}

/**
 * Reject a tracked change at the given range.
 * - Insertion: remove mark AND text
 * - Deletion: remove mark, keep text
 */
export function rejectChange(from: number, to: number): Command {
  return resolveChange(from, to, 'reject');
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

interface ChangeRange {
  from: number;
  to: number;
  type: 'insertion' | 'deletion';
}

/**
 * Find the next tracked change after the given position.
 */
export function findNextChange(state: EditorState, startPos: number): ChangeRange | null {
  const insertionType = state.schema.marks.insertion;
  const deletionType = state.schema.marks.deletion;
  if (!insertionType && !deletionType) return null;

  let result: ChangeRange | null = null;

  state.doc.descendants((node, pos) => {
    if (result) return false;
    if (!node.isText) return;
    if (pos + node.nodeSize <= startPos) return;

    for (const mark of node.marks) {
      if (mark.type === insertionType || mark.type === deletionType) {
        result = {
          from: Math.max(pos, startPos),
          to: pos + node.nodeSize,
          type: mark.type === insertionType ? 'insertion' : 'deletion',
        };
        return false;
      }
    }
  });

  // Wrap around (only once)
  if (!result && startPos > 0) {
    return findNextChange(state, 0);
  }

  return result;
}

/**
 * Find the previous tracked change before the given position.
 */
export function findPreviousChange(state: EditorState, startPos: number): ChangeRange | null {
  const insertionType = state.schema.marks.insertion;
  const deletionType = state.schema.marks.deletion;
  if (!insertionType && !deletionType) return null;

  let result: ChangeRange | null = null;

  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    if (pos >= startPos) return false;

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

  // Wrap around (only once — guard prevents infinite recursion)
  if (!result && startPos < state.doc.content.size) {
    return findPreviousChange(state, state.doc.content.size);
  }

  return result;
}
