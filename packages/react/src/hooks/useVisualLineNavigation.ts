/**
 * Visual Line Navigation Hook
 *
 * Thin React wrapper around the framework-agnostic algorithm in
 * `@eigenpal/docx-editor-core/prosemirror/utils/visualLineNavigation`.
 * Owns sticky-X state; Vue's composable mirrors this shape.
 */

import { useCallback, useRef } from 'react';
import type { EditorView } from 'prosemirror-view';
import {
  createVisualLineState,
  getCaretClientX as coreGetCaretClientX,
  findLineElementAtPosition as coreFindLineElementAtPosition,
  findPositionOnLineAtClientX as coreFindPositionOnLineAtClientX,
  handleVisualLineKeyDown,
} from '@eigenpal/docx-editor-core/prosemirror/utils/visualLineNavigation';

export interface VisualLineNavigationOptions {
  pagesContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function useVisualLineNavigation({ pagesContainerRef }: VisualLineNavigationOptions) {
  const stateRef = useRef(createVisualLineState());

  const getCaretClientX = useCallback(
    (pmPos: number): number | null => {
      const c = pagesContainerRef.current;
      return c ? coreGetCaretClientX(c, pmPos) : null;
    },
    [pagesContainerRef]
  );

  const findLineElementAtPosition = useCallback(
    (pmPos: number): HTMLElement | null => {
      const c = pagesContainerRef.current;
      return c ? coreFindLineElementAtPosition(c, pmPos) : null;
    },
    [pagesContainerRef]
  );

  const findPositionOnLineAtClientX = useCallback(
    (lineEl: HTMLElement, clientX: number): number | null => {
      return coreFindPositionOnLineAtClientX(lineEl, clientX);
    },
    []
  );

  const handlePMKeyDown = useCallback(
    (view: EditorView, event: KeyboardEvent): boolean => {
      return handleVisualLineKeyDown(stateRef.current, view, event, pagesContainerRef.current);
    },
    [pagesContainerRef]
  );

  return {
    getCaretClientX,
    findLineElementAtPosition,
    findPositionOnLineAtClientX,
    handlePMKeyDown,
  };
}
