import { useImperativeHandle } from 'react';
import type { Document } from '@docx-editor.dev/core/types/document';
import type { Comment } from '@docx-editor.dev/core/types/content';
import { DocumentAgent } from '@docx-editor.dev/core/agent';
import {
  createStyleResolver,
  findContentControlsInPM,
  findContentControlPos,
  setContentControlContentTr,
  removeContentControlTr,
  setContentControlValueTr,
  type SelectionState,
  type PMContentControl,
} from '@docx-editor.dev/core/prosemirror';
import {
  findInDocument as findInDocumentCore,
  getSelectionInfo as getSelectionInfoCore,
  getPageContent as getPageContentCore,
} from '@docx-editor.dev/core/prosemirror/queries';
import {
  applyFormatting,
  setParagraphStyle,
  insertBreak,
} from '@docx-editor.dev/core/prosemirror/applyFormatting';
import {
  ContentControlNotFoundError,
  type ContentControlFilter,
  type ContentControlValue,
} from '@docx-editor.dev/core/agent';
import type { DocxInput, ScrollToParaIdOptions } from '@docx-editor.dev/core/utils';
import { getCachedNumberingMap } from '@docx-editor.dev/core/docx';
import type { DocxEditorRef } from '../../DocxEditor';
import type { PagedEditorRef } from '../PagedEditor';
import {
  addCommentToRange,
  applyProposedChange,
} from '@docx-editor.dev/core/prosemirror/commentOps';
import type { CommentIdAllocator } from '@docx-editor.dev/core/prosemirror/commentIdAllocator';
import { createComment } from '../commentFactories';

/**
 * Owns the `useImperativeHandle` that exposes the public `DocxEditorRef`
 * surface to consumers. Hand-rolled to preserve the exact dep array the
 * editor-contract gate enforces.
 *
 * The shape MUST match `DocxEditorRef` byte-for-byte —
 * `scripts/check-editor-contract.mjs` will fail otherwise.
 */
export function useDocxEditorRefApi({
  ref,
  agentRef,
  document,
  historyStateRef,
  pagedEditorRef,
  handleSave,
  handleDirectPrint,
  zoom,
  setZoom,
  scrollPageInfo,
  loadParsedDocument,
  loadBuffer,
  comments,
  setComments,
  setShowCommentsSidebar,
  contentChangeSubscribersRef,
  selectionChangeSubscribersRef,
  getCachedStyleResolver,
  commentIdAllocator,
  onUpdateTableOfContents,
}: {
  ref: React.ForwardedRef<DocxEditorRef>;
  agentRef: React.RefObject<DocumentAgent | null>;
  document: Document | null;
  historyStateRef: React.RefObject<Document | null>;
  pagedEditorRef: React.RefObject<PagedEditorRef | null>;
  handleSave: (options?: { selective?: boolean }) => Promise<ArrayBuffer | null>;
  handleDirectPrint: () => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  scrollPageInfo: { currentPage: number; totalPages: number; visible: boolean };
  loadParsedDocument: (doc: Document) => void;
  loadBuffer: (buffer: DocxInput) => Promise<void>;
  comments: Comment[];
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  setShowCommentsSidebar: React.Dispatch<React.SetStateAction<boolean>>;
  contentChangeSubscribersRef: React.RefObject<Set<(doc: Document) => void>>;
  selectionChangeSubscribersRef: React.RefObject<Set<(state: SelectionState | null) => void>>;
  getCachedStyleResolver: (
    styles: Parameters<typeof createStyleResolver>[0]
  ) => ReturnType<typeof createStyleResolver>;
  commentIdAllocator: CommentIdAllocator;
  onUpdateTableOfContents?: () => boolean;
}) {
  useImperativeHandle(
    ref,
    () => ({
      getAgent: () => agentRef.current,
      getDocument: () => document,
      getEditorRef: () => pagedEditorRef.current,
      save: handleSave,
      setZoom,
      getZoom: () => zoom,
      focus: () => {
        pagedEditorRef.current?.focus();
      },
      getCurrentPage: () => scrollPageInfo.currentPage,
      getTotalPages: () => scrollPageInfo.totalPages,
      scrollToPage: (pageNumber: number) => {
        pagedEditorRef.current?.scrollToPage(pageNumber);
      },
      scrollToPosition: (pmPos: number) => {
        pagedEditorRef.current?.scrollToPosition(pmPos);
      },
      openPrintPreview: handleDirectPrint,
      print: handleDirectPrint,
      loadDocument: loadParsedDocument,
      loadDocumentBuffer: loadBuffer,
      updateTableOfContents: () => onUpdateTableOfContents?.() ?? false,

      addComment: (options) => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return null;
        const comment = addCommentToRange(view, options, commentIdAllocator);
        if (!comment) return null;
        setComments((prev) => [...prev, comment]);
        setShowCommentsSidebar(true);
        return comment.id;
      },

      replyToComment: (commentId, text, authorName) => {
        if (!comments.some((c) => c.id === commentId)) return null;
        const reply = createComment(commentIdAllocator, text, authorName, commentId);
        setComments((prev) => [...prev, reply]);
        return reply.id;
      },

      resolveComment: (commentId) => {
        setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, done: true } : c)));
      },

      proposeChange: (options) => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return false;
        const ok = applyProposedChange(view, options, commentIdAllocator);
        if (ok) setShowCommentsSidebar(true);
        return ok;
      },

      applyFormatting: (options) => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return false;
        return applyFormatting(view, options);
      },

      setParagraphStyle: (options) => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return false;
        const currentDoc = historyStateRef.current;
        const styleResolver = currentDoc?.package?.styles
          ? getCachedStyleResolver(currentDoc.package.styles)
          : null;
        const numbering = currentDoc?.package?.numbering
          ? getCachedNumberingMap(currentDoc.package.numbering)
          : null;
        return setParagraphStyle(view, options, { styleResolver, numbering });
      },

      insertBreak: (options) => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return false;
        return insertBreak(view, options);
      },

      getPageContent: (pageNumber) =>
        getPageContentCore(
          pagedEditorRef.current?.getView() ?? null,
          (pagedEditorRef.current?.getLayout() ?? null) as Parameters<typeof getPageContentCore>[1],
          pageNumber
        ),

      scrollToParaId: (paraId: string, options?: ScrollToParaIdOptions) =>
        pagedEditorRef.current?.scrollToParaId(paraId, options) ?? false,

      scrollToCommentId: (commentId) =>
        pagedEditorRef.current?.scrollToCommentId(commentId) ?? false,

      scrollToChangeId: (revisionId) =>
        pagedEditorRef.current?.scrollToChangeId(revisionId) ?? false,

      highlightRange: (from, to) => {
        pagedEditorRef.current?.highlightRange(from, to);
      },

      findInDocument: (query, opts) =>
        findInDocumentCore(pagedEditorRef.current?.getView() ?? null, query, opts),

      getSelectionInfo: () => getSelectionInfoCore(pagedEditorRef.current?.getView() ?? null),

      getComments: () => comments,

      getContentControls: (filter?: ContentControlFilter): PMContentControl[] => {
        const view = pagedEditorRef.current?.getView();
        return view ? findContentControlsInPM(view.state.doc, filter ?? {}) : [];
      },

      scrollToContentControl: (filter: ContentControlFilter): boolean => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return false;
        const pos = findContentControlPos(view.state.doc, filter);
        if (pos == null) return false;
        pagedEditorRef.current?.scrollToPosition(pos);
        return true;
      },

      setContentControlContent: (
        filter: ContentControlFilter,
        text: string,
        options?: { force?: boolean }
      ): boolean => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return false;
        try {
          view.dispatch(setContentControlContentTr(view.state, filter, text, options));
          return true;
        } catch (err) {
          // Not-found is a soft miss; a lock refusal surfaces to the caller.
          if (err instanceof ContentControlNotFoundError) return false;
          throw err;
        }
      },

      removeContentControl: (
        filter: ContentControlFilter,
        options?: { force?: boolean; keepContent?: boolean }
      ): boolean => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return false;
        try {
          view.dispatch(removeContentControlTr(view.state, filter, options));
          return true;
        } catch (err) {
          if (err instanceof ContentControlNotFoundError) return false;
          throw err;
        }
      },

      setContentControlValue: (
        filter: ContentControlFilter,
        value: ContentControlValue,
        options?: { force?: boolean }
      ): boolean => {
        const view = pagedEditorRef.current?.getView();
        if (!view) return false;
        try {
          view.dispatch(setContentControlValueTr(view.state, filter, value, options));
          return true;
        } catch (err) {
          if (err instanceof ContentControlNotFoundError) return false;
          throw err;
        }
      },

      onContentChange: (listener) => {
        contentChangeSubscribersRef.current.add(listener);
        return () => {
          contentChangeSubscribersRef.current.delete(listener);
        };
      },

      onSelectionChange: (listener) => {
        selectionChangeSubscribersRef.current.add(listener);
        return () => {
          selectionChangeSubscribersRef.current.delete(listener);
        };
      },
    }),
    // Dep array preserved byte-for-byte from the original site so the editor-
    // contract parity gate stays green and consumers see the same ref-identity
    // semantics they had pre-extraction.
    [
      document,
      zoom,
      scrollPageInfo,
      handleSave,
      handleDirectPrint,
      loadParsedDocument,
      loadBuffer,
      comments,
      onUpdateTableOfContents,
    ]
  );
}
