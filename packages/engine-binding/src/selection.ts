// Selection preservation through reconciliation (document-engine tasks 6.6, 6.7).
// A selection is captured as a semantic internal anchor — (paragraph semId,
// offset, affinity) — not a raw PM position, so it survives reprojection. On
// resolve: if the paragraph still exists, the offset is clamped into it; if its
// content was deleted, the selection collapses by affinity to a surviving
// boundary and NEVER lands on unrelated content.

import { EditorState, TextSelection, NodeSelection } from 'prosemirror-state';
import { Node as PMNode } from 'prosemirror-model';

export interface SelectionAnchor {
  readonly paragraphId: string | null;
  readonly offset: number;
  readonly affinity: 'before' | 'after';
}

export interface SelectionRangeAnchors {
  readonly anchor: SelectionAnchor;
  readonly head: SelectionAnchor;
}

/** Capture the caret/anchor of a PM selection as a semantic anchor. */
export function captureSelection(state: EditorState): SelectionAnchor {
  const { $from } = state.selection;
  const para = $from.depth >= 1 ? $from.node(1) : $from.parent;
  return {
    paragraphId: (para?.attrs?.semId as string | null) ?? null,
    offset: $from.parentOffset,
    affinity: 'after',
  };
}

/** Capture anchor and head of the current PM selection. */
export function captureSelectionRange(state: EditorState): SelectionRangeAnchors {
  const { $from, $to } = state.selection;
  const anchorPara = $from.depth >= 1 ? $from.node(1) : $from.parent;
  const headPara = $to.depth >= 1 ? $to.node(1) : $to.parent;
  return {
    anchor: {
      paragraphId: (anchorPara?.attrs?.semId as string | null) ?? null,
      offset: $from.parentOffset,
      affinity: 'after',
    },
    head: {
      paragraphId: (headPara?.attrs?.semId as string | null) ?? null,
      offset: $to.parentOffset,
      affinity: 'after',
    },
  };
}

interface Located {
  readonly node: PMNode;
  /** Document position just inside the paragraph (after its open token). */
  readonly innerStart: number;
  readonly index: number;
}

function locateParagraphs(doc: PMNode): Located[] {
  const out: Located[] = [];
  doc.forEach((child, offset, index) => {
    // `offset` is the child's start position in the doc; +1 steps inside it.
    out.push({ node: child, innerStart: offset + 1, index });
  });
  return out;
}

/**
 * Resolve a captured selection against a freshly projected doc. Returns a
 * TextSelection. If the anchored paragraph survives, the offset is clamped into
 * its content; otherwise the selection collapses to the affinity-nearest
 * surviving paragraph boundary.
 */
export function resolveSelection(anchor: SelectionAnchor, newDoc: PMNode): TextSelection {
  const paras = locateParagraphs(newDoc);
  const found = anchor.paragraphId ? paras.find((p) => p.node.attrs.semId === anchor.paragraphId) : undefined;

  if (found) {
    const clamped = Math.max(0, Math.min(anchor.offset, found.node.content.size));
    return TextSelection.create(newDoc, found.innerStart + clamped);
  }

  // Deleted paragraph: collapse to a surviving boundary by affinity.
  if (paras.length === 0) return TextSelection.create(newDoc, 0);
  const target = anchor.affinity === 'before' ? paras[0] : paras[paras.length - 1];
  const at = anchor.affinity === 'before' ? target.innerStart : target.innerStart + target.node.content.size;
  return TextSelection.create(newDoc, at);
}

/** Resolve a semantic anchor/head pair to a ProseMirror TextSelection. */
export function resolveSelectionRange(range: SelectionRangeAnchors, newDoc: PMNode): TextSelection {
  const from = resolveSelection(range.anchor, newDoc).from;
  const to = resolveSelection(range.head, newDoc).to;
  return TextSelection.create(newDoc, Math.min(from, to), Math.max(from, to));
}

/** Resolve an atomic object id to a node selection when the block embed is present. */
export function resolveAtomicSelection(objectId: string, newDoc: PMNode): NodeSelection | null {
  let pos: number | null = null;
  newDoc.forEach((node, offset) => {
    if (pos !== null) return;
    if (node.type.name === 'blockEmbed' && node.attrs.semId === objectId) pos = offset;
  });
  return pos === null ? null : NodeSelection.create(newDoc, pos);
}
