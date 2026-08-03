// Revision attribution and display modes for layout.
//
// The canonical tree keeps `w:ins` / `w:del` / `w:moveFrom` / `w:moveTo` as wrappers, because
// the tree is the authored state and an unedited round trip must stay fingerprint-identical.
// Layout does not get to flatten them away either — it needs to know which text is tracked, by
// whom, in order to present it. So the projection carries an ATTRIBUTION alongside each piece
// rather than rewriting the tree into a resolved shape.
//
// The display mode is an input to that projection, never a mutation. "Show the proposed result"
// implemented as accept-all would mean a user who switches view, saves, and sends the file has
// silently accepted every proposal in it.

import {
  isContentRevisionKind,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core-contract/store';

/**
 * What a revision wrapper asserts about the content inside it.
 *
 * `moveFrom` / `moveTo` are deliberately distinct from `delete` / `insert`: a move is one
 * decision with two halves, and presenting it as an unrelated deletion and insertion invites
 * resolving one without the other, which duplicates or loses the content.
 */
export type RevisionKind = 'insert' | 'delete' | 'moveFrom' | 'moveTo';

/**
 * One revision wrapper's provenance, as authored.
 *
 * `id` is the verbatim `@w:id` string rather than a number: `ST_DecimalNumber` restricts
 * `xsd:integer` with no bounds, so a file may carry a value outside the safe integer range, and
 * parsing it to a number would silently merge two distinct revisions.
 *
 * `date` is absent when the file omits it. `@w:date` is optional on `CT_TrackChange`, and
 * inventing one is a silent content change.
 */
export interface RevisionAttribution {
  readonly kind: RevisionKind;
  readonly id: string;
  readonly author: string;
  readonly date?: string;
  /** The wrapper's node id, so a surface can address this exact site. */
  readonly nodeId: string;
}

/**
 * Which revisions layout resolves before producing pages.
 *
 * - `all-markup` shows both halves of every change.
 * - `proposed` shows what the document becomes if every change is accepted.
 * - `original` shows what it was before any of them.
 *
 * The last two are specified as equal to accept-all and reject-all OUTPUT, which is what makes
 * them testable, without either applying an op.
 */
export type RevisionDisplayMode = 'all-markup' | 'proposed' | 'original';

export const DEFAULT_REVISION_DISPLAY_MODE: RevisionDisplayMode = 'all-markup';

/** No enclosing revision. Shared so the common untracked case allocates nothing. */
export const NO_REVISIONS: readonly RevisionAttribution[] = Object.freeze([]);

/**
 * Nested revision wrappers deeper than this stop being descended.
 *
 * A file is attacker-controlled, and depth is the cheapest unbounded axis in it. Content below
 * the cap is preserved in the tree and simply not laid out, which is the same conservative
 * answer the rest of the projection gives when a budget runs out.
 */
const MAX_REVISION_NESTING = 32;

const KIND_BY_NODE_KIND: Readonly<Record<string, RevisionKind>> = {
  revisionInsert: 'insert',
  revisionDelete: 'delete',
  revisionMoveFrom: 'moveFrom',
  revisionMoveTo: 'moveTo',
};

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  for (const attribute of node.attributes) {
    if (attribute.localName !== localName) continue;
    // WML attributes are namespaced; an unprefixed same-named attribute is someone else's.
    if (attribute.namespaceUri !== node.namespaceUri) continue;
    if (attribute.kind === 'wmlVal' || attribute.kind === 'genericExtension')
      return attribute.value;
    if (attribute.kind === 'xmlSpace') return attribute.value;
  }
  return undefined;
}

/**
 * The attribution a content-revision wrapper carries, or null when it is not one.
 *
 * A wrapper missing `@w:author` still yields an attribution with an empty author: the schema
 * requires the attribute, but a file that omits it must still render its content rather than
 * being refused, and the empty author is visible rather than invented.
 */
export function revisionAttributionOf(node: OoxmlNode): RevisionAttribution | null {
  if (node.kind === 'textValue') return null;
  const kind = KIND_BY_NODE_KIND[node.kind];
  if (kind === undefined) return null;
  const date = attributeValue(node, 'date');
  return {
    kind,
    id: attributeValue(node, 'id') ?? '',
    author: attributeValue(node, 'author') ?? '',
    ...(date === undefined ? {} : { date }),
    nodeId: node.id,
  };
}

/** Push one wrapper's attribution onto an enclosing stack, outermost first. */
export function withRevision(
  enclosing: readonly RevisionAttribution[],
  attribution: RevisionAttribution
): readonly RevisionAttribution[] {
  return enclosing.length === 0 ? [attribution] : [...enclosing, attribution];
}

/** True when the node is a wrapper layout should descend into rather than skip. */
export function isRevisionWrapper(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue' && isContentRevisionKind(node.kind);
}

export const MAX_REVISION_DEPTH = MAX_REVISION_NESTING;

/**
 * Whether content under this stack of revisions is laid out in the given mode.
 *
 * Containment governs, so a single enclosing wrapper the mode resolves away suppresses
 * everything inside it regardless of what the inner wrappers say. An insertion inside a
 * deletion does not survive the proposed result: the deletion it sits in was accepted.
 */
export function revisionsVisible(
  revisions: readonly RevisionAttribution[],
  mode: RevisionDisplayMode
): boolean {
  if (mode === 'all-markup' || revisions.length === 0) return true;
  for (const revision of revisions) {
    const removed =
      mode === 'proposed'
        ? revision.kind === 'delete' || revision.kind === 'moveFrom'
        : revision.kind === 'insert' || revision.kind === 'moveTo';
    if (removed) return false;
  }
  return true;
}

/** True when this stack of revisions marks its content as deleted from the live document. */
export function revisionsAreDeletion(revisions: readonly RevisionAttribution[]): boolean {
  return revisions.some((revision) => revision.kind === 'delete' || revision.kind === 'moveFrom');
}
