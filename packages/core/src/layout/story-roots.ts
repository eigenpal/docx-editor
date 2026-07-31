// Story roots over the canonical tree (phase 2 of the legacy-lane retirement).
//
// A STORY is a flowable sequence of blocks: the body of the main document, or the whole
// content of a header/footer part (`w:hdr`/`w:ftr` roots hold block content directly).
// This is the single place that knows which roots flow and how block-level `w:sdt`
// wrappers flatten — the tree lane's one `flattenSdt`, replacing the four copies the
// legacy lane carried.
//
// SDT content flattens TRANSPARENTLY: the paragraphs and tables inside `w:sdtContent`
// join the flow in reading order (Word renders them in place), while the `w:sdt` wrapper
// itself stays a generic node the serializer round-trips. SDT chrome — placeholder text,
// locks, dropdown behaviour — is not modelled.

import type { OoxmlElement, OoxmlNode, OoxmlPart } from '@docx-editor.dev/core-contract/store';

/** Nested `w:sdt` wrappers deeper than this stop flattening; content stays preserved. */
const MAX_SDT_NESTING = 32;

/** Roots whose children are block content: the body, and header/footer part roots. */
function storyRootOf(part: OoxmlPart): OoxmlElement | undefined {
  const root = part.root;
  if (root.localName === 'hdr' || root.localName === 'ftr') return root;
  const findBody = (node: OoxmlNode): OoxmlElement | undefined => {
    if (node.kind === 'textValue') return undefined;
    if (node.kind === 'body') return node;
    for (const child of node.children) {
      const found = findBody(child);
      if (found) return found;
    }
    return undefined;
  };
  return findBody(root);
}

/**
 * The story's blocks — paragraphs and tables — in document order, flattening through
 * block-level SDT wrappers.
 */
export function storyBlocks(part: OoxmlPart): OoxmlElement[] {
  const root = storyRootOf(part);
  if (!root) return [];
  const blocks: OoxmlElement[] = [];
  const collect = (children: readonly OoxmlNode[], depth: number): void => {
    for (const child of children) {
      if (child.kind === 'paragraph' || child.kind === 'table') {
        blocks.push(child);
        continue;
      }
      if (child.kind === 'generic' && child.localName === 'sdt' && depth < MAX_SDT_NESTING) {
        for (const inner of child.children) {
          if (inner.kind !== 'textValue' && inner.localName === 'sdtContent') {
            collect(inner.children, depth + 1);
          }
        }
      }
    }
  };
  collect(root.children, 0);
  return blocks;
}
