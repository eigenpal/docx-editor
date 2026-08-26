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
  type OoxmlAttribute,
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
  withRelationshipsPartFor,
} from '../package/package-edit.ts';
import { withBinaryPart, allocateDrawingPropertyId } from '../package/drawing-package-edit.ts';
import { ensureHyperlinkRelationship } from '../package/hyperlink-part.ts';
import { ensureNotesPart } from '../package/note-lifecycle.ts';
import { resolveNotesPart } from '../package/note-references.ts';
import { resolveInternalTarget } from '../package/opc-names.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';
import { createNodeIdAllocator, insertChildren, removeNode } from '../package/ooxml-edit.ts';
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

function withRewrittenAttribute(
  node: OoxmlElement,
  namespaceUri: string,
  localName: string,
  value: string
): OoxmlElement {
  return {
    ...node,
    attributes: node.attributes.map((attribute) =>
      attribute.localName === localName && attribute.namespaceUri === namespaceUri
        ? ({ ...attribute, value } as OoxmlAttribute)
        : attribute
    ),
  } as OoxmlElement;
}

// `styleLink`/`numStyleLink` included: numbering definitions reference numbering STYLES,
// and an import under a fresh style id must rewrite those references too.
const STYLE_REF_NAMES = new Set([
  'pStyle',
  'rStyle',
  'tblStyle',
  'basedOn',
  'link',
  'next',
  'styleLink',
  'numStyleLink',
]);

const REVISION_KINDS = new Set([
  'revisionInsert',
  'revisionDelete',
  'revisionMoveFrom',
  'revisionMoveTo',
]);

interface RewriteMaps {
  readonly styleIds?: ReadonlyMap<string, string>;
  readonly numIds?: ReadonlyMap<string, string>;
  readonly relIds?: ReadonlyMap<string, string>;
  readonly footnoteIds?: ReadonlyMap<string, string>;
  readonly endnoteIds?: ReadonlyMap<string, string>;
  readonly bookmarkIds?: ReadonlyMap<string, string>;
  readonly sdtIds?: ReadonlyMap<string, string>;
  readonly revisionIds?: ReadonlyMap<string, string>;
  readonly docPrIds?: ReadonlyMap<string, string>;
}

const EMPTY_MAP: ReadonlyMap<string, string> = new Map();

function rewriteIdentifiers(node: OoxmlNode, maps: RewriteMaps): OoxmlNode {
  const styleIds = maps.styleIds ?? EMPTY_MAP;
  const numIds = maps.numIds ?? EMPTY_MAP;
  const relIds = maps.relIds ?? EMPTY_MAP;
  const footnoteIds = maps.footnoteIds ?? EMPTY_MAP;
  const endnoteIds = maps.endnoteIds ?? EMPTY_MAP;
  const bookmarkIds = maps.bookmarkIds ?? EMPTY_MAP;
  const sdtIds = maps.sdtIds ?? EMPTY_MAP;
  const revisionIds = maps.revisionIds ?? EMPTY_MAP;
  const docPrIds = maps.docPrIds ?? EMPTY_MAP;

  const walk = (current: OoxmlNode, parentLocal: string): OoxmlNode => {
    if (current.kind === 'textValue') return current;
    let next: OoxmlElement = current;

    if (current.namespaceUri === WML_NAMESPACE_URI && STYLE_REF_NAMES.has(current.localName)) {
      const value = attributeValueOf(current, 'val');
      const mapped = value !== undefined ? styleIds.get(value) : undefined;
      if (mapped !== undefined)
        next = withRewrittenAttribute(next, WML_NAMESPACE_URI, 'val', mapped);
    }
    if (isWml(current, 'numId')) {
      const value = attributeValueOf(current, 'val');
      const mapped = value !== undefined ? numIds.get(value) : undefined;
      if (mapped !== undefined)
        next = withRewrittenAttribute(next, WML_NAMESPACE_URI, 'val', mapped);
    }
    if (current.kind === 'noteReference') {
      // Footnote and endnote ids are SEPARATE namespaces; each reference kind resolves
      // through its own map, never a shared one.
      const kindMap = current.localName === 'footnoteReference' ? footnoteIds : endnoteIds;
      const value = attributeValueOf(current, 'id');
      const mapped = value !== undefined ? kindMap.get(value) : undefined;
      if (mapped !== undefined)
        next = withRewrittenAttribute(next, WML_NAMESPACE_URI, 'id', mapped);
    }
    if (current.kind === 'bookmarkStart' || current.kind === 'bookmarkEnd') {
      const value = attributeValueOf(current, 'id');
      const mapped = value !== undefined ? bookmarkIds.get(value) : undefined;
      if (mapped !== undefined)
        next = withRewrittenAttribute(next, WML_NAMESPACE_URI, 'id', mapped);
    }
    // `w:id` rewrites ONLY under `w:sdtPr` — an unrelated `w:id` element elsewhere with a
    // colliding value must stay untouched.
    if (isWml(current, 'id') && parentLocal === 'sdtPr') {
      const value = attributeValueOf(current, 'val');
      const mapped = value !== undefined ? sdtIds.get(value) : undefined;
      if (mapped !== undefined)
        next = withRewrittenAttribute(next, WML_NAMESPACE_URI, 'val', mapped);
    }
    if (REVISION_KINDS.has(current.kind)) {
      const value = attributeValueOf(current, 'id');
      const mapped = value !== undefined ? revisionIds.get(value) : undefined;
      if (mapped !== undefined)
        next = withRewrittenAttribute(next, WML_NAMESPACE_URI, 'id', mapped);
    }
    if (current.kind === 'drawingDocPr') {
      const value = current.attributes.find(
        (attribute) => attribute.localName === 'id' && attribute.namespaceUri === ''
      )?.value;
      const mapped = value !== undefined ? docPrIds.get(value) : undefined;
      if (mapped !== undefined) next = withRewrittenAttribute(next, '', 'id', mapped);
    }
    // Relationship references (r:id, r:embed, r:link).
    for (const attribute of next.attributes) {
      if (attribute.namespaceUri !== R_NS) continue;
      const mapped = relIds.get(attribute.value);
      if (mapped !== undefined && mapped !== attribute.value) {
        next = withRewrittenAttribute(next, R_NS, attribute.localName, mapped);
      }
    }

    const parentForChildren = current.localName;
    const children = next.children.map((child) => walk(child, parentForChildren));
    const changed =
      next !== current || children.some((child, index) => child !== next.children[index]);
    return changed ? ({ ...next, children } as OoxmlNode) : current;
  };
  return walk(node, '');
}

/** Numeric max over an attribute across a part, for fresh-id allocation. */
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

/** Drop drawings whose relationship could not merge, rather than shipping them dangling. */
function withoutDanglingDrawings(
  nodes: readonly OoxmlNode[],
  dropRelIds: ReadonlySet<string>
): OoxmlNode[] {
  if (dropRelIds.size === 0) return [...nodes];
  const drop = (node: OoxmlNode): OoxmlNode | null => {
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
    const children: OoxmlNode[] = [];
    let changed = false;
    for (const child of node.children) {
      const kept = drop(child);
      if (kept === null) {
        changed = true;
        continue;
      }
      if (kept !== child) changed = true;
      children.push(kept);
    }
    return changed ? ({ ...node, children } as OoxmlNode) : node;
  };
  return nodes.map((node) => drop(node)).filter((node): node is OoxmlNode => node !== null);
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
  let blocks: OoxmlNode[] = fragmentBody.children.filter(
    (child) =>
      child.kind === 'paragraph' || child.kind === 'table' || child.kind === 'contentControl'
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
  const targetSignatures = new Map<string, string>();
  for (const [id, style] of targetStyles.byId) targetSignatures.set(id, styleSignature(style));

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
    if (existing && targetSignatures.get(id) === comparable) {
      styleIdMap.set(id, id);
      continue;
    }
    if (!existing) {
      styleIdMap.set(id, id);
      takenIds.add(id);
      stylesToImport.push(withoutDefaultFlag(style));
      continue;
    }
    let fresh = `${id}Pasted`;
    let suffix = 2;
    while (takenIds.has(fresh)) fresh = `${id}Pasted${suffix++}`;
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
    let fresh = `${name} (pasted)`;
    let suffix = 2;
    while (takenNames.has(fresh)) fresh = `${name} (pasted ${suffix++})`;
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
  const targetMediaByHash = new Map<string, string>();
  for (const [name, bytes] of pkg.partBytes) {
    const canonical = name.startsWith('/') ? name : `/${name}`;
    if (!canonical.startsWith('/word/media/')) continue;
    targetMediaByHash.set(sha256FontBytes(bytes), canonical);
  }

  const mergeRels = (
    fragmentOwner: string,
    targetOwner: string,
    usedIds: ReadonlySet<string>
  ): { readonly relIdMap: Map<string, string>; readonly dropRelIds: Set<string> } => {
    const relIdMap = new Map<string, string>();
    const dropRelIds = new Set<string>();
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
      const contentType = resolveContentTypeOf(fragment, resolved.partName) ?? '';
      if (!bytes || !contentType.toLowerCase().startsWith('image/')) {
        dropRelIds.add(record.id);
        continue;
      }
      const hash = sha256FontBytes(bytes);
      let mediaPart = targetMediaByHash.get(hash);
      if (!mediaPart) {
        // Allocate a free media name in the target.
        const ext = resolved.partName.slice(resolved.partName.lastIndexOf('.') + 1);
        let index = 1;
        const taken = (candidate: string): boolean =>
          pkg.partBytes.has(candidate) ||
          pkg.partBytes.has(candidate.slice(1)) ||
          pkg.parts.has(candidate);
        while (taken(`/word/media/image${index}.${ext}`)) index += 1;
        mediaPart = `/word/media/image${index}.${ext}`;
        pkg = withBinaryPart(pkg, mediaPart, bytes, contentType);
        targetMediaByHash.set(hash, mediaPart);
      }
      const relTarget = mediaPart.startsWith('/word/')
        ? mediaPart.slice('/word/'.length)
        : mediaPart;
      const existing = relationshipsOf(pkg, targetOwner).find((entry) => {
        if (entry.targetMode === 'External' || entry.type !== IMAGE_REL) return false;
        const entryTarget = resolveInternalTarget(entry.ownerPart, entry.rawTarget);
        return entryTarget.ok && entryTarget.partName === mediaPart;
      });
      if (existing) {
        relIdMap.set(record.id, existing.id);
        continue;
      }
      const related = withRelationship(
        withRelationshipsPartFor(pkg, targetOwner),
        targetOwner,
        IMAGE_REL,
        relTarget
      );
      if (!related.ok) {
        dropRelIds.add(record.id);
        continue;
      }
      pkg = related.pkg;
      relIdMap.set(record.id, related.relationshipId);
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
      transplants.push({ kind: noteKind, fragmentPartName: fragmentNotes.name, bodies });
    }
  }

  // ------------------------------------------------------------------
  // Unique-id namespaces — bookmarks, `wp:docPr`, SDT ids, revision ids — freshened over
  // the blocks AND the note bodies (the insert spec's "every namespace the fragment
  // carries"). One shared counter per namespace keeps everything collision-free.
  // ------------------------------------------------------------------
  const ownerPart = pkg.parts.get(ownerPartName)!;
  const allTravelling: OoxmlNode[] = [...blocks, ...transplants.flatMap((entry) => entry.bodies)];

  const bookmarkIdMap = new Map<string, string>();
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
  const pastedBookmarkNames = new Set<string>();
  walkAll(allTravelling, (node) => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'bookmarkStart') {
      const id = attributeValueOf(node, 'id');
      const name = attributeValueOf(node, 'name');
      if (id !== undefined && !bookmarkIdMap.has(id)) {
        bookmarkIdMap.set(id, String(nextBookmarkId++));
      }
      if (name) pastedBookmarkNames.add(name);
    }
    if (node.kind === 'bookmarkEnd') {
      const id = attributeValueOf(node, 'id');
      if (id !== undefined && !bookmarkIdMap.has(id)) {
        bookmarkIdMap.set(id, String(nextBookmarkId++));
      }
    }
  });

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
      let currentPart = ownerPart;
      const markerNodeIds: string[] = [];
      walkAll([currentPart.root], (node) => {
        if (node.kind === 'textValue') return;
        if (node.kind !== 'bookmarkStart' && node.kind !== 'bookmarkEnd') return;
        const id = attributeValueOf(node, 'id');
        if (id !== undefined && collidingIds.has(id)) markerNodeIds.push(node.id);
      });
      for (const nodeId of markerNodeIds) {
        const removed = removeNode(currentPart, nodeId, { deferValidation: true });
        if (removed.ok) currentPart = removed.part;
      }
      pkg = withPart(pkg, currentPart);
    }
  }

  const sdtIdMap = new Map<string, string>();
  walkAll(allTravelling, (node) => {
    if (node.kind === 'textValue') return;
    if (node.kind !== 'contentControlProperties') return;
    for (const child of node.children) {
      if (!isWml(child, 'id')) continue;
      const value = attributeValueOf(child, 'val');
      if (value !== undefined && !sdtIdMap.has(value)) {
        // Deterministic fresh 32-bit-ish id derived from the old one.
        let seed = 0;
        const basis = `${value}:${sdtIdMap.size}`;
        for (let index = 0; index < basis.length; index += 1) {
          seed = (seed * 31 + basis.charCodeAt(index)) >>> 0;
        }
        sdtIdMap.set(value, String(seed % 2147483647 || 1));
      }
    }
  });

  const revisionIdMap = new Map<string, string>();
  let nextRevisionId =
    maxNumericAttribute(ownerPart.root, (node) =>
      node.kind !== 'textValue' && REVISION_KINDS.has(node.kind)
        ? attributeValueOf(node, 'id')
        : undefined
    ) + 1;
  walkAll(allTravelling, (node) => {
    if (node.kind === 'textValue') return;
    if (REVISION_KINDS.has(node.kind)) {
      const id = attributeValueOf(node, 'id');
      if (id !== undefined && !revisionIdMap.has(id)) {
        revisionIdMap.set(id, String(nextRevisionId++));
      }
    }
  });

  const docPrIdMap = new Map<string, string>();
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
