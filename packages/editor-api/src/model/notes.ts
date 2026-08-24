/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Footnotes and endnotes: text that belongs to the document but not to its flow.
//
// A NOTE IS A STORY. Its body is an ordinary body — paragraphs, formatting, styles, the same
// operations — laid out at the foot of a page or at the end of the document rather than in the
// column. So `body` answers a `Body`, and everything the object model can do to the main story it
// can do to a note without a second vocabulary for it.
//
// `delete()` REMOVES THE REFERENCE TOO. A note's body in the notes part and the citation that
// reached it are one thing to a reader; deleting the body alone would leave a mark in the text
// pointing at nothing. The engine spells that as a package-level transaction, which is why it
// travels alone in its batch.

import {
  ObjectPath,
  fail,
  hydratedHandle,
  hydratedHandles,
  hydratedText,
  type AutomationHandle,
  type AutomationOperation,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { Body } from './body.ts';
import { HandleCollection, type PromisedItem } from './item-collection.ts';
import { ModelObject } from './model-object.ts';

/** Which kind of note: Word's own two. */
export type NoteItemType = 'Footnote' | 'Endnote';

/** The engine says `footnote`; this API says `Footnote`. One place says which is which. */
function kindOf(answer: string): NoteItemType {
  return answer === 'endnote' ? 'Endnote' : 'Footnote';
}

/**
 * One footnote or endnote: text that belongs to the document but not to its flow.
 *
 * A note IS a story. Its {@link NoteItem.body} is an ordinary {@link Body} — paragraphs,
 * formatting, styles, the same operations — laid out at the foot of a page or the end of the
 * document rather than in the column, so everything the object model can do to the main story it
 * can do to a note without a second vocabulary.
 *
 * `delete()` removes the reference too. A note's body and the citation that reached it are one
 * thing to a reader, and deleting the body alone would leave a mark pointing at nothing. The
 * engine spells that as a package-level transaction, which is why it travels alone in its batch.
 *
 * @public
 */
export class NoteItem extends ModelObject implements PromisedItem {
  #body: Body | undefined;

  /** @internal A note a read has already named. */
  static at(context: RequestContext, label: string, address: ObjectAddress): NoteItem {
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: label });
    return new NoteItem(context, ObjectPath.of(label, address.handle), false);
  }

  /** @internal A note a queued read will name, or report as nothing. */
  static promised(context: RequestContext, label: string, nullable: boolean): NoteItem {
    return new NoteItem(context, ObjectPath.pending(label), nullable);
  }

  private constructor(context: RequestContext, path: ObjectPath, nullable: boolean) {
    super(context, path, { nullable });
  }

  /** @internal Bind this object to the address the owning read answered. */
  hydrateAddress(address: ObjectAddress): void {
    if (address.kind === 'handle') this.path.resolveTo(address.handle);
    else this.path.resolveNull();
  }

  /** @internal Settle as the null object: the read found nothing to name. */
  hydrateNull(): void {
    this.path.resolveNull();
  }

  /** Whether this is a footnote or an endnote. */
  get type(): NoteItemType {
    return this.loadedProperty<NoteItemType>('type');
  }

  /**
   * The note's plain text.
   *
   * This is the same value as loading `text` from {@link NoteItem.body}: every paragraph in the
   * note story, in reading order, joined by one carriage return per paragraph mark. Load it
   * directly when structured traversal or editing through {@link NoteItem.body} is not needed.
   */
  get text(): string {
    return this.loadedProperty<string>('text');
  }

  /** The note's own story. */
  get body(): Body {
    if (this.#body) return this.#body;
    const label = `${this.path.label}.body`;
    const note = this.#handle();
    const story = Body.promisedStory(this.context, label);
    this.read(
      label,
      () => ({ op: 'getNoteBody', note }),
      (value) => {
        story.hydrateAddress({ kind: 'handle', handle: hydratedHandle(value, label) });
      }
    );
    this.#body = story;
    return story;
  }

  /**
   * Remove the note and every reference to it.
   *
   * A package transaction, so it is the ONLY operation its `sync()` may carry — the host refuses it
   * any company rather than committing half a batch. Two syncs get a delete and anything else.
   */
  delete(): void {
    const note = this.#handle();
    this.command('delete', () => ({ op: 'deleteNote', note }));
  }

  /** The next note of the same kind. `ItemNotFound` at the sync when this is the last one. */
  getNext(): NoteItem {
    const target = `${this.path.label}.getNext`;
    const own = this.#handle();
    const next = NoteItem.promised(this.context, target, false);
    const document = this.internals.roots().document;
    // The KIND first, because the ordering a note is next in is the ordering of its own part: a
    // footnote's next note is the next footnote, never the first endnote.
    const kindLabel = `${target}.type`;
    let noteKind: 'footnote' | 'endnote' = 'footnote';
    this.read(
      kindLabel,
      () => ({ op: 'getNoteKind', note: own }),
      (value) => {
        noteKind = hydratedText(value, kindLabel) === 'endnote' ? 'endnote' : 'footnote';
      }
    );
    this.read(
      target,
      () => ({ op: 'getNotes', document, noteKind }),
      (value) => {
        const notes = hydratedHandles(value, target);
        const at = notes.findIndex((handle) => handle.ref === own.ref);
        const after = at < 0 ? undefined : notes[at + 1];
        if (!after) fail({ code: 'ItemNotFound', target });
        next.hydrateAddress({ kind: 'handle', handle: after });
      }
    );
    return next;
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    const selected = this.selection(request, ['text', 'type']);
    if (selected.includes('text')) {
      const note = this.#handle();
      this.loadTextInto('text', () => ({
        op: 'getNoteText',
        note,
        projection: this.revisionTextView(),
      }));
    }
    if (selected.includes('type')) {
      const label = `${this.path.label}.type`;
      const note = this.#handle();
      this.read(
        label,
        () => ({ op: 'getNoteKind', note }),
        (value) => {
          // Word's spelling on this side, OOXML's on the engine's — the mapping lives here and in
          // `getNext`, and nowhere else.
          this.setLoadedProperty('type', kindOf(hydratedText(value, label)));
        }
      );
    }
  }

  #handle(): AutomationHandle {
    this.requireAddressable();
    return this.path.handle();
  }
}

/**
 * The notes of one kind, in the order the notes part writes them.
 *
 * DocxEditor's own collection type: the pinned reference fixture does not carry
 * `Word.NoteItemCollection`, so it is not measured for conformance — recorded as an omission in
 * `compat/manifest.json` — while `NoteItem` itself is. Without it a note would be unreachable, which
 * is the one thing worse than an unmeasured collection.
 */
export class NoteItemCollection extends HandleCollection<NoteItem> {
  readonly #plan: () => AutomationOperation;

  /** @internal A collection a named read will answer. */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    plan: () => AutomationOperation
  ): NoteItemCollection {
    return new NoteItemCollection(context, ObjectPath.derived(label, owner), plan);
  }

  private constructor(context: RequestContext, path: ObjectPath, plan: () => AutomationOperation) {
    super(context, path);
    this.#plan = plan;
  }

  /** The first note. `ItemNotFound` at the sync if the document has none of this kind. */
  getFirst(): NoteItem {
    return this.edge('first', 'getFirst', false);
  }

  /** @internal The read that answers this collection's members. */
  protected listing(): AutomationOperation {
    return this.#plan();
  }

  /** @internal Build one member from an address the listing answered. */
  protected itemAt(label: string, address: ObjectAddress): NoteItem {
    return NoteItem.at(this.context, label, address);
  }

  /** @internal A member an edge accessor named before the sync that finds it. */
  protected promised(label: string, nullable: boolean): NoteItem & PromisedItem {
    return NoteItem.promised(this.context, label, nullable);
  }
}
