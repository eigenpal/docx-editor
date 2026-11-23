/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Where the paragraph marks of concurrent tracked splits show.
 *
 * A tracked split of a paragraph proposes the paragraph mark at the split point. The editor
 * writes that proposal on the split paragraph's own mark (`w:pPr/w:rPr/w:ins`), and the text
 * after the split point goes to a new paragraph listed after it. When two peers split one
 * paragraph at once, both write their proposal on that one mark: two `w:pPr`, two mark
 * `w:rPr`, or two `w:ins`, depending on what the paragraph had. The singleton rule shows one,
 * so the other split's paragraph mark showed no proposal, and rejecting every change left
 * that split in place.
 *
 * Each proposal belongs before its own split's new paragraph. The peer that split minted the
 * proposal's elements and its new paragraph, so both name that peer's replica. In the order
 * `split-sibling-order.ts` shows the run in, the proposal of the run's first paragraph stays
 * on the split paragraph, and every other proposal shows on the paragraph shown right before
 * its own new paragraph. The materializer shows it there, and the projection of a local edit
 * lists it there in shared state before the edit addresses either paragraph, as adoption and
 * merged property copies do. Only shared state every replica holds alike decides this.
 *
 * A new paragraph's mark starts as a copy of the split paragraph's mark, so when that mark
 * already proposed itself, each new paragraph carries a copy of that proposal. In its author's
 * view the new paragraph ended where the split paragraph ended, but in the run only the last
 * paragraph does. Every other one ends at another split's point, so that split's proposal
 * replaces the copy, and rejecting one author's breaks removes that author's breaks only.
 */
import type { LogicalId } from './identity.ts';
import { replicaOfLogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';
import { isElementRecord } from './schema.ts';
import { mayFollowMarkProperties, sharedChildShell } from './singleton-children.ts';
import type { SiblingGroup } from './split-sibling-order.ts';

/** One proposal element shown under another parent than the one that lists it. */
export interface MarkMove {
  readonly node: LogicalId;
  /** The parent that lists it. */
  readonly from: LogicalId;
  /**
   * The parent that shows it, or null when it shows nowhere: a stale copy of the split
   * paragraph's earlier proposal that another split's proposal replaces.
   */
  readonly to: LogicalId | null;
  /** Shown first among the parent's children, or last. */
  readonly first: boolean;
}

/** The levels of a paragraph mark that a split can write a proposal at. */
type Level = 'paragraphProperties' | 'runProperties' | 'ins';

function levelOf(registry: DocumentRegistry, id: LogicalId): Level | null {
  const shell = sharedChildShell(registry, id);
  if (!shell) return null;
  if (shell.kind === 'paragraphProperties' || shell.kind === 'runProperties') return shell.kind;
  return shell.kind === 'generic' && shell.localName === 'ins' ? 'ins' : null;
}

/** The level a container's proposals sit under, in a paragraph mark. */
const CHILD_LEVEL: Readonly<Record<string, Level>> = {
  paragraph: 'paragraphProperties',
  paragraphProperties: 'runProperties',
  runProperties: 'ins',
};

function childrenAt(registry: DocumentRegistry, parent: LogicalId, level: Level): LogicalId[] {
  const record = registry.record(parent);
  if (!record || !isElementRecord(record)) return [];
  return record.childIds.filter(
    (id) => registry.showsAsChild(id) && levelOf(registry, id) === level
  );
}

/** The children of `parent` that show, at `level`, leaving out those moving away. */
function shownAt(
  registry: DocumentRegistry,
  parent: LogicalId,
  level: Level,
  leaving: ReadonlySet<LogicalId>
): LogicalId[] {
  return childrenAt(registry, parent, level).filter((id) => !leaving.has(id));
}

function onlyChild(registry: DocumentRegistry, parent: LogicalId, child: LogicalId): boolean {
  const record = registry.record(parent);
  if (!record || !isElementRecord(record)) return false;
  const shown = record.childIds.filter((id) => registry.showsAsChild(id));
  return shown.length === 1 && shown[0] === child;
}

/** A proposal to move: its top element, the parent that lists it, and its level. */
interface Proposal {
  readonly node: LogicalId;
  readonly from: LogicalId;
  readonly level: Level;
}

/**
 * The mark proposal `replica` wrote on `paragraph`'s mark: its `w:ins`, raised to the highest
 * element `replica` minted that holds nothing else, so a container that only carries the
 * proposal moves with it and a container with other properties stays.
 */
function proposalOf(
  registry: DocumentRegistry,
  paragraph: LogicalId,
  replica: string
): Proposal | null {
  const chain: { node: LogicalId; from: LogicalId; level: Level }[] = [];
  let parent = paragraph;
  for (const level of ['paragraphProperties', 'runProperties', 'ins'] as const) {
    const copies = childrenAt(registry, parent, level);
    const own = copies.filter((id) => replicaOfLogicalId(id) === replica);
    const node = own.length === 1 ? own[0]! : copies.length === 1 ? copies[0]! : null;
    if (!node) return null;
    chain.push({ node, from: parent, level });
    parent = node;
  }
  const ins = chain[2]!;
  if (replicaOfLogicalId(ins.node) !== replica) return null;
  let top: Proposal = ins;
  for (let at = 1; at >= 0; at -= 1) {
    const holder = chain[at]!;
    if (replicaOfLogicalId(holder.node) !== replica) break;
    if (!onlyChild(registry, holder.node, chain[at + 1]!.node)) break;
    top = holder;
  }
  return top;
}

/** Whether `id`, a mark element at `level`, is or holds a proposal of the mark. */
function proposes(registry: DocumentRegistry, id: LogicalId, level: Level): boolean {
  if (level === 'ins') return true;
  const next = CHILD_LEVEL[level]!;
  return childrenAt(registry, id, next).some((child) => proposes(registry, child, next));
}

/**
 * Where a proposal shows on `target`, a paragraph: as the paragraph's own element at that
 * level when it has none (leaving out elements that move away), or one level down inside the
 * one it has. When `replaces` and the target's element at the proposal's level holds a
 * proposal, that element is a stale copy of the split paragraph's mark, and the proposal
 * shows in its place.
 */
function placeOn(
  registry: DocumentRegistry,
  proposal: Proposal,
  target: LogicalId,
  /** Whether a proposal `target` shows already is a stale copy that `proposal` replaces. */
  replaces: boolean,
  leaving: ReadonlySet<LogicalId>,
  out: MarkMove[]
): void {
  let { node: moving, from: movingFrom, level } = proposal;
  // The target's element at the level above the proposal.
  let parent: LogicalId | undefined = target;
  if (level !== 'paragraphProperties') {
    parent = shownAt(registry, target, 'paragraphProperties', leaving)[0];
    if (parent && level === 'ins') parent = shownAt(registry, parent, 'runProperties', leaving)[0];
  }
  while (parent) {
    const own = shownAt(registry, parent, level, leaving);
    if (own.length === 0 || (replaces && own.some((id) => proposes(registry, id, level)))) {
      for (const stale of own) out.push({ node: stale, from: parent, to: null, first: false });
      out.push({ node: moving, from: movingFrom, to: parent, first: level !== 'runProperties' });
      return;
    }
    if (level === 'ins') return; // The paragraph already proposes its own mark.
    const next = CHILD_LEVEL[level]!;
    const inner = childrenAt(registry, moving, next);
    if (inner.length !== 1) return;
    movingFrom = moving;
    moving = inner[0]!;
    parent = own[0]!;
    level = next;
  }
}

/**
 * The proposal moves one run of concurrent split siblings needs. Each paragraph of the run
 * was split off the paragraph its author listed right before it (`group.before`), and the
 * proposal for its split point sits on that paragraph's mark; it shows on the paragraph shown
 * right before it instead, when that is another one. When that one was split off the same
 * paragraph, it ends at this split point, so a proposal it shows already is a copy of that
 * paragraph's earlier one, which the moved proposal replaces.
 */
export function markMovesOf(registry: DocumentRegistry, group: SiblingGroup): MarkMove[] {
  const wanted: { proposal: Proposal; target: LogicalId; replaces: boolean }[] = [];
  let shownBefore = group.source;
  for (const id of group.shown) {
    const before = group.before.get(id);
    const replica = replicaOfLogicalId(id);
    if (before && replica && before !== shownBefore) {
      const proposal = proposalOf(registry, before, replica);
      // A sibling split off the same paragraph took a copy of that paragraph's mark. Both
      // went in right after it only when both head their blocks: a paragraph that follows a
      // removed head was split off that head, not off the paragraph the run follows.
      const replaces =
        group.before.get(shownBefore) === before &&
        group.heads.includes(shownBefore) &&
        group.heads.includes(id);
      if (proposal) wanted.push({ proposal, target: shownBefore, replaces });
    }
    shownBefore = id;
  }
  const leaving = new Set(wanted.map(({ proposal }) => proposal.node));
  const moves: MarkMove[] = [];
  for (const { proposal, target, replaces } of wanted)
    placeOn(registry, proposal, target, replaces, leaving, moves);
  return moves;
}

/**
 * The moves of every run of concurrent split siblings in a document, indexed by the parent
 * that lists each moved element and by the parent that shows it.
 */
export class SplitMarkMoves {
  private moves: readonly MarkMove[] = [];
  private key = '';
  private readonly hidden = new Map<LogicalId, Set<LogicalId>>();
  private readonly added = new Map<LogicalId, MarkMove[]>();

  constructor(private readonly registry: DocumentRegistry) {}

  /**
   * Read the moves again from the runs the registry knows, and return every node whose shown
   * children changed: the parents that list and show a move that appeared or went.
   */
  refresh(registry: DocumentRegistry, parents: Iterable<LogicalId>): LogicalId[] {
    // A run nested in another one can name the same move as the enclosing run. A proposal
    // shows in one place, so each node keeps one move: the last one, for a stable result.
    const byNode = new Map<LogicalId, MarkMove>();
    for (const parent of parents) {
      for (const group of registry.splitSiblings.groupsOf(parent))
        for (const move of markMovesOf(registry, group)) {
          byNode.delete(move.node);
          byNode.set(move.node, move);
        }
    }
    const next = [...byNode.values()];
    const key = next
      .map((move) => `${move.node}<${move.from}>${move.to}${move.first ? '^' : ''}`)
      .join(';');
    if (key === this.key) return [];
    const changed = new Set<LogicalId>();
    for (const move of [...this.moves, ...next]) {
      changed.add(move.from);
      if (move.to !== null) changed.add(move.to);
    }
    this.moves = next;
    this.key = key;
    this.hidden.clear();
    this.added.clear();
    for (const move of next) {
      let hidden = this.hidden.get(move.from);
      if (!hidden) this.hidden.set(move.from, (hidden = new Set()));
      hidden.add(move.node);
      if (move.to === null) continue;
      const added = this.added.get(move.to) ?? [];
      added.push(move);
      this.added.set(move.to, added);
    }
    return [...changed];
  }

  /** Whether `parent` lists `child` but shows it elsewhere. */
  movedOut(parent: LogicalId, child: LogicalId): boolean {
    return this.hidden.get(parent)?.has(child) ?? false;
  }

  /** `childIds` of `parent` as shown: moved-out children left out, moved-in ones added. */
  shownChildIds(parent: LogicalId, childIds: readonly LogicalId[]): LogicalId[] {
    const hidden = this.hidden.get(parent);
    const added = this.added.get(parent);
    if (!hidden && !added) return [...childIds];
    const kept = hidden ? childIds.filter((id) => !hidden.has(id)) : [...childIds];
    const first = (added ?? []).filter((move) => move.first && !kept.includes(move.node));
    const last = (added ?? []).filter((move) => !move.first && !kept.includes(move.node));
    const end = markPropertiesEnd(this.registry, kept);
    return [
      ...first.map((move) => move.node),
      ...kept.slice(0, end),
      ...last.map((move) => move.node),
      ...kept.slice(end),
    ];
  }

  /** The moves a local edit has to list in shared state before it addresses `parent`. */
  movesAt(parent: LogicalId): MarkMove[] {
    return this.moves.filter((move) => move.from === parent || move.to === parent);
  }
}

/**
 * Where a paragraph mark's `w:rPr` goes among `children` of a `w:pPr`: before the first
 * `w:sectPr` or `w:pPrChange`, which come after it in `CT_PPr`, or at the end.
 */
export function markPropertiesEnd(
  registry: DocumentRegistry,
  children: readonly LogicalId[]
): number {
  const at = children.findIndex((id) => {
    const shell = sharedChildShell(registry, id);
    return shell !== null && mayFollowMarkProperties(shell);
  });
  return at < 0 ? children.length : at;
}

const perRegistry = new WeakMap<DocumentRegistry, SplitMarkMoves>();

/** The one set of moves a registry's view and projection share. */
export function splitMarkMoves(registry: DocumentRegistry): SplitMarkMoves {
  let moves = perRegistry.get(registry);
  if (!moves) perRegistry.set(registry, (moves = new SplitMarkMoves(registry)));
  return moves;
}

/**
 * What changed in the runs of concurrent split siblings since the last build, added to a
 * view's dirty set: parents whose run shows in a new order because a sibling's text came after
 * its listing, and the nodes a proposal moved into or out of. True when anything changed.
 */
export function splitSiblingChanges(registry: DocumentRegistry, dirty: Set<LogicalId>): boolean {
  const reordered = registry.splitSiblings.takeChanged();
  if (reordered.length > 0) registry.inline.orderChanged();
  for (const parent of reordered) dirty.add(parent);
  const parents = new Set(registry.splitSiblings.parentsWithRuns());
  for (const id of dirty) {
    const parent = registry.parentOf(id);
    if (parent) parents.add(parent);
  }
  const changed = splitMarkMoves(registry).refresh(registry, parents);
  for (const id of changed) dirty.add(id);
  return reordered.length > 0 || changed.length > 0;
}
