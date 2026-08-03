// UTF-16 paragraph segmentation for tree ops (tree-ops seam).
//
// Flattens a paragraph into addressable units — text, tab, hard break, atomic field, and
// note reference — including content nested under `w:hyperlink`. Appliers and validation
// share this model so offsets agree across insert/delete/format/link.

import type { OoxmlNode, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import {
  atomicFieldSpansOf,
  isFieldChrome,
  isFldChar,
  isFldSimple,
  isInstrText,
} from '../package/field-nodes.ts';
import { atomicNoteSpansOf, isNoteAtomNode } from '../package/note-nodes.ts';

/** One addressable unit of paragraph text: text, tab, hard break, or atomic field. */
export interface Segment {
  readonly runId: string;
  readonly node: OoxmlNode;
  readonly start: number;
  readonly end: number;
  /**
   * When set, deleting this segment removes every listed node id in one step (atomic
   * field begin→end or `fldSimple`). Absent for ordinary text/tab/break segments.
   */
  readonly removeNodeIds?: readonly string[];
}

export function isParagraph(node: OoxmlNode | null): node is OoxmlParagraphNode {
  return node !== null && node.kind === 'paragraph';
}

/**
 * Flatten a paragraph into UTF-16 addressable segments, in document order.
 *
 * A HYPERLINK's runs are addressed too. `w:hyperlink` is a run container, not a leaf, and
 * the characters inside a link are ordinary paragraph text: the user selects them, types
 * over them and deletes them like any other. Skipping the container — which is what
 * iterating only direct `w:r` children did — left every link's text with no offsets at all,
 * so `paragraphTextOf` read "Visit  or ." for a sentence that says "Visit Example.com or
 * Anthropic's website." and layout, selection and the ops all agreed on the wrong string.
 *
 * `runId` stays the id of the run the content actually lives in, at whatever depth: the
 * appliers resolve it with `findNode` and rebuild that run's children, so nesting costs them
 * nothing.
 */
export function segmentsOf(paragraph: OoxmlParagraphNode): Segment[] {
  const segments: Segment[] = [];
  let offset = 0;
  const atoms = atomicFieldSpansOf(paragraph);
  const noteAtoms = atomicNoteSpansOf(paragraph);
  const atomByBeginId = new Map(atoms.map((span) => [span.node.id, span]));
  const noteAtomById = new Map(noteAtoms.map((span) => [span.node.id, span]));
  /** Node ids swallowed by a well-formed atomic field (chrome + cached result). */
  const covered = new Set<string>();
  for (const span of atoms) {
    for (const id of span.removeNodeIds) covered.add(id);
  }

  const emitAtom = (span: {
    readonly runId: string;
    readonly node: OoxmlNode;
    readonly removeNodeIds: readonly string[];
  }): void => {
    segments.push({
      runId: span.runId,
      node: span.node,
      start: offset,
      end: offset + 1,
      removeNodeIds: span.removeNodeIds,
    });
    offset += 1;
  };

  const visitRunChild = (node: OoxmlNode, runId: string): void => {
    const atom = atomByBeginId.get(node.id);
    if (atom && atom.kind === 'complex') {
      emitAtom(atom);
      return;
    }
    if (covered.has(node.id)) return;
    const noteAtom = noteAtomById.get(node.id);
    if (noteAtom) {
      emitAtom(noteAtom);
      return;
    }
    if (isNoteAtomNode(node)) {
      // Should not happen — typed atoms are always in noteAtomById — but fail soft.
      emitAtom({ runId, node, removeNodeIds: [node.id] });
      return;
    }
    if (
      isFieldChrome(node) ||
      isFldChar(node, 'begin') ||
      isFldChar(node, 'separate') ||
      isFldChar(node, 'end') ||
      isInstrText(node)
    ) {
      // Demoted / orphan markers: no model contribution; content preserved in the tree.
      return;
    }
    if (node.kind === 'textValue') {
      segments.push({ runId, node, start: offset, end: offset + node.value.length });
      offset += node.value.length;
      return;
    }
    if (node.kind === 'tab' || node.kind === 'hardBreak') {
      segments.push({ runId, node, start: offset, end: offset + 1 });
      offset += 1;
      return;
    }
    if (node.kind === 'runProperties' || node.kind === 'generic') return;
    if (node.kind === 'text') {
      for (const child of node.children) visitRunChild(child, runId);
      return;
    }
    for (const child of node.children) visitRunChild(child, runId);
  };
  const visitInline = (child: OoxmlNode): void => {
    if (isFldSimple(child)) {
      const atom = atomByBeginId.get(child.id);
      if (atom) emitAtom(atom);
      return;
    }
    if (child.kind === 'run') {
      for (const grand of child.children) visitRunChild(grand, child.id);
      return;
    }
    // Bookmark markers and everything generic measure nothing; only a link descends.
    if (child.kind === 'hyperlink') {
      for (const inner of child.children) visitInline(inner);
    }
  };
  for (const child of paragraph.children) visitInline(child);
  return segments;
}

/** The runs a paragraph child owns, at any depth — a `w:r`, or every run inside a link. */
export function runsUnder(child: OoxmlNode): OoxmlNode[] {
  if (child.kind === 'run') return [child];
  if (child.kind !== 'hyperlink') return [];
  return child.children.flatMap((inner) => runsUnder(inner));
}

/** UTF-16 length of a paragraph under the shared segment model. */
export function paragraphLength(paragraph: OoxmlParagraphNode): number {
  const segments = segmentsOf(paragraph);
  return segments.length === 0 ? 0 : segments[segments.length - 1]!.end;
}

/** Whether an offset falls between the halves of a surrogate pair. */
export function splitsSurrogate(paragraph: OoxmlParagraphNode, offset: number): boolean {
  for (const segment of segmentsOf(paragraph)) {
    if (segment.node.kind !== 'textValue') continue;
    if (offset <= segment.start || offset >= segment.end) continue;
    const local = offset - segment.start;
    const before = segment.node.value.charCodeAt(local - 1);
    const after = segment.node.value.charCodeAt(local);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) return true;
  }
  return false;
}
