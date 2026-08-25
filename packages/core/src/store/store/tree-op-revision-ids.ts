// Minting `@w:id` values for NEW revisions — the id space the tracked-edit appliers draw on.
//
// Split from `tree-op-tracked.ts`, which owns the wrappers and placement rules; this module
// owns only the question "which id is free in this part".

import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';

/**
 * The next free `@w:id` for a revision in this part.
 *
 * `ST_DecimalNumber`, and only ever compared for equality — Word writes them densely from
 * zero and nothing reads them as an order. Taking one past the highest in use keeps a new
 * revision from joining an existing one by accident, which is what an id collision means.
 */
export function nextRevisionId(part: OoxmlPart): () => string {
  let highest = -1;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    // REVISION ids only. `@w:id` is also carried by bookmarks, comments and permissions,
    // and those are separate id spaces — a `w:bookmarkStart` id is attacker-controlled and
    // unbounded (`ST_DecimalNumber` is xsd:integer), so scanning them all let a 23-digit
    // bookmark id produce `w:id="1e+22"`: not an integer, and a file Word calls unreadable.
    if (REVISION_ID_BEARING.has(node.localName) && node.namespaceUri === WML_NAMESPACE_URI) {
      for (const attribute of node.attributes) {
        if (attribute.namespaceUri !== WML_NAMESPACE_URI || attribute.localName !== 'id') continue;
        // Strictly parsed and clamped: Word reads a revision id as a 32-bit signed integer,
        // so a larger value is not something to count past — it is something to ignore.
        if (!/^\d{1,10}$/.test(attribute.value)) continue;
        const value = Number(attribute.value);
        if (value <= MAX_REVISION_ID && value > highest) highest = value;
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  let next = highest + 1;
  return () => {
    // Past the ceiling there is no "one higher" left, and clamping to it would hand back an
    // id the file already uses — turning every edit the user makes into a member of somebody
    // else's revision, which a crafted `@w:id` could force deliberately. Wrap and take the
    // lowest id nobody is using instead.
    if (next > MAX_REVISION_ID) {
      const used = usedRevisionIds(part);
      for (let candidate = 0; candidate <= MAX_REVISION_ID; candidate += 1) {
        if (!used.has(String(candidate))) return String(candidate);
      }
      // Two billion revisions in one part is not a document; refuse to invent a collision.
      throw new TypeError('no free revision id');
    }
    return String(next++);
  };
}

/** Every revision id in use, for the wrap-around case. */
function usedRevisionIds(part: OoxmlPart): Set<string> {
  const used = new Set<string>();
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (REVISION_ID_BEARING.has(node.localName) && node.namespaceUri === WML_NAMESPACE_URI) {
      for (const attribute of node.attributes) {
        if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'id') {
          used.add(attribute.value);
        }
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return used;
}

/**
 * The elements whose `@w:id` is a REVISION id. Every other `@w:id` is a different space.
 *
 * Matched on LOCAL NAME, not on the typed kind: only the four content wrappers get a kind of
 * their own, and `w:cellIns`, `w:trPr/w:ins`, `w:rPrChange` and the rest read as `generic`.
 * Keying on kind missed them, so a document whose only revisions were a tracked row
 * insertion minted an id already in use — and the new edit then shared an address with a
 * structural revision the engine refuses, which marked the user's own insertion read-only.
 */
const REVISION_ID_BEARING: ReadonlySet<string> = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'cellIns',
  'cellDel',
  'cellMerge',
  'rPrChange',
  'pPrChange',
  'tblPrChange',
  'tblPrExChange',
  'tcPrChange',
  'trPrChange',
  'sectPrChange',
  'tblGridChange',
  'numberingChange',
]);

/** `ST_DecimalNumber` is unbounded; Word's reader is not. */
const MAX_REVISION_ID = 2147483647;
