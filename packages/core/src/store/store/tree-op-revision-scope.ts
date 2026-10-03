import { findNode, parentNodeOf } from '../package/ooxml-edit.ts';
import { noteKindOf } from '../package/note-nodes.ts';
import { textboxStoriesInPart } from '../package/textbox-stories.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';

/**
 * Resolve an exact canonical story root accepted for a scoped revision collection decision: a
 * note root, or the `w:txbxContent` of a DrawingML text box anchored in one of the part's
 * paragraphs.
 *
 * A `w:footnote`-named generic node elsewhere in a hostile part is not a note root: it must be a
 * direct child of the matching typed notes-part root. A text box root must be one the part's
 * text box story walk finds. Keeping this predicate shared makes validation, protection reach,
 * and application fail closed on exactly the same scope.
 */
export function scopedRevisionRoot(part: OoxmlPart, nodeId: string): OoxmlNode | null {
  const node = findNode(part, nodeId);
  if (node === null) return null;
  if (textboxStoriesInPart(part).some((story) => story.root.id === nodeId)) return node;
  const noteKind = noteKindOf(node);
  if (noteKind === null) return null;
  const expectedRootKind = noteKind === 'footnote' ? 'footnotes' : 'endnotes';
  if (part.root.kind !== expectedRootKind) return null;
  return parentNodeOf(part, node.id)?.id === part.root.id ? node : null;
}
