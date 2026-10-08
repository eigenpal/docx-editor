/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Which paragraph's shared text holds each inline ID. Derived, never replicated.
 *
 * Runs, text elements, run properties and wrappers live in a paragraph's shared text as
 * attributes, not as records, and an embedded node is listed by no child array. The registry
 * asks this index for their paragraph: to dirty it when they change, to answer `parentOf`,
 * and to route a local edit of them to that paragraph's text.
 *
 * Concurrent edits can leave one shell ID in several paragraphs: a peer types into a run
 * that another peer's split moved to a new paragraph. The ID shows bare in the first holder
 * by ID and tagged in the others, so every replica shows the same unique IDs.
 */
import { rejectDangerousKey } from './limits.ts';
import { fieldOf, holderItem, structAt } from './yjs-items.ts';
import * as Y from 'yjs';
import { asLogicalId, parseClientClock, type LogicalId } from './identity.ts';
import { keyId } from './registry-node-reads.ts';
import { isNodeMap } from './schema.ts';
import type { DocumentLimits } from './limits.ts';
import { decodeAttributes, INLINE_FIELD } from './paragraph-text.ts';
import { TextFollow, type DocumentOrder, type ShownText } from './paragraph-text-follow.ts';

/** How one paragraph shows what it shares with other paragraphs. */
export interface ParagraphView {
  /** The ID a shell shows here. */
  shownId(id: string): string;
  /** Which characters of the paragraph's text show, and what text of others shows here. */
  shown(text: Y.Text): ShownText;
  /** Another paragraph's shared text, for text that follows a move into this one. */
  textOf(paragraphId: LogicalId): Y.Text | null;
  /** Note that the view shows something the paragraph's text does not say. */
  noteDrift(): void;
  /** Whether an embedded node shows here: a node two texts embed shows in the first by ID. */
  showsEmbed(id: string): boolean;
}

/**
 * The ten-digit tag a paragraph adds to a shell ID that an earlier paragraph shows. Digits
 * only, so encoding strips it as it strips a repeat's count.
 */
function paragraphTag(paragraphId: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < paragraphId.length; at += 1) {
    hash = Math.imul(hash ^ paragraphId.charCodeAt(at), 0x01000193) >>> 0;
  }
  return String(hash).padStart(10, '0');
}

const TAG = /^\d{10}$/;

/**
 * The paragraphs whose text names one ID, with the first of them by ID at hand. A peer can
 * name one ID in any number of texts, and every view of each asks for the first, so it is
 * kept in a heap rather than found by a scan. Removed holders leave the heap lazily.
 */
class Holders extends Set<LogicalId> {
  private readonly heap: LogicalId[] = [];

  override add(id: LogicalId): this {
    if (!this.has(id)) {
      super.add(id);
      // Built by `Set`'s constructor before the heap exists; it adds nothing then.
      if (this.heap) this.push(id);
    }
    return this;
  }

  first(): LogicalId {
    const heap = this.heap;
    while (heap.length > 0 && !this.has(heap[0]!)) this.pop();
    return heap[0]!;
  }

  private push(id: LogicalId): void {
    const heap = this.heap;
    heap.push(id);
    for (let at = heap.length - 1; at > 0; ) {
      const parent = (at - 1) >> 1;
      if (heap[parent]! <= heap[at]!) break;
      [heap[parent], heap[at]] = [heap[at]!, heap[parent]!];
      at = parent;
    }
  }

  private pop(): void {
    const heap = this.heap;
    const last = heap.pop()!;
    if (heap.length === 0) return;
    heap[0] = last;
    for (let at = 0; ; ) {
      const left = 2 * at + 1;
      const right = left + 1;
      let least = at;
      if (left < heap.length && heap[left]! < heap[least]!) least = left;
      if (right < heap.length && heap[right]! < heap[least]!) least = right;
      if (least === at) break;
      [heap[least], heap[at]] = [heap[at]!, heap[least]!];
      at = least;
    }
  }
}

function firstHolder(holders: ReadonlySet<LogicalId>): LogicalId {
  return (holders as Holders).first();
}

/** The node IDs one stretch of text names in its attributes. */
function idsOfAttributes(attributes: ReturnType<typeof decodeAttributes>): string[] {
  const ids: string[] = [];
  for (const id of [
    attributes.run?.id,
    attributes.runProperties?.id,
    attributes.text?.id,
    attributes.textValueId,
    ...attributes.wrap.map((wrapper) => wrapper.id),
  ]) {
    if (id) ids.push(id);
  }
  return ids;
}

export class InlineIndex {
  /** The paragraphs whose shared text names each ID. */
  private readonly holders = new Map<string, Holders>();
  private readonly idsOf = new Map<LogicalId, Set<string>>();
  private readonly embeds = new Set<string>();
  /** Paragraphs whose shown IDs changed because another paragraph's text changed. */
  private readonly affected = new Set<LogicalId>();
  /** A registry over a document it did not load reads every text on first use. */
  private built = false;
  /** Whether a view read since the last `takeDrift` showed something its text does not say. */
  private drift = false;
  readonly follow: TextFollow;

  constructor(
    private readonly nodes: Y.Map<Y.Map<unknown>>,
    private readonly limits: DocumentLimits,
    private readonly isDeleted: (paragraphId: LogicalId) => boolean,
    order: DocumentOrder
  ) {
    this.follow = new TextFollow(
      (id) => this.textOf(id),
      isDeleted,
      order,
      (paragraphs) => this.noteOthers(paragraphs),
      (identity) => this.paragraphHolding(identity)
    );
  }

  /** The paragraph whose shared text holds the item of `client:clock`, deleted or not. */
  private paragraphHolding(identity: string): LogicalId | null {
    const parsed = parseClientClock(identity);
    const doc = this.nodes.doc;
    if (!doc || !parsed) return null;
    const { client, clock } = parsed;
    const text = structAt(doc, { client, clock })?.parent;
    if (!(text instanceof Y.Text) || fieldOf(text) !== INLINE_FIELD) return null;
    const record = holderItem(text)?.parent;
    const key = record instanceof Y.Map ? fieldOf(record) : null;
    if (key === null || rejectDangerousKey(key)) return null;
    const id = keyId(key);
    return this.textOf(id) === text ? id : null;
  }

  /** Whether a paragraph is deleted or unlisted, so its text shows only where it follows. */
  isDeletedParagraph(paragraphId: LogicalId): boolean {
    return this.isDeleted(paragraphId);
  }

  /** A paragraph's shared inline text, or null for a node that has none. */
  textOf(paragraphId: string): Y.Text | null {
    const record = this.nodes.get(paragraphId);
    if (!isNodeMap(record)) return null;
    const text = record.get(INLINE_FIELD);
    return text instanceof Y.Text ? text : null;
  }

  /** The paragraph that shows this ID, or an ID derived from it. */
  owner(id: string): LogicalId | null {
    this.ensureBuilt();
    let candidate = id;
    let tag: string | null = null;
    for (let depth = 0; depth < 64; depth += 1) {
      const holders = this.holders.get(candidate);
      if (holders) {
        if (tag !== null) {
          for (const holder of holders) if (paragraphTag(holder) === tag) return holder;
          // Text that follows a move shows the IDs of the paragraph it was typed in, tagged
          // with the paragraph that shows it.
          for (const holder of holders) {
            for (const target of this.follow.targetsFor(holder)) {
              if (paragraphTag(target) === tag) return target;
            }
          }
          // The tag names the paragraph that shows the node, whatever holds its shell now.
          const shown = this.paragraphTagged(tag);
          if (shown) return shown;
        }
        return firstHolder(holders);
      }
      // A shell a repair gave the paragraph derives from the paragraph's own ID.
      if (candidate !== id && this.textOf(candidate)) return asLogicalId(candidate);
      const at = candidate.lastIndexOf('~');
      if (at < 0) return null;
      const segment = candidate.slice(at + 1);
      if (tag === null && TAG.test(segment)) tag = segment;
      candidate = candidate.slice(0, at);
    }
    return null;
  }

  /**
   * The paragraph whose tag this is. Only an ID no holder resolves asks, which is rare, so
   * the paragraphs are searched rather than indexed.
   */
  private paragraphTagged(tag: string): LogicalId | null {
    for (const paragraphId of this.idsOf.keys())
      if (paragraphTag(paragraphId) === tag) return paragraphId;
    let found: LogicalId | null = null;
    this.nodes.forEach((_record, id) => {
      if (found === null && paragraphTag(id) === tag && this.textOf(id)) found = asLogicalId(id);
    });
    return found;
  }

  /** Every paragraph whose shared text names this ID. */
  holdersOf(id: string): ReadonlySet<LogicalId> {
    this.ensureBuilt();
    return this.holders.get(id) ?? new Set();
  }

  /** The ID a paragraph shows for a shell ID in its text: tagged unless it holds it first. */
  shownId(paragraphId: LogicalId, id: string): string {
    this.ensureBuilt();
    // A record's ID is taken: only a damaged or hostile text names one for a shell.
    if (this.nodes.has(id)) return `${id}~${paragraphTag(paragraphId)}`;
    const holders = this.holders.get(id);
    // A paragraph can show an ID its own text does not hold: text that follows a move into
    // it carries the IDs of the paragraph it was typed in.
    if (holders && !holders.has(paragraphId)) return `${id}~${paragraphTag(paragraphId)}`;
    if (!holders || holders.size < 2 || firstHolder(holders) === paragraphId) return id;
    return `${id}~${paragraphTag(paragraphId)}`;
  }

  /** The view one paragraph's materialization reads. */
  viewOf(paragraphId: LogicalId): ParagraphView {
    this.ensureBuilt();
    return {
      shownId: (id) => this.shownId(paragraphId, id),
      noteDrift: () => this.noteDrift(),
      showsEmbed: (id) => {
        const holders = this.holders.get(id);
        return !holders || holders.size < 2 || firstHolder(holders) === paragraphId;
      },
      shown: (text) => this.follow.shown(paragraphId, text),
      textOf: (id) => this.textOf(id),
    };
  }

  /** Whether this ID names a registry node a paragraph's text embeds. */
  isEmbed(id: string): boolean {
    this.ensureBuilt();
    return this.embeds.has(id);
  }

  /**
   * Note that a paragraph shows something its own text does not say: a renamed ID, a hidden
   * position, text that follows a move, a repair, or a write to another paragraph's text.
   */
  noteDrift(): void {
    this.drift = true;
  }

  /**
   * Whether the editor's own tree can differ from what shared state shows, since the last
   * call: a local edit installs the tree it computed, not the one shared state shows.
   */
  takeDrift(): boolean {
    this.follow.settle();
    const drift = this.drift || this.affected.size > 0;
    this.drift = false;
    return drift;
  }

  /** Paragraphs that show other IDs since the last call, though their own text is unchanged. */
  takeAffected(): ReadonlySet<LogicalId> {
    this.follow.settle();
    if (this.affected.size === 0) return new Set();
    const taken = new Set(this.affected);
    this.affected.clear();
    return taken;
  }

  /** Every paragraph's shared text. */
  allTexts(): ReadonlySet<Y.Text> {
    const texts = new Set<Y.Text>();
    this.nodes.forEach((_record, id) => {
      const text = this.textOf(id);
      if (text) texts.add(text);
    });
    return texts;
  }

  /**
   * The marks of inserts in some texts changed, so their characters read other identities.
   * Reads those paragraphs again. Returns their IDs.
   */
  marksChanged(texts: ReadonlySet<Y.Text>): ReadonlySet<LogicalId> {
    const ids = new Set<LogicalId>();
    if (!this.built) return ids;
    for (const text of texts) {
      if (fieldOf(text) !== INLINE_FIELD) continue;
      const record = holderItem(text)?.parent;
      const key = record instanceof Y.Map ? fieldOf(record) : null;
      if (key === null || rejectDangerousKey(key)) continue;
      const id = keyId(key);
      if (this.textOf(id) !== text) continue;
      this.follow.invalidate(id);
      this.paragraphChanged(id);
      ids.add(id);
    }
    return ids;
  }

  /** Read one paragraph's text again after it changed. */
  paragraphChanged(paragraphId: LogicalId): void {
    // Before the first read, the first read builds from the whole document instead.
    if (!this.built) return;
    const before = this.idsOf.get(paragraphId) ?? new Set<string>();
    const ids = new Set<string>();
    const embedded = new Set<string>();
    const text = this.textOf(paragraphId);
    if (text) {
      for (const op of text.toDelta() as {
        insert: unknown;
        attributes?: Record<string, unknown>;
      }[]) {
        if (typeof op.insert === 'object' && op.insert !== null) {
          const node = (op.insert as { n?: unknown }).n;
          if (typeof node === 'string') {
            ids.add(node);
            embedded.add(node);
          }
        }
        for (const id of idsOfAttributes(
          decodeAttributes(op.attributes, this.limits, paragraphId)
        )) {
          ids.add(id);
        }
      }
    }
    for (const id of before) if (!ids.has(id)) this.release(id, paragraphId);
    for (const id of ids) if (!before.has(id)) this.hold(id, paragraphId);
    for (const id of embedded) this.embeds.add(id);
    if (ids.size > 0) this.idsOf.set(paragraphId, ids);
    else this.idsOf.delete(paragraphId);
    this.noteOthers(this.follow.paragraphChanged(paragraphId));
  }

  /**
   * Another paragraph's view changed: a copy it holds now shows or hides, or text that
   * follows a move now shows in it. A local edit's own tree does not show that, so the
   * session has to install the shared view.
   */
  private noteOthers(others: ReadonlySet<LogicalId>): void {
    for (const other of others) this.affected.add(other);
    if (others.size > 0) this.noteDrift();
  }

  /** Document order changed; paragraphs whose shown copies depend on it read again. */
  orderChanged(): void {
    if (!this.built) return;
    for (const id of this.follow.orderChanged()) this.affected.add(id);
  }

  /** A record a text embeds arrived after the text: the paragraphs holding it read again. */
  recordArrived(id: LogicalId): void {
    if (!this.built) return;
    for (const holder of this.holders.get(id) ?? []) this.affected.add(holder);
  }

  /**
   * A paragraph that no parent lists any more, or lists again, has its text count as a
   * deleted paragraph's, or no longer: an undo of the edit that made it unlists it.
   */
  listingChanged(paragraphId: LogicalId): void {
    if (!this.built) return;
    // A text embeds only a node no child array lists, so a listing decides where it shows.
    for (const holder of this.holders.get(paragraphId) ?? []) this.affected.add(holder);
    if (!this.textOf(paragraphId)) return;
    this.noteOthers(this.follow.paragraphChanged(paragraphId));
    this.affected.add(paragraphId);
  }

  private hold(id: string, paragraphId: LogicalId): void {
    let holders = this.holders.get(id);
    if (!holders) {
      holders = new Holders();
      this.holders.set(id, holders);
    }
    // The paragraph that showed the ID bare shows it tagged once an earlier one holds it.
    if (holders.size > 0) {
      const first = firstHolder(holders);
      if (paragraphId < first) this.affected.add(first);
    }
    const alone = holders.size < 2;
    holders.add(paragraphId);
    if (alone) this.holdersChanged(holders);
  }

  private release(id: string, paragraphId: LogicalId): void {
    const holders = this.holders.get(id);
    if (!holders) return;
    if (holders.size <= 2) this.holdersChanged(holders);
    const wasFirst = firstHolder(holders) === paragraphId;
    holders.delete(paragraphId);
    if (holders.size === 0) {
      this.holders.delete(id);
      this.embeds.delete(id);
      return;
    }
    // The next holder now shows the ID bare.
    if (wasFirst) this.affected.add(firstHolder(holders));
  }

  /**
   * The holders of one ID changed. A paragraph that shows a holder's text where it follows a
   * move shows that ID by the holders too: tagged or bare, and an embed only while no other
   * text holds it. Its own text and its following text can stay the same, so it reads again.
   *
   * Such a paragraph holds none of it, so it reads only whether one text holds the ID or
   * several: the callers ask only when that changes, which keeps a peer that names one ID
   * in many texts from making every hold walk every holder.
   */
  private holdersChanged(holders: ReadonlySet<LogicalId>): void {
    for (const holder of holders) {
      for (const target of this.follow.placedTargetsFor(holder)) {
        if (!holders.has(target)) this.affected.add(target);
      }
    }
  }

  /**
   * Forget everything and read every paragraph's text. Every paragraph that shares an ID or
   * an origin before or after is affected: what it shows can change without its own text.
   */
  rebuild(): void {
    this.built = true;
    this.markShared();
    this.follow.clear();
    this.holders.clear();
    this.idsOf.clear();
    this.embeds.clear();
    this.nodes.forEach((record, id) => {
      if (isNodeMap(record) && record.get(INLINE_FIELD) instanceof Y.Text) {
        this.paragraphChanged(keyId(id));
      }
    });
    this.markShared();
  }

  private ensureBuilt(): void {
    if (this.built) return;
    this.rebuild();
    this.follow.settle();
    this.affected.clear();
  }

  private markShared(): void {
    for (const holders of this.holders.values()) {
      if (holders.size > 1) for (const holder of holders) this.affected.add(holder);
    }
  }
}
