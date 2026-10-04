import { findNode, parentNodeOf } from '../package/ooxml-edit.ts';
import { noteKindOf } from '../package/note-nodes.ts';
import { WPS_NAMESPACE_URI } from '../package/ooxml-drawing-rules.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';

/**
 * Resolve an exact canonical story root accepted for a scoped revision collection decision: a
 * note root, or the `w:txbxContent` story of a DrawingML shape (`wps:txbx/w:txbxContent`).
 *
 * A `w:footnote`-named generic node elsewhere in a hostile part is not a note root: it must be a
 * direct child of the matching typed notes-part root. Keeping this predicate shared makes validation, protection reach,
 * and application fail closed on exactly the same scope.
 */
export function scopedRevisionRoot(part: OoxmlPart, nodeId: string): OoxmlNode | null {
  const node = findNode(part, nodeId);
  if (node === null) return null;
  if (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === 'txbxContent'
  ) {
    const parent = parentNodeOf(part, node.id);
    return parent?.namespaceUri === WPS_NAMESPACE_URI && parent.localName === 'txbx' ? node : null;
  }
  const noteKind = noteKindOf(node);
  if (noteKind === null) return null;
  const expectedRootKind = noteKind === 'footnote' ? 'footnotes' : 'endnotes';
  if (part.root.kind !== expectedRootKind) return null;
  return parentNodeOf(part, node.id)?.id === part.root.id ? node : null;
}
