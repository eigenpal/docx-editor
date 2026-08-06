// The seam between a host and whatever owns the document.
//
// INTERNAL. Not part of the public automation surface: a consumer gets a host, never a port.
// It exists so the headless host and the browser host differ in exactly one place — who owns
// the canonical package — and share every read, every validation and every batch rule.
//
// The port is deliberately the smallest thing that can carry a document: the canonical
// package to read, one ordered-ops transaction to write, bytes to save, and a change signal.
// Note what is NOT here — no per-paragraph read, no text accessor, no offset arithmetic.
// Those live above the port so both hosts cannot answer the same question two ways, which is
// the failure mode a second host implementation always ends in.

import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { InsertCustomNodeWrite } from '../store/store/custom-node-writes.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { StoryScope } from '../store/store/tree-package-store.ts';

export type { InsertCustomNodeWrite };

/** What a comment write asks for: a reply on a comment's own range, or a thread's state. */
export type AutomationCommentWrite =
  | {
      readonly kind: 'reply';
      readonly parentCommentId: string;
      readonly anchor: {
        readonly paragraphId: string;
        readonly start: number;
        readonly end: number;
        readonly endParagraphId?: string;
      };
      readonly text: string;
      readonly author: string;
      readonly date?: string;
    }
  | { readonly kind: 'resolve'; readonly commentId: string; readonly resolved: boolean };

export type AutomationCommentWriteResult =
  | { readonly ok: true; readonly changed: boolean; readonly commentId?: string }
  | { readonly ok: false; readonly reason: string };

export type AutomationPortApplyResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * A batch's ops, built at the moment the owner is about to commit them.
 *
 * A FUNCTION rather than an array because of one op: an external hyperlink names a relationship, and
 * a relationship is a package fact that outlives a refusal — it sits beside the trees, outside the
 * undo stack. Minting one while planning left a `Relationship` behind for a link the batch never
 * got, including on a document open for reading. So the planner validates the target and the owner
 * calls this AFTER its write gate has passed: `relate` mints (or reuses) the relationship for a
 * target, answering null for one the engine will not author.
 *
 * Answering null means "these ops cannot be built" and must leave the document untouched.
 */
export type AutomationStagedOps = (
  relate: (url: string) => string | null
) => readonly TreeDocOp[] | null;

export interface AutomationDocumentPort {
  /**
   * Monotonic document revision. One committed batch moves it exactly once.
   *
   * Package-wide rather than per-story: a host answers for a document, and a consumer's
   * `expectedRevision` has to be invalidated by any edit to it.
   */
  revision(): number;
  /**
   * The canonical package, or null when the owner currently has none (a browser host between
   * mounts). Every read the protocol answers is derived from this and nothing else — never
   * from a projection, a layout, or painted DOM.
   */
  currentPackage(): OoxmlPackage | null;
  /**
   * Commit ops as ONE transaction against ONE story.
   *
   * Ordered and atomic is the port's contract, not the caller's convention: on any rejection
   * the owner must leave revision, tree and subscribers exactly as they were.
   *
   * The scope is the caller's, because the caller is the only one who knows which story the
   * batch addressed. A port that assumed the body would silently refuse every header and note
   * op — the ids are not in the body's index — and a port that guessed from the ops would be a
   * second story resolver disagreeing with the reads.
   *
   * The ops arrive as {@link AutomationStagedOps} so the relationship an external hyperlink needs is
   * minted here, INSIDE the owner's write gate, rather than while the batch was still being planned.
   */
  apply(staged: AutomationStagedOps, scope: StoryScope): AutomationPortApplyResult;
  /**
   * Commit ONE package-level op — a note or furniture lifecycle — as its own transaction.
   *
   * Separate from `apply` because it is a different transaction: the store rewrites several parts
   * at once and publishes one package undo unit, which cannot be staged inside a story's
   * transaction. The planner has already refused the op any company, so a batch reaching here
   * holds exactly this one command and atomicity still means what it says.
   */
  applyLifecycle(op: TreeDocOp): AutomationPortApplyResult;
  /**
   * Commit ONE comment write — a reply, or a thread's resolved state — as its own transaction.
   *
   * A third path rather than an op, because a comment is not a tree edit: a reply writes the story
   * markers AND `comments.xml` AND `commentsExtended.xml` AND their relationships AND their
   * content types, and the engine already spells that as one package transaction (`addComment`).
   * Expressing it as `TreeDocOp`s would mean a second implementation of the same write, and the
   * two would diverge on the part a document happens not to have.
   *
   * Solitary, like the lifecycle path: the planner refuses these any company, so a batch reaching
   * here is exactly one write and atomicity still means what it says.
   */
  applyCommentWrite(write: AutomationCommentWrite, scope: StoryScope): AutomationCommentWriteResult;
  /**
   * Commit ONE custom-node write — the data part, the node in it, and the bound control.
   *
   * A fourth path for the same reason as the third: a payload is not a tree edit. It is a part
   * this document may not have yet, a relationship, a content-type override and a `w:sdt` that
   * quotes the id the part was given, and the store already spells that as one transaction. A
   * batch that expressed it as `TreeDocOp`s would need a second implementation of the same
   * write, and the two would disagree on the document that arrives with no store.
   *
   * Solitary, like the comment path: the planner refuses it any company, so a batch reaching
   * here is exactly one write and atomicity still means what it says.
   */
  applyCustomNodeWrite(write: InsertCustomNodeWrite, scope: StoryScope): AutomationPortApplyResult;
  /** DOCX bytes through the normalizing serializer, or null when there is no document. */
  save(): Uint8Array | null;
  /**
   * Put a reader's selection or caret on a stretch of the body.
   *
   * OPTIONAL, and the one thing about a host that is genuinely not portable: a headless host
   * has no caret to move, so it omits this and reports `selection: false` rather than
   * pretending. Called AFTER the batch's transaction, never during it. Positions are canonical
   * paragraph ids and model offsets — the same vocabulary the ops take, so there is no second
   * coordinate space to keep in step.
   */
  select?(
    range: {
      readonly start: { readonly paragraphId: string; readonly offset: number };
      readonly end: { readonly paragraphId: string; readonly offset: number };
    },
    mode: 'select' | 'start' | 'end'
  ): void;
  /** Fires once per committed change. */
  subscribe(listener: () => void): () => void;
  /** Release what the port holds. Idempotent. */
  dispose(): void;
}
