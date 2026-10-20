/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The materializer's last build of each node, and what a later pass may assume about it.
 *
 * An incremental pass reuses a cached subtree when nothing under it changed. Two facts decide
 * how it may reuse one: the subtree's height, so a reuse under a deeper parent cannot carry
 * the tree past `maxTreeDepth`, and whether the build is complete, so a spine rebuild can
 * reuse the node's child list (see `materialize-spine.ts`).
 */
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { idOf, type LogicalId } from './identity.ts';

export class NodeCache {
  private readonly nodes = new Map<LogicalId, OoxmlNode>();
  /** Depth of each cached subtree, so reuse cannot smuggle a node past `maxTreeDepth`. */
  private readonly heights = new Map<LogicalId, number>();
  /** Elements whose last build showed every child it lists and reported no issue. */
  private readonly complete = new Set<LogicalId>();

  get(id: LogicalId): OoxmlNode | undefined {
    return this.nodes.get(id);
  }

  /** Whether `node` is the cached build of its ID. */
  holds(node: OoxmlNode): boolean {
    return this.nodes.get(idOf(node)) === node;
  }

  /** Cache a build. It is not complete until the child loop that made it says so. */
  remember(id: LogicalId, node: OoxmlNode): void {
    this.nodes.set(id, node);
    this.heights.delete(id);
    this.complete.delete(id);
  }

  /** Record whether the last build of `id` showed every child it lists, with no issue. */
  markComplete(id: LogicalId, complete: boolean): void {
    if (complete) this.complete.add(id);
    else this.complete.delete(id);
  }

  isComplete(id: LogicalId): boolean {
    return this.complete.has(id);
  }

  forget(id: LogicalId): void {
    this.nodes.delete(id);
    this.heights.delete(id);
    this.complete.delete(id);
  }

  /**
   * Forget a dead node and every node under it that this pass did not place. The descent stops
   * at a placed ID: a child that moved, or that a survivor adopted, is in the tree.
   */
  evictSubtree(
    id: LogicalId,
    placed: ReadonlySet<LogicalId>,
    onEvict: (id: LogicalId) => void
  ): void {
    const node = this.nodes.get(id);
    this.forget(id);
    onEvict(id);
    if (!node || node.kind === 'textValue') return;
    for (const child of node.children) {
      const childId = idOf(child);
      if (!placed.has(childId)) this.evictSubtree(childId, placed, onEvict);
    }
  }

  /**
   * Depth of one cached subtree, memoized.
   *
   * A rebuilt node forgets its height, and a node whose height moved is necessarily rebuilt
   * with a new identity, which rebuilds every ancestor. So a surviving entry is current.
   */
  heightOf(node: OoxmlNode): number {
    const known = this.heights.get(idOf(node));
    if (known !== undefined) return known;
    let height = 1;
    if (node.kind !== 'textValue') {
      for (const child of node.children) height = Math.max(height, this.heightOf(child) + 1);
    }
    this.heights.set(idOf(node), height);
    return height;
  }

  /** Set a height known without a walk, as a spine rebuild knows it. */
  setHeight(id: LogicalId, height: number): void {
    this.heights.set(id, height);
  }

  ids(): readonly LogicalId[] {
    return [...this.nodes.keys()];
  }
}
