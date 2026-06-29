/**
 * Layout-trigger effects for PagedEditor.
 *
 * Re-runs `runLayoutPipeline` for two state-shifts that the pipeline's
 * own dep array doesn't catch automatically:
 *
 *  1. Web-font loading completes — measurements computed against fallback
 *     fonts are now wrong, so the canvas + measurement caches need a
 *     full reset.
 *
 *  2. Header / footer content changes — runLayoutPipeline does include
 *     these in its deps, but only re-runs when explicitly called. The
 *     first render already laid out via handleEditorViewReady, so this
 *     effect skips the initial render via a one-shot epoch counter.
 */

import { useEffect, useRef } from 'react';

import { clearAllCaches, resetCanvasContext } from '@eigenpal/docx-editor-core/flow-model';
import type { HeaderFooter } from '@eigenpal/docx-editor-core/types/document';
import type { EditorState } from 'prosemirror-state';

import type { OffscreenEditorHostRef } from '../OffscreenEditorHost';

export interface UseLayoutTriggersOptions {
  hiddenPMRef: React.RefObject<OffscreenEditorHostRef | null>;
  runLayoutPipeline: (state: EditorState) => void;
  updateSelectionOverlay: (state: EditorState) => void;
  headerContent?: HeaderFooter | null;
  footerContent?: HeaderFooter | null;
  firstPageHeaderContent?: HeaderFooter | null;
  firstPageFooterContent?: HeaderFooter | null;
}

export function useLayoutTriggers(opts: UseLayoutTriggersOptions): void {
  const {
    hiddenPMRef,
    runLayoutPipeline,
    updateSelectionOverlay,
    headerContent,
    footerContent,
    firstPageHeaderContent,
    firstPageFooterContent,
  } = opts;

  // Re-layout on web-font load. FontFaceSet.onloadingdone catches new
  // fonts as they finish loading.
  useEffect(() => {
    const handleFontsLoaded = () => {
      const view = hiddenPMRef.current?.getView();
      if (view) {
        resetCanvasContext();
        clearAllCaches();
        runLayoutPipeline(view.state);
        updateSelectionOverlay(view.state);
      }
    };
    window.document.fonts.addEventListener('loadingdone', handleFontsLoaded);
    return () => {
      window.document.fonts.removeEventListener('loadingdone', handleFontsLoaded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-layout when H/F content changes (HF editor save, etc.).
  const headerFooterEpochRef = useRef(0);
  useEffect(() => {
    // Skip the initial render — handleEditorViewReady already did the first layout.
    if (headerFooterEpochRef.current === 0) {
      headerFooterEpochRef.current = 1;
      return;
    }
    const view = hiddenPMRef.current?.getView();
    if (view) {
      runLayoutPipeline(view.state);
    }
  }, [
    headerContent,
    footerContent,
    firstPageHeaderContent,
    firstPageFooterContent,
    runLayoutPipeline,
    hiddenPMRef,
  ]);
}
