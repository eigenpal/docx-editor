/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * A tracked deletion strikes only the characters its author saw.
 *
 * A strike is a formatting attribute over a range of the shared text (`paragraph-text-revisions.ts`),
 * and Yjs gives a character inserted inside a formatted range the range's attributes. So text a
 * peer typed in a run while another peer struck the run became part of the deletion, though its
 * author typed it and the deleting author never saw it: it showed struck, an accept removed it,
 * and the typing that came after it went past the strike, away from the text it continued.
 *
 * So a strike records what it saw, in `s` next to the revision: for each client that wrote
 * characters in the struck range, one past the last clock of them. A client's clocks only grow
 * and a peer receives each client's updates in order, so a character of the range has a clock
 * below that bound, and a character inserted there later, by a peer that had not seen the
 * strike or by an undo, has one at or above it. Reading leaves that character out of the
 * strike. Typing never lands inside a deletion, so no character its author meant to strike
 * is left out. A strike without `s`, as one an older release or an insert wrote, covers every
 * character inside it, as before.
 */
import * as Y from 'yjs';
import { firstItem } from './yjs-items.ts';
import { isRecord } from './paragraph-text-codec.ts';
import { parseJson, REVISION_PREFIX } from './paragraph-text-revisions.ts';

/** The field of a revision value that records what a strike saw. */
export const STRIKE_SEEN_FIELD = 's';

/** How many clients one strike records; a strike over more records none and covers all. */
const MAX_SEEN_CLIENTS = 256;

const STRIKES = new Set(['del', 'moveFrom']);
const CLIENT = /^\d{1,16}$/;

type Attributes = Readonly<Record<string, unknown>>;

/** What a strike saw: one past the last clock of each client, or null to cover everything. */
type Seen = ReadonlyMap<number, number> | null;

const parsed = new Map<string, Seen>();
const MAX_PARSED = 4096;

/** What a revision value says its strike saw, or null when it is no strike that records it. */
function seenOf(value: unknown): Seen {
  if (typeof value !== 'string' || !value.includes(`"${STRIKE_SEEN_FIELD}":`)) return null;
  const cached = parsed.get(value);
  if (cached !== undefined) return cached;
  let seen: Map<number, number> | null = null;
  const data = parseJson(value);
  const field = isRecord(data) ? data[STRIKE_SEEN_FIELD] : undefined;
  // Only a strike records what it saw: a record on any other revision value is ignored.
  if (isRecord(field) && Object.keys(field).length <= MAX_SEEN_CLIENTS && isStrike(data)) {
    seen = new Map();
    for (const [client, clock] of Object.entries(field)) {
      if (!CLIENT.test(client) || !Number.isSafeInteger(clock) || (clock as number) < 0) {
        seen = null;
        break;
      }
      seen.set(Number(client), clock as number);
    }
  }
  if (parsed.size >= MAX_PARSED) parsed.clear();
  parsed.set(value, seen);
  return seen;
}

/** Whether a revision value is a strike: a tracked deletion or the source of a move. */
function isStrike(value: unknown): boolean {
  const data = typeof value === 'string' ? parseJson(value) : value;
  const element = isRecord(data) ? data.e : undefined;
  return isRecord(element) && element.n === undefined && STRIKES.has(element.l as string);
}

/**
 * `changes` for a format over characters of the given clients and clocks, with what each new
 * strike saw recorded in it. Removals and other attributes are kept as they are.
 */
export function recordStrikesSeen(
  changes: Readonly<Record<string, string | null>>,
  characters: readonly { readonly client: number; readonly clock: number }[]
): Record<string, string | null> {
  let out: Record<string, string | null> | null = null;
  let seen: Record<string, number> | null = null;
  for (const [key, value] of Object.entries(changes)) {
    if (!key.startsWith(REVISION_PREFIX) || value === null || !isStrike(value)) continue;
    const data = parseJson(value) as Record<string, unknown>;
    if (data[STRIKE_SEEN_FIELD] !== undefined) continue;
    if (!seen) {
      const bounds = new Map<number, number>();
      for (const { client, clock } of characters) {
        if (client < 0) continue;
        bounds.set(client, Math.max(bounds.get(client) ?? 0, clock + 1));
      }
      if (bounds.size === 0 || bounds.size > MAX_SEEN_CLIENTS) return { ...changes };
      seen = {};
      for (const client of [...bounds.keys()].sort((a, b) => a - b)) {
        seen[client] = bounds.get(client)!;
      }
    }
    out ??= { ...changes };
    out[key] = JSON.stringify({ ...data, [STRIKE_SEEN_FIELD]: seen });
  }
  return out ?? { ...changes };
}

/**
 * Attributes for inserted characters: a strike they take keeps no record of what it saw, so it
 * covers them. An insert writes its attributes, so it never takes a strike by accident.
 */
export function withoutStrikesSeen<T extends Attributes>(attributes: T): T {
  let out: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(attributes)) {
    if (!key.startsWith(REVISION_PREFIX) || seenOf(value) === null) continue;
    const { [STRIKE_SEEN_FIELD]: _seen, ...rest } = parseJson(value) as Record<string, unknown>;
    out ??= { ...attributes };
    out[key] = JSON.stringify(rest);
  }
  return (out ?? attributes) as T;
}

/** The strikes in `attributes` that did not see a character of `client` at `clock`. */
function unseenStrikes(attributes: Attributes, client: number, clock: number): string[] | null {
  let keys: string[] | null = null;
  for (const key in attributes) {
    if (!key.startsWith(REVISION_PREFIX)) continue;
    const seen = seenOf(attributes[key]);
    if (seen && clock >= (seen.get(client) ?? 0)) (keys ??= []).push(key);
  }
  return keys;
}

/** How many characters from `clock` on in an item of `client` one strike set treats alike. */
function sameUntil(attributes: Attributes, client: number, clock: number, end: number): number {
  let until = end;
  for (const key in attributes) {
    if (!key.startsWith(REVISION_PREFIX)) continue;
    const bound = seenOf(attributes[key])?.get(client) ?? 0;
    if (bound > clock && bound < until) until = bound;
  }
  return until;
}

type DeltaOp = { insert: unknown; attributes?: Record<string, unknown> };

/** The attribute that holds a character's text element, as `paragraph-text.ts` writes it. */
const TEXT_KEY = 't';
/** The live text element of each deleted one, as compact data: `w:t` is the slot's default. */
const LIVE_ELEMENT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  delText: {},
  delInstrText: { l: 'instrText', k: 'instrText' },
};

/**
 * `attributes` without the strikes `keys` names. A strike also turned the text element into
 * deleted text, so a character left in no strike gets its live text element back.
 */
function outOfStrikes(
  attributes: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const own = { ...attributes };
  for (const key of keys) delete own[key];
  for (const key in own) {
    if (key.startsWith(REVISION_PREFIX) && isStrike(own[key])) return own;
  }
  const text = parseJson(own[TEXT_KEY]);
  const element =
    isRecord(text) && typeof text.l === 'string' && Object.hasOwn(LIVE_ELEMENT, text.l)
      ? LIVE_ELEMENT[text.l]
      : undefined;
  if (isRecord(text) && element && text.n === undefined) {
    const { l: _name, k: _kind, ...live } = text;
    own[TEXT_KEY] = JSON.stringify({ ...live, ...element });
  }
  return own;
}

/**
 * A paragraph text's delta, as `Y.Text#toDelta` gives it, with every character left out of the
 * strikes that did not see it.
 */
export function sharedDelta(text: Y.Text): DeltaOp[] {
  const ops: DeltaOp[] = [];
  const current: Record<string, unknown> = {};
  let attributes: Record<string, unknown> | null = null;
  const attributesNow = (): Record<string, unknown> => (attributes ??= { ...current });
  let hasStrikesSeen = false;
  // The attributes object the last string op was packed with, to pack the next one into it.
  let packed: Record<string, unknown> | null = null;
  const push = (insert: unknown, own: Record<string, unknown>): void => {
    const op: DeltaOp = { insert };
    if (Object.keys(own).length > 0) op.attributes = own;
    ops.push(op);
    packed = null;
  };
  // One object for each set of strikes left out of the same attributes, so equal ops pack.
  let left = new Map<string, Record<string, unknown>>();
  const minus = (keys: readonly string[]): Record<string, unknown> => {
    const joined = keys.join('\n');
    let own = left.get(joined);
    if (!own) left.set(joined, (own = outOfStrikes(attributesNow(), keys)));
    return own;
  };
  const pushString = (str: string, own: Record<string, unknown>): void => {
    const last = ops.at(-1);
    // No format marker since the op before, or the same strikes left out: one insert, as
    // `toDelta` packs it.
    if (last && packed === own) last.insert = (last.insert as string) + str;
    else {
      push(str, own);
      packed = own;
    }
  };
  for (let item = firstItem(text); item; item = item.right) {
    if (item.deleted) continue;
    const content = item.content;
    if (content instanceof Y.ContentFormat) {
      if (content.value === null) delete current[content.key];
      else current[content.key] = content.value;
      if (seenOf(content.value) !== null) hasStrikesSeen = true;
      attributes = null;
      left = new Map();
      continue;
    }
    const { client, clock } = item.id;
    if (content instanceof Y.ContentString) {
      const str = content.str;
      if (!hasStrikesSeen) {
        pushString(str, attributesNow());
        continue;
      }
      for (let at = 0; at < str.length; ) {
        const unseen = unseenStrikes(attributesNow(), client, clock + at);
        const until = sameUntil(attributesNow(), client, clock + at, clock + str.length) - clock;
        pushString(str.slice(at, until), unseen ? minus(unseen) : attributesNow());
        at = until;
      }
      continue;
    }
    if (content instanceof Y.ContentEmbed || content instanceof Y.ContentType) {
      const unseen = hasStrikesSeen ? unseenStrikes(attributesNow(), client, clock) : null;
      push(content.getContent()[0], unseen ? minus(unseen) : { ...attributesNow() });
    }
  }
  return ops;
}
