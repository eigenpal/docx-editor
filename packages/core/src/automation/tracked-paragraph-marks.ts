// Which paragraph marks a tracked deletion may strike, and which paragraph follows one.
//
// Accepting a struck mark joins the paragraph to the next one. Some content cannot survive
// that join, so a tracked deletion refuses to strike those marks rather than propose a
// change whose acceptance damages the document.
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { findNode, parentNodeOf } from '../store/package/ooxml-edit.ts';
import { fldCharType } from '../store/package/field-nodes.ts';
import { namedChild, paragraphPropertiesNodeOf } from '../store/store/tree-op-nodes.ts';
import { isInertMarker } from '../store/store/revision-marker-content.ts';
import type { AutomationError } from './protocol.ts';

const refusal = (message: string, detail: string): AutomationError => ({
  code: 'unsupported-capability',
  message,
  detail,
});

/**
 * Why a tracked deletion may not strike this paragraph's mark, or null.
 *
 * - A mark with `w:sectPr` ends a section. Joining it would merge two sections.
 * - An inline content control would survive the join as an empty control shell.
 * - A complex field that starts or ends in this paragraph and closes in another would take
 *   the next paragraph's text as its result.
 */
export function markStrikeRefusal(part: OoxmlPart, paragraphId: string): AutomationError | null {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return null;
  if (namedChild(paragraphPropertiesNodeOf(paragraph), 'sectPr'))
    return refusal('a tracked deletion cannot remove a section break', 'section-mark');
  let control = false;
  let fieldDepth = 0;
  let unbalanced = false;
  const visit = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > 64) return;
    if (node.kind === 'contentControl') control = true;
    if (node.kind === 'fldChar') {
      const type = fldCharType(node);
      if (type === 'begin') fieldDepth += 1;
      else if (type === 'end') {
        if (fieldDepth === 0) unbalanced = true;
        else fieldDepth -= 1;
      }
    }
    for (const child of node.children) visit(child, depth + 1);
  };
  for (const child of paragraph.children) visit(child, 0);
  if (control)
    return refusal(
      'a tracked paragraph deletion cannot remove an inline content control',
      'control'
    );
  if (unbalanced || fieldDepth > 0)
    return refusal('a field crosses this paragraph mark', 'cross-paragraph-field');
  return null;
}

/**
 * The paragraph that directly follows this one in its container, skipping position markers
 * such as bookmark ends between paragraphs. Null when something else follows, or nothing.
 */
export function nextSiblingParagraph(part: OoxmlPart, paragraphId: string): OoxmlNode | null {
  const parent = parentNodeOf(part, paragraphId);
  if (!parent) return null;
  const at = parent.children.findIndex((child) => child.id === paragraphId);
  if (at < 0) return null;
  for (const sibling of parent.children.slice(at + 1)) {
    if (sibling.kind === 'paragraph') return sibling;
    if (!isInertMarker(sibling)) return null;
  }
  return null;
}
