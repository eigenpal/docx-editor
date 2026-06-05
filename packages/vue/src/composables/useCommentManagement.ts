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

import type { Ref } from 'vue';
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
}

export function useCommentManagement(opts: UseCommentManagementOptions) {
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
    opts.comments.value = [...doc.package.document.comments];
    opts.showSidebar.value = true;
    opts.emit('change', doc);
    opts.contentChangeSubscribers.forEach((listener) => listener(doc));
    return comment.id;
  }

  function replyToComment(commentId: number, text: string, author: string): number | null {
    const doc = opts.getDocument();
    if (!doc?.package?.document?.comments) return null;
    if (!doc.package.document.comments.some((comment) => comment.id === commentId)) return null;
    const reply = createComment(text, author, commentId);
    doc.package.document.comments.push(reply);
    opts.comments.value = [...doc.package.document.comments];
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
    opts.comments.value = [...doc.package.document.comments];
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
    replyToComment(commentId, text, 'User');
  }

  // handleCommentResolve was a pure pass-through wrapper for resolveComment —
  // the sidebar binds @comment-resolve="resolveComment" directly now.

  function handleCommentUnresolve(commentId: number) {
    const doc = opts.getDocument();
    if (!doc?.package?.document?.comments) return;
    const c = doc.package.document.comments.find((c) => c.id === commentId);
    if (c) c.done = false;
    opts.comments.value = [...doc.package.document.comments];
    opts.emit('change', doc);
  }

  function handleCommentDelete(commentId: number) {
    const doc = opts.getDocument();
    if (!doc?.package?.document?.comments) return;
    doc.package.document.comments = doc.package.document.comments.filter(
      (c) => c.id !== commentId && c.parentId !== commentId
    );
    opts.comments.value = [...doc.package.document.comments];
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

  function handleTrackedChangeReply(revisionId: number, text: string) {
    const doc = opts.getDocument();
    const view = opts.editorView.value;
    if (!doc?.package?.document || !view) return;
    if (!doc.package.document.comments) doc.package.document.comments = [];
    const commentMark = view.state.schema.marks.comment;
    if (!commentMark) return;

    // Find first PM position covered by this revision so the reply
    // comment anchors to the same spot as the tracked change.
    let anchorPos: number | null = null;
    const insType = view.state.schema.marks.insertion;
    const delType = view.state.schema.marks.deletion;
    view.state.doc.descendants((node, pos) => {
      if (anchorPos !== null) return false;
      for (const mark of node.marks) {
        if (
          (mark.type === insType || mark.type === delType) &&
          mark.attrs.revisionId === revisionId
        ) {
          anchorPos = pos;
          return false;
        }
      }
      return true;
    });
    if (anchorPos === null) return;

    const comment = createComment(text, 'User');
    doc.package.document.comments.push(comment);
    opts.comments.value = [...doc.package.document.comments];
    const from = anchorPos;
    const to = Math.min(from + 1, view.state.doc.content.size);
    view.dispatch(view.state.tr.addMark(from, to, commentMark.create({ commentId: comment.id })));
    opts.emit('change', doc);
  }

  return {
    addComment,
    replyToComment,
    resolveComment,
    proposeChange,
    handleCommentReply,
    handleCommentUnresolve,
    handleCommentDelete,
    handleAcceptChange,
    handleRejectChange,
    handleAcceptChangeById,
    handleRejectChangeById,
    handleTrackedChangeReply,
  };
}
