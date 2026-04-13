import { useMemo } from 'react';
import type { EditorState } from 'prosemirror-state';
import type { Mark } from 'prosemirror-model';
import type { TrackedChangeEntry } from '../components/sidebar/cardUtils';

const EMPTY_RESULT: TrackedChangesResult = {
  entries: [],
  commentToRevision: new Map(),
};

export interface TrackedChangesResult {
  /** Tracked-change entries, sorted by document position, with adjacent same-revision entries merged. */
  entries: TrackedChangeEntry[];
  /**
   * Map of `commentId -> revisionId` for comments whose range overlaps a tracked-change mark.
   * Consumers (DocxEditor's threading effect) use this to thread comments under their tracked change.
   */
  commentToRevision: Map<number, number>;
}

/**
 * Walk the PM doc once and derive (a) the tracked-change list and (b) a
 * comment→revision overlap map for threading. Adjacent entries from the same
 * revision are merged; deletion+insertion pairs from the same author/date
 * become a single `replacement` entry (matches Word's UX for replace ops).
 *
 * Pure function — no React, no side effects. Single O(N) walk over text nodes.
 */
export function extractTrackedChanges(state: EditorState | null): TrackedChangesResult {
  if (!state) return EMPTY_RESULT;
  const { doc, schema } = state;
  const insertionType = schema.marks.insertion;
  const deletionType = schema.marks.deletion;
  const commentType = schema.marks.comment;
  if (!insertionType && !deletionType) return EMPTY_RESULT;

  const raw: TrackedChangeEntry[] = [];
  const commentToRevision = new Map<number, number>();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    let tcMark: Mark | null = null;
    for (const mark of node.marks) {
      if (mark.type === insertionType || mark.type === deletionType) {
        raw.push({
          type: mark.type === insertionType ? 'insertion' : 'deletion',
          text: node.text || '',
          author: (mark.attrs.author as string) || '',
          date: mark.attrs.date as string | undefined,
          from: pos,
          to: pos + node.nodeSize,
          revisionId: mark.attrs.revisionId as number,
        });
        tcMark = mark;
      }
    }
    // Same-walk comment-to-revision overlap detection (used to thread comments
    // under tracked changes). Cheaper than a second descendants walk.
    if (commentType && tcMark) {
      const commentMark = node.marks.find((m) => m.type === commentType);
      if (commentMark) {
        const cid = commentMark.attrs.commentId as number;
        const rid = tcMark.attrs.revisionId as number;
        if (!commentToRevision.has(cid)) commentToRevision.set(cid, rid);
      }
    }
  });

  // Merge adjacent entries with the same revisionId and type into one
  const merged: TrackedChangeEntry[] = [];
  for (const entry of raw) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.revisionId === entry.revisionId &&
      last.type === entry.type &&
      last.to === entry.from
    ) {
      last.text += entry.text;
      last.to = entry.to;
    } else {
      merged.push({ ...entry });
    }
  }

  // Detect replacement pairs: adjacent deletion + insertion from the same author/date.
  // Word assigns different w:id values but same author+date for a single replace.
  const final: TrackedChangeEntry[] = [];
  for (let i = 0; i < merged.length; i++) {
    const curr = merged[i]!;
    const next = merged[i + 1];
    if (
      curr.type === 'deletion' &&
      next &&
      next.type === 'insertion' &&
      curr.author === next.author &&
      curr.date === next.date &&
      curr.to === next.from
    ) {
      final.push({
        type: 'replacement',
        text: next.text,
        deletedText: curr.text,
        author: curr.author,
        date: curr.date,
        from: curr.from,
        to: next.to,
        revisionId: curr.revisionId,
        insertionRevisionId: next.revisionId,
      });
      i++; // skip the insertion entry
    } else {
      final.push(curr);
    }
  }
  return { entries: final, commentToRevision };
}

/**
 * Returns tracked changes (and the comment→revision overlap map for threading)
 * derived from the latest PM state. Memoized on state identity, so derivation
 * only re-runs when PM state changes (which happens on every doc-changing
 * transaction, including remote ones via ySyncPlugin).
 *
 * No debounce: a single O(N) doc walk, cheap enough to run per transaction.
 * If you see jank on huge documents, wrap the setter that drives the state
 * argument in `requestAnimationFrame` rather than reintroducing a delay here —
 * a delay makes the sidebar feel laggy.
 */
export function useTrackedChanges(state: EditorState | null): TrackedChangesResult {
  return useMemo(() => extractTrackedChanges(state), [state]);
}
