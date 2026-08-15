import { findNode, parentNodeOf } from '../package/ooxml-edit.ts';
import { noteKindOf } from '../package/note-nodes.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';

/**
 * Resolve an exact canonical note root accepted for a scoped revision collection decision.
 *
 * A `w:footnote`-named generic node elsewhere in a hostile part is not a note root: it must be a
 * direct child of the matching typed notes-part root. Keeping this predicate shared makes
 * validation, protection reach, and application fail closed on exactly the same scope.
 */
export function scopedRevisionRoot(part: OoxmlPart, nodeId: string): OoxmlNode | null {
  const node = findNode(part, nodeId);
  if (node === null) return null;
  const noteKind = noteKindOf(node);
  if (noteKind === null) return null;
  const expectedRootKind = noteKind === 'footnote' ? 'footnotes' : 'endnotes';
  if (part.root.kind !== expectedRootKind) return null;
  return parentNodeOf(part, node.id)?.id === part.root.id ? node : null;
}
