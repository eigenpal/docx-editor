// A tracked insertion that lands inside another author's pending insertion.
//
// Nested, the new `w:ins` would belong to their proposal: rejecting theirs removes the new
// words, and accepting the new words leaves them inside a pending insertion. So the other
// author's wrapper splits at the landing point instead. Both halves keep the same revision
// triple, which every reader groups into one decision, and the new insertion sits between
// them as a decision of its own.
import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { insertionAuthor } from './tree-op-retraction.ts';

/**
 * `nodes` with every wrapper in `wrapperIds` lifted out of each enclosing insertion by
 * another author that is its direct parent.
 *
 * Only a direct parent splits. A wrapper deeper inside a link, a content control, or another
 * container stays where it is, because those containers cannot split without duplicating
 * their identity.
 */
export function liftedOutOfForeignInsertions(
  nodes: readonly OoxmlNode[],
  wrapperIds: ReadonlySet<string>,
  author: string,
  mint: () => string
): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'textValue' || wrapperIds.has(node.id) || !holdsAny(node, wrapperIds)) {
      out.push(node);
      continue;
    }
    const children = liftedOutOfForeignInsertions(node.children, wrapperIds, author, mint);
    const foreign =
      node.kind === 'revisionInsert' && (insertionAuthor([node]) ?? author) !== author;
    if (!foreign || !children.some((child) => wrapperIds.has(child.id))) {
      out.push({ ...node, children } as OoxmlNode);
      continue;
    }
    let part: OoxmlNode[] = [];
    let first = true;
    const flush = () => {
      if (part.length)
        out.push({ ...node, id: first ? node.id : mint(), children: part } as OoxmlNode);
      if (part.length) first = false;
      part = [];
    };
    for (const child of children) {
      if (child.kind !== 'textValue' && wrapperIds.has(child.id)) {
        flush();
        out.push(child);
      } else part.push(child);
    }
    flush();
  }
  return out;
}

function holdsAny(node: OoxmlNode, ids: ReadonlySet<string>): boolean {
  if (node.kind === 'textValue') return false;
  return node.children.some((child) => ids.has(child.id) || holdsAny(child, ids));
}
