// Comment write through the package coordinator, so collaboration can journal it.
//
// `addComment` commits on the story store. The coordinator then grafts the new parts onto
// the package. That path never entered `TreePackageStore.transact`, so a comment did not
// produce a primitive journal and a peer never saw the `@w:id`. Concurrent comment mints
// then could not be tested — or replicated — as a journaled edit.
//
// Capture is armed around the story write when the package store has observers. The graft,
// shell replace, and publish stay the same sequence `replyToComment` already used.
// Resolve and delete used that graft/replace sequence WITHOUT arming capture, so a peer
// kept markers that named a comment (or a `w15:done` part) it never received.

import {
  packageTransactionPublished,
  runObservedStoreTransaction,
} from '../package/canonical-primitive-capture.ts';
import { deleteCommentReply, deleteCommentThreadInStory } from '../package/comment-lifecycle.ts';
import {
  addComment,
  setCommentResolved,
  type AddCommentRequest,
  type AddCommentResult,
  type SetCommentResolvedResult,
} from './comment-writes.ts';
import type { StoryScope, TreePackageStore } from './tree-package-store.ts';

const BODY: StoryScope = { kind: 'body' };

/**
 * Add a comment on one story and publish the new package shell.
 *
 * The story store still performs the write. The package coordinator records the undo unit
 * and, when observed, the primitive journal.
 */
export function addPackageComment(
  packageStore: TreePackageStore,
  request: AddCommentRequest,
  scope: StoryScope = BODY
): AddCommentResult {
  const resolved = scope.kind === 'body' ? null : packageStore.resolveStory(scope);
  const store = resolved?.ok ? resolved.store : packageStore.bodyStore();
  const beforePackage = packageStore.currentPackage();
  const checkpoint = store.checkpoint();
  store.graftPackage(() => packageStore.currentPackage());
  return runObservedStoreTransaction(
    packageStore,
    () => {
      const result = addComment(store, request);
      if (!result.ok) return result;
      store.restoreHistoryStacks(checkpoint);
      packageStore.replacePackageShell(store.package);
      packageStore.adoptPackageUnit(beforePackage);
      packageStore.publishStoryWrite(result.change);
      return result;
    },
    (result) => packageTransactionPublished(result)
  );
}

/**
 * Resolve or reopen a comment thread and publish the new package shell.
 *
 * `@w15:done` lives in `commentsExtended.xml`, which a document with no reply does not have.
 * Capture must be armed for that create-part, or a peer keeps an open thread.
 */
export function setPackageCommentResolved(
  packageStore: TreePackageStore,
  commentId: string,
  resolved: boolean
): SetCommentResolvedResult {
  const store = packageStore.bodyStore();
  const beforePackage = packageStore.currentPackage();
  const checkpoint = store.checkpoint();
  store.graftPackage(() => packageStore.currentPackage());
  return runObservedStoreTransaction(
    packageStore,
    () => {
      const result = setCommentResolved(store, commentId, resolved);
      if (!result.ok) return result;
      if (!result.changed) return result;
      store.restoreHistoryStacks(checkpoint);
      packageStore.replacePackageShell(store.package);
      packageStore.adoptPackageUnit(beforePackage);
      packageStore.publishStoryWrite(result.change);
      return result;
    },
    (result) => result.ok && result.changed
  );
}

/** One comment object in a delete batch: a root, or a reply naming its parent. */
export interface PackageCommentDelete {
  readonly commentId: string;
  readonly parentCommentId?: string;
}

/**
 * Delete comment threads or replies and install the rewritten package.
 *
 * Installed, not shell-replaced: `replacePackageShell` re-overlays every opened story
 * store, and a header the reader had entered would restore its markers after the body
 * had already dropped them.
 */
export function deletePackageComments(
  packageStore: TreePackageStore,
  comments: readonly PackageCommentDelete[],
  scope: StoryScope = BODY,
  noteId?: number
): boolean {
  if (comments.length === 0) return false;
  const storyPart =
    scope.kind === 'body' ? packageStore.bodyStore().part : packageStore.partFor(scope);
  if (!storyPart) return false;
  const owner = {
    storyPartName: storyPart.name,
    ...(noteId === undefined ? {} : { noteId }),
  };
  const store = packageStore.bodyStore();
  const beforePackage = packageStore.currentPackage();
  const checkpoint = store.checkpoint();
  store.graftPackage(() => packageStore.currentPackage());
  return runObservedStoreTransaction(
    packageStore,
    () => {
      let refused = false;
      let removed = false;
      const result = store.transact((ctx) => {
        ctx.applyPackage((current) => {
          let next = current;
          for (const comment of comments) {
            const deleted =
              comment.parentCommentId === undefined
                ? deleteCommentThreadInStory(next, comment.commentId, owner)
                : deleteCommentReply(next, comment.commentId, comment.parentCommentId, owner);
            if (deleted === null) {
              refused = true;
              return current;
            }
            removed ||= deleted !== next;
            next = deleted;
          }
          return next;
        });
      });
      if (refused || !result.ok || !removed) return false;
      store.restoreHistoryStacks(checkpoint);
      packageStore.installPackageSnapshot(store.package);
      packageStore.adoptPackageUnit(beforePackage);
      packageStore.publishStoryWrite(result.change);
      return true;
    },
    (ok) => ok
  );
}
