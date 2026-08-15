/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Comments and tracked changes: the two things a document holds that are ABOUT its text.
//
// A COMMENT IS A CONVERSATION, NOT A REMARK. `replies` is where the answers are, and resolving is a
// property of the whole thread — assigning `resolved` marks the comment and everything answering it,
// which is what Word's own pane does. A reply is authored over the comment's own range, because that
// is where the conversation is anchored and OOXML gives a reply no other place to be.
//
// WHAT IS NOT PUBLISHED, AND WHY. `authorEmail` is not in the file: `CT_Comment` records an author
// and initials, and Word's own address comes from `people.xml`, a part this slice does not read.
// `content` as a WRITABLE property would need a comment body rewrite, which no canonical operation
// offers — a read-only `content` would be a different contract from upstream's, so the member is
// omitted and the text is published as DocxEditor's own `text`.
//
// A TRACKED CHANGE IS A DECISION THE ENGINE CAN MAKE. Individually unpublishable structural
// cards — a row, a cell, a section, the table grid, when this API cannot name their Word
// subtype — are omitted from the listing so code walking `items` never stalls on an object
// whose `type` we cannot publish. Collection membership is not the collection decision set:
// `acceptAll` / `rejectAll` still resolve every store-resolvable revision, including a
// complete tracked row, and refuse atomically when any `readOnly` or otherwise unsupported
// revision remains.

import {
  ObjectPath,
  fail,
  hydratedApplied,
  hydratedFlag,
  hydratedHandle,
  hydratedSpan,
  hydratedText,
  type AutomationHandle,
  type AutomationOperation,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { HandleCollection, type PromisedItem } from './item-collection.ts';
import { ModelObject } from './model-object.ts';
import { Range } from './range.ts';

/**
 * Word's own names for a kind of change.
 *
 * The WHOLE upstream vocabulary, because a declaration says what a caller may be handed and a caller
 * switching on it should not have to be told which subset this engine happens to produce. Seven of
 * these actually occur as published objects — insert, delete, replace, the two property kinds and
 * the two move halves. Structural cards whose exact Word subtype this API cannot name are omitted
 * from `items`; collection-wide decisions still resolve every store-resolvable revision. See
 * `compat/manifest.json`.
 */
export type RevisionType =
  | 'None'
  | 'Insert'
  | 'Delete'
  | 'Property'
  | 'ParagraphNumber'
  | 'DisplayField'
  | 'Reconcile'
  | 'Conflict'
  | 'Style'
  | 'Replace'
  | 'ParagraphProperty'
  | 'TableProperty'
  | 'SectionProperty'
  | 'StyleDefinition'
  | 'MovedFrom'
  | 'MovedTo'
  | 'CellInsertion'
  | 'CellDeletion'
  | 'CellMerge'
  | 'CellSplit'
  | 'ConflictInsert'
  | 'ConflictDelete';

/** Days in `month` (1–12) for a Gregorian `year`, or 0 when the month is out of range. */
function daysInGregorianMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * File-authored xsd:dateTime with an absolute zone, or `null` when absent, invalid, or
 * unrepresentable. Timezone-less values are valid xsd:dateTime but cannot become a JavaScript
 * `Date` without inventing a zone; calendar rollovers and out-of-range offsets are refused.
 */
function stamp(value: string): Date | null {
  if (value.length === 0) return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value.trim()
    );
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const maxDay = daysInGregorianMonth(year, month);
  if (year === 0 || maxDay === 0 || day < 1 || day > maxDay) return null;

  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;

  const fraction = match[7];
  const ms = fraction === undefined ? 0 : Number(fraction.padEnd(3, '0').slice(0, 3));
  if (Number.isNaN(ms)) return null;

  const iso =
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.` +
    `${String(ms).padStart(3, '0')}Z`;
  const utcMs = Date.parse(iso);
  if (Number.isNaN(utcMs)) return null;

  const zone = match[8]!;
  if (zone === 'Z') return new Date(utcMs);

  const offsetHour = Number(zone.slice(1, 3));
  const offsetMinute = Number(zone.slice(4, 6));
  if (offsetMinute > 59 || offsetHour > 14 || (offsetHour === 14 && offsetMinute !== 0)) {
    return null;
  }

  const sign = zone[0] === '+' ? 1 : -1;
  const at = new Date(utcMs - sign * (offsetHour * 3_600_000 + offsetMinute * 60_000));
  return Number.isNaN(at.getTime()) ? null : at;
}

/** What a comment and a reply both are: an author, a date, an id and a body. */
abstract class CommentBase extends ModelObject implements PromisedItem {
  /** @internal Bind this object to the address the owning read answered. */
  hydrateAddress(address: ObjectAddress): void {
    if (address.kind === 'handle') this.path.resolveTo(address.handle);
    else this.path.resolveNull();
  }

  /** @internal Settle as the null object: the read found nothing to name. */
  hydrateNull(): void {
    this.path.resolveNull();
  }

  /** Who wrote it. Always present: `CT_TrackChange` makes the author mandatory. */
  get authorName(): string {
    return this.loadedProperty<string>('authorName');
  }

  /** When it was written, or `null` where the file recorded no valid date. */
  get creationDate(): Date | null {
    return this.loadedProperty<Date | null>('creationDate');
  }

  /** The document's own id for it (`w:id` in the comments part). */
  get id(): string {
    return this.loadedProperty<string>('id');
  }

  /**
   * What it says, as plain text.
   *
   * DocxEditor's own member rather than upstream's `content`: upstream declares that one writable,
   * and rewriting a comment body is not an operation this engine offers, so publishing a read-only
   * `content` under the same name would be a quieter divergence than a differently named read.
   */
  get text(): string {
    return this.loadedProperty<string>('text');
  }

  /**
   * Delete this comment object.
   *
   * On a top-level comment this removes the whole thread and its anchors. On a reply it removes
   * only that reply, preserving the parent and siblings. Several deletes queued before one
   * `sync()` commit atomically as one undo unit.
   */
  delete(): void {
    const comment = this.commentHandle();
    this.command('delete', () => ({ op: 'deleteComment', comment }));
  }

  protected loadCommentFields(request: ResolvedLoadOptions, extra: readonly string[]): void {
    const selected = this.selection(request, [
      'authorName',
      'creationDate',
      'id',
      'text',
      ...extra,
    ]);
    const comment = this.commentHandle();
    if (selected.includes('authorName')) {
      this.loadTextInto('authorName', () => ({ op: 'getCommentAuthor', comment }));
    }
    if (selected.includes('text')) {
      this.loadTextInto('text', () => ({ op: 'getCommentText', comment }));
    }
    if (selected.includes('id')) {
      this.loadTextInto('id', () => ({ op: 'getCommentId', comment }));
    }
    if (selected.includes('creationDate')) {
      const label = `${this.path.label}.creationDate`;
      this.read(
        label,
        () => ({ op: 'getCommentDate', comment }),
        (value) => {
          this.setLoadedProperty('creationDate', stamp(hydratedText(value, label)));
        }
      );
    }
    if (!selected.includes('resolved')) return;
    const label = `${this.path.label}.resolved`;
    this.read(
      label,
      () => ({ op: 'getCommentResolved', comment }),
      (value) => {
        this.setLoadedProperty('resolved', hydratedFlag(value, label));
      }
    );
  }

  protected commentHandle(): AutomationHandle {
    this.requireAddressable();
    return this.path.handle();
  }
}

/**
 * One answer in a comment thread.
 *
 * Authored over the parent comment's own range, because that is where the conversation is
 * anchored and OOXML gives a reply no other place to be. Resolving is a property of the whole
 * thread rather than of any one reply — see {@link Comment.resolved}.
 *
 * @public
 */
export class CommentReply extends CommentBase {
  /** @internal A reply a read has already named. */
  static at(context: RequestContext, label: string, address: ObjectAddress): CommentReply {
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: label });
    return new CommentReply(context, ObjectPath.of(label, address.handle), false);
  }

  /** @internal A reply a queued operation will name, or report as nothing. */
  static promised(context: RequestContext, label: string, nullable: boolean): CommentReply {
    return new CommentReply(context, ObjectPath.pending(label), nullable);
  }

  private constructor(context: RequestContext, path: ObjectPath, nullable: boolean) {
    super(context, path, { nullable });
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    this.loadCommentFields(request, []);
  }
}

/**
 * The replies to one comment, in thread order, as of the batch that loaded them.
 *
 * @public
 */
export class CommentReplyCollection extends HandleCollection<CommentReply> {
  readonly #plan: () => AutomationOperation;

  /** @internal The replies to one comment, in document order. */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    plan: () => AutomationOperation
  ): CommentReplyCollection {
    return new CommentReplyCollection(context, ObjectPath.derived(label, owner), plan);
  }

  private constructor(context: RequestContext, path: ObjectPath, plan: () => AutomationOperation) {
    super(context, path);
    this.#plan = plan;
  }

  /** The first reply. `ItemNotFound` at the sync if nobody answered. */
  getFirst(): CommentReply {
    return this.edge('first', 'getFirst', false);
  }

  /** @internal The read that answers this collection's members. */
  protected listing(): AutomationOperation {
    return this.#plan();
  }

  /** @internal Build one member from an address the listing answered. */
  protected itemAt(label: string, address: ObjectAddress): CommentReply {
    return CommentReply.at(this.context, label, address);
  }

  /** @internal A member an edge accessor named before the sync that finds it. */
  protected promised(label: string, nullable: boolean): CommentReply & PromisedItem {
    return CommentReply.promised(this.context, label, nullable);
  }
}

/**
 * A comment: a conversation about a stretch of the document, not a single remark.
 *
 * {@link Comment.replies} holds the answers, and resolving is a property of the whole thread —
 * assigning `resolved` marks this comment and everything answering it, which is what Word's own
 * pane does.
 *
 * `authorEmail` and a writable `content` are absent: `CT_Comment` records only an author and
 * initials (Word's addresses live in `people.xml`, which this API does not read), and a body
 * rewrite is not an operation the canonical write path offers. The comment's text is published
 * as `text`.
 *
 * @public
 */
export class Comment extends CommentBase {
  #replies: CommentReplyCollection | undefined;

  /** @internal A comment a read has already named. */
  static at(context: RequestContext, label: string, address: ObjectAddress): Comment {
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: label });
    return new Comment(context, ObjectPath.of(label, address.handle), false);
  }

  /** @internal A comment a queued operation will name, or report as nothing. */
  static promised(context: RequestContext, label: string, nullable: boolean): Comment {
    return new Comment(context, ObjectPath.pending(label), nullable);
  }

  private constructor(context: RequestContext, path: ObjectPath, nullable: boolean) {
    super(context, path, { nullable });
  }

  /**
   * Whether the thread is resolved.
   *
   * Assigning it resolves or reopens the WHOLE thread — this comment and its replies — because that
   * is what resolving a conversation means, and marking the parent alone would leave a reply reading
   * as open under a closed remark.
   */
  get resolved(): boolean {
    return this.loadedProperty<boolean>('resolved');
  }

  set resolved(value: boolean) {
    const target = `${this.path.label}.resolved`;
    if (typeof value !== 'boolean') fail({ code: 'InvalidArgument', target });
    const comment = this.commentHandle();
    this.commandAnswering(
      target,
      () => ({ op: 'setCommentResolved', comment, resolved: value }),
      (answer) => {
        hydratedApplied(answer, target);
      }
    );
  }

  /** The answers to this comment, in document order. */
  get replies(): CommentReplyCollection {
    this.#replies ??= CommentReplyCollection.of(
      this.context,
      `${this.path.label}.replies`,
      this.path,
      () => ({ op: 'getCommentReplies', comment: this.commentHandle() })
    );
    return this.#replies;
  }

  /** The words the comment is about. */
  getRange(): Range {
    const target = `${this.path.label}.getRange`;
    const comment = this.commentHandle();
    const found = Range.promised(this.context, target, false);
    this.read(
      target,
      () => ({ op: 'getCommentRange', comment }),
      (value) => {
        found.hydrateAddress({ kind: 'span', span: hydratedSpan(value, target) });
      }
    );
    return found;
  }

  /**
   * Answer the comment, over the same words it is anchored to.
   *
   * The author is the one the request context was opened with: a reply records who wrote it, and
   * `CT_TrackChange` makes that mandatory, so a context with no author refuses here rather than
   * writing an anonymous remark the file cannot represent.
   */
  reply(replyText: string): CommentReply {
    const target = `${this.path.label}.reply`;
    if (typeof replyText !== 'string' || replyText.length === 0) {
      fail({ code: 'InvalidArgument', target });
    }
    const author = this.internals.author;
    if (typeof author !== 'string' || author.trim().length === 0) {
      fail({ code: 'NotSupported', target });
    }
    const comment = this.commentHandle();
    const created = CommentReply.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () => ({ op: 'replyToComment', comment, text: replyText, author }),
      (value) => {
        // The reply's own id is minted INSIDE the package transaction, so the host answers it and
        // the proxy is bound to it — a caller can read the reply back without asking the thread.
        created.hydrateAddress({ kind: 'handle', handle: hydratedHandle(value, target) });
      }
    );
    return created;
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    this.loadCommentFields(request, ['resolved']);
  }
}

/**
 * The comments on a document, story or range, as of the batch that loaded them.
 *
 * @public
 */
export class CommentCollection extends HandleCollection<Comment> {
  readonly #plan: () => AutomationOperation;

  /** @internal The comments of a scope: a whole story's, or the ones a range overlaps. */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    plan: () => AutomationOperation
  ): CommentCollection {
    return new CommentCollection(context, ObjectPath.derived(label, owner), plan);
  }

  private constructor(context: RequestContext, path: ObjectPath, plan: () => AutomationOperation) {
    super(context, path);
    this.#plan = plan;
  }

  /** The first comment. `ItemNotFound` at the sync if there are none. */
  getFirst(): Comment {
    return this.edge('first', 'getFirst', false);
  }

  /** @internal The read that answers this collection's members. */
  protected listing(): AutomationOperation {
    return this.#plan();
  }

  /** @internal Build one member from an address the listing answered. */
  protected itemAt(label: string, address: ObjectAddress): Comment {
    return Comment.at(this.context, label, address);
  }

  /** @internal A member an edge accessor named before the sync that finds it. */
  protected promised(label: string, nullable: boolean): Comment & PromisedItem {
    return Comment.promised(this.context, label, nullable);
  }
}

/**
 * One tracked change, published when this API can name its Word subtype.
 *
 * Structural cards whose exact Word subtype cannot be typed — a row, a cell, a section, the table
 * grid — are omitted from the collection rather than shipped as objects with an unpublishable
 * `type`. That listing is not the collection decision set: see {@link RevisionCollection}.
 *
 * @public
 */
export class Revision extends ModelObject implements PromisedItem {
  /** @internal A change a read has already named. */
  static at(context: RequestContext, label: string, address: ObjectAddress): Revision {
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: label });
    return new Revision(context, ObjectPath.of(label, address.handle), false);
  }

  /** @internal A change a queued read will name, or report as nothing. */
  static promised(context: RequestContext, label: string, nullable: boolean): Revision {
    return new Revision(context, ObjectPath.pending(label), nullable);
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

  /** Who proposed the change. */
  get author(): string {
    return this.loadedProperty<string>('author');
  }

  /** When they proposed it, or `null` where the file recorded no valid date. */
  get date(): Date | null {
    return this.loadedProperty<Date | null>('date');
  }

  /** What kind of change it is, by Word's own name for it. */
  get type(): RevisionType {
    return this.loadedProperty<RevisionType>('type');
  }

  /** The words the change covers. */
  get range(): Range {
    const label = `${this.path.label}.range`;
    const revision = this.#handle();
    const found = Range.promised(this.context, label, false);
    this.read(
      label,
      () => ({ op: 'getRevisionRange', revision }),
      (value) => {
        found.hydrateAddress({ kind: 'span', span: hydratedSpan(value, label) });
      }
    );
    return found;
  }

  /** Keep the change, resolving every site that carries its identity in one transaction. */
  accept(): void {
    const revision = this.#handle();
    this.command('accept', () => ({ op: 'acceptRevision', revision }));
  }

  /** Undo the change, likewise in one transaction. */
  reject(): void {
    const revision = this.#handle();
    this.command('reject', () => ({ op: 'rejectRevision', revision }));
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    const selected = this.selection(request, ['author', 'date', 'type']);
    const revision = this.#handle();
    if (selected.includes('author')) {
      this.loadTextInto('author', () => ({ op: 'getRevisionAuthor', revision }));
    }
    if (selected.includes('type')) {
      this.loadTextInto('type', () => ({ op: 'getRevisionType', revision }));
    }
    if (!selected.includes('date')) return;
    const label = `${this.path.label}.date`;
    this.read(
      label,
      () => ({ op: 'getRevisionDate', revision }),
      (value) => {
        this.setLoadedProperty('date', stamp(hydratedText(value, label)));
      }
    );
  }

  #handle(): AutomationHandle {
    this.requireAddressable();
    return this.path.handle();
  }
}

/**
 * The tracked changes on a document, story or range, as of the batch that loaded them.
 *
 * `items` omits structural cards whose Word subtype this API cannot name; see {@link Revision}.
 * Collection-wide `acceptAll` / `rejectAll` still resolve every store-resolvable revision in this
 * story and refuse atomically if any `readOnly` or otherwise unsupported revision remains.
 *
 * @public
 */
export class RevisionCollection extends HandleCollection<Revision> {
  readonly #body: AutomationHandle;

  /** @internal The pending decisions of one story. */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    body: AutomationHandle
  ): RevisionCollection {
    return new RevisionCollection(context, ObjectPath.derived(label, owner), body);
  }

  private constructor(context: RequestContext, path: ObjectPath, body: AutomationHandle) {
    super(context, path);
    this.#body = body;
  }

  /**
   * Keep every change in this story, as ONE decision and one undo unit.
   *
   * Resolves every store-resolvable revision in the story, including complete tracked rows
   * omitted from `items`. Refuses the sync outright where any `readOnly` or otherwise
   * unsupported revision remains, rather than reporting the story as reviewed while pending
   * changes remain.
   */
  acceptAll(): void {
    const body = this.#body;
    this.commandOn('acceptAll', () => ({ op: 'acceptAllRevisions', body }));
  }

  /** Undo every change, likewise as one decision. */
  rejectAll(): void {
    const body = this.#body;
    this.commandOn('rejectAll', () => ({ op: 'rejectAllRevisions', body }));
  }

  /** @internal The read that answers this collection's members. */
  protected listing(): AutomationOperation {
    return { op: 'getRevisions', body: this.#body };
  }

  /** @internal Build one member from an address the listing answered. */
  protected itemAt(label: string, address: ObjectAddress): Revision {
    return Revision.at(this.context, label, address);
  }

  /** @internal A member an edge accessor named before the sync that finds it. */
  protected promised(label: string, nullable: boolean): Revision & PromisedItem {
    return Revision.promised(this.context, label, nullable);
  }

  /** A collection is a `ClientObject` rather than a `ModelObject`, so it queues its own writes. */
  private commandOn(name: string, plan: () => AutomationOperation): void {
    const label = `${this.path.label}.${name}`;
    this.enqueue({
      sort: 'write',
      label,
      plan,
      settle: (value) => {
        hydratedApplied(value, label);
      },
    });
  }
}
