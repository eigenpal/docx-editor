/**
 * Ref-API assembler — takes the foundational primitives from
 * `useDocxEditor` plus the action objects from every other composable
 * in `DocxEditorVue.vue` and returns the `DocxEditorRef`-shaped
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
import type { Layout } from '@eigenpal/docx-editor-core/layout-engine';
import { findPageIndexContainingPmPos } from '@eigenpal/docx-editor-core/layout-engine';
import {
  findInDocument as findInDocumentImpl,
  getSelectionInfo as getSelectionInfoImpl,
  getPageContent as getPageContentImpl,
} from '../utils/refApiQueries';
import { findParaIdRange } from '../utils/paraTextHelpers';
import type { DocxEditorRef } from '../editor-ref';
import type { ApplyFormattingOptions } from './useFormattingActions';

export interface UseDocxEditorRefApiOptions {
  // Foundational refs / accessors (useDocxEditor)
  editorView: Ref<EditorView | null>;
  layout: Ref<Layout | null>;
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
    return opts.layout.value?.pages.length ?? 0;
  }

  function getCurrentPage(): number {
    const currentLayout = opts.layout.value;
    const view = opts.editorView.value;
    if (!currentLayout || !view) return 0;
    const pageIndex = findPageIndexContainingPmPos(currentLayout, view.state.selection.from);
    return pageIndex == null ? 0 : pageIndex + 1;
  }

  function scrollToParaId(paraId: string): boolean {
    const view = opts.editorView.value;
    if (!view) return false;
    const range = findParaIdRange(view.state.doc, paraId);
    if (!range) return false;
    opts.scrollVisiblePositionIntoView(range.from + 1);
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

  function getPageContent(pageNumber: number) {
    return getPageContentImpl(opts.editorView.value, opts.layout.value, pageNumber);
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
    destroy: opts.destroy,
    getDocument: opts.getDocument,
    getEditorRef,
    addComment: opts.addComment,
    replyToComment: opts.replyToComment,
    resolveComment: opts.resolveComment,
    proposeChange: opts.proposeChange,
    scrollToParaId,
    findInDocument,
    getSelectionInfo,
    getComments,
    applyFormatting: opts.applyFormatting,
    setParagraphStyle: opts.setParagraphStyle,
    getPageContent,
    getTotalPages,
    getCurrentPage,
    onContentChange,
    onSelectionChange,
  } satisfies DocxEditorRef;

  return { exposed };
}
