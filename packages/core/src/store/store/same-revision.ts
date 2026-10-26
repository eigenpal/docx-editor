// Adjacent revision wrappers that are one change.
//
// Split out of `tree-op-segments.ts` and `tree-op-tracked.ts`, which are at their line caps.

import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import { isContentRevisionKind } from '../package/ooxml-shared.ts';

/** Two wrappers are the same revision when their `CT_TrackChange` triple agrees. */
export function sameRevision(a: OoxmlElement, b: OoxmlElement): boolean {
  const read = (node: OoxmlElement, localName: string): string | undefined =>
    node.attributes.find(
      (attribute) =>
        attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName
    )?.value;
  return (
    read(a, 'id') !== undefined &&
    read(a, 'id') === read(b, 'id') &&
    read(a, 'author') === read(b, 'author') &&
    read(a, 'date') === read(b, 'date')
  );
}

/**
 * Whether `wrapper` continues the change of the wrapper just before it in `holder`, and that
 * wrapper holds `nodeId`.
 *
 * One change can sit in two adjacent wrappers, split where another edit once fell, while a peer
 * holds it in one. A caret between the two is inside the change, as it is inside one wrapper.
 */
export function continuesRevisionOf(
  holder: OoxmlElement,
  wrapper: OoxmlElement,
  nodeId: string
): boolean {
  if (!isContentRevisionKind(wrapper.kind)) return false;
  const index = holder.children.findIndex((child) => child.id === wrapper.id);
  const previous = index > 0 ? holder.children[index - 1] : undefined;
  return (
    previous !== undefined &&
    previous.kind === wrapper.kind &&
    sameRevision(previous as OoxmlElement, wrapper) &&
    holds(previous, nodeId)
  );
}

function holds(node: OoxmlNode, id: string): boolean {
  if (node.id === id) return true;
  return node.kind !== 'textValue' && node.children.some((child) => holds(child, id));
}
