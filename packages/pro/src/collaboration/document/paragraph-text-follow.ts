/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Which characters a paragraph shows, when moves have put one character in two places.
 *
 * Every replica reads the same shared state, so every replica decides alike:
 *
 * - A moved copy shows in the last paragraph in document order that holds a copy of its
 *   character, and only once there. Two peers that split one paragraph each make a copy:
 *   the later paragraph holds the text after both splits, so it keeps the text in order.
 *   A join that races a split of the joined paragraph leaves the split's tail where it was.
 * - A character in its first place hides behind a moved copy of it. An undo that puts back
 *   text a peer has meanwhile moved on puts back characters that already show elsewhere.
 * - Text a peer typed while another peer moved the text around it away follows the move: it
 *   shows after the copy of the character it was typed after. That is typing into a
 *   paragraph that a peer joins into the one before it, which leaves a deleted paragraph
 *   showing nothing, or typing in text that a peer's Enter moves into a new paragraph.
 */
import type * as Y from 'yjs';
import { parseClientClock, type LogicalId } from './identity.ts';
import { IdentityIndex, identityRuns, type IdentityRun } from './paragraph-identity-index.ts';
import {
  isCopyAt,
  textIdentities,
  type Identity,
  type TextIdentities,
} from './paragraph-text-identity.ts';
import type { FollowAnchor } from './paragraph-text-moves.ts';

const EMPTY: ReadonlySet<LogicalId> = new Set();

/** The identities of the copies one text holds: moved, or put back by an undo. */
function copiesIn(identities: TextIdentities): Set<Identity> {
  const copies = new Set<Identity>();
  identities.ids.forEach((id, position) => {
    if (id !== null && isCopyAt(identities, position)) {
      copies.add(id);
    }
  });
  return copies;
}

/**
 * The identities whose showing decides where a source's following text goes: its own
 * characters, which follow only while no copy of them shows, and the characters it was
 * typed after or copied after.
 */
function dependencyRuns(identities: TextIdentities): IdentityRun[] {
  const runs = identityRuns(identities).map((run) => ({ ...run, kind: 'original' as const }));
  const add = (identity: Identity): void => {
    const parsed = parseClientClock(identity);
    if (parsed)
      runs.push({
        client: parsed.client,
        start: parsed.clock,
        end: parsed.clock + 1,
        kind: 'original',
      });
  };
  for (const anchors of identities.anchors)
    for (const anchor of anchors ?? []) add(anchor.identity);
  for (const copied of identities.copiedAfter) for (const identity of copied ?? []) add(identity);
  return runs;
}

/** Text typed in a source with the anchors it can follow by. */
interface TypedOriginal {
  readonly source: LogicalId;
  readonly anchors: readonly FollowAnchor[];
}

/** Negative when paragraph `a` comes before paragraph `b` in the document. */
export type DocumentOrder = (a: LogicalId, b: LogicalId) => number;

/**
 * Characters of one paragraph's text, as the index last read them: their positions, and the
 * identities at those positions. A writer that changes the text earlier in its transaction,
 * as a join that first deletes what a removed paragraph's copies hid, moves the positions,
 * not the identities.
 */
export interface PlacedText {
  readonly positions: readonly number[];
  readonly identities: readonly (Identity | null)[];
  /** The Yjs item ID of each character (`TextIdentities.items`), which finds it again. */
  readonly items: readonly string[];
}

/**
 * Text of a deleted paragraph that follows a move: its positions, shown after the character
 * `after`, or before it when `before` is set.
 */
export interface FollowingText extends PlacedText {
  readonly source: LogicalId;
  readonly after: Identity;
  readonly before: boolean;
  /** Where it shows, when not where a copy of `after` shows: its original's paragraph. */
  readonly target?: LogicalId;
}

/**
 * Where placed text is in its paragraph now, index for index with its characters, without
 * those the text no longer holds. A write earlier in the same transaction can move them, and
 * a copy it wrote can carry the same identity as the character it copies, so each character
 * is found by its Yjs item ID, never by its position or identity.
 */
export function positionsNow(placed: PlacedText, current: Pick<TextIdentities, 'items'>): number[] {
  const unchanged = placed.positions.every(
    (position, at) => current.items[position] === placed.items[at]
  );
  if (unchanged) return [...placed.positions];
  const at = new Map<string, number>();
  current.items.forEach((item, position) => at.set(item, position));
  return placed.items.flatMap((item) => {
    const position = at.get(item);
    return position === undefined ? [] : [position];
  });
}

/**
 * Text that stands right after a hidden duplicate copy, moved to stand after the copy that
 * shows. Two peers who each write a paragraph's following text into it leave two copies; the
 * later one hides, and what only it holds, as typing one peer did there or a character the
 * other deleted from its copy, showed after all of the shown copy. Each run moved is hidden
 * where it is and becomes following text of the paragraph itself.
 */
function besideDuplicates(
  paragraphId: LogicalId,
  identities: TextIdentities,
  hidden: Set<number>,
  duplicates: ReadonlySet<number>
): FollowingText[] {
  if (duplicates.size === 0) return [];
  const { ids } = identities;
  const shownHere = new Set<Identity>();
  ids.forEach((id, position) => {
    if (id !== null && !hidden.has(position)) shownHere.add(id);
  });
  const moved: FollowingText[] = [];
  for (let position = 1; position < ids.length; position += 1) {
    const after = ids[position - 1];
    if (hidden.has(position) || !duplicates.has(position - 1) || !after || !shownHere.has(after)) {
      continue;
    }
    const positions: number[] = [];
    for (let at = position; at < ids.length && !hidden.has(at); at += 1) positions.push(at);
    moved.push({
      source: paragraphId,
      after,
      before: false,
      positions,
      identities: positions.map((at) => ids[at] ?? null),
      items: positions.map((at) => identities.items[at]!),
    });
    position += positions.length;
  }
  // Text typed in front of a copy, which then hid as a duplicate, stands in front of the copy
  // that shows. Only an item the writer anchored before that character moves, and only while
  // it stands right in front of the hidden copy, so no other text is taken along.
  const claimed = new Set<number>();
  for (const following of moved) for (const position of following.positions) claimed.add(position);
  for (let start = 0; start < ids.length; start += 1) {
    if (!identities.starts[start] || hidden.has(start) || claimed.has(start)) continue;
    const anchor = identities.anchors[start]?.find((candidate) => candidate.before);
    if (!anchor || !shownHere.has(anchor.identity)) continue;
    let end = start + 1;
    while (end < ids.length && !identities.starts[end] && !hidden.has(end)) end += 1;
    if (end >= ids.length || !duplicates.has(end) || ids[end] !== anchor.identity) continue;
    const positions: number[] = [];
    for (let at = start; at < end; at += 1) positions.push(at);
    for (const at of positions) claimed.add(at);
    moved.push({
      source: paragraphId,
      after: anchor.identity,
      before: true,
      positions,
      identities: positions.map((at) => ids[at] ?? null),
      items: positions.map((at) => identities.items[at]!),
    });
  }
  for (const following of moved) for (const position of following.positions) hidden.add(position);
  return moved;
}

/** What one paragraph shows of its own text, and what it shows of others'. */
export interface ShownText {
  readonly identities: TextIdentities;
  /** Positions of the paragraph's own text that do not show here. */
  readonly hidden: ReadonlySet<number>;
  /** Text from deleted paragraphs that shows in this one. */
  readonly incoming: readonly FollowingText[];
}

export class TextFollow {
  private readonly index = new IdentityIndex();
  /**
   * Paragraphs whose text can follow a move: deleted ones that still hold characters, and
   * live ones with text typed after characters that left them.
   */
  private readonly sources = new Set<LogicalId>();
  /** For each live source, the characters of its text that show in another paragraph. */
  private readonly outgoingOf = new Map<LogicalId, PlacedText>();
  /** For each paragraph, the deleted paragraphs whose following text it shows. */
  private readonly incomingOf = new Map<LogicalId, FollowingText[]>();
  private readonly targetsOf = new Map<LogicalId, Set<LogicalId>>();
  /** For each source, the identities its following text depends on (`dependencyRuns`). */
  private readonly dependencies = new IdentityIndex();
  /**
   * Sources to place again before the next read. Placing waits for a read, so a transaction
   * that changes many paragraphs places each source once, and a cold build places them all
   * once, at the end.
   */
  private readonly pending = new Set<LogicalId>();
  /** Sources whose own text changed: what their targets show changes with it. */
  private readonly ownChanges = new Set<LogicalId>();
  /** Sources whose placement read what other sources hold (`movedAfter`). */
  private readonly readsOtherSources = new Set<LogicalId>();
  /** `typedSources` as of the current relocation, or null before it is read. */
  private typedAnchored: Map<Identity, TypedOriginal[]> | null = null;
  /**
   * Identities as the last read left them. A read happens when a paragraph changes, and a
   * writer that changes a text inside a transaction drops its entry (`invalidate`).
   */
  private readonly identities = new Map<LogicalId, { text: Y.Text; identities: TextIdentities }>();

  constructor(
    private readonly textOf: (paragraphId: LogicalId) => Y.Text | null,
    private readonly isDeleted: (paragraphId: LogicalId) => boolean,
    private readonly order: DocumentOrder,
    /** Paragraphs whose view changed when waiting sources were placed. */
    private readonly viewsChanged: (paragraphs: ReadonlySet<LogicalId>) => void,
    /** The paragraph whose text holds the item of an identity, deleted or not. */
    private readonly originalParagraph: (identity: Identity) => LogicalId | null
  ) {}

  /** The paragraph of `paragraphs` that comes last in the document. */
  private lastOf(paragraphs: readonly LogicalId[]): LogicalId | null {
    let last: LogicalId | null = null;
    for (const id of paragraphs) if (last === null || this.order(id, last) > 0) last = id;
    return last;
  }

  /**
   * Read one paragraph's text again. Returns the other paragraphs whose view changed now;
   * placing following text again waits for the next read (`settle`).
   */
  paragraphChanged(paragraphId: LogicalId): Set<LogicalId> {
    const text = this.textOf(paragraphId);
    const deleted = this.isDeleted(paragraphId);
    this.identities.delete(paragraphId);
    const identities = text ? this.identitiesOf(paragraphId, text) : null;
    const { affected, changed } = this.index.update(
      paragraphId,
      identities && !deleted ? identityRuns(identities) : []
    );
    const wasSource = this.sources.has(paragraphId);
    const isSource = !!text && !!identities && (deleted ? text.length > 0 : identities.hasAnchors);
    if (isSource) this.sources.add(paragraphId);
    else this.sources.delete(paragraphId);
    // Following text depends on where characters show, so a source that reads a character
    // that came or went places its text again. A source's own change places its own, and a
    // change of its formatting changes what its targets show.
    for (const run of changed) {
      for (const entry of this.dependencies.overlapping(
        'original',
        run.client,
        run.start,
        run.end
      )) {
        this.pending.add(entry.paragraph);
      }
    }
    if (wasSource || isSource) {
      this.pending.add(paragraphId);
      this.ownChanges.add(paragraphId);
    }
    for (const target of this.targetsOf.get(paragraphId) ?? []) affected.add(target);
    affected.delete(paragraphId);
    return affected;
  }

  /** Place the following text of every waiting source, and report the views that changed. */
  settle(): void {
    if (this.pending.size === 0) return;
    for (const source of this.readsOtherSources)
      if (this.sources.has(source)) this.pending.add(source);
    this.readsOtherSources.clear();
    const sources = [...this.pending];
    const own = [...this.ownChanges];
    this.pending.clear();
    this.ownChanges.clear();
    const changed = this.relocate(sources);
    for (const source of own)
      for (const target of this.targetsOf.get(source) ?? []) changed.add(target);
    if (changed.size > 0) this.viewsChanged(changed);
  }

  /** What a paragraph shows, read from its text and the index. */
  shown(paragraphId: LogicalId, text: Y.Text): ShownText {
    this.settle();
    const identities = this.identitiesOf(paragraphId, text);
    const hidden = new Set<number>();
    const seen = new Set<Identity>();
    const duplicates = new Set<number>();
    const { clients, clocks } = identities;
    // A character in its first place hides behind a copy of it in this paragraph too: a join
    // can bring a copy into the paragraph that still holds what it copies.
    const ownCopies = copiesIn(identities);
    // Characters come in runs of consecutive identities. Most runs share no character with
    // a copy in another paragraph, so one lookup per run settles all of their characters.
    for (let start = 0; start < clients.length; ) {
      let end = start + 1;
      while (
        end < clients.length &&
        clients[end] === clients[start] &&
        clocks[end] === clocks[end - 1]! + 1 &&
        identities.moved[end] === identities.moved[start] &&
        identities.restored[end] === identities.restored[start]
      ) {
        end += 1;
      }
      const client = clients[start]!;
      const isCopy = isCopyAt(identities, start);
      if (client >= 0) {
        const others = (kind: 'move' | 'restore') =>
          this.index
            .overlapping(kind, client, clocks[start]!, clocks[end - 1]! + 1)
            .filter((entry) => entry.paragraph !== paragraphId);
        const moves = others('move');
        const restores = others('restore');
        if (moves.length > 0 || restores.length > 0 || isCopy) {
          for (let position = start; position < end; position += 1) {
            if (this.hides(identities, position, paragraphId, moves, restores, seen, duplicates)) {
              hidden.add(position);
            }
          }
        }
        if (!isCopy && ownCopies.size > 0) {
          for (let position = start; position < end; position += 1) {
            if (ownCopies.has(identities.ids[position]!)) hidden.add(position);
          }
        }
      }
      start = end;
    }
    const outgoing = this.outgoingOf.get(paragraphId);
    if (outgoing) for (const position of positionsNow(outgoing, identities)) hidden.add(position);
    identities.deleted.forEach((deleted, position) => {
      if (deleted) hidden.add(position);
    });
    const beside = besideDuplicates(paragraphId, identities, hidden, duplicates);
    const incoming = this.distinctIncoming(paragraphId, identities, hidden);
    return {
      identities,
      hidden,
      incoming: beside.length > 0 ? [...incoming, ...beside] : incoming,
    };
  }

  /**
   * The following text a paragraph shows, without characters it already shows. Copies of one
   * character in two deleted paragraphs, or a copy and its original, can follow to one place;
   * the paragraph's own text comes first, then the pieces in their one order on every replica.
   */
  private distinctIncoming(
    paragraphId: LogicalId,
    identities: TextIdentities,
    hidden: ReadonlySet<number>
  ): readonly FollowingText[] {
    const incoming = this.incomingOf.get(paragraphId) ?? [];
    if (incoming.length === 0) return incoming;
    const seen = new Set<Identity>();
    identities.ids.forEach((id, position) => {
      if (id !== null && !hidden.has(position)) seen.add(id);
    });
    const distinct: FollowingText[] = [];
    for (const following of incoming) {
      const kept = following.positions.flatMap((_, at) => {
        const id = following.identities[at] ?? null;
        if (id !== null && seen.has(id)) return [];
        if (id !== null) seen.add(id);
        return [at];
      });
      if (kept.length === following.positions.length) distinct.push(following);
      else if (kept.length > 0) {
        distinct.push({
          ...following,
          positions: kept.map((at) => following.positions[at]!),
          identities: kept.map((at) => following.identities[at] ?? null),
          items: kept.map((at) => following.items[at]!),
        });
      }
    }
    return distinct;
  }

  /**
   * Whether one position hides. Only other paragraphs decide: within one transaction the
   * index has not yet seen the copies this paragraph just received. A move outranks an
   * undo's copy, and either outranks a character in its first place.
   */
  private hides(
    identities: TextIdentities,
    position: number,
    paragraphId: LogicalId,
    moves: readonly {
      readonly run: { start: number; end: number };
      readonly paragraph: LogicalId;
    }[],
    restores: readonly {
      readonly run: { start: number; end: number };
      readonly paragraph: LogicalId;
    }[],
    seen: Set<Identity>,
    duplicates: Set<number>
  ): boolean {
    const clock = identities.clocks[position]!;
    const holding = (entries: typeof moves): LogicalId[] =>
      entries
        .filter((entry) => entry.run.start <= clock && clock < entry.run.end)
        .map((entry) => entry.paragraph);
    // Another holder shows the character when one comes after this paragraph.
    const later = (holders: readonly LogicalId[]): boolean =>
      holders.some((holder) => this.order(holder, paragraphId) > 0);
    const id = identities.ids[position]!;
    let hide = false;
    if (isCopyAt(identities, position) && seen.has(id)) {
      duplicates.add(position);
    }
    if (identities.moved[position]) hide = seen.has(id) || later(holding(moves));
    else if (identities.restored[position]) {
      hide = seen.has(id) || holding(moves).length > 0 || later(holding(restores));
    } else hide = holding(moves).length > 0 || holding(restores).length > 0;
    if (isCopyAt(identities, position)) seen.add(id);
    return hide;
  }

  /** Every paragraph that holds one character, moved or in its first place. */
  holdersOf(identity: Identity): LogicalId[] {
    const parsed = parseClientClock(identity);
    return parsed ? this.index.holders(parsed.client, parsed.clock) : [];
  }

  /** The paragraph that shows a copy of one character, or null when none holds a copy. */
  shownCopy(identity: Identity): LogicalId | null {
    const parsed = parseClientClock(identity);
    if (!parsed) return null;
    const { client, clock } = parsed;
    return (
      this.lastOf(this.index.holdersOf('move', client, clock)) ??
      this.lastOf(this.index.holdersOf('restore', client, clock))
    );
  }

  /**
   * Document order changed: which holder shows a copy, and where following text shows, can
   * change with it. Returns every paragraph whose view may have changed.
   */
  orderChanged(): Set<LogicalId> {
    const { paragraphs, runs } = this.index.contested();
    // Order decides only between two holders of one copy, so only a source that reads a
    // contested character can place its text elsewhere.
    for (const run of runs) {
      for (const entry of this.dependencies.overlapping(
        'original',
        run.client,
        run.start,
        run.end
      )) {
        this.pending.add(entry.paragraph);
      }
    }
    return paragraphs;
  }

  /** The paragraphs that show some of a source's following text. */
  targetsFor(source: LogicalId): ReadonlySet<LogicalId> {
    this.settle();
    return this.targetsOf.get(source) ?? EMPTY;
  }

  /** Forget a text's identities: a writer changed it inside a transaction. */
  invalidate(paragraphId: LogicalId): void {
    this.identities.delete(paragraphId);
  }

  private identitiesOf(paragraphId: LogicalId, text: Y.Text): TextIdentities {
    const cached = this.identities.get(paragraphId);
    if (cached?.text === text) return cached.identities;
    const identities = textIdentities(text);
    this.identities.set(paragraphId, { text, identities });
    return identities;
  }

  clear(): void {
    this.identities.clear();
    this.index.clear();
    this.sources.clear();
    this.outgoingOf.clear();
    this.incomingOf.clear();
    this.targetsOf.clear();
    this.dependencies.clear();
    this.pending.clear();
    this.ownChanges.clear();
  }

  /** Place the following text of `sources` again. Returns the targets whose view changed. */
  private relocate(sources: readonly LogicalId[]): Set<LogicalId> {
    this.typedAnchored = null;
    const touched = new Set<LogicalId>();
    for (const source of sources)
      for (const target of this.targetsOf.get(source) ?? []) touched.add(target);
    const before = new Map<LogicalId, string>();
    for (const target of touched)
      before.set(target, JSON.stringify(this.incomingOf.get(target) ?? []));
    // A source hides what it passes on, so a source whose outgoing text changes changes too.
    const outgoingBefore = new Map<LogicalId, string>();
    for (const source of sources) {
      outgoingBefore.set(source, JSON.stringify(this.outgoingOf.get(source)?.positions ?? []));
    }
    const moving = new Set(sources);
    for (const target of touched) {
      const kept = (this.incomingOf.get(target) ?? []).filter(
        (following) => !moving.has(following.source)
      );
      if (kept.length > 0) this.incomingOf.set(target, kept);
      else this.incomingOf.delete(target);
    }
    for (const source of sources) {
      this.targetsOf.delete(source);
      this.outgoingOf.delete(source);
      const text = this.sources.has(source) ? this.textOf(source) : null;
      const identities = text ? this.identitiesOf(source, text) : null;
      this.dependencies.update(source, identities ? dependencyRuns(identities) : []);
      if (!identities) continue;
      const outgoing = new Map<number, Identity | null>();
      for (const following of this.followingOf(source, identities)) {
        const target = following.target ?? this.shownCopy(following.after)!;
        const list = this.incomingOf.get(target) ?? [];
        list.push(following);
        this.incomingOf.set(target, list);
        const targets = this.targetsOf.get(source) ?? new Set();
        targets.add(target);
        this.targetsOf.set(source, targets);
        following.positions.forEach((position, at) => {
          outgoing.set(position, following.identities[at] ?? null);
        });
        if (!before.has(target)) before.set(target, '[]');
      }
      if (outgoing.size > 0 && !this.isDeleted(source)) {
        const positions = [...outgoing.keys()].sort((left, right) => left - right);
        this.outgoingOf.set(source, {
          positions,
          identities: positions.map((position) => outgoing.get(position) ?? null),
          items: positions.map((position) => identities.items[position]!),
        });
      }
    }
    // Text from several sources can follow one character. Every replica shows it in one
    // order, whatever order it relocated the sources in.
    for (const target of before.keys()) {
      this.incomingOf
        .get(target)
        ?.sort(
          (left, right) =>
            (left.source < right.source ? -1 : left.source > right.source ? 1 : 0) ||
            left.positions[0]! - right.positions[0]!
        );
    }
    const changed = new Set<LogicalId>();
    for (const [source, json] of outgoingBefore) {
      if (JSON.stringify(this.outgoingOf.get(source)?.positions ?? []) !== json) {
        changed.add(source);
      }
    }
    for (const [target, json] of before) {
      if (JSON.stringify(this.incomingOf.get(target) ?? []) !== json) changed.add(target);
    }
    return changed;
  }

  /**
   * The runs of a source's characters that follow a move: each starts with a character typed
   * after one whose copy shows in another paragraph, and takes the characters typed after it.
   */
  private followingOf(source: LogicalId, identities: TextIdentities): FollowingText[] {
    type Open = {
      source: LogicalId;
      after: Identity;
      before: boolean;
      target?: LogicalId;
      positions: number[];
      identities: (Identity | null)[];
      items: string[];
    };
    const out: Open[] = [];
    let open: Open | null = null;
    const ownCopies = copiesIn(identities);
    for (let position = 0; position < identities.ids.length; position += 1) {
      const id = identities.ids[position] ?? null;
      // A character that already has a shown copy shows there, not as following text, and an
      // original goes nowhere when this paragraph holds a copy of it, which follows instead.
      const isCopy = isCopyAt(identities, position);
      if (
        identities.deleted[position] ||
        (id !== null && (this.shownCopy(id) !== null || (!isCopy && ownCopies.has(id))))
      ) {
        open = null;
        continue;
      }
      // A split moves a suffix, so text after a character it moves always moves with it, but
      // text before that character stays where its author saw it. Text typed before a copy
      // follows it only out of a paragraph that is gone.
      const live = !this.isDeleted(source);
      // The rest of an item, and an item typed right after following text, come along.
      const continues: boolean =
        open !== null &&
        (!identities.starts[position] ||
          (position > 0 && identities.lefts[position] === identities.ids[position - 1]));
      const anchor: (FollowAnchor & { readonly target?: LogicalId }) | undefined =
        identities.anchors[position]?.find((candidate) => this.leadsOut(source, live, candidate)) ??
        (live || continues ? undefined : this.movedAfter(source, identities, position));
      if (anchor) {
        open = {
          source,
          after: anchor.identity,
          before: anchor.before,
          ...(anchor.target ? { target: anchor.target } : {}),
          positions: [position],
          identities: [id],
          items: [identities.items[position]!],
        };
        out.push(open);
        continue;
      }
      if (open && continues) {
        open.positions.push(position);
        open.identities.push(id);
        open.items.push(identities.items[position]!);
        continue;
      }
      open = null;
    }
    return out;
  }

  /**
   * For each identity typed with anchors in a source, the sources that hold it so: such text
   * follows by its own anchors. Built once per relocation.
   */
  private typedSources(): ReadonlyMap<Identity, readonly TypedOriginal[]> {
    if (this.typedAnchored) return this.typedAnchored;
    const typed = new Map<Identity, TypedOriginal[]>();
    for (const source of this.sources) {
      const text = this.textOf(source);
      if (!text) continue;
      const identities = this.identitiesOf(source, text);
      let anchors: readonly FollowAnchor[] | null = null;
      identities.ids.forEach((id, position) => {
        if (identities.starts[position]) anchors = identities.anchors[position] ?? null;
        const isCopy = isCopyAt(identities, position);
        if (!id || isCopy || !anchors) return;
        const holders = typed.get(id) ?? [];
        holders.push({ source, anchors });
        typed.set(id, holders);
      });
    }
    this.typedAnchored = typed;
    return typed;
  }

  /** Whether an original typed in `source` follows by one of its anchors, as `followingOf` reads them. */
  private follows(original: TypedOriginal): boolean {
    const live = !this.isDeleted(original.source);
    return original.anchors.some((anchor) => this.leadsOut(original.source, live, anchor));
  }

  /**
   * Whether text in `source` follows `anchor`: a copy of the anchor shows in another
   * paragraph. Text typed before a character follows it only out of a paragraph that is gone.
   */
  private leadsOut(source: LogicalId, live: boolean, anchor: FollowAnchor): boolean {
    if (anchor.before && live) return false;
    const target = this.shownCopy(anchor.identity);
    return target !== null && target !== source;
  }

  /**
   * In a deleted paragraph, moved text that no other paragraph holds follows the character it
   * went in after when a copy of that one shows elsewhere. Two peers join one paragraph at
   * once, one into the paragraph before it and one taking in the paragraph after it: the
   * second join's copies land in a paragraph the first deleted. Text the paragraph held from
   * the start never follows, so a paragraph deleted on purpose does not come back.
   */
  private movedAfter(
    source: LogicalId,
    identities: TextIdentities,
    position: number
  ): (FollowAnchor & { readonly target?: LogicalId }) | undefined {
    // Moved text another paragraph still holds, a copy or its original, shows there, and an
    // original typed in another source follows by its own anchors.
    const id = identities.ids[position];
    if (!id || this.holdersOf(id).length > 0) return undefined;
    // The original follows by its anchors only when one leads to a copy that shows; otherwise
    // this copy is the only place the text can show. What another source holds can change
    // this, so this source is placed again with every placement.
    this.readsOtherSources.add(source);
    const originals = this.typedSources().get(id) ?? [];
    if (originals.some((original) => original.source !== source && this.follows(original))) {
      return undefined;
    }
    for (const identity of identities.copiedAfter[position] ?? []) {
      const target = this.shownCopy(identity);
      if (target !== null && target !== source) return { identity, before: false };
    }
    // Last, a copy that would show nowhere goes back to where its original stood, when that
    // paragraph is live: every paragraph around it was deleted or undone. A paragraph's own
    // text, and text a participant deleted, never come back this way.
    if (!identities.moved[position]) return undefined;
    const original = this.originalParagraph(id);
    if (original === null || original === source || this.isDeleted(original)) return undefined;
    return { identity: id, before: false, target: original };
  }
}
