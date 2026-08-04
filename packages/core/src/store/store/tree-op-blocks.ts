// Block removal: what `deleteBlock` may take out of the tree, and what it must refuse.
//
// A removal is the one edit that can leave a container the rest of the engine cannot read —
// a `w:tc` with no paragraph, a `w:tbl` with no row, a document with nowhere to put the
// caret. Every other op edits inside a block that stays. So the guards live here, run before
// any tree work, and the applier is nothing but the `removeNode` primitive plus an effect.
//
// Split out of tree-op-validate.ts because that module is at its size limit, and because the
// invariants a removal protects are a subject of their own rather than more of the offset
// and property checking that fills it.

import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { findNode, parentNodeOf } from '../package/ooxml-edit.ts';
import { namedChild, paragraphPropertiesNodeOf } from './tree-op-nodes.ts';
import type { TreeOpRejection } from './tree-op-validate.ts';

/** The block kinds a removal may name — exactly the ones the canonical tree types. */
const REMOVABLE_BLOCK_KINDS: ReadonlySet<string> = new Set(['paragraph', 'table', 'tableRow']);

/** Every paragraph id inside a subtree, the target itself included when it is one. */
export function paragraphIdsWithin(node: OoxmlNode): string[] {
  const ids: string[] = [];
  const walk = (current: OoxmlNode): void => {
    if (current.kind === 'textValue') return;
    if (current.kind === 'paragraph') ids.push(current.id);
    for (const child of current.children) walk(child);
  };
  walk(node);
  return ids;
}

/** Whether any paragraph would remain in the part once `blockId`'s subtree is gone. */
function paragraphSurvivesRemoval(part: OoxmlPart, blockId: string): boolean {
  let found = false;
  const walk = (node: OoxmlNode): void => {
    if (found || node.kind === 'textValue' || node.id === blockId) return;
    if (node.kind === 'paragraph') {
      found = true;
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return found;
}

/** How many children of a kind a container would keep once `blockId` leaves it. */
function remainingChildrenOfKind(parent: OoxmlNode, kind: string, blockId: string): number {
  if (parent.kind === 'textValue') return 0;
  return parent.children.filter((child) => child.kind === kind && child.id !== blockId).length;
}

export function validateDeleteBlock(part: OoxmlPart, blockId: string): TreeOpRejection | null {
  if (typeof blockId !== 'string' || blockId.length === 0) return 'unknown-block';
  const block = findNode(part, blockId);
  if (!block) return 'unknown-block';
  if (block.kind === 'textValue' || !REMOVABLE_BLOCK_KINDS.has(block.kind)) return 'not-a-block';

  const parent = parentNodeOf(part, blockId);
  // The root has no parent, so there is no child sequence to remove it from — and a part
  // without a root is not a part.
  if (!parent) return 'not-a-block';

  if (block.kind === 'paragraph') {
    // A `w:sectPr` in a paragraph's mark is not formatting: it is where a section ENDS
    // (17.6.17). `joinParagraphs` carries that mark onto the survivor; a removal has no
    // survivor to carry it to, and dropping it merges the section into the one that
    // follows — taking that section's page size, orientation and headers over every page.
    if (namedChild(paragraphPropertiesNodeOf(block), 'sectPr')) return 'carries-section-mark';
    // A cell must end with a paragraph (17.4.66); one with none is markup Word rejects and
    // a cell the caret can never enter.
    if (
      parent.kind === 'tableCell' &&
      remainingChildrenOfKind(parent, 'paragraph', blockId) === 0
    ) {
      return 'block-required';
    }
  }

  if (block.kind === 'tableRow' && remainingChildrenOfKind(parent, 'tableRow', blockId) === 0) {
    // A `w:tbl` with no `w:tr` has no content and no geometry. Removing the last row means
    // removing the table, which is a different op the caller has to ask for.
    return 'block-required';
  }

  // A table nested in a cell is the cell's content; taking it out must still leave the
  // paragraph a cell has to end with.
  if (
    block.kind === 'table' &&
    parent.kind === 'tableCell' &&
    remainingChildrenOfKind(parent, 'paragraph', blockId) === 0
  ) {
    return 'block-required';
  }

  // Whatever the kind: the part must keep somewhere to put the caret. A document with no
  // paragraph at any depth has no editable position at all, and every consumer that clamps
  // a selection to the first paragraph would have nothing to clamp to.
  if (!paragraphSurvivesRemoval(part, blockId)) return 'block-required';

  return null;
}
