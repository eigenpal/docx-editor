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
} from '@docx-editor.dev/core/collaboration';

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
    for (const effect of journal.effects) {
      effects.push(this.translateEffect(effect));
    }
    return Object.freeze({ effects: Object.freeze(effects) });
  }

  private translateEffect(effect: CanonicalPrimitiveEffect): CanonicalPrimitiveEffect {
    switch (effect.kind) {
      case 'putNode':
        return { ...effect, descriptor: this.translateDescriptor(effect.descriptor) };
      case 'spliceText':
      case 'setAttribute':
      case 'setNamespaceBinding':
        return { ...effect, logicalId: this.resolve(effect.logicalId) };
      case 'spliceChildren':
        return {
          ...effect,
          parentLogicalId: this.resolve(effect.parentLogicalId),
          childLogicalIds: effect.childLogicalIds.map((id) => this.resolve(id)),
        };
      case 'moveNode':
        return {
          ...effect,
          logicalId: this.resolve(effect.logicalId),
          destinationParentLogicalId: this.resolve(effect.destinationParentLogicalId),
        };
      case 'putXmlPart':
        return { ...effect, rootLogicalId: this.resolve(effect.rootLogicalId) };
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
