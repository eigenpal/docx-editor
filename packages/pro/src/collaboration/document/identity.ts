/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
declare const LOGICAL_ID: unique symbol;

/**
 * Replicated logical identity. Never a Yjs item id or an id the saved document carries.
 *
 * Branded, so a plain string cannot pass for one: a canonical node ID, a key of the shared
 * nodes map or a minted ID becomes a logical ID only through {@link asLogicalId} or
 * {@link mintLogicalId}.
 */
export type LogicalId = string & { readonly [LOGICAL_ID]: true };

/**
 * The logical ID a string names. Canonical node IDs are logical IDs, and so are the keys of the
 * shared nodes map, so a store node, a journal effect or a shared record converts here.
 */
export function asLogicalId(value: string): LogicalId {
  return value as LogicalId;
}

/** The logical ID of a canonical node. */
export function idOf(node: { readonly id: string }): LogicalId {
  return asLogicalId(node.id);
}

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
  return asLogicalId(`lid:${replicaId}:${counter.toString(10)}`);
}

/**
 * A character's identity in paragraph text, or one of its Yjs item IDs, written `client:clock`:
 * the client and clock it names, or null when it names none.
 */
export function parseClientClock(
  key: string
): { readonly client: number; readonly clock: number } | null {
  const at = key.indexOf(':');
  if (at <= 0) return null;
  const client = Number(key.slice(0, at));
  const clock = Number(key.slice(at + 1));
  return Number.isSafeInteger(client) && Number.isSafeInteger(clock) ? { client, clock } : null;
}

/** Whether `next` names the clock right after `previous`, of the same client. */
export function isNextClock(
  previous: string | null | undefined,
  next: string | null | undefined
): boolean {
  const left = previous ? parseClientClock(previous) : null;
  const right = next ? parseClientClock(next) : null;
  return (
    left !== null &&
    right !== null &&
    left.client === right.client &&
    left.clock + 1 === right.clock
  );
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
