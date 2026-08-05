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
  WML_NAMESPACE_URI,
  isContentRevisionKind,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';

/**
 * What a revision wrapper asserts about the content inside it.
 *
 * `moveFrom` / `moveTo` are deliberately distinct from `delete` / `insert`: a move is one
 * decision with two halves, and presenting it as an unrelated deletion and insertion invites
 * resolving one without the other, which duplicates or loses the content.
 */
export type RevisionKind = 'insert' | 'delete' | 'moveFrom' | 'moveTo' | 'format';

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

/**
 * How a document renders tracked changes when nothing says otherwise.
 *
 * `all-markup` matches Word's own default: a reader who opens a document with pending changes
 * sees them, rather than a clean-looking document hiding edits nobody has accepted.
 */
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

/**
 * The revision on a paragraph's own MARK, from `w:pPr/w:rPr/w:ins|w:del`.
 *
 * `EG_ParaRPrTrackChanges` records that the pilcrow itself was inserted or deleted, which is how
 * Word writes a paragraph split or merge. It is not content — there is no text to decorate — so
 * a surface shows it as a mark of its own beside the paragraph, the way Word draws a struck-
 * through ¶.
 *
 * Property-position `w:ins`/`w:del` stay `generic` in the tree deliberately, so this reads them
 * by name rather than by kind.
 */
export function paragraphMarkRevisionOf(paragraph: OoxmlNode): RevisionAttribution | null {
  if (paragraph.kind === 'textValue') return null;
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  if (!pPr || pPr.kind === 'textValue') return null;
  const rPr = pPr.children.find((child) => child.kind === 'runProperties');
  if (!rPr || rPr.kind === 'textValue') return null;
  for (const child of rPr.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri !== WML_NAMESPACE_URI) continue;
    const kind = child.localName === 'ins' ? 'insert' : child.localName === 'del' ? 'delete' : null;
    if (kind === null) continue;
    const date = attributeValue(child, 'date');
    return {
      kind,
      id: attributeValue(child, 'id') ?? '',
      author: attributeValue(child, 'author') ?? '',
      ...(date === undefined ? {} : { date }),
      nodeId: child.id,
    };
  }
  return null;
}

/**
 * The tracked FORMAT change on a property list, from `w:rPrChange` or `w:pPrChange`.
 *
 * A property change alters no characters, so it has no span of its own to strike or underline.
 * Word marks the affected text and says what changed; the minimum a reader needs is to see that
 * this text's formatting is itself a pending decision.
 *
 * Read from the flattened property list because that is what layout already carries — the
 * change wrapper is a `w:rPr`/`w:pPr` child like any other.
 */
export function formatRevisionOf(
  properties: readonly {
    readonly localName: string;
    readonly attributes?: Readonly<Record<string, string>>;
  }[]
): RevisionAttribution | null {
  for (const property of properties) {
    if (property.localName !== 'rPrChange' && property.localName !== 'pPrChange') continue;
    const attributes = property.attributes ?? {};
    const date = attributes.date;
    return {
      kind: 'format',
      id: attributes.id ?? '',
      author: attributes.author ?? '',
      ...(date === undefined ? {} : { date }),
      nodeId: '',
    };
  }
  return null;
}

/** True when this stack of revisions marks its content as deleted from the live document. */
export function revisionsAreDeletion(revisions: readonly RevisionAttribution[]): boolean {
  return revisions.some((revision) => revision.kind === 'delete' || revision.kind === 'moveFrom');
}
