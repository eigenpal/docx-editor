/**
 * Ref-API assembler — takes the foundational primitives from
 * `useDocxEditor` plus the action objects from every other composable
 * in `DocxEditor.vue` and returns the `DocxEditorRef`-shaped
 * `exposed` object the parent feeds into `defineExpose`. Owns the
 * small local helpers (print, scrollToPage, scrollToPosition,
 * getEditorRef, getTotalPages, getCurrentPage, findInDocument,
 * getSelectionInfo, getComments, getPageContent, scrollToParaId,
 * onContentChange, onSelectionChange) that previously sat inline in
 * the SFC just to populate the `exposed` literal.
 *
 * `satisfies DocxEditorRef` enforces signatures against EditorRefLike
 * at typecheck time (Decision 10 in the 1.0 spec) without affecting
 * the runtime shape.
 */

import type { Ref, ShallowRef } from 'vue';
import type { EditorView } from 'prosemirror-view';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import type { DocxInput } from '@eigenpal/docx-editor-core/utils';
import {
  flashParagraphBoxesByParaId,
  type ScrollToParaIdOptions,
} from '@eigenpal/docx-editor-core/utils';
import type { PageLayout } from '@eigenpal/docx-editor-core/pagination-model';
import { findPageIndexContainingPmPos } from '@eigenpal/docx-editor-core/pagination-model';
import { paintAllPagesNow } from '@eigenpal/docx-editor-core/painter-model';
import {
  findContentControlsInPM,
  findContentControlPos,
  setContentControlContentTr,
  removeContentControlTr,
  setContentControlValueTr,
  type PMContentControl,
} from '@eigenpal/docx-editor-core/prosemirror';
import {
  ContentControlNotFoundError,
  type ContentControlFilter,
  type ContentControlValue,
} from '@eigenpal/docx-editor-core/agent';
import {
  findInDocument as findInDocumentImpl,
  getSelectionInfo as getSelectionInfoImpl,
  getPageContent as getPageContentImpl,
} from '../utils/refApiQueries';
import { findParaIdRange } from '@eigenpal/docx-editor-core/prosemirror/paraText';
import {
  findCommentRange,
  findChangeRange,
  clampRangeToDoc,
} from '@eigenpal/docx-editor-core/prosemirror/queries';
import { TextSelection } from 'prosemirror-state';
import type { DocxEditorRef } from '../components/DocxEditor/types';
import type { ApplyFormattingOptions } from './useFormattingActions';

export interface UseDocxEditorRefApiOptions {
  // Foundational refs / accessors (useDocxEditor)
  editorView: Ref<EditorView | null>;
  pageLayout: Ref<PageLayout | null>;
  pagesRef: Ref<HTMLElement | null>;
  pagesViewportRef: Ref<HTMLElement | null>;
  zoom: Ref<number>;
  comments: ShallowRef<Comment[]>;
  // Action handles
  focus: () => void;
  destroy: () => void;
  getDocument: () => Document | null;
  setZoom: (zoom: number) => void;
  save: () => Promise<ArrayBuffer | null>;
  loadDocument: (doc: Document) => void;
  loadDocumentBuffer: (buffer: DocxInput) => Promise<void>;
  onUpdateTableOfContents?: () => boolean;
  addComment: (options: {
    paraId: string;
    text: string;
    author: string;
    search?: string;
  }) => number | null;
  replyToComment: (commentId: number, text: string, author: string) => number | null;
  resolveComment: (commentId: number) => void;
  proposeChange: (options: {
    paraId: string;
    search: string;
    replaceWith: string;
    author: string;
  }) => boolean;
  applyFormatting: (options: ApplyFormattingOptions) => boolean;
  setParagraphStyle: (options: { paraId: string; styleId: string }) => boolean;
  insertBreak: (options: {
    paraId: string;
    type: 'page' | 'sectionNextPage' | 'sectionContinuous';
  }) => boolean;
  scrollVisiblePositionIntoView: (pmPos: number) => void;
  // Subscriber sets (used by onContentChange / onSelectionChange)
  contentChangeSubscribers: Set<(document: unknown) => void>;
  selectionChangeSubscribers: Set<(selection: unknown) => void>;
  // Optional host hook for print
  onPrint?: () => void;
}

export function useDocxEditorRefApi(opts: UseDocxEditorRefApiOptions): {
  exposed: DocxEditorRef;
} {
  function print() {
    // Virtualization keeps off-screen pages as empty shells. Without this
    // they print as blank pages past the visible band (issue #579).
    const pagesEl = opts.pagesRef.value;
    if (pagesEl) paintAllPagesNow(pagesEl);
    opts.onPrint?.();
    window.print();
  }

  function openPrintPreview() {
    print();
  }

  function getZoom() {
    return opts.zoom.value;
  }

  function scrollToPage(pageNumber: number) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) return;
    const viewport = opts.pagesViewportRef.value;
    const pageEl = opts.pagesRef.value?.querySelector<HTMLElement>(
      `[data-page-number="${pageNumber}"]`
    );
    if (!viewport || !pageEl) return;
    const viewportRect = viewport.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();
    viewport.scrollTo({
      top: pageRect.top - viewportRect.top + viewport.scrollTop - 24,
      behavior: 'smooth',
    });
  }

  function scrollToPosition(pmPos: number) {
    if (!Number.isFinite(pmPos)) return;
    opts.scrollVisiblePositionIntoView(pmPos);
  }

  function getEditorRef() {
    if (!opts.editorView.value) return null;
    return {
      getDocument: opts.getDocument,
      getView: () => opts.editorView.value,
      getState: () => opts.editorView.value?.state ?? null,
    };
  }

  function getTotalPages(): number {
    return opts.pageLayout.value?.pages.length ?? 0;
  }

  function getCurrentPage(): number {
    const currentPageLayout = opts.pageLayout.value;
    const view = opts.editorView.value;
    if (!currentPageLayout || !view) return 0;
    const pageIndex = findPageIndexContainingPmPos(currentPageLayout, view.state.selection.from);
    return pageIndex == null ? 0 : pageIndex + 1;
  }

  function scrollToParaId(paraId: string, options?: ScrollToParaIdOptions): boolean {
    const view = opts.editorView.value;
    if (!view) return false;
    const range = findParaIdRange(view.state.doc, paraId);
    if (!range) return false;
    opts.scrollVisiblePositionIntoView(range.from + 1);
    if (options?.highlight) {
      const flashPara = () => {
        const pages = opts.pagesRef.value;
        if (pages) flashParagraphBoxesByParaId(pages, paraId, options.highlight);
      };
      flashPara();
      requestAnimationFrame(() => requestAnimationFrame(flashPara));
    }
    return true;
  }

  function findInDocument(query: string, findOpts?: { caseSensitive?: boolean; limit?: number }) {
    return findInDocumentImpl(opts.editorView.value, query, findOpts);
  }

  function getSelectionInfo() {
    return getSelectionInfoImpl(opts.editorView.value);
  }

  function getComments() {
    return opts.comments.value;
  }

  function getContentControls(filter?: ContentControlFilter): PMContentControl[] {
    const view = opts.editorView.value;
    return view ? findContentControlsInPM(view.state.doc, filter ?? {}) : [];
  }

  function scrollToContentControl(filter: ContentControlFilter): boolean {
    const view = opts.editorView.value;
    if (!view) return false;
    const pos = findContentControlPos(view.state.doc, filter);
    if (pos == null) return false;
    scrollToPosition(pos);
    return true;
  }

  // Select `[from, to]` so the selection overlay highlights it, then scroll the
  // start into view. Shared by the three location-reveal methods below; mirrors
  // React's hiddenPM.setSelection (`TextSelection.create`) + paraId-scroll path.
  // Prefer `create` over `between`: at a block-node position `between` collapses
  // to a cursor at `to`, while React's create path keeps anchor/head aligned.
  function selectAndReveal(view: EditorView, from: number, to: number): void {
    const sel = TextSelection.create(view.state.doc, from, to);
    view.dispatch(view.state.tr.setSelection(sel));
    opts.scrollVisiblePositionIntoView(from);
  }

  function highlightRange(from: number, to: number): void {
    const view = opts.editorView.value;
    if (!view) return;
    // Raw caller positions: clampRangeToDoc returns null for a malformed or
    // out-of-range request (no-op) and clamps `to` to the document size so
    // doc.resolve() can't throw.
    const range = clampRangeToDoc(view.state.doc, from, to);
    if (!range) return;
    selectAndReveal(view, range.from, range.to);
  }

  function scrollToCommentId(commentId: number): boolean {
    const view = opts.editorView.value;
    if (!view) return false;
    const range = findCommentRange(view, commentId);
    if (!range) return false;
    selectAndReveal(view, range.from, range.to);
    return true;
  }

  function scrollToChangeId(revisionId: number): boolean {
    const view = opts.editorView.value;
    if (!view) return false;
    const range = findChangeRange(view, revisionId);
    if (!range) return false;
    selectAndReveal(view, range.from, range.to);
    return true;
  }

  function setContentControlContent(
    filter: ContentControlFilter,
    text: string,
    options?: { force?: boolean }
  ): boolean {
    const view = opts.editorView.value;
    if (!view) return false;
    try {
      view.dispatch(setContentControlContentTr(view.state, filter, text, options));
      return true;
    } catch (err) {
      // Not-found is a soft miss; a lock refusal surfaces to the caller.
      if (err instanceof ContentControlNotFoundError) return false;
      throw err;
    }
  }

  function removeContentControl(
    filter: ContentControlFilter,
    options?: { force?: boolean; keepContent?: boolean }
  ): boolean {
    const view = opts.editorView.value;
    if (!view) return false;
    try {
      view.dispatch(removeContentControlTr(view.state, filter, options));
      return true;
    } catch (err) {
      if (err instanceof ContentControlNotFoundError) return false;
      throw err;
    }
  }

  function setContentControlValue(
    filter: ContentControlFilter,
    value: ContentControlValue,
    options?: { force?: boolean }
  ): boolean {
    const view = opts.editorView.value;
    if (!view) return false;
    try {
      view.dispatch(setContentControlValueTr(view.state, filter, value, options));
      return true;
    } catch (err) {
      if (err instanceof ContentControlNotFoundError) return false;
      throw err;
    }
  }

  function getPageContent(pageNumber: number) {
    return getPageContentImpl(opts.editorView.value, opts.pageLayout.value, pageNumber);
  }

  function updateTableOfContentsRef(): boolean {
    return opts.onUpdateTableOfContents?.() ?? false;
  }

  function onContentChange(listener: (document: unknown) => void): () => void {
    opts.contentChangeSubscribers.add(listener);
    return () => opts.contentChangeSubscribers.delete(listener);
  }

  function onSelectionChange(listener: (selection: unknown) => void): () => void {
    opts.selectionChangeSubscribers.add(listener);
    return () => opts.selectionChangeSubscribers.delete(listener);
  }

  const exposed = {
    getAgent: () => null,
    save: opts.save,
    setZoom: opts.setZoom,
    getZoom,
    focus: opts.focus,
    scrollToPage,
    scrollToPosition,
    openPrintPreview,
    print,
    loadDocument: opts.loadDocument,
    loadDocumentBuffer: opts.loadDocumentBuffer,
    updateTableOfContents: updateTableOfContentsRef,
    destroy: opts.destroy,
    getDocument: opts.getDocument,
    getEditorRef,
    addComment: opts.addComment,
    replyToComment: opts.replyToComment,
    resolveComment: opts.resolveComment,
    proposeChange: opts.proposeChange,
    scrollToParaId,
    scrollToCommentId,
    scrollToChangeId,
    highlightRange,
    findInDocument,
    getSelectionInfo,
    getComments,
    getContentControls,
    scrollToContentControl,
    setContentControlContent,
    removeContentControl,
    setContentControlValue,
    applyFormatting: opts.applyFormatting,
    setParagraphStyle: opts.setParagraphStyle,
    insertBreak: opts.insertBreak,
    getPageContent,
    getTotalPages,
    getCurrentPage,
    onContentChange,
    onSelectionChange,
  } satisfies DocxEditorRef;

  return { exposed };
}
