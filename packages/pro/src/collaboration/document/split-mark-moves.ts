/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
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
 */
import type { LogicalId } from './identity.ts';
import { replicaOfLogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';
import { isElementRecord } from './schema.ts';
import { sharedChildShell } from './singleton-children.ts';
import type { SiblingGroup } from './split-sibling-order.ts';

/** One proposal element shown under another parent than the one that lists it. */
export interface MarkMove {
  readonly node: LogicalId;
  /** The parent that lists it. */
  readonly from: LogicalId;
  /** The parent that shows it. */
  readonly to: LogicalId;
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

/**
 * Where a proposal shows on `target`, a paragraph: as the paragraph's own element at that
 * level when it has none (leaving out elements that move away), or one level down inside the
 * one it has.
 */
function placeOn(
  registry: DocumentRegistry,
  proposal: Proposal,
  target: LogicalId,
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
    if (own.length === 0) {
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
 * right before it instead, when that is another one.
 */
export function markMovesOf(registry: DocumentRegistry, group: SiblingGroup): MarkMove[] {
  const wanted: { proposal: Proposal; target: LogicalId }[] = [];
  let shownBefore = group.source;
  for (const id of group.shown) {
    const before = group.before.get(id);
    const replica = replicaOfLogicalId(id);
    if (before && replica && before !== shownBefore) {
      const proposal = proposalOf(registry, before, replica);
      if (proposal) wanted.push({ proposal, target: shownBefore });
    }
    shownBefore = id;
  }
  const leaving = new Set(wanted.map(({ proposal }) => proposal.node));
  const moves: MarkMove[] = [];
  for (const { proposal, target } of wanted) placeOn(registry, proposal, target, leaving, moves);
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

  /**
   * Read the moves again from the runs the registry knows, and return every node whose shown
   * children changed: the parents that list and show a move that appeared or went.
   */
  refresh(registry: DocumentRegistry, parents: Iterable<LogicalId>): LogicalId[] {
    const next: MarkMove[] = [];
    for (const parent of parents) {
      for (const group of registry.splitSiblings.groupsOf(parent))
        next.push(...markMovesOf(registry, group));
    }
    const key = next.map((move) => `${move.node}>${move.to}`).join(';');
    if (key === this.key) return [];
    const changed = new Set<LogicalId>();
    for (const move of [...this.moves, ...next]) {
      changed.add(move.from);
      changed.add(move.to);
    }
    this.moves = next;
    this.key = key;
    this.hidden.clear();
    this.added.clear();
    for (const move of next) {
      let hidden = this.hidden.get(move.from);
      if (!hidden) this.hidden.set(move.from, (hidden = new Set()));
      hidden.add(move.node);
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
    return [...first.map((move) => move.node), ...kept, ...last.map((move) => move.node)];
  }

  /** The moves a local edit has to list in shared state before it addresses `parent`. */
  movesAt(parent: LogicalId): MarkMove[] {
    return this.moves.filter((move) => move.from === parent || move.to === parent);
  }
}

const perRegistry = new WeakMap<DocumentRegistry, SplitMarkMoves>();

/** The one set of moves a registry's view and projection share. */
export function splitMarkMoves(registry: DocumentRegistry): SplitMarkMoves {
  let moves = perRegistry.get(registry);
  if (!moves) perRegistry.set(registry, (moves = new SplitMarkMoves()));
  return moves;
}

/**
 * What changed in the runs of concurrent split siblings since the last build, added to a
 * view's dirty set: parents whose run shows in a new order because a sibling's text came after
 * its listing, and the nodes a proposal moved into or out of.
 */
export function splitSiblingChanges(registry: DocumentRegistry, dirty: Set<LogicalId>): void {
  const reordered = registry.splitSiblings.takeChanged();
  if (reordered.length > 0) registry.inline.orderChanged();
  for (const parent of reordered) dirty.add(parent);
  const parents = new Set(registry.splitSiblings.parentsWithRuns());
  for (const id of dirty) {
    const parent = registry.parentOf(id);
    if (parent) parents.add(parent);
  }
  for (const id of splitMarkMoves(registry).refresh(registry, parents)) dirty.add(id);
}
