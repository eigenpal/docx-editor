// Visible characters with no model offset width.
//
// `w:sym`, `w:noBreakHyphen` and `w:softHyphen` are preserved generic run children. Layout
// paints them, but model text gives them no width, so each sits between two model offsets.
// Read text shows the hyphens at their offsets, and a deletion that spans one removes it.

import { atomicFieldSpansOf } from '../package/field-nodes.ts';
import { hyphenTextOf } from '../package/hyphen-text.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlParagraphNode,
} from '../package/ooxml-tree.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';

/** One zero-width character at its model offset. */
export interface InlineCharacterMark {
  readonly nodeId: string;
  readonly offset: number;
  /** Read-text character for a hyphen; null for a symbol, which read text leaves out. */
  readonly text: string | null;
  /** Inside a pending insertion or move destination: absent from the original view. */
  readonly inserted: boolean;
}

const NO_MARKS: readonly InlineCharacterMark[] = Object.freeze([]);
const marksByParagraph = new WeakMap<OoxmlParagraphNode, readonly InlineCharacterMark[]>();

function isSymbol(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' && node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'sym'
  );
}

/** Zero-width characters of the paragraph's own text, in document order. */
export function inlineCharacterMarks(
  paragraph: OoxmlParagraphNode
): readonly InlineCharacterMark[] {
  const cached = marksByParagraph.get(paragraph);
  if (cached) return cached;
  const marks = collectMarks(paragraph);
  marksByParagraph.set(paragraph, marks);
  return marks;
}

/** Ids of the zero-width characters strictly inside `(start, end)`, for a deletion. */
export function inlineCharactersWithin(
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number
): string[] {
  const ids: string[] = [];
  for (const mark of inlineCharacterMarks(paragraph)) {
    if (mark.offset > start && mark.offset < end) ids.push(mark.nodeId);
  }
  return ids;
}

interface Visit {
  readonly node: OoxmlNode;
  readonly parent: Visit | null;
  readonly inserted: boolean;
}

function collectMarks(paragraph: OoxmlParagraphNode): readonly InlineCharacterMark[] {
  const index = paragraphOffsetIndex(paragraph);
  // A field shows its cached result as one unit, which carries its own characters. Only a
  // paragraph that holds such a character pays for the field lookup.
  let fieldNodes: Set<string> | null = null;
  const insideField = (visit: Visit): boolean => {
    if (!fieldNodes) {
      fieldNodes = new Set();
      for (const span of atomicFieldSpansOf(paragraph)) {
        fieldNodes.add(span.node.id);
        for (const id of span.removeNodeIds) fieldNodes.add(id);
      }
    }
    for (let at: Visit | null = visit; at; at = at.parent) {
      if (fieldNodes.has(at.node.id)) return true;
    }
    return false;
  };
  const marks: InlineCharacterMark[] = [];
  const stack: Visit[] = [];
  const pushChildren = (node: OoxmlNode, parent: Visit | null, inserted: boolean): void => {
    if (node.kind === 'textValue') return;
    for (let at = node.children.length - 1; at >= 0; at -= 1) {
      stack.push({ node: node.children[at]!, parent, inserted });
    }
  };
  pushChildren(paragraph, null, false);
  while (stack.length > 0) {
    const visit = stack.pop()!;
    const { node, inserted } = visit;
    if (node.kind === 'textValue' || node.kind === 'paragraph' || node.kind === 'drawing') continue;
    const text = hyphenTextOf(node);
    if (text !== null || isSymbol(node)) {
      // A node the offset walk never reached, such as one in a text box, is not this text.
      const span = index.spanOf(node);
      if (span && span.start === span.end && !insideField(visit)) {
        marks.push({ nodeId: node.id, offset: span.start, text, inserted });
      }
      continue;
    }
    const within = inserted || node.kind === 'revisionInsert' || node.kind === 'revisionMoveTo';
    pushChildren(node, visit, within);
  }
  return marks.length === 0 ? NO_MARKS : marks;
}
