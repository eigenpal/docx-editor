/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Writing a routed local edit into paragraphs' shared texts.
 *
 * A paragraph's shared text can hold positions its view hides: a moved copy another
 * paragraph shows, or a character behind a copy of it. The diff runs over shown tokens only,
 * and each change is written at its token's position in the shared text, from the end back,
 * so a hidden position keeps its place between two shown ones.
 */
import * as Y from 'yjs';
import {
  deleteContent,
  deleteItem,
  deleteItemIds,
  deletePositions,
  embedItemAt,
  insertAndFind,
  itemIdsAt,
  positionOfItem,
  type ItemId,
} from './yjs-items.ts';
import { textMarksOf } from './paragraph-text-marks.ts';
import { textDeletionsOf, type DeletedRun } from './paragraph-text-deletions.ts';
import { asLogicalId, isNextClock, parseClientClock, type LogicalId } from './identity.ts';
import { rejectDangerousKey } from './limits.ts';
import type { DocumentRegistry } from './registry.ts';
import {
  attributeChanges,
  diffTokens,
  tokensOfParagraph,
  tokensOfText,
  type Step,
  type Token,
} from './paragraph-text-diff.ts';
import {
  attributeSignature,
  decodeAttributes,
  encodeAttributes,
  type InlineAttributes,
} from './paragraph-text.ts';
import {
  insertCopy,
  markMoves,
  ORIGIN_KEY,
  STAY,
  type ParagraphWrite,
} from './paragraph-text-moves.ts';
import {
  isCopyAt,
  textIdentities,
  typedAfterMoved,
  type TextIdentities,
} from './paragraph-text-identity.ts';
import { writeInlineText } from './paragraph-text-view.ts';
import { positionsNow, type FollowingText } from './paragraph-text-follow.ts';
import { placeFollowingText } from './paragraph-text-placement.ts';
import type { InlinePlan } from './paragraph-text-writer.ts';

interface Block {
  /** Equal tokens, or a run of deletions and insertions. */
  readonly kind: 'eq' | 'change';
  readonly steps: Step[];
  /** The shared text position after the last equal token before this block, or 0. */
  readonly after: number;
}

function blocksOf(before: readonly Token[], steps: readonly Step[]): Block[] {
  const blocks: Block[] = [];
  let after = 0;
  for (const step of steps) {
    const kind = step.op === 'eq' ? 'eq' : 'change';
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind) last.steps.push(step);
    else blocks.push({ kind, steps: [step], after });
    if (step.op === 'eq') after = before[step.before]!.position! + 1;
  }
  return blocks;
}

/** Group consecutive values with one key. */
function groups<T>(items: readonly T[], key: (item: T) => string): T[][] {
  const out: T[][] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && key(last[last.length - 1]!) === key(item)) last.push(item);
    else out.push([item]);
  }
  return out;
}

/**
 * The follow attribute for text typed at `position`: the copy right before it, or at the
 * start of the text the copy right after it. Null when no copy is next to it.
 */
function followAnchorAt(identities: TextIdentities | null, position: number): string | null {
  if (!identities) return null;
  if (position > 0) {
    const left = identities.ids[position - 1];
    return left && isCopyAt(identities, position - 1) ? left : null;
  }
  const right = identities.ids[0];
  return right && isCopyAt(identities, 0) ? `^${right}` : null;
}

/**
 * Insert typed text. Yjs places text typed after a deletion behind the deleted characters,
 * where text typed before a peer's move of them would also be. When a copy of one of them
 * shows, the text names the character it was typed after, so it stays.
 */
function insertTyped(
  text: Y.Text,
  position: number,
  value: string,
  attributes: Readonly<Record<string, string>>,
  identities: TextIdentities | null,
  hasShownCopy: (identity: string) => boolean
): void {
  const item = insertAndFind(text, position, value, attributes);
  if (!identities || !item || !typedAfterMoved(text, item, hasShownCopy)) return;
  textMarksOf(text.doc!).markFollow(
    item.id.client,
    item.id.clock,
    value.length,
    typedAnchor(identities, position)
  );
}

/**
 * What text typed at `position` names as the character it was typed after: the one before
 * it, or at the start the one after it. A paragraph that shows no character gives nothing to
 * name, so the text stays where it is.
 */
function typedAnchor(identities: TextIdentities, position: number): string {
  if (position > 0) return identities.ids[position - 1] ?? STAY;
  return identities.ids[0] ? `^${identities.ids[0]}` : STAY;
}

/**
 * Insert an embed, as a tab or a picture, and mark it as typed text is marked: it follows a
 * move of the character it was placed after, so it names that character too. Yjs places an
 * insert at a paragraph's end behind text a split moved away, and an unmarked tab typed there
 * followed that text into the next paragraph.
 */
function insertEmbedMarked(
  text: Y.Text,
  position: number,
  embed: object,
  attributes: Readonly<Record<string, string>>,
  follow: string | null,
  typed: {
    readonly identities: TextIdentities;
    readonly hasShownCopy: (id: string) => boolean;
  } | null
): void {
  const item = insertAndFind(text, position, embed, attributes);
  if (!item) return;
  const anchor =
    follow ??
    (typed && typedAfterMoved(text, item, typed.hasShownCopy)
      ? typedAnchor(typed.identities, position)
      : null);
  if (anchor) textMarksOf(text.doc!).markFollow(item.id.client, item.id.clock, 1, anchor);
}

/** Insert text that follows `anchor` wherever its anchor shows, and mark it so. */
function insertFollowing(
  text: Y.Text,
  position: number,
  value: string,
  attributes: Readonly<Record<string, string>>,
  anchor: string
): void {
  const item = insertAndFind(text, position, value, attributes);
  if (item) textMarksOf(text.doc!).markFollow(item.id.client, item.id.clock, value.length, anchor);
}

/** How one attributes object changes into another, and what it changes from. */
interface AttributeChange {
  readonly changes: Record<string, string | null>;
  /** `changes` as a string, to compare two changes. */
  readonly key: string;
  /** The signature of the attributes it changes from. */
  readonly from: string;
}

/** Write `after` into a paragraph's shared text by the edit script `steps` from `before`. */
function writeParagraphText(
  text: Y.Text,
  before: readonly Token[],
  after: readonly Token[],
  steps: readonly Step[],
  identities: TextIdentities | null,
  hasShownCopy: (identity: string) => boolean
): void {
  const blocks = blocksOf(before, steps);
  // The characters of one run share one attributes object on each side, so a comparison per
  // pair of objects, not per character, keeps a keystroke in a long paragraph cheap.
  const compared = new Map<InlineAttributes, Map<InlineAttributes, AttributeChange | null>>();
  const changeOf = (from: InlineAttributes, to: InlineAttributes): AttributeChange | null => {
    let row = compared.get(from);
    if (!row) compared.set(from, (row = new Map()));
    let change = row.get(to);
    if (change === undefined) {
      const changes = attributeChanges(from, to);
      change = changes && {
        changes,
        key: JSON.stringify(changes),
        from: attributeSignature(from),
      };
      row.set(to, change);
    }
    return change;
  };
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]!;
    if (block.kind === 'eq') {
      // Reformat runs of positions that are adjacent and change alike, from the end back.
      const changed: (AttributeChange & { readonly position: number })[] = [];
      for (const step of block.steps as Extract<Step, { op: 'eq' }>[]) {
        const change = changeOf(before[step.before]!.attributes, after[step.after]!.attributes);
        if (change) changed.push({ ...change, position: before[step.before]!.position! });
      }
      const runs: (typeof changed)[] = [];
      for (const entry of changed) {
        const last = runs[runs.length - 1];
        const tail = last?.[last.length - 1];
        if (
          tail &&
          tail.position + 1 === entry.position &&
          tail.from === entry.from &&
          tail.key === entry.key
        ) {
          last!.push(entry);
        } else {
          runs.push([entry]);
        }
      }
      for (let at = runs.length - 1; at >= 0; at -= 1) {
        const run = runs[at]!;
        text.format(run[0]!.position, run.length, run[0]!.changes!);
      }
      continue;
    }
    // Insert first, then delete: a replacement stands where the text it replaces stood.
    const deleted = block.steps
      .filter((step): step is Extract<Step, { op: 'del' }> => step.op === 'del')
      .map((step) => before[step.before]!.position!);
    const inserted = block.steps
      .filter((step): step is Extract<Step, { op: 'ins' }> => step.op === 'ins')
      .map((step) => after[step.after]!);
    let position = deleted.length > 0 ? deleted[0]! : block.after;
    // Typing next to a copy names it, in case an undo of the move takes the copy's markers.
    let follow = followAnchorAt(identities, position);
    // Characters with equal attributes are one insert; each embed is its own.
    let embeds = 0;
    for (const group of groups(inserted, (token) =>
      typeof token.insert === 'string' ? `c${attributeSignature(token.attributes)}` : `e${embeds++}`
    )) {
      const first = group[0]!;
      if (typeof first.insert !== 'string') {
        const typed =
          identities && position === (deleted.length > 0 ? deleted[0]! : block.after)
            ? { identities, hasShownCopy }
            : null;
        insertEmbedMarked(text, position, first.insert, first.attributes, follow, typed);
        follow = null;
        position += 1;
        continue;
      }
      const value = group.map((token) => token.insert as string).join('');
      // A moved copy names the identity of the first character it copies.
      const source = first.attributes[ORIGIN_KEY];
      if (source) insertCopy(text, position, value, first.attributes, source);
      else if (follow) insertFollowing(text, position, value, first.attributes, follow);
      else if (position === (deleted.length > 0 ? deleted[0]! : block.after)) {
        insertTyped(text, position, value, first.attributes, identities, hasShownCopy);
      } else text.insert(position, value, { ...first.attributes });
      follow = null;
      position += value.length;
    }
    const shift = position - (deleted.length > 0 ? deleted[0]! : block.after);
    for (let at = deleted.length - 1; at >= 0; ) {
      let start = at;
      while (start > 0 && deleted[start - 1]! + 1 === deleted[start]!) start -= 1;
      deleteContent(text, deleted[start]! + shift, at - start + 1);
      at = start - 1;
    }
  }
}

/**
 * Write the text that follows a move into a planned paragraph as its own: a copy marked with
 * the identities of the characters it copies, so they hide where they were typed. A deleted
 * paragraph that held them deletes them. Returns the paragraphs the text came from.
 */
function adoptFollowingText(
  registry: DocumentRegistry,
  paragraphId: LogicalId,
  text: Y.Text
): readonly LogicalId[] {
  const view = registry.inline.viewOf(paragraphId);
  const shown = view.shown(text);
  if (shown.incoming.length === 0) return [];
  const { ids } = shown.identities;
  // Written where the view shows it, so the write that follows reads the paragraph in the
  // order the editor showed it.
  const placement = placeFollowingText(shown);
  const orderOf = new Map(shown.incoming.map((following, order) => [following, order]));
  interface Placed {
    readonly following: FollowingText;
    readonly order: number;
    /** The character it goes before or after, or for a piece at the end, the text length. */
    readonly at: number;
    readonly atEnd?: true;
  }
  const placed: Placed[] = [];
  for (const [at, slot] of placement.atPosition) {
    for (const following of [...slot.before, ...slot.after]) {
      placed.push({ following, order: orderOf.get(following)!, at });
    }
  }
  for (const following of placement.atEnd) {
    placed.push({ following, order: orderOf.get(following)!, at: ids.length, atEnd: true });
  }
  // From the end back; at one character, the text after it before the text before it, and
  // of two pieces on one side, the later first: each goes in at the same place, so the
  // pieces keep the order they show in. Pieces at the end show in order, on either side.
  const byPlace = (left: Placed, right: Placed): number =>
    right.at - left.at ||
    (left.atEnd ? 0 : Number(left.following.before)) -
      (right.atEnd ? 0 : Number(right.following.before)) ||
    right.order - left.order;
  placed.sort(byPlace);
  /** For each source, the identities of the characters it passed on. */
  const deletions = new Map<LogicalId, string[]>();
  /**
   * Sources whose text this adoption changed. Their cached identities name the positions
   * before the change, and a write of one in the same plan read stale hidden positions.
   */
  const changedSources = new Set<LogicalId>();
  // Embeds this paragraph passed on to itself, by where they stood: each one deleted before a
  // place moves that place back by one.
  const movedOut: number[] = [];
  const now = (at: number): number => at - movedOut.filter((removed) => removed < at).length;
  // Many pieces can follow out of one source. Its text is read once, and again only after
  // this adoption changed it: an embed moved out, or copies written into this paragraph.
  type Delta = readonly { insert: unknown; attributes?: Record<string, unknown> }[];
  const reads = new Map<
    LogicalId,
    { readonly identities: TextIdentities; readonly delta: Delta }
  >();
  const readOf = (id: LogicalId, source: Y.Text) => {
    let read = reads.get(id);
    if (!read) {
      read = { identities: textIdentities(source), delta: source.toDelta() as Delta };
      reads.set(id, read);
    }
    return read;
  };
  /** What writing one piece did: where each source position it copied now stands. */
  interface Written {
    /** The piece's source positions, index for index with its `positions` when it was read. */
    readonly positions: readonly number[];
    readonly landed: ReadonlyMap<number, number>;
  }
  /** Write one piece at `start`. */
  const adoptPiece = (following: FollowingText, start: number): Written => {
    const landed = new Map<number, number>();
    const source = registry.inline.textOf(following.source);
    if (!source) return { positions: [], landed };
    const { identities: read, delta } = readOf(following.source, source);
    const positions = positionsNow(following, read);
    const identities = read.ids;
    const wanted = new Set(positions);
    // Characters are copied, so they keep showing in a live source if the copy goes. An embed
    // names one record and can stand in one place only, so it moves.
    type Piece =
      | {
          readonly kind: 'char';
          readonly value: string;
          readonly attributes: Record<string, string>;
          readonly identity: string | null;
          readonly position: number;
        }
      | {
          readonly kind: 'embed';
          readonly embed: object;
          readonly attributes: Record<string, string>;
          readonly item: Y.Item;
          readonly position: number;
        };
    const pieces: Piece[] = [];
    let position = 0;
    for (const op of delta) {
      const length = typeof op.insert === 'string' ? op.insert.length : 1;
      let encoded: Record<string, string> | null = null;
      const attributesOf = (): Record<string, string> =>
        (encoded ??= encodeAttributes(
          decodeAttributes(op.attributes, registry.limits, following.source),
          paragraphId
        ));
      if (typeof op.insert === 'string') {
        for (let offset = 0; offset < length; offset += 1) {
          if (!wanted.has(position + offset)) continue;
          pieces.push({
            kind: 'char',
            value: op.insert[offset]!,
            attributes: { ...attributesOf() },
            identity: identities[position + offset] ?? null,
            position: position + offset,
          });
        }
      } else if (wanted.has(position) && op.insert !== null && typeof op.insert === 'object') {
        const item = embedItemAt(source, position);
        if (item) {
          pieces.push({
            kind: 'embed',
            embed: op.insert,
            attributes: { ...attributesOf() },
            item,
            position,
          });
        }
      }
      position += length;
    }
    // One copy per run of consecutive identities with equal attributes: a copy's characters
    // take their identities from their offsets in its one insert.
    const runs: Piece[][] = [];
    for (const piece of pieces) {
      const run = runs[runs.length - 1];
      const previous = run?.[run.length - 1];
      const continues =
        piece.kind === 'char' &&
        previous?.kind === 'char' &&
        attributeSignature(previous.attributes) === attributeSignature(piece.attributes) &&
        isNextClock(previous.identity, piece.identity);
      if (continues) run!.push(piece);
      else runs.push([piece]);
    }
    let insertAt = start;
    for (const run of runs) {
      const first = run[0]!;
      if (first.kind === 'embed') {
        // Deleted first: a moved embed in the same text must never stand twice.
        const from = source === text ? positionOfItem(text, first.item) : null;
        deleteItem(source, first.item);
        reads.delete(following.source);
        changedSources.add(following.source);
        if (from !== null) {
          // Inserts go in from the end back, so a place this one passed on is still the same.
          movedOut.push(from);
          if (from < insertAt) insertAt -= 1;
        }
        text.insertEmbed(insertAt, first.embed, { ...first.attributes });
        landed.set(first.position, insertAt);
        insertAt += 1;
        continue;
      }
      const value = run.map((piece) => (piece.kind === 'char' ? piece.value : '')).join('');
      if (first.identity) insertCopy(text, insertAt, value, first.attributes, first.identity);
      else text.insert(insertAt, value, first.attributes);
      run.forEach((piece, offset) => landed.set(piece.position, insertAt + offset));
      insertAt += value.length;
    }
    // This paragraph's text changed; a later piece can follow out of it too.
    reads.delete(paragraphId);
    const copied = pieces.flatMap((piece) =>
      piece.kind === 'char' && piece.identity ? [piece.identity] : []
    );
    deletions.set(following.source, [...(deletions.get(following.source) ?? []), ...copied]);
    return { positions, landed };
  };
  /** Pieces whose character inside another piece the write did not copy. */
  const unplaced: FollowingText[] = [];
  /** Write the pieces placed inside `parent`, at the copies of their characters. */
  const adoptInside = (parent: FollowingText, written: Written): void => {
    const slots = placement.inside.get(parent);
    if (!slots) return;
    const kids: Placed[] = [];
    for (const [index, slot] of slots) {
      const position = written.positions[index];
      const at = position === undefined ? undefined : written.landed.get(position);
      for (const following of [...slot.before, ...slot.after]) {
        if (at === undefined) unplaced.push(following);
        else kids.push({ following, order: orderOf.get(following)!, at });
      }
    }
    kids.sort(byPlace);
    for (const kid of kids) {
      const start = kid.following.before ? kid.at : kid.at + 1;
      adoptInside(kid.following, adoptPiece(kid.following, start));
    }
  };
  for (const root of placed) {
    const start = root.atEnd ? root.at : root.following.before ? root.at : root.at + 1;
    adoptInside(root.following, adoptPiece(root.following, now(start)));
  }
  // Still written, at the end: lost, the write would have typed it again without its identity.
  for (const following of unplaced) {
    adoptInside(following, adoptPiece(following, text.length));
  }
  for (const [source, copied] of deletions) {
    const sourceText = registry.inline.textOf(source);
    if (!sourceText) continue;
    // A live source keeps its characters: the copy hides them, and they show again if a peer
    // deletes the paragraph that holds the copy meanwhile. Deleting them lost the text then.
    // Found by identity: a moved embed and the copies this write made shift positions. Text
    // that followed within this paragraph is kept as a live source's is: by identity, the
    // deletion also found the copies this write made.
    if (source !== paragraphId && registry.inline.isDeletedParagraph(source)) {
      const gone = new Set(copied);
      const sourceIds = textIdentities(sourceText).ids;
      deletePositions(
        sourceText,
        sourceIds.flatMap((id, position) => (id && gone.has(id) ? [position] : []))
      );
      changedSources.add(source);
    }
  }
  for (const source of changedSources) registry.inline.follow.invalidate(source);
  registry.inline.follow.invalidate(paragraphId);
  registry.inline.noteDrift();
  return [...deletions.keys()];
}

/** What a write deletes from where its paragraph showed it, by identity. */
function deletedIdentities(write: ParagraphWrite<Token>): Set<string> {
  const gone = new Set<string>();
  for (const step of write.steps) {
    if (step.op !== 'del') continue;
    const position = write.before[step.before]!.position;
    const identity = position === undefined ? null : write.identities[position];
    if (identity) gone.add(identity);
  }
  return gone;
}

/**
 * The hidden copies, in the plan's own paragraphs, of what the plan deletes. A paragraph can
 * hold a character twice, as when two peers join the same paragraphs at once, and show it
 * once: deleting the shown one would let the hidden one show in its place. Taken by item ID
 * before the writes, which shift positions; text a write moves gets new items and stays.
 */
function hiddenCopiesInPlan<
  Write extends ParagraphWrite<Token> & {
    readonly text: Y.Text | null;
    readonly hidden: ReadonlySet<number>;
    readonly shownIdentities: TextIdentities | null;
  },
>(writes: readonly Write[]): HiddenCopies<Write>[] {
  const gone = new Set<string>();
  for (const write of writes) for (const identity of deletedIdentities(write)) gone.add(identity);
  if (gone.size === 0) return [];
  const copies: HiddenCopies<Write>[] = [];
  for (const write of writes) {
    if (!write.text || write.hidden.size === 0) continue;
    const positions = [...write.hidden].filter((position) => {
      const identity = write.identities[position];
      return identity !== null && identity !== undefined && gone.has(identity);
    });
    if (positions.length === 0) continue;
    const shown = write.shownIdentities;
    copies.push({
      write,
      ids: itemIdsAt(write.text, positions),
      originals: positions.map((position) =>
        shown && !shown.moved[position] && !shown.restored[position]
          ? (write.identities[position] ?? null)
          : null
      ),
    });
  }
  return copies;
}

/**
 * Hidden places of deleted characters in one planned paragraph, by item ID, and for each the
 * identity it holds in its first place, or null for a copy.
 */
interface HiddenCopies<Write> {
  readonly write: Write;
  readonly ids: readonly ItemId[];
  readonly originals: readonly (string | null)[];
}

/**
 * Whether a held place of a deleted character goes. Every copy does: of two copies, the later
 * in document order shows. A character in its first place stays when the same edit copies it
 * again, because it hides behind that copy wherever the copy is, and a replica that receives
 * the deletion before the update the copy depends on would otherwise show neither.
 */
function goes(original: string | null, copied: ReadonlySet<string>): boolean {
  return original === null || !copied.has(original);
}

/**
 * Delete, in paragraphs outside the plan, the characters a planned paragraph showed and no
 * longer shows: hidden copies would otherwise show in their place.
 */
function deleteHiddenCopies(
  registry: DocumentRegistry,
  writes: readonly (ParagraphWrite<Token> & { readonly id: LogicalId })[],
  copied: ReadonlySet<string>
): void {
  const gone = new Set<string>();
  const planned = new Set<LogicalId>(writes.map((write) => write.id));
  for (const write of writes) for (const identity of deletedIdentities(write)) gone.add(identity);
  if (gone.size === 0) return;
  const holders = new Set<LogicalId>();
  for (const identity of gone) {
    for (const holder of registry.inline.follow.holdersOf(identity)) {
      if (!planned.has(holder)) holders.add(holder);
    }
  }
  for (const holder of holders) {
    const text = registry.inline.textOf(holder);
    if (!text) continue;
    // A character shows once, so every other place it is held is hidden.
    const identities = textIdentities(text);
    const doomed = identities.ids.flatMap((identity, position) => {
      if (!identity || !gone.has(identity)) return [];
      const copy = isCopyAt(identities, position);
      return goes(copy ? null : identity, copied) ? [position] : [];
    });
    if (doomed.length === 0) continue;
    deletePositions(text, doomed);
    registry.inline.follow.invalidate(holder);
    registry.inline.noteDrift();
  }
}

/**
 * Delete the hidden copies of what deleted paragraphs showed. A paragraph deleted whole keeps
 * its own text, for an undo, but a copy another paragraph holds would show in its place.
 * Runs inside the journal's transaction, while the index still describes the state before it.
 */
export function deleteCopiesOfRemoved(
  registry: DocumentRegistry,
  removed: readonly LogicalId[]
): {
  readonly held: HeldOriginals;
  readonly shown: ReadonlyMap<LogicalId, readonly string[]>;
  readonly embeds: ReadonlySet<string>;
} {
  const gone = new Set<string>();
  /** What each removed paragraph showed, for its deletion record. */
  const shownBy = new Map<LogicalId, string[]>();
  /** The records removed paragraphs embedded and showed: they go with the paragraph. */
  const embeds = new Set<string>();
  for (const id of removed) {
    const text = registry.inline.textOf(id);
    if (!text || !registry.isTombstoned(id)) continue;
    const shown = registry.inline.viewOf(id).shown(text);
    let position = 0;
    for (const op of text.toDelta() as { insert: unknown }[]) {
      if (typeof op.insert === 'string') {
        position += op.insert.length;
        continue;
      }
      const node = (op.insert as { n?: unknown } | null)?.n;
      if (typeof node === 'string' && !shown.hidden.has(position)) embeds.add(node);
      position += 1;
    }
    const showing: string[] = [];
    shown.identities.ids.forEach((identity, position) => {
      if (!identity || shown.hidden.has(position)) return;
      showing.push(identity);
      if (isCopyAt(shown.identities, position)) {
        gone.add(identity);
      }
    });
    // Text that followed a move into it showed there too, and goes with it.
    for (const following of shown.incoming) {
      for (const identity of following.identities) if (identity) showing.push(identity);
    }
    if (showing.length > 0) shownBy.set(id, showing);
  }
  const held: { holder: LogicalId; text: Y.Text; items: ItemId[]; identities: string[] }[] = [];
  if (gone.size === 0) return { held, shown: shownBy, embeds };
  const removedSet = new Set(removed);
  const holders = new Set<LogicalId>();
  for (const identity of gone) {
    for (const holder of registry.inline.follow.holdersOf(identity)) {
      if (!removedSet.has(holder)) holders.add(holder);
    }
  }
  for (const holder of holders) {
    const text = registry.inline.textOf(holder);
    if (!text) continue;
    const identities = textIdentities(text);
    // A copy goes now: of two copies, the later in document order shows. A character in its
    // first place waits for the writes (`deleteHeldOriginals`).
    const copies: number[] = [];
    const originals: number[] = [];
    identities.ids.forEach((identity, position) => {
      if (!identity || !gone.has(identity)) return;
      if (isCopyAt(identities, position)) copies.push(position);
      else originals.push(position);
    });
    if (originals.length > 0) {
      held.push({
        holder,
        text,
        items: itemIdsAt(text, originals),
        identities: originals.map((position) => identities.ids[position]!),
      });
    }
    if (copies.length === 0) continue;
    deletePositions(text, copies);
    registry.inline.follow.invalidate(holder);
    registry.inline.noteDrift();
  }
  return { held, shown: shownBy, embeds };
}

/**
 * Delete the records removed paragraphs embedded, as a drawing with a text box, unless the
 * edit embedded them again elsewhere, as a join does, or another paragraph holds them. A peer
 * who moved one at the same time, as Enter does, then shows nothing of it; an undo of the
 * removal puts the records back with the paragraph.
 */
export function deleteEmbedsOfRemoved(
  registry: DocumentRegistry,
  embeds: ReadonlySet<string>,
  removed: readonly LogicalId[],
  written: InlineWritten
): void {
  const removedSet = new Set<string>(removed);
  for (const node of embeds) {
    if (written.embedded.has(node) || rejectDangerousKey(node)) continue;
    const id = asLogicalId(node);
    if ([...registry.inline.holdersOf(id)].some((holder) => !removedSet.has(holder))) continue;
    if (!registry.hasNode(id) || registry.isTombstoned(id)) continue;
    if (registry.listingParents(id).length === 0) registry.tombstone(id);
  }
}

/**
 * Record what an edit deleted and did not copy elsewhere (`paragraph-text-deletions.ts`): the
 * characters its writes deleted, and the text each paragraph it removed showed.
 */
export function recordDeletions(
  registry: DocumentRegistry,
  written: InlineWritten,
  removedShown: ReadonlyMap<LogicalId, readonly string[]>
): void {
  const deleted = new Set(written.deleted);
  for (const identities of removedShown.values()) for (const id of identities) deleted.add(id);
  const runs = runsOf([...deleted].filter((id) => !written.copied.has(id)));
  if (runs.length > 0) textDeletionsOf(registry.doc).record(runs);
}

/** Identities as runs of consecutive clocks, sorted by client and clock. */
function runsOf(identities: readonly string[]): DeletedRun[] {
  const parsed = identities
    .flatMap((identity) => parseClientClock(identity) ?? [])
    .sort((left, right) => left.client - right.client || left.clock - right.clock);
  const runs: { client: number; from: number; to: number }[] = [];
  for (const { client, clock } of parsed) {
    const last = runs[runs.length - 1];
    if (last && last.client === client && clock <= last.to) {
      last.to = Math.max(last.to, clock + 1);
    } else {
      runs.push({ client, from: clock, to: clock + 1 });
    }
  }
  return runs;
}

/** What one plan's writes did: the identities they copied and deleted, the records they embed. */
export interface InlineWritten {
  readonly copied: ReadonlySet<string>;
  readonly deleted: ReadonlySet<string>;
  readonly embedded: ReadonlySet<string>;
}

/**
 * Characters in their first place that a deleted paragraph's copies hid, kept until the
 * writes of the same edit show whether those writes copy them again.
 */
export type HeldOriginals = readonly {
  readonly holder: LogicalId;
  readonly text: Y.Text;
  readonly items: readonly ItemId[];
  readonly identities: readonly string[];
}[];

/**
 * Delete the held originals that the edit's writes did not copy. An original hides behind a
 * copy of it wherever the copy is, so one the writes copied again can stay. Deleting it
 * anyway showed nothing on a replica that receives this edit before the update its copy
 * depends on: Yjs applies the deletion at once and holds the copy back, so a participant's
 * own typing vanished there until the missing update arrived.
 */
export function deleteHeldOriginals(
  registry: DocumentRegistry,
  held: HeldOriginals,
  copied: ReadonlySet<string>
): void {
  for (const { holder, text, items, identities } of held) {
    const doomed = items.filter((_, at) => goes(identities[at]!, copied));
    if (doomed.length === 0) continue;
    deleteItemIds(text, doomed);
    registry.inline.follow.invalidate(holder);
    registry.inline.noteDrift();
  }
}

/** Write a plan's paragraphs. Runs inside the journal's Yjs transaction, after its records. */
export function applyInlinePlan(
  registry: DocumentRegistry,
  plan: InlinePlan,
  /** Each plan paragraph's tokens, encoded before the write began. */
  encoded: ReadonlyMap<LogicalId, Token[]> = new Map()
): InlineWritten {
  const embedsAfter = new Set<string>();
  // Block children are records the record pipeline writes; the rest is shared text.
  const writes: (ParagraphWrite<Token> & {
    readonly id: LogicalId;
    readonly record: Y.Map<unknown>;
    readonly text: Y.Text | null;
    readonly shownIdentities: TextIdentities | null;
    readonly hidden: ReadonlySet<number>;
  })[] = [];
  // Following text becomes its target's own first. The plan read it where it was typed too,
  // so a deleted paragraph whose following text moved is not written from that stale read.
  // A live one's view never showed it, so its plan holds only its own edits. Text that follows
  // within its own paragraph stays there, and that paragraph is written: a join that deletes
  // it moves its text, and only its write names the text the join moves.
  const adopted = new Set<LogicalId>();
  for (const { id } of plan.paragraphs) {
    const text = registry.inline.textOf(id);
    if (!text) continue;
    for (const source of adoptFollowingText(registry, id, text)) {
      if (source !== id && registry.inline.isDeletedParagraph(source)) adopted.add(source);
    }
  }
  for (const { id, after } of plan.paragraphs) {
    const record = registry.schema.nodes.get(id);
    if (!record || adopted.has(id)) continue;
    const tokens = encoded.get(id) ?? tokensOfParagraph(after);
    for (const token of tokens) {
      if (typeof token.insert !== 'string' && 'n' in token.insert) embedsAfter.add(token.insert.n);
    }
    const text = registry.inline.textOf(id);
    const shown = text ? registry.inline.viewOf(id).shown(text) : null;
    const before = text ? tokensOfText(text, shown?.hidden) : [];
    writes.push({
      id,
      record,
      text,
      before,
      after: tokens,
      steps: diffTokens(before, tokens),
      identities: shown?.identities.ids ?? [],
      shownIdentities: shown?.identities ?? null,
      hidden: shown?.hidden ?? new Set(),
    });
  }
  const hiddenCopies = hiddenCopiesInPlan(writes);
  const copied = markMoves(
    writes,
    (token, origin) => ({ ...token, attributes: { ...token.attributes, [ORIGIN_KEY]: origin } }),
    (token) => {
      const { [ORIGIN_KEY]: _origin, ...rest } = token.attributes;
      return attributeSignature(rest);
    },
    (token, paragraph) =>
      decodeAttributes(token.attributes, registry.limits, writes[paragraph]!.id).text?.id ?? '',
    (paragraph) => storyRootOf(registry, writes[paragraph]!.id)
  );
  for (const write of writes) {
    const text = write.text ?? writeInlineText(write.record, []);
    writeParagraphText(
      text,
      write.before,
      write.after,
      write.steps,
      write.shownIdentities,
      // A copy in this paragraph counts too: a later split can move it, and the typed text
      // must stay where its author saw it, not follow the deleted character it sits behind.
      (identity) => registry.inline.follow.shownCopy(identity) !== null
    );
    registry.inline.follow.invalidate(write.id);
  }
  for (const { write, ids, originals } of hiddenCopies) {
    const doomed = ids.filter((_, at) => goes(originals[at]!, copied));
    if (!write.text || doomed.length === 0) continue;
    deleteItemIds(write.text, doomed);
    registry.inline.follow.invalidate(write.id);
    registry.inline.noteDrift();
  }
  deleteHiddenCopies(registry, writes, copied);
  // An embedded object no paragraph holds any more is deleted, as a removed child is.
  // The inline index updates when the transaction ends, so it still names the paragraphs this
  // plan rewrote; only another paragraph's text keeps an object alive.
  const rewritten = new Set<LogicalId>(plan.paragraphs.map((paragraph) => paragraph.id));
  for (const id of plan.embedsBefore) {
    if (embedsAfter.has(id)) continue;
    if ([...registry.inline.holdersOf(id)].some((holder) => !rewritten.has(holder))) continue;
    if (registry.hasNode(id) && !registry.isTombstoned(id)) {
      if (registry.listingParents(id).length === 0) registry.tombstone(id);
    }
  }
  const deleted = new Set<string>();
  for (const write of writes)
    for (const identity of deletedIdentities(write)) deleted.add(identity);
  return { copied, deleted, embedded: embedsAfter };
}

/**
 * The root of the story a node is in: the part root its parents lead to. Empty for a node
 * with no parent edge yet, which a paragraph this edit created has until the edit ends.
 */
function storyRootOf(registry: DocumentRegistry, id: LogicalId): string {
  if (registry.parentOf(id) === null) return '';
  let at: LogicalId = id;
  for (let depth = 0; depth < registry.limits.maxTreeDepth; depth += 1) {
    const parent = registry.parentOf(at);
    if (parent === null) return at;
    at = parent;
  }
  return at;
}
