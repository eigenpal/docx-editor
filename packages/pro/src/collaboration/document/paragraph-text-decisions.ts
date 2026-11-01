/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The characters a decision took out of a revision, so a peer's concurrent write cannot put
 * them back in it.
 *
 * A revision is a formatting attribute over a range of the shared text
 * (`paragraph-text-revisions.ts`), and a decision that removes it from some characters while
 * others keep it writes a marker that restores it after them. When a peer typed into a pending
 * insertion, it showed as two pieces, and one reviewer could accept the first piece while
 * another reviewer accepted the whole insertion, which they saw before the typing. The first
 * reviewer's marker restored the insertion over the second piece, and the second reviewer's
 * accept, which removed the markers it saw, never reached it: the text the second reviewer
 * accepted stayed pending.
 *
 * So a write that removes a revision from characters records them here, by the item each
 * character stands in, and every replica reads those characters outside that revision. The
 * record is part of the deciding step: the undo of that step withdraws it, and only that undo
 * does. A character typed later, by a peer or by an undo, is a new item and is not recorded.
 *
 * Every value is written by a peer. A key or value that does not parse is ignored, and a key
 * counts only from the client it names, as every writer keys its own.
 */
import * as Y from 'yjs';
import { rejectDangerousKey } from './limits.ts';
import { Coverage, type DeletedRun } from './paragraph-text-deletions.ts';
import { REVISION_PREFIX } from './paragraph-text-revisions.ts';
import { changedKeysOf, formatKeepingEnds, mapEntry } from './yjs-items.ts';

/** The shared map of the decisions, at the document root. */
export const TEXT_DECISIONS_KEY = 'docx-text-decisions-v1';

const KEY = /^a(\d{1,16}):(\d{1,16})$/;
const RUN = /^(\d{1,16}):(\d{1,16}):(\d{1,16})$/;

/** The most runs one record holds; a longer decision writes several records. */
const MAX_DECISION_RUNS = 4096;

/** The longest run of one record: no insert of paragraph text is longer. */
const MAX_RUN_LENGTH = 1 << 20;

/** The longest revision key a record names; one a writer encodes is far shorter. */
const MAX_REVISION_KEY = 4096;

interface DecisionRecord {
  readonly client: number;
  /** The revision attribute the decision removed, `v:<wrapper ID>`. */
  readonly revision: string;
  readonly runs: readonly DeletedRun[];
}

function safe(value: string): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

/** The record a key and value hold, or null when either does not parse. */
function recordOf(key: string, value: unknown): DecisionRecord | null {
  const parsed = KEY.exec(key);
  if (!parsed || typeof value !== 'string') return null;
  const client = safe(parsed[1]!);
  if (client === null) return null;
  const split = value.indexOf('\n');
  if (split < 0) return null;
  const revision = value.slice(0, split);
  if (
    !revision.startsWith(REVISION_PREFIX) ||
    revision.length > MAX_REVISION_KEY ||
    rejectDangerousKey(revision)
  ) {
    return null;
  }
  const runs: DeletedRun[] = [];
  for (const part of value.slice(split + 1).split(';')) {
    if (runs.length >= MAX_DECISION_RUNS) return null;
    const run = RUN.exec(part);
    if (!run) return null;
    const runClient = safe(run[1]!);
    const from = safe(run[2]!);
    const length = safe(run[3]!);
    if (runClient === null || from === null || length === null) return null;
    if (length < 1 || length > MAX_RUN_LENGTH) return null;
    runs.push({ client: runClient, from, to: from + length });
  }
  return runs.length === 0 ? null : { client, revision, runs };
}

/** The decisions of one document, indexed by revision and by the client of each item. */
export class TextDecisions {
  private readonly byKey = new Map<string, DecisionRecord>();
  /** Decided characters, by revision, then by the client of their item. */
  private index: Map<string, Map<number, Coverage>> | null = null;
  private readonly listeners = new Set<(runs: readonly DeletedRun[]) => void>();

  constructor(
    private readonly doc: Y.Doc,
    private readonly map: Y.Map<string>
  ) {
    map.forEach((value, key) => this.refresh(key, value));
  }

  /** Hear the items a transaction recorded or withdrew. Returns the unsubscribe. */
  subscribe(listener: (runs: readonly DeletedRun[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Whether any record names `revision`: a reader asks no more of one that none names. */
  names(revision: string): boolean {
    return this.indexed().has(revision);
  }

  /** Whether no record exists at all. */
  get empty(): boolean {
    return this.byKey.size === 0;
  }

  /** Whether a decision took the character of item `client:clock` out of `revision`. */
  decided(revision: string, client: number, clock: number): boolean {
    return this.indexed().get(revision)?.get(client)?.has(clock) ?? false;
  }

  /** Record that this replica took the items `runs` out of `revision`. Returns the keys. */
  record(revision: string, runs: readonly DeletedRun[]): string[] {
    const keys: string[] = [];
    for (let at = 0; at < runs.length; at += MAX_DECISION_RUNS) {
      const value = `${revision}\n${runs
        .slice(at, at + MAX_DECISION_RUNS)
        .map((run) => `${run.client}:${run.from}:${run.to - run.from}`)
        .join(';')}`;
      // Keyed by this client's clock before the write, which the write itself then takes, so
      // every record of this client has a key of its own.
      const key = `a${this.doc.clientID}:${Y.getState(this.doc.store, this.doc.clientID)}`;
      this.map.set(key, value);
      this.refresh(key, value);
      keys.push(key);
    }
    return keys;
  }

  /** Read the keys a transaction changed again, and tell listeners what they record. */
  refreshKeys(keys: Iterable<string | null>): void {
    const changed: DeletedRun[] = [];
    for (const key of keys) {
      if (key === null) continue;
      for (const run of this.byKey.get(key)?.runs ?? []) changed.push(run);
      this.refresh(key, this.map.get(key));
      for (const run of this.byKey.get(key)?.runs ?? []) changed.push(run);
    }
    if (changed.length === 0) return;
    for (const listener of this.listeners) listener(changed);
  }

  private refresh(key: string, value: unknown): void {
    const had = this.byKey.delete(key);
    const parsed = recordOf(key, value);
    const entry = parsed ? mapEntry(this.map, key) : undefined;
    const valid = parsed !== null && (!entry || entry.id.client === parsed.client);
    if (valid) this.byKey.set(key, parsed);
    // Records change rarely, once per decision, so a change indexes everything again on the
    // next read.
    if (had || valid) this.index = null;
  }

  private indexed(): Map<string, Map<number, Coverage>> {
    if (this.index) return this.index;
    const ranges = new Map<string, Map<number, DeletedRun[]>>();
    for (const { revision, runs } of this.byKey.values()) {
      let byClient = ranges.get(revision);
      if (!byClient) ranges.set(revision, (byClient = new Map()));
      for (const run of runs) {
        let list = byClient.get(run.client);
        if (!list) byClient.set(run.client, (list = []));
        list.push(run);
      }
    }
    const index = new Map<string, Map<number, Coverage>>();
    for (const [revision, byClient] of ranges) {
      const coverage = new Map<number, Coverage>();
      for (const [client, list] of byClient) coverage.set(client, Coverage.of(list));
      index.set(revision, coverage);
    }
    this.index = index;
    return index;
  }
}

const decisionsByDoc = new WeakMap<Y.Doc, TextDecisions>();

/**
 * The decisions of a document. The index reads each changed key before any observer of the
 * transaction runs, so an observer that reads the text never sees a stale record.
 */
export function textDecisionsOf(doc: Y.Doc): TextDecisions {
  let decisions = decisionsByDoc.get(doc);
  if (decisions) return decisions;
  const map = doc.getMap<string>(TEXT_DECISIONS_KEY);
  decisions = new TextDecisions(doc, map);
  const created = decisions;
  doc.on('beforeObserverCalls', (transaction: Y.Transaction) => {
    const keys = changedKeysOf(transaction, map);
    if (keys) created.refreshKeys(keys);
  });
  decisionsByDoc.set(doc, decisions);
  return decisions;
}

/**
 * Format the characters at `positions` (adjacent, from the first) with `changes`, and record
 * every revision the format removes from them. `items` names the item each position stands
 * in, as `client:clock`; a position with no item is not recorded. The markers that end a
 * removed revision after them are kept (`formatKeepingEnds`), so a peer's concurrent marker
 * that restores the revision over some of them ends where the revision ended.
 */
export function formatDecision(
  text: Y.Text,
  changes: Readonly<Record<string, string | null>>,
  items: readonly string[] | undefined,
  positions: readonly { readonly position: number }[]
): void {
  const removed = new Set(
    Object.keys(changes).filter((key) => key.startsWith(REVISION_PREFIX) && changes[key] === null)
  );
  const doc = text.doc;
  if (doc && items && removed.size > 0) {
    const runs: DeletedRun[] = [];
    for (const { position } of positions) {
      const [client, clock] = (items[position] ?? '').split(':').map(Number);
      if (!Number.isSafeInteger(client) || !Number.isSafeInteger(clock) || client! < 0) continue;
      const last = runs[runs.length - 1];
      if (last && last.client === client && last.to === clock) {
        runs[runs.length - 1] = { client: client!, from: last.from, to: clock! + 1 };
      } else runs.push({ client: client!, from: clock!, to: clock! + 1 });
    }
    const decisions = textDecisionsOf(doc);
    if (runs.length > 0) for (const revision of removed) decisions.record(revision, runs);
  }
  formatKeepingEnds(text, positions[0]!.position, positions.length, changes, removed);
}
