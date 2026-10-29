import { findNode, parentNodeOf } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { propertyContainer } from './direct-properties.ts';
import { equivalentNodes } from './ooxml-node-equality.ts';
import { mergedPropertyChildren, PARAGRAPH_VOCABULARY } from './tree-op-properties.ts';
import { recordedProperties } from './tree-op-tracked-properties.ts';
import type { TreeDocOp } from './tree-op-types.ts';

const named = (node: OoxmlNode, localName: string): boolean =>
  node.kind !== 'textValue' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  node.localName === localName;

/** Use the write's own merge: unchanged properties, including extensions, must survive verbatim. */
export function changesOnlyParagraphAlignment(part: OoxmlPart, op: TreeDocOp): boolean {
  if (op.op !== 'setParagraphProperties') return false;
  const paragraph = findNode(part, op.paragraphId);
  if (paragraph?.kind !== 'paragraph') return false;
  const container = propertyContainer(paragraph, 'paragraphProperties', 'pPr');
  const prior = container && container.kind !== 'textValue' ? container.children : [];
  // A tracked write merges into the pending paragraph change. When that change already records
  // other properties, the merged revision could never be rejected inside the lock.
  if (op.revision) {
    const pending = prior.find((node) => named(node, 'pPrChange'));
    if (pending && !restoresOnlyParagraphAlignment(part, pending)) return false;
  }
  const next = mergedPropertyChildren(prior, op.properties, PARAGRAPH_VOCABULARY, () => '');
  const keep = (nodes: readonly OoxmlNode[]) => nodes.filter((node) => !named(node, 'jc'));
  const before = keep(prior);
  const after = keep(next);
  // The canonical merge can put existing properties in schema order without changing them.
  const remaining = new Set(before);
  return (
    remaining.size === before.length &&
    before.length === after.length &&
    after.every((node) => remaining.delete(node))
  );
}

/** Rejecting an alignment proposal restores only alignment, not other locked formatting. */
export function restoresOnlyParagraphAlignment(part: OoxmlPart, change: OoxmlNode): boolean {
  if (!named(change, 'pPrChange')) return false;
  const container = parentNodeOf(part, change.id);
  if (!container || !named(container, 'pPr')) return false;
  const recorded = recordedProperties(change);
  if (!recorded) return false;
  const current = container.children.filter(
    (node) =>
      !named(node, 'pPrChange') &&
      !named(node, 'rPr') &&
      !named(node, 'sectPr') &&
      !named(node, 'jc')
  );
  return equivalentNodes(
    current,
    recorded.filter((node) => !named(node, 'jc'))
  );
}
