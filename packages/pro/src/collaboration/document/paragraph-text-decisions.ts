/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * A decision on a whole revision records what it saw, so it reaches every character it saw.
 *
 * A revision is an attribute on characters (`paragraph-text-revisions.ts`), and a decision
 * removes the attribute's markers. A peer's concurrent decision on one piece of the revision
 * writes a new marker after that piece, which sets the revision again on the rest of it. The
 * whole decision did not see that marker and does not reach it, so the rest of the revision
 * stayed pending, and so did the text after the revision up to its next marker.
 *
 * So when an edit leaves no character of a paragraph in a revision that it removed from some
 * character, it records, in the paragraph's record, what it saw of the paragraph's text: for
 * each client that wrote characters there, one past the last clock of them. A client's clocks
 * only grow, so a character the decision saw has a clock below that bound, and a character
 * written later, typed or put back by an undo, has one at or above it. Reading leaves every
 * character the decision saw out of the revision, as it leaves a character a strike did not
 * see out of the strike (`paragraph-text-strikes.ts`). The record is part of the deciding
 * step: the undo of that step withdraws it.
 *
 * Each writer keys its own entry by revision and client, so two concurrent decisions on one
 * revision keep both records, and a reader takes the larger bound of each client. Every value comes from a peer: a key or value that does not
 * parse is ignored.
 */
import * as Y from 'yjs';
import { rejectDangerousKey } from './limits.ts';
import { isRecord } from './paragraph-text-codec.ts';
import { parseJson, REVISION_PREFIX } from './paragraph-text-revisions.ts';
import { firstItem } from './yjs-items.ts';

/**
 * The prefix of a paragraph record key that holds one decision: `d` and the separator, then the
 * revision key, the separator, and the writing client. Each writer sets only its own keys, so
 * two peers' concurrent records never replace each other.
 */
export const DECISION_PREFIX = 'd\u001f';

/** Separates the revision key from the writing client in an entry key. */
const SEP = '\u001f';

/** How many clients one record names; a paragraph written by more records nothing. */
const MAX_SEEN_CLIENTS = 256;
/** How many entries a reader reads; past this the paragraph reads as without records. */
const MAX_ENTRIES = 4096;
const CLIENT = /^\d{1,16}$/;

/** For each decided revision key, one past the last clock each client wrote that it saw. */
export type Decided = ReadonlyMap<string, ReadonlyMap<number, number>>;

/** Whether a paragraph record key holds a decision. */
export function isDecisionKey(key: string): boolean {
  return key.startsWith(DECISION_PREFIX);
}

/** The record map of the paragraph a text belongs to, or null. */
function recordOf(text: Y.Text): Y.Map<unknown> | null {
  const parent = text.parent;
  return parent instanceof Y.Map ? (parent as Y.Map<unknown>) : null;
}

function parseSeen(value: unknown): Map<number, number> | null {
  const data = parseJson(value);
  if (!isRecord(data)) return null;
  const entries = Object.entries(data);
  if (entries.length === 0 || entries.length > MAX_SEEN_CLIENTS) return null;
  const seen = new Map<number, number>();
  for (const [client, clock] of entries) {
    if (!CLIENT.test(client) || !Number.isSafeInteger(clock) || (clock as number) < 0) return null;
    seen.set(Number(client), clock as number);
  }
  return seen;
}

/** The decisions recorded for a paragraph's text, or null when it holds none. */
export function decidedOf(text: Y.Text): Decided | null {
  const record = recordOf(text);
  if (!record) return null;
  let read: Map<string, Map<number, number>> | null = null;
  let entries = 0;
  for (const [entry, value] of record.entries()) {
    if (!isDecisionKey(entry)) continue;
    if ((entries += 1) > MAX_ENTRIES) return null;
    const at = entry.lastIndexOf(SEP);
    if (at <= DECISION_PREFIX.length) continue;
    const key = entry.slice(DECISION_PREFIX.length, at);
    if (!key.startsWith(REVISION_PREFIX) || rejectDangerousKey(key)) continue;
    if (!CLIENT.test(entry.slice(at + 1))) continue;
    const seen = parseSeen(value);
    if (!seen) continue;
    read ??= new Map();
    let merged = read.get(key);
    if (!merged) read.set(key, (merged = new Map()));
    for (const [client, clock] of seen)
      merged.set(client, Math.max(merged.get(client) ?? 0, clock));
  }
  return read;
}

/** The decided keys among `attributes` that saw a character of `client` at `clock`. */
export function decidedKeys(
  decided: Decided,
  attributes: Readonly<Record<string, unknown>>,
  client: number,
  clock: number
): string[] | null {
  let keys: string[] | null = null;
  for (const key in attributes) {
    if (!key.startsWith(REVISION_PREFIX)) continue;
    const bound = decided.get(key)?.get(client);
    if (bound !== undefined && clock < bound) (keys ??= []).push(key);
  }
  return keys;
}

/** How many clocks from `clock` on, up to `end`, the decisions treat alike. */
export function decidedUntil(
  decided: Decided,
  attributes: Readonly<Record<string, unknown>>,
  client: number,
  clock: number,
  end: number
): number {
  let until = end;
  for (const key in attributes) {
    if (!key.startsWith(REVISION_PREFIX)) continue;
    const bound = decided.get(key)?.get(client) ?? 0;
    if (bound > clock && bound < until) until = bound;
  }
  return until;
}

/**
 * Record that the edit in progress decided the revisions `keys` in this paragraph's text: what
 * it saw of the text. A paragraph written by more clients than a record names records nothing,
 * and reads as before.
 */
export function recordDecisions(text: Y.Text, keys: readonly string[]): void {
  const record = recordOf(text);
  const doc = text.doc;
  if (!record || !doc || keys.length === 0) return;
  const seen = new Map<number, number>();
  for (let item = firstItem(text); item; item = item.right) {
    const { client, clock } = item.id;
    seen.set(client, Math.max(seen.get(client) ?? 0, clock + item.length));
  }
  if (seen.size === 0 || seen.size > MAX_SEEN_CLIENTS) return;
  const value: Record<string, number> = {};
  for (const client of [...seen.keys()].sort((a, b) => a - b)) value[client] = seen.get(client)!;
  const encoded = JSON.stringify(value);
  for (const key of keys) {
    if (rejectDangerousKey(key)) continue;
    record.set(`${DECISION_PREFIX}${key}${SEP}${doc.clientID}`, encoded);
  }
}
