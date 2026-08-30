/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** Replicated logical identity. Never a Yjs item id or a Word-facing id. */
export type LogicalId = string;

const HEX = 16;
const REPLICA_BYTES = 16;
const WORD_FACING_NAMES = new Set(['paraId', 'textId', 'id', 'numId', 'bookmarkId']);

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(HEX).padStart(2, '0');
  return hex;
}

/** 128-bit replica identity as 32 lowercase hex characters. */
export function createReplicaIdentity(randomBytes?: Uint8Array): string {
  if (randomBytes) {
    if (randomBytes.byteLength !== REPLICA_BYTES) {
      throw new Error('replica identity requires 16 bytes');
    }
    return bytesToHex(randomBytes);
  }
  const bytes = new Uint8Array(REPLICA_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function isReplicaIdentity(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value);
}

/** Actor-scoped logical ids stay independent from Yjs clocks and Word-facing ids. */
export function mintLogicalId(replicaId: string, counter: number): LogicalId {
  if (!isReplicaIdentity(replicaId)) {
    throw new Error('invalid replica identity');
  }
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error('invalid logical-id counter');
  }
  return `lid:${replicaId}:${counter.toString(10)}`;
}

export function yjsItemKey(client: number, clock: number): string {
  return `yjs:${client}:${clock}`;
}

/**
 * The replica that minted a logical id, or null for a baseline id.
 *
 * `lid:<32-hex replica>:<counter>` yields the replica; a baseline id
 * (`/word/document.xml#…`) has no minting replica. Used to group concurrently-minted
 * replacement runs so a deterministic winner can be chosen across peers.
 */
export function replicaOfLogicalId(id: string): string | null {
  if (!id.startsWith('lid:')) return null;
  const replica = id.slice(4, id.indexOf(':', 4));
  return isReplicaIdentity(replica) ? replica : null;
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

export interface NodeIdentityMeta {
  readonly logicalId: LogicalId;
  readonly yjsItemKey: string | null;
  readonly wordFacingIds: readonly string[];
}

export function assertIndependentIdentity(meta: NodeIdentityMeta): void {
  if (meta.yjsItemKey !== null && meta.logicalId === meta.yjsItemKey) {
    throw new Error('logical id equals Yjs item id');
  }
  if (meta.wordFacingIds.includes(meta.logicalId)) {
    throw new Error('logical id equals a Word-facing id');
  }
}

/** Monotonic allocator bound to one 128-bit replica identity. */
export class LogicalIdAllocator {
  readonly replicaId: string;
  private next = 0;
  constructor(replicaId?: string) {
    this.replicaId = replicaId ?? createReplicaIdentity();
    if (!isReplicaIdentity(this.replicaId)) {
      throw new Error('invalid replica identity');
    }
  }
  take(): LogicalId {
    const id = mintLogicalId(this.replicaId, this.next);
    this.next += 1;
    return id;
  }
  get counter(): number {
    return this.next;
  }
}
