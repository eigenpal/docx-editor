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
// omitted and the text is published as DocxEditor's own `text`. `delete` would have to remove the
// markers and the record together, likewise unbacked. All three are recorded in
// `compat/manifest.json`.
//
// A TRACKED CHANGE IS A DECISION THE ENGINE CAN MAKE. Structural revisions — a row, a cell, a
// section, the table grid — are ones it refuses to resolve, so they are not answered as objects at
// all: a revision whose `accept` and `reject` both refuse is worse than an absence, because code
// walking the collection would stall on it with nothing to read that explains why.

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

/** Word's own names for a kind of change, as the host answers them. */
export type RevisionType =
  | 'Insert'
  | 'Delete'
  | 'Replace'
  | 'Property'
  | 'ParagraphProperty'
  | 'MovedFrom'
  | 'MovedTo';

/**
 * A stamp the file wrote, or `null` where it wrote none.
 *
 * Never invented: a comment with no `@w:date` is a comment nobody dated, and answering "now" would
 * put a time in a caller's report that is not in the document.
 */
function stamp(value: string): Date | null {
  if (value.length === 0) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** What a comment and a reply both are: an author, a date, an id and a body. */
abstract class CommentBase extends ModelObject implements PromisedItem {
  /** @internal */
  hydrateAddress(address: ObjectAddress): void {
    if (address.kind === 'handle') this.path.resolveTo(address.handle);
    else this.path.resolveNull();
  }

  /** @internal */
  hydrateNull(): void {
    this.path.resolveNull();
  }

  /** Who wrote it. Always present: `CT_TrackChange` makes the author mandatory. */
  get authorName(): string {
    return this.loadedProperty<string>('authorName');
  }

  /** When it was written, or `null` where the file recorded no date. */
  get creationDate(): Date {
    return this.loadedProperty<Date>('creationDate');
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

  protected override onLoad(request: ResolvedLoadOptions): void {
    this.loadCommentFields(request, []);
  }
}

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

  protected listing(): AutomationOperation {
    return this.#plan();
  }

  protected itemAt(label: string, address: ObjectAddress): CommentReply {
    return CommentReply.at(this.context, label, address);
  }

  protected promised(label: string, nullable: boolean): CommentReply & PromisedItem {
    return CommentReply.promised(this.context, label, nullable);
  }
}

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

  protected override onLoad(request: ResolvedLoadOptions): void {
    this.loadCommentFields(request, ['resolved']);
  }
}

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

  protected listing(): AutomationOperation {
    return this.#plan();
  }

  protected itemAt(label: string, address: ObjectAddress): Comment {
    return Comment.at(this.context, label, address);
  }

  protected promised(label: string, nullable: boolean): Comment & PromisedItem {
    return Comment.promised(this.context, label, nullable);
  }
}

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

  /** @internal */
  hydrateAddress(address: ObjectAddress): void {
    if (address.kind === 'handle') this.path.resolveTo(address.handle);
    else this.path.resolveNull();
  }

  /** @internal */
  hydrateNull(): void {
    this.path.resolveNull();
  }

  /** Who proposed the change. */
  get author(): string {
    return this.loadedProperty<string>('author');
  }

  /** When they proposed it, or `null` where the file recorded no date. */
  get date(): Date {
    return this.loadedProperty<Date>('date');
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

export class RevisionCollection extends HandleCollection<Revision> {
  readonly #body: AutomationHandle;
  readonly #document: AutomationHandle;

  /** @internal The pending decisions of one story. */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    body: AutomationHandle,
    document: AutomationHandle
  ): RevisionCollection {
    return new RevisionCollection(context, ObjectPath.derived(label, owner), body, document);
  }

  private constructor(
    context: RequestContext,
    path: ObjectPath,
    body: AutomationHandle,
    document: AutomationHandle
  ) {
    super(context, path);
    this.#body = body;
    this.#document = document;
  }

  /**
   * Keep every change, as ONE decision and one undo unit.
   *
   * The engine's own whole-document operation rather than a loop over `accept`: a reviewer who
   * accepted a document's changes made one decision, and one undo should take all of them back. It
   * refuses outright where the document holds a change the engine cannot resolve, which is the
   * honest answer — accepting the rest would report a document as reviewed while it still carries
   * pending changes.
   */
  acceptAll(): void {
    const document = this.#document;
    this.commandOn('acceptAll', () => ({ op: 'acceptAllRevisions', document }));
  }

  /** Undo every change, likewise as one decision. */
  rejectAll(): void {
    const document = this.#document;
    this.commandOn('rejectAll', () => ({ op: 'rejectAllRevisions', document }));
  }

  protected listing(): AutomationOperation {
    return { op: 'getRevisions', body: this.#body };
  }

  protected itemAt(label: string, address: ObjectAddress): Revision {
    return Revision.at(this.context, label, address);
  }

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
