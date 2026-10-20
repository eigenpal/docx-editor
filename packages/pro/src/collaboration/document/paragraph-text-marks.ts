/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Marks that say what one insert of paragraph text is: a copy of moved characters, characters
 * an undo put back, or text typed after a character a peer moved.
 *
 * A mark belongs to one insert, so it is keyed by that insert's ID in one map for the whole
 * document. Two peers never write one key, and Yjs keeps every entry as written. Marks kept as
 * formatting in the text did neither: format attributes hold one value per key, so two peers'
 * marks at one place overrode each other, and Yjs removes a format marker that another of the
 * same key follows at once. Either way an insert lost its mark, and its characters showed
 * twice or went missing.
 *
 * Every value is written by a peer. A key or value that does not parse is ignored.
 */
import * as Y from 'yjs';
import { parseFollowAnchor, type FollowAnchor, type Origin } from './paragraph-text-moves.ts';
import { changedKeysOf, mapEntry, structAt } from './yjs-items.ts';

/** The shared map of the marks, at the document root. */
export const TEXT_MARKS_KEY = 'docx-text-marks-v1';

/** A copy of moved characters, characters an undo put back, or a follow anchor. */
export type MarkKind = 'move' | 'restore' | 'follow';

const PREFIX: Readonly<Record<MarkKind, string>> = { move: 'o', restore: 'u', follow: 'f' };
const KEY = /^([ouf])(\d{1,16}):(\d{1,16})$/;
const COPY = /^(\d{1,16}):(\d{1,16}):(\d{1,16})$/;
const FOLLOW = /^(\d{1,16})\|(.{1,40})$/;

interface Span {
  readonly key: string;
  /** The client of the marked insert. */
  readonly client: number;
  readonly firstClock: number;
  readonly length: number;
  readonly origin: Origin | null;
  readonly follow: FollowAnchor | null;
}

/** One kind's spans by the client of their insert, each list sorted by first clock. */
type Spans = Map<number, Span[]>;

/** How many marks one identity resolves through: copies of copies, and back. */
export const MAX_MARK_CHAIN = 16;

/**
 * The longest insert a mark describes. No insert of paragraph text is longer, and a longer
 * one would let a peer make one mark cover a whole client's clocks.
 */
export const MAX_MARK_LENGTH = 1 << 20;

/**
 * How many clock ranges a mark change may visit to find the texts that read through it.
 * Marks a peer wrote can branch at every step; past this, every text is read again, which
 * costs once what the document costs to read, however the marks are arranged.
 */
const MAX_READING_RANGES = 4096;

/** Clocks `from` up to `to` of one client. */
interface ClockRange {
  readonly client: number;
  readonly from: number;
  readonly to: number;
}

/** The index of the first span whose first clock is past `clock`: binary search. */
function upperBound(list: readonly Span[], clock: number): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (list[middle]!.firstClock <= clock) low = middle + 1;
    else high = middle;
  }
  return low;
}

function keyOf(kind: MarkKind, client: number, firstClock: number): string {
  return `${PREFIX[kind]}${client}:${firstClock}`;
}

function safe(value: string): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

/** The span a key and value describe, or null when either does not parse. */
function spanOf(
  key: string,
  value: unknown
): { kind: MarkKind; client: number; span: Span } | null {
  const parsed = KEY.exec(key);
  if (!parsed || typeof value !== 'string') return null;
  const kind: MarkKind = parsed[1] === 'o' ? 'move' : parsed[1] === 'u' ? 'restore' : 'follow';
  const client = safe(parsed[2]!);
  const firstClock = safe(parsed[3]!);
  if (client === null || firstClock === null) return null;
  if (kind === 'follow') {
    const follow = FOLLOW.exec(value);
    const length = follow ? safe(follow[1]!) : null;
    const anchor = follow ? parseFollowAnchor(follow[2]) : null;
    if (length === null || length < 1 || length > MAX_MARK_LENGTH || !anchor) return null;
    return {
      kind,
      client,
      span: { key, client, firstClock, length, origin: null, follow: anchor },
    };
  }
  const copy = COPY.exec(value);
  const identityClient = copy ? safe(copy[1]!) : null;
  const identityClock = copy ? safe(copy[2]!) : null;
  const length = copy ? safe(copy[3]!) : null;
  if (
    identityClient === null ||
    identityClock === null ||
    length === null ||
    length < 1 ||
    length > MAX_MARK_LENGTH
  ) {
    return null;
  }
  const origin: Origin = {
    client: identityClient,
    clock: identityClock,
    insertClient: client,
    firstClock,
    length,
  };
  return { kind, client, span: { key, client, firstClock, length, origin, follow: null } };
}

/** What a reader asks of the marks: the mark of the insert that holds a clock. */
export interface MarkLookup {
  origin(kind: 'move' | 'restore', client: number, clock: number): Origin | null;
  follow(client: number, clock: number): FollowAnchor | null;
}

/** The marks of a text that belongs to no document: none. */
const NO_MARKS: MarkLookup = { origin: () => null, follow: () => null };

/** The marks of one document, indexed for lookup by any clock of an insert. */
export class TextMarks implements MarkLookup {
  private readonly spans: Record<MarkKind, Spans> = {
    move: new Map(),
    restore: new Map(),
    follow: new Map(),
  };

  private readonly byKey = new Map<string, { readonly kind: MarkKind; readonly span: Span }>();
  /**
   * Spans by the client of the identity they name: a copy's source, or a follow anchor. When
   * the marks of that identity change, so do the identities of what these spans mark.
   */
  private readonly dependents = new Map<number, Set<Span>>();

  private readonly listeners = new Set<(texts: ReadonlySet<Y.Text> | 'all') => void>();
  /** The texts that hold any insert of each client, as of that client's state clock. */
  private readonly textsOfClients = new Map<number, { state: number; texts: Set<Y.Text> }>();

  constructor(
    private readonly doc: Y.Doc,
    private readonly map: Y.Map<string>
  ) {
    map.forEach((value, key) => this.refresh(key, value));
  }

  /**
   * Hear which texts hold inserts whose marks a transaction changed: their identities read
   * differently now, though the texts themselves may be unchanged. Returns the unsubscribe.
   */
  subscribe(listener: (texts: ReadonlySet<Y.Text> | 'all') => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The copy or restore mark whose insert holds `clock` of `client`. */
  origin(kind: 'move' | 'restore', client: number, clock: number): Origin | null {
    return this.find(kind, client, clock)?.origin ?? null;
  }

  /** The follow anchor of the insert that holds `clock` of `client`. */
  follow(client: number, clock: number): FollowAnchor | null {
    return this.find('follow', client, clock)?.follow ?? null;
  }

  /**
   * Mark a copy: the `length` characters inserted at `client:firstClock` copy the characters
   * from `identity` on, which is `client:clock`.
   */
  markCopy(
    kind: 'move' | 'restore',
    client: number,
    firstClock: number,
    length: number,
    identity: string
  ): void {
    this.write(keyOf(kind, client, firstClock), `${identity}:${length}`);
  }

  /** Mark typed text: it follows `anchor`, or stays where it was typed. */
  markFollow(client: number, firstClock: number, length: number, anchor: string): void {
    this.write(keyOf('follow', client, firstClock), `${length}|${anchor}`);
  }

  /**
   * Read the keys a transaction changed again, and tell listeners which texts read
   * differently: those that hold the marked inserts, and those whose identities resolve
   * through them, as a copy made before the mark of what it copies arrived does.
   */
  refreshKeys(keys: Iterable<string | null>): void {
    const changed: ClockRange[] = [];
    for (const key of keys) {
      if (key === null) continue;
      const before = this.byKey.get(key)?.span.length ?? 0;
      this.refresh(key, this.map.get(key));
      const after = this.byKey.get(key)?.span.length ?? 0;
      const parsed = KEY.exec(key);
      const client = parsed ? safe(parsed[2]!) : null;
      const clock = parsed ? safe(parsed[3]!) : null;
      if (client === null || clock === null) continue;
      changed.push({ client, from: clock, to: clock + Math.max(before, after, 1) });
    }
    const texts = this.textsReading(changed);
    if (texts !== 'all' && texts.size === 0) return;
    for (const listener of this.listeners) listener(texts);
  }

  /**
   * The texts whose identities read through the clocks of `ranges`, along chains of marks.
   *
   * A walk that would visit more than `MAX_READING_RANGES` ranges or items stops, and answers
   * with every text that holds an insert of a client it reached. Answering with every text of
   * the document let one small write by a peer that had made many inserts cost a read of the
   * whole document each time.
   */
  textsReading(ranges: readonly ClockRange[]): Set<Y.Text> | 'all' {
    const texts = new Set<Y.Text>();
    const visited = new Set<string>();
    const clients = new Set<number>();
    const byClient = (): Set<Y.Text> => {
      for (const client of clients) for (const text of this.textsOfClient(client)) texts.add(text);
      return texts;
    };
    let level = ranges;
    for (let depth = 0; depth <= MAX_MARK_CHAIN && level.length > 0; depth += 1) {
      const next: ClockRange[] = [];
      for (const range of level) clients.add(range.client);
      for (const range of level) {
        const key = `${range.client}:${range.from}:${range.to}`;
        if (visited.has(key)) continue;
        if (visited.size >= MAX_READING_RANGES) return this.withDependents(clients, byClient);
        visited.add(key);
        // Every item the range covers: one client's consecutive clocks can sit in several texts.
        for (let clock = range.from, items = 0; clock < range.to; items += 1) {
          if (items >= MAX_READING_RANGES) return this.withDependents(clients, byClient);
          const item = structAt(this.doc, { client: range.client, clock });
          if (!item) break;
          if (item.parent instanceof Y.Text) texts.add(item.parent);
          clock = item.id.clock + item.length;
        }
        for (const span of this.dependents.get(range.client) ?? []) {
          const reading = dependentRange(span, range);
          if (reading) next.push(reading);
        }
      }
      level = next;
    }
    return texts;
  }

  /**
   * Every client whose marks a chain from `clients` can reach, added to `clients`, and then
   * the texts of all of them. A walk that stops early has not followed every chain, and the
   * texts it did not reach read through these clients.
   */
  private withDependents(clients: Set<number>, texts: () => Set<Y.Text>): Set<Y.Text> {
    const queue = [...clients];
    while (queue.length > 0) {
      const client = queue.pop()!;
      for (const span of this.dependents.get(client) ?? []) {
        // A span reads the client it names; its own client's texts read through it.
        if (!clients.has(span.client)) {
          clients.add(span.client);
          queue.push(span.client);
        }
      }
    }
    return texts();
  }

  /** The texts that hold any insert of `client`, read again only after the client wrote. */
  private textsOfClient(client: number): Set<Y.Text> {
    const state = Y.getState(this.doc.store, client);
    const cached = this.textsOfClients.get(client);
    if (cached?.state === state) return cached.texts;
    const texts = new Set<Y.Text>();
    for (const struct of this.doc.store.clients.get(client) ?? []) {
      const parent = struct instanceof Y.Item ? struct.parent : null;
      if (parent instanceof Y.Text) texts.add(parent);
    }
    this.textsOfClients.set(client, { state, texts });
    return texts;
  }

  private write(key: string, value: string): void {
    if (this.map.get(key) === value) return;
    this.map.set(key, value);
    // Readers in this transaction see the mark before the transaction's observers run.
    this.refresh(key, value);
  }

  private refresh(key: string, value: unknown): void {
    this.remove(key);
    const parsed = spanOf(key, value);
    if (!parsed) return;
    // A mark describes an insert of the client that wrote it, as every writer keys its own. One
    // a peer wrote for another client's text would let it rename or hide that client's typing.
    const entry = mapEntry(this.map, key);
    if (entry && entry.id.client !== parsed.client) return;
    const list = this.spans[parsed.kind].get(parsed.client) ?? [];
    list.splice(upperBound(list, parsed.span.firstClock), 0, parsed.span);
    this.spans[parsed.kind].set(parsed.client, list);
    this.byKey.set(key, { kind: parsed.kind, span: parsed.span });
    const named = namedClient(parsed.span);
    if (named !== null) {
      const dependents = this.dependents.get(named) ?? new Set();
      dependents.add(parsed.span);
      this.dependents.set(named, dependents);
    }
  }

  private remove(key: string): void {
    const entry = this.byKey.get(key);
    if (!entry) return;
    this.byKey.delete(key);
    const list = this.spans[entry.kind].get(entry.span.client);
    if (list) {
      // Spans of one first clock stand together, before the first later one.
      for (let at = upperBound(list, entry.span.firstClock) - 1; at >= 0; at -= 1) {
        if (list[at]!.firstClock !== entry.span.firstClock) break;
        if (list[at] === entry.span) {
          list.splice(at, 1);
          break;
        }
      }
    }
    const named = namedClient(entry.span);
    if (named !== null) this.dependents.get(named)?.delete(entry.span);
  }

  /** The span of one kind whose insert holds `clock` of `client`: binary search by first clock. */
  private find(kind: MarkKind, client: number, clock: number): Span | null {
    const list = this.spans[kind].get(client);
    if (!list) return null;
    let low = 0;
    let high = list.length - 1;
    let found: Span | null = null;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const span = list[middle]!;
      if (span.firstClock <= clock) {
        found = span;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found && clock < found.firstClock + found.length ? found : null;
  }
}

/** The client of the identity a span names, or null for text that stays where it was typed. */
function namedClient(span: Span): number | null {
  if (span.origin) return span.origin.client;
  const identity = span.follow?.identity;
  const separator = identity?.indexOf(':') ?? -1;
  return separator > 0 ? safe(identity!.slice(0, separator)) : null;
}

/**
 * The clocks of a span's insert whose identities read through `range`: a copy's characters
 * that copy clocks in it, or all of a follow span whose anchor is in it. Null when none do.
 */
function dependentRange(span: Span, range: ClockRange): ClockRange | null {
  if (span.origin) {
    const from = Math.max(range.from, span.origin.clock);
    const to = Math.min(range.to, span.origin.clock + span.length);
    if (from >= to) return null;
    const shift = span.firstClock - span.origin.clock;
    return { client: span.client, from: from + shift, to: to + shift };
  }
  const identity = span.follow!.identity;
  const clock = safe(identity.slice(identity.indexOf(':') + 1));
  if (clock === null || clock < range.from || clock >= range.to) return null;
  return { client: span.client, from: span.firstClock, to: span.firstClock + span.length };
}

const marksByDoc = new WeakMap<Y.Doc, TextMarks>();

/**
 * The marks of a document. The index reads each changed key before any observer of the
 * transaction runs, so an observer that reads identities never sees a stale mark.
 */
export function textMarksOf(doc: Y.Doc): TextMarks {
  let marks = marksByDoc.get(doc);
  if (marks) return marks;
  const map = doc.getMap<string>(TEXT_MARKS_KEY);
  const created = new TextMarks(doc, map);
  doc.on('beforeObserverCalls', (transaction: Y.Transaction) => {
    const keys = changedKeysOf(transaction, map);
    if (keys) created.refreshKeys(keys);
  });
  marksByDoc.set(doc, created);
  marks = created;
  return marks;
}

/** The marks a text's identities read: its document's, or none. */
export function marksOfText(text: Y.Text): MarkLookup {
  return text.doc ? textMarksOf(text.doc) : NO_MARKS;
}
