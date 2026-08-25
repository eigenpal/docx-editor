/**
 * The state each effect in one journal actually sees.
 *
 * A journal is one atomic write, and its effects compose: the store appends a scratch `w:t`,
 * splices a character into a neighbouring `w:t`, then removes the scratch. Validating every
 * effect against the state BEFORE the journal therefore refuses ordinary typing, because the
 * last effect deletes a child the fifth effect added. This projection replays only the
 * quantities the bound checks read — node existence, node class, text length, and child count —
 * so each effect is checked against the state it will run against.
 *
 * It holds no Yjs types and writes nothing. A refusal still leaves shared state untouched.
 */

import type {
  CanonicalNodeDescriptor,
  CanonicalPrimitiveEffect,
} from '@docx-editor.dev/core/collaboration';
import { isTextRecord } from './schema.ts';
import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';

/** What one node looks like at one point in a journal. */
interface ProjectedNode {
  isText: boolean;
  textLength: number;
  children: LogicalId[];
}

export class JournalProjection {
  /** Only nodes a journal touches are projected; everything else is read on demand. */
  private readonly touched = new Map<string, ProjectedNode>();
  private readonly created = new Set<string>();

  constructor(private readonly registry: DocumentRegistry) {}

  has(id: string): boolean {
    return this.created.has(id) || this.touched.has(id) || this.registry.hasNode(id);
  }

  /** Null when the node does not exist, so callers can tell absence from an empty node. */
  node(id: string): ProjectedNode | null {
    const projected = this.touched.get(id);
    if (projected) return projected;
    const record = this.registry.record(id as LogicalId);
    if (!record) return null;
    const node: ProjectedNode = isTextRecord(record)
      ? { isText: true, textLength: record.value.length, children: [] }
      : { isText: false, textLength: 0, children: [...record.childIds] };
    this.touched.set(id, node);
    return node;
  }

  /** A `putNode` for a known id renames it in place, so class and content survive. */
  putNode(descriptor: CanonicalNodeDescriptor): void {
    const existing = this.node(descriptor.logicalId);
    if (existing) return;
    this.created.add(descriptor.logicalId);
    this.touched.set(descriptor.logicalId, {
      isText: descriptor.kind === 'textValue',
      textLength: 0,
      children: [],
    });
  }

  spliceText(id: string, deleteCount: number, insertLength: number): void {
    const node = this.node(id);
    if (!node) return;
    node.textLength = Math.max(0, node.textLength - deleteCount) + insertLength;
  }

  spliceChildren(
    parentId: string,
    start: number,
    deleteCount: number,
    childIds: readonly string[]
  ): void {
    const parent = this.node(parentId);
    if (!parent) return;
    parent.children.splice(start, deleteCount, ...(childIds as readonly LogicalId[]));
  }

  /** A move detaches from the current parent first, so neither count drifts. */
  moveNode(id: string, destinationParentId: string, destinationIndex: number): void {
    const currentParentId = this.parentOf(id);
    if (currentParentId !== null) {
      const currentParent = this.node(currentParentId);
      const index = currentParent?.children.indexOf(id as LogicalId) ?? -1;
      if (currentParent && index >= 0) currentParent.children.splice(index, 1);
    }
    const destination = this.node(destinationParentId);
    if (!destination) return;
    const at = Math.min(destinationIndex, destination.children.length);
    destination.children.splice(at, 0, id as LogicalId);
  }

  /** Projected parents win, because an earlier effect in this journal may have reparented. */
  private parentOf(id: string): string | null {
    for (const [parentId, node] of this.touched) {
      if (node.children.includes(id as LogicalId)) return parentId;
    }
    return this.registry.parentOf(id as LogicalId);
  }
}

/** Replay one effect's structural consequences onto the projection. */
export function projectEffect(
  projection: JournalProjection,
  effect: CanonicalPrimitiveEffect
): void {
  switch (effect.kind) {
    case 'putNode':
      projection.putNode(effect.descriptor);
      return;
    case 'spliceText':
      projection.spliceText(effect.logicalId, effect.deleteCount, effect.insert.length);
      return;
    case 'spliceChildren':
      projection.spliceChildren(
        effect.parentLogicalId,
        effect.start,
        effect.deleteCount,
        effect.childLogicalIds
      );
      return;
    case 'moveNode':
      projection.moveNode(
        effect.logicalId,
        effect.destinationParentLogicalId,
        effect.destinationIndex
      );
      return;
    default:
      return;
  }
}
