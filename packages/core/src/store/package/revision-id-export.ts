// Give every saved revision its own `@w:id`, across every part, on save.
//
// The live tree may hold one revision id on several elements: the pieces of one change split
// by a later edit keep its id so the editor reviews them as one change, and a header or note
// part mints its ids without looking at the body. A reader of the saved file needs each
// revision element to name its own annotation, and needs the id to fit a 32-bit signed
// integer. This pass writes that into an EXPORT snapshot only. The document state, its review
// grouping, and the ids collaboration peers mint in their stripes do not change.
//
// The pass is deterministic and minimal. Parts are visited in a fixed order (main document
// first, then by part name), and elements in document order. The first element to use an id
// keeps it, so a file whose ids are already unique and in range saves unchanged. Every later
// user of a taken id, and every id that is not a valid 32-bit integer, gets a new id.
//
// A new id depends only on the id the element had and on how many elements with that id came
// before it, never on the highest id in use or on other conflicts. So a later edit that mints
// a revision, or splits a revision with another id, leaves every other new id as it was, and
// a repeated save reuses the markup it wrote before. The id is a hash of those two inputs in
// the lower half of the 32-bit range, moved up to the next free value when it is taken. The
// upper half stays free for the ids the editor mints after the file is opened again.
//
// A range start and its end are one annotation and share one id by design: a
// `w:moveFromRangeStart` and the `w:moveFromRangeEnd` that closes it are renumbered together.
// Bookmarks, comments, permissions and note references are separate id spaces and are never
// read or written here.

import { MAX_DECIMAL_ID } from './actor-scoped-ids.ts';
import { fnv1a32 } from './para-id.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { MC_NAMESPACE_URI, WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlAttribute, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import { REVISION_ID_BEARING } from '../store/tree-op-revision-ids.ts';

/** The ranges whose start and end share one revision id, keyed by element local name. */
const PAIRED_RANGES: ReadonlyMap<string, { readonly family: string; readonly start: boolean }> =
  new Map(
    [
      'moveFrom',
      'moveTo',
      'customXmlIns',
      'customXmlDel',
      'customXmlMoveFrom',
      'customXmlMoveTo',
    ].flatMap((family) => [
      [`${family}RangeStart`, { family, start: true }] as const,
      [`${family}RangeEnd`, { family, start: false }] as const,
    ])
  );

const MIN_REVISION_ID = -MAX_DECIMAL_ID - 1;

/**
 * A revision id as a 32-bit signed integer, or null when the value is not one.
 *
 * Strict and bounded: an optional `-`, then at most ten ASCII digits. No regex, no
 * conversion of an unbounded string, so a crafted attribute costs at most eleven steps.
 */
export function parseRevisionId(value: string): number | null {
  const length = value.length;
  const negative = length > 0 && value.charCodeAt(0) === 45;
  const first = negative ? 1 : 0;
  if (length === first || length - first > 10) return null;
  let parsed = 0;
  for (let index = first; index < length; index += 1) {
    const digit = value.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return null;
    parsed = parsed * 10 + digit;
  }
  if (negative) parsed = -parsed;
  // `-0` is the id `0`.
  if (parsed === 0) return 0;
  return parsed > MAX_DECIMAL_ID || parsed < MIN_REVISION_ID ? null : parsed;
}

/** One annotation that needs a new id: its element, or a range start and its end. */
interface Conflict {
  readonly partName: string;
  readonly nodeIds: string[];
  /** The authored id, and how many conflicts with that authored id came before this one. */
  readonly seed: string;
}

/** New ids fall in `[0, 2^30)`, the lower half of the non-negative 32-bit range. */
const NEW_ID_MASK = (1 << 30) - 1;

/** The `w:id` attribute value of a WML element, or undefined when it has none. */
function revisionIdOf(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const attribute of node.attributes) {
    if (attribute.localName === 'id' && attribute.namespaceUri === WML_NAMESPACE_URI) {
      return attribute.value;
    }
  }
  return undefined;
}

/** WML parts in the order the pass gives out ids: the main document, then by name. */
function partsInOrder(pkg: OoxmlPackage): OoxmlPart[] {
  const parts: OoxmlPart[] = [];
  for (const part of pkg.parts.values()) {
    if (part.root.namespaceUri === WML_NAMESPACE_URI) parts.push(part);
  }
  return parts.sort((left, right) => {
    if (left.name === pkg.mainDocumentPart) return -1;
    if (right.name === pkg.mainDocumentPart) return 1;
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });
}

/** Ids in use, and the annotations that must move off theirs. Gathered in one walk per part. */
class RevisionIdScan {
  readonly used = new Set<number>();
  readonly conflicts: Conflict[] = [];
  /** Conflicts seen so far per authored id, for each conflict's seed. */
  private readonly repeats = new Map<string, number>();

  /** Claims `value` for a new annotation; answers whether the annotation keeps it. */
  private claim(value: string): boolean {
    const parsed = parseRevisionId(value);
    if (parsed === null || this.used.has(parsed)) return false;
    this.used.add(parsed);
    return true;
  }

  private conflict(partName: string, nodeId: string, value: string): Conflict {
    const count = this.repeats.get(value) ?? 0;
    this.repeats.set(value, count + 1);
    const conflict = { partName, nodeIds: [nodeId], seed: `${value}\u0000${count}` };
    this.conflicts.push(conflict);
    return conflict;
  }

  scanPart(part: OoxmlPart): void {
    // Open range starts by family and authored id, newest last, so an end closes the start
    // it nests in. Ranges do not cross parts.
    const open = new Map<string, (Conflict | null)[]>();
    const visit = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.namespaceUri === WML_NAMESPACE_URI) {
        if (REVISION_ID_BEARING.has(node.localName)) {
          this.single(part.name, node);
        } else {
          const range = PAIRED_RANGES.get(node.localName);
          if (range) this.range(part.name, node, range.family, range.start, open);
        }
      } else if (node.namespaceUri === MC_NAMESPACE_URI && node.localName === 'Fallback') {
        // A fallback holds a second copy of the content its choice holds, ids included; only
        // one of the two is read, and save re-syncs a text box fallback from its choice. Its
        // ids are not rewritten, but no new id may take one of them.
        this.reserve(node);
        return;
      }
      for (const child of node.children) visit(child);
    };
    visit(part.root);
  }

  /** Marks every revision id under `node` as used, without claiming or rewriting any. */
  private reserve(node: OoxmlNode): void {
    if (node.kind === 'textValue') return;
    if (
      node.namespaceUri === WML_NAMESPACE_URI &&
      (REVISION_ID_BEARING.has(node.localName) || PAIRED_RANGES.has(node.localName))
    ) {
      const value = revisionIdOf(node);
      const parsed = value === undefined ? null : parseRevisionId(value);
      if (parsed !== null) this.used.add(parsed);
    }
    for (const child of node.children) this.reserve(child);
  }

  private single(partName: string, node: OoxmlNode): void {
    const value = revisionIdOf(node);
    if (value === undefined || this.claim(value)) return;
    this.conflict(partName, node.id, value);
  }

  private range(
    partName: string,
    node: OoxmlNode,
    family: string,
    start: boolean,
    open: Map<string, (Conflict | null)[]>
  ): void {
    const value = revisionIdOf(node);
    if (value === undefined) return;
    const key = `${family}\u0000${value}`;
    if (start) {
      const conflict = this.claim(value) ? null : this.conflict(partName, node.id, value);
      const stack = open.get(key);
      if (stack) stack.push(conflict);
      else open.set(key, [conflict]);
      return;
    }
    const stack = open.get(key);
    if (stack && stack.length > 0) {
      // The end takes whatever id its start ends up with.
      stack.pop()?.nodeIds.push(node.id);
      return;
    }
    // An end with no start is an annotation of its own.
    this.single(partName, node);
  }

  /** New ids for every conflict, in the order they were found. */
  assign(): Map<string, Map<string, string>> {
    const byPart = new Map<string, Map<string, string>>();
    for (const conflict of this.conflicts) {
      // The used set holds at most one id per element read, far fewer than the 2^30 values
      // the probe can walk, so it reaches a free one quickly.
      let id = fnv1a32(conflict.seed) & NEW_ID_MASK;
      while (this.used.has(id)) id = (id + 1) & NEW_ID_MASK;
      this.used.add(id);
      let changes = byPart.get(conflict.partName);
      if (!changes) byPart.set(conflict.partName, (changes = new Map()));
      for (const nodeId of conflict.nodeIds) changes.set(nodeId, String(id));
    }
    return byPart;
  }
}

/**
 * The copy a previous save made of a node, and the id changes it was made with.
 *
 * The serializer caches markup by node identity. Handing back the same copy while the same
 * ids change under it lets a repeated save reuse that markup, instead of serializing every
 * renumbered paragraph again.
 */
const rewrittenCopies = new WeakMap<
  OoxmlNode,
  { readonly signature: string; readonly node: OoxmlNode }
>();

/**
 * `node` with the listed elements' `w:id` rewritten, copying only their ancestors.
 * `applied` collects each change made in the subtree, as node id then new id.
 */
function withRevisionIds(
  node: OoxmlNode,
  changes: ReadonlyMap<string, string>,
  applied: string[]
): OoxmlNode {
  if (node.kind === 'textValue') return node;
  const mark = applied.length;
  const replacement = changes.get(node.id);
  if (replacement !== undefined) applied.push(node.id, replacement);
  let children: OoxmlNode[] | null = null;
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]!;
    const next = withRevisionIds(child, changes, applied);
    if (next === child) continue;
    children ??= [...node.children];
    children[index] = next;
  }
  if (applied.length === mark) return node;
  const signature = applied.slice(mark).join('\u0000');
  const previous = rewrittenCopies.get(node);
  if (previous !== undefined && previous.signature === signature) return previous.node;
  let attributes: readonly OoxmlAttribute[] = node.attributes;
  if (replacement !== undefined) {
    attributes = node.attributes.map((attribute) =>
      attribute.localName === 'id' && attribute.namespaceUri === WML_NAMESPACE_URI
        ? { ...attribute, value: replacement }
        : attribute
    );
  }
  const copy = { ...node, attributes, children: children ?? node.children } as OoxmlNode;
  rewrittenCopies.set(node, { signature, node: copy });
  return copy;
}

/**
 * An export snapshot in which every revision element has its own in-range `@w:id` across all
 * parts. Returns `pkg` itself when the ids already are, after one walk of each WML part.
 */
export function* uniqueRevisionIdsExportPackageSteps(
  pkg: OoxmlPackage
): Generator<void, OoxmlPackage> {
  const scan = new RevisionIdScan();
  for (const part of partsInOrder(pkg)) {
    scan.scanPart(part);
    yield;
  }
  if (scan.conflicts.length === 0) return pkg;
  const parts = new Map(pkg.parts);
  for (const [partName, changes] of scan.assign()) {
    const part = parts.get(partName)!;
    parts.set(partName, {
      ...part,
      root: withRevisionIds(part.root, changes, []) as typeof part.root,
    });
    yield;
  }
  return Object.freeze({ ...pkg, parts });
}

/** {@link uniqueRevisionIdsExportPackageSteps}, run to completion. */
export function uniqueRevisionIdsExportPackage(pkg: OoxmlPackage): OoxmlPackage {
  const steps = uniqueRevisionIdsExportPackageSteps(pkg);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
