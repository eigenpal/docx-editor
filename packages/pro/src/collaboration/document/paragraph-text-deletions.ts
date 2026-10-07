/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Characters a participant deleted, by identity, so a copy of them that a peer made at the
 * same time stays deleted too.
 *
 * A move deletes characters and writes copies of them, and a deletion only deletes. Yjs does
 * not record who deleted an item, so a peer's concurrent move of deleted text left a copy that
 * showed again, and so did a peer's undo that put a deleted paragraph back. A write therefore
 * records the identities it deletes and does not copy, and every replica hides every copy of
 * them. The record is part of the deleting step: the undo of that step withdraws it, and only
 * that undo does.
 *
 * Every value is written by a peer. A key or value that does not parse is ignored, and a key
 * counts only from the client it names, as every writer keys its own.
 */
import * as Y from 'yjs';
import { changedKeysOf, mapEntry } from './yjs-items.ts';

/** The shared map of the deletions, at the document root. */
export const TEXT_DELETIONS_KEY = 'docx-text-deletions-v1';

const KEY = /^d(\d{1,16}):(\d{1,16})$/;
const RUN = /^(\d{1,16}):(\d{1,16}):(\d{1,16})$/;

/** The most runs one record holds; a longer deletion writes several records. */
const MAX_DELETION_RUNS = 4096;

/** The longest run of one record, as for marks: no insert of paragraph text is longer. */
const MAX_RUN_LENGTH = 1 << 20;

/** Identities `from` up to `to` of one client. */
export interface DeletedRun {
  readonly client: number;
  readonly from: number;
  readonly to: number;
}

function safe(value: string): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

/** The runs a key and value record, with the client that wrote them, or null. */
function recordOf(
  key: string,
  value: unknown
): { readonly client: number; readonly runs: readonly DeletedRun[] } | null {
  const parsed = KEY.exec(key);
  if (!parsed || typeof value !== 'string') return null;
  const client = safe(parsed[1]!);
  if (client === null) return null;
  const runs: DeletedRun[] = [];
  for (const part of value.split(';')) {
    if (runs.length >= MAX_DELETION_RUNS) return null;
    const run = RUN.exec(part);
    if (!run) return null;
    const runClient = safe(run[1]!);
    const from = safe(run[2]!);
    const length = safe(run[3]!);
    if (runClient === null || from === null || length === null) return null;
    if (length < 1 || length > MAX_RUN_LENGTH) return null;
    runs.push({ client: runClient, from, to: from + length });
  }
  return runs.length === 0 ? null : { client, runs };
}

/** Sorted, disjoint ranges of one client's identities, merged as they are added. */
class Coverage {
  private readonly starts: number[] = [];
  private readonly ends: number[] = [];

  add(from: number, to: number): void {
    // The ranges this one touches merge into one.
    let low = 0;
    let high = this.starts.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.ends[middle]! < from) low = middle + 1;
      else high = middle;
    }
    let end = low;
    let start = from;
    let stop = to;
    while (end < this.starts.length && this.starts[end]! <= to) {
      start = Math.min(start, this.starts[end]!);
      stop = Math.max(stop, this.ends[end]!);
      end += 1;
    }
    this.starts.splice(low, end - low, start);
    this.ends.splice(low, end - low, stop);
  }

  has(clock: number): boolean {
    let low = 0;
    let high = this.starts.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (this.starts[middle]! > clock) high = middle - 1;
      else if (this.ends[middle]! <= clock) low = middle + 1;
      else return true;
    }
    return false;
  }
}

/** The deletions of one document, indexed for lookup by any identity. */
export class TextDeletions {
  private readonly byKey = new Map<string, readonly DeletedRun[]>();
  /** Deleted characters, by the client of their identity. */
  private characters = new Map<number, Coverage>();
  private readonly listeners = new Set<(runs: readonly DeletedRun[]) => void>();

  constructor(
    private readonly doc: Y.Doc,
    private readonly map: Y.Map<string>
  ) {
    map.forEach((value, key) => this.refresh(key, value));
  }

  /** Hear the identities a transaction recorded or withdrew. Returns the unsubscribe. */
  subscribe(listener: (runs: readonly DeletedRun[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Whether a participant deleted the identity `client:clock`. */
  isDeleted(client: number, clock: number): boolean {
    return this.characters.get(client)?.has(clock) ?? false;
  }

  /** Record deleted identities, as runs, in this replica's own records. Returns their keys. */
  record(runs: readonly DeletedRun[]): string[] {
    const keys: string[] = [];
    for (let at = 0; at < runs.length; at += MAX_DELETION_RUNS) {
      const value = runs
        .slice(at, at + MAX_DELETION_RUNS)
        .map((run) => `${run.client}:${run.from}:${run.to - run.from}`)
        .join(';');
      // Keyed by this client's clock before the write, which the write itself then takes, so
      // every record of this client has a key of its own.
      const key = `d${this.doc.clientID}:${Y.getState(this.doc.store, this.doc.clientID)}`;
      this.map.set(key, value);
      this.refresh(key, value);
      keys.push(key);
    }
    return keys;
  }

  /** Withdraw records this replica wrote, by key. Another client's key is left alone. */
  withdraw(keys: readonly string[]): void {
    const own = `d${this.doc.clientID}:`;
    for (const key of keys) {
      if (!key.startsWith(own) || !this.map.has(key)) continue;
      // The transaction's observer reads the key again and tells listeners what it withdrew.
      this.map.delete(key);
    }
  }

  /** Read the keys a transaction changed again, and tell listeners what they record. */
  refreshKeys(keys: Iterable<string | null>): void {
    const changed: DeletedRun[] = [];
    for (const key of keys) {
      if (key === null) continue;
      const before = this.byKey.get(key) ?? [];
      this.refresh(key, this.map.get(key));
      const after = this.byKey.get(key) ?? [];
      for (const run of before) changed.push(run);
      for (const run of after) changed.push(run);
    }
    if (changed.length === 0) return;
    for (const listener of this.listeners) listener(changed);
  }

  private refresh(key: string, value: unknown): void {
    const had = this.byKey.has(key);
    this.byKey.delete(key);
    const parsed = recordOf(key, value);
    const entry = parsed ? mapEntry(this.map, key) : undefined;
    const valid = parsed !== null && (!entry || entry.id.client === parsed.client);
    if (valid) this.byKey.set(key, parsed.runs);
    // An undo withdraws a record; the index is built again from the records that remain.
    if (had) this.rebuild();
    else if (valid) this.index(parsed.runs);
  }

  private index(runs: readonly DeletedRun[]): void {
    for (const run of runs) {
      let coverage = this.characters.get(run.client);
      if (!coverage) this.characters.set(run.client, (coverage = new Coverage()));
      coverage.add(run.from, run.to);
    }
  }

  private rebuild(): void {
    this.characters = new Map();
    for (const runs of this.byKey.values()) this.index(runs);
  }
}

const deletionsByDoc = new WeakMap<Y.Doc, TextDeletions>();

/**
 * The deletions of a document. The index reads each changed key before any observer of the
 * transaction runs, so an observer that reads identities never sees a stale record.
 */
export function textDeletionsOf(doc: Y.Doc): TextDeletions {
  let deletions = deletionsByDoc.get(doc);
  if (deletions) return deletions;
  const map = doc.getMap<string>(TEXT_DELETIONS_KEY);
  const created = new TextDeletions(doc, map);
  doc.on('beforeObserverCalls', (transaction: Y.Transaction) => {
    const keys = changedKeysOf(transaction, map);
    if (keys) created.refreshKeys(keys);
  });
  deletionsByDoc.set(doc, created);
  deletions = created;
  return deletions;
}
