/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Canonical node id to replicated logical id.
 *
 * A canonical node id minted by an edit is a part-scoped counter: two replicas that started
 * from one baseline both mint `/word/document.xml#new:0` for the different paragraphs each of
 * them inserted. Keying shared state on that id merges the two into one node, which destroys
 * one author's content and shows the other's twice. Ids that came from the SHARED baseline
 * need no translation — every replica read them from the same bytes — so only nodes a journal
 * CREATES are minted into this replica's own space.
 */

import { LogicalIdAllocator, type LogicalId } from './document/index.ts';
import type {
  CanonicalNodeDescriptor,
  CanonicalPrimitiveEffect,
  CanonicalPrimitiveJournal,
} from '@docx-editor.dev/core/collaboration/replication';

export class LogicalIdentityMap {
  private readonly allocator: LogicalIdAllocator;
  private readonly toLogical = new Map<string, LogicalId>();

  /**
   * @param knows Reports whether shared state already holds one logical id. A `putNode` for a
   * known id renames that node in place, so it must keep the id it already has.
   */
  constructor(
    private readonly knows: (logicalId: string) => boolean,
    replicaId?: string
  ) {
    this.allocator = new LogicalIdAllocator(replicaId);
  }

  get replicaId(): string {
    return this.allocator.replicaId;
  }

  /**
   * Forget every local mapping.
   *
   * Called once a materialized package is installed, because every node in the canonical tree
   * then carries a logical id already and a later mint of the same canonical id names a
   * different node.
   */
  reset(): void {
    this.toLogical.clear();
  }

  /** A shared id for a node this replica just created. */
  mint(canonicalId: string): LogicalId {
    const logicalId = this.allocator.take();
    this.toLogical.set(canonicalId, logicalId);
    return logicalId;
  }

  /** Baseline and remote ids resolve to themselves; locally minted ones to their logical id. */
  resolve(canonicalId: string): string {
    return this.toLogical.get(canonicalId) ?? canonicalId;
  }

  /**
   * One journal in shared identity.
   *
   * `putNode` mints first so later effects in the same journal resolve to the new id, which
   * is why the pass is ordered and not a map over independent effects.
   */
  translate(journal: CanonicalPrimitiveJournal): CanonicalPrimitiveJournal {
    const effects: CanonicalPrimitiveEffect[] = [];
    let changed = false;
    for (const effect of journal.effects) {
      const translated = this.translateEffect(effect);
      if (translated !== effect) changed = true;
      effects.push(translated);
    }
    // Most journals name only baseline ids, which translate to themselves. This runs on the
    // keystroke path, and rebuilding an identical journal there buys nothing.
    if (!changed) return journal;
    return Object.freeze({ effects: Object.freeze(effects) });
  }

  /** Returns the effect itself when every id it names already stands in shared identity. */
  private translateEffect(effect: CanonicalPrimitiveEffect): CanonicalPrimitiveEffect {
    switch (effect.kind) {
      case 'putNode': {
        const descriptor = this.translateDescriptor(effect.descriptor);
        return descriptor.logicalId === effect.descriptor.logicalId
          ? effect
          : { ...effect, descriptor };
      }
      case 'spliceText':
      case 'setAttribute':
      case 'setNamespaceBinding': {
        const logicalId = this.resolve(effect.logicalId);
        return logicalId === effect.logicalId ? effect : { ...effect, logicalId };
      }
      case 'spliceChildren': {
        const parentLogicalId = this.resolve(effect.parentLogicalId);
        const childLogicalIds = effect.childLogicalIds.map((id) => this.resolve(id));
        const same =
          parentLogicalId === effect.parentLogicalId &&
          childLogicalIds.every((id, index) => id === effect.childLogicalIds[index]);
        return same ? effect : { ...effect, parentLogicalId, childLogicalIds };
      }
      case 'moveNode': {
        const logicalId = this.resolve(effect.logicalId);
        const destinationParentLogicalId = this.resolve(effect.destinationParentLogicalId);
        return logicalId === effect.logicalId &&
          destinationParentLogicalId === effect.destinationParentLogicalId
          ? effect
          : { ...effect, logicalId, destinationParentLogicalId };
      }
      case 'putXmlPart': {
        const rootLogicalId = this.resolve(effect.rootLogicalId);
        return rootLogicalId === effect.rootLogicalId ? effect : { ...effect, rootLogicalId };
      }
      default:
        return effect;
    }
  }

  private translateDescriptor(descriptor: CanonicalNodeDescriptor): CanonicalNodeDescriptor {
    const resolved = this.resolve(descriptor.logicalId);
    // An in-place rename, not a second node. Minting here would leave the original element
    // untouched in every replica and add an orphan beside it.
    if (this.knows(resolved)) return { ...descriptor, logicalId: resolved };
    return { ...descriptor, logicalId: this.mint(descriptor.logicalId) };
  }
}
