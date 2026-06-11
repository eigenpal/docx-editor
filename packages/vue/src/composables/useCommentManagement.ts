/**
 * Comments + tracked-changes composable — owns the action handlers
 * that mutate the document (addComment, replyToComment, resolveComment,
 * proposeChange, the sidebar handle* wrappers, accept/reject tracked
 * changes). Does NOT own the `comments` / `trackedChanges` refs or the
 * floating-comment-button recompute logic — those stay in the parent
 * because they're read from multiple cluster boundaries (sidebar,
 * margin markers, computed). The parent threads its refs into this
 * composable as inputs.
 */

import { unref, type MaybeRef, type Ref } from 'vue';
import type { EditorView } from 'prosemirror-view';
import type { Comment, Document } from '@eigenpal/docx-editor-core/types/document';
import {
  acceptChange,
  rejectChange,
  acceptChangeById,
  rejectChangeById,
} from '@eigenpal/docx-editor-core/prosemirror/commands';
import {
  addCommentToRange,
  applyProposedChange,
  createComment as createCommentCore,
} from '@eigenpal/docx-editor-core/prosemirror/commentOps';
import {
  seedCommentAllocator,
  type CommentIdAllocator,
} from '@eigenpal/docx-editor-core/prosemirror/commentIdAllocator';
import type { TrackedChangeEntry } from '../components/sidebar/sidebarUtils';

/**
 * Host-facing comment lifecycle callbacks (the `onComment*` props). Shared with
 * `useCommentLifecycle`. The granular callbacks fire on the matching UI action;
 * `onCommentsChange` fires with the full array on every comment mutation.
 */
export interface CommentCallbacks {
  onCommentAdd?: (comment: Comment) => void;
  onCommentResolve?: (comment: Comment) => void;
  onCommentDelete?: (comment: Comment) => void;
  onCommentReply?: (reply: Comment, parent: Comment) => void;
  onCommentsChange?: (comments: Comment[]) => void;
}

export interface UseCommentManagementOptions {
  editorView: Ref<EditorView | null>;
  getDocument: () => Document | null;
  comments: Ref<Comment[]>;
  trackedChanges: Ref<TrackedChangeEntry[]>;
  showSidebar: Ref<boolean>;
  isAddingComment: Ref<boolean>;
  pendingCommentRange: Ref<{ from: number; to: number } | null>;
  contentChangeSubscribers: Set<(document: unknown) => void>;
  extractCommentsAndChanges: () => void;
  emit: (event: string, ...args: unknown[]) => void;
  /**
   * Per-editor-instance monotonic ID allocator, shared with
   * `useCommentLifecycle` so comment and tracked-change IDs never collide.
   */
  commentIdAllocator: CommentIdAllocator;
  /** Author name for UI-created replies/changes (the `author` prop). */
  author?: MaybeRef<string>;
  /** Host-facing comment lifecycle callbacks (the `onComment*` props). */
  commentCallbacks?: CommentCallbacks;
}

export function useCommentManagement(opts: UseCommentManagementOptions) {
  /** Current author name for UI-created comments/changes, defaulting to 'User'. */
  const resolveAuthor = () => unref(opts.author) ?? 'User';

  /** Publish the comment array to the ref and notify the host (onCommentsChange). */
  function commitComments(list: Comment[]) {
    opts.comments.value = list;
    opts.commentCallbacks?.onCommentsChange?.(list);
  }

  /** Seed the shared allocator above every ID currently in the document. */
  function seedAllocator() {
    seedCommentAllocator(
      opts.commentIdAllocator,
      opts.getDocument()?.package?.document?.comments,
      opts.editorView.value
    );
  }

  function createComment(text: string, author: string, parentId?: number): Comment {
    seedAllocator();
    return createCommentCore(opts.commentIdAllocator, text, author, parentId);
  }

  function addComment(options: {
    paraId: string;
    text: string;
    author: string;
    search?: string;
  }): number | null {
    const doc = opts.getDocument();
    const view = opts.editorView.value;
    if (!doc?.package?.document || !view) return null;
    if (!doc.package.document.comments) doc.package.document.comments = [];

    seedAllocator();
    const comment = addCommentToRange(view, options, opts.commentIdAllocator);
    if (!comment) return null;

    doc.package.document.comments.push(comment);
    commitComments([...doc.package.document.comments]);
    opts.showSidebar.value = true;
    opts.emit('change', doc);
    opts.contentChangeSubscribers.forEach((listener) => listener(doc));
    return comment.id;
  }

  // replyToComment / resolveComment are shared by the UI handlers and the
  // ref-API. Like React, they fire `onCommentsChange` (via commitComments) but
  // NOT the granular `onCommentReply` / `onCommentResolve` — those are UI-only
  // and fired by handleCommentReply / handleCommentResolve below.
  function replyToComment(commentId: number, text: string, author: string): number | null {
    const doc = opts.getDocument();
    if (!doc?.package?.document?.comments) return null;
    if (!doc.package.document.comments.some((comment) => comment.id === commentId)) return null;
    const reply = createComment(text, author, commentId);
    doc.package.document.comments.push(reply);
    commitComments([...doc.package.document.comments]);
    opts.emit('change', doc);
    opts.contentChangeSubscribers.forEach((listener) => listener(doc));
    return reply.id;
  }

  function resolveComment(commentId: number): void {
    const doc = opts.getDocument();
    if (!doc?.package?.document?.comments) return;
    const comment = doc.package.document.comments.find((item) => item.id === commentId);
    if (!comment) return;
    comment.done = true;
    commitComments([...doc.package.document.comments]);
    opts.emit('change', doc);
    opts.contentChangeSubscribers.forEach((listener) => listener(doc));
  }

  function proposeChange(options: {
    paraId: string;
    search: string;
    replaceWith: string;
    author: string;
  }): boolean {
    const view = opts.editorView.value;
    if (!view) return false;
    seedAllocator();
    const ok = applyProposedChange(view, options, opts.commentIdAllocator);
    if (ok) {
      opts.extractCommentsAndChanges();
      opts.showSidebar.value = true;
    }
    return ok;
  }

  function handleCommentReply(commentId: number, text: string) {
    const doc = opts.getDocument();
    const parent = doc?.package?.document?.comments?.find((c) => c.id === commentId);
    const replyId = replyToComment(commentId, text, resolveAuthor());
    if (replyId == null || !parent) return;
    const reply = doc?.package?.document?.comments?.find((c) => c.id === replyId);
    if (reply) opts.commentCallbacks?.onCommentReply?.(reply, parent);
  }

  // UI resolve wrapper: resolveComment (shared with the ref-API) fires only
  // onCommentsChange; the granular onCommentResolve is UI-only. Pass a copy so
  // the host can't mutate the live document comment.
  function handleCommentResolve(commentId: number) {
    const doc = opts.getDocument();
    const comment = doc?.package?.document?.comments?.find((c) => c.id === commentId);
    resolveComment(commentId);
    if (comment) opts.commentCallbacks?.onCommentResolve?.({ ...comment });
  }

  function handleCommentUnresolve(commentId: number) {
    const doc = opts.getDocument();
    if (!doc?.package?.document?.comments) return;
    const c = doc.package.document.comments.find((c) => c.id === commentId);
    if (c) c.done = false;
    commitComments([...doc.package.document.comments]);
    opts.emit('change', doc);
  }

  function handleCommentDelete(commentId: number) {
    const doc = opts.getDocument();
    if (!doc?.package?.document?.comments) return;
    const target = doc.package.document.comments.find((c) => c.id === commentId);
    doc.package.document.comments = doc.package.document.comments.filter(
      (c) => c.id !== commentId && c.parentId !== commentId
    );
    commitComments([...doc.package.document.comments]);
    if (target) opts.commentCallbacks?.onCommentDelete?.(target);
    opts.emit('change', doc);
  }

  function handleAcceptChange(from: number, to: number) {
    const view = opts.editorView.value;
    if (!view) return;
    acceptChange(from, to)(view.state, view.dispatch);
    opts.extractCommentsAndChanges();
    view.focus();
  }

  function handleRejectChange(from: number, to: number) {
    const view = opts.editorView.value;
    if (!view) return;
    rejectChange(from, to)(view.state, view.dispatch);
    opts.extractCommentsAndChanges();
    view.focus();
  }

  function handleAcceptChangeById(revisionId: number) {
    const view = opts.editorView.value;
    if (!view) return;
    acceptChangeById(revisionId)(view.state, view.dispatch);
    opts.extractCommentsAndChanges();
    view.focus();
  }

  function handleRejectChangeById(revisionId: number) {
    const view = opts.editorView.value;
    if (!view) return;
    rejectChangeById(revisionId)(view.state, view.dispatch);
    opts.extractCommentsAndChanges();
    view.focus();
  }

  // Thread a reply under a tracked change. Mirrors React's
  // onTrackedChangeReply (DocxEditor.tsx): the reply is a child comment
  // keyed by `parentId = revisionId`, NOT an independently anchored
  // comment. No comment mark is added — the sidebar groups replies by
  // parentId (useCommentSidebarItems) and the card already anchors at the
  // change's own position, so a mark would only pollute the document with
  // a dangling range that has no top-level card.
  function handleTrackedChangeReply(revisionId: number, text: string) {
    const doc = opts.getDocument();
    if (!doc?.package?.document) return;
    if (!doc.package.document.comments) doc.package.document.comments = [];

    const comment = createComment(text, resolveAuthor(), revisionId);
    doc.package.document.comments.push(comment);
    commitComments([...doc.package.document.comments]);
    opts.emit('change', doc);
  }

  return {
    addComment,
    replyToComment,
    resolveComment,
    proposeChange,
    handleCommentReply,
    handleCommentResolve,
    handleCommentUnresolve,
    handleCommentDelete,
    handleAcceptChange,
    handleRejectChange,
    handleAcceptChangeById,
    handleRejectChangeById,
    handleTrackedChangeReply,
  };
}
