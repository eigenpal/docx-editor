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
import { acceptChange, rejectChange } from '@eigenpal/docx-editor-core/prosemirror/commands';
import { findParaIdRange, findTextInPmParagraph } from '../utils/paraTextHelpers';
import { createComment as createCommentImpl } from './../utils/commentFactories';
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
}

export function useCommentManagement(opts: UseCommentManagementOptions) {
  function createComment(text: string, author: string, parentId?: number): Comment {
    const doc = opts.getDocument();
    return createCommentImpl(doc?.package?.document?.comments ?? [], text, author, parentId);
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
    const commentMark = view.state.schema.marks.comment;
    if (!commentMark) return null;

    const range = findParaIdRange(view.state.doc, options.paraId);
    if (!range) return null;

    let from = range.from + 1;
    let to = range.to - 1;
    if (options.search) {
      const textRange = findTextInPmParagraph(view.state.doc, range.from, range.to, options.search);
      if (!textRange) return null;
      from = textRange.from;
      to = textRange.to;
    }
    if (from >= to) return null;

    const comment = createComment(options.text, options.author);
    doc.package.document.comments.push(comment);
    opts.comments.value = [...doc.package.document.comments];
    view.dispatch(view.state.tr.addMark(from, to, commentMark.create({ commentId: comment.id })));
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
    const { schema } = view.state;
    if (!schema.marks.deletion || !schema.marks.insertion) return false;
    const range = findParaIdRange(view.state.doc, options.paraId);
    if (!range) return false;

    const isInsertion = options.search === '';
    const isDeletion = options.replaceWith === '';
    if (isInsertion && isDeletion) return false;

    let textFrom: number;
    let textTo: number;
    if (isInsertion) {
      textFrom = range.to - 1;
      textTo = range.to - 1;
    } else {
      const textRange = findTextInPmParagraph(view.state.doc, range.from, range.to, options.search);
      if (!textRange) return false;
      textFrom = textRange.from;
      textTo = textRange.to;
    }

    let overlapsTrackedChange = false;
    if (textFrom < textTo) {
      view.state.doc.nodesBetween(textFrom, textTo, (node) => {
        for (const mark of node.marks) {
          if (mark.type === schema.marks.insertion || mark.type === schema.marks.deletion) {
            overlapsTrackedChange = true;
            return false;
          }
        }
        return true;
      });
    }
    if (overlapsTrackedChange) return false;

    const revisionId =
      Math.max(0, ...opts.trackedChanges.value.map((change) => change.revisionId)) + 1;
    const date = new Date().toISOString();
    const deletionMark = schema.marks.deletion.create({ revisionId, author: options.author, date });
    const insertionMark = schema.marks.insertion.create({
      revisionId,
      author: options.author,
      date,
    });

    let tr = view.state.tr;
    if (!isInsertion) tr = tr.addMark(textFrom, textTo, deletionMark);
    if (!isDeletion) tr = tr.insert(textTo, schema.text(options.replaceWith, [insertionMark]));
    view.dispatch(tr);
    opts.extractCommentsAndChanges();
    opts.showSidebar.value = true;
    return true;
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
    handleTrackedChangeReply,
  };
}
