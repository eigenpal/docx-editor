// Clipboard fragment merge: a read-back fragment package lands in a target package
// (rich-clipboard-fidelity tasks 2.2-2.4).
//
// Identifier discipline over trust: style ids reuse by definition fingerprint or import
// under fresh ids and derived unique names; numbering ids always remap; relationship ids
// are freshly allocated PER OWNER PART (rel-id namespaces are per part, and so are note
// ids — footnotes and endnotes each count from 1); media dedupes by content hash; every
// document-unique namespace the fragment carries (bookmarks, `wp:docPr`, SDT ids,
// revision ids) is freshened, in note bodies as well as blocks. The caller applies the
// returned package transform through `ctx.applyPackage` inside the same transaction as
// `insertFragment`, promoted to a package undo unit.

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { withPart } from '../package/ooxml-package.ts';
import {
  relationshipsOf,
  resolveContentTypeOf,
  withNewPart,
  withRelationship,
  withRelationships,
  withRelationshipsPartFor,
} from '../package/package-edit.ts';
import {
  withBinaryParts,
  allocateDrawingPropertyId,
  validateEmbeddedImageBytes,
} from '../package/drawing-package-edit.ts';
import { sniffImageMime, type SupportedImageMime } from '../package/image-resources.ts';
import { ensureHyperlinkRelationship } from '../package/hyperlink-part.ts';
import { ensureNotesPart } from '../package/note-lifecycle.ts';
import { resolveNotesPart } from '../package/note-references.ts';
import { resolveInternalTarget } from '../package/opc-names.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';
import { createNodeIdAllocator, insertChildren } from '../package/ooxml-edit.ts';
import { sha256FontBytes } from '../package/sha256.ts';
import { attributeValueOf, cloneWithNewIds } from './tree-op-nodes.ts';
import {
  isElementNode,
  isWml,
  materializeDefaults,
  nodeSignature,
  styleSignature,
  stylesInfoOf,
  walkAll,
} from './clipboard-fragment-defaults.ts';
import { withRequiredNamespaceBindings } from './tree-op-fragment.ts';
import { sanitizeFragmentBlocks } from './clipboard-fragment-sanitize.ts';
import {
  REVISION_KINDS,
  freshUniqueId,
  freshUniqueName,
  rewriteIdentifiers,
  withRewrittenAttribute,
} from './clipboard-fragment-identifiers.ts';

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HYPERLINK_REL = `${R_NS}/hyperlink`;
const IMAGE_REL = `${R_NS}/image`;
const NUMBERING_REL = `${R_NS}/numbering`;
const STYLES_REL = `${R_NS}/styles`;
const NUMBERING_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
const STYLES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';

export type FragmentMergeRejection = 'no-fragment-document' | 'no-target-part' | 'merge-refused';

export type FragmentMergeResult =
  | {
      readonly ok: true;
      readonly pkg: OoxmlPackage;
      /** The fragment blocks, rewritten to target identifiers, ready for `insertFragment`. */
      readonly blocks: readonly OoxmlNode[];
    }
  | { readonly ok: false; readonly reason: FragmentMergeRejection };

function relatedPart(
  pkg: OoxmlPackage,
  owner: string,
  relType: string,
  fallback: string
): OoxmlPart | null {
  for (const record of relationshipsOf(pkg, owner)) {
    if (record.type !== relType || record.targetMode === 'External') continue;
    const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
    if (resolved.ok) {
      const part = pkg.parts.get(resolved.partName);
      if (part) return part;
    }
  }
  return pkg.parts.get(fallback) ?? null;
}

function maxNumericAttribute(
  root: OoxmlNode,
  match: (node: OoxmlNode) => string | undefined
): number {
  let max = 0;
  walkAll([root], (node) => {
    const value = match(node);
    if (value === undefined) return;
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > max) max = parsed;
  });
  return max;
}

function appendToPart(
  pkg: OoxmlPackage,
  part: OoxmlPart,
  nodes: readonly OoxmlNode[],
  index?: number
): OoxmlPackage | null {
  if (nodes.length === 0) return pkg;
  const nextId = createNodeIdAllocator(part);
  const cloned = nodes.map((node) => cloneWithNewIds(node, nextId));
  const bound = withRequiredNamespaceBindings(part, cloned);
  const at = index ?? bound.root.children.length;
  const inserted = insertChildren(bound, bound.root.id, at, cloned, { deferValidation: true });
  if (!inserted.ok) return null;
  return withPart(pkg, inserted.part);
}

/** Collect every `r:*` relationship id referenced under the nodes. */
function relationshipIdsIn(nodes: readonly OoxmlNode[]): Set<string> {
  const ids = new Set<string>();
  walkAll(nodes, (node) => {
    if (node.kind === 'textValue') return;
    for (const attribute of node.attributes) {
      if (attribute.namespaceUri === R_NS && attribute.value.length > 0) {
        ids.add(attribute.value);
      }
    }
  });
  return ids;
}

/**
 * Resolve references to relationships that could not merge: a drawing whose media rel was
 * dropped is removed; a `w:hyperlink` whose `r:id` was dropped (a refused `javascript:`
 * target, say) is UNWRAPPED to its runs, so the text survives without a dangling — or
 * worse, accidentally re-resolving — relationship id.
 */
function withoutDanglingDrawings(
  nodes: readonly OoxmlNode[],
  dropRelIds: ReadonlySet<string>
): OoxmlNode[] {
  if (dropRelIds.size === 0) return [...nodes];
  const rewrite = (node: OoxmlNode): OoxmlNode | OoxmlNode[] | null => {
    if (node.kind === 'textValue') return node;
    if (node.kind === 'drawing') {
      let dangling = false;
      walkAll([node], (inner) => {
        if (inner.kind === 'textValue') return;
        for (const attribute of inner.attributes) {
          if (attribute.namespaceUri === R_NS && dropRelIds.has(attribute.value)) dangling = true;
        }
      });
      return dangling ? null : node;
    }
    if (node.kind === 'hyperlink') {
      const relId = node.attributes.find((attribute) => attribute.namespaceUri === R_NS)?.value;
      if (relId !== undefined && dropRelIds.has(relId)) {
        // Unwrap: lift the link's (rewritten) children into the parent, drop the wrapper.
        return rewriteChildren(node.children);
      }
    }
    const children = rewriteChildren(node.children);
    return children.length === node.children.length &&
      children.every((child, index) => child === node.children[index])
      ? node
      : ({ ...node, children } as OoxmlNode);
  };
  function rewriteChildren(children: readonly OoxmlNode[]): OoxmlNode[] {
    const out: OoxmlNode[] = [];
    for (const child of children) {
      const kept = rewrite(child);
      if (kept === null) continue;
      if (Array.isArray(kept)) out.push(...kept);
      else out.push(kept);
    }
    return out;
  }
  return rewriteChildren(nodes);
}

const SUPPORTED_RASTER_MIMES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/bmp',
  'image/webp',
]);

/** Aliases OPC files legitimately declare for the same signature class. */
const DECLARED_MIME_ALIASES: Readonly<Record<string, string>> = {
  'image/jpg': 'image/jpeg',
  'image/x-ms-bmp': 'image/bmp',
  'image/x-bmp': 'image/bmp',
};

/**
 * The content type fragment media is admitted under, or null to drop it.
 *
 * Signature over claim: the sniffed mime must agree with the declared class, and a
 * supported raster must additionally pass the same header + dimension gate the
 * insert-image lane applies (`validateEmbeddedImageBytes`). Vector and preserved formats
 * (SVG, TIFF, EMF, WMF) travel signature-checked; the paint lane re-validates and renders
 * them inert.
 */
function admittedMediaMime(bytes: Uint8Array, declaredType: string): string | null {
  const sniffed = sniffImageMime(bytes);
  if (sniffed === 'unknown') return null;
  const normalizedDeclared = Object.hasOwn(DECLARED_MIME_ALIASES, declaredType)
    ? DECLARED_MIME_ALIASES[declaredType]!
    : declaredType;
  if (normalizedDeclared !== sniffed) return null;
  if (SUPPORTED_RASTER_MIMES.has(sniffed)) {
    if (!validateEmbeddedImageBytes(bytes, sniffed as SupportedImageMime)) return null;
  }
  return sniffed;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Merge a fragment package's resources into `target` and rewrite the fragment blocks to
 * the target's identifiers. Pure: returns a new package; the caller commits it through
 * `ctx.applyPackage` beside the `insertFragment` op.
 */
export function mergeFragmentIntoPackage(
  target: OoxmlPackage,
  fragment: OoxmlPackage,
  ownerPartName: string
): FragmentMergeResult {
  const fragmentDoc = fragment.parts.get(fragment.mainDocumentPart);
  if (!fragmentDoc) return { ok: false, reason: 'no-fragment-document' };
  if (!target.parts.has(ownerPartName)) return { ok: false, reason: 'no-target-part' };

  const fragmentBody =
    fragmentDoc.root.kind === 'document'
      ? fragmentDoc.root.children.find((child) => child.kind === 'body')
      : null;
  if (!fragmentBody || !isElementNode(fragmentBody)) {
    return { ok: false, reason: 'no-fragment-document' };
  }
  // Sanitize at the trust boundary: a crafted `data-docx-fragment` reaches here without
  // passing through the extractor, so sections, comments, external-content imports, and
  // dangerous field instructions (DDE/INCLUDE*) are neutralized regardless of who authored
  // the fragment. Idempotent on our own extractor-cleaned payloads.
  let blocks: OoxmlNode[] = sanitizeFragmentBlocks(
    fragmentBody.children.filter(
      (child) =>
        child.kind === 'paragraph' || child.kind === 'table' || child.kind === 'contentControl'
    )
  );
  if (blocks.length === 0) return { ok: false, reason: 'no-fragment-document' };

  let pkg = target;

  // ------------------------------------------------------------------
  // Numbering FIRST: always remap, dedupe by override-inclusive fingerprint. The style
  // pass below compares definitions AFTER applying this map, so a repeated paste of the
  // same payload recognizes its own earlier imports instead of minting `…Pasted` copies.
  // ------------------------------------------------------------------
  const fragmentNumberingPart = relatedPart(
    fragment,
    fragment.mainDocumentPart,
    NUMBERING_REL,
    '/word/numbering.xml'
  );
  const numIdMap = new Map<string, string>();
  const numsToImport: OoxmlElement[] = [];
  const abstractsToImport: OoxmlElement[] = [];

  if (fragmentNumberingPart && isElementNode(fragmentNumberingPart.root)) {
    const fragmentAbstracts = new Map<string, OoxmlElement>();
    const fragmentNums: OoxmlElement[] = [];
    for (const child of fragmentNumberingPart.root.children) {
      if (!isElementNode(child)) continue;
      if (isWml(child, 'abstractNum')) {
        const id = attributeValueOf(child, 'abstractNumId');
        if (id) fragmentAbstracts.set(id, child);
      } else if (isWml(child, 'num')) {
        fragmentNums.push(child);
      }
    }

    const targetNumberingPart = relatedPart(
      pkg,
      pkg.mainDocumentPart,
      NUMBERING_REL,
      '/word/numbering.xml'
    );

    const targetNumSignatures = new Map<string, string>();
    const targetAbstractById = new Map<string, OoxmlElement>();
    if (targetNumberingPart && isElementNode(targetNumberingPart.root)) {
      for (const child of targetNumberingPart.root.children) {
        if (!isElementNode(child)) continue;
        if (isWml(child, 'abstractNum')) {
          const id = attributeValueOf(child, 'abstractNumId');
          if (id) targetAbstractById.set(id, child);
        }
      }
      for (const child of targetNumberingPart.root.children) {
        if (!isElementNode(child) || !isWml(child, 'num')) continue;
        const numId = attributeValueOf(child, 'numId');
        if (!numId) continue;
        const abstractRef = child.children.find((inner) => isWml(inner, 'abstractNumId'));
        const abstractId = abstractRef ? attributeValueOf(abstractRef, 'val') : undefined;
        const abstract = abstractId ? targetAbstractById.get(abstractId) : undefined;
        targetNumSignatures.set(
          `${abstract ? styleSignature(abstract) : 'none'}::${child.children
            .filter((inner) => isWml(inner, 'lvlOverride'))
            .map(nodeSignature)
            .join('')}`,
          numId
        );
      }
    }

    let nextAbstractId =
      (targetNumberingPart
        ? maxNumericAttribute(targetNumberingPart.root, (node) =>
            node.kind !== 'textValue' && isWml(node, 'abstractNum')
              ? attributeValueOf(node, 'abstractNumId')
              : undefined
          )
        : 0) + 1;
    let nextNumId =
      (targetNumberingPart
        ? maxNumericAttribute(targetNumberingPart.root, (node) =>
            node.kind !== 'textValue' && isWml(node, 'num')
              ? attributeValueOf(node, 'numId')
              : undefined
          )
        : 0) + 1;

    const abstractIdMap = new Map<string, string>();
    for (const num of fragmentNums) {
      const numId = attributeValueOf(num, 'numId');
      if (!numId) continue;
      const abstractRef = num.children.find((inner) => isWml(inner, 'abstractNumId'));
      const abstractId = abstractRef ? attributeValueOf(abstractRef, 'val') : undefined;
      const abstract = abstractId ? fragmentAbstracts.get(abstractId) : undefined;
      const signature = `${abstract ? styleSignature(abstract) : 'none'}::${num.children
        .filter((inner) => isWml(inner, 'lvlOverride'))
        .map(nodeSignature)
        .join('')}`;
      const reusable = targetNumSignatures.get(signature);
      if (reusable !== undefined) {
        numIdMap.set(numId, reusable);
        continue;
      }
      let mappedAbstract = abstractId ? abstractIdMap.get(abstractId) : undefined;
      if (mappedAbstract === undefined && abstract && abstractId) {
        mappedAbstract = String(nextAbstractId++);
        abstractIdMap.set(abstractId, mappedAbstract);
        abstractsToImport.push(
          withRewrittenAttribute(abstract, WML_NAMESPACE_URI, 'abstractNumId', mappedAbstract)
        );
      }
      const freshNumId = String(nextNumId++);
      numIdMap.set(numId, freshNumId);
      let imported = withRewrittenAttribute(num, WML_NAMESPACE_URI, 'numId', freshNumId);
      if (mappedAbstract !== undefined) {
        const children = imported.children.map((inner) =>
          isWml(inner, 'abstractNumId')
            ? withRewrittenAttribute(
                inner as OoxmlElement,
                WML_NAMESPACE_URI,
                'val',
                mappedAbstract!
              )
            : inner
        );
        imported = { ...imported, children } as OoxmlElement;
      }
      numsToImport.push(imported);
      targetNumSignatures.set(signature, freshNumId);
    }
  }

  // ------------------------------------------------------------------
  // Styles: reuse by fingerprint, else import under fresh id + unique name.
  // ------------------------------------------------------------------
  const fragmentStyles = stylesInfoOf(
    relatedPart(fragment, fragment.mainDocumentPart, STYLES_REL, '/word/styles.xml')
  );
  let targetStylesPart = relatedPart(pkg, pkg.mainDocumentPart, STYLES_REL, '/word/styles.xml');
  let targetStyles = stylesInfoOf(targetStylesPart);

  const styleIdMap = new Map<string, string>();
  const stylesToImport: OoxmlElement[] = [];
  const takenIds = new Set(targetStyles.byId.keys());
  const takenNames = new Set(targetStyles.names);
  // Next unused suffix per base, so N colliding `Normal` styles rename in O(N) rather than
  // O(N^2): a fresh-id search that restarts from 2 each time is quadratic.
  const idSuffixes = new Map<string, number>();
  const nameSuffixes = new Map<string, number>();
  // Target style signatures computed LAZILY, only for an id the fragment actually reuses:
  // fingerprinting every target style up front is O(styles.xml) on a paste that collides
  // with none of them.
  const targetSignatures = new Map<string, string>();
  const targetSignatureOf = (id: string, style: OoxmlElement): string => {
    let signature = targetSignatures.get(id);
    if (signature === undefined) {
      signature = styleSignature(style);
      targetSignatures.set(id, signature);
    }
    return signature;
  };

  /**
   * An imported style must NEVER become the target's default: the cascade is last-wins
   * among `w:default` styles, so a pasted `Normal` carrying the flag would restyle every
   * unstyled paragraph in the HOST document.
   */
  const withoutDefaultFlag = (style: OoxmlElement): OoxmlElement =>
    ({
      ...style,
      attributes: style.attributes.filter(
        (attribute) =>
          !(attribute.localName === 'default' && attribute.namespaceUri === WML_NAMESPACE_URI)
      ),
    }) as OoxmlElement;

  for (const style of fragmentStyles.styles) {
    const id = attributeValueOf(style, 'styleId');
    if (!id) continue;
    const existing = targetStyles.byId.get(id);
    // Compare AFTER applying the maps built so far: the target's copy of a previously
    // imported style already carries rewritten numbering/style references.
    const comparable = styleSignature(
      rewriteIdentifiers(style, { styleIds: styleIdMap, numIds: numIdMap }) as OoxmlElement
    );
    if (existing && targetSignatureOf(id, existing) === comparable) {
      styleIdMap.set(id, id);
      continue;
    }
    if (!existing) {
      styleIdMap.set(id, id);
      takenIds.add(id);
      stylesToImport.push(withoutDefaultFlag(style));
      continue;
    }
    const fresh = freshUniqueId(`${id}Pasted`, takenIds, idSuffixes);
    takenIds.add(fresh);
    styleIdMap.set(id, fresh);
    stylesToImport.push(
      withoutDefaultFlag(withRewrittenAttribute(style, WML_NAMESPACE_URI, 'styleId', fresh))
    );
  }
  // Unique names for every imported style whose name collides with a different target style.
  const importedWithNames = stylesToImport.map((style) => {
    const nameNode = style.children.find((inner) => isWml(inner, 'name'));
    const name = nameNode ? attributeValueOf(nameNode, 'val') : undefined;
    if (!name || !takenNames.has(name)) {
      if (name) takenNames.add(name);
      return style;
    }
    const fresh = freshUniqueName(name, takenNames, nameSuffixes);
    takenNames.add(fresh);
    const children = style.children.map((inner) =>
      isWml(inner, 'name')
        ? withRewrittenAttribute(inner as OoxmlElement, WML_NAMESPACE_URI, 'val', fresh)
        : inner
    );
    return { ...style, children } as OoxmlElement;
  });

  // ------------------------------------------------------------------
  // Relationships and media — PER OWNER PART: `rId5` in `document.xml.rels` and `rId5`
  // in `footnotes.xml.rels` are different relationships, so each story rewrites through
  // its own map and its own drop set.
  // ------------------------------------------------------------------
  // Built LAZILY on the first admitted fragment image: a fragment with no media must not
  // pay for hashing every `/word/media/*` part in the target (linear in the target's image
  // bytes — expensive on an image-heavy host, useless when nothing dedupes against it).
  let targetMediaByHash: Map<string, string> | null = null;
  let nextMediaIndex = 1;
  const mediaHashIndex = (): Map<string, string> => {
    if (targetMediaByHash) return targetMediaByHash;
    const index = new Map<string, string>();
    for (const [name, bytes] of pkg.partBytes) {
      const canonical = name.startsWith('/') ? name : `/${name}`;
      if (!canonical.startsWith('/word/media/')) continue;
      index.set(sha256FontBytes(bytes), canonical);
      const match = /\/image(\d+)\./.exec(canonical);
      if (match) nextMediaIndex = Math.max(nextMediaIndex, Number(match[1]) + 1);
    }
    targetMediaByHash = index;
    return index;
  };

  // Media part → the image relationship already pointing at it, per owner, so the
  // existing-rel check is a Map lookup rather than an O(rels) scan inside the media loop.
  const imageRelByMediaPart = new Map<string, Map<string, string>>();
  const imageRelIndexFor = (owner: string): Map<string, string> => {
    let index = imageRelByMediaPart.get(owner);
    if (!index) {
      index = new Map();
      for (const entry of relationshipsOf(pkg, owner)) {
        if (entry.targetMode === 'External' || entry.type !== IMAGE_REL) continue;
        const resolved = resolveInternalTarget(entry.ownerPart, entry.rawTarget);
        if (resolved.ok) index.set(resolved.partName, entry.id);
      }
      imageRelByMediaPart.set(owner, index);
    }
    return index;
  };

  /** A media extension constrained to a safe token, or a mime-derived fallback. */
  const safeMediaExtension = (partName: string, mime: string): string => {
    const dot = partName.lastIndexOf('.');
    const raw = dot === -1 ? '' : partName.slice(dot + 1);
    if (/^[A-Za-z0-9]{1,8}$/.test(raw)) return raw.toLowerCase();
    return mime === 'image/jpeg' ? 'jpeg' : mime === 'image/gif' ? 'gif' : 'png';
  };

  const mergeRels = (
    fragmentOwner: string,
    targetOwner: string,
    usedIds: ReadonlySet<string>
  ): { readonly relIdMap: Map<string, string>; readonly dropRelIds: Set<string> } => {
    const relIdMap = new Map<string, string>();
    const dropRelIds = new Set<string>();
    const relIndex = imageRelIndexFor(targetOwner);
    // Media writes are BATCHED and flushed once at the end of this call: a `withBinaryPart`
    // + `withRelationship` per image each copy the whole package, so a fragment with
    // thousands of distinct images was O(images^2). New media parts and new image
    // relationships accumulate here; each pending rel is keyed by its media part so many
    // records to the same new image share one relationship.
    const pendingBinary: Array<{ partName: string; bytes: Uint8Array; contentType: string }> = [];
    const pendingPartNames = new Set<string>();
    const pendingRelTargets: string[] = [];
    const pendingRelMediaParts: string[] = [];
    const pendingRelByMediaPart = new Map<string, number>();
    const recordPending: Array<{ recordId: string; index: number }> = [];
    const records = fragment.relationships.get(fragmentOwner) ?? [];
    for (const record of records) {
      if (!usedIds.has(record.id)) continue;
      if (record.targetMode === 'External') {
        if (record.type === HYPERLINK_REL) {
          const ensured = ensureHyperlinkRelationship(pkg, record.rawTarget, targetOwner);
          if (ensured) {
            pkg = ensured.pkg;
            relIdMap.set(record.id, ensured.relationshipId);
          } else {
            dropRelIds.add(record.id);
          }
        } else {
          dropRelIds.add(record.id);
        }
        continue;
      }
      const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
      if (!resolved.ok) {
        dropRelIds.add(record.id);
        continue;
      }
      const bytes =
        fragment.partBytes.get(resolved.partName) ??
        fragment.partBytes.get(resolved.partName.replace(/^\//, ''));
      const declaredType = (resolveContentTypeOf(fragment, resolved.partName) ?? '').toLowerCase();
      if (!bytes || !declaredType.startsWith('image/')) {
        dropRelIds.add(record.id);
        continue;
      }
      // The declared content type is a CLAIM from the fragment's own attacker-controlled
      // [Content_Types].xml; the signature sniff is authoritative, same as the insert-image
      // lane. A mismatch, an unknown signature, or a raster that fails the header and
      // dimension caps drops the relationship (and with it the drawing) instead of copying
      // spoofed bytes into the target package under an image/* type.
      const mediaMime = admittedMediaMime(bytes, declaredType);
      if (mediaMime === null) {
        dropRelIds.add(record.id);
        continue;
      }
      const contentType = mediaMime;
      const hashIndex = mediaHashIndex();
      const hash = sha256FontBytes(bytes);
      let mediaPart = hashIndex.get(hash);
      if (!mediaPart) {
        const ext = safeMediaExtension(resolved.partName, contentType);
        const isPendingOrPresent = (candidate: string): boolean =>
          pkg.partBytes.has(candidate) ||
          pkg.partBytes.has(candidate.slice(1)) ||
          pkg.parts.has(candidate) ||
          pendingPartNames.has(candidate);
        let candidate = `/word/media/image${nextMediaIndex}.${ext}`;
        while (isPendingOrPresent(candidate)) {
          nextMediaIndex += 1;
          candidate = `/word/media/image${nextMediaIndex}.${ext}`;
        }
        nextMediaIndex += 1;
        mediaPart = candidate;
        pendingBinary.push({ partName: mediaPart, bytes, contentType });
        pendingPartNames.add(mediaPart);
        hashIndex.set(hash, mediaPart);
      }
      const relTarget = mediaPart.startsWith('/word/')
        ? mediaPart.slice('/word/'.length)
        : mediaPart;
      const existingRelId = relIndex.get(mediaPart);
      if (existingRelId !== undefined) {
        relIdMap.set(record.id, existingRelId);
        continue;
      }
      // Reserve one pending rel per NEW media part; many records to it share the rel.
      let pendingIndex = pendingRelByMediaPart.get(mediaPart);
      if (pendingIndex === undefined) {
        pendingIndex = pendingRelTargets.length;
        pendingRelByMediaPart.set(mediaPart, pendingIndex);
        pendingRelTargets.push(relTarget);
        pendingRelMediaParts.push(mediaPart);
      }
      recordPending.push({ recordId: record.id, index: pendingIndex });
    }

    // Flush: all media bytes + content types in one package edit, all relationships in one.
    if (pendingBinary.length > 0) pkg = withBinaryParts(pkg, pendingBinary);
    if (pendingRelTargets.length > 0) {
      const withRels = withRelationships(
        withRelationshipsPartFor(pkg, targetOwner),
        targetOwner,
        pendingRelTargets.map((target) => [IMAGE_REL, target] as const)
      );
      if (!withRels.ok) {
        for (const entry of recordPending) dropRelIds.add(entry.recordId);
      } else {
        pkg = withRels.pkg;
        withRels.ids.forEach((relId, index) => {
          relIndex.set(pendingRelMediaParts[index]!, relId);
        });
        for (const entry of recordPending) {
          relIdMap.set(entry.recordId, withRels.ids[entry.index]!);
        }
      }
    }
    return { relIdMap, dropRelIds };
  };

  const docRels = mergeRels(fragment.mainDocumentPart, ownerPartName, relationshipIdsIn(blocks));
  blocks = withoutDanglingDrawings(blocks, docRels.dropRelIds);

  // ------------------------------------------------------------------
  // Note bodies: collect and remap ids per KIND before any rewriting, so cross-references
  // between kinds resolve, then transplant below with full unique-id freshening.
  // ------------------------------------------------------------------
  const footnoteIdMap = new Map<string, string>();
  const endnoteIdMap = new Map<string, string>();
  interface NoteTransplant {
    readonly kind: 'footnote' | 'endnote';
    readonly fragmentPartName: string;
    bodies: OoxmlNode[];
  }
  const transplants: NoteTransplant[] = [];

  for (const noteKind of ['footnote', 'endnote'] as const) {
    const localName = noteKind === 'footnote' ? 'footnoteReference' : 'endnoteReference';
    const idMap = noteKind === 'footnote' ? footnoteIdMap : endnoteIdMap;
    const referenced = new Set<string>();
    walkAll(blocks, (node) => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'noteReference' && node.localName === localName) {
        const id = attributeValueOf(node, 'id');
        if (id !== undefined) referenced.add(id);
      }
    });
    if (referenced.size === 0) continue;
    const fragmentNotes = resolveNotesPart(fragment, noteKind);
    if (!fragmentNotes || !isElementNode(fragmentNotes.root)) continue;

    const ensured = ensureNotesPart(pkg, noteKind);
    if (!ensured.ok || !ensured.package) return { ok: false, reason: 'merge-refused' };
    pkg = ensured.package;
    const targetNotes = resolveNotesPart(pkg, noteKind);
    if (!targetNotes) return { ok: false, reason: 'merge-refused' };

    let nextNoteId =
      maxNumericAttribute(targetNotes.root, (node) =>
        node.kind !== 'textValue' && node.kind === 'note' ? attributeValueOf(node, 'id') : undefined
      ) + 1;

    const bodies: OoxmlNode[] = [];
    for (const child of fragmentNotes.root.children) {
      if (!isElementNode(child) || child.kind !== 'note') continue;
      const id = attributeValueOf(child, 'id');
      const type = attributeValueOf(child, 'type');
      if (type === 'separator' || type === 'continuationSeparator') continue;
      if (id === undefined || !referenced.has(id)) continue;
      const fresh = String(nextNoteId++);
      idMap.set(id, fresh);
      bodies.push(withRewrittenAttribute(child, WML_NAMESPACE_URI, 'id', fresh));
    }
    if (bodies.length > 0) {
      // Note bodies are crafted-fragment content too: sanitize before transplant.
      transplants.push({
        kind: noteKind,
        fragmentPartName: fragmentNotes.name,
        bodies: sanitizeFragmentBlocks(bodies),
      });
    }
  }

  // ------------------------------------------------------------------
  // Unique-id namespaces — bookmarks, `wp:docPr`, SDT ids, revision ids — freshened over
  // the blocks AND the note bodies (the insert spec's "every namespace the fragment
  // carries"). One shared counter per namespace keeps everything collision-free.
  // ------------------------------------------------------------------
  const ownerPart = pkg.parts.get(ownerPartName)!;
  const allTravelling: OoxmlNode[] = [...blocks, ...transplants.flatMap((entry) => entry.bodies)];

  // Collect the fragment-side id/name occurrences ONCE, so the target scans below run only
  // for namespaces the fragment actually carries — a plain paste pays for none of them.
  const fragmentBookmarkIds: string[] = [];
  const pastedBookmarkNames = new Set<string>();
  let fragmentHasRevision = false;
  let fragmentHasDocPr = false;
  const sdtIdMap = new Map<string, string>();
  walkAll(allTravelling, (node) => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'bookmarkStart' || node.kind === 'bookmarkEnd') {
      const id = attributeValueOf(node, 'id');
      if (id !== undefined) fragmentBookmarkIds.push(id);
      if (node.kind === 'bookmarkStart') {
        const name = attributeValueOf(node, 'name');
        if (name) pastedBookmarkNames.add(name);
      }
      return;
    }
    if (REVISION_KINDS.has(node.kind)) {
      fragmentHasRevision = true;
      return;
    }
    if (node.kind === 'drawingDocPr') {
      fragmentHasDocPr = true;
      return;
    }
    if (node.kind === 'contentControlProperties') {
      for (const child of node.children) {
        if (!isWml(child, 'id')) continue;
        const value = attributeValueOf(child, 'val');
        if (value !== undefined && !sdtIdMap.has(value)) {
          let seed = 0;
          const basis = `${value}:${sdtIdMap.size}`;
          for (let index = 0; index < basis.length; index += 1) {
            seed = (seed * 31 + basis.charCodeAt(index)) >>> 0;
          }
          sdtIdMap.set(value, String(seed % 2147483647 || 1));
        }
      }
    }
  });

  const bookmarkIdMap = new Map<string, string>();
  if (fragmentBookmarkIds.length > 0) {
    let nextBookmarkId =
      maxNumericAttribute(ownerPart.root, (node) =>
        node.kind !== 'textValue' && node.kind === 'bookmarkStart'
          ? attributeValueOf(node, 'id')
          : undefined
      ) + 1;
    for (const transplant of transplants) {
      const notesPart = resolveNotesPart(pkg, transplant.kind);
      if (!notesPart) continue;
      nextBookmarkId = Math.max(
        nextBookmarkId,
        maxNumericAttribute(notesPart.root, (node) =>
          node.kind !== 'textValue' && node.kind === 'bookmarkStart'
            ? attributeValueOf(node, 'id')
            : undefined
        ) + 1
      );
    }
    for (const id of fragmentBookmarkIds) {
      if (!bookmarkIdMap.has(id)) bookmarkIdMap.set(id, String(nextBookmarkId++));
    }
  }

  // Pasted bookmark wins a name collision: the target's same-name markers go.
  if (pastedBookmarkNames.size > 0) {
    const collidingIds = new Set<string>();
    walkAll([ownerPart.root], (node) => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'bookmarkStart') {
        const name = attributeValueOf(node, 'name');
        const id = attributeValueOf(node, 'id');
        if (name && id !== undefined && pastedBookmarkNames.has(name)) collidingIds.add(id);
      }
    });
    if (collidingIds.size > 0) {
      // One tree rebuild that drops every colliding marker, not a removeNode per marker
      // (each of which rebuilds the whole owner part — quadratic on a bookmark-heavy host).
      const dropCollidingMarkers = (node: OoxmlNode): OoxmlNode => {
        if (node.kind === 'textValue') return node;
        const children: OoxmlNode[] = [];
        let changed = false;
        for (const child of node.children) {
          if (
            (child.kind === 'bookmarkStart' || child.kind === 'bookmarkEnd') &&
            collidingIds.has(attributeValueOf(child, 'id') ?? '')
          ) {
            changed = true;
            continue;
          }
          const next = dropCollidingMarkers(child);
          if (next !== child) changed = true;
          children.push(next);
        }
        return changed ? ({ ...node, children } as OoxmlNode) : node;
      };
      const nextRoot = dropCollidingMarkers(ownerPart.root) as OoxmlElement;
      if (nextRoot !== ownerPart.root) {
        pkg = withPart(pkg, { ...ownerPart, root: nextRoot });
      }
    }
  }

  const revisionIdMap = new Map<string, string>();
  if (fragmentHasRevision) {
    let nextRevisionId =
      maxNumericAttribute(ownerPart.root, (node) =>
        node.kind !== 'textValue' && REVISION_KINDS.has(node.kind)
          ? attributeValueOf(node, 'id')
          : undefined
      ) + 1;
    walkAll(allTravelling, (node) => {
      if (node.kind === 'textValue' || !REVISION_KINDS.has(node.kind)) return;
      const id = attributeValueOf(node, 'id');
      if (id !== undefined && !revisionIdMap.has(id)) {
        revisionIdMap.set(id, String(nextRevisionId++));
      }
    });
  }

  const docPrIdMap = new Map<string, string>();
  if (fragmentHasDocPr) {
    const allocated = allocateDrawingPropertyId(pkg);
    let nextDocPrId = allocated.ok ? allocated.id : 100_000;
    walkAll(allTravelling, (node) => {
      if (node.kind === 'textValue' || node.kind !== 'drawingDocPr') return;
      const value = node.attributes.find(
        (attribute) => attribute.localName === 'id' && attribute.namespaceUri === ''
      )?.value;
      if (value !== undefined && !docPrIdMap.has(value)) {
        docPrIdMap.set(value, String(nextDocPrId++));
      }
    });
  }

  // ------------------------------------------------------------------
  // Transplant note bodies: per-owner rels, full identifier rewrite, drop dangling
  // drawings, and the same default materialization the blocks get.
  // ------------------------------------------------------------------
  for (const transplant of transplants) {
    const targetNotes = resolveNotesPart(pkg, transplant.kind);
    if (!targetNotes) return { ok: false, reason: 'merge-refused' };
    const noteRels = mergeRels(
      transplant.fragmentPartName,
      targetNotes.name,
      relationshipIdsIn(transplant.bodies)
    );
    let bodies = withoutDanglingDrawings(transplant.bodies, noteRels.dropRelIds);
    // Materialize before the rewrite — same original-id reason as the blocks below.
    bodies = [...materializeDefaults(bodies, fragmentStyles, targetStyles)];
    bodies = bodies.map((body) =>
      rewriteIdentifiers(body, {
        styleIds: styleIdMap,
        numIds: numIdMap,
        relIds: noteRels.relIdMap,
        footnoteIds: footnoteIdMap,
        endnoteIds: endnoteIdMap,
        bookmarkIds: bookmarkIdMap,
        sdtIds: sdtIdMap,
        revisionIds: revisionIdMap,
        docPrIds: docPrIdMap,
      })
    );
    const appendedPkg = appendToPart(pkg, pkg.parts.get(targetNotes.name)!, bodies);
    if (!appendedPkg) return { ok: false, reason: 'merge-refused' };
    pkg = appendedPkg;
  }

  // ------------------------------------------------------------------
  // Import styles and numbering into the target parts.
  // ------------------------------------------------------------------
  if (importedWithNames.length > 0) {
    const rewrittenImports = importedWithNames.map((style) =>
      rewriteIdentifiers(style, { styleIds: styleIdMap, numIds: numIdMap })
    );
    if (!targetStylesPart) {
      const authored = readOoxmlPart(`<w:styles xmlns:w="${WML_NAMESPACE_URI}"></w:styles>`, {
        name: '/word/styles.xml',
        contentType: STYLES_CT,
      });
      if (!authored.ok) return { ok: false, reason: 'merge-refused' };
      pkg = withNewPart(pkg, '/word/styles.xml', authored.part.root, STYLES_CT);
      const related = withRelationship(
        withRelationshipsPartFor(pkg, pkg.mainDocumentPart),
        pkg.mainDocumentPart,
        STYLES_REL,
        'styles.xml'
      );
      if (!related.ok) return { ok: false, reason: 'merge-refused' };
      pkg = related.pkg;
      targetStylesPart = pkg.parts.get('/word/styles.xml') ?? null;
    }
    if (!targetStylesPart) return { ok: false, reason: 'merge-refused' };
    const appended = appendToPart(pkg, pkg.parts.get(targetStylesPart.name)!, rewrittenImports);
    if (!appended) return { ok: false, reason: 'merge-refused' };
    pkg = appended;
    targetStyles = stylesInfoOf(pkg.parts.get(targetStylesPart.name) ?? null);
  }

  if (abstractsToImport.length > 0 || numsToImport.length > 0) {
    let numberingPart = relatedPart(
      pkg,
      pkg.mainDocumentPart,
      NUMBERING_REL,
      '/word/numbering.xml'
    );
    if (!numberingPart) {
      const authored = readOoxmlPart(`<w:numbering xmlns:w="${WML_NAMESPACE_URI}"></w:numbering>`, {
        name: '/word/numbering.xml',
        contentType: NUMBERING_CT,
      });
      if (!authored.ok) return { ok: false, reason: 'merge-refused' };
      pkg = withNewPart(pkg, '/word/numbering.xml', authored.part.root, NUMBERING_CT);
      const related = withRelationship(
        withRelationshipsPartFor(pkg, pkg.mainDocumentPart),
        pkg.mainDocumentPart,
        NUMBERING_REL,
        'numbering.xml'
      );
      if (!related.ok) return { ok: false, reason: 'merge-refused' };
      pkg = related.pkg;
      numberingPart = pkg.parts.get('/word/numbering.xml') ?? null;
    }
    if (!numberingPart) return { ok: false, reason: 'merge-refused' };
    // `w:abstractNum` elements precede every `w:num` per the schema.
    const current = pkg.parts.get(numberingPart.name)!;
    const firstNumIndex = current.root.children.findIndex((child) => isWml(child, 'num'));
    const abstractRewrites = abstractsToImport.map((node) =>
      rewriteIdentifiers(node, { styleIds: styleIdMap, numIds: numIdMap })
    );
    let appended = appendToPart(
      pkg,
      current,
      abstractRewrites,
      firstNumIndex === -1 ? undefined : firstNumIndex
    );
    if (!appended) return { ok: false, reason: 'merge-refused' };
    pkg = appended;
    appended = appendToPart(pkg, pkg.parts.get(numberingPart.name)!, numsToImport);
    if (!appended) return { ok: false, reason: 'merge-refused' };
    pkg = appended;
  }

  // ------------------------------------------------------------------
  // Rewrite the blocks and materialize defaults.
  // ------------------------------------------------------------------
  // Materialize BEFORE the identifier rewrite: `chainDefines` resolves style chains in
  // the FRAGMENT's styles part, which is keyed by original ids — a collision-remapped
  // `pStyle` would never resolve and the default value would stamp over the style's own.
  const materialized = [...materializeDefaults(blocks, fragmentStyles, targetStyles)];
  const rewritten = materialized.map((block) =>
    rewriteIdentifiers(block, {
      styleIds: styleIdMap,
      numIds: numIdMap,
      relIds: docRels.relIdMap,
      footnoteIds: footnoteIdMap,
      endnoteIds: endnoteIdMap,
      bookmarkIds: bookmarkIdMap,
      sdtIds: sdtIdMap,
      revisionIds: revisionIdMap,
      docPrIds: docPrIdMap,
    })
  );

  return { ok: true, pkg, blocks: rewritten };
}
