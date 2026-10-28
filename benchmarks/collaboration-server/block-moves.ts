// Block reorders for the scenario fuzzer: one transaction moves existing blocks to new places.
//
// The store has no reorder op of its own. A host reorders the blocks of one container with ONE
// child-list replacement inside a transaction, as a table drag does: the blocks keep their ids,
// so a peer's concurrent typing inside a moved block survives. That single replacement lowers to
// child splices that insert a kept id at its new place and remove it from its old one. Applying
// those splices in the wrong order drops a neighbour, and every replica agrees on the loss, so
// the fuzzer checks the author's result against a plain store as well as convergence.
//
// A move addresses its container by document position and its blocks by index among the
// container's blocks, so a replay binds it to whatever ids the replica holds.

import {
  findNode,
  replaceChildren,
  withPart,
  type OoxmlNode,
  type StoryScope,
  type TreeDocOp,
  type TreePackageStore,
} from '@docx-editor.dev/core/store';
import type { NodeAddressed } from './structure-edits.ts';
import { elements, parentOf } from './scenario-tree.ts';

const BODY: StoryScope = { kind: 'body' };

/** The pseudo-op name a reorder carries through the fuzzer's op plumbing. */
export const MOVE_BLOCKS = 'moveBlocks';

/** Containers whose children are blocks. */
const CONTAINERS = ['body', 'tc', 'sdtContent'] as const;

/** One move: the block at index `from` among the container's blocks goes to index `to`. */
export type BlockMove = readonly [from: number, to: number];

export interface MoveBlocksOp {
  readonly op: typeof MOVE_BLOCKS;
  readonly parentId: string;
  readonly moves: readonly BlockMove[];
}

export function isMoveBlocks(op: TreeDocOp | { readonly op: string }): op is MoveBlocksOp {
  return op.op === MOVE_BLOCKS;
}

const isBlock = (node: OoxmlNode): boolean =>
  node.kind !== 'textValue' &&
  (node.localName === 'p' || node.localName === 'tbl' || node.localName === 'sdt');

function blockCount(container: OoxmlNode): number {
  return container.kind === 'textValue' ? 0 : container.children.filter(isBlock).length;
}

/**
 * The distance a move travels: mostly one to three blocks either way, sometimes to the first
 * or the last place, so short moves up and down and the list ends all come up often.
 */
function moveOf(random: () => number, count: number): BlockMove {
  const from = Math.floor(random() * count);
  const roll = random();
  let to: number;
  if (roll < 0.15) to = 0;
  else if (roll < 0.3) to = count - 1;
  else {
    const distance = 1 + Math.floor(random() * 3);
    to = random() < 0.5 ? from - distance : from + distance;
  }
  return [from, Math.max(0, Math.min(count - 1, to))];
}

/**
 * Plan one reorder: a container with at least two blocks, and one or two moves in it. Most
 * reorders happen in the body, where tables and paragraphs sit side by side.
 */
export function planBlockMoves(root: OoxmlNode, random: () => number): NodeAddressed | null {
  const localName = random() < 0.75 ? 'body' : CONTAINERS[1 + Math.floor(random() * 2)]!;
  const candidates = elements(root, localName);
  const eligible = candidates
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => blockCount(node) >= 2);
  if (eligible.length === 0) return null;
  const { node, index } = eligible[Math.floor(random() * eligible.length)]!;
  const count = blockCount(node);
  const moves: BlockMove[] = [moveOf(random, count)];
  if (random() < 0.25) moves.push(moveOf(random, count));
  if (moves.every(([from, to]) => from === to)) return null;
  return {
    kind: 'node',
    op: { op: MOVE_BLOCKS, parentId: '', moves } as unknown as TreeDocOp,
    targets: [{ field: 'parentId', localName, index }],
  };
}

/**
 * Plan one `moveTable`, the table handle's drag: a table goes just before another paragraph or
 * table of its container. The op mints an empty paragraph on a side that would otherwise touch
 * another table, so it covers the inserts beside a moved block that a reorder does not make.
 */
export function planTableMove(root: OoxmlNode, random: () => number): NodeAddressed | null {
  const tables = elements(root, 'tbl');
  const movable = tables.filter((table) => {
    const parent = parentOf(root, table.id);
    return (
      parent !== null &&
      parent.kind !== 'textValue' &&
      (CONTAINERS as readonly string[]).includes(parent.localName) &&
      blockCount(parent) >= 2
    );
  });
  if (movable.length === 0) return null;
  const table = movable[Math.floor(random() * movable.length)]!;
  const parent = parentOf(root, table.id)!;
  const targets = parent.kind === 'textValue' ? [] : parent.children.filter(isTarget);
  const choices = targets.filter((block) => block.id !== table.id);
  if (choices.length === 0) return null;
  const before = choices[Math.floor(random() * choices.length)]!;
  if (before.kind === 'textValue') return null;
  return {
    kind: 'node',
    op: { op: 'moveTable', tableId: '', beforeBlockId: '' } as unknown as TreeDocOp,
    targets: [
      { field: 'tableId', localName: 'tbl', index: tables.indexOf(table) },
      {
        field: 'beforeBlockId',
        localName: before.localName,
        index: elements(root, before.localName).indexOf(before),
      },
    ],
  };
}

/** A block `moveTable` can put a table before: a paragraph or a table. */
const isTarget = (node: OoxmlNode): boolean =>
  node.kind !== 'textValue' && (node.localName === 'p' || node.localName === 'tbl');

/** The container's children after the moves, or null when a move names no block. */
export function movedChildren(
  children: readonly OoxmlNode[],
  moves: readonly BlockMove[]
): OoxmlNode[] | null {
  const next = [...children];
  for (const [from, to] of moves) {
    const blocks = next.flatMap((child, at) => (isBlock(child) ? [at] : []));
    const source = blocks[from];
    if (source === undefined || to < 0 || to >= blocks.length) return null;
    const [moved] = next.splice(source, 1);
    const remaining = next.flatMap((child, at) => (isBlock(child) ? [at] : []));
    // Before the block now at `to`, or after the last block when it moves to the end.
    const at = to < remaining.length ? remaining[to]! : remaining[remaining.length - 1]! + 1;
    next.splice(at, 0, moved!);
  }
  return next;
}

/** Apply a reorder as one child-list replacement in one body transaction. */
export function applyBlockMoves(
  store: TreePackageStore,
  op: MoveBlocksOp,
  actorId: string
): { readonly ok: boolean; readonly reason?: string } {
  let reason: string | undefined;
  const result = store.transact(
    BODY,
    (context) =>
      context.applyPackage((pkg) => {
        const part = pkg.parts.get(pkg.mainDocumentPart);
        const parent = part ? findNode(part, op.parentId) : null;
        if (!part || !parent || parent.kind === 'textValue') {
          reason = 'unknown-block';
          return pkg;
        }
        const children = movedChildren(parent.children, op.moves);
        if (!children) {
          reason = 'unknown-block';
          return pkg;
        }
        const edited = replaceChildren(part, parent.id, children);
        if (!edited.ok) {
          reason = edited.issues[0]?.code ?? 'refused';
          return pkg;
        }
        return withPart(pkg, edited.part);
      }),
    { actorId }
  );
  if (reason) return { ok: false, reason };
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}
