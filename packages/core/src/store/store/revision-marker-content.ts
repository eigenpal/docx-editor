import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import { isRangeMarkerKind } from '../package/ooxml-shared.ts';

/** Empty revision markers cannot contain preserved content. */
export function hasRevisionMarkerContent(node: OoxmlElement): boolean {
  return node.children.some((child) => child.kind !== 'textValue' || child.value.trim().length > 0);
}

/**
 * A child that marks a position rather than holding content: bookmark, comment-range and
 * move-range boundaries, permission-range boundaries, and proofing marks.
 */
export function isInertMarker(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  if (node.kind === 'bookmarkStart' || node.kind === 'bookmarkEnd') return true;
  if (isRangeMarkerKind(node.kind)) return true;
  return (
    node.kind === 'generic' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    (node.localName === 'proofErr' ||
      node.localName === 'permStart' ||
      node.localName === 'permEnd')
  );
}

/**
 * A `w:pPr` or `w:rPr` that held nothing but the revision marks this resolution drops.
 *
 * Proposing a paragraph-mark change writes those containers when the paragraph had none, so
 * resolving the proposal removes them again. Rejecting a proposed mark deletion then restores
 * the paragraph as it was, rather than leaving an empty `w:pPr` behind. An empty container has
 * no meaning, so a run's `w:rPr` emptied the same way goes too.
 */
export function heldOnlyResolvedMarks(node: OoxmlNode, dropped: ReadonlySet<string>): boolean {
  if (node.kind === 'textValue' || node.children.length === 0) return false;
  const markProperties =
    node.kind === 'runProperties' ||
    (node.kind === 'generic' &&
      node.namespaceUri === WML_NAMESPACE_URI &&
      node.localName === 'rPr');
  if (node.kind !== 'paragraphProperties' && !markProperties) return false;
  return node.children.every((child) =>
    markProperties ? dropped.has(child.id) : heldOnlyResolvedMarks(child, dropped)
  );
}
