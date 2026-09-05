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

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  isContentRevisionKind,
  isInlineRunContainer,
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
} from '../package/ooxml-shared.ts';
import { isInlineContainerProperty } from '../package/inline-container-properties.ts';
import { createNodeIdAllocator, replaceChildren } from '../package/ooxml-edit.ts';
import { equivalentNodes } from './ooxml-node-equality.ts';
import { nextRevisionId } from './tree-op-revision-ids.ts';
import { TEXT_DEPS, fromEdit } from './tree-op-nodes.ts';
import {
  insertionDestination,
  paragraphOffsetIndex,
  trailingInsertionDestination,
  type ParagraphOffsetIndex,
} from './tree-op-segments.ts';
import { insertionAuthor, insideDeletion } from './tree-op-retraction.ts';
import { sameEditingMoment } from './tree-op-tracked-time.ts';
import type { RevisionAttributionInput, TreeOpEffect, TreeOpResult } from './tree-op-validate.ts';
import { build, revisionAttributes } from './tree-op-tracked-builders.ts';

export { sameEditingMoment } from './tree-op-tracked-time.ts';
export { build, revisionAttributes } from './tree-op-tracked-builders.ts';

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

/** A `w:r` over its children — the ONE spelling of the run shape this module writes. */
function runOf(mint: () => string, children: readonly OoxmlNode[]): OoxmlNode {
  return build(mint(), 'run', 'r', [], children);
}

function isRunProperties(node: OoxmlNode): boolean {
  return node.kind !== 'textValue' && node.kind === 'runProperties';
}

/**
 * The face a NEW run takes from the run it is being inserted into — never that run's pending
 * FORMAT RECORD.
 *
 * A split copies the record into both halves, correctly: the same characters are still under
 * the same proposal. A run being inserted is different. Its characters were never in the state
 * the record describes, so inheriting it put them under somebody's pending decision — reject
 * the format card and the words just typed came back in a colour nobody had ever given them,
 * while their own insertion card was still unanswered. The mirror of `insideOwnInsertion`,
 * which refuses to WRITE a record in the same position.
 */
function insertedRunProperties(mint: () => string, run: OoxmlNode): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  for (const child of childrenOf(run)) {
    if (!isRunProperties(child)) continue;
    const kept = childrenOf(child).filter((entry) => !isWmlNamed(entry, 'rPrChange'));
    // A container holding nothing but the record is not a face to inherit.
    if (kept.length === 0) continue;
    out.push(copy(mint, { ...child, children: kept } as OoxmlNode));
  }
  return out;
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

/** How many deletion wrappers with this `@w:id` live under the node, itself included. */
function deletionWrappersWithId(node: OoxmlNode, id: string): number {
  if (node.kind === 'textValue') return 0;
  let count = deletionId(node) === id ? 1 : 0;
  for (const child of node.children) count += deletionWrappersWithId(child, id);
  return count;
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
 * What a tracked insertion places: run text, run-level elements, or one complete run.
 *
 * `length` is the payload's size in MODEL units, on `segmentsOf`'s terms — `text.length`
 * for characters, one for a tab or a break — so the extend-own-insertion path can step the
 * cursor past what it just placed without re-measuring the rebuilt run.
 */
interface TrackedInsertionPayload {
  readonly length: number;
  /**
   * Run CHILDREN — text, a tab, a field's nodes — that inherit the host run's `w:rPr`:
   * placed in one run under the wrapper, or spliced into the author's own run when
   * extending. Null for a payload that is a complete run of its own.
   */
  readonly nodes: ((mint: () => string) => readonly OoxmlNode[]) | null;
  /**
   * A complete run carrying its OWN `w:rPr` — a note citation, whose reference style must
   * not be replaced by the formatting at the caret. Placed as a sibling run: alone under
   * the wrapper, or beside the split halves when extending the author's own `w:ins`.
   */
  readonly run?: (mint: () => string) => OoxmlNode;
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
  options?: { readonly deferValidation?: boolean },
  bias: 'left' | 'right' = 'left'
): TreeOpResult {
  return applyTrackedInsertion(
    part,
    paragraph,
    offset,
    { length: text.length, nodes: (mint) => [textNode(mint, text, false)] },
    revision,
    options,
    bias
  );
}

/**
 * Insert ONE run-level element — a tab or a break — at `offset` as a tracked insertion.
 *
 * The element builder comes from the caller because the element vocabulary lives with the
 * untracked appliers; this module owns only the wrapper and the placement rules, which are
 * the same ones typed text follows. A tab or break inserted in suggesting mode used to pass
 * through unwrapped, so the file recorded an unattributed edit Accept/Reject could not act on.
 */
export function applyInsertTrackedElement(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  element: (mint: () => string) => OoxmlNode,
  revision: RevisionAttributionInput,
  options?: { readonly deferValidation?: boolean }
): TreeOpResult {
  return applyInsertTrackedElements(
    part,
    paragraph,
    offset,
    (mint) => [element(mint)],
    1,
    revision,
    options
  );
}

/**
 * Insert a MULTI-NODE run payload — a complete complex field — as ONE tracked insertion.
 *
 * The nodes share one run inside one `w:ins`, exactly the grouping the untracked
 * `insertPageField` writes, so the whole atom is one proposal: rejecting it takes the
 * `begin`, instruction, separator and `end` back together, never leaving a field no reader
 * can resolve. `length` is the payload's size in MODEL units on `segmentsOf`'s terms — one
 * per field atom plus any literal text between them.
 */
export function applyInsertTrackedElements(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  elements: (mint: () => string) => readonly OoxmlNode[],
  length: number,
  revision: RevisionAttributionInput,
  options?: { readonly deferValidation?: boolean }
): TreeOpResult {
  return applyTrackedInsertion(
    part,
    paragraph,
    offset,
    { length, nodes: elements },
    revision,
    options
  );
}

/**
 * Insert one COMPLETE run — a note citation — at `offset` as a tracked insertion.
 *
 * The run arrives with its own `w:rPr` (the reference style) and keeps it: it is placed as
 * a sibling run under the wrapper, never spliced into a run whose formatting would restyle
 * it. Everything else — adjacent-deletion adoption, extending the author's own `w:ins`,
 * relocation past struck words — is the same placement typed text follows, which is what
 * lets a citation inserted over a selection resolve as ONE reviewable replacement.
 */
export function applyInsertTrackedRun(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  run: (mint: () => string) => OoxmlNode,
  revision: RevisionAttributionInput,
  options?: { readonly deferValidation?: boolean }
): TreeOpResult {
  return applyTrackedInsertion(
    part,
    paragraph,
    offset,
    { length: 1, nodes: null, run },
    revision,
    options
  );
}

function applyTrackedInsertion(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  payload: TrackedInsertionPayload,
  revision: RevisionAttributionInput,
  options?: { readonly deferValidation?: boolean },
  bias: 'left' | 'right' = 'left'
): TreeOpResult {
  const mint = createNodeIdAllocator(part);
  const offsets = paragraphOffsetIndex(paragraph);
  const trailingDestination = trailingInsertionDestination(paragraph, offset);
  const rightBiasedDestination =
    bias === 'right' ? insertionDestination(paragraph, offset, null, bias) : null;
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
  // Minted LAZILY: `nextRevisionId` walks the whole part, and an insertion that adopts the
  // adjacent deletion's id — every replace-typing keystroke — would pay that walk for nothing.
  const insertionId = replaced?.id ?? nextRevisionId(part)();

  // Counted lazily and ONCE: the paragraph-wide count only matters when a container holds
  // part of the adopted deletion, and it cannot change during the rebuild.
  let replacedWrapperTotal: number | null = null;
  const wrappersWithReplacedId = (): number => {
    if (replaced === null) return 0;
    replacedWrapperTotal ??= paragraph.children.reduce(
      (count, child) => count + deletionWrappersWithId(child, replaced.id),
      0
    );
    return replacedWrapperTotal;
  };

  const wrap = (properties: readonly OoxmlNode[]): OoxmlNode =>
    build(
      mint(),
      'revisionInsert',
      'ins',
      revisionAttributes(insertionId, attribution),
      payload.nodes ? [runOf(mint, [...properties, ...payload.nodes(mint)])] : [payload.run!(mint)]
    );

  const rebuild = (
    nodes: readonly OoxmlNode[],
    stack: readonly OoxmlNode[],
    containerDepth = 0
  ): OoxmlNode[] => {
    if (containerDepth >= MAX_INLINE_CONTAINER_DEPTH) return nodes.slice();
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
      // A content control's property containers are the same shape: `CT_SdtRun` requires
      // `w:sdtPr`/`w:sdtEndPr` ahead of `w:sdtContent`, they measure nothing, and the
      // boundary rule below would otherwise put an insertion aimed at the control's first
      // character in FRONT of them.
      const parent = stack.at(-1);
      if (
        node.kind === 'contentControlProperties' ||
        node.kind === 'contentControlEndProperties' ||
        (parent !== undefined && isInlineContainerProperty(parent, node))
      ) {
        out.push(node);
        continue;
      }

      const length = offsets.lengthOf(node);
      const start = cursor.offset;
      const end = start + length;

      // Atom chrome measures zero at one offset. Let all of it pass before inserting, or the
      // new text lands inside the field and remains invisible.
      if (isAtomTailRun(node, atoms)) {
        out.push(node);
        continue;
      }

      // Descend inside a container. At a boundary, only an existing or shared container keeps it.
      // Never descend into a deletion: it requires `w:delText`, and accepting it would also
      // take the new insertion.
      const container =
        node.kind !== 'textValue' &&
        ((isInlineRunContainer(node) &&
          node.kind !== 'revisionDelete' &&
          node.kind !== 'revisionMoveFrom') ||
          node.kind === 'contentControl' ||
          node.kind === 'contentControlContent');
      // Same MOMENT as well as the same author — the deletion path already gates on this.
      // Typing at the end of your own month-old insertion backdated today's edit into that
      // revision, and rejecting one then rejected both.
      const ownInsertion =
        container &&
        insertionAuthor([node]) === revision.author &&
        sameEditingMoment(revisionDateOf(node), revision.date);
      const sharedTrailingOwner = trailingDestination?.path.has(node.id) === true;
      const rightBiasedOwner = rightBiasedDestination?.path.has(node.id) === true;
      // THE REPLACEMENT FOLLOWS THE DELETION IT REPLACES — into a link or a control, and
      // only when the WHOLE deletion lives there. Replacing a link's display text strikes
      // runs INSIDE the `w:hyperlink`, and the insertion adopting that deletion aims at
      // the link's boundary: placed beside the link, accepting the pair emptied the link,
      // the sweep removed it, and the accepted text came out silently unlinked. Two rules
      // narrow it:
      //   - a revision wrapper is NOT followed into: the same deletion can sit inside
      //     another author's `w:ins`, and appending there would put this author's words
      //     inside their proposal, where rejecting theirs deletes these;
      //   - a deletion that also has pieces OUTSIDE the container is not followed either —
      //     a replacement for "plain words plus the link's text" stands in for the whole
      //     range, most of which was never linked.
      // Checked lazily — the subtree scans run only for an in-bounds container while an
      // adopted deletion exists at all.
      const followable =
        container &&
        ((isInlineRunContainer(node) && !isContentRevisionKind(node.kind)) ||
          node.kind === 'contentControl' ||
          node.kind === 'contentControlContent');
      const wrappersInside =
        followable && replaced !== null && offset >= start && offset <= end
          ? deletionWrappersWithId(node, replaced.id)
          : 0;
      const holdsReplaced = wrappersInside > 0 && wrappersInside === wrappersWithReplacedId();
      if (
        container &&
        ((offset > start && offset < end) ||
          ((ownInsertion || holdsReplaced || sharedTrailingOwner || rightBiasedOwner) &&
            offset >= start &&
            offset <= end))
      ) {
        const rebuilt = rebuild(
          node.children,
          [...stack, node],
          nextInlineContainerDepth(node, containerDepth)
        );
        // The adopted deletion ends exactly where the container does, so the inner walk
        // comes back unplaced. The replacement still belongs beside the struck words,
        // INSIDE the container that holds them.
        if (
          !placed &&
          (holdsReplaced || (sharedTrailingOwner && node.id === trailingDestination?.holderId)) &&
          offset === cursor.offset
        ) {
          rebuilt.push(wrap([]));
          placed = true;
        }
        out.push({ ...node, children: rebuilt } as OoxmlNode);
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

      // A right bias names the container the caller wants the words in, and a run ENDING at
      // this offset is not it: taking the insertion here would leave the text outside the
      // requested wrapper, which validation had already resolved as the destination. Walk on
      // and let that container claim it.
      if (
        node.kind === 'run' &&
        offset === end &&
        offset !== start &&
        rightBiasedDestination !== null &&
        !rightBiasedDestination.path.has(node.id)
      ) {
        cursor.offset = end;
        out.push(node);
        continue;
      }

      if (node.kind === 'run' && offset >= start && offset <= end) {
        const own = insertionAuthor([...stack, node]);
        // Inside our OWN pending insertion: extend it. A second `w:ins` nested in the first
        // says two people proposed the same words, which is not what happened.
        if (own === revision.author) {
          out.push(...splitRunAndInsert(mint, offsets, node, offset - start, payload));
          placed = true;
          cursor.offset = end + payload.length;
          continue;
        }
        const properties = insertedRunProperties(mint, node);
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
    runOf(mint, [...properties.map((child) => copy(mint, child)), ...head]),
    runOf(mint, [...properties.map((child) => copy(mint, child)), ...tail]),
  ];
}

/** Put new content into an existing run at a local offset — the extend-my-own-insertion path. */
function splitRunAndInsert(
  mint: () => string,
  offsets: ParagraphOffsetIndex,
  run: OoxmlNode,
  local: number,
  payload: TrackedInsertionPayload
): OoxmlNode[] {
  const [head, tail] = splitRun(mint, offsets, run, local);
  if (payload.nodes) {
    const content = [
      ...childrenOf(head).filter((child) => !isRunProperties(child)),
      ...payload.nodes(mint),
      ...childrenOf(tail).filter((child) => !isRunProperties(child)),
    ];
    const properties = childrenOf(run)
      .filter(isRunProperties)
      .map((child) => copy(mint, child));
    return [runOf(mint, [...properties, ...coalesced(mint, content)])];
  }
  // A whole-run payload keeps its OWN `w:rPr`, so it goes between the halves as a sibling
  // run inside the same wrapper — spliced into the host run, the citation would take on
  // whatever formatting the caret sits in and lose its reference style.
  return [
    ...(contentOf(head).length > 0 ? [head] : []),
    payload.run!(mint),
    ...(contentOf(tail).length > 0 ? [tail] : []),
  ];
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
export function childrenOf(node: OoxmlNode): readonly OoxmlNode[] {
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

  const rebuild = (
    nodes: readonly OoxmlNode[],
    stack: readonly OoxmlNode[],
    containerDepth = 0
  ): OoxmlNode[] => {
    if (containerDepth >= MAX_INLINE_CONTAINER_DEPTH) return nodes.slice();
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
        (isInlineRunContainer(node) ||
          // A content control is a run container too (`w:sdtContent` takes `EG_PContent`,
          // `w:del` included). Passing it through whole made a suggested deletion over its
          // text a silent NO-OP: the transaction committed, nothing was struck, and the
          // reviewer's replacement landed beside words that were never proposed away.
          node.kind === 'contentControl' ||
          node.kind === 'contentControlContent')
      ) {
        const rebuilt = rebuild(
          node.children,
          [...stack, node],
          nextInlineContainerDepth(node, containerDepth)
        );
        // A wrapper emptied by the removal of our own insertion goes with it; one that
        // still holds content stays, because it is still saying something about that
        // content. A CONTROL is not a wrapper: it is document structure the user placed,
        // so it keeps its (possibly emptied) `w:sdtContent` — dropping it left a `w:sdt`
        // husk with properties and no content element, a shape Word never writes.
        const structural =
          node.kind === 'contentControl' ||
          node.kind === 'contentControlContent' ||
          (node.kind === 'generic' && isInlineRunContainer(node));
        if (rebuilt.length > 0 || structural) {
          out.push({ ...node, children: rebuilt } as OoxmlNode);
        }
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

/** Shared with `tree-op-tracked-marks.ts`, which writes the paragraph-mark wrappers. */
export function isWmlNamed(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}
