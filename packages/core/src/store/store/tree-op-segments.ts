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
import { isContentRevisionKind } from '../package/ooxml-shared.ts';
import {
  MAX_CONTENT_CONTROL_NESTING,
  contentControlContentOf,
  isContentControlNode,
} from './tree-op-nodes.ts';

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
  /**
   * When set, run formatting for this atom targets these runs (field result ownership),
   * not necessarily `runId`. Absent for ordinary text/tab/break segments.
   */
  readonly formatRunIds?: readonly string[];
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
 * Inline CONTENT CONTROLS are the same class of wrapper: their `w:sdtContent` runs join the
 * paragraph's offset stream with no break opportunity at the boundary. Nesting is bounded
 * (`MAX_CONTENT_CONTROL_NESTING`); beyond the bound the wrapper is opaque so recursion
 * cannot exhaust the stack.
 *
 * `runId` stays the id of the run the content actually lives in, at whatever depth: the
 * appliers resolve it with `findNode` and rebuild that run's children, so nesting costs them
 * nothing.
 */
export function segmentsOf(paragraph: OoxmlParagraphNode): Segment[] {
  return walkParagraph(paragraph, null);
}

/** Half-open `[start, end)` of one node in its paragraph's model offset space. */
export interface OffsetSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * Every node's place in the paragraph's model offset space, from the SAME walk `segmentsOf`
 * uses.
 *
 * The offset model has exactly one authority, and this is how a caller borrows it. Three
 * private walkers used to re-derive it — one in the tracked-change writer, one in the comment
 * anchor reader, one in the review queue — and all three disagreed with `segmentsOf` and with
 * each other: none gave a note reference or an atomic field its length of one, one counted a
 * field's instruction text as visible characters, and one never descended into `w:hyperlink`
 * at all. The consequences were an anchor short by a link's length, two unrelated comments
 * threaded onto one zero-width offset, and a tracked insert landing a character out in any
 * paragraph carrying a footnote. Patching each walker only resets the clock on the next drift.
 *
 * A node the walk never reaches — content under a `generic` container, or past the nesting cap
 * — has NO span, and {@link ParagraphOffsetIndex.lengthOf} reports zero for it. That is the
 * same answer `segmentsOf` gives: it contributes no addressable characters.
 */
export interface ParagraphOffsetIndex {
  /** The paragraph's own length, identical to {@link paragraphLength}. */
  readonly length: number;
  readonly segments: readonly Segment[];
  /** Where a node sits, or null when the offset walk never reached it. */
  spanOf(node: OoxmlNode | string): OffsetSpan | null;
  /** A node's model length: `end - start` of its span, and 0 when it has none. */
  lengthOf(node: OoxmlNode | string): number;
}

/**
 * MEMOIZED ON NODE IDENTITY. A paragraph node is immutable — a transaction rebuilds the path
 * to what it edited and leaves every other paragraph object-identical — so the index derived
 * from one can be reused until that paragraph itself changes.
 *
 * This is not a micro-optimization. Three whole-document readers call this per paragraph on
 * every commit (the review queue, the comment anchors, the tracked-change writer), so on a
 * long document one keystroke re-walked every paragraph in the file several times over, and
 * the cost showed up as typing latency that grew with document length.
 */
const offsetIndexCache = new WeakMap<OoxmlParagraphNode, ParagraphOffsetIndex>();

export function paragraphOffsetIndex(paragraph: OoxmlParagraphNode): ParagraphOffsetIndex {
  const cached = offsetIndexCache.get(paragraph);
  if (cached) return cached;
  const index = buildParagraphOffsetIndex(paragraph);
  offsetIndexCache.set(paragraph, index);
  return index;
}

function buildParagraphOffsetIndex(paragraph: OoxmlParagraphNode): ParagraphOffsetIndex {
  const spans = new Map<string, OffsetSpan>();
  const segments = walkParagraph(paragraph, spans);
  const length = segments.length === 0 ? 0 : segments[segments.length - 1]!.end;
  const lookup = (node: OoxmlNode | string): OffsetSpan | null =>
    spans.get(typeof node === 'string' ? node : node.id) ?? null;
  return {
    length,
    segments,
    spanOf: lookup,
    lengthOf: (node) => {
      const span = lookup(node);
      return span === null ? 0 : span.end - span.start;
    },
  };
}

function walkParagraph(
  paragraph: OoxmlParagraphNode,
  spans: Map<string, OffsetSpan> | null
): Segment[] {
  const segments: Segment[] = [];
  let offset = 0;
  /** Record a node's span. No-op for `segmentsOf`, which asks for none. */
  const record = (node: OoxmlNode, start: number): void => {
    if (spans !== null) spans.set(node.id, { start, end: offset });
  };
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
    readonly formatRunIds?: readonly string[];
  }): void => {
    segments.push({
      runId: span.runId,
      node: span.node,
      start: offset,
      end: offset + 1,
      removeNodeIds: span.removeNodeIds,
      ...(span.formatRunIds && span.formatRunIds.length > 0
        ? { formatRunIds: span.formatRunIds }
        : {}),
    });
    offset += 1;
  };

  const visitRunChild = (node: OoxmlNode, runId: string): void => {
    const start = offset;
    const atom = atomByBeginId.get(node.id);
    if (atom && atom.kind === 'complex') {
      emitAtom(atom);
      record(node, start);
      return;
    }
    if (covered.has(node.id)) {
      record(node, start);
      return;
    }
    const noteAtom = noteAtomById.get(node.id);
    if (noteAtom) {
      emitAtom(noteAtom);
      record(node, start);
      return;
    }
    if (isNoteAtomNode(node)) {
      // Should not happen — typed atoms are always in noteAtomById — but fail soft.
      emitAtom({ runId, node, removeNodeIds: [node.id] });
      record(node, start);
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
      record(node, start);
      return;
    }
    if (node.kind === 'textValue') {
      segments.push({ runId, node, start: offset, end: offset + node.value.length });
      offset += node.value.length;
      record(node, start);
      return;
    }
    if (node.kind === 'tab' || node.kind === 'hardBreak') {
      segments.push({ runId, node, start: offset, end: offset + 1 });
      offset += 1;
      record(node, start);
      return;
    }
    if (node.kind === 'runProperties' || node.kind === 'generic') {
      record(node, start);
      return;
    }
    // Misplaced typed control inside a run (should demote on read) — stay opaque so a
    // husk cannot invent atoms the way a paragraph-level inline control legitimately does.
    if (isContentControlNode(node)) {
      record(node, start);
      return;
    }
    if (node.kind === 'text' || node.kind === 'deletedText') {
      for (const child of node.children) visitRunChild(child, runId);
      record(node, start);
      return;
    }
    for (const child of node.children) visitRunChild(child, runId);
    record(node, start);
  };
  const visitInline = (child: OoxmlNode, depth: number): void => {
    const start = offset;
    if (child.kind === 'textValue' || depth >= MAX_INLINE_CONTAINER_DEPTH) {
      record(child, start);
      return;
    }
    if (isFldSimple(child)) {
      const atom = atomByBeginId.get(child.id);
      if (atom) emitAtom(atom);
      record(child, start);
      return;
    }
    if (child.kind === 'run') {
      for (const grand of child.children) visitRunChild(grand, child.id);
      record(child, start);
      return;
    }
    // Bookmark and range markers measure nothing; only a run CONTAINER descends. A link and a
    // revision wrapper are both containers, and either can hold the other — a link inside a
    // tracked insertion is ordinary. Not descending is what made tracked text invisible to the
    // op offset space, so every op past it was refused as out of range.
    if (child.kind === 'hyperlink' || isContentRevisionKind(child.kind)) {
      for (const inner of child.children) visitInline(inner, depth + 1);
      // The container owns the full span its descendants contributed. Tracked typing uses
      // this span to descend back into the author's existing `w:ins`; without it, the first
      // character was addressable but the second saw the wrapper as length zero and was
      // refused as past the paragraph.
      record(child, start);
      return;
    }
    // Inline content controls: descend into `w:sdtContent` with a nesting bound.
    if (isContentControlNode(child) && depth < MAX_CONTENT_CONTROL_NESTING) {
      const content = contentControlContentOf(child);
      if (content) {
        for (const inner of content.children) visitInline(inner, depth + 1);
      }
    }
    record(child, start);
  };
  for (const child of paragraph.children) visitInline(child, 0);
  return segments;
}

/** Matches the layout projection's nesting cap; see `segmentsOf`. */
const MAX_INLINE_CONTAINER_DEPTH = 32;

/**
 * The runs a paragraph child owns, at any depth — a `w:r`, or every run inside a container.
 *
 * Links, revision wrappers, and inline content controls are all run containers.
 */
export function runsUnder(child: OoxmlNode, depth = 0): OoxmlNode[] {
  if (child.kind === 'run') return [child];
  if (child.kind === 'textValue' || depth >= MAX_INLINE_CONTAINER_DEPTH) return [];
  if (child.kind === 'hyperlink' || isContentRevisionKind(child.kind)) {
    return child.children.flatMap((inner) => runsUnder(inner, depth + 1));
  }
  if (isContentControlNode(child) && depth < MAX_CONTENT_CONTROL_NESTING) {
    const content = contentControlContentOf(child);
    if (!content) return [];
    return content.children.flatMap((inner) => runsUnder(inner, depth + 1));
  }
  return [];
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
