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

/**
 * The proposals of the splits of one paragraph, by the replica that wrote them, and the
 * container that lists them. Null when the paragraph holds no concurrent proposals.
 */
function proposals(
  registry: DocumentRegistry,
  paragraph: LogicalId
): { readonly container: LogicalId; readonly byReplica: Map<string, LogicalId> } | null {
  let container = paragraph;
  let level: Level = 'paragraphProperties';
  for (;;) {
    const copies = childrenAt(registry, container, level);
    if (copies.length >= 2) {
      const byReplica = new Map<string, LogicalId>();
      for (const id of copies) {
        const replica = replicaOfLogicalId(id);
        // Two copies from one replica are not concurrent splits: leave the conflict as is.
        if (replica === null) continue;
        if (byReplica.has(replica)) return null;
        byReplica.set(replica, id);
      }
      return byReplica.size >= 2 ? { container, byReplica } : null;
    }
    if (copies.length === 0 || level === 'ins') return null;
    container = copies[0]!;
    level = CHILD_LEVEL[level]!;
  }
}

/**
 * Where `node`, a proposal element, shows on `target`, a paragraph: as the paragraph's own
 * element at that level when it has none, or one level down inside the one it has.
 */
function placeOn(
  registry: DocumentRegistry,
  node: LogicalId,
  from: LogicalId,
  target: LogicalId,
  out: MarkMove[]
): void {
  let level = levelOf(registry, node);
  let parent = target;
  let moving = node;
  let movingFrom = from;
  while (level) {
    const own = childrenAt(registry, parent, level);
    if (own.length === 0) {
      out.push({ node: moving, from: movingFrom, to: parent, first: level !== 'runProperties' });
      return;
    }
    if (level === 'ins') return; // The paragraph already proposes its own mark.
    // Go one level down on both sides: the proposal's own child into the target's element.
    const next = CHILD_LEVEL[level]!;
    const inner = childrenAt(registry, moving, next);
    if (inner.length !== 1) return;
    movingFrom = moving;
    moving = inner[0]!;
    parent = own[0]!;
    level = next;
  }
}

/** The proposal moves one run of concurrent split siblings needs. */
export function markMovesOf(registry: DocumentRegistry, group: SiblingGroup): MarkMove[] {
  const found = proposals(registry, group.source);
  if (!found) return [];
  const moves: MarkMove[] = [];
  const heads = new Set(group.heads);
  let before = group.source;
  for (const id of group.shown) {
    if (heads.has(id) && id !== group.heads[0]) {
      const replica = replicaOfLogicalId(id);
      const proposal = replica ? found.byReplica.get(replica) : undefined;
      if (proposal) placeOn(registry, proposal, found.container, before, moves);
    }
    before = id;
  }
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
