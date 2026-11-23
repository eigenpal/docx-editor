/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Properties another participant added stay when an undo takes back their container.
 *
 * A first formatting edit of a paragraph creates its `w:pPr`. When another participant then
 * formats the same paragraph, their property goes into that `w:pPr`. An undo of the first
 * edit unlists the `w:pPr`, and the other participant's property, still listed in it, shows
 * nowhere. So the undo keeps the listing of a property container the step listed while the
 * container, or a property container in it, lists a live child that the step did not write.
 * The step's own children still go.
 *
 * A paragraph an undo unlists can also show another participant's tracked break proposal:
 * a local edit lists the proposal of a concurrent split where it shows
 * (`split-mark-moves.ts`), which can be a paragraph that the undone step created. After the
 * undo, that proposal goes to the paragraph shown before the unlisted one, so the break
 * stays a pending change.
 *
 * The unlisted paragraph can also carry the step's copy of the split paragraph's earlier
 * proposal. The undo lists the original again on the split paragraph, but when a concurrent
 * split ends that paragraph at another point, the original shows nowhere, and the listing of
 * the split's marks can have dropped the other copy. When the paragraph shown before shows no
 * proposal after the undo, the original goes there.
 */
import * as Y from 'yjs';
import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';
import { childArrayOf, isNodeMap, NODE_CHILDREN_FIELD, readNodeShell } from './schema.ts';
import { MERGED_KINDS } from './singleton-children.ts';
import { markPropertiesEnd, SplitMarkMoves } from './split-mark-moves.ts';
import { splitSiblingOrder } from './split-sibling-order.ts';
import { deleteSetRuns, fieldOf, holderItem, structAt } from './yjs-items.ts';

type Step = { readonly insertions?: unknown } | undefined;
type Insertions = Parameters<typeof Y.isDeleted>[0] | undefined;

/** Property containers nest at most this deep in a mark (`w:pPr/w:rPr`). */
const MAX_DEPTH = 4;

/** The live children `container` lists, each with whether `step` wrote its entry. */
function* liveEntries(
  container: Y.Array<LogicalId>,
  step: Step
): Generator<{ id: LogicalId; own: boolean }> {
  const insertions = step?.insertions as Insertions;
  for (let item = container._start; item; item = item.right) {
    if (item.deleted) continue;
    const own = insertions !== undefined && Y.isDeleted(insertions, item.id);
    for (const id of item.content.getContent()) {
      if (typeof id === 'string') yield { id: id as LogicalId, own };
    }
  }
}

/**
 * Whether `container`, or a property container it lists, lists a live entry that `step` did
 * not write.
 */
function holdsOthers(
  nodes: Y.Map<Y.Map<unknown>>,
  container: Y.Array<LogicalId>,
  step: Step,
  depth = 0
): boolean {
  for (const { id, own } of liveEntries(container, step)) {
    if (!own) return true;
    const record = nodes.get(id);
    if (depth >= MAX_DEPTH || !isNodeMap(record)) continue;
    if (!MERGED_KINDS.has(readNodeShell(record).kind)) continue;
    const children = childArrayOf(record);
    if (children && holdsOthers(nodes, children, step, depth + 1)) return true;
  }
  return false;
}

/** The items of `step` that its undo keeps for other participants' properties, or null. */
export function undoKeepsProperties(
  doc: Y.Doc,
  nodes: Y.Map<Y.Map<unknown>>,
  step: unknown
): ((item: Y.Item) => boolean) | null {
  const kept = new Set<Y.Item>();
  for (const run of deleteSetRuns((step as Step)?.insertions)) {
    for (let clock = run.clock; clock < run.clock + run.length;) {
      const item = structAt(doc, { client: run.client, clock });
      if (!item) break;
      clock = item.id.clock + item.length;
      const array = item.parent;
      if (item.deleted || !(array instanceof Y.Array) || fieldOf(array) !== NODE_CHILDREN_FIELD) {
        continue;
      }
      const ids = item.content.getContent();
      const keeps = ids.every((id) => {
        const record = typeof id === 'string' ? nodes.get(id) : undefined;
        if (!isNodeMap(record) || !MERGED_KINDS.has(readNodeShell(record).kind)) return false;
        const children = childArrayOf(record);
        return children !== null && holdsOthers(nodes, children, step as Step);
      });
      if (ids.length > 0 && keeps && holderItem(array) !== null) kept.add(item);
    }
  }
  return kept.size === 0 ? null : (item) => kept.has(item);
}

/**
 * The items of `step` that its undo keeps so the mark of a paragraph it unlists can still go
 * where the paragraph's text joins: the listings of that paragraph's `w:pPr` and of every
 * element in it, when that mark holds a proposal. Or null.
 */
export function undoKeepsCarried(
  registry: DocumentRegistry,
  step: unknown
): ((item: Y.Item) => boolean) | null {
  const insertions = (step as Step)?.insertions as Insertions;
  if (insertions === undefined) return null;
  const kept = new Set<Y.Item>();
  const keepEntries = (container: LogicalId, only: LogicalId | null, depth: number): void => {
    const entries = childArrayOf(registry.schema.nodes.get(container));
    if (!entries) return;
    for (let item = entries._start; item; item = item.right) {
      if (item.deleted) continue;
      const ids = item.content.getContent().filter((id): id is LogicalId => typeof id === 'string');
      if (only !== null && !ids.includes(only)) continue;
      if (Y.isDeleted(insertions, item.id)) kept.add(item);
      if (depth >= MAX_DEPTH) continue;
      for (const id of only !== null ? [only] : ids) keepEntries(id, null, depth + 1);
    }
  };
  for (const { paragraph, last } of undonePlaces(registry, step)) {
    if (!last) continue;
    const mark = childAt(registry, paragraph, 'paragraphProperties');
    if (mark && holdsProposal(registry, mark, 'paragraphProperties'))
      keepEntries(paragraph, mark, 0);
  }
  return kept.size === 0 ? null : (item) => kept.has(item);
}

type Level = 'paragraphProperties' | 'runProperties' | 'ins';
const NEXT: Readonly<Record<Level, Level | null>> = {
  paragraphProperties: 'runProperties',
  runProperties: 'ins',
  ins: null,
};

interface UndonePlace {
  /** The paragraph the undo unlists. */
  readonly paragraph: LogicalId;
  /** The paragraph shown before it that the step did not list. */
  readonly target: LogicalId;
}

/** A proposal that a paragraph an undo unlists shows, and where it goes after the undo. */
export type UndoneProposal =
  | (UndonePlace & {
      readonly kind: 'foreign';
      /** The highest element of another participant's proposal that the step did not write. */
      readonly node: LogicalId;
      readonly level: Level;
      /** The element that lists it. */
      readonly from: LogicalId;
    })
  | (UndonePlace & {
      /** The step's copy of an earlier proposal, on the mark of the paragraph it listed. */
      readonly kind: 'carried';
      /** The mark elements the step unlisted: the original can be one of them. */
      readonly originals: readonly LogicalId[];
      /** The paragraph's `w:pPr`, which the undo keeps (`undoKeepsCarried`). */
      readonly mark: LogicalId;
    });

/** A relist an undo made, which the redo of that undo takes back. */
export interface RelistedProposal {
  readonly node: LogicalId;
  readonly from: LogicalId;
  readonly to: LogicalId;
  readonly paragraph: LogicalId;
}

function levelOf(registry: DocumentRegistry, id: LogicalId): Level | null {
  const kind = registry.kindOf(id);
  if (kind === 'paragraphProperties' || kind === 'runProperties') return kind;
  const shell = registry.schema.nodes.get(id);
  return isNodeMap(shell) && readNodeShell(shell).localName === 'ins' ? 'ins' : null;
}

function childIdsOf(registry: DocumentRegistry, parent: LogicalId): readonly LogicalId[] {
  const record = registry.record(parent);
  return record && 'childIds' in record ? record.childIds : [];
}

/** The first live child of `parent` at `level`. */
function childAt(registry: DocumentRegistry, parent: LogicalId, level: Level): LogicalId | null {
  return (
    childIdsOf(registry, parent).find(
      (id) => registry.showsAsChild(id) && levelOf(registry, id) === level
    ) ?? null
  );
}

/** Whether `id`, a mark element at `level`, is or holds a proposal (`w:rPr/w:ins`). */
function holdsProposal(registry: DocumentRegistry, id: LogicalId, level: Level): boolean {
  const next = NEXT[level];
  if (!next) return true;
  const child = childAt(registry, id, next);
  return child !== null && holdsProposal(registry, child, next);
}

/**
 * The proposals another participant listed in `paragraph`'s mark: the highest element of
 * each that the step did not write, below elements the step did write.
 */
function foreignProposals(
  registry: DocumentRegistry,
  container: LogicalId,
  level: Level,
  step: Step,
  found: { node: LogicalId; level: Level; from: LogicalId }[]
): void {
  const entries = childArrayOf(registry.schema.nodes.get(container));
  if (!entries) return;
  for (const { id, own } of liveEntries(entries, step)) {
    if (levelOf(registry, id) !== level) continue;
    if (!own) {
      if (holdsProposal(registry, id, level)) found.push({ node: id, level, from: container });
      continue;
    }
    const next = NEXT[level];
    if (next) foreignProposals(registry, id, next, step, found);
  }
}

/**
 * Before an undo of `step`: the proposals of other participants that paragraphs the step
 * listed show, and where each goes once the undo unlists its paragraph.
 */
export function undoneProposals(registry: DocumentRegistry, step: unknown): UndoneProposal[] {
  const originals = unlistedMarkElements(registry, step as Step);
  const out: UndoneProposal[] = [];
  for (const { paragraph, target, last } of undonePlaces(registry, step)) {
    const found: { node: LogicalId; level: Level; from: LogicalId }[] = [];
    foreignProposals(registry, paragraph, 'paragraphProperties', step as Step, found);
    for (const proposal of found) out.push({ ...proposal, kind: 'foreign', paragraph, target });
    const mark = childAt(registry, paragraph, 'paragraphProperties');
    if (last && mark && holdsProposal(registry, mark, 'paragraphProperties'))
      out.push({ kind: 'carried', originals, mark, paragraph, target });
  }
  return out;
}

/** A paragraph an undo unlists, and where its text joins. */
export interface UndonePlaceOf {
  readonly paragraph: LogicalId;
  /** The paragraph shown before it that the step did not list. */
  readonly target: LogicalId;
  /**
   * Whether the entry listed after it is not a paragraph the step listed. A step lists its
   * new paragraphs together, and only the last ends where the text the step split ended, so
   * only its mark is the one the joined text keeps; the mark of one before it is the step's
   * own break. Listing order tells this also when concurrent splits show the paragraphs in
   * another order.
   */
  readonly last: boolean;
}

/**
 * Before an undo of `step`: each paragraph the step listed, with the paragraph shown before it
 * that the step did not list, where its text joins once the undo unlists it. A paragraph
 * shown first has no such place.
 */
export function undonePlaces(registry: DocumentRegistry, step: unknown): UndonePlaceOf[] {
  const nodes = registry.schema.nodes;
  const listed = new Map<LogicalId, Set<LogicalId>>();
  for (const run of deleteSetRuns((step as Step)?.insertions)) {
    for (let clock = run.clock; clock < run.clock + run.length;) {
      const item = structAt(registry.doc, { client: run.client, clock });
      if (!item) break;
      clock = item.id.clock + item.length;
      const array = item.parent;
      if (item.deleted || !(array instanceof Y.Array) || fieldOf(array) !== NODE_CHILDREN_FIELD) {
        continue;
      }
      const holder = holderItem(holderItem(array)?.parent);
      const parent = holder?.parentSub;
      if ((holder?.parent as unknown) !== nodes || typeof parent !== 'string') continue;
      for (const id of item.content.getContent()) {
        if (typeof id !== 'string' || !registry.inline.textOf(id as LogicalId)) continue;
        const ids = listed.get(parent as LogicalId) ?? new Set<LogicalId>();
        ids.add(id as LogicalId);
        listed.set(parent as LogicalId, ids);
      }
    }
  }
  const out: UndonePlaceOf[] = [];
  for (const [parent, ids] of listed) {
    const children = childIdsOf(registry, parent);
    const order = splitSiblingOrder(children, registry.splitSiblings.ranksOf(parent));
    const shown = (order ? order.map((index) => children[index]!) : children).filter(
      (id) => ids.has(id) || (registry.showsAsChild(id) && !!registry.inline.textOf(id))
    );
    let target: LogicalId | null = null;
    for (const id of shown) {
      if (!ids.has(id)) target = id;
      else if (target) {
        const next = children[children.indexOf(id) + 1];
        out.push({ paragraph: id, target, last: next === undefined || !ids.has(next) });
      }
    }
  }
  return out;
}

/** The mark elements (`w:pPr`, `w:rPr`, `w:ins`) whose listing `step` deleted. */
function unlistedMarkElements(registry: DocumentRegistry, step: Step): LogicalId[] {
  const found = new Set<LogicalId>();
  const deletions = (step as { readonly deletions?: unknown } | undefined)?.deletions;
  for (const run of deleteSetRuns(deletions)) {
    for (let clock = run.clock; clock < run.clock + run.length;) {
      const item = structAt(registry.doc, { client: run.client, clock });
      if (!item) break;
      clock = item.id.clock + item.length;
      const array = item.parent;
      if (!(array instanceof Y.Array) || fieldOf(array) !== NODE_CHILDREN_FIELD) continue;
      for (const id of item.content.getContent()) {
        if (typeof id === 'string' && levelOf(registry, id as LogicalId))
          found.add(id as LogicalId);
      }
    }
  }
  return [...found];
}

/** Move `node` from `from`'s children into `to`'s children. */
function relist(
  registry: DocumentRegistry,
  node: LogicalId,
  from: LogicalId,
  to: LogicalId
): boolean {
  const source = childArrayOf(registry.schema.nodes.get(from));
  const target = childArrayOf(registry.schema.nodes.get(to));
  if (!source || !target) return false;
  const at = source.toArray().indexOf(node);
  if (at < 0) return false;
  source.delete(at, 1);
  const children = target.toArray();
  const end = registry.kindOf(node) === 'runProperties' ? markPropertiesEnd(registry, children) : 0;
  target.insert(end, [node]);
  return true;
}

/** The children of a paragraph mark element as they show, after the moves of split marks. */
function shownChildAt(
  registry: DocumentRegistry,
  moves: SplitMarkMoves,
  parent: LogicalId,
  level: Level
): LogicalId | null {
  return (
    moves
      .shownChildIds(parent, childIdsOf(registry, parent))
      .find((id) => registry.showsAsChild(id) && levelOf(registry, id) === level) ?? null
  );
}

/** Whether `paragraph` shows a proposal of its mark. */
function showsProposal(
  registry: DocumentRegistry,
  moves: SplitMarkMoves,
  paragraph: LogicalId
): boolean {
  let parent: LogicalId | null = paragraph;
  for (const level of ['paragraphProperties', 'runProperties', 'ins'] as const) {
    parent = shownChildAt(registry, moves, parent, level);
    if (!parent) return false;
  }
  return true;
}

/**
 * Relist the proposal `node` at `level`, listed in `from`, on `target`: at the first level
 * where the target's mark shows no element of its own. A target that shows its own `w:ins`
 * keeps it.
 */
function placeOnTarget(
  registry: DocumentRegistry,
  moves: SplitMarkMoves,
  proposal: { node: LogicalId; level: Level; from: LogicalId },
  target: LogicalId,
  paragraph: LogicalId,
  done: RelistedProposal[]
): void {
  let { node, level, from } = proposal;
  // The target's element that holds elements at the proposal's level.
  let container: LogicalId | null = target;
  if (level !== 'paragraphProperties') {
    container = shownChildAt(registry, moves, target, 'paragraphProperties');
    if (container && level === 'ins')
      container = shownChildAt(registry, moves, container, 'runProperties');
  }
  while (container) {
    const own = shownChildAt(registry, moves, container, level);
    if (!own) {
      if (relist(registry, node, from, container))
        done.push({ node, from, to: container, paragraph });
      return;
    }
    const next = NEXT[level];
    const inner = next ? childAt(registry, node, next) : null;
    if (!next || !inner) return;
    from = node;
    node = inner;
    container = own;
    level = next;
  }
}

/**
 * After the undo: each proposal whose paragraph the undo unlisted goes to its target, where
 * the target's mark shows. A carried proposal goes there only when the target shows no
 * proposal, from its original that the undo listed again and that shows nowhere.
 */
export function relistUndoneProposals(
  registry: DocumentRegistry,
  proposals: readonly UndoneProposal[]
): RelistedProposal[] {
  const done: RelistedProposal[] = [];
  if (proposals.length === 0) return done;
  // A fresh reading of the split marks' moves: the shared one stays the view's to refresh.
  const moves = new SplitMarkMoves(registry);
  moves.refresh(registry, registry.splitSiblings.parentsWithRuns());
  for (const proposal of proposals) {
    const { paragraph, target } = proposal;
    if (registry.parentOf(paragraph) !== null || registry.parentOf(target) === null) continue;
    if (proposal.kind === 'foreign') {
      placeOnTarget(registry, moves, proposal, target, paragraph, done);
      continue;
    }
    if (showsProposal(registry, moves, target)) continue;
    const original = proposal.originals.find((node) => {
      const from = registry.parentOf(node);
      const level = levelOf(registry, node);
      if (!from || !level || !holdsProposal(registry, node, level)) return false;
      // An original that shows already keeps its place.
      const shown = moves.shownChildIds(from, childIdsOf(registry, from)).includes(node);
      return !shown || !registry.showsAsChild(node);
    });
    // Without an original the undo listed again, the copy the undo kept goes there.
    const node = original ?? proposal.mark;
    const from = registry.parentOf(node);
    const level = levelOf(registry, node);
    if (!from || !level || !holdsProposal(registry, node, level)) continue;
    placeOnTarget(registry, moves, { node, level, from }, target, paragraph, done);
  }
  return done;
}

/** On a redo of the undo that made `relisted`: each proposal goes back where it was. */
export function restoreRelisted(
  registry: DocumentRegistry,
  relisted: readonly RelistedProposal[]
): void {
  for (const { node, from, to, paragraph } of [...relisted].reverse()) {
    if (registry.parentOf(paragraph) === null) continue;
    relist(registry, node, to, from);
  }
}

/** The attributes of a mark element, which a copy of it carries alike. */
function signatureOf(registry: DocumentRegistry, id: LogicalId): string | null {
  const record = registry.record(id);
  if (!record || !('attributes' in record)) return null;
  return record.attributes
    .map((attribute) => `${attribute.namespaceUri} ${attribute.localName}=${attribute.value}`)
    .sort()
    .join('\n');
}

/** The `w:ins` of the proposal `paragraph`'s mark shows, or null. */
function shownProposal(
  registry: DocumentRegistry,
  moves: SplitMarkMoves,
  paragraph: LogicalId
): LogicalId | null {
  let parent: LogicalId | null = paragraph;
  for (const level of ['paragraphProperties', 'runProperties', 'ins'] as const) {
    parent = parent && shownChildAt(registry, moves, parent, level);
  }
  return parent;
}

/** The paragraph whose mark lists `ins`, a mark's `w:ins`. */
function markParagraphOf(registry: DocumentRegistry, ins: LogicalId): LogicalId | null {
  const runProperties = registry.parentOf(ins);
  const paragraphProperties = runProperties && registry.parentOf(runProperties);
  return paragraphProperties && registry.parentOf(paragraphProperties);
}

/** Another participant's copy of a break proposal an undone split wrote. */
export interface ProposalCopy {
  readonly node: LogicalId;
  readonly from: LogicalId;
  /** The paragraph the undo unlists. */
  readonly paragraph: LogicalId;
  /** The paragraph whose mark shows the copy: the one shown before `paragraph`. */
  readonly target: LogicalId;
}

/**
 * Before an undo of `step`: the copies of the step's own break proposals that show where the
 * undo joins a paragraph's text. A split of the paragraph that shows a proposal copies its
 * mark, proposal and all, into its new paragraph. That copy then shows the break the undone
 * split proposed, so the undo takes it back too.
 */
export function proposalCopies(registry: DocumentRegistry, step: unknown): ProposalCopy[] {
  const places = undonePlaces(registry, step);
  if (places.length === 0) return [];
  // The step's new paragraphs carry copies of the split paragraph's mark, with any proposal
  // it showed: only a proposal on a paragraph the step did not list is the step's own. So is
  // one on a mark no paragraph lists any more, as a later split that replaced the mark leaves
  // it, after it copied the proposal into its new paragraph.
  const listed = new Set(places.map(({ paragraph }) => paragraph));
  const own = new Set<LogicalId>();
  const signatures = new Set<string>();
  const insertions = (step as Step)?.insertions;
  for (const run of deleteSetRuns(insertions)) {
    for (let clock = run.clock; clock < run.clock + run.length;) {
      const item = structAt(registry.doc, { client: run.client, clock });
      if (!item) break;
      clock = item.id.clock + item.length;
      const array = item.parent;
      if (item.deleted || !(array instanceof Y.Array) || fieldOf(array) !== NODE_CHILDREN_FIELD) {
        continue;
      }
      for (const id of item.content.getContent()) {
        if (typeof id !== 'string' || levelOf(registry, id as LogicalId) !== 'ins') continue;
        own.add(id as LogicalId);
        const paragraph = markParagraphOf(registry, id as LogicalId);
        if (paragraph !== null && listed.has(paragraph)) continue;
        const signature = signatureOf(registry, id as LogicalId);
        if (signature) signatures.add(signature);
      }
    }
  }
  if (signatures.size === 0) return [];
  const moves = new SplitMarkMoves(registry);
  moves.refresh(registry, registry.splitSiblings.parentsWithRuns());
  const out: ProposalCopy[] = [];
  for (const { paragraph, target } of places) {
    const node = shownProposal(registry, moves, target);
    const from = node && registry.parentOf(node);
    if (!node || !from || own.has(node)) continue;
    const signature = signatureOf(registry, node);
    if (signature && signatures.has(signature)) out.push({ node, from, paragraph, target });
  }
  return out;
}

/** After the undo: unlist each copy that still shows on its target. Returns those it unlisted. */
export function removeProposalCopies(
  registry: DocumentRegistry,
  copies: readonly ProposalCopy[]
): ProposalCopy[] {
  if (copies.length === 0) return [];
  const moves = new SplitMarkMoves(registry);
  moves.refresh(registry, registry.splitSiblings.parentsWithRuns());
  const removed: ProposalCopy[] = [];
  for (const copy of copies) {
    if (registry.parentOf(copy.paragraph) !== null) continue;
    if (shownProposal(registry, moves, copy.target) !== copy.node) continue;
    const children = childArrayOf(registry.schema.nodes.get(copy.from));
    const at = children ? children.toArray().indexOf(copy.node) : -1;
    if (!children || at < 0) continue;
    children.delete(at, 1);
    removed.push(copy);
  }
  return removed;
}

/** On a redo of the undo that removed `copies`: each copy is listed again. */
export function restoreProposalCopies(
  registry: DocumentRegistry,
  copies: readonly ProposalCopy[]
): void {
  for (const { node, from, paragraph } of copies) {
    if (registry.parentOf(paragraph) === null || registry.parentOf(node) !== null) continue;
    childArrayOf(registry.schema.nodes.get(from))?.insert(0, [node]);
  }
}

/** A break proposal in a mark an undo lists again, which no other mark shows any more. */
export interface StaleProposal {
  readonly node: LogicalId;
  /** The `w:rPr` that lists it. */
  readonly from: LogicalId;
  /** The `w:pPr` the undo lists again, and the paragraph that lists it. */
  readonly mark: LogicalId;
  readonly paragraph: LogicalId;
}

/** The first child of `parent` at `level`, listed or not, as an unlisted mark keeps them. */
const keptChildAt = (registry: DocumentRegistry, parent: LogicalId, level: Level) =>
  childIdsOf(registry, parent).find((id) => levelOf(registry, id) === level) ?? null;

/**
 * Before an undo of `step`: the proposals in paragraph marks the step replaced, which the undo
 * lists again, that no paragraph shows. A split replaces the split paragraph's mark and copies
 * its proposal into the new paragraph. When that proposal's author undoes the break later, or
 * a participant accepts or rejects it, no mark shows it, and the old mark must not show it
 * again once the undo brings that mark back.
 */
export function staleRestoredProposals(registry: DocumentRegistry, step: unknown): StaleProposal[] {
  // Only a split replaces a mark and copies its proposal: an undo of a rejection brings back
  // the proposals the rejection took away, which then show nowhere else.
  if (undonePlaces(registry, step).length === 0) return [];
  const found: StaleProposal[] = [];
  const deletions = (step as { readonly deletions?: unknown } | undefined)?.deletions;
  for (const run of deleteSetRuns(deletions)) {
    for (let clock = run.clock; clock < run.clock + run.length;) {
      const item = structAt(registry.doc, { client: run.client, clock });
      if (!item) break;
      clock = item.id.clock + item.length;
      const array = item.parent;
      if (!(array instanceof Y.Array) || fieldOf(array) !== NODE_CHILDREN_FIELD) continue;
      const paragraph = holderItem(holderItem(array)?.parent)?.parentSub;
      if (typeof paragraph !== 'string' || !registry.inline.textOf(paragraph as LogicalId))
        continue;
      for (const mark of item.content.getContent()) {
        if (
          typeof mark !== 'string' ||
          levelOf(registry, mark as LogicalId) !== 'paragraphProperties'
        )
          continue;
        const from = keptChildAt(registry, mark as LogicalId, 'runProperties');
        const node = from && keptChildAt(registry, from, 'ins');
        if (node)
          found.push({
            node,
            from: from!,
            mark: mark as LogicalId,
            paragraph: paragraph as LogicalId,
          });
      }
    }
  }
  if (found.length === 0) return [];
  const moves = new SplitMarkMoves(registry);
  moves.refresh(registry, registry.splitSiblings.parentsWithRuns());
  const shown = new Set<string>();
  for (const parent of new Set(found.map(({ paragraph }) => registry.parentOf(paragraph)))) {
    if (parent === null) continue;
    for (const id of childIdsOf(registry, parent)) {
      const proposal = registry.inline.textOf(id) ? shownProposal(registry, moves, id) : null;
      const signature = proposal && signatureOf(registry, proposal);
      if (signature) shown.add(signature);
    }
  }
  return found.filter(({ node }) => {
    const signature = signatureOf(registry, node);
    return signature !== null && !shown.has(signature);
  });
}

/** After the undo: unlist each stale proposal whose mark the undo listed again. */
export function removeStaleProposals(
  registry: DocumentRegistry,
  stale: readonly StaleProposal[]
): void {
  for (const { node, from, mark, paragraph } of stale) {
    if (registry.parentOf(mark) !== paragraph) continue;
    const children = childArrayOf(registry.schema.nodes.get(from));
    const at = children ? children.toArray().indexOf(node) : -1;
    if (children && at >= 0) children.delete(at, 1);
  }
}
