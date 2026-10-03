// Which tracked-change sites of a part sit in a text box story.
//
// INTERNAL. A text box's `w:txbxContent` lives inside its owner's part, so a part-wide revision
// read or decision for the body, a header or a footer also reaches every text box it anchors.
// A text box is its own story, the way `Body.text` and `search` already treat it, so its changes
// are listed and decided through `Shape.body` and are left out of the owner's.
//
// The VML fallback copy of a box (`mc:Fallback`) is a shadow of the DrawingML story: export
// rewrites it from that story (`textbox-fallback-export.ts`), so its sites belong to no story.

import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';

/** Node ids inside a text box story, each mapped to the outermost `w:txbxContent` holding it. */
export type TextboxSiteIndex = ReadonlyMap<string, string>;

const MAX_DEPTH = 256;
const cache = new WeakMap<OoxmlNode, TextboxSiteIndex>();
const EMPTY: TextboxSiteIndex = new Map();

function isTextboxContent(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === 'txbxContent'
  );
}

/** Every node id under a `w:txbxContent` in the part, DrawingML and VML copies alike. */
export function textboxSiteIndex(part: OoxmlPart): TextboxSiteIndex {
  const cached = cache.get(part.root);
  if (cached) return cached;
  const index = new Map<string, string>();
  const stack: { node: OoxmlNode; root: string | null; depth: number }[] = [
    { node: part.root, root: null, depth: 0 },
  ];
  while (stack.length > 0) {
    const { node, root, depth } = stack.pop()!;
    if (node.kind === 'textValue' || depth > MAX_DEPTH) continue;
    const owner = root ?? (isTextboxContent(node) ? node.id : null);
    if (owner !== null) index.set(node.id, owner);
    for (const child of node.children) stack.push({ node: child, root: owner, depth: depth + 1 });
  }
  const answer = index.size === 0 ? EMPTY : index;
  cache.set(part.root, answer);
  return answer;
}

/**
 * Whether a revision decision belongs to a story, by where its sites are.
 *
 * `textboxRootId` names the story's own `w:txbxContent`, or is null for the part's owning story.
 * A decision with no sites is answered by `fallback`, the story's range-based membership.
 */
export function sitesInStory(
  index: TextboxSiteIndex,
  siteIds: readonly string[],
  textboxRootId: string | null,
  fallback: () => boolean
): boolean {
  if (siteIds.length === 0) return textboxRootId === null && fallback();
  if (textboxRootId === null) return siteIds.every((id) => !index.has(id)) && fallback();
  return siteIds.every((id) => index.get(id) === textboxRootId);
}
