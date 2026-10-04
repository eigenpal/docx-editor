// Symbols inside a deleted range.
//
// A `w:sym` is a preserved generic run child. Layout paints its glyph, but model text gives
// it no width, so it sits between two model offsets and no text segment covers it. A
// deletion whose range spans one removes it, or strikes it when the deletion is tracked.

import { atomicFieldSpansOf } from '../package/field-nodes.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlParagraphNode,
} from '../package/ooxml-tree.ts';
import { transientParagraphOffsetIndex } from './tree-op-segments.ts';

interface Visit {
  readonly node: OoxmlNode;
  readonly parent: Visit | null;
}

/** Ids of the paragraph's own `w:sym` children strictly inside `(start, end)`. */
export function symbolsWithin(paragraph: OoxmlParagraphNode, start: number, end: number): string[] {
  if (end - start < 2) return [];
  const symbols: Visit[] = [];
  const stack: Visit[] = [];
  const pushChildren = (node: OoxmlNode, parent: Visit | null): void => {
    if (node.kind === 'textValue') return;
    for (let at = node.children.length - 1; at >= 0; at -= 1) {
      stack.push({ node: node.children[at]!, parent });
    }
  };
  pushChildren(paragraph, null);
  while (stack.length > 0) {
    const visit = stack.pop()!;
    const { node } = visit;
    if (node.kind === 'textValue' || node.kind === 'paragraph' || node.kind === 'drawing') continue;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'sym') symbols.push(visit);
    else pushChildren(node, visit);
  }
  if (symbols.length === 0) return [];

  // A field's cached result is one unit, which an atom removal takes whole.
  const fieldNodes = new Set<string>();
  for (const span of atomicFieldSpansOf(paragraph)) {
    fieldNodes.add(span.node.id);
    for (const id of span.removeNodeIds) fieldNodes.add(id);
  }
  const insideField = (visit: Visit): boolean => {
    for (let at: Visit | null = visit; at; at = at.parent) {
      if (fieldNodes.has(at.node.id)) return true;
    }
    return false;
  };
  const index = transientParagraphOffsetIndex(paragraph);
  const ids: string[] = [];
  for (const visit of symbols) {
    // A node the offset walk never reached, such as one in a text box, is not this text.
    const span = index.spanOf(visit.node);
    if (!span || span.start !== span.end || insideField(visit)) continue;
    if (span.start > start && span.start < end) ids.push(visit.node.id);
  }
  return ids;
}
