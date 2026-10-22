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
// A TRACKED CHANGE IS A DECISION THE ENGINE CAN MAKE. Rows, cells, cell merges, and tracked
// numbering are listed by their revision type. A structural card with no single type, such as
// table grid history, is omitted so code walking `items` never stalls on an object whose `type`
// we cannot publish. Collection membership is not the collection decision set:
// `acceptAll` / `rejectAll` still resolve every store-resolvable revision, including a
// complete tracked row, and refuse atomically when any read-only or otherwise unsupported
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
  type AutomationSpanRef,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { HandleCollection, type PromisedItem } from './item-collection.ts';
import { ModelObject } from './model-object.ts';
import { Range } from './range.ts';
import { clientResult, type ClientResult } from '../runtime/client-result.ts';
import type { RevisionAuthorResult, RevisionBatchResult } from '@docx-editor.dev/core/automation';
export type {
  RevisionAuthorEntry,
  RevisionAuthorResult,
  RevisionAuthorSkipReason,
  RevisionBatchResult,
  RevisionBatchEntry,
  RevisionBatchSkipReason,
} from '@docx-editor.dev/core/automation';

/**
 * Word's own names for a kind of change.
 *
 * The WHOLE upstream vocabulary, because a declaration says what a caller may be handed and a caller
 * switching on it should not have to be told which subset this engine happens to produce. Nine of
 * these occur as published objects: Insert, Delete, Property, MovedFrom, MovedTo, CellInsertion,
 * CellDeletion, CellMerge and ParagraphNumber. A structural card with no single type, such as
 * table grid history, is omitted from `items`; collection-wide decisions still resolve every
 * store-resolvable revision. See
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
    this.command('delete', () => ({ op: 'deleteComment', comment: this.commentHandle() }));
  }

  protected loadCommentFields(request: ResolvedLoadOptions, extra: readonly string[]): void {
    const selected = this.selection(request, [
      'authorName',
      'creationDate',
      'id',
      'text',
      ...extra,
    ]);
    if (selected.includes('authorName')) {
      this.loadTextInto('authorName', () => ({
        op: 'getCommentAuthor',
        comment: this.commentHandle(),
      }));
    }
    if (selected.includes('text')) {
      this.loadTextInto('text', () => ({ op: 'getCommentText', comment: this.commentHandle() }));
    }
    if (selected.includes('id')) {
      this.loadTextInto('id', () => ({ op: 'getCommentId', comment: this.commentHandle() }));
    }
    if (selected.includes('creationDate')) {
      const label = `${this.path.label}.creationDate`;
      this.read(
        label,
        () => ({ op: 'getCommentDate', comment: this.commentHandle() }),
        (value) => {
          this.setLoadedProperty('creationDate', stamp(hydratedText(value, label)));
        }
      );
    }
    if (!selected.includes('resolved')) return;
    const label = `${this.path.label}.resolved`;
    this.read(
      label,
      () => ({ op: 'getCommentResolved', comment: this.commentHandle() }),
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
    this.commandAnswering(
      target,
      () => ({ op: 'setCommentResolved', comment: this.commentHandle(), resolved: value }),
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
    const found = Range.promised(this.context, target, false);
    this.read(
      target,
      () => ({ op: 'getCommentRange', comment: this.commentHandle() }),
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
   * writing an anonymous remark the file cannot represent. The refusal is `NotSupported` with
   * `debugInfo.innerError.code` `edit.comment-author-required`.
   *
   * In a React or Vue host with the review module, use `useReview().reply` from
   * `@docx-editor.dev/pro/react` or `@docx-editor.dev/pro/vue` instead. It replies as the
   * editor's author.
   */
  reply(replyText: string): CommentReply {
    const target = `${this.path.label}.reply`;
    if (typeof replyText !== 'string' || replyText.length === 0) {
      fail({ code: 'InvalidArgument', target });
    }
    const author = this.internals.author;
    if (typeof author !== 'string' || author.trim().length === 0) {
      fail({ code: 'NotSupported', target, diagnostic: 'edit.comment-author-required' });
    }
    const created = CommentReply.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () => ({ op: 'replyToComment', comment: this.commentHandle(), text: replyText, author }),
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
 * One tracked change.
 *
 * A row is listed as `Insert` or `Delete`, and a cell or tracked numbering by its own type. A
 * structural card with no single type, such as table grid history, is omitted rather than
 * shipped with an unpublishable `type`. That listing is not the collection decision set: see
 * {@link RevisionCollection}.
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

  /** The words the change covers. Each read returns the same proxy, so a load on it is kept. */
  get range(): Range {
    if (this.#range) return this.#range;
    const label = `${this.path.label}.range`;
    const found = Range.promised(this.context, label, false);
    this.read(
      label,
      () => ({ op: 'getRevisionRange', revision: this.#handle() }),
      (value) => {
        found.hydrateAddress({ kind: 'span', span: hydratedSpan(value, label) });
      }
    );
    this.#range = found;
    return found;
  }
  #range: Range | undefined;

  /**
   * Keep the change, in one transaction, with every part of it: both halves of a move or a cell
   * merge, and the changes inside content it removes, such as another author's insertion in a
   * deleted row. Rejecting a formatting change restores the earlier properties, so another
   * author's change inside the replaced properties, such as tracked numbering, goes with it.
   *
   * After a sync resolves this change, another call on the same object fails with
   * `InvalidObjectPath`, because the change is gone. Within one sync, a decision on a change an
   * earlier decision removed is skipped. Read `debugInfo.innerError.code` on a refusal, such as
   * `review.retained-structure` for a row that must stay to keep a nested table, or
   * `review.locked-content` and `review.bound-content` for a change a content control keeps.
   *
   * In a React or Vue host with the review module, use `useReview().accept` from
   * `@docx-editor.dev/pro/react` or `@docx-editor.dev/pro/vue` for a review UI.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/accept-reject-without-scrolling | Accept or reject without scrolling}
   */
  accept(): void {
    this.command('accept', () => ({ op: 'acceptRevision', revision: this.#handle() }));
  }

  /**
   * Undo the change, likewise in one transaction and with the same rules as {@link Revision.accept}.
   *
   * In a React or Vue host with the review module, use `useReview().reject` for a review UI.
   */
  reject(): void {
    this.command('reject', () => ({ op: 'rejectRevision', revision: this.#handle() }));
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    const selected = this.selection(request, ['author', 'date', 'type']);
    if (selected.includes('author')) {
      this.loadTextInto('author', () => ({ op: 'getRevisionAuthor', revision: this.#handle() }));
    }
    if (selected.includes('type')) {
      this.loadTextInto('type', () => ({ op: 'getRevisionType', revision: this.#handle() }));
    }
    if (!selected.includes('date')) return;
    const label = `${this.path.label}.date`;
    this.read(
      label,
      () => ({ op: 'getRevisionDate', revision: this.#handle() }),
      (value) => {
        this.setLoadedProperty('date', stamp(hydratedText(value, label)));
      }
    );
  }

  /** @internal Capture a batch target without exposing engine identity. */
  static batchHandle(
    revision: Revision,
    context: RequestContext,
    target = 'RevisionCollection.resolve'
  ): AutomationHandle {
    if (!(revision instanceof Revision) || revision.context !== context)
      fail({ code: 'InvalidArgument', target });
    return revision.#handle();
  }

  #handle(): AutomationHandle {
    this.requireAddressable();
    return this.path.handle();
  }
}

/**
 * Select every change these authors made, for {@link RevisionCollection.setAuthor}.
 * Matches `w:author` exactly.
 *
 * @public
 */
export interface RevisionAuthorSelection {
  readonly authors: readonly string[];
}

/**
 * Options for {@link RevisionCollection.setAuthor}.
 *
 * @public
 */
export interface RevisionAuthorOptions {
  /** The date to record. Omit it to keep each change's own date. */
  readonly date?: Date;
}

/** What one revision collection addresses. */
type RevisionScope =
  // Read when an operation is built, so a story body that a later sync names still answers.
  | { readonly body: () => AutomationHandle }
  | { readonly span: () => AutomationSpanRef }
  | { readonly key: string };

/**
 * The tracked changes on a document, story or range, as of the batch that loaded them.
 *
 * `items` omits a structural card with no single revision type; see {@link Revision}.
 * On a story's collection, `acceptAll` / `rejectAll` still resolve every store-resolvable
 * revision in the story and refuse atomically if any read-only or otherwise unsupported
 * revision remains. On {@link Range.revisions} and `getReviewItemRevisions`, they resolve the
 * changes the range overlaps or the key names, and `resolve` and `setAuthor` refuse with
 * `NotSupported`.
 *
 * @public
 */
export class RevisionCollection extends HandleCollection<Revision> {
  readonly #scope: RevisionScope;

  /** @internal The pending decisions of one story. */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    body: () => AutomationHandle
  ): RevisionCollection {
    return new RevisionCollection(context, ObjectPath.derived(label, owner), { body });
  }

  /** @internal The pending decisions a range overlaps, read from the range at plan time. */
  static inSpan(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    span: () => AutomationSpanRef
  ): RevisionCollection {
    return new RevisionCollection(context, ObjectPath.derived(label, owner), { span });
  }

  /** @internal The pending decisions one review-queue key names. */
  static ofReviewKey(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    key: string
  ): RevisionCollection {
    return new RevisionCollection(context, ObjectPath.derived(label, owner), { key });
  }

  private constructor(context: RequestContext, path: ObjectPath, scope: RevisionScope) {
    super(context, path);
    this.#scope = scope;
  }

  /**
   * Keep every change in this story, as ONE decision and one undo unit.
   *
   * Resolves every store-resolvable revision in the story, including history omitted from
   * `items`. Refuses the sync outright where any read-only or otherwise unsupported revision
   * remains, a row must stay to keep a nested table (`review.retained-structure`), or a content
   * control keeps a change (`review.locked-content`, `review.bound-content`), rather
   * than reporting the story as reviewed while pending changes remain.
   *
   * On a collection from {@link Range.revisions}, resolves every change the range overlaps at
   * sync time, structural changes absent from `items` included. A change the range covers in
   * part resolves whole, characters outside the range included. On a collection from
   * `getReviewItemRevisions`, resolves the changes the key names, and refuses with
   * `InvalidObjectPath` when the key names nothing. Either way, the sync refuses whole when one
   * of the changes is read-only or cannot be resolved, and a change that an earlier decision in
   * the same sync resolved the same way is skipped.
   */
  acceptAll(): void {
    this.commandOn('acceptAll', () => this.#decision('acceptAllRevisions'));
  }

  /** Undo every change, likewise as one decision. */
  rejectAll(): void {
    this.commandOn('rejectAll', () => this.#decision('rejectAllRevisions'));
  }

  #decision(op: 'acceptAllRevisions' | 'rejectAllRevisions'): AutomationOperation {
    return { op, ...this.#scopeRef() } as AutomationOperation;
  }

  /** What the host addresses: the story, the range read at plan time, or the review key. */
  #scopeRef(): { body: AutomationHandle } | { scope: AutomationSpanRef } | { key: string } {
    const scope = this.#scope;
    if ('span' in scope) return { scope: scope.span() };
    return 'key' in scope ? { key: scope.key } : { body: scope.body() };
  }

  /**
   * The story handle, read when the operation is built, or `NotSupported` at the call on a
   * collection that a range or a key scopes.
   */
  #storyBody(member: string): () => AutomationHandle {
    const scope = this.#scope;
    if (!('body' in scope)) fail({ code: 'NotSupported', target: `${this.path.label}.${member}` });
    return scope.body;
  }

  /**
   * Resolve eligible revisions in this story and report skipped decisions after sync.
   * Omit revisions to include unsupported decisions and history absent from items. Named
   * revisions resolve as single `accept()` or `reject()` calls on them would, except that a
   * row kept for a nested table is reported as `retained-structure` while the other named
   * changes resolve, where a single call refuses whole.
   * Pass an empty array to select nothing. Duplicate objects resolve once; stale targets
   * are reported as unknown-revision. This must be the only write in its sync batch.
   * Unlike acceptAll/rejectAll, unsupported decisions do not block independent changes.
   * A collection from `Range.revisions` or `getReviewItemRevisions` refuses this call with
   * `NotSupported`.
   *
   * @example
   * ```ts
   * const result = context.document.revisions.resolve('accept');
   * await context.sync();
   * console.log(result.value.resolved.length, result.value.remaining);
   * for (const skipped of result.value.skipped)
   *   console.log(skipped.reason, skipped.detail ?? '');
   * ```
   */
  resolve(
    action: 'accept' | 'reject',
    revisions?: readonly Revision[]
  ): ClientResult<RevisionBatchResult> {
    const label = `${this.path.label}.resolve`;
    if (
      !['accept', 'reject'].includes(action) ||
      (revisions !== undefined && !Array.isArray(revisions))
    )
      fail({ code: 'InvalidArgument', target: label });
    const body = this.#storyBody('resolve');
    const targets = revisions === undefined ? undefined : [...revisions];
    const { result, fill } = clientResult<RevisionBatchResult>(label);
    this.enqueue({
      sort: 'write',
      label,
      plan: () => ({
        op: 'resolveRevisionBatch',
        body: body(),
        action,
        ...(targets === undefined
          ? {}
          : { revisions: targets.map((revision) => Revision.batchHandle(revision, this.context)) }),
      }),
      settle: (value) => {
        if (value.kind !== 'revisionBatch') fail({ code: 'GeneralException', target: label });
        fill(value.result);
      },
    });
    return result;
  }

  /**
   * Attribute changes in this story to another author. The changes stay pending.
   *
   * Pass revision objects to change those changes, or `{ authors }` to change every change
   * those authors made. Omit the selection to change every change in the story, by every
   * author, including structural ones absent from `items`. An empty array selects nothing.
   * Each change keeps its date unless you pass `options.date`. Keep this the only write in
   * its sync batch. Revision objects you pass stay valid and read the new author after a load.
   * A collection from `Range.revisions` or `getReviewItemRevisions` refuses this call with
   * `NotSupported`.
   *
   * @example
   * ```ts
   * const result = context.document.revisions.setAuthor('Ada Lovelace', { authors: ['AI'] });
   * await context.sync();
   * console.log(result.value.updated.length, result.value.skipped);
   * ```
   */
  setAuthor(
    author: string,
    selection?: readonly Revision[] | RevisionAuthorSelection,
    options?: RevisionAuthorOptions
  ): ClientResult<RevisionAuthorResult> {
    const label = `${this.path.label}.setAuthor`;
    const date = options?.date;
    const revisions = Array.isArray(selection) ? (selection as readonly Revision[]) : undefined;
    const authors =
      selection !== undefined && !Array.isArray(selection)
        ? (selection as RevisionAuthorSelection | null)?.authors
        : undefined;
    if (
      typeof author !== 'string' ||
      author.trim().length === 0 ||
      (selection !== undefined &&
        !Array.isArray(selection) &&
        (typeof selection !== 'object' ||
          selection === null ||
          !Array.isArray(authors) ||
          authors.some((name) => typeof name !== 'string'))) ||
      (options !== undefined && (typeof options !== 'object' || options === null)) ||
      (date !== undefined && (!(date instanceof Date) || Number.isNaN(date.getTime()))) ||
      // Checked now so a foreign or non-revision object refuses before anything queues.
      revisions?.some(
        (revision) => !(revision instanceof Revision) || revision.context !== this.context
      )
    )
      fail({ code: 'InvalidArgument', target: label });
    const body = this.#storyBody('setAuthor');
    const targets = revisions === undefined ? undefined : [...revisions];
    const { result, fill } = clientResult<RevisionAuthorResult>(label);
    this.enqueue({
      sort: 'write',
      label,
      plan: () => ({
        op: 'setRevisionAuthorBatch',
        body: body(),
        author,
        // Written to the second, as every other revision date is.
        ...(date === undefined ? {} : { date: `${date.toISOString().slice(0, 19)}Z` }),
        ...(authors === undefined ? {} : { authors: [...authors] }),
        ...(targets === undefined
          ? {}
          : {
              revisions: targets.map((revision) =>
                Revision.batchHandle(revision, this.context, label)
              ),
            }),
      }),
      settle: (value) => {
        if (value.kind !== 'revisionAuthors') fail({ code: 'GeneralException', target: label });
        fill(value.result);
      },
    });
    return result;
  }

  /** @internal The read that answers this collection's members. */
  protected listing(): AutomationOperation {
    return { op: 'getRevisions', ...this.#scopeRef() } as AutomationOperation;
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
