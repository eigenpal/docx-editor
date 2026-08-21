// The paraId ↔ node-id map: where the contract's addressing vocabulary meets the tree's.
//
// The public contract addresses paragraphs by `w14:paraId` (`DocAnchor.paraId` — the
// same handle Office JS exposes as `Paragraph.uniqueLocalId`), while the engine
// addresses them by canonical node id (structural paths, positional). This index is
// the translation, built in one `allParagraphs` walk and memoized per revision by the
// session, the same way `documentOutline` is.
//
// Scope: EVERY story the document holds — the main part, each header and footer, and the note
// parts. It was the main part alone, and the comment here pointed at `DocLocation` as the way
// to reach the rest; `resolveAnchorSelection` refuses `DocLocation` endpoints outright, so no
// addressing form reached a header paragraph at all. `snapshot().selection` was therefore null
// for the whole time the caret was in one, which is an agent unable to see where the user is.

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
  /** UPPERCASED paraId → nodeId (matching is case-insensitive). The first story to claim it. */
  readonly nodeByParaId: ReadonlyMap<string, string>;
  /** nodeId → reading-order ordinal, for document-ordering DocRange endpoints. */
  readonly ordinalByNode: ReadonlyMap<string, number>;
  /**
   * UPPERCASED paraIds more than one story claims.
   *
   * Minting is unique per PART and the contract's uniqueness is per DOCUMENT, so an authored
   * file may repeat one. Resolving such an anchor to whichever story came first would be a
   * silent wrong answer; it is refused as ambiguous instead.
   */
  readonly ambiguousParaIds: ReadonlySet<string>;
}

/** Build the index over every editable paragraph of every story, in reading order. */
export function buildParagraphAnchorIndex(parts: readonly OoxmlPart[]): ParagraphAnchorIndex {
  const paraIdByNode = new Map<string, string>();
  const nodeByParaId = new Map<string, string>();
  const ordinalByNode = new Map<string, number>();
  const ambiguousParaIds = new Set<string>();
  let ordinal = 0;
  for (const part of parts) {
    for (const paragraph of allParagraphs(part)) {
      // Ordinals run ACROSS the parts in the order given, so a comparison between two
      // paragraphs of one story stays correct and one across stories is at least stable.
      ordinalByNode.set(paragraph.id, ordinal);
      ordinal += 1;
      const paraId = validParaIdOf(paragraph);
      if (paraId === null) continue;
      paraIdByNode.set(paragraph.id, paraId);
      const canonical = paraId.toUpperCase();
      // `w14:paraId` is minted unique per PART, and the contract's uniqueness is per
      // DOCUMENT. Nothing stops an authored file repeating one across `header1.xml` and
      // `document.xml`, and first-wins would then resolve such an anchor to the body twin
      // silently. Recorded instead, so the resolver can refuse it as ambiguous.
      if (nodeByParaId.has(canonical)) ambiguousParaIds.add(canonical);
      else nodeByParaId.set(canonical, paragraph.id);
    }
  }
  return Object.freeze({ paraIdByNode, nodeByParaId, ordinalByNode, ambiguousParaIds });
}
