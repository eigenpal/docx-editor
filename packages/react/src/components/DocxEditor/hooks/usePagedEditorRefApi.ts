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
import type { EditorState, Transaction } from 'prosemirror-state';

import type { Layout } from '@eigenpal/docx-editor-core/layout-engine';

import type { OffscreenEditorHostRef } from '../OffscreenEditorHost';
import type { PagedEditorRef } from '../PagedEditor';

interface RefApiInputs {
  hiddenPMRef: React.RefObject<OffscreenEditorHostRef | null>;
  layout: Layout | null;
  runLayoutPipeline: (state: EditorState) => void;
  scrollToPositionImpl: (pmPos: number) => void;
  scrollToParaIdImpl: (paraId: string) => boolean;
  scrollToPageImpl: (pageNumber: number) => void;
  setIsFocused: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Assemble the `PagedEditorRef` object. Single source of truth shared by
 * the imperative handle (deps re-run) and the `onReady` mirror.
 */
function buildRefApi(inputs: RefApiInputs): PagedEditorRef {
  const {
    hiddenPMRef,
    layout,
    runLayoutPipeline,
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
    getLayout: () => layout,
    relayout: () => {
      const state = hiddenPMRef.current?.getState();
      if (state) runLayoutPipeline(state);
    },
    scrollToPosition: scrollToPositionImpl,
    scrollToParaId: scrollToParaIdImpl,
    scrollToPage: scrollToPageImpl,
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
    layout,
    runLayoutPipeline,
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
        layout,
        runLayoutPipeline,
        scrollToPositionImpl,
        scrollToParaIdImpl,
        scrollToPageImpl,
        setIsFocused,
      }),
    [layout, runLayoutPipeline, scrollToPositionImpl, scrollToParaIdImpl, scrollToPageImpl]
  );

  // onReady mirror — dep array intentionally omits `scrollToPositionImpl`
  // so it doesn't refire when a parent re-creates that callback. Original
  // behavior preserved verbatim from the inline version.
  useEffect(() => {
    if (onReadyRef.current && hiddenPMRef.current) {
      onReadyRef.current(
        buildRefApi({
          hiddenPMRef,
          layout,
          runLayoutPipeline,
          scrollToPositionImpl,
          scrollToParaIdImpl,
          scrollToPageImpl,
          setIsFocused,
        })
      );
    }
  }, [layout, runLayoutPipeline, scrollToParaIdImpl, scrollToPageImpl]);
  // NOTE: onReady removed from deps — accessed via ref to prevent infinite loops.
}
