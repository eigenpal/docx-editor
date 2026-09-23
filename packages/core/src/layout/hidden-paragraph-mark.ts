// Which paragraphs a hidden paragraph mark removes from the laid-out flow.
//
// `w:vanish` in the paragraph mark's run properties (17.3.1.29 `w:pPr/w:rPr`, 17.3.2.41) hides
// the mark itself, and `w:specVanish` (17.3.2.36) hides it even where hidden text is shown.
// A hidden mark draws no break: the paragraph runs into the one after it. When the paragraph
// shows nothing else either, that join leaves nothing on the page — no line box, and no
// spacing before or after. Laying such a paragraph out as an ordinary empty line put a full
// line of blank space, plus its spacing, wherever a document hides empty paragraphs.
//
// The condition is narrow on purpose, like the revision rule in `revision-visibility.ts`:
//
//   - The mark must be hidden by DIRECT formatting. Direct formatting decides a toggle
//     outright, so no style cascade is needed; a mark hidden through a style keeps its line.
//   - The paragraph must render nothing visible. A hidden mark after visible text merges that
//     text forward, and dropping the box would lose it, so such a paragraph keeps its box.
//   - A paragraph must follow in the same container to take the join. The last paragraph of a
//     story, cell, or content control, and one before a table, keeps its line.
//   - A paragraph carrying `w:sectPr` keeps its box, so section boundaries do not move.
//
// The paragraph stays in the tree and still advances list counters: numbering is a property
// of the document, not of what the page shows. {@link numberingFlowBlocks} gives list
// resolution the block list with those paragraphs put back.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { readOnOffChild } from '../store/package/ooxml-shared.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import { paragraphRendersNothingVisible } from './revision-visibility.ts';

/** A block, and the node id of the children array it lives in. */
export interface HiddenMarkFlowEntry {
  readonly block: OoxmlElement;
  readonly parentKey: string;
}

function wmlChild(node: OoxmlNode, localName: string): OoxmlElement | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const child of node.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === WML_NAMESPACE_URI && child.localName === localName) return child;
  }
  return undefined;
}

/** `w:pPr/w:rPr` sets `w:vanish` or `w:specVanish` on. */
export function paragraphMarkHidden(paragraph: OoxmlNode): boolean {
  const properties = wmlChild(paragraph, 'pPr');
  const markRunProperties = properties && wmlChild(properties, 'rPr');
  if (!markRunProperties) return false;
  return (
    readOnOffChild(markRunProperties, 'vanish') || readOnOffChild(markRunProperties, 'specVanish')
  );
}

function carriesSectionBreak(paragraph: OoxmlNode): boolean {
  const properties = wmlChild(paragraph, 'pPr');
  return properties !== undefined && wmlChild(properties, 'sectPr') !== undefined;
}

/** Laid-out block list → the same list with the removed paragraphs back in document order. */
const numberingFlows = new WeakMap<readonly OoxmlElement[], readonly OoxmlElement[]>();

/**
 * The blocks that lay out, without the paragraphs a hidden mark removes.
 *
 * Walks backwards so a run of such paragraphs all find the paragraph that finally takes the
 * join. Returns the entries' blocks unchanged in the common case of no hidden marks.
 */
export function withoutHiddenMarkParagraphs(
  entries: readonly HiddenMarkFlowEntry[],
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter
): OoxmlElement[] {
  let removed: Set<number> | null = null;
  let next: HiddenMarkFlowEntry | undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    const { block } = entry;
    if (
      block.kind === 'paragraph' &&
      next?.block.kind === 'paragraph' &&
      next.parentKey === entry.parentKey &&
      paragraphMarkHidden(block) &&
      !carriesSectionBreak(block) &&
      paragraphRendersNothingVisible(block, displayMode, authorFilter)
    ) {
      (removed ??= new Set()).add(index);
      continue;
    }
    next = entry;
  }
  const all = entries.map((entry) => entry.block);
  if (removed === null) return all;
  const removedIndexes = removed;
  const kept = all.filter((_block, index) => !removedIndexes.has(index));
  numberingFlows.set(kept, all);
  return kept;
}

/**
 * The block list that list numbering walks: `blocks` with every paragraph a hidden mark removed
 * from the flow put back, in document order.
 *
 * Returns `blocks` itself when nothing was removed, so the list memos keyed on its identity
 * keep hitting.
 */
export function numberingFlowBlocks(blocks: readonly OoxmlElement[]): readonly OoxmlElement[] {
  return numberingFlows.get(blocks) ?? blocks;
}
