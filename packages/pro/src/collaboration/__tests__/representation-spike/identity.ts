/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { LogicalId, NodeIdentityMeta } from './contract.ts';

const WORD_FACING_NAMES = new Set(['paraId', 'textId', 'id', 'numId', 'bookmarkId']);

/** Actor-scoped logical ids never collide after a concurrent merge. */
export function mintLogicalId(actorId: string, counter: number): LogicalId {
  return `lid:${actorId}:${counter}`;
}

export function yjsItemKey(client: number, clock: number): string {
  return `yjs:${client}:${clock}`;
}

export function wordFacingIdsOf(
  attributes: readonly { readonly localName: string; readonly value: string }[]
): string[] {
  const ids: string[] = [];
  for (const attribute of attributes) {
    if (WORD_FACING_NAMES.has(attribute.localName)) ids.push(attribute.value);
  }
  return ids;
}

export function assertIndependentIdentity(meta: NodeIdentityMeta): void {
  if (meta.yjsItemKey !== null && meta.logicalId === meta.yjsItemKey) {
    throw new Error('logical id equals Yjs item id');
  }
  if (meta.wordFacingIds.includes(meta.logicalId)) {
    throw new Error('logical id equals a Word-facing id');
  }
}

export class LogicalIdMint {
  private next = 0;
  constructor(readonly actorId: string) {}
  take(): LogicalId {
    const id = mintLogicalId(this.actorId, this.next);
    this.next += 1;
    return id;
  }
}
