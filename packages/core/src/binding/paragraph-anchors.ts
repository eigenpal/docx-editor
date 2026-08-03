// The paraId ↔ node-id map: where the contract's addressing vocabulary meets the tree's.
//
// The public contract addresses paragraphs by `w14:paraId` (`DocAnchor.paraId` — the
// same handle Office JS exposes as `Paragraph.uniqueLocalId`), while the engine
// addresses them by canonical node id (structural paths, positional). This index is
// the translation, built in one `allParagraphs` walk and memoized per revision by the
// session, the same way `documentOutline` is.
//
// Scope: the EDITABLE set of the main document part (body + table cells + block
// SDTs). Header/footer/footnote paragraphs are `DocLocation` territory — the contract
// keeps a structural address form precisely "for content the paraId map cannot reach".

import type { OoxmlPart } from '@docx-editor.dev/core-contract/store';
import { isValidParaId, paraIdOf } from '@docx-editor.dev/core-contract/store';
import { allParagraphs } from './tree-binding.ts';

export interface ParagraphAnchorIndex {
  /** nodeId → `w14:paraId`, verbatim as authored/minted. Paragraphs without one are absent. */
  readonly paraIdByNode: ReadonlyMap<string, string>;
  /** UPPERCASED paraId → nodeId (matching is case-insensitive). First occurrence wins on the impossible-by-invariant duplicate. */
  readonly nodeByParaId: ReadonlyMap<string, string>;
  /** nodeId → reading-order ordinal, for document-ordering DocRange endpoints. */
  readonly ordinalByNode: ReadonlyMap<string, number>;
}

/** Build the index over every editable paragraph of the part, in reading order. */
export function buildParagraphAnchorIndex(part: OoxmlPart): ParagraphAnchorIndex {
  const paraIdByNode = new Map<string, string>();
  const nodeByParaId = new Map<string, string>();
  const ordinalByNode = new Map<string, number>();
  allParagraphs(part).forEach((paragraph, ordinal) => {
    ordinalByNode.set(paragraph.id, ordinal);
    const paraId = paraIdOf(paragraph);
    // Validity gate, defense-in-depth: normalization guarantees valid ids, but should
    // it ever fail open on a pathological file, a junk authored value must not reach
    // `snapshot().selection` or `query('paragraphs')` — the contract says 8-hex.
    if (paraId === null || !isValidParaId(paraId)) return;
    paraIdByNode.set(paragraph.id, paraId);
    const canonical = paraId.toUpperCase();
    if (!nodeByParaId.has(canonical)) nodeByParaId.set(canonical, paragraph.id);
  });
  return Object.freeze({ paraIdByNode, nodeByParaId, ordinalByNode });
}
