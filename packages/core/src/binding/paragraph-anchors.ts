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

import type { OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { isValidParaId, paraIdOf } from '@docx-editor.dev/core/store';
import { allParagraphs } from './tree-binding.ts';

/**
 * The validated `w14:paraId` of one paragraph NODE, remembered on the node itself.
 *
 * Nodes are immutable, so a paragraph that survives an edit carries the same answer. The
 * index is rebuilt each revision — it has to be, an edit can add or remove a paragraph —
 * and without this every rebuild re-read the attribute list and re-validated the value for
 * every paragraph in the document, including the thousands the edit never touched.
 */
const validParaIds = new WeakMap<OoxmlNode, string | null>();

function validParaIdOf(paragraph: OoxmlNode): string | null {
  const cached = validParaIds.get(paragraph);
  if (cached !== undefined) return cached;
  const paraId = paraIdOf(paragraph);
  // Validity gate, defense-in-depth: normalization guarantees valid ids, but should it ever
  // fail open on a pathological file, a junk authored value must not reach
  // `snapshot().selection` or `query('paragraphs')` — the contract says 8-hex.
  const valid = paraId === null || !isValidParaId(paraId) ? null : paraId;
  validParaIds.set(paragraph, valid);
  return valid;
}

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
    const paraId = validParaIdOf(paragraph);
    if (paraId === null) return;
    paraIdByNode.set(paragraph.id, paraId);
    const canonical = paraId.toUpperCase();
    if (!nodeByParaId.has(canonical)) nodeByParaId.set(canonical, paragraph.id);
  });
  return Object.freeze({ paraIdByNode, nodeByParaId, ordinalByNode });
}
