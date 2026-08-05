/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Lists: the numbers a document puts in front of paragraphs.
//
// A LIST IS NOT AN ELEMENT. OOXML has no list: it has paragraphs that each name a `w:numId`, and a
// list is the set of paragraphs that name the same one. So `List#id` is that number, `paragraphs` is
// the set, and a list exists exactly as long as some paragraph is still in it.
//
// WHAT IS MISSING IS MISSING BECAUSE IT IS PAINTED, NOT AUTHORED. `ListItem#listString` — the "3."
// or "iv)" a reader sees — is computed while laying the document out, by a counter that walks the
// story applying `numbering.xml` and its abstract-numbering indirection, restarts and overrides. It
// is not in the paragraph, and answering it here would mean a second counter that disagrees with
// the one on screen the first time a document overrides a level. `siblingIndex` is the same counter
// read differently. Both are recorded as omissions in `compat/manifest.json`.

import {
  ObjectPath,
  fail,
  hydratedApplied,
  hydratedHandle,
  hydratedNumber,
  type AutomationHandle,
  type AutomationOperation,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { ParagraphCollection } from './collections.ts';
import { HandleCollection, type PromisedItem } from './item-collection.ts';
import { insertableText } from './locations.ts';
import { ModelObject } from './model-object.ts';
import { Paragraph } from './paragraph.ts';

/** Deepest level OOXML numbering has. Nine levels, counted from zero. */
const MAX_LEVEL = 8;

export class List extends ModelObject implements PromisedItem {
  #paragraphs: ParagraphCollection | undefined;

  /** @internal A list a read has already named. */
  static at(context: RequestContext, label: string, address: ObjectAddress): List {
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: label });
    return new List(context, ObjectPath.of(label, address.handle), false);
  }

  /** @internal A list a queued read will name, or report as nothing. */
  static promised(context: RequestContext, label: string, nullable: boolean): List {
    return new List(context, ObjectPath.pending(label), nullable);
  }

  private constructor(context: RequestContext, path: ObjectPath, nullable: boolean) {
    super(context, path, { nullable });
  }

  /** @internal */
  hydrateAddress(address: ObjectAddress): void {
    if (address.kind === 'handle') this.path.resolveTo(address.handle);
    else this.path.resolveNull();
  }

  /** @internal */
  hydrateNull(): void {
    this.path.resolveNull();
  }

  /** The `w:numId` the list's paragraphs share — the document's own identity for the list. */
  get id(): number {
    return this.loadedProperty<number>('id');
  }

  /** Every paragraph in the list, in reading order. */
  get paragraphs(): ParagraphCollection {
    this.#paragraphs ??= ParagraphCollection.overListing(
      this.context,
      `${this.path.label}.paragraphs`,
      this.path,
      () => ({ op: 'getListParagraphs', list: this.#handle() })
    );
    return this.#paragraphs;
  }

  /** The list's paragraphs at one level, in reading order. */
  getLevelParagraphs(level: number): ParagraphCollection {
    const target = `${this.path.label}.getLevelParagraphs`;
    const chosen = requireLevel(level, target);
    const handle = this.#handle();
    return ParagraphCollection.overListing(this.context, target, this.path, () => ({
      op: 'getListParagraphs',
      list: handle,
      level: chosen,
    }));
  }

  /**
   * Add a numbered paragraph to the list, at its start or its end.
   *
   * All four of Word's locations are accepted and `Before`/`After` land INSIDE the list, at the
   * first and last position — the same places `Start` and `End` name. A list is a set of paragraphs
   * rather than a region, so "before the list" is a position in the story rather than in the list,
   * and `Paragraph#insertParagraph` is what addresses that. The divergence is recorded in
   * `compat/manifest.json`.
   */
  insertParagraph(
    paragraphText: string,
    insertLocation: 'Start' | 'End' | 'Before' | 'After'
  ): Paragraph {
    const target = `${this.path.label}.insertParagraph`;
    const written = insertableText(paragraphText, target);
    if (
      insertLocation !== 'Start' &&
      insertLocation !== 'End' &&
      insertLocation !== 'Before' &&
      insertLocation !== 'After'
    ) {
      fail({ code: 'InvalidArgument', target });
    }
    const handle = this.#handle();
    const created = Paragraph.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () => ({
        op: 'insertListParagraph',
        list: handle,
        where:
          insertLocation === 'Start' || insertLocation === 'Before'
            ? 'start'
            : ('end' as 'start' | 'end'),
        text: written,
      }),
      (value) => {
        created.hydrateAddress({ kind: 'handle', handle: hydratedHandle(value, target) });
      }
    );
    return created;
  }

  protected override onLoad(request: ResolvedLoadOptions): void {
    if (!this.selection(request, ['id']).includes('id')) return;
    const label = `${this.path.label}.id`;
    const handle = this.#handle();
    this.read(
      label,
      () => ({ op: 'getListId', list: handle }),
      (value) => {
        this.setLoadedProperty('id', hydratedNumber(value, label));
      }
    );
  }

  #handle(): AutomationHandle {
    this.requireAddressable();
    return this.path.handle();
  }
}

export class ListCollection extends HandleCollection<List> {
  readonly #body: AutomationHandle;

  /** @internal The lists of one story, in the order their numbers first appear. */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    body: AutomationHandle
  ): ListCollection {
    return new ListCollection(context, ObjectPath.derived(label, owner), body);
  }

  private constructor(context: RequestContext, path: ObjectPath, body: AutomationHandle) {
    super(context, path);
    this.#body = body;
  }

  /** The first list. `ItemNotFound` at the sync if the story has none. */
  getFirst(): List {
    return this.edge('first', 'getFirst', false);
  }

  /**
   * The list with one `w:numId`, or `ItemNotFound` where the story has none.
   *
   * ONE read, answered by the host: a `w:numId` is a document value, and matching it against a
   * listing on this side would mean asking every list for its id and choosing locally — a batch
   * whose size depends on the document, to answer a question the host can answer directly. A number
   * no paragraph uses names a numbering definition rather than a list, and is refused.
   */
  getById(id: number): List {
    const target = `${this.path.label}.getById`;
    const wanted = requireId(id, target);
    const body = this.#body;
    const found = List.promised(this.context, target, false);
    // A collection is a `ClientObject` rather than a `ModelObject`, so it queues its read itself.
    this.enqueue({
      sort: 'read',
      label: target,
      plan: () => ({ op: 'getListById', body, id: wanted }),
      settle: (value) => {
        found.hydrateAddress({ kind: 'handle', handle: hydratedHandle(value, target) });
      },
    });
    return found;
  }

  protected listing(): AutomationOperation {
    return { op: 'getLists', body: this.#body };
  }

  protected itemAt(label: string, address: ObjectAddress): List {
    return List.at(this.context, label, address);
  }

  protected promised(label: string, nullable: boolean): List & PromisedItem {
    return List.promised(this.context, label, nullable);
  }
}

export class ListItem extends ModelObject {
  /** @internal The list membership of the paragraph `owner` addresses. */
  static of(context: RequestContext, label: string, owner: ObjectPath): ListItem {
    return new ListItem(context, ObjectPath.derived(label, owner));
  }

  private constructor(context: RequestContext, path: ObjectPath) {
    super(context, path);
  }

  /**
   * How deeply the item is nested: zero for a top-level item, up to eight.
   *
   * Writing it is Word's Increase/Decrease Indent on a list item — the paragraph keeps its list and
   * changes its level, which is why this is one property rather than a pair of verbs.
   */
  get level(): number {
    return this.loadedProperty<number>('level');
  }

  set level(value: number) {
    const target = `${this.path.label}.level`;
    const level = requireLevel(value, target);
    const paragraph = this.#paragraph();
    this.commandAnswering(
      target,
      () => ({ op: 'setListLevel', paragraph, level }),
      (answer) => {
        hydratedApplied(answer, target);
      }
    );
  }

  protected override onLoad(request: ResolvedLoadOptions): void {
    if (!this.selection(request, ['level']).includes('level')) return;
    const label = `${this.path.label}.level`;
    const paragraph = this.#paragraph();
    this.read(
      label,
      () => ({ op: 'getListLevel', paragraph }),
      (value) => {
        this.setLoadedProperty('level', hydratedNumber(value, label));
      }
    );
  }

  #paragraph(): AutomationHandle {
    this.requireAddressable();
    const address = this.path.address();
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: this.path.label });
    return address.handle;
  }
}

function requireLevel(value: unknown, target: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > MAX_LEVEL) {
    fail({ code: 'InvalidArgument', target });
  }
  return value as number;
}

function requireId(value: unknown, target: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) fail({ code: 'InvalidArgument', target });
  return value as number;
}
