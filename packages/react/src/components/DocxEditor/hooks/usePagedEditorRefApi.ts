/**
 * Imperative-handle hook for PagedEditor.
 *
 * Installs the `useImperativeHandle` that exposes `PagedEditorRef` to the
 * parent, plus the `onReady` mirror effect that fires once after mount.
 *
 * The duplication between `useImperativeHandle` and `onReady` is
 * intentional and load-bearing: their dep arrays differ. The imperative
 * handle re-runs when scroll callbacks change so consumers always see
 * the latest closures; `onReady` only fires for the layout / scroll
 * arity that's stable across renders. Both call sites share the object
 * shape via `buildRefApi` to dodge the "edit one, forget the other" trap.
 */

import { useEffect, useImperativeHandle } from 'react';
import { TextSelection } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import type { PageLayout } from '@docx-editor.dev/core/pagination-model';
import type { Document, HeaderFooter } from '@docx-editor.dev/core/types/document';
import type { ScrollToParaIdOptions } from '@docx-editor.dev/core/utils';
import {
  findCommentRange,
  findChangeRange,
  clampRangeToDoc,
} from '@docx-editor.dev/core/prosemirror/queries';

import type { OffscreenEditorHostRef } from '../OffscreenEditorHost';
import type { HiddenHeaderFooterPMsRef } from '../HiddenHeaderFooterPMs';
import type { PagedEditorRef } from '../PagedEditor';

interface RefApiInputs {
  hiddenPMRef: React.RefObject<OffscreenEditorHostRef | null>;
  hiddenHfPMsRef: React.RefObject<HiddenHeaderFooterPMsRef | null>;
  /** Current document — needed to resolve `HeaderFooter` instance → `rId`. */
  documentRef: React.MutableRefObject<Document | null>;
  pageLayout: PageLayout | null;
  runLayoutPipeline: (state: EditorState) => void;
  requestOverlayRefresh: () => void;
  scrollToPositionImpl: (pmPos: number, forParaIdScroll?: boolean) => void;
  scrollToParaIdImpl: (paraId: string, options?: ScrollToParaIdOptions) => boolean;
  scrollToPageImpl: (pageNumber: number) => void;
  setIsFocused: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Walk `package.headers` / `.footers` to find the `rId` for a given
 * `HeaderFooter` instance. Identity match — relies on the runtime model
 * sharing a single `HeaderFooter` object per `rId` across sections that
 * reference it. O(n) in the number of HF parts (typically 1–4).
 */
function findRidForHeaderFooter(doc: Document | null, hf: HeaderFooter): string | null {
  const pkg = doc?.package;
  if (!pkg) return null;
  const findIn = (bag?: Map<string, HeaderFooter>): string | null => {
    if (!bag) return null;
    for (const [rId, value] of bag) {
      if (value === hf) return rId;
    }
    return null;
  };
  return findIn(pkg.headers) ?? findIn(pkg.footers);
}

/**
 * Assemble the `PagedEditorRef` object. Single source of truth shared by
 * the imperative handle (deps re-run) and the `onReady` mirror.
 */
function buildRefApi(inputs: RefApiInputs): PagedEditorRef {
  const {
    hiddenPMRef,
    hiddenHfPMsRef,
    documentRef,
    pageLayout,
    runLayoutPipeline,
    requestOverlayRefresh,
    scrollToPositionImpl,
    scrollToParaIdImpl,
    scrollToPageImpl,
    setIsFocused,
  } = inputs;
  return {
    getDocument: () => hiddenPMRef.current?.getDocument() ?? null,
    getState: () => hiddenPMRef.current?.getState() ?? null,
    getView: () => hiddenPMRef.current?.getView() ?? null,
    focus: () => {
      hiddenPMRef.current?.focus();
      setIsFocused(true);
    },
    blur: () => {
      hiddenPMRef.current?.blur();
      setIsFocused(false);
    },
    isFocused: () => hiddenPMRef.current?.isFocused() ?? false,
    dispatch: (tr: Transaction) => hiddenPMRef.current?.dispatch(tr),
    undo: () => hiddenPMRef.current?.undo() ?? false,
    redo: () => hiddenPMRef.current?.redo() ?? false,
    setSelection: (anchor: number, head?: number) =>
      hiddenPMRef.current?.setSelection(anchor, head),
    getLayout: () => pageLayout,
    relayout: () => {
      const state = hiddenPMRef.current?.getState();
      if (state) {
        runLayoutPipeline(state);
        requestOverlayRefresh();
      }
    },
    scrollToPosition: scrollToPositionImpl,
    scrollToParaId: scrollToParaIdImpl,
    scrollToPage: scrollToPageImpl,
    highlightRange: (from: number, to: number): void => {
      const view = hiddenPMRef.current?.getView() ?? null;
      if (!view) return;
      // `highlightRange` takes raw caller positions; clampRangeToDoc returns
      // null for a malformed/out-of-range request (no-op) and clamps `to` to
      // the document size so setSelection -> doc.resolve() can't throw.
      const range = clampRangeToDoc(view.state.doc, from, to);
      if (!range) return;
      // Selecting the range makes the selection overlay paint highlight rects
      // over it. Scroll the start into view via the existing paraId-scroll
      // path (instant, virtualization-safe).
      hiddenPMRef.current?.setSelection(range.from, range.to);
      scrollToPositionImpl(range.from, true);
    },
    scrollToCommentId: (commentId: number): boolean => {
      const view = hiddenPMRef.current?.getView() ?? null;
      const range = findCommentRange(view, commentId);
      if (!range) return false;
      hiddenPMRef.current?.setSelection(range.from, range.to);
      scrollToPositionImpl(range.from, true);
      return true;
    },
    scrollToChangeId: (revisionId: number): boolean => {
      const view = hiddenPMRef.current?.getView() ?? null;
      let range = findChangeRange(view, revisionId);
      if (range) {
        hiddenPMRef.current?.setSelection(range.from, range.to);
        scrollToPositionImpl(range.from, true);
        return true;
      }
      const hfViews = hiddenHfPMsRef.current?.getViews();
      if (hfViews) {
        for (const hfView of hfViews.values()) {
          range = findChangeRange(hfView, revisionId);
          if (range) {
            const tr = hfView.state.tr.setSelection(
              TextSelection.create(hfView.state.doc, range.from, range.to)
            );
            hfView.dispatch(tr);
            hfView.focus();
            return true;
          }
        }
      }
      return false;
    },
    getHfPmView: (hf: HeaderFooter): EditorView | null => {
      const rId = findRidForHeaderFooter(documentRef.current, hf);
      if (!rId) return null;
      return hiddenHfPMsRef.current?.getView(rId) ?? null;
    },
    getHfPmViews: (): Map<string, EditorView> => {
      return hiddenHfPMsRef.current?.getViews() ?? new Map();
    },
  };
}

export interface UsePagedEditorRefApiOptions extends RefApiInputs {
  ref: React.Ref<PagedEditorRef>;
  onReadyRef: React.MutableRefObject<((ref: PagedEditorRef) => void) | undefined>;
}

export function usePagedEditorRefApi(opts: UsePagedEditorRefApiOptions): void {
  const {
    ref,
    hiddenPMRef,
    hiddenHfPMsRef,
    documentRef,
    pageLayout,
    runLayoutPipeline,
    requestOverlayRefresh,
    scrollToPositionImpl,
    scrollToParaIdImpl,
    scrollToPageImpl,
    setIsFocused,
    onReadyRef,
  } = opts;

  useImperativeHandle(
    ref,
    () =>
      buildRefApi({
        hiddenPMRef,
        hiddenHfPMsRef,
        documentRef,
        pageLayout,
        runLayoutPipeline,
        requestOverlayRefresh,
        scrollToPositionImpl,
        scrollToParaIdImpl,
        scrollToPageImpl,
        setIsFocused,
      }),
    [
      pageLayout,
      runLayoutPipeline,
      requestOverlayRefresh,
      scrollToPositionImpl,
      scrollToParaIdImpl,
      scrollToPageImpl,
    ]
  );

  // onReady mirror — dep array intentionally omits `scrollToPositionImpl`
  // so it doesn't refire when a parent re-creates that callback. Original
  // behavior preserved verbatim from the inline version.
  useEffect(() => {
    if (onReadyRef.current && hiddenPMRef.current) {
      onReadyRef.current(
        buildRefApi({
          hiddenPMRef,
          hiddenHfPMsRef,
          documentRef,
          pageLayout,
          runLayoutPipeline,
          requestOverlayRefresh,
          scrollToPositionImpl,
          scrollToParaIdImpl,
          scrollToPageImpl,
          setIsFocused,
        })
      );
    }
  }, [pageLayout, runLayoutPipeline, requestOverlayRefresh, scrollToParaIdImpl, scrollToPageImpl]);
  // NOTE: onReady removed from deps — accessed via ref to prevent infinite loops.
}
