// Typing and deleting AS TRACKED CHANGES — what suggesting mode writes.
//
// Two shapes, and they are not symmetrical. An insertion is new content, so it goes into a
// `w:ins` wrapper the file did not have; a deletion keeps the words exactly where they are
// and re-labels them, `w:t` becoming `w:delText` inside a `w:del`. That asymmetry is the
// whole point of tracking: the reader has to be able to see what would go.
//
// WHY THE PARAGRAPH IS REBUILT rather than surgically patched. `w:ins` and `w:del` are
// paragraph-level (`EG_PContent`), not run-level, so tracking a change in the middle of a run
// means splitting that run and placing a sibling between the halves — and the run may sit
// inside a hyperlink, inside another revision, or both. A single ordered rebuild handles
// every nesting the same way; a set of splice-in-place edits needs a separate case for each
// and gets the offsets wrong the first time two of them overlap.
//
// Word's merge rules are followed where they are observable in the file:
//   - typing inside your own `w:ins` EXTENDS it rather than nesting a second one;
//   - deleting your own pending insertion REMOVES it, because there is nothing to propose to
//     anyone else — the text never existed for them;
//   - deleting inside an existing `w:del` does nothing, since it is already gone.
//
// EVERY length here comes from `paragraphOffsetIndex`, which is `segmentsOf`'s own walk. This
// module used to carry a private `lengthOf` that summed text characters, and it disagreed with
// the authority on three things: a note reference and an atomic field measure ONE unit each and
// it gave them none, and a field's `w:instrText` measures nothing and it counted its
// characters. In any paragraph holding a footnote, an endnote or a field, that put a tracked
// insert at the wrong offset, refused an insert at the true paragraph end as out of range, and
// struck one character too many while leaving the reference standing.

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  createNodeIdAllocator,
  parentNodeOf as parentOf,
  replaceChildren,
} from '../package/ooxml-edit.ts';
import { equivalentNodes } from './ooxml-node-equality.ts';
import { TEXT_DEPS, fromEdit } from './tree-op-nodes.ts';
import { paragraphOffsetIndex, type ParagraphOffsetIndex } from './tree-op-segments.ts';
import { insertionAuthor, insideDeletion } from './tree-op-retraction.ts';
import type { RevisionAttributionInput, TreeOpEffect, TreeOpResult } from './tree-op-validate.ts';

function attr(localName: string, value: string) {
  return {
    kind: 'genericExtension' as const,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    value,
  };
}

function build(
  id: string,
  kind: OoxmlElement['kind'],
  localName: string,
  attributes: OoxmlElement['attributes'],
  children: readonly OoxmlNode[]
): OoxmlElement {
  return {
    id,
    kind,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes,
    children,
  } as OoxmlElement;
}

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

function revisionAttributes(id: string, revision: RevisionAttributionInput) {
  return [
    attr('id', id),
    attr('author', revision.author),
    ...(revision.date === undefined ? [] : [attr('date', revision.date)]),
  ];
}

/** A `w:t`, or the `w:delText` the same characters become once struck. */
function textNode(mint: () => string, value: string, deleted: boolean): OoxmlNode {
  const valueId = mint();
  return build(
    mint(),
    deleted ? 'deletedText' : 'text',
    deleted ? 'delText' : 't',
    [],
    [{ id: valueId, kind: 'textValue', value } as OoxmlNode]
  );
}

/** A run carrying `properties` (its `w:rPr`, kept) and one text node. */
function runWith(
  mint: () => string,
  properties: readonly OoxmlNode[],
  value: string,
  deleted: boolean
): OoxmlNode {
  return build(mint(), 'run', 'r', [], [...properties, textNode(mint, value, deleted)]);
}

function isRunProperties(node: OoxmlNode): boolean {
  return node.kind !== 'textValue' && node.kind === 'runProperties';
}

/** Deep copy with fresh ids, so a split run's halves are two nodes and not one twice. */
function copy(mint: () => string, node: OoxmlNode): OoxmlNode {
  if (node.kind === 'textValue') return { id: mint(), kind: 'textValue', value: node.value };
  return {
    ...node,
    id: mint(),
    children: node.children.map((child) => copy(mint, child)),
  } as OoxmlNode;
}

/**
 * Whether an existing revision's timestamp belongs to the edit being made now.
 *
 * Coalescing is for a continuous editing run, so the window is small: two keystrokes a
 * minute apart are still one thought, two edits a month apart are not one revision. Two
 * dateless wrappers join — a file written with date stamping off has nothing else to go on.
 */
function sameEditingMoment(existing: string | undefined, current: string | undefined): boolean {
  if (existing === undefined || current === undefined) return existing === current;
  const from = Date.parse(existing);
  const to = Date.parse(current);
  if (Number.isNaN(from) || Number.isNaN(to)) return existing === current;
  return Math.abs(to - from) <= COALESCE_WINDOW_MS;
}

const COALESCE_WINDOW_MS = 60_000;

/** A wrapper's `@w:date`, or undefined. */
function revisionDateOf(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'date'
  )?.value;
}

/** A deletion wrapper's `@w:id`, or null for anything else. */
function deletionId(node: OoxmlNode): string | null {
  if (node.kind !== 'revisionDelete') return null;
  return (
    node.attributes.find(
      (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'id'
    )?.value ?? null
  );
}

interface Cursor {
  offset: number;
}

/**
 * The nodes an ATOM occupies, split into the one that carries its offset and the rest.
 *
 * A complex field is one addressable unit spread over five or six runs — `w:fldChar begin`,
 * `w:instrText`, `w:fldChar separate`, the cached result, `w:fldChar end`. `segmentsOf` gives
 * the whole thing ONE model position, at the begin node, and lists every other node it
 * swallows. A tracked edit has to respect that grouping or it writes markup no reader can
 * resolve: a `begin` inside a `w:del` with its `end` outside is a field whose deletion cannot
 * be accepted without orphaning the rest of it, and text typed at the field's model end lands
 * between the chrome runs, inside the instruction, where it is invisible and stays invisible.
 */
interface AtomNodes {
  /** The node the atom's single offset belongs to — its `begin`, or the `w:fldSimple`. */
  readonly begin: ReadonlySet<string>;
  /** Everything else the atom swallows: instruction, separator, cached result, end. */
  readonly tail: ReadonlySet<string>;
}

function atomNodesOf(offsets: ParagraphOffsetIndex): AtomNodes {
  const begin = new Set<string>();
  const tail = new Set<string>();
  for (const segment of offsets.segments) {
    if (!segment.removeNodeIds || segment.removeNodeIds.length === 0) continue;
    begin.add(segment.node.id);
    for (const id of segment.removeNodeIds) {
      if (id !== segment.node.id) tail.add(id);
    }
  }
  return { begin, tail };
}

/** A run's content — everything but its `w:rPr`. */
function contentOf(node: OoxmlNode): readonly OoxmlNode[] {
  return childrenOf(node).filter((child) => !isRunProperties(child));
}

/** A run holding nothing but an atom's TAIL: chrome, and never a position of its own. */
function isAtomTailRun(node: OoxmlNode, atoms: AtomNodes): boolean {
  if (node.kind !== 'run') return false;
  const content = contentOf(node);
  return content.length > 0 && content.every((child) => atoms.tail.has(child.id));
}

/** A run holding an atom's addressable node — the one position the whole atom has. */
function holdsAtomBegin(node: OoxmlNode, atoms: AtomNodes): boolean {
  if (node.kind !== 'run') return false;
  return contentOf(node).some((child) => atoms.begin.has(child.id));
}

/**
 * Insert `text` at `offset` as a tracked insertion.
 *
 * Returns the paragraph's new children, or null when the offset was never reached — which
 * means the caller's offset is past the end of the paragraph and the op should be refused
 * rather than quietly appended somewhere else.
 */
export function applyInsertTracked(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  text: string,
  revision: RevisionAttributionInput,
  options?: { readonly deferValidation?: boolean }
): TreeOpResult {
  const mint = createNodeIdAllocator(part);
  const mintRevision = nextRevisionId(part);
  const offsets = paragraphOffsetIndex(paragraph);
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'text-local',
  };
  const cursor: Cursor = { offset: 0 };
  const atoms = atomNodesOf(offsets);
  let placed = false;

  // Typing over a selection arrives as a deletion and an insertion in ONE transaction, the
  // deletion first — so by the time this runs, the struck words are already in the tree at
  // the caret. Adopting their identity makes the pair one revision in the file, which is
  // what lets one Accept resolve both halves and one undo take the whole edit back.
  // Only a deletion from THIS edit joins: `adjacentDeletion` matches on author alone, and a
  // deletion the same author made last month is also adjacent. Adopting its date would
  // backdate today's edit into last month's revision and make rejecting one reject both.
  const replaced = adjacentDeletion(
    paragraph,
    offsets,
    offset,
    offset,
    revision.author,
    revision.date
  );
  const attribution: RevisionAttributionInput = replaced
    ? { author: revision.author, ...(replaced.date === undefined ? {} : { date: replaced.date }) }
    : revision;
  const insertionId = replaced?.id ?? mintRevision();

  const wrap = (properties: readonly OoxmlNode[]): OoxmlNode =>
    build(mint(), 'revisionInsert', 'ins', revisionAttributes(insertionId, attribution), [
      runWith(mint, properties, text, false),
    ]);

  const rebuild = (nodes: readonly OoxmlNode[], stack: readonly OoxmlNode[]): OoxmlNode[] => {
    const out: OoxmlNode[] = [];
    for (const node of nodes) {
      if (placed) {
        out.push(node);
        continue;
      }
      // `w:pPr` IS a child of the paragraph, it measures nothing, and §17.3.1.26 requires it
      // FIRST — so it is never a place to put words. Without this it took every insertion
      // aimed at offset 0 (the boundary rule below fires for anything that is not a run) and
      // wrote `<w:p><w:ins/><w:pPr/></w:p>`, which the paragraph invariant refuses. Every
      // keystroke in an empty paragraph that carries properties — the one Enter has just
      // made, a list item, a styled blank line — was rejected, so suggesting mode looked
      // dead from the moment the caret landed in a new paragraph.
      if (node.kind !== 'textValue' && node.kind === 'paragraphProperties') {
        out.push(node);
        continue;
      }

      const length = offsets.lengthOf(node);
      const start = cursor.offset;
      const end = start + length;

      // Chrome of an atom already passed: never a place to put words. A field's instruction,
      // separator, cached result and end run all measure nothing and all sit at the same
      // offset as each other, so the first of them would take an insertion aimed at the
      // position AFTER the field — putting the typed text inside the field, where it is
      // invisible to every reader including this one.
      if (isAtomTailRun(node, atoms)) {
        out.push(node);
        continue;
      }

      // A container the offset falls inside: descend, and let the split happen at the run.
      //
      // At a BOUNDARY the rule is narrower — descend only into our own `w:ins`. Typing on at
      // the end of your own insertion is one continuous proposal and Word records it as one
      // `w:ins`; without this every keystroke opened a new revision, so a typed word arrived
      // in the review pane as a column of one-letter cards. Stepping into anyone ELSE's
      // wrapper at a boundary would be the opposite mistake: putting your words inside their
      // proposal, where accepting theirs would accept yours.
      // A DELETION is not descended into. Text placed inside one would be written as `w:t`
      // where §17.3.3.7 requires `w:delText`, and — worse — accepting that unrelated
      // deletion would take the newly typed words with it. The insertion goes beside it.
      const container =
        node.kind !== 'textValue' &&
        (node.kind === 'hyperlink' ||
          node.kind === 'revisionInsert' ||
          node.kind === 'revisionMoveTo');
      // Same MOMENT as well as the same author — the deletion path already gates on this.
      // Typing at the end of your own month-old insertion backdated today's edit into that
      // revision, and rejecting one then rejected both.
      const ownInsertion =
        container &&
        insertionAuthor([node]) === revision.author &&
        sameEditingMoment(revisionDateOf(node), revision.date);
      if (
        container &&
        ((offset > start && offset < end) || (ownInsertion && offset >= start && offset <= end))
      ) {
        out.push({ ...node, children: rebuild(node.children, [...stack, node]) } as OoxmlNode);
        continue;
      }

      // INSIDE struck text. The caret can rest there — all-markup shows the words, so the
      // reader can put it between two of them — and the module's rule is that an insertion
      // goes BESIDE a deletion, never into it. Only the start boundary implemented that, so
      // every interior offset was refused `offset-out-of-range`: a caret the surface had
      // placed, at a position the offset model calls valid, that would take no typing.
      // A deletion stays contiguous, so the words go after it, which is also the order a
      // replacement reads in.
      if (
        !placed &&
        offset > start &&
        offset < end &&
        node.kind !== 'textValue' &&
        (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom')
      ) {
        cursor.offset = end;
        out.push(node, wrap([]));
        placed = true;
        continue;
      }

      // A BOUNDARY against something that is not a run — a revision wrapper, a hyperlink,
      // a bookmark. Nothing here can be split, so the insertion goes beside it, and which
      // side is the whole question.
      if (!placed && offset === start && node.kind !== 'run') {
        // Typing over a selection: the words being replaced start exactly here, and Word
        // puts the replacement AFTER them — struck text first, then what takes its place.
        // Before them would read as "omega alpha" with alpha struck, which inverts the
        // sentence. It also puts the two halves side by side, which is what lets a reader
        // see them as one replacement.
        const isReplacedText =
          replaced !== null && node.kind === 'revisionDelete' && deletionId(node) === replaced.id;
        if (isReplacedText) {
          cursor.offset = end;
          out.push(node, wrap([]));
          placed = true;
          continue;
        }
        out.push(wrap([]));
        placed = true;
        cursor.offset = end;
        out.push(node);
        continue;
      }

      // The END boundary of an atom's begin run is the END of the WHOLE atom, and the atom's
      // remaining runs are still to come. Placing here would put the words between the
      // field's `begin` and its instruction; deferring lets the tail runs pass and the
      // insertion land after the field, which is where the model offset points.
      if (holdsAtomBegin(node, atoms) && offset === end && offset !== start) {
        cursor.offset = end;
        out.push(node);
        continue;
      }

      if (node.kind === 'run' && offset >= start && offset <= end) {
        const own = insertionAuthor([...stack, node]);
        // Inside our OWN pending insertion: extend it. A second `w:ins` nested in the first
        // says two people proposed the same words, which is not what happened.
        if (own === revision.author) {
          out.push(splitRunAndInsert(mint, offsets, node, offset - start, text, false));
          placed = true;
          cursor.offset = end + text.length;
          continue;
        }
        const properties = childrenOf(node)
          .filter(isRunProperties)
          .map((child) => copy(mint, child));
        if (offset === start) {
          out.push(wrap(properties), node);
        } else if (offset === end) {
          out.push(node, wrap(properties));
        } else {
          const [head, tail] = splitRun(mint, offsets, node, offset - start);
          out.push(head, wrap(properties), tail);
        }
        placed = true;
        cursor.offset = end;
        continue;
      }

      cursor.offset = end;
      out.push(node);
    }
    return out;
  };

  let children = mergedRevisions(mint, rebuild(paragraph.children, []));
  if (!placed) {
    // An empty paragraph, or an offset at the very end with no run to hang it on.
    if (offset !== cursor.offset) {
      return { ok: false, reason: 'offset-out-of-range', detail: 'offset past the paragraph' };
    }
    children = [...children, wrap([])];
  }
  return fromEdit(replaceChildren(part, paragraph.id, children, options), effect);
}

/** Split a run at a local offset, keeping its `w:rPr` on both halves. */
function splitRun(
  mint: () => string,
  offsets: ParagraphOffsetIndex,
  run: OoxmlNode,
  local: number
): [OoxmlNode, OoxmlNode] {
  const properties = childrenOf(run).filter(isRunProperties);
  const head: OoxmlNode[] = [];
  const tail: OoxmlNode[] = [];
  let seen = 0;
  for (const child of childrenOf(run)) {
    if (isRunProperties(child)) continue;
    const length = offsets.lengthOf(child);
    if (seen + length <= local) head.push(child);
    else if (seen >= local) tail.push(child);
    else if (child.kind === 'text' || child.kind === 'deletedText') {
      const value = childrenOf(child).find((grand) => grand.kind === 'textValue');
      const raw = value && value.kind === 'textValue' ? value.value : '';
      const at = local - seen;
      head.push(textNode(mint, raw.slice(0, at), child.kind === 'deletedText'));
      tail.push(textNode(mint, raw.slice(at), child.kind === 'deletedText'));
    } else tail.push(child);
    seen += length;
  }
  return [
    build(mint(), 'run', 'r', [], [...properties.map((child) => copy(mint, child)), ...head]),
    build(mint(), 'run', 'r', [], [...properties.map((child) => copy(mint, child)), ...tail]),
  ];
}

/** Put `text` into an existing run at a local offset — the extend-my-own-insertion path. */
function splitRunAndInsert(
  mint: () => string,
  offsets: ParagraphOffsetIndex,
  run: OoxmlNode,
  local: number,
  text: string,
  deleted: boolean
): OoxmlNode {
  const [head, tail] = splitRun(mint, offsets, run, local);
  const content = [
    ...childrenOf(head).filter((child) => !isRunProperties(child)),
    textNode(mint, text, deleted),
    ...childrenOf(tail).filter((child) => !isRunProperties(child)),
  ];
  const properties = childrenOf(run)
    .filter(isRunProperties)
    .map((child) => copy(mint, child));
  return build(mint(), 'run', 'r', [], [...properties, ...coalesced(mint, content)]);
}

/**
 * Merge adjacent text nodes of the same kind.
 *
 * Splitting a run and putting the new characters back leaves `<w:t>ab</w:t><w:t>c</w:t>` —
 * valid, and read identically by anything that concatenates, but it accumulates one element
 * per keystroke and is not what Word writes.
 */
function coalesced(mint: () => string, nodes: readonly OoxmlNode[]): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  for (const node of nodes) {
    const previous = out[out.length - 1];
    const mergeable =
      previous !== undefined &&
      previous.kind === node.kind &&
      (node.kind === 'text' || node.kind === 'deletedText');
    if (!mergeable) {
      out.push(node);
      continue;
    }
    const left = childrenOf(previous).find((child) => child.kind === 'textValue');
    const right = childrenOf(node).find((child) => child.kind === 'textValue');
    const value =
      (left && left.kind === 'textValue' ? left.value : '') +
      (right && right.kind === 'textValue' ? right.value : '');
    out[out.length - 1] = textNode(mint, value, node.kind === 'deletedText');
  }
  return out;
}

/** A node's children, or none for a text value — the union's only childless member. */
function childrenOf(node: OoxmlNode): readonly OoxmlNode[] {
  return node.kind === 'textValue' ? [] : node.children;
}

/**
 * Delete `[start, end)` as a tracked deletion: the words stay, re-labelled.
 *
 * Content already inside a `w:del` is left alone, and content inside the caller's OWN `w:ins`
 * is removed outright — it was never proposed to anybody else, so there is nothing to strike.
 */
export function applyDeleteTracked(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  start: number,
  end: number,
  revision: RevisionAttributionInput,
  options?: { readonly deferValidation?: boolean }
): TreeOpResult {
  const mint = createNodeIdAllocator(part);
  const mintRevision = nextRevisionId(part);
  // Join the deletion the caret is already working on, rather than minting a fresh id per
  // keystroke. Holding Backspace through a word is ONE decision — Word records it as one
  // `w:del` and offers one Accept — and a new id per character turned a deleted word into a
  // column of one-letter cards, the same way untracked insertions did before they coalesced.
  //
  // The whole `CT_TrackChange` triple is joined, not just the id: a reader identifies a
  // revision by (id, author, date), so a fresh timestamp per keystroke split the run back
  // into one card per character even with the id shared.
  const offsets = paragraphOffsetIndex(paragraph);
  const adjacent = adjacentDeletion(paragraph, offsets, start, end, revision.author, revision.date);
  const revisionId = adjacent?.id ?? mintRevision();
  const attribution: RevisionAttributionInput = adjacent
    ? { author: revision.author, ...(adjacent.date === undefined ? {} : { date: adjacent.date }) }
    : revision;
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'text-local',
  };
  const cursor: Cursor = { offset: 0 };
  // The nodes of every atom whose single model unit falls INSIDE the struck range. An atom is
  // one addressable unit, so it goes whole: striking a field's `begin` and leaving its
  // instruction, separator, result and `end` standing wrote a field no reader can resolve, and
  // accepting that deletion removed the `begin` and orphaned the rest of it in the file.
  const struck = new Set<string>();
  for (const segment of offsets.segments) {
    if (!segment.removeNodeIds || segment.removeNodeIds.length === 0) continue;
    if (segment.start < start || segment.end > end) continue;
    for (const id of segment.removeNodeIds) struck.add(id);
  }
  /** A run carrying part of a struck atom, whether or not it carries the offset itself. */
  const carriesStruckAtom = (node: OoxmlNode): boolean =>
    node.kind !== 'textValue' && contentOf(node).some((child) => struck.has(child.id));

  const strike = (nodes: readonly OoxmlNode[]): OoxmlNode =>
    build(mint(), 'revisionDelete', 'del', revisionAttributes(revisionId, attribution), nodes);

  const rebuild = (nodes: readonly OoxmlNode[], stack: readonly OoxmlNode[]): OoxmlNode[] => {
    const out: OoxmlNode[] = [];
    for (const node of nodes) {
      const length = offsets.lengthOf(node);
      const from = cursor.offset;
      const to = from + length;

      // A `w:fldSimple` cannot go inside a `w:del`: `CT_RunTrackChange` takes
      // `EG_ContentRunContent`, which has no `fldSimple` in it. Word strikes one by putting
      // the deletion INSIDE the field, around its runs, and so does this.
      if (struck.has(node.id) && node.kind !== 'textValue' && isWmlNamed(node, 'fldSimple')) {
        cursor.offset = to;
        out.push({
          ...node,
          children: mergedRevisions(
            mint,
            node.children.map((child) =>
              child.kind === 'run' && !insideDeletion(stack)
                ? strike([toDeleted(mint, child)])
                : child
            )
          ),
        } as OoxmlNode);
        continue;
      }

      if ((to <= start || from >= end || length === 0) && !carriesStruckAtom(node)) {
        cursor.offset = to;
        out.push(node);
        continue;
      }

      if (
        node.kind !== 'textValue' &&
        (node.kind === 'hyperlink' ||
          node.kind === 'revisionInsert' ||
          node.kind === 'revisionDelete' ||
          node.kind === 'revisionMoveFrom' ||
          node.kind === 'revisionMoveTo')
      ) {
        const rebuilt = rebuild(node.children, [...stack, node]);
        // A wrapper emptied by the removal of our own insertion goes with it; one that still
        // holds content stays, because it is still saying something about that content.
        if (rebuilt.length > 0) out.push({ ...node, children: rebuilt } as OoxmlNode);
        continue;
      }

      if (node.kind !== 'run') {
        cursor.offset = to;
        out.push(node);
        continue;
      }

      cursor.offset = to;
      if (insideDeletion(stack)) {
        // Already struck. Deleting it again would nest a second `w:del`, which says the same
        // thing twice and makes accepting it a two-step affair.
        out.push(node);
        continue;
      }
      const own = insertionAuthor(stack) === revision.author;
      const covered = { from: Math.max(start, from) - from, to: Math.min(end, to) - from };
      const pieces = splitRunThree(mint, offsets, node, covered.from, covered.to, struck);
      if (pieces.before) out.push(pieces.before);
      if (pieces.covered) {
        // Our own pending insertion: remove rather than strike. The words were never anyone
        // else's to see, so there is no proposal to make about taking them away.
        if (!own) out.push(strike([toDeleted(mint, pieces.covered)]));
      }
      if (pieces.after) out.push(pieces.after);
    }
    return out;
  };

  const children = mergedRevisions(mint, rebuild(paragraph.children, []));
  return fromEdit(replaceChildren(part, paragraph.id, children, options), effect);
}

/**
 * Fold adjacent revision wrappers that are the same revision into one.
 *
 * Striking a character at a time leaves `<w:del id=0/><w:del id=0/><w:del id=0/>` — one
 * decision by every reader that groups on the id, but three elements where Word writes one,
 * and three more on the next keystroke. Same id, same author, same date, side by side: one
 * wrapper holding all their runs.
 */
function mergedRevisions(mint: () => string, nodes: readonly OoxmlNode[]): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  for (const node of nodes) {
    const previous = out[out.length - 1];
    if (
      previous !== undefined &&
      previous.kind !== 'textValue' &&
      node.kind !== 'textValue' &&
      previous.kind === node.kind &&
      (node.kind === 'revisionInsert' || node.kind === 'revisionDelete') &&
      sameRevision(previous, node)
    ) {
      out[out.length - 1] = {
        ...previous,
        children: mergedRevisionRuns(mint, previous.children, node.children),
      } as OoxmlNode;
      continue;
    }
    out.push(node);
  }
  return out;
}

/** Merge the boundary runs when repeated deletion split one formatted run per keypress. */
function mergedRevisionRuns(
  mint: () => string,
  left: readonly OoxmlNode[],
  right: readonly OoxmlNode[]
): OoxmlNode[] {
  const previous = left[left.length - 1];
  const next = right[0];
  if (
    previous?.kind !== 'run' ||
    next?.kind !== 'run' ||
    !mergeableTextRun(previous) ||
    !mergeableTextRun(next)
  ) {
    return [...left, ...right];
  }
  const previousProperties = previous.children.filter(isRunProperties);
  const nextProperties = next.children.filter(isRunProperties);
  if (!equivalentNodes(previousProperties, nextProperties)) return [...left, ...right];
  const content = coalesced(mint, [
    ...previous.children.filter((child) => !isRunProperties(child)),
    ...next.children.filter((child) => !isRunProperties(child)),
  ]);
  const merged = { ...previous, children: [...previousProperties, ...content] } as OoxmlNode;
  return [...left.slice(0, -1), merged, ...right.slice(1)];
}

/** Only plain text runs are safe to collapse; drawings, breaks and generic atoms stay separate. */
function mergeableTextRun(run: OoxmlElement): boolean {
  const content = run.children.filter((child) => !isRunProperties(child));
  return (
    content.length > 0 &&
    content.every((child) => child.kind === 'text' || child.kind === 'deletedText')
  );
}

/** Two wrappers are the same revision when their `CT_TrackChange` triple agrees. */
function sameRevision(a: OoxmlElement, b: OoxmlElement): boolean {
  const read = (node: OoxmlElement, localName: string): string | undefined =>
    node.attributes.find(
      (attribute) =>
        attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName
    )?.value;
  return (
    read(a, 'id') !== undefined &&
    read(a, 'id') === read(b, 'id') &&
    read(a, 'author') === read(b, 'author') &&
    read(a, 'date') === read(b, 'date')
  );
}

/**
 * The `@w:id` of a deletion by this author touching `[start, end)`, or null.
 *
 * Touching, not overlapping: the run being struck now sits beside the one struck a keystroke
 * ago, never inside it. Both edges are checked, because Backspace grows a deletion leftwards
 * and Delete grows it rightwards.
 */
function adjacentDeletion(
  paragraph: OoxmlParagraphNode,
  offsets: ParagraphOffsetIndex,
  start: number,
  end: number,
  author: string,
  /** Only a wrapper from the same moment joins; see the call sites. */
  within: string | undefined
): { readonly id: string; readonly date: string | undefined } | null {
  let found: { readonly id: string; readonly date: string | undefined } | null = null;
  const visit = (node: OoxmlNode): void => {
    if (found !== null || node.kind === 'textValue') return;
    if (node.kind === 'revisionDelete') {
      const attributes = node.attributes;
      const whose = attributes.find(
        (attribute) =>
          attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'author'
      );
      const id = attributes.find(
        (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'id'
      );
      // A wrapper the offset walk never reached has no span, so it cannot be adjacent to
      // anything: joining it would put this edit under an id at an unknown position.
      const span = offsets.spanOf(node);
      if (whose?.value === author && id && span) {
        if (span.end === start || span.start === end) {
          const when = attributes.find(
            (attribute) =>
              attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'date'
          );
          if (!sameEditingMoment(when?.value, within)) return;
          found = { id: id.value, date: when?.value };
          return;
        }
      }
    }
    for (const child of node.children) visit(child);
  };
  for (const child of paragraph.children) visit(child);
  return found;
}

/** Split a run into the part before the range, the covered part, and the part after. */
function splitRunThree(
  mint: () => string,
  offsets: ParagraphOffsetIndex,
  run: OoxmlNode,
  from: number,
  to: number,
  /** Nodes an atom being struck swallows; covered by identity, since they measure nothing. */
  struckAtomNodes: ReadonlySet<string> = new Set()
): { before: OoxmlNode | null; covered: OoxmlNode | null; after: OoxmlNode | null } {
  const properties = childrenOf(run).filter(isRunProperties);
  const withProperties = (content: readonly OoxmlNode[]): OoxmlNode | null =>
    content.length === 0
      ? null
      : build(
          mint(),
          'run',
          'r',
          [],
          [...properties.map((child) => copy(mint, child)), ...content]
        );

  const before: OoxmlNode[] = [];
  const covered: OoxmlNode[] = [];
  const after: OoxmlNode[] = [];
  let seen = 0;
  for (const child of childrenOf(run)) {
    if (isRunProperties(child)) continue;
    const length = offsets.lengthOf(child);
    const childFrom = seen;
    const childTo = seen + length;
    seen = childTo;
    // An atom's chrome measures nothing, so no offset comparison can place it. It goes with
    // the unit it belongs to, which is being struck.
    if (struckAtomNodes.has(child.id)) {
      covered.push(child);
      continue;
    }
    if (childTo <= from) {
      before.push(child);
      continue;
    }
    if (childFrom >= to) {
      after.push(child);
      continue;
    }
    if (child.kind !== 'text' && child.kind !== 'deletedText') {
      // A tab or a break is atomic: it is covered or it is not.
      covered.push(child);
      continue;
    }
    const value = childrenOf(child).find((grand) => grand.kind === 'textValue');
    const raw = value && value.kind === 'textValue' ? value.value : '';
    const deleted = child.kind === 'deletedText';
    const head = raw.slice(0, Math.max(0, from - childFrom));
    const middle = raw.slice(Math.max(0, from - childFrom), Math.min(raw.length, to - childFrom));
    const tail = raw.slice(Math.min(raw.length, to - childFrom));
    if (head) before.push(textNode(mint, head, deleted));
    if (middle) covered.push(textNode(mint, middle, deleted));
    if (tail) after.push(textNode(mint, tail, deleted));
  }
  return {
    before: withProperties(before),
    covered: withProperties(covered),
    after: withProperties(after),
  };
}

/** Re-label a run's text as deleted: `w:t` becomes `w:delText`, everything else stays. */
function toDeleted(mint: () => string, run: OoxmlNode): OoxmlNode {
  const children = childrenOf(run).map((child) => {
    // `w:instrText` becomes `w:delInstrText` inside a deletion, exactly as `w:t` becomes
    // `w:delText`. The REJECT path already renames it back, so without this the write path
    // could never produce what the reject path exists to undo.
    if (child.kind !== 'textValue' && isWmlNamed(child, 'instrText')) {
      const value = childrenOf(child).find((grand) => grand.kind === 'textValue');
      const raw = value && value.kind === 'textValue' ? value.value : '';
      const valueId = mint();
      return build(mint(), 'generic', 'delInstrText', child.attributes, [
        { id: valueId, kind: 'textValue', value: raw } as OoxmlNode,
      ]);
    }
    if (child.kind !== 'text') return child;
    const value = childrenOf(child).find((grand) => grand.kind === 'textValue');
    const raw = value && value.kind === 'textValue' ? value.value : '';
    return textNode(mint, raw, true);
  });
  return { ...run, id: mint(), children } as OoxmlNode;
}

/**
 * Stamp a paragraph's own MARK as inserted or deleted.
 *
 * `w:pPr/w:rPr/w:ins|w:del` (§17.13.5, `EG_ParaRPrTrackChanges`) is how Word records a split
 * or a merge: the mark is the pilcrow, and the pilcrow is what the edit added or removed.
 * There is no text to strike, which is why this is the only tracked edit with no run in it.
 *
 * SPLIT stamps `w:ins` on the FIRST paragraph — its mark is the one that did not exist
 * before. MERGE stamps `w:del` on the first as well: the mark being proposed for removal is
 * the one between the two paragraphs, which belongs to the first. Rejecting the insert and
 * accepting the delete both run the paragraph into the one after it, which is why
 * `resolveRevisions` treats them the same way.
 *
 * An existing mark of the SAME kind and author is joined rather than replaced, so a run of
 * Enters is one decision and one Accept.
 */
export function applyParagraphMarkRevision(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  kind: 'ins' | 'del',
  revision: RevisionAttributionInput,
  options?: { readonly deferValidation?: boolean }
): TreeOpResult {
  const mint = createNodeIdAllocator(part);
  const effect: TreeOpEffect = {
    dirty: [paragraph.id],
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  };

  const existing = paragraphMarkRevisionOf(paragraph, kind);
  if (existing && existing.author === revision.author) {
    // Already proposed by this author. A second Enter at the same mark is not a second
    // decision, and stamping again would mint an id nothing else refers to.
    return fromEdit({ ok: true, part }, effect);
  }

  const id = adjacentParagraphMarkId(part, paragraph, kind, revision) ?? nextRevisionId(part)();
  const mark = build(mint(), 'generic', kind, revisionAttributes(id, revision), []);

  const properties = childrenOf(paragraph).find((child) => child.kind === 'paragraphProperties');
  const rest = childrenOf(paragraph).filter((child) => child.kind !== 'paragraphProperties');

  // `w:rPr` sits near the END of `CT_PPr` — after the base properties (`w:jc`, `w:spacing`,
  // `w:numPr`, …) and before `w:sectPr`/`w:pPrChange`, which are the only two that may
  // follow it. Placing it first looked tidier and produced a `w:pPr` the tree invariants
  // reject, which is the invariant reading the schema correctly.
  const previousRPr = properties
    ? childrenOf(properties).find((child) => isWmlNamed(child, 'rPr'))
    : undefined;
  // Only the SAME-KIND mark is replaced. `EG_ParaRPrTrackChanges` is `ins? del? moveFrom?
  // moveTo?` — both an insert and a delete may sit here, and that pair is exactly what Word
  // writes when B proposes removing a mark A proposed adding. Stripping every revision took
  // A's out of the file, so rejecting B's deletion made A's break permanent and A's card
  // vanished from every reviewer's pane.
  const rPrRest = previousRPr
    ? childrenOf(previousRPr).filter((child) => !isMarkRevisionOfKind(child, kind))
    : [];
  const siblingMark = rPrRest.filter(isMarkRevision);
  const otherProperties = rPrRest.filter((child) => !isMarkRevision(child));
  // `ins` before `del`, per the group's own order.
  const marks = kind === 'ins' ? [mark, ...siblingMark] : [...siblingMark, mark];
  const rPr = build(mint(), 'runProperties', 'rPr', [], [...marks, ...otherProperties]);
  const pPrRest = properties
    ? childrenOf(properties).filter((child) => !isWmlNamed(child, 'rPr'))
    : [];
  // `CT_PPr` puts `w:rPr` AFTER the base properties — only `w:sectPr` and `w:pPrChange` may
  // follow it — so an existing `w:jc` stays in front. Placing `w:rPr` first looked tidier and
  // produced a `w:pPr` the tree invariants reject, which is the invariant reading the schema
  // correctly. A FRESH id, because the rebuilt container is a new node.
  const trailing = pPrRest.filter(isTrailingParagraphProperty);
  const leading = pPrRest.filter((child) => !isTrailingParagraphProperty(child));
  const pPr = build(mint(), 'paragraphProperties', 'pPr', properties ? properties.attributes : [], [
    ...leading,
    rPr,
    ...trailing,
  ]);

  return fromEdit(replaceChildren(part, paragraph.id, [pPr, ...rest], options), effect);
}

/**
 * Propose merging `paragraph` into the paragraph before it.
 *
 * The mark that would go is its PREDECESSOR's, and only the tree knows which paragraph that
 * is: addressing the merge by the first paragraph made a multi-paragraph delete stamp one
 * paragraph N times and leave the rest untouched, so accepting produced an empty paragraph
 * for every one selected.
 */
export function applyProposeParagraphMerge(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  revision: RevisionAttributionInput,
  options?: { readonly deferValidation?: boolean }
): TreeOpResult {
  const parent = parentOf(part, paragraph.id);
  if (!parent) return { ok: false, reason: 'tree-invariant' };
  const siblings = parent.children;
  const at = siblings.findIndex((child) => child.id === paragraph.id);
  const previous = at > 0 ? siblings[at - 1] : undefined;
  // A paragraph with nothing before it IN THE SAME CONTAINER has no mark to propose away.
  // Marking across a container boundary wrote a `w:del` on the last paragraph of a `w:tc` —
  // markup Word repairs, and which Accept then silently dropped, because there is no
  // following paragraph to merge into.
  if (!previous || previous.kind !== 'paragraph') {
    return { ok: false, reason: 'not-adjacent-siblings' };
  }
  return applyParagraphMarkRevision(part, previous, 'del', revision, options);
}

/**
 * Whether this paragraph's mark is an insertion THIS author proposed.
 *
 * Proposing to delete a mark you proposed adding is just taking the proposal back, so the
 * caller performs a real join instead of writing a `w:del`. Re-labelling it left a paragraph
 * break that Reject then made permanent — the opposite of what the user asked for. The
 * module states this rule for text; the mark path did not have it.
 */
export function retractsOwnParagraphMark(paragraph: OoxmlParagraphNode, author: string): boolean {
  const own = paragraphMarkRevisionOf(paragraph, 'ins');
  return own !== undefined && own.author === author;
}

/** The revision of one KIND on a paragraph's own mark, or undefined. */
function paragraphMarkRevisionOf(
  paragraph: OoxmlParagraphNode,
  kind: 'ins' | 'del'
): { readonly localName: string; readonly author: string } | undefined {
  const properties = childrenOf(paragraph).find((child) => child.kind === 'paragraphProperties');
  const rPr = properties
    ? childrenOf(properties).find((child) => isWmlNamed(child, 'rPr'))
    : undefined;
  const mark = rPr ? childrenOf(rPr).find((child) => isMarkRevisionOfKind(child, kind)) : undefined;
  if (!mark || mark.kind === 'textValue') return undefined;
  const author = mark.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'author'
  );
  return { localName: mark.localName, author: author?.value ?? '' };
}

/** The only two `CT_PPr` children that may follow `w:rPr`. */
function isTrailingParagraphProperty(node: OoxmlNode): boolean {
  return isWmlNamed(node, 'sectPr') || isWmlNamed(node, 'pPrChange');
}

function isMarkRevisionOfKind(node: OoxmlNode, kind: 'ins' | 'del'): boolean {
  return node.kind !== 'textValue' && isWmlNamed(node, kind);
}

function isMarkRevision(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    (node.localName === 'ins' || node.localName === 'del')
  );
}

function isWmlNamed(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

/**
 * The id of a same-kind, same-author, same-moment paragraph mark on a NEIGHBOURING paragraph.
 *
 * A run of Enters, or a run of Backspaces at a paragraph start, is one editing gesture — Word
 * groups it under one revision and offers one Accept. Without this each press minted its own,
 * and the pane filled with a card per keystroke.
 */
function adjacentParagraphMarkId(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  kind: 'ins' | 'del',
  revision: RevisionAttributionInput
): string | null {
  const parent = parentOf(part, paragraph.id);
  if (!parent) return null;
  const siblings = parent.children;
  const at = siblings.findIndex((child) => child.id === paragraph.id);
  for (const neighbour of [siblings[at - 1], siblings[at + 1]]) {
    if (!neighbour || neighbour.kind !== 'paragraph') continue;
    const properties = childrenOf(neighbour).find((child) => child.kind === 'paragraphProperties');
    const rPr = properties
      ? childrenOf(properties).find((child) => isWmlNamed(child, 'rPr'))
      : undefined;
    const mark = rPr ? childrenOf(rPr).find(isMarkRevision) : undefined;
    if (!mark || mark.kind === 'textValue' || mark.localName !== kind) continue;
    const read = (localName: string): string | undefined =>
      mark.attributes.find(
        (attribute) =>
          attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName
      )?.value;
    if (read('author') !== revision.author) continue;
    if (!sameEditingMoment(read('date'), revision.date)) continue;
    const id = read('id');
    if (id !== undefined) return id;
  }
  return null;
}
