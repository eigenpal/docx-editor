// Actor-scoped decimal id allocation for revision, comment, relationship, bookmark,
// `_Toc` bookmark-name, and content-control id namespaces.
//
// WHY STRIPES: two replicas that mint by "one past the highest local id" compute the SAME
// value from the same snapshot. The CRDT then keeps both nodes and the shared `@w:id` /
// `rIdN`, so Accept on your tracked change accepts a colleague's edit, and comment anchors
// cross-link. The collision is not structural — the tree is fine, the id namespace is not.
//
// A residue class per actor (id ≡ stripe (mod N)) makes concurrent mints land on disjoint
// numbers, so they cannot meet. N stays small so collaborative ids stay near Word's dense
// range rather than jumping to `rId1048577`. Solo documents pass no actor and keep Word's
// "one past highest" sequence byte-for-byte.
//
// The actor is the SAME `TransactOptions.actorId` the surface already hands the store when a
// collaboration session is attached. This module does not invent a second identity.

import { fnv1a32 } from './para-id.ts';
import type { OoxmlPackage } from './ooxml-package.ts';

/**
 * Stripe count. 16 residue classes stay small (`0..15`, then `16..31`, …) while two
 * distinct session actors almost never share a class. Hash collision of two actor strings
 * into one stripe is the remaining way two peers could meet; the hash is FNV-1a, the same
 * one paragraph ids already use, so the mapping is stable across processes.
 */
export const ACTOR_ID_STRIPE = 16;

/** Word reads `ST_DecimalNumber` revision and comment ids as signed 32-bit. */
export const MAX_DECIMAL_ID = 2_147_483_647;

/** `rId` scanners in this package already reject more than nine digits. */
export const MAX_RELATIONSHIP_NUMBER = 999_999_999;

let activeActorId: string | undefined;

/**
 * Bind the transaction's actor for the duration of `run`.
 *
 * Mint sites that cannot take an extra argument (package `applyPackage` hooks, revision
 * appliers) read {@link transactionActorId} rather than inventing a second actor.
 *
 * No actor INHERITS the enclosing one rather than clearing it. Every `TreeDocumentStore.transact`
 * binds through here and most callers pass none, so assigning `undefined` would drop the actor an
 * outer boundary had bound — and every mint inside that transaction would silently fall back to
 * Word's dense sequence and agree with the other replica on the same id. An actor is only ever
 * bound when a replica is attached, which is equally true of the nested transaction.
 */
export function runWithTransactionActor<T>(actorId: string | undefined, run: () => T): T {
  const previous = activeActorId;
  activeActorId = actorId ?? previous;
  try {
    return run();
  } finally {
    activeActorId = previous;
  }
}

/** The actor bound by the open store transaction, or `undefined` when none is attached. */
export function transactionActorId(): string | undefined {
  return activeActorId;
}

/** Stable residue in `0..ACTOR_ID_STRIPE-1` for one actor string. */
export function actorStripe(actorId: string): number {
  return fnv1a32(actorId) % ACTOR_ID_STRIPE;
}

/** Resolve an explicit actor, then the open transaction, then none (solo / Word-like). */
export function resolveAllocationActor(actorId?: string): string | undefined {
  return actorId ?? activeActorId;
}

/**
 * Next unused id in `actorId`'s residue class.
 *
 * Walks `stripe, stripe+N, stripe+2N, …` and skips ids already in `used`. Past the ceiling
 * there is no "one higher" left in the stripe; wrapping and handing back a used id would
 * join an existing revision by accident, which a crafted `@w:id` could force. Refuse rather
 * than invent a collision.
 */
export function nextStripedDecimalId(
  used: ReadonlySet<string>,
  actorId: string,
  max: number
): string {
  const stripe = actorStripe(actorId);
  for (let candidate = stripe; candidate <= max; candidate += ACTOR_ID_STRIPE) {
    if (!used.has(String(candidate))) return String(candidate);
  }
  throw new TypeError('no free decimal id');
}

/**
 * Solo "one past highest". When that would pass `max`, scan from zero for an unused id —
 * the same wrap the revision minter already had, so a huge attacker-controlled `@w:id`
 * cannot push us into `w:id="1e+22"`.
 */
export function nextDenseDecimalId(
  highest: number,
  used: ReadonlySet<string> | undefined,
  max: number
): string {
  const next = highest + 1;
  if (next <= max) return String(next);
  if (!used) throw new TypeError('no free decimal id');
  for (let candidate = 0; candidate <= max; candidate += 1) {
    if (!used.has(String(candidate))) return String(candidate);
  }
  throw new TypeError('no free decimal id');
}

const RELATIONSHIP_NUMBER = /^rId(\d{1,9})$/;

/** Parse `rIdN` when N is a 1–9 digit integer; anything else is not a seed. */
export function relationshipNumberOf(id: string): number | null {
  const match = RELATIONSHIP_NUMBER.exec(id);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

/** Format a positive integer as `rIdN`. */
export function relationshipIdFromNumber(value: number): string {
  return `rId${value}`;
}

/**
 * Next `rIdN` on the whole package (internal + external records).
 *
 * No actor: `rId${max+1}` — byte-identical to the three previous copies of this scan.
 * With an actor: the next unused striped `rId`.
 */
export function freePackageRelationshipId(pkg: OoxmlPackage, actorId?: string): string {
  const used = new Set<string>();
  let max = 0;
  for (const records of pkg.relationships.values()) {
    for (const record of records) {
      used.add(record.id);
      const value = relationshipNumberOf(record.id);
      if (value !== null && value > max) max = value;
    }
  }
  for (const external of pkg.externalTargets) {
    used.add(external.id);
    const value = relationshipNumberOf(external.id);
    if (value !== null && value > max) max = value;
  }
  const actor = resolveAllocationActor(actorId);
  if (!actor) return relationshipIdFromNumber(max + 1);
  const numbers = new Set<string>();
  for (const id of used) {
    const value = relationshipNumberOf(id);
    if (value !== null) numbers.add(String(value));
  }
  return relationshipIdFromNumber(
    Number(nextStripedDecimalId(numbers, actor, MAX_RELATIONSHIP_NUMBER))
  );
}
