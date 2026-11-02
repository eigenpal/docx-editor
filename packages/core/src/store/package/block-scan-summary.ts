// One walk of a paragraph or table row for the save passes that each read the whole tree.
//
// A save makes revision ids unique, and then keeps text box fallbacks in step. Both walk every
// block of every part. Most blocks hold neither a revision nor a text box wrapper, and both
// passes only need to know that. One walk of each block answers both, and the tree is
// immutable, so a later save reuses the answer for every block an edit did not replace.

import { isMcAlternateContent } from './drawing-projection-walk.ts';
import { MC_NAMESPACE_URI, WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import { REVISION_ID_BEARING } from '../store/tree-op-revision-ids.ts';

/** The range families whose start and end share one revision id. */
export const PAIRED_RANGE_FAMILIES = [
  'moveFrom',
  'moveTo',
  'customXmlIns',
  'customXmlDel',
  'customXmlMoveFrom',
  'customXmlMoveTo',
] as const;

/** WML elements whose `w:id` is a revision id. */
const REVISION_ID_ELEMENTS: ReadonlySet<string> = new Set([
  ...REVISION_ID_BEARING,
  ...PAIRED_RANGE_FAMILIES.flatMap((family) => [`${family}RangeStart`, `${family}RangeEnd`]),
]);

/** What one walk of a block found. */
export interface BlockScanSummary {
  /** Nodes in the block, the block itself and text values included. */
  readonly size: number;
  /** Whether the block holds an `mc:AlternateContent`. */
  readonly alternateContent: boolean;
  /** Whether the block holds an element that can carry a revision id. */
  readonly revisionIds: boolean;
  /** `w:txbxContent` stories in the block, outside any `mc:Fallback`. */
  readonly textBoxes: number;
  /**
   * The revision id elements of the block in document order, when the block holds no text box
   * story and no `mc:Fallback`: then they are all of one story and all read. Otherwise null,
   * and the revision id pass walks the block itself.
   */
  readonly revisionElements: readonly OoxmlElement[] | null;
}

const summaries = new WeakMap<OoxmlElement, BlockScanSummary>();

/** The summary of a paragraph or table row, from one walk per block identity. */
export function blockScanSummary(block: OoxmlElement): BlockScanSummary {
  const known = summaries.get(block);
  if (known !== undefined) return known;
  let size = 0;
  let alternateContent = false;
  let revisionIds = false;
  let textBoxes = 0;
  let nested = false;
  const elements: OoxmlElement[] = [];
  // Children go on the stack last first, so nodes leave it in document order. A fallback's
  // copies are not stories of their own; see `RevisionIdScan.visit`.
  const nodes: OoxmlNode[] = [block];
  const inFallback: boolean[] = [false];
  while (nodes.length > 0) {
    const node = nodes.pop()!;
    const fallback = inFallback.pop()!;
    size += 1;
    if (node.kind === 'textValue') continue;
    if (node.namespaceUri === WML_NAMESPACE_URI) {
      if (REVISION_ID_ELEMENTS.has(node.localName)) {
        revisionIds = true;
        elements.push(node);
      } else if (node.localName === 'txbxContent') {
        nested = true;
        if (!fallback) textBoxes += 1;
      }
    } else if (node.namespaceUri === MC_NAMESPACE_URI && node.localName === 'Fallback') {
      nested = true;
    }
    if (!alternateContent && isMcAlternateContent(node)) alternateContent = true;
    const childFallback =
      fallback || (node.namespaceUri === MC_NAMESPACE_URI && node.localName === 'Fallback');
    const children = node.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      nodes.push(children[index]!);
      inFallback.push(childFallback);
    }
  }
  const summary = {
    size,
    alternateContent,
    revisionIds,
    textBoxes,
    revisionElements: nested ? null : elements,
  };
  summaries.set(block, summary);
  return summary;
}
