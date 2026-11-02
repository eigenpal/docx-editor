// Give every saved change its own `@w:id`, across every part, on save.
//
// The live tree may hold one revision id in several changes: a header or note part mints its
// ids without looking at the body, and merged edits can meet on one id. The pieces of ONE
// change split by a later edit also share its id, on purpose: the editor reviews them as one
// change. A reader of the saved file needs each change to name its own annotation, and needs
// the id to fit a 32-bit signed integer. This pass writes that into an EXPORT snapshot only.
// The document state, its review grouping, and the ids collaboration peers mint in their
// stripes do not change.
//
// A change is every revision element of one story with the same id, author and date: the body
// of a part, or one note, comment or text box in it. Its pieces keep one id, so the saved file
// reopens with the same list of changes.
//
// The pass is deterministic and minimal. Parts are visited in a fixed order (main document
// first, then by part name), and elements in document order. The first change to use an id
// keeps it, so a file whose ids already name one change each saves unchanged. Every later
// change on a taken id, and every id that is not a valid 32-bit integer, gets a new id.
//
// A new id depends only on the id the change had and on how many changes with that id came
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

interface PairedRange {
  readonly family: string;
  readonly start: boolean;
}

/** The ranges whose start and end share one revision id, keyed by element local name. */
const PAIRED_RANGES: ReadonlyMap<string, PairedRange> = new Map(
  [
    'moveFrom',
    'moveTo',
    'customXmlIns',
    'customXmlDel',
    'customXmlMoveFrom',
    'customXmlMoveTo',
  ].flatMap((family): [string, PairedRange][] => [
    [`${family}RangeStart`, { family, start: true }],
    [`${family}RangeEnd`, { family, start: false }],
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

/** The value of a WML attribute of an element, or undefined when it has none. */
function wmlAttributeOf(
  node: { readonly attributes: readonly OoxmlAttribute[] },
  localName: string
): string | undefined {
  for (const attribute of node.attributes) {
    if (attribute.localName === localName && attribute.namespaceUri === WML_NAMESPACE_URI) {
      return attribute.value;
    }
  }
  return undefined;
}

/** The `w:id` attribute value of a WML element, or undefined when it has none. */
function revisionIdOf(node: OoxmlNode): string | undefined {
  return node.kind === 'textValue' ? undefined : wmlAttributeOf(node, 'id');
}

/**
 * The story `node` opens inside its part, or undefined when it opens none. Each note, comment
 * and text box is a story of its own, and the review pane never joins two stories into one
 * change. A note or comment is named by its own id; a text box by its place in the part, so
 * that every peer names it alike. `nextTextBox` counts the part's text boxes.
 */
function storyOf(node: OoxmlNode, nextTextBox: () => number): string | undefined {
  if (node.kind === 'textValue' || node.namespaceUri !== WML_NAMESPACE_URI) return undefined;
  switch (node.localName) {
    case 'footnote':
    case 'endnote':
    case 'comment':
      return `${node.localName}:${wmlAttributeOf(node, 'id') ?? ''}`;
    case 'txbxContent':
      return `txbx:${nextTextBox()}`;
    default:
      return undefined;
  }
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

/**
 * Ids in use, and the changes that must move off theirs. Gathered in one walk per part.
 *
 * A change is every revision element of one story with the same id, author and date: the
 * pieces a later edit split off keep all three, and the review pane lists them as one change
 * (`review-reads.ts` keys its items on them, and finer). So a change keeps one id, and every
 * piece of it takes the same new id when it must move.
 */
class RevisionIdScan {
  readonly used = new Set<number>();
  readonly conflicts: Conflict[] = [];
  /** Each change seen so far: null when it keeps its id, else its conflict. */
  private readonly changes = new Map<string, Conflict | null>();
  /** Conflicts seen so far per authored id, for each conflict's seed. */
  private readonly repeats = new Map<string, number>();
  /** The story the walk is in, inside its part; see `storyOf`. */
  private story = '';
  /** Range starts seen so far, so that each range is a change of its own. */
  private ranges = 0;

  /**
   * The conflict of the change `node` belongs to, or null when the change keeps its id.
   * `node` joins its change's conflict, so every piece takes one new id.
   */
  private claim(
    partName: string,
    node: OoxmlNode,
    value: string,
    annotation = ''
  ): Conflict | null {
    const parsed = parseRevisionId(value);
    const element = node as { readonly attributes: readonly OoxmlAttribute[] };
    const change = [
      partName,
      this.story,
      annotation,
      parsed === null ? `raw:${value}` : String(parsed),
      wmlAttributeOf(element, 'author') ?? '',
      wmlAttributeOf(element, 'date') ?? '',
    ].join('\u0000');
    if (this.changes.has(change)) {
      const known = this.changes.get(change)!;
      known?.nodeIds.push(node.id);
      return known;
    }
    if (parsed !== null && !this.used.has(parsed)) {
      this.used.add(parsed);
      this.changes.set(change, null);
      return null;
    }
    const count = this.repeats.get(value) ?? 0;
    this.repeats.set(value, count + 1);
    const conflict = { partName, nodeIds: [node.id], seed: `${value}\u0000${count}` };
    this.conflicts.push(conflict);
    this.changes.set(change, conflict);
    return conflict;
  }

  scanPart(part: OoxmlPart): void {
    // Open range starts by family and authored id, newest last, so an end closes the start
    // it nests in. Ranges do not cross parts.
    const open = new Map<string, (Conflict | null)[]>();
    let textBoxes = 0;
    const visit = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      const story = storyOf(node, () => (textBoxes += 1));
      if (story !== undefined) {
        const outer = this.story;
        this.story = story;
        for (const child of node.children) visit(child);
        this.story = outer;
        return;
      }
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
    this.story = '';
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
    if (value !== undefined) this.claim(partName, node, value);
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
      // A range is never a piece of a split change: two ranges on one id are two annotations.
      const conflict = this.claim(partName, node, value, `range:${(this.ranges += 1)}`);
      const stack = open.get(key);
      if (stack) stack.push(conflict);
      else open.set(key, [conflict]);
      return;
    }
    const stack = open.get(key);
    if (stack && stack.length > 0) {
      // The end takes whatever id its start ends up with.
      const conflict = stack.pop();
      if (conflict && !conflict.nodeIds.includes(node.id)) conflict.nodeIds.push(node.id);
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
